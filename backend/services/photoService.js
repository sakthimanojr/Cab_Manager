// EXIF + region-based OCR. Nothing is guessed: odometer is "verified" only when most OCR passes agree.
import sharp from 'sharp';
import exifr from 'exifr';
import { createWorker } from 'tesseract.js';
import { parseOverlay } from './overlayParse.js';
const TOL = Number(process.env.TIME_TOLERANCE_MIN || 10);

// relative boxes [left, top, right, bottom]; tight crop first, wider one as backup (layouts vary by phone/cluster)
const ODO_BOXES = [[.46, .60, .62, .68], [.42, .57, .66, .70]];
const OVERLAY_BOX = [.55, .62, 1, 1];

async function crop(buf, W, H, [l, t, r, b], scale) {
  const left = Math.round(W * l), top = Math.round(H * t), width = Math.round(W * (r - l)), height = Math.round(H * (b - t));
  return sharp(buf).extract({ left, top, width, height }).resize({ width: width * scale });
}
async function readOdometer(worker, buf, W, H) {
  const votes = {};
  let reads = 0;
  for (const box of ODO_BOXES) {
    const base = await (await crop(buf, W, H, box, 4)).greyscale().threshold(200).png().toBuffer();
    const neg = await sharp(base).negate().png().toBuffer();
    for (const img of [base, neg]) for (const psm of ['7', '8']) {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: psm });
      const t = (await worker.recognize(img)).data.text.replace(/\D/g, '');
      if (t.length >= 5 && t.length <= 7) { votes[t] = (votes[t] || 0) + 1; reads++; }
    }
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const confidence = Math.round(100 * best[1] / reads);
  return { value: Number(best[0]), confidence, method: 'ocr-vote', verified: best[1] >= 3 && confidence >= 75 };
}

export async function analyzePhoto(file) {
  const flags = [];
  const meta = (await exifr.parse(file, { gps: true }).catch(() => null)) || {};
  const exifT = meta.DateTimeOriginal || meta.CreateDate || null;
  const out = { flags, timestamps: { exif: exifT ? new Date(exifT).toISOString() : null, overlay: null },
    gps: null, odometer: null, fuelType: null, location: null, takenAt: null };
  if (meta.latitude != null) out.gps = { lat: meta.latitude, lng: meta.longitude, alt: meta.GPSAltitude ?? null, source: 'exif' };

  let text = '';
  const worker = await createWorker('eng');
  try {
    const buf = await sharp(file).rotate().toBuffer();
    const { width: W, height: H } = await sharp(buf).metadata();
    out.odometer = await readOdometer(worker, buf, W, H);

    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
    const ov = await (await crop(buf, W, H, OVERLAY_BOX, 2)).greyscale().normalise().png().toBuffer();
    text = (await worker.recognize(ov)).data.text;
    out.timestamps.overlay = parseOverlay(text);
    if (!out.timestamps.overlay) {   // fallback: whole image
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
      const whole = await sharp(buf).resize({ width: W * 2 }).greyscale().normalise().png().toBuffer();
      text += '\n' + (await worker.recognize(whole)).data.text;
      out.timestamps.overlay = parseOverlay(text);
    }
  } catch { flags.push('ocr_failed'); }
  finally { await worker.terminate().catch(() => {}); }
  out.rawText = text;

  // bi-fuel clusters print both PETROL and CNG all the time, so only trust a single, unambiguous word
  const fuels = new Set([...text.matchAll(/\b(petrol|diesel|cng)\b/gi)].map(x => x[1].toLowerCase()));
  if (fuels.size === 1) { const f = [...fuels][0]; out.fuelType = f === 'cng' ? 'CNG' : f[0].toUpperCase() + f.slice(1); }

  if (!out.gps) {
    const c = text.match(/(-?\d{1,2}\.\d{4,})\D{1,4}(-?\d{2,3}\.\d{4,})/);
    if (c) { out.gps = { lat: +c[1], lng: +c[2], alt: null, source: 'ocr' }; flags.push('gps_from_ocr'); }
  }
  out.location = text.split('\n').map(s => s.trim()).filter(l => /india|tamil nadu|kerala|karnataka|andhra|telangana|puducherry|road|street|nagar/i.test(l)).join(', ') || null;
  if (!out.gps) flags.push(out.location ? 'location_from_overlay' : 'no_gps');   // coordinates are never invented

  const { exif, overlay } = out.timestamps;
  out.takenAt = exif || overlay;   // original capture time, never the upload time
  if (exif && overlay && Math.abs(new Date(exif) - new Date(overlay)) > TOL * 60000) flags.push('time_conflict');
  if (out.odometer && !out.odometer.verified) flags.push('odometer_low_confidence');
  return out;
}
