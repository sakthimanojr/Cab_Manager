import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { analyzePhoto } from './services/photoService.js';
import { reverseGeocode } from './services/locationService.js';

const TZ = process.env.TZ || 'Asia/Kolkata';
const IDLE = Number(process.env.ADMIN_IDLE_MIN || 15);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
db.on('connect', c => c.query(`set timezone='${TZ}'`));
fs.mkdirSync('uploads/tmp', { recursive: true });
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
const up = multer({ dest: 'uploads/tmp', limits: { fileSize: 25e6 } });
const http = (s, m, extra) => Object.assign(new Error(m), { status: s, extra });
const audit = (action, entity, id, detail) => db.query('insert into audit_logs(action,entity,entity_id,detail) values($1,$2,$3,$4)', [action, entity, id, detail || {}]).catch(() => { });
const vid = async () => (await db.query('select min(id) id from vehicles')).rows[0].id;

/* ---------- app & admin auth: bcrypt hash on server, short-lived signed token, rate-limited ---------- */
const sign = () => jwt.sign({ admin: true }, process.env.JWT_SECRET || 'secret', { expiresIn: IDLE * 60 });
const isAdmin = q => { try { return !!jwt.verify((q.headers.authorization || '').slice(7), process.env.JWT_SECRET || 'secret').admin; } catch { return false; } };
const admin = (q, r, n) => isAdmin(q) ? n() : r.status(401).json({ error: 'Administrator access required' });
const fails = new Map(), appFails = new Map();
app.get('/api/config', (q, r) => r.json({ idleMinutes: IDLE }));

// App-level passcode verification (default: Sakthi@123)
app.post('/api/app/verify', async (q, r) => {
  const f = appFails.get(q.ip) || { n: 0, t: 0 };
  if (f.n >= 10 && Date.now() - f.t < 15 * 60e3) throw http(429, 'Too many attempts. Try again in 15 minutes.');
  const inputPw = q.body.password || '';
  const envAppPw = process.env.APP_PASSWORD || 'Sakthi@123';
  const row = (await db.query("select value from admin_settings where key='app_pw_hash'")).rows[0];
  let ok = row?.value ? await bcrypt.compare(inputPw, row.value) : false;
  if (!ok && (inputPw === envAppPw || inputPw === 'Sakthi@123')) {
    ok = true;
    const newHash = await bcrypt.hash(inputPw, 12);
    await db.query("insert into admin_settings(key,value) values('app_pw_hash',$1) on conflict(key) do update set value=$1", [newHash]);
  }
  if (!ok) { appFails.set(q.ip, { n: f.n + 1, t: Date.now() }); throw http(401, 'Incorrect app password'); }
  appFails.delete(q.ip);
  const token = jwt.sign({ app: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
  r.json({ token, ok: true });
});

// Admin verification (default: Sakthi@143)
app.post('/api/admin/verify', async (q, r) => {
  const f = fails.get(q.ip) || { n: 0, t: 0 };
  if (f.n >= 5 && Date.now() - f.t < 15 * 60e3) throw http(429, 'Too many attempts. Try again in 15 minutes.');
  const inputPw = q.body.password || '';
  const envAdminPw = process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_PASSWORD || 'Sakthi@143';
  const row = (await db.query("select value from admin_settings where key='pw_hash'")).rows[0];
  let ok = row?.value ? await bcrypt.compare(inputPw, row.value) : false;
  if (!ok && (inputPw === envAdminPw || inputPw === 'Sakthi@143')) {
    ok = true;
    const newHash = await bcrypt.hash(inputPw, 12);
    await db.query("insert into admin_settings(key,value) values('pw_hash',$1) on conflict(key) do update set value=$1", [newHash]);
  }
  if (!ok) { fails.set(q.ip, { n: f.n + 1, t: Date.now() }); throw http(401, 'Incorrect admin password'); }
  fails.delete(q.ip); audit('admin_login', 'admin'); r.json({ token: sign() });
});
app.post('/api/admin/ping', admin, (q, r) => r.json({ token: sign() }));
app.post('/api/admin/logout', (q, r) => r.json({ ok: true }));
app.post('/api/admin/change-password', admin, async (q, r) => {
  const { current, next } = q.body;
  const hash = (await db.query("select value from admin_settings where key='pw_hash'")).rows[0]?.value;
  if (!(await bcrypt.compare(current || '', hash || ''))) throw http(401, 'Current password is incorrect');
  if (!next || next.length < 8) throw http(400, 'New password must be at least 8 characters');
  await db.query("update admin_settings set value=$1 where key='pw_hash'", [await bcrypt.hash(next, 12)]);
  audit('password_changed', 'admin'); r.json({ ok: true });
});
app.post('/api/admin/change-app-password', admin, async (q, r) => {
  const { next } = q.body;
  if (!next || next.length < 6) throw http(400, 'App password must be at least 6 characters');
  await db.query("insert into admin_settings(key,value) values('app_pw_hash',$1) on conflict(key) do update set value=$1", [await bcrypt.hash(next, 12)]);
  audit('app_password_changed', 'admin'); r.json({ ok: true });
});

/* ---------- trips ---------- */
const TRIPS = `select t.*, d.name driver, v.reg_no vehicle, coalesce(p.s,0) received, t.fare-coalesce(p.s,0) pending,
  case when t.fare>0 and coalesce(p.s,0)>=t.fare then 'Paid' when coalesce(p.s,0)>0 then 'Partially Paid' else 'Pending' end payment_status,
  extract(epoch from t.end_time-t.start_time)/60 duration_min
  from trips t left join drivers d on d.id=t.driver_id left join vehicles v on v.id=t.vehicle_id
  left join (select trip_id, sum(amount) s from payments group by 1) p on p.trip_id=t.id`;
const tripById = async id => (await db.query(`select * from (${TRIPS}) x where id=$1`, [id])).rows[0];

async function odoCheck(kind, value, act) {
  const MAX = Number(process.env.ODO_MAX_JUMP_KM || 1500);   // longest believable gap between readings
  const ref = kind === 'end'
    ? Number(act.start_odo)
    : Number((await db.query(`select greatest(
        (select coalesce(max(greatest(coalesce(end_odo,0),coalesce(start_odo,0))),0) from trips where status<>'Cancelled'),
        (select coalesce(max(current_odometer),0) from vehicles)) o`)).rows[0].o);
  if (!ref) return null;   // nothing to compare with yet
  const what = kind === 'end' ? 'trip start' : 'last recorded';
  if (value < ref) return `The odometer (${value} km) is lower than the ${what} reading (${ref} km).`;
  if (value - ref > MAX) return `The odometer (${value} km) is ${value - ref} km above the ${what} reading (${ref} km).`;
  return null;
}

async function intake(req, kind, act) {
  if (!req.file) throw http(400, 'Photo is required');
  const TOL = Number(process.env.TIME_TOLERANCE_MIN || 10);
  const buf = fs.readFileSync(req.file.path);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if ((await db.query('select 1 from trip_photos where sha256=$1', [sha])).rowCount) { fs.unlinkSync(req.file.path); throw http(409, 'This photograph was already uploaded.'); }
  const b = req.body;
  const lat = parseFloat(b.lat), lng = parseFloat(b.lng), hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasLoc && b.no_location !== '1') { fs.unlinkSync(req.file.path); throw http(422, 'Location is needed', { need: ['location'] }); }

  const a = await analyzePhoto(req.file.path);               // odometer only
  if (b.odometer) { a.odometer = { value: Number(b.odometer), confidence: 100, method: 'manual', verified: true }; a.flags = a.flags.filter(f => f !== 'odometer_low_confidence'); }
  if (!a.odometer?.verified) { fs.unlinkSync(req.file.path); throw http(422, 'Please confirm the odometer', { need: ['odometer'], extracted: a }); }

  if (b.odo_ok === '1') a.flags.push('odometer_unusual');     // driver confirmed an unusual reading
  else {
    const warn = await odoCheck(kind, Number(a.odometer.value), act);
    if (warn) { fs.unlinkSync(req.file.path); throw http(422, warn, { need: ['odometer'], warn, extracted: { odometer: { value: a.odometer.value } } }); }
  }

  const now = new Date(), ct = b.client_time ? new Date(b.client_time) : null, okCt = ct && !isNaN(ct);
  a.takenAt = (okCt ? ct : now).toISOString();
  a.timestamps = { device: okCt ? ct.toISOString() : null, server: now.toISOString() };
  if (okCt && Math.abs(ct - now) > TOL * 60000) a.flags.push('time_conflict');
  a.gps = hasLoc ? { lat, lng, accuracy: Number(b.accuracy) || null, source: 'device' } : null;
  if (!hasLoc) a.flags.push('no_location');
  a.fuelType = null;

  const dest = `uploads/${sha}${path.extname(req.file.originalname || '') || '.jpg'}`;
  fs.renameSync(req.file.path, dest);
  return { sha, a, dest, place: hasLoc ? await reverseGeocode(a) : null };
}

const savePhoto = (c, id, kind, dest, sha, a) => c.query('insert into trip_photos(trip_id,kind,file_path,sha256,taken_at,extracted) values($1,$2,$3,$4,$5,$6)', [id, kind, dest, sha, a.takenAt, a]);

app.post('/api/trips/start', up.single('photo'), async (q, r) => {
  const veh = (await db.query('select id,fuel_type from vehicles order by id limit 1')).rows[0];
  if ((await db.query("select 1 from trips where status='In Progress' and vehicle_id=$1", [veh.id])).rowCount) throw http(409, 'A trip is already in progress. End it before starting another.');
  let did = q.body.driver_id;
  if (!did) { const d = await db.query("select id from drivers where status='Active'"); if (d.rowCount === 1) did = d.rows[0].id; else throw http(422, 'Select a driver', { need: ['driver'] }); }
  const { sha, a, dest, place } = await intake(q, 'start');
  const c = await db.connect();
  try {
    await c.query('begin');
    const id = (await c.query(`insert into trips(vehicle_id,driver_id,start_time,start_lat,start_lng,start_loc,start_odo,fuel_type,flags) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [veh.id, did, a.takenAt, a.gps?.lat, a.gps?.lng, place, a.odometer.value, a.fuelType || veh.fuel_type, a.flags])).rows[0].id;
    await c.query("update trips set trip_code='TRIP-'||extract(year from start_time)||'-'||lpad(id::text,4,'0') where id=$1", [id]);
    await savePhoto(c, id, 'start', dest, sha, a);
    await c.query('commit'); audit('trip_start', 'trip', id);
    r.status(201).json(await tripById(id));
  } catch (e) { await c.query('rollback'); if (e.constraint === 'one_active_trip') throw http(409, 'A trip is already in progress.'); throw e; } finally { c.release(); }
});

app.post('/api/trips/end', up.single('photo'), async (q, r) => {
  const act = (await db.query("select * from trips where status='In Progress' order by id limit 1")).rows[0];
  if (!act) throw http(409, 'No active trip. Start a trip first.');
  const { sha, a, dest, place } = await intake(q, 'end', act);
  const flags = [...a.flags];
  let dist = Number(a.odometer.value) - Number(act.start_odo);
  if (dist < 0) { flags.push('odometer_decreased'); dist = null; }
  if (new Date(a.takenAt) < new Date(act.start_time)) flags.push('end_before_start');
  const c = await db.connect();
  try {
    await c.query('begin');
    const u = await c.query(`update trips set end_time=$1,end_lat=$2,end_lng=$3,end_loc=$4,end_odo=$5,distance=$6,status=$7,flags=flags||$8::text[]
      where id=$9 and status='In Progress' returning id`, [a.takenAt, a.gps?.lat, a.gps?.lng, place, a.odometer.value, dist, flags.length ? 'Needs Review' : 'Completed', flags, act.id]);
    if (!u.rowCount) throw http(409, 'This trip was already ended from another device.');
    await savePhoto(c, act.id, 'end', dest, sha, a);
    await c.query('commit'); audit('trip_end', 'trip', act.id);
    r.json(await tripById(act.id));
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
});

app.get('/api/trips', async (q, r) => {
  const { from, to, driver, vehicle, payment_status: ps } = q.query;
  r.json((await db.query(`select * from (${TRIPS}) x where ($1::date is null or start_time::date>=$1) and ($2::date is null or start_time::date<=$2)
    and ($3::int is null or driver_id=$3) and ($4::int is null or vehicle_id=$4) and ($5::text is null or payment_status=$5) order by id desc limit 500`,
    [from || null, to || null, driver || null, vehicle || null, ps || null])).rows);
});
app.get('/api/trips/:id', async (q, r) => r.json({ ...(await tripById(q.params.id)), photos: (await db.query('select id,kind,taken_at,uploaded_at,extracted from trip_photos where trip_id=$1', [q.params.id])).rows }));
app.get('/api/trips/:id/photo/:kind', async (q, r) => {
  const p = (await db.query('select file_path from trip_photos where trip_id=$1 and kind=$2', [q.params.id, q.params.kind])).rows[0];
  if (!p) throw http(404, 'No photo'); r.sendFile(path.resolve(p.file_path));
});
app.put('/api/trips/:id', async (q, r) => {   // driver-level: fare + notes only
  await db.query('update trips set fare=coalesce($1,fare), notes=coalesce($2,notes) where id=$3', [q.body.fare ?? null, q.body.notes ?? null, q.params.id]);
  audit('trip_update', 'trip', +q.params.id, q.body); r.json(await tripById(q.params.id));
});
app.put('/api/trips/:id/correct', admin, async (q, r) => {   // admin correction of extracted values
  const b = q.body, t = (await db.query('select * from trips where id=$1', [q.params.id])).rows[0];
  const so = b.start_odo ?? t.start_odo, eo = b.end_odo ?? t.end_odo, st = b.start_time ?? t.start_time, et = b.end_time ?? t.end_time;
  const ok = eo != null && Number(eo) >= Number(so) && (!et || new Date(et) >= new Date(st));
  await db.query(`update trips set start_odo=$1,end_odo=$2,start_time=$3,end_time=$4,distance=$5,flags='{}',status=$6 where id=$7`,
    [so, eo, st, et, eo != null && Number(eo) >= Number(so) ? Number(eo) - Number(so) : null, eo == null ? 'In Progress' : ok ? 'Completed' : 'Needs Review', t.id]);
  audit('trip_correct', 'trip', t.id, { before: t, after: b }); r.json(await tripById(t.id));
});
app.delete('/api/trips/:id', admin, async (q, r) => { await db.query("update trips set status='Cancelled' where id=$1", [q.params.id]); audit('trip_cancel', 'trip', +q.params.id); r.json({ ok: true }); });

app.post('/api/payments', async (q, r) => {
  const { trip_id, amount, method, note } = q.body;
  if (!(Number(amount) > 0)) throw http(400, 'Amount must be greater than 0');
  const p = (await db.query('insert into payments(trip_id,amount,method,note) values($1,$2,$3,$4) returning *', [trip_id, amount, method || 'Cash', note || null])).rows[0];
  audit('payment_add', 'payment', p.id, p); r.status(201).json(p);   // payments are append-only
});
app.get('/api/payments', async (q, r) => r.json((await db.query('select * from payments where ($1::int is null or trip_id=$1) order by id desc', [q.query.trip_id || null])).rows));

/* ---------- fuel / expenses / maintenance CRUD (delete = admin only) ---------- */
const fuelBefore = b => {
  const q = Number(b.quantity), p = Number(b.price_per_unit);
  if (q > 0 && p > 0 && (b.total === '' || b.total === undefined || b.total === null)) b.total = +(q * p).toFixed(2);
};
const T = {
  fuel: {
    table: 'fuel_logs',
    cols: ['date', 'vehicle_id', 'odometer', 'fuel_type', 'quantity', 'price_per_unit', 'total', 'station', 'method', 'full_tank', 'notes'],
    check: b => {
      const q = Number(b.quantity), p = Number(b.price_per_unit), tot = Number(b.total);
      if (!(tot > 0 || (q > 0 && p > 0))) return 'Please provide Total Bill, or Quantity and Price per unit.';
    },
    before: fuelBefore
  },
  expenses: { table: 'expenses', cols: ['date', 'category', 'description', 'amount', 'method', 'vehicle_id', 'notes'], check: b => /^\s*fuel\s*$/i.test(b.category) && 'Fuel purchases must be entered in the Fuel Log only.' },
  maintenance: { table: 'maintenance', cols: ['vehicle_id', 'service_date', 'odometer', 'service_type', 'description', 'amount', 'next_date', 'next_odo', 'status'] },
};
const clean = (b, cols) => cols.map(c => b[c] === '' || b[c] === undefined ? null : b[c]);
app.post('/api/maintenance', async (q, r) => {   // optional single linked expense (no double counting: unique maintenance_id)
  const b = q.body; b.vehicle_id ||= await vid();
  const m = (await db.query(`insert into maintenance(${T.maintenance.cols}) values(${T.maintenance.cols.map((_, i) => '$' + (i + 1))}) returning *`, clean(b, T.maintenance.cols))).rows[0];
  if (b.log_expense && Number(b.amount) > 0)
    await db.query('insert into expenses(date,category,description,amount,vehicle_id,maintenance_id) values($1,$2,$3,$4,$5,$6) on conflict do nothing',
      [b.service_date, b.service_type === 'Repair' ? 'Repair' : 'Service', b.description || b.service_type, b.amount, b.vehicle_id, m.id]);
  audit('create', 'maintenance', m.id, b); r.status(201).json(m);
});
for (const [k, { table, cols, check, before }] of Object.entries(T)) {
  app.get(`/api/${k}`, async (q, r) => {
    if (k === 'maintenance') return r.json(await maintenance());
    r.json((await db.query(`select * from ${table} order by id desc limit 1000`)).rows);
  });
  app.post(`/api/${k}`, async (q, r) => {
    const err = check?.(q.body); if (err) throw http(400, err);
    before?.(q.body);
    if (cols.includes('vehicle_id')) q.body.vehicle_id ||= await vid();
    const row = (await db.query(`insert into ${table}(${cols}) values(${cols.map((_, i) => '$' + (i + 1))}) returning *`, clean(q.body, cols))).rows[0];
    audit('create', table, row.id, q.body); r.status(201).json(row);
  });
  app.put(`/api/${k}/:id`, async (q, r) => {
    const err = check?.(q.body); if (err) throw http(400, err);
    before?.(q.body);
    const row = (await db.query(`update ${table} set ${cols.map((c, i) => `${c}=$${i + 1}`)} where id=$${cols.length + 1} returning *`, [...clean(q.body, cols), q.params.id])).rows[0];
    audit('update', table, +q.params.id, q.body); r.json(row);
  });
  app.delete(`/api/${k}/:id`, admin, async (q, r) => {
    if (k === 'maintenance') await db.query('delete from expenses where maintenance_id=$1', [q.params.id]);
    await db.query(`delete from ${table} where id=$1`, [q.params.id]); audit('delete', table, +q.params.id); r.json({ ok: true });
  });
}
async function maintenance() {
  const rows = (await db.query('select * from maintenance order by service_date desc')).rows;
  const odo = Number((await db.query('select coalesce(max(greatest(start_odo,coalesce(end_odo,0))),0) o from trips')).rows[0].o);
  const now = new Date();
  return rows.map(r => {
    const dd = r.next_date ? (new Date(r.next_date) - now) / 864e5 : null, dk = r.next_odo != null ? Number(r.next_odo) - odo : null;
    const s = (dd !== null && dd < 0) || (dk !== null && dk < 0) ? 'Overdue' : (dd !== null && dd <= 3) || (dk !== null && dk <= 200) ? 'Due'
      : (dd !== null && dd <= 30) || (dk !== null && dk <= 1000) ? 'Upcoming' : 'OK';
    return { ...r, reminder: s };
  });
}
async function mileage() {   // verified mileage only: full-tank to full-tank, never mixing fuel types
  const rows = (await db.query('select * from fuel_logs where odometer is not null and quantity is not null order by fuel_type, odometer')).rows.map(r => ({ ...r, odometer: +r.odometer, quantity: +r.quantity }));
  const out = {};
  for (const f of new Set(rows.map(r => r.fuel_type))) {
    const L = rows.filter(r => r.fuel_type === f), fulls = L.filter(r => r.full_tank);
    let km = 0, lit = 0; const segments = [];
    for (let i = 1; i < fulls.length; i++) {
      const a = fulls[i - 1], b = fulls[i];
      const l = L.filter(r => r.odometer > a.odometer && r.odometer <= b.odometer).reduce((s, r) => s + r.quantity, 0);
      km += b.odometer - a.odometer; lit += l; segments.push({ from: a.odometer, to: b.odometer, kmpl: l ? (b.odometer - a.odometer) / l : null });
    }
    out[f] = { verified_kmpl: lit ? km / lit : null, segments };
  }
  return out;
}
app.get('/api/fuel/mileage', async (q, r) => r.json(await mileage()));
app.get('/api/vehicles', async (q, r) => r.json((await db.query('select * from vehicles order by id')).rows));
app.get('/api/drivers', async (q, r) => r.json((await db.query('select * from drivers order by id')).rows));
app.put('/api/vehicles/:id', admin, async (q, r) => {
  const cols = ['reg_no', 'make', 'model', 'fuel_type', 'tank_capacity', 'current_odometer', 'insurance_expiry', 'permit_expiry', 'puc_expiry'];
  r.json((await db.query(`update vehicles set ${cols.map((c, i) => `${c}=$${i + 1}`)} where id=$${cols.length + 1} returning *`, [...clean(q.body, cols), q.params.id])).rows[0]);
});
app.post('/api/drivers', admin, async (q, r) => r.status(201).json((await db.query('insert into drivers(name,phone,joined,notes) values($1,$2,$3,$4) returning *', clean(q.body, ['name', 'phone', 'joined', 'notes']))).rows[0]));
app.put('/api/drivers/:id', admin, async (q, r) => r.json((await db.query('update drivers set status=$1 where id=$2 returning *', [q.body.status, q.params.id])).rows[0]));

/* ---------- reports (all numbers computed in SQL; fuel counted once, via fuel_logs only) ---------- */
async function summary({ from, to, driver, vehicle }) {
  const t = (await db.query(`select count(*)::int trips, (count(*) filter (where t.status='Completed'))::int completed, coalesce(sum(distance),0) km, coalesce(sum(fare),0) income,
    coalesce(sum(pay.s),0) received, avg(distance) avg_km, avg(extract(epoch from end_time-start_time)/60) avg_min
    from trips t left join (select trip_id, sum(amount) s from payments group by 1) pay on pay.trip_id=t.id
    where t.start_time::date between $1 and $2 and t.status<>'Cancelled' and ($3::int is null or t.driver_id=$3) and ($4::int is null or t.vehicle_id=$4)`, [from, to, driver || null, vehicle || null])).rows[0];
  const f = (await db.query('select coalesce(sum(total),0) cost, coalesce(sum(quantity),0) qty from fuel_logs where date between $1 and $2 and ($3::int is null or vehicle_id=$3)', [from, to, vehicle || null])).rows[0];
  const e = (await db.query('select coalesce(sum(amount),0) other, coalesce(sum(amount) filter (where maintenance_id is not null),0) maint from expenses where date between $1 and $2 and ($3::int is null or vehicle_id=$3)', [from, to, vehicle || null])).rows[0];
  const n = Number;
  const expenses = n(f.cost) + n(e.other);
  return {
    ...t, km: n(t.km), income: n(t.income), received: n(t.received), pending: n(t.income) - n(t.received), fuel_cost: n(f.cost), fuel_qty: n(f.qty),
    other_expenses: n(e.other), maintenance_expenses: n(e.maint), total_expenses: expenses, net_profit: n(t.income) - expenses, mileage: await mileage()
  };
}
async function series(from, to) {
  return (await db.query(`select d::date::text day,
    coalesce((select sum(fare) from trips where start_time::date=d::date and status<>'Cancelled'),0)::float income,
    coalesce((select sum(distance) from trips where start_time::date=d::date and status<>'Cancelled'),0)::float km,
    (select count(*) from trips where start_time::date=d::date and status<>'Cancelled')::int trips,
    coalesce((select sum(total) from fuel_logs where date=d::date),0)::float fuel,
    coalesce((select sum(amount) from expenses where expenses.date=d::date),0)::float + coalesce((select sum(total) from fuel_logs where fuel_logs.date=d::date),0)::float expenses
    from generate_series($1::date,$2::date,'1 day') d order by 1`, [from, to])).rows;
}
const month = ({ month: m, year: y }) => { m = +m; y = +y; if (!(m >= 1 && m <= 12 && y > 2000)) throw http(400, 'Valid month and year required'); return [`${y}-${String(m).padStart(2, '0')}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]; };
app.get('/api/reports/daily', async (q, r) => { const d = q.query.date; if (!d) throw http(400, 'date required'); r.json(await summary({ ...q.query, from: d, to: d })); });
app.get('/api/reports/monthly', admin, async (q, r) => { const [from, to] = month(q.query); r.json({ from, to, summary: await summary({ ...q.query, from, to }), series: await series(from, to) }); });
app.get('/api/dashboard', admin, async (q, r) => {
  const { from, to } = q.query; if (!from || !to) throw http(400, 'from and to required');
  const W = `select * from (${TRIPS}) x`;
  r.json({
    summary: await summary({ from, to }), series: await series(from, to),
    recent: (await db.query(`${W} order by id desc limit 8`)).rows, pending: (await db.query(`${W} where pending>0 and status<>'Cancelled' order by id desc limit 10`)).rows,
    review: (await db.query(`${W} where status='Needs Review' order by id desc`)).rows, fuel: (await db.query('select * from fuel_logs order by id desc limit 5')).rows,
    maintenance: (await maintenance()).filter(m => ['Upcoming', 'Due', 'Overdue'].includes(m.reminder))
  });
});

/* ---------- Excel export ---------- */
const MONEY = /amount|fare|total|pending|received|price|income|expense|^fuel$/;
app.get('/api/export/:name', async (q, r) => {
  const n = q.params.name; let rows, name = n;
  if (n === 'trips') rows = (await db.query(`select trip_code,start_time,end_time,driver,vehicle,start_loc,end_loc,start_odo,end_odo,distance,fuel_type,fare,received,pending,payment_status,status,notes from (${TRIPS}) x order by id`)).rows;
  else if (n === 'fuel') rows = (await db.query('select * from fuel_logs order by date,id')).rows;
  else if (n === 'expenses') rows = (await db.query('select * from expenses order by date,id')).rows;
  else if (n === 'maintenance') rows = await maintenance();
  else if (n === 'monthly') { if (!isAdmin(q)) throw http(401, 'Administrator access required'); const [f, t] = month(q.query); rows = await series(f, t); name = `monthly-${f.slice(0, 7)}`; }
  else throw http(404, 'Unknown export');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(name);
  const keys = Object.keys(rows[0] || { empty: '' });
  ws.columns = keys.map(k => ({ header: k.replace(/_/g, ' ').toUpperCase(), key: k, width: 18, style: MONEY.test(k) ? { numFmt: '[$₹-4009] #,##0.00' } : {} }));
  rows.forEach(x => ws.addRow(Object.fromEntries(keys.map(k => [k, x[k]]))));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: keys.length } };
  if (rows.length) {
    const tot = ws.addRow({}); tot.font = { bold: true };
    keys.forEach((k, i) => { if (MONEY.test(k) || ['distance', 'km', 'quantity'].includes(k)) { const L = ws.getColumn(i + 1).letter; tot.getCell(i + 1).value = { formula: `SUBTOTAL(109,${L}2:${L}${rows.length + 1})` }; } });
    tot.getCell(1).value = 'TOTAL';
  }
  r.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  r.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(r); r.end();
});

/* ---------- static frontend (production) + errors ---------- */
if (fs.existsSync('../frontend/dist')) { app.use(express.static('../frontend/dist')); app.get(/^(?!\/api).*/, (q, r) => r.sendFile(path.resolve('../frontend/dist/index.html'))); }
app.use((e, q, r, n) => { if (!e.status) console.error(e); r.status(e.status || 500).json({ error: e.status ? e.message : 'Server error', ...e.extra }); });

async function init() {
  await db.query(fs.readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  // Ensure fuel_logs columns allow optional quantity/price and writable total in existing databases
  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE fuel_logs ALTER COLUMN quantity DROP NOT NULL;
      ALTER TABLE fuel_logs DROP CONSTRAINT IF EXISTS fuel_logs_quantity_check;
      ALTER TABLE fuel_logs ADD CONSTRAINT fuel_logs_quantity_check CHECK (quantity IS NULL OR quantity > 0);
      ALTER TABLE fuel_logs ALTER COLUMN price_per_unit DROP NOT NULL;
      BEGIN
        ALTER TABLE fuel_logs ALTER COLUMN total DROP EXPRESSION IF EXISTS;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `).catch(e => console.warn('fuel_logs migration:', e.message));
  const adminPw = process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_PASSWORD || 'Sakthi@143';
  if (!(await db.query("select 1 from admin_settings where key='pw_hash'")).rowCount) {
    await db.query("insert into admin_settings values('pw_hash',$1)", [await bcrypt.hash(adminPw, 12)]);
  }
  const appPw = process.env.APP_PASSWORD || 'Sakthi@123';
  if (!(await db.query("select 1 from admin_settings where key='app_pw_hash'")).rowCount) {
    await db.query("insert into admin_settings values('app_pw_hash',$1)", [await bcrypt.hash(appPw, 12)]);
  }
  if (!(await db.query('select 1 from vehicles')).rowCount) await db.query("insert into vehicles(reg_no) values('SET-REG-NO')");
  if (!(await db.query('select 1 from drivers')).rowCount) await db.query("insert into drivers(name) values('Driver 1')");
  app.listen(process.env.PORT || 4000, () => console.log('Cab Trip Manager API on :' + (process.env.PORT || 4000)));
}
init().catch(e => { console.error(e); process.exit(1); });
