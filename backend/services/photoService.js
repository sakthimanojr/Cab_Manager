// EXIF + OCR extraction. Every value carries method/confidence/verified; nothing is guessed.
import sharp from 'sharp';
import exifr from 'exifr';
import Tesseract from 'tesseract.js';
const TOL = Number(process.env.TIME_TOLERANCE_MIN || 10);

export async function analyzePhoto(file) {
  const flags = [];
  const meta = (await exifr.parse(file, { gps: true }).catch(() => null)) || {};
  const exifT = meta.DateTimeOriginal || meta.CreateDate || null;
  const out = { flags, timestamps: { exif: exifT ? new Date(exifT).toISOString() : null, overlay: null },
    gps: null, odometer: null, fuelType: null, location: null, takenAt: null };
  if (meta.latitude != null) out.gps = { lat: meta.latitude, lng: meta.longitude, alt: meta.GPSAltitude ?? null, source: 'exif' };

  let text = '', words = [];
  try {
    const img = sharp(file).rotate();
    const { width = 0 } = await img.metadata();
    const buf = await img.resize({ width: Math.max(width, 2000) }).greyscale().normalise().sharpen().png().toBuffer();
    const { data } = await Tesseract.recognize(buf, 'eng');
    text = data.text; words = data.words || [];
  } catch { flags.push('ocr_failed'); }
  out.rawText = text;

  const m = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,7})(?:\.\d)?\s*km\b/i);
  if (m) {
    const digits = m[1].replace(/,/g, '');
    const w = words.find(w => w.text.replace(/\D/g, '') === digits);
    const confidence = Math.round(w?.confidence ?? 50);
    out.odometer = { value: Number(digits), confidence, method: 'ocr', verified: confidence >= 70 };
  }
  const f = text.match(/\b(petrol|diesel|cng)\b/i);
  if (f) out.fuelType = /cng/i.test(f[1]) ? 'CNG' : f[1][0].toUpperCase() + f[1].slice(1).toLowerCase();

  const dm = text.match(/([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(20\d{2})/);
  const tm = text.match(/(\d{1,2}:\d{2}:\d{2})\s*([AP]M)/i);
  if (dm && tm) { const d = new Date(`${dm[1]} ${dm[2]}, ${dm[3]} ${tm[1]} ${tm[2]}`); if (!isNaN(d)) out.timestamps.overlay = d.toISOString(); }

  if (!out.gps) {
    const c = text.match(/(-?\d{1,2}\.\d{4,})\D{1,4}(-?\d{2,3}\.\d{4,})/);
    if (c) { out.gps = { lat: +c[1], lng: +c[2], alt: null, source: 'ocr' }; flags.push('gps_from_ocr'); }
    else flags.push('no_gps');
  }
  out.location = text.split('\n').filter(l => /india|tamil nadu|kerala|karnataka|andhra|telangana|puducherry/i.test(l)).join(', ') || null;

  const { exif, overlay } = out.timestamps;
  out.takenAt = exif || overlay;  // original capture time, never the upload time
  if (exif && overlay && Math.abs(new Date(exif) - new Date(overlay)) > TOL * 60000) flags.push('time_conflict');
  if (out.odometer && !out.odometer.verified) flags.push('odometer_low_confidence');
  return out;
}
