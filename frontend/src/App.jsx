import React, { useState, useEffect, useRef } from 'react';
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');
const fdt = d => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const dur = m => m == null ? '—' : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
let APP_TOKEN = localStorage.getItem('app_tok') || '';
const setAppTok = t => { APP_TOKEN = t; t ? localStorage.setItem('app_tok', t) : localStorage.removeItem('app_tok'); };
let TOKEN = sessionStorage.getItem('adm') || '';
const setTok = t => { TOKEN = t; t ? sessionStorage.setItem('adm', t) : sessionStorage.removeItem('adm'); };

async function api(p, o = {}) {
  const isForm = o.body instanceof FormData;
  const headers = {
    ...(o.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : (APP_TOKEN ? { 'X-App-Token': APP_TOKEN } : {}))
  };
  const r = await fetch('/api' + p, { ...o, headers, body: o.body && !isForm ? JSON.stringify(o.body) : o.body });
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
  const C = [
    ['Trips', s.trips, 'blue', '🚗'],
    ['Completed', s.completed, '', '✅'],
    ['Distance', `${s.km} km`, '', '📍'],
    ['Income', inr(s.income), 'green', '💵'],
    ['Received', inr(s.received), 'green', '📥'],
    ['Pending', inr(s.pending), 'orange', '⏳'],
    ['Fuel cost', inr(s.fuel_cost), 'red', '⛽'],
    ['Fuel qty', s.fuel_qty, '', '🛢️'],
    ['Other expenses', inr(s.other_expenses), 'red', '💳'],
    ['Total expenses', inr(s.total_expenses), 'red', '📉'],
    ['Net profit', inr(s.net_profit), s.net_profit >= 0 ? 'green' : 'red', '📈'],
    ['Avg trip km', s.avg_km ? Number(s.avg_km).toFixed(1) : '—', '', '📏'],
    ['Avg duration', dur(s.avg_min), '', '⏱️'],
    ['Verified mileage', m ? m.toFixed(1) + ' km/u' : 'n/a', '', '⚡']
  ];
  return (
    <div className="grid">
      {C.map(([l, v, c, ico]) => (
        <div className="stat" key={l}>
          <div className="stat-header">
            <span className="stat-label">{l}</span>
            <span className="stat-icon">{ico}</span>
          </div>
          <b className={c}>{v}</b>
        </div>
      ))}
    </div>
  );
}

function Bars({ title, data, k, money }) {
  const max = Math.max(1, ...data.map(d => d[k]));
  return (
    <div className="card">
      <b style={{ fontSize: 16 }}>{title}</b>
      <div className="bar-chart-container">
        {data.map(d => (
          <div className="row" key={d.day}>
            <span>{d.day.slice(5)}</span>
            <div style={{ flex: 1 }}>
              <div className="bar" style={{ width: (d[k] / max * 100) + '%' }} />
            </div>
            <span>{money ? inr(d[k]) : d[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const choose = kind => { navigator.geolocation?.getCurrentPosition(() => { }, () => { }, { enableHighAccuracy: true, timeout: 15000 }); setPickFor(kind); setFare(null); setM(''); };
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

  const statusBadge = (st, flags) => {
    if (st === 'Completed') return <span className="badge badge-success" title={flags?.join(', ')}>✓ Completed</span>;
    if (st === 'In Progress') return <span className="badge badge-blue" title={flags?.join(', ')}>● In Progress</span>;
    if (st === 'Needs Review') return <span className="badge badge-warning" title={flags?.join(', ')}>⚠️ Needs Review</span>;
    return <span className="badge badge-neutral" title={flags?.join(', ')}>{st}</span>;
  };
  const payBadge = ps => {
    if (ps === 'Paid') return <span className="badge badge-success">Paid</span>;
    if (ps === 'Partially Paid') return <span className="badge badge-warning">Partial</span>;
    return <span className="badge badge-danger">Pending</span>;
  };

  return <>
    <div className="big">
      <button className="s" disabled={!!busy || !!active} onClick={() => choose('start')}>
        <span className="big-btn-icon">🚀</span>
        <div className="big-btn-content">
          <span className="big-btn-title">START TRIP</span>
          <span className="big-btn-desc">Capture odometer photo</span>
        </div>
      </button>
      <button className="e" disabled={!!busy || !active} onClick={() => choose('end')}>
        <span className="big-btn-icon">🏁</span>
        <div className="big-btn-content">
          <span className="big-btn-title">END TRIP</span>
          <span className="big-btn-desc">Capture end odometer</span>
        </div>
      </button>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
    </div>

    {active && (
      <div className="banner-active-trip">
        <div className="pulse-badge">
          <span className="pulse-dot"></span>
          Live Trip In Progress
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
          Started: {fdt(active.start_time)} · Starting Odometer: {active.start_odo} km
        </div>
        <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
          📍 Pickup: {active.start_loc || 'Location not recorded'}
        </div>
      </div>
    )}

    {pickFor && !busy && <div className="card"><b>{pickFor === 'start' ? 'Start trip' : 'End trip'} — photo of the odometer</b>
      <p style={{ marginTop: 12 }}><button className="b" onClick={() => camRef.current.click()}>📷 Take photo</button>{' '}
        <button className="b" onClick={() => fileRef.current.click()}>🖼 Upload photo</button>{' '}
        <button className="b" style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }} onClick={() => setPickFor(null)}>Cancel</button></p></div>}
    {busy && <p className="ok"><b>⏳ {busy}</b></p>}
    {msg && <p className={/STARTED|SAVED/.test(msg) ? 'ok' : 'err'}><b>{msg}</b></p>}
    {fare && <div className="card"><b className="green" style={{ fontSize: 18 }}>✓ TRIP COMPLETED</b><br />
      <span style={{ fontSize: 14, color: '#475569' }}>Distance: {fare.trip.distance ?? '—'} km · Duration: {dur(fare.trip.duration_min)}</span>
      {fare.trip.status === 'Needs Review' && <div className="orange" style={{ marginTop: 4, fontWeight: 600 }}>Marked for review: {(fare.trip.flags || []).join(', ')}</div>}
      <p><b>Enter the fare details</b></p>
      <form className="f" onSubmit={saveFare}>
        <label>Trip fare (₹)<input required type="number" min="0" step="any" value={fare.fare} onChange={e => setFare({ ...fare, fare: e.target.value })} /></label>
        <label>Amount received (₹)<input type="number" min="0" step="any" value={fare.recv} onChange={e => setFare({ ...fare, recv: e.target.value })} /></label>
        <label>Payment method<select value={fare.method} onChange={e => setFare({ ...fare, method: e.target.value })}>{['Cash', 'UPI', 'Bank Transfer', 'Other'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Notes (optional)<input value={fare.notes} onChange={e => setFare({ ...fare, notes: e.target.value })} /></label>
        <button className="b">Save Fare</button><button type="button" className="b" style={{ background: '#f1f5f9', color: '#475569' }} onClick={() => setFare(null)}>Skip for now</button></form>
      {fare.err && <p className="err">{fare.err}</p>}</div>}

    {noLoc && <div className="card"><b>⚠️ Location is off or blocked.</b> Turn on location for this site (allow it in the browser prompt or site settings), then retry.
      <p style={{ marginTop: 12 }}><button className="b" onClick={() => withLocation(noLoc.kind, noLoc.file, noLoc.clientTime)}>Retry location</button>{' '}
        <button className="b" style={{ background: '#f1f5f9', color: '#475569' }} onClick={() => send(noLoc.kind, noLoc.file, { no_location: '1', client_time: noLoc.clientTime })}>Continue without location</button>{' '}
        <button className="b" style={{ background: 'transparent', color: '#64748b' }} onClick={() => setNoLoc(null)}>Cancel</button></p></div>}
    {rev && <div className="card"><b>🔍 Please confirm extracted reading</b>
      <p><img alt="uploaded" src={URL.createObjectURL(rev.file)} style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 12, border: '1px solid #cbd5e1' }} /></p>
      <form className="f" onSubmit={e => { e.preventDefault(); send(rev.kind, rev.file, { ...rev.extra, ...vals }); }}>
        {rev.need.includes('odometer') && <label>Odometer (km) — check against photo<input required type="number" value={vals.odometer || ''} onChange={e => setV({ ...vals, odometer: e.target.value })} /></label>}
        {rev.need.includes('driver') && <label>Driver<select required onChange={e => setV({ ...vals, driver_id: e.target.value })}><option value="">Select</option>{drivers.filter(d => d.status === 'Active').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <button className="b">Confirm &amp; Save</button><button type="button" className="b" style={{ background: '#f1f5f9', color: '#475569' }} onClick={() => setRev(null)}>Cancel</button></form></div>}
    <div className="card scroll"><table><thead><tr><th>Trip</th><th>Date</th><th>Driver</th><th>Start → End</th><th>Odometer</th><th>km</th><th>Duration</th><th>Fare</th><th>Received</th><th>Pending</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {trips.map(t => <React.Fragment key={t.id}>
        <tr><td><b>{t.trip_code}</b></td><td>{t.start_time && new Date(t.start_time).toLocaleDateString('en-IN')}</td><td>{t.driver}</td>
          <td>{t.start_loc?.split(',')[0] || '—'} → {t.end_loc?.split(',')[0] || '—'}</td><td>{t.start_odo}–{t.end_odo ?? ''}</td><td>{t.distance ? `${t.distance} km` : '—'}</td><td>{dur(t.duration_min)}</td>
          <td><b>{inr(t.fare)}</b></td><td className="green">{inr(t.received)}</td><td className={t.pending > 0 ? 'orange' : ''}><b>{inr(t.pending)}</b></td>
          <td>{payBadge(t.payment_status)}</td>
          <td>{statusBadge(t.status, t.flags)}</td>
          <td><button className="b" style={{ padding: '6px 12px', minHeight: 34, fontSize: 13 }} onClick={() => setOpen(open === t.id ? null : t.id)}>₹ / details</button></td></tr>
        {open === t.id && <tr><td colSpan="13"><Pay t={t} done={() => { load(); }} /></td></tr>}</React.Fragment>)}</tbody></table></div>
    <button className="b" style={{ background: '#1e293b' }} onClick={() => download('/export/trips', 'trips.xlsx')}>📊 Export Excel</button>
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

const cell = (c, v) => /amount|total|price/.test(c) ? inr(v) : typeof v === 'boolean' ? (v ? 'Yes' : '') : /date/.test(c) && v ? String(v).slice(0, 10) : v ?? '';
function Crud({ path, fields, cols, exportName, extra }) {
  const [rows, setR] = useState([]), [f, setF] = useState({}), [err, setE] = useState('');
  const load = () => api(path).then(setR); useEffect(() => { load(); }, [path]);
  const save = async e => { e.preventDefault(); setE(''); try { await api(path, { method: 'POST', body: f }); setF({}); load(); } catch (x) { setE(x.message); } };
  const del = async id => { if (confirm('Delete this record?')) try { await api(`${path}/${id}`, { method: 'DELETE' }); load(); } catch (x) { setE(x.message); } };
  return <>
    <form className="f card" onSubmit={save}>{fields.map(([k, l, t, o]) => <label key={k}>{l}
      {t === 'select' ? <select required value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })}><option value="">Select</option>{o.map(x => <option key={x}>{x}</option>)}</select>
        : t === 'check' ? <input type="checkbox" checked={!!f[k]} onChange={e => setF({ ...f, [k]: e.target.checked })} />
          : <input type={t || 'text'} step="any" list={o && k} required={!/note|desc|station|next|odometer|method|quantity|price_per_unit|total/.test(k)} value={f[k] || ''} onChange={e => {
            const val = e.target.value, next = { ...f, [k]: val };
            if (k === 'quantity' && val && f.price_per_unit && !f._tot_manual) next.total = +(Number(val) * Number(f.price_per_unit)).toFixed(2);
            else if (k === 'price_per_unit' && val && f.quantity && !f._tot_manual) next.total = +(Number(f.quantity) * Number(val)).toFixed(2);
            else if (k === 'total') next._tot_manual = !!val;
            setF(next);
          }} />}
      {o && t !== 'select' && <datalist id={k}>{o.map(x => <option key={x} value={x} />)}</datalist>}</label>)}
      <button className="b">Add</button>{extra && <label><input type="checkbox" checked={!!f.log_expense} onChange={e => setF({ ...f, log_expense: e.target.checked })} />Also record as expense</label>}</form>
    {err && <p className="err">{err}</p>}
    <div className="card scroll"><table><thead><tr>{cols.map(c => <th key={c}>{c.replace(/_/g, ' ')}</th>)}<th></th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}>{cols.map(c => <td key={c} className={c === 'reminder' && r[c] !== 'OK' ? 'orange' : ''}>{cell(c, r[c])}</td>)}
        <td>{TOKEN && <button className="b" onClick={() => del(r.id)}>Delete</button>}</td></tr>)}</tbody></table></div>
    <button className="b" onClick={() => download('/export/' + exportName, exportName + '.xlsx')}>Export Excel</button></>;
}
const Fuel = () => <><Crud path="/fuel" exportName="fuel" cols={['id', 'date', 'odometer', 'fuel_type', 'total', 'quantity', 'price_per_unit', 'station', 'method', 'full_tank']}
  fields={[['date', 'Date', 'date'], ['odometer', 'Odometer', 'number'], ['fuel_type', 'Fuel', 'select', ['Petrol', 'Diesel', 'CNG', 'Other']], ['total', 'Total Bill ₹', 'number'], ['quantity', 'Quantity (optional)', 'number'], ['price_per_unit', 'Price/unit ₹ (optional)', 'number'], ['station', 'Station'], ['method', 'Payment', 'text', ['Cash', 'UPI', 'Card']], ['full_tank', 'Full tank', 'check']]} /><Mileage /></>;
function Mileage() {
  const [m, setM] = useState({}); useEffect(() => { api('/fuel/mileage').then(setM); }, []);
  return <div className="card"><b>Verified mileage (full-tank to full-tank)</b>{Object.entries(m).map(([k, v]) => <p key={k}>{k}: {v.verified_kmpl ? v.verified_kmpl.toFixed(2) + ' km per unit' : 'needs two full-tank entries with odometer'}</p>)}</div>;
}
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
function AppLogin({ onLogin }) {
  const [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setB] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(''); setB(true);
    try {
      const res = await api('/app/verify', { method: 'POST', body: { password: pw } });
      onLogin(res.token);
    } catch (x) {
      setErr(x.message || 'Incorrect password');
    } finally { setB(false); }
  };
  return (
    <div className="login-screen">
      <div className="login-box card">
        <div className="login-icon-wrap">🚖</div>
        <div className="login-header">
          <h2>Cab Trip Manager</h2>
          <p className="login-subtitle">Fleet Operations Portal · Enter passcode</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>Passcode
            <input type="password" autoFocus required placeholder="Enter password" value={pw} onChange={e => setPw(e.target.value)} />
          </label>
          <button className="login-btn" disabled={busy}>{busy ? 'Verifying…' : 'Unlock Portal'}</button>
          {err && <p className="err" style={{ marginTop: 14 }}><b>{err}</b></p>}
        </form>
      </div>
    </div>
  );
}

function Gate({ admin, setAdmin, children }) {
  const [pw, setPw] = useState(''), [err, setE] = useState('');
  if (admin) return children;
  return (
    <form className="card" style={{ maxWidth: 400, margin: '30px auto', padding: '28px', textAlign: 'center' }} onSubmit={async e => {
      e.preventDefault();
      try {
        const res = await api('/admin/verify', { method: 'POST', body: { password: pw } });
        setTok(res.token);
        setAdmin(true);
      } catch (x) {
        setE(x.message || 'Incorrect admin password');
      }
    }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>🛡️</div>
      <b style={{ fontSize: 18, color: '#0f172a' }}>Administrator Verification</b>
      <p style={{ color: '#64748b', fontSize: 13.5, margin: '8px 0 20px' }}>Enter the administrator password to unlock management features.</p>
      <input
        type="password"
        autoFocus
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="Admin password"
        value={pw}
        onChange={e => setPw(e.target.value)}
      />
      <button className="b" style={{ width: '100%' }}>Unlock Admin</button>
      {err && <p className="err" style={{ marginTop: 12 }}><b>{err}</b></p>}
    </form>
  );
}

function Monthly() {
  const d = new Date(), [m, setMo] = useState(d.getMonth() + 1), [y, setY] = useState(d.getFullYear()), [r, setR] = useState(null), [err, setE] = useState('');
  useEffect(() => { api(`/reports/monthly?month=${m}&year=${y}`).then(setR).catch(x => setE(x.message)); }, [m, y]);
  return <><form className="f card"><label>Month<input type="number" min="1" max="12" value={m} onChange={e => setMo(e.target.value)} /></label><label>Year<input type="number" value={y} onChange={e => setY(e.target.value)} /></label>
    <button type="button" className="b" onClick={() => download(`/export/monthly?month=${m}&year=${y}`, `monthly-${y}-${m}.xlsx`)}>Export Excel</button></form>{err && <p className="err">{err}</p>}
    {r && <><Cards s={r.summary} /><Bars title="Daily income" data={r.series} k="income" money /><Bars title="Daily expenses (fuel + other)" data={r.series} k="expenses" money /><Bars title="Fuel expenses" data={r.series} k="fuel" money /><Bars title="Distance (km)" data={r.series} k="km" /></>}</>;
}
const List = ({ title, rows, f }) => <div className="card"><b>{title}</b>{rows.length ? rows.map((r, i) => <div key={i}>{f(r)}</div>) : <div>None</div>}</div>;
function Dashboard() {
  const [range, setRg] = useState('month'), [c, setC] = useState({ from: today(), to: today() }), [d, setDat] = useState(null);
  const span = () => {
    const n = new Date(), iso = x => x.toLocaleDateString('en-CA'), t = iso(n);
    if (range === 'today') return [t, t]; if (range === 'yesterday') { const y = iso(new Date(n - 864e5)); return [y, y]; }
    if (range === 'week') return [iso(new Date(n - 6 * 864e5)), t]; if (range === 'month') return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), t]; return [c.from, c.to];
  };
  useEffect(() => { const [from, to] = span(); api(`/dashboard?from=${from}&to=${to}`).then(setDat); }, [range, c]);
  return <><div className="card f">{['today', 'yesterday', 'week', 'month', 'custom'].map(x => <button key={x} className="b" style={{ opacity: range === x ? 1 : .6 }} onClick={() => setRg(x)}>{x}</button>)}
    {range === 'custom' && <><input type="date" value={c.from} onChange={e => setC({ ...c, from: e.target.value })} /><input type="date" value={c.to} onChange={e => setC({ ...c, to: e.target.value })} /></>}</div>
    {d && <><Cards s={d.summary} /><Bars title="Income" data={d.series} k="income" money /><Bars title="Expenses" data={d.series} k="expenses" money /><Bars title="Trips per day" data={d.series} k="trips" />
      <List title="Pending payments" rows={d.pending} f={t => `${t.trip_code} · ${inr(t.pending)}`} /><List title="Trips needing review" rows={d.review} f={t => `${t.trip_code} · ${(t.flags || []).join(', ')}`} />
      <List title="Maintenance alerts" rows={d.maintenance} f={m => `${m.service_type} · ${m.reminder}`} /><List title="Recent fuel" rows={d.fuel} f={x => `${String(x.date).slice(0, 10)} · ${x.quantity} · ${inr(x.total)}`} /></>}</>;
}

function Settings() {
  const [v, setV] = useState(null), [drivers, setDs] = useState([]), [nd, setNd] = useState(''), [pw, setPw] = useState({}), [appPw, setAppPw] = useState(''), [msg, setM] = useState('');
  const load = () => { api('/vehicles').then(x => setV(x[0])); api('/drivers').then(setDs); }; useEffect(load, []);
  const run = async fn => { try { await fn(); setM('Saved successfully'); load(); } catch (x) { setM(x.message); } };
  const F = [['reg_no', 'Registration'], ['make', 'Make'], ['model', 'Model'], ['fuel_type', 'Fuel type'], ['tank_capacity', 'Tank capacity'], ['insurance_expiry', 'Insurance expiry', 'date'], ['permit_expiry', 'Permit expiry', 'date'], ['puc_expiry', 'Pollution expiry', 'date']];
  return <>{msg && <p className="ok"><b>{msg}</b></p>}{v && <form className="f card" onSubmit={e => { e.preventDefault(); run(() => api('/vehicles/' + v.id, { method: 'PUT', body: v })); }}>{F.map(([k, l, t]) => <label key={k}>{l}<input type={t || 'text'} value={String(v[k] ?? '').slice(0, t === 'date' ? 10 : 99)} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>)}<button className="b">Save vehicle</button></form>}
    <div className="card"><b>Drivers</b>{drivers.map(d => <div key={d.id} style={{ margin: '6px 0' }}>{d.name} · {d.status} <button className="b" onClick={() => run(() => api('/drivers/' + d.id, { method: 'PUT', body: { status: d.status === 'Active' ? 'Inactive' : 'Active' } }))}>Toggle</button></div>)}
      <form className="f" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); run(() => api('/drivers', { method: 'POST', body: { name: nd } })); setNd(''); }}><input required placeholder="New driver name" value={nd} onChange={e => setNd(e.target.value)} /><button className="b">Add driver</button></form></div>
    <form className="f card" onSubmit={e => { e.preventDefault(); run(() => api('/admin/change-password', { method: 'POST', body: pw })); }}>
      <b>Change Admin Password</b>
      <label>Current admin password<input type="password" onChange={e => setPw({ ...pw, current: e.target.value })} /></label>
      <label>New admin password (8+)<input type="password" onChange={e => setPw({ ...pw, next: e.target.value })} /></label>
      <button className="b">Update Admin Password</button></form>
    <form className="f card" onSubmit={e => { e.preventDefault(); run(() => api('/admin/change-app-password', { method: 'POST', body: { next: appPw } })); setAppPw(''); }}>
      <b>Change App Passcode</b>
      <label>New app passcode (6+)<input type="password" required placeholder="New passcode" value={appPw} onChange={e => setAppPw(e.target.value)} /></label>
      <button className="b">Update App Passcode</button></form></>;
}

function AdminManagement({ admin, setAdmin }) {
  const [sub, setSub] = useState(0);
  const pages = [
    ['Dashboard', Dashboard, '📊'],
    ['Monthly Report', Monthly, '📅'],
    ['Settings', Settings, '⚙️']
  ];
  const [, Page] = pages[sub];
  return (
    <Gate admin={admin} setAdmin={setAdmin}>
      <div className="admin-header">
        <div className="subnav">
          {pages.map(([label, , ico], i) => (
            <button key={label} className={`subnav-btn ${sub === i ? 'on' : ''}`} onClick={() => setSub(i)}>
              <span>{ico}</span> {label}
            </button>
          ))}
        </div>
        <button
          className="b"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', boxShadow: 'none' }}
          onClick={() => { api('/admin/logout', { method: 'POST' }).catch(() => {}); setTok(''); setAdmin(false); }}
        >
          🔒 Lock Admin
        </button>
      </div>
      <Page />
    </Gate>
  );
}

const TABS = [
  ['Trip Log', TripLog, '🚖'],
  ['Fuel Log', Fuel, '⛽'],
  ['Daily Report', Daily, '📅'],
  ['Expense Log', Expenses, '💸'],
  ['Maintenance', Maint, '🔧'],
  ['Admin Management', AdminManagement, '🛡️', 1]
];

export default function App() {
  const [appAuth, setAppAuth] = useState(!!APP_TOKEN);
  const [tab, setTab] = useState(0);
  const [admin, setAdmin] = useState(!!TOKEN);
  const last = useRef(Date.now()), idle = useRef(15);

  const lockAdmin = () => {
    api('/admin/logout', { method: 'POST' }).catch(() => {});
    setTok('');
    setAdmin(false);
  };

  const logoutApp = () => {
    lockAdmin();
    setAppTok('');
    setAppAuth(false);
  };

  useEffect(() => {
    if (!appAuth) return;
    api('/config').then(c => idle.current = c.idleMinutes).catch(() => {});
    const bump = () => last.current = Date.now();
    ['click', 'keydown', 'touchstart'].forEach(e => addEventListener(e, bump));
    const t = setInterval(async () => {
      if (!TOKEN) return;
      if (Date.now() - last.current > idle.current * 60000) lockAdmin();
      else try { setTok((await api('/admin/ping', { method: 'POST' })).token); } catch { lockAdmin(); }
    }, 30000);
    return () => clearInterval(t);
  }, [appAuth]);

  if (!appAuth) {
    return <AppLogin onLogin={token => { setAppTok(token); setAppAuth(true); }} />;
  }

  const [name, Page, ico, prot] = TABS[tab];
  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <span className="brand-icon">🚖</span>
          <div className="brand-info">
            <h1>Cab Trip Manager</h1>
            <span>Fleet Operations</span>
          </div>
          <div className="mobile-top-actions">
            {admin && (
              <button
                className="mobile-exit-btn"
                style={{ background: 'rgba(245,158,11,0.2)', color: '#fcd34d', borderColor: 'rgba(245,158,11,0.3)' }}
                onClick={lockAdmin}
              >
                🔒 Admin
              </button>
            )}
            <button className="mobile-exit-btn" onClick={logoutApp}>
              Exit 🚪
            </button>
          </div>
        </div>

        <div className="nav-links">
          {TABS.map(([n, , tabIco, p], i) => (
            <button key={n} className={`nav-btn ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)}>
              <span className="nav-ico">{tabIco}</span>
              <span>{n}</span>
              {p ? <span className="nav-lock-badge">🔒</span> : null}
            </button>
          ))}
        </div>

        <div className="nav-footer">
          {admin && (
            <button className="nav-footer-btn admin-lock" onClick={lockAdmin}>
              🔒 Lock Admin
            </button>
          )}
          <button className="nav-footer-btn" onClick={logoutApp}>
            🚪 Exit App
          </button>
        </div>
      </nav>

      <main className="main">
        <h2>
          <span>{ico}</span> {name}
        </h2>
        {prot ? <Page admin={admin} setAdmin={setAdmin} /> : <Page />}
      </main>
    </div>
  );
}
