// Odometer-only reader (Tesseract). Location and time now come from the phone at tap time.
// "verified" only when most OCR passes agree; otherwise the driver confirms a pre-filled value.
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const ODO_BOXES = [[.46, .60, .62, .68], [.42, .57, .66, .70]];   // relative [left, top, right, bottom]; tight crop first, wider backup
let workerP, chain = Promise.resolve();
const getWorker = () => (workerP ||= createWorker('eng'));        // loaded once, reused across photos
const queue = fn => (chain = chain.then(fn, fn));                  // one scan at a time (shared worker)

async function crop(buf, W, H, [l, t, r, b], scale) {
  const width = Math.round(W * (r - l));
  return sharp(buf).extract({ left: Math.round(W * l), top: Math.round(H * t), width, height: Math.round(H * (b - t)) }).resize({ width: width * scale });
}
async function readOdometer(worker, buf, W, H) {
  const votes = {}; let reads = 0;
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

export function analyzePhoto(file) {
  return queue(async () => {
    const out = { flags: [], odometer: null };
    try {
      const worker = await getWorker();
      const buf = await sharp(file).rotate().toBuffer();
      const { width: W, height: H } = await sharp(buf).metadata();
      out.odometer = await readOdometer(worker, buf, W, H);
    } catch (e) { console.error('ocr failed:', e.message); out.flags.push('ocr_failed'); }
    if (out.odometer && !out.odometer.verified) out.flags.push('odometer_low_confidence');
    return out;
  });
}