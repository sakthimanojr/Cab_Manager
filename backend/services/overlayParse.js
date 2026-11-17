// Parses the geotag overlay timestamp, tolerating OCR damage to the month ("lov" -> Nov).
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function monthIndex(w) {
  w = w.toLowerCase();
  let i = MONTHS.indexOf(w.slice(-3));
  if (i < 0) i = MONTHS.findIndex(m => m.slice(1) === w.slice(-2));
  return i;
}
export function parseOverlay(text) {
  const m = text.match(/([A-Za-z]{2,5})\.?\s+(\d{1,2}),?\s+(20\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return null;
  const mon = monthIndex(m[1]); if (mon < 0) return null;
  let h = +m[4]; const ap = m[7]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  const d = new Date(+m[3], mon, +m[2], h, +m[5], +(m[6] || 0));   // local (server TZ) time, as printed
  return isNaN(d) ? null : d.toISOString();
}
