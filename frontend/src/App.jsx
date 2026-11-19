import { useState, useEffect, useRef } from 'react';
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');
const fdt = d => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const dur = m => m == null ? '—' : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
let TOKEN = sessionStorage.getItem('adm') || '';
const setTok = t => { TOKEN = t; t ? sessionStorage.setItem('adm', t) : sessionStorage.removeItem('adm'); };

async function api(p, o = {}) {
  const isForm = o.body instanceof FormData;
  const r = await fetch('/api' + p, { ...o, headers: { ...(o.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, body: o.body && !isForm ? JSON.stringify(o.body) : o.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status, data: j });
  return j;
}
async function download(p, name) {
  const r = await fetch('/api' + p, { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
  if (!r.ok) return alert('Export failed');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
}

function Cards({ s }) {
  const m = Object.values(s.mileage || {}).map(x => x.verified_kmpl).filter(Boolean)[0];
  const C = [['Trips', s.trips, 'blue'], ['Completed', s.completed], ['Distance', `${s.km} km`], ['Income', inr(s.income), 'green'], ['Received', inr(s.received), 'green'],
    ['Pending', inr(s.pending), 'orange'], ['Fuel cost', inr(s.fuel_cost), 'red'], ['Fuel qty', s.fuel_qty], ['Other expenses', inr(s.other_expenses), 'red'],
    ['Total expenses', inr(s.total_expenses), 'red'], ['Net profit', inr(s.net_profit), s.net_profit >= 0 ? 'green' : 'red'],
    ['Avg trip km', s.avg_km ? Number(s.avg_km).toFixed(1) : '—'], ['Avg duration', dur(s.avg_min)], ['Verified mileage', m ? m.toFixed(1) + ' km/unit' : 'n/a']];
  return <div className="grid">{C.map(([l, v, c]) => <div className="stat" key={l}>{l}<b className={c}>{v}</b></div>)}</div>;
}
function Bars({ title, data, k, money }) {
  const max = Math.max(1, ...data.map(d => d[k]));
  return <div className="card"><b>{title}</b>{data.map(d => <div className="row" key={d.day}><span>{d.day.slice(5)}</span><div style={{ flex: 1 }}><div className="bar" style={{ width: (d[k] / max * 100) + '%' }} /></div><span>{money ? inr(d[k]) : d[k]}</span></div>)}</div>;
}


  async function withLocation(kind, file, clientTime) {
    setB('Getting your location…'); setM('');
    const pos = await getPos();
    if (!pos) { setB(false); setNoLoc({ kind, file, clientTime }); return; }
    send(kind, file, { ...pos, client_time: clientTime });
  }
  const pick = kind => e => { const f = e.target.files[0]; e.target.value = ''; if (f) withLocation(kind, f, new Date().toISOString()); };
  const openPicker = ref => { navigator.geolocation?.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true, timeout: 15000 }); ref.current.click(); };
  return <>
    <div className="big">
      <button className="s" disabled={!!busy || !!active} onClick={() => openPicker(sRef)}>▶ START TRIP</button>
      <button className="e" disabled={!!busy || !active} onClick={() => openPicker(eRef)}>■ END TRIP</button>
      <input ref={sRef} type="file" accept="image/*" capture="environment" hidden onChange={pick('start')} />
      <input ref={eRef} type="file" accept="image/*" capture="environment" hidden onChange={pick('end')} />
    </div>
    {busy && <p>{busy}</p>}
    {msg && <p className={/STARTED|COMPLETED/.test(msg) ? 'ok' : 'err'}><b>{msg}</b></p>}
    {active && <div className="card"><b className="orange">TRIP IN PROGRESS</b><br />Started: {fdt(active.start_time)} · Odometer: {active.start_odo} km<br />From: {active.start_loc || 'location not recorded'}</div>}
    {noLoc && <div className="card"><b>Location is off or blocked.</b> Turn on location for this site (allow it in the browser prompt or site settings), then retry.
      <p><button className="b" onClick={() => withLocation(noLoc.kind, noLoc.file, noLoc.clientTime)}>Retry location</button>{' '}
        <button className="b" onClick={() => send(noLoc.kind, noLoc.file, { no_location: '1', client_time: noLoc.clientTime })}>Continue without location</button>{' '}
        <button className="b" onClick={() => setNoLoc(null)}>Cancel</button></p></div>}
    {rev && <div className="card"><b>Please confirm</b>
      <p><img alt="uploaded" src={URL.createObjectURL(rev.file)} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }} /></p>
      <form className="f" onSubmit={e => { e.preventDefault(); send(rev.kind, rev.file, { ...rev.extra, ...vals }); }}>
        {rev.need.includes('odometer') && <label>Odometer (km) — check against the photo<input required type="number" value={vals.odometer || ''} onChange={e => setV({ ...vals, odometer: e.target.value })} /></label>}
        {rev.need.includes('driver') && <label>Driver<select required onChange={e => setV({ ...vals, driver_id: e.target.value })}><option value="">Select</option>{drivers.filter(d => d.status === 'Active').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <button className="b">Confirm &amp; save</button><button type="button" className="b" onClick={() => setRev(null)}>Cancel</button></form></div>}
    <div className="card scroll"><table><thead><tr><th>Trip</th><th>Date</th><th>Driver</th><th>Start → End</th><th>Odometer</th><th>km</th><th>Duration</th><th>Fare</th><th>Received</th><th>Pending</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>
      {trips.map(t => <><tr key={t.id}><td>{t.trip_code}</td><td>{t.start_time && new Date(t.start_time).toLocaleDateString('en-IN')}</td><td>{t.driver}</td>
        <td>{t.start_loc?.split(',')[0] || '—'} → {t.end_loc?.split(',')[0] || '—'}</td><td>{t.start_odo}–{t.end_odo ?? ''}</td><td>{t.distance ?? '—'}</td><td>{dur(t.duration_min)}</td>
        <td>{inr(t.fare)}</td><td>{inr(t.received)}</td><td className="orange">{inr(t.pending)}</td><td>{t.payment_status}</td>
        <td><span className="tag" title={(t.flags || []).join(', ')}>{t.status}</span></td><td><button className="b" onClick={() => setOpen(open === t.id ? null : t.id)}>₹ / details</button></td></tr>
        {open === t.id && <tr><td colSpan="13"><Pay t={t} done={() => { load(); }} /></td></tr>}</>)}</tbody></table></div>
    <button className="b" onClick={() => download('/export/trips', 'trips.xlsx')}>Export Excel</button>
  </>;
function TripLog() {
  const [trips, setT] = useState([]), [drivers, setD] = useState([]), [msg, setM] = useState(''), [busy, setB] = useState(false), [rev, setRev] = useState(null), [noLoc, setNoLoc] = useState(null), [open, setOpen] = useState(null), [vals, setV] = useState({}), [pickFor, setPickFor] = useState(null), [fare, setFare] = useState(null);
  const camRef = useRef(), fileRef = useRef();
  const load = () => { api('/trips').then(setT); api('/drivers').then(setD); };
  useEffect(load, []);
  const active = trips.find(t => t.status === 'In Progress');
  const getPos = () => new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(
    p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
    () => res(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }) : res(null));
  async function send(kind, file, extra = {}) {
    setB('Reading the odometer…'); setM(''); setNoLoc(null);
    try {
      const fd = new FormData(); fd.append('photo', file);
      Object.entries(extra).forEach(([k, v]) => v !== undefined && v !== '' && fd.append(k, v));
      const t = await api('/trips/' + kind, { method: 'POST', body: fd });
      setRev(null); load();
      if (kind === 'start') setM('TRIP STARTED');
      else setFare({ trip: t, fare: '', recv: '', method: 'Cash', notes: '', err: '' });
    } catch (e) {
      if (e.status === 422 && e.data.need) { setRev({ kind, file, extra, ...e.data }); setV({ odometer: e.data.extracted?.odometer?.value || '' }); }
      else setM(e.message);
    }
    setB(false);
  }
  async function withLocation(kind, file, clientTime) {
    setB('Getting your location…'); setM('');
    const pos = await getPos();
    if (!pos) { setB(false); setNoLoc({ kind, file, clientTime }); return; }
    send(kind, file, { ...pos, client_time: clientTime });
  }
  const choose = kind => { navigator.geolocation?.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true, timeout: 15000 }); setPickFor(kind); setFare(null); setM(''); };
  const pick = e => { const f = e.target.files[0]; e.target.value = ''; const kind = pickFor; setPickFor(null); if (f && kind) withLocation(kind, f, new Date().toISOString()); };
  async function saveFare(e) {
    e.preventDefault();
    const f = fare, fr = Number(f.fare), rc = Number(f.recv || 0);
    if (rc > fr) return setFare({ ...f, err: 'Amount received cannot be more than the fare.' });
    try {
      await api('/trips/' + f.trip.id, { method: 'PUT', body: { fare: fr, notes: f.notes || null } });
      if (rc > 0) await api('/payments', { method: 'POST', body: { trip_id: f.trip.id, amount: rc, method: f.method } });
      setFare(null); setM('FARE SAVED'); load();
    } catch (x) { setFare({ ...f, err: x.message }); }
  }
  return <>
    <div className="big">
      <button className="s" disabled={!!busy || !!active} onClick={() => choose('start')}>▶ START TRIP</button>
      <button className="e" disabled={!!busy || !active} onClick={() => choose('end')}>■ END TRIP</button>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
    </div>
    {pickFor && !busy && <div className="card"><b>{pickFor === 'start' ? 'Start trip' : 'End trip'} — photo of the odometer</b>
      <p><button className="b" onClick={() => camRef.current.click()}>📷 Take photo</button>{' '}
        <button className="b" onClick={() => fileRef.current.click()}>🖼 Upload photo</button>{' '}
        <button className="b" onClick={() => setPickFor(null)}>Cancel</button></p></div>}
    {busy && <p>{busy}</p>}
    {msg && <p className={/STARTED|SAVED/.test(msg) ? 'ok' : 'err'}><b>{msg}</b></p>}
    {fare && <div className="card"><b className="green">TRIP COMPLETED</b><br />Distance: {fare.trip.distance ?? '—'} km · Duration: {dur(fare.trip.duration_min)}
      {fare.trip.status === 'Needs Review' && <div className="orange">Marked for review: {(fare.trip.flags || []).join(', ')}</div>}
      <p><b>Enter the fare details</b></p>
      <form className="f" onSubmit={saveFare}>
        <label>Trip fare (₹)<input required type="number" min="0" step="any" value={fare.fare} onChange={e => setFare({ ...fare, fare: e.target.value })} /></label>
        <label>Amount received (₹)<input type="number" min="0" step="any" value={fare.recv} onChange={e => setFare({ ...fare, recv: e.target.value })} /></label>
        <label>Payment method<select value={fare.method} onChange={e => setFare({ ...fare, method: e.target.value })}>{['Cash', 'UPI', 'Bank Transfer', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Notes (optional)<input value={fare.notes} onChange={e => setFare({ ...fare, notes: e.target.value })} /></label>
        <button className="b">Save</button><button type="button" className="b" onClick={() => setFare(null)}>Skip for now</button></form>
      {fare.err && <p className="err">{fare.err}</p>}</div>}
    {active && <div className="card"><b className="orange">TRIP IN PROGRESS</b><br />Started: {fdt(active.start_time)} · Odometer: {active.start_odo} km<br />From: {active.start_loc || 'location not recorded'}</div>}
    {noLoc && <div className="card"><b>Location is off or blocked.</b> Turn on location for this site (allow it in the browser prompt or site settings), then retry.
      <p><button className="b" onClick={() => withLocation(noLoc.kind, noLoc.file, noLoc.clientTime)}>Retry location</button>{' '}
        <button className="b" onClick={() => send(noLoc.kind, noLoc.file, { no_location: '1', client_time: noLoc.clientTime })}>Continue without location</button>{' '}
        <button className="b" onClick={() => setNoLoc(null)}>Cancel</button></p></div>}
    {rev && <div className="card"><b>Please confirm</b>
      <p><img alt="uploaded" src={URL.createObjectURL(rev.file)} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }} /></p>
      <form className="f" onSubmit={e => { e.preventDefault(); send(rev.kind, rev.file, { ...rev.extra, ...vals }); }}>
        {rev.need.includes('odometer') && <label>Odometer (km) — check against the photo<input required type="number" value={vals.odometer || ''} onChange={e => setV({ ...vals, odometer: e.target.value })} /></label>}
        {rev.need.includes('driver') && <label>Driver<select required onChange={e => setV({ ...vals, driver_id: e.target.value })}><option value="">Select</option>{drivers.filter(d => d.status === 'Active').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <button className="b">Confirm &amp; save</button><button type="button" className="b" onClick={() => setRev(null)}>Cancel</button></form></div>}
    <div className="card scroll"><table><thead><tr><th>Trip</th><th>Date</th><th>Driver</th><th>Start → End</th><th>Odometer</th><th>km</th><th>Duration</th><th>Fare</th><th>Received</th><th>Pending</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>
      {trips.map(t => <><tr key={t.id}><td>{t.trip_code}</td><td>{t.start_time && new Date(t.start_time).toLocaleDateString('en-IN')}</td><td>{t.driver}</td>
        <td>{t.start_loc?.split(',')[0] || '—'} → {t.end_loc?.split(',')[0] || '—'}</td><td>{t.start_odo}–{t.end_odo ?? ''}</td><td>{t.distance ?? '—'}</td><td>{dur(t.duration_min)}</td>
        <td>{inr(t.fare)}</td><td>{inr(t.received)}</td><td className="orange">{inr(t.pending)}</td><td>{t.payment_status}</td>
        <td><span className="tag" title={(t.flags || []).join(', ')}>{t.status}</span></td><td><button className="b" onClick={() => setOpen(open === t.id ? null : t.id)}>₹ / details</button></td></tr>
        {open === t.id && <tr><td colSpan="13"><Pay t={t} done={() => { load(); }} /></td></tr>}</>)}</tbody></table></div>
    <button className="b" onClick={() => download('/export/trips', 'trips.xlsx')}>Export Excel</button>
  </>;
}

function Pay({ t, done }) {
  const [fare, setF] = useState(t.fare), [amt, setA] = useState(''), [m, setM] = useState('Cash'), [err, setE] = useState('');
  const run = async fn => { setE(''); try { await fn(); done(); } catch (x) { setE(x.message); } };
  return <div><form className="f" onSubmit={e => { e.preventDefault(); run(() => api('/trips/' + t.id, { method: 'PUT', body: { fare } })); }}>
    <label>Trip fare (₹)<input type="number" value={fare} onChange={e => setF(e.target.value)} /></label><button className="b">Save fare</button></form>
    <form className="f" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); run(() => api('/payments', { method: 'POST', body: { trip_id: t.id, amount: amt, method: m } })); setA(''); }}>
      <label>Payment received (₹)<input type="number" required value={amt} onChange={e => setA(e.target.value)} /></label>
      <label>Method<select value={m} onChange={e => setM(e.target.value)}>{['Cash', 'UPI', 'Bank Transfer', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label><button className="b">Add payment</button></form>
    <p>{t.flags?.length ? 'Flags: ' + t.flags.join(', ') + ' · ' : ''}<a href={`/api/trips/${t.id}/photo/start`} target="_blank">Start photo</a> · <a href={`/api/trips/${t.id}/photo/end`} target="_blank">End photo</a></p>
    {err && <p className="err">{err}</p>}</div>;
}

function Crud({ path, fields, cols, exportName, extra }) {
  const [rows, setR] = useState([]), [f, setF] = useState({}), [err, setE] = useState('');
  const load = () => api(path).then(setR); useEffect(() => { load(); }, [path]);
  const save = async e => { e.preventDefault(); setE(''); try { await api(path, { method: 'POST', body: f }); setF({}); load(); } catch (x) { setE(x.message); } };
  const del = async id => { if (confirm('Delete this record?')) try { await api(`${path}/${id}`, { method: 'DELETE' }); load(); } catch (x) { setE(x.message); } };
  return <>
    <form className="f card" onSubmit={save}>{fields.map(([k, l, t, o]) => <label key={k}>{l}
      {t === 'select' ? <select required value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })}><option value="">Select</option>{o.map(x => <option key={x}>{x}</option>)}</select>
        : t === 'check' ? <input type="checkbox" checked={!!f[k]} onChange={e => setF({ ...f, [k]: e.target.checked })} />
        : <input type={t || 'text'} step="any" list={o && k} required={!/note|desc|station|next|odometer|method/.test(k)} value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })} />}
      {o && t !== 'select' && <datalist id={k}>{o.map(x => <option key={x} value={x} />)}</datalist>}</label>)}
      <button className="b">Add</button>{extra && <label><input type="checkbox" checked={!!f.log_expense} onChange={e => setF({ ...f, log_expense: e.target.checked })} />Also record as expense</label>}</form>
    {err && <p className="err">{err}</p>}
    <div className="card scroll"><table><thead><tr>{cols.map(c => <th key={c}>{c.replace(/_/g, ' ')}</th>)}<th></th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}>{cols.map(c => <td key={c} className={c === 'reminder' && r[c] !== 'OK' ? 'orange' : ''}>{/amount|total|price/.test(c) ? inr(r[c]) : typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : '') : String(r[c] ?? '').slice(0, 10) === r[c]?.slice?.(0, 10) && /date|^date$/.test(c) ? String(r[c]).slice(0, 10) : r[c] ?? ''}</td>)}
        <td>{TOKEN && <button className="b" onClick={() => del(r.id)}>Delete</button>}</td></tr>)}</tbody></table></div>
    <button className="b" onClick={() => download('/export/' + exportName, exportName + '.xlsx')}>Export Excel</button></>;
}
const Fuel = () => <><Crud path="/fuel" exportName="fuel" cols={['id', 'date', 'odometer', 'fuel_type', 'quantity', 'price_per_unit', 'total', 'station', 'method', 'full_tank']}
  fields={[['date', 'Date', 'date'], ['odometer', 'Odometer', 'number'], ['fuel_type', 'Fuel', 'select', ['Petrol', 'Diesel', 'CNG', 'Other']], ['quantity', 'Quantity', 'number'], ['price_per_unit', 'Price/unit ₹', 'number'], ['station', 'Station'], ['method', 'Payment', 'text', ['Cash', 'UPI', 'Card']], ['full_tank', 'Full tank', 'check']]} /><Mileage /></>;
function Mileage() { const [m, setM] = useState({}); useEffect(() => { api('/fuel/mileage').then(setM); }, []);
  return <div className="card"><b>Verified mileage (full-tank to full-tank)</b>{Object.entries(m).map(([k, v]) => <p key={k}>{k}: {v.verified_kmpl ? v.verified_kmpl.toFixed(2) + ' km per unit' : 'needs two full-tank entries with odometer'}</p>)}</div>; }
const Expenses = () => <Crud path="/expenses" exportName="expenses" cols={['id', 'date', 'category', 'description', 'amount', 'method', 'notes']}
  fields={[['date', 'Date', 'date'], ['category', 'Category', 'text', ['Toll', 'Parking', 'Driver Allowance', 'Cleaning', 'Repair', 'Insurance', 'Permit', 'Service', 'Miscellaneous']], ['description', 'Description'], ['amount', 'Amount ₹', 'number'], ['method', 'Payment', 'text', ['Cash', 'UPI', 'Card']]]} />;
const Maint = () => <Crud path="/maintenance" exportName="maintenance" extra cols={['id', 'service_date', 'odometer', 'service_type', 'description', 'amount', 'next_date', 'next_odo', 'reminder']}
  fields={[['service_date', 'Service date', 'date'], ['odometer', 'Odometer', 'number'], ['service_type', 'Type', 'select', ['Engine Oil', 'Oil Filter', 'Air Filter', 'Tyres', 'Brake', 'Battery', 'General Service', 'Repair', 'Insurance Renewal', 'Other']], ['description', 'Description'], ['amount', 'Amount ₹', 'number'], ['next_date', 'Next service date', 'date'], ['next_odo', 'Next service km', 'number']]} />;

function Daily() {
  const [date, setD] = useState(today()), [driver, setDr] = useState(''), [drivers, setDs] = useState([]), [s, setS] = useState(null);
  useEffect(() => { api('/drivers').then(setDs); }, []);
  useEffect(() => { api(`/reports/daily?date=${date}${driver ? '&driver=' + driver : ''}`).then(setS); }, [date, driver]);
  return <><form className="f card"><label>Date<input type="date" value={date} onChange={e => setD(e.target.value)} /></label>
    <label>Driver<select value={driver} onChange={e => setDr(e.target.value)}><option value="">All</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label></form>{s && <Cards s={s} />}</>;
}
function Gate({ admin, setAdmin, children }) {
  const [pw, setPw] = useState(''), [err, setE] = useState('');
  if (admin) return children;
  return <form className="card" style={{ maxWidth: 360 }} onSubmit={async e => { e.preventDefault(); try { setTok((await api('/admin/verify', { method: 'POST', body: { password: pw } })).token); setAdmin(true); } catch (x) { setE(x.message); } }}>
    <b>Administrator Access Required</b><p><input type="password" autoFocus placeholder="Administrator password" value={pw} onChange={e => setPw(e.target.value)} /> <button className="b">Unlock</button></p>{err && <p className="err">{err}</p>}</form>;
}
function Monthly() {
  const d = new Date(), [m, setMo] = useState(d.getMonth() + 1), [y, setY] = useState(d.getFullYear()), [r, setR] = useState(null), [err, setE] = useState('');
  useEffect(() => { api(`/reports/monthly?month=${m}&year=${y}`).then(setR).catch(x => setE(x.message)); }, [m, y]);
  return <><form className="f card"><label>Month<input type="number" min="1" max="12" value={m} onChange={e => setMo(e.target.value)} /></label><label>Year<input type="number" value={y} onChange={e => setY(e.target.value)} /></label>
    <button type="button" className="b" onClick={() => download(`/export/monthly?month=${m}&year=${y}`, `monthly-${y}-${m}.xlsx`)}>Export Excel</button></form>{err && <p className="err">{err}</p>}
    {r && <><Cards s={r.summary} /><Bars title="Daily income" data={r.series} k="income" money /><Bars title="Daily expenses (fuel + other)" data={r.series} k="expenses" money /><Bars title="Fuel expenses" data={r.series} k="fuel" money /><Bars title="Distance (km)" data={r.series} k="km" /></>}</>;
}
function Dashboard() {
  const [range, setRg] = useState('month'), [c, setC] = useState({ from: today(), to: today() }), [d, setDat] = useState(null);
  const span = () => { const n = new Date(), iso = x => x.toLocaleDateString('en-CA'), t = iso(n);
    if (range === 'today') return [t, t]; if (range === 'yesterday') { const y = iso(new Date(n - 864e5)); return [y, y]; }
    if (range === 'week') return [iso(new Date(n - 6 * 864e5)), t]; if (range === 'month') return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), t]; return [c.from, c.to]; };
  useEffect(() => { const [from, to] = span(); api(`/dashboard?from=${from}&to=${to}`).then(setDat); }, [range, c]);
  return <><div className="card f">{['today', 'yesterday', 'week', 'month', 'custom'].map(x => <button key={x} className="b" style={{ opacity: range === x ? 1 : .6 }} onClick={() => setRg(x)}>{x}</button>)}
    {range === 'custom' && <><input type="date" value={c.from} onChange={e => setC({ ...c, from: e.target.value })} /><input type="date" value={c.to} onChange={e => setC({ ...c, to: e.target.value })} /></>}</div>
    {d && <><Cards s={d.summary} /><Bars title="Income" data={d.series} k="income" money /><Bars title="Expenses" data={d.series} k="expenses" money /><Bars title="Trips per day" data={d.series} k="trips" />
      <List title="Pending payments" rows={d.pending} f={t => `${t.trip_code} · ${inr(t.pending)}`} /><List title="Trips needing review" rows={d.review} f={t => `${t.trip_code} · ${(t.flags || []).join(', ')}`} />
      <List title="Maintenance alerts" rows={d.maintenance} f={m => `${m.service_type} · ${m.reminder}`} /><List title="Recent fuel" rows={d.fuel} f={x => `${String(x.date).slice(0, 10)} · ${x.quantity} · ${inr(x.total)}`} /></>}</>;
}
const List = ({ title, rows, f }) => <div className="card"><b>{title}</b>{rows.length ? rows.map((r, i) => <div key={i}>{f(r)}</div>) : <div>None</div>}</div>;

function Settings() {
  const [v, setV] = useState(null), [drivers, setDs] = useState([]), [nd, setNd] = useState(''), [pw, setPw] = useState({}), [msg, setM] = useState('');
  const load = () => { api('/vehicles').then(x => setV(x[0])); api('/drivers').then(setDs); }; useEffect(load, []);
  const run = async fn => { try { await fn(); setM('Saved'); load(); } catch (x) { setM(x.message); } };
  const F = [['reg_no', 'Registration'], ['make', 'Make'], ['model', 'Model'], ['fuel_type', 'Fuel type'], ['tank_capacity', 'Tank capacity'], ['insurance_expiry', 'Insurance expiry', 'date'], ['permit_expiry', 'Permit expiry', 'date'], ['puc_expiry', 'Pollution expiry', 'date']];
  return <>{msg && <p>{msg}</p>}{v && <form className="f card" onSubmit={e => { e.preventDefault(); run(() => api('/vehicles/' + v.id, { method: 'PUT', body: v })); }}>{F.map(([k, l, t]) => <label key={k}>{l}<input type={t || 'text'} value={String(v[k] ?? '').slice(0, t === 'date' ? 10 : 99)} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>)}<button className="b">Save vehicle</button></form>}
    <div className="card"><b>Drivers</b>{drivers.map(d => <div key={d.id}>{d.name} · {d.status} <button className="b" onClick={() => run(() => api('/drivers/' + d.id, { method: 'PUT', body: { status: d.status === 'Active' ? 'Inactive' : 'Active' } }))}>Toggle</button></div>)}
      <form className="f" onSubmit={e => { e.preventDefault(); run(() => api('/drivers', { method: 'POST', body: { name: nd } })); setNd(''); }}><input required placeholder="New driver name" value={nd} onChange={e => setNd(e.target.value)} /><button className="b">Add driver</button></form></div>
    <form className="f card" onSubmit={e => { e.preventDefault(); run(() => api('/admin/change-password', { method: 'POST', body: pw })); }}>
      <label>Current password<input type="password" onChange={e => setPw({ ...pw, current: e.target.value })} /></label><label>New password (8+)<input type="password" onChange={e => setPw({ ...pw, next: e.target.value })} /></label><button className="b">Change password</button></form></>;
}

const TABS = [['Trip Log', TripLog], ['Fuel Log', Fuel], ['Daily Report', Daily], ['Monthly Report', Monthly, 1], ['Dashboard', Dashboard, 1], ['Expense Log', Expenses], ['Maintenance', Maint], ['Settings', Settings, 1]];
export default function App() {
  const [tab, setTab] = useState(0), [admin, setAdmin] = useState(!!TOKEN), last = useRef(Date.now()), idle = useRef(15);
  const lock = () => { api('/admin/logout', { method: 'POST' }).catch(() => {}); setTok(''); setAdmin(false); };
  useEffect(() => {
    api('/config').then(c => idle.current = c.idleMinutes);
    const bump = () => last.current = Date.now(); ['click', 'keydown', 'touchstart'].forEach(e => addEventListener(e, bump));
    const t = setInterval(async () => { if (!TOKEN) return; if (Date.now() - last.current > idle.current * 60000) lock(); else try { setTok((await api('/admin/ping', { method: 'POST' })).token); } catch { lock(); } }, 30000);
    return () => clearInterval(t);
  }, []);
  const [name, Page, prot] = TABS[tab];
  return <div className="app"><nav className="nav"><h1>🚖 Cab Trip Manager</h1>
    {TABS.map(([n, , p], i) => <button key={n} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{n}{p ? ' 🔒' : ''}</button>)}{admin && <button onClick={lock}>Lock admin</button>}</nav>
    <main className="main"><h2>{name}</h2>{prot ? <Gate admin={admin} setAdmin={setAdmin}><Page /></Gate> : <Page />}</main></div>;
}
