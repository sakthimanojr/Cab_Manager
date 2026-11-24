// Odometer-only reader (Tesseract). Location and time come from the phone at tap time.
// Works for a close-up of just the km digits (whole image) and for a wider dashboard photo (strip scan).
// "verified" only when enough passes agree; otherwise the driver confirms a pre-filled value.
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const CLOSEUP = [[0, 0, 1, 1], [0, .2, 1, .8]];                                                    // photo is mostly the digits
const STRIPS = [.50, .53, .56, .59, .62, .65, .68, .71, .74, .77].map(y => [.44, y, .64, y + .10]); // wider photo: strips down the middle
let workerP, chain = Promise.resolve();
const getWorker = () => (workerP ||= createWorker('eng'));   // loaded once, reused across photos
const queue = fn => (chain = chain.then(fn, fn));             // one scan at a time (shared worker)

async function crop(buf, W, H, [l, t, r, b]) {
  return sharp(buf).extract({ left: Math.round(W * l), top: Math.round(H * t), width: Math.max(8, Math.round(W * (r - l))), height: Math.max(8, Math.round(H * (b - t))) }).resize({ width: 1200 });
}
async function scan(worker, buf, W, H, boxes, negate, votes) {
  let reads = 0;
  for (const box of boxes) {
    let img = await (await crop(buf, W, H, box)).greyscale().threshold(200).png().toBuffer();
    if (negate) img = await sharp(img).negate().png().toBuffer();
    for (const psm of ['7', '8']) {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: psm });
      const t = (await worker.recognize(img)).data.text.replace(/\D/g, '');
      if (t.length >= 5 && t.length <= 7) { votes[t] = (votes[t] || 0) + 1; reads++; }
    }
  }
  return reads;
}
const best = v => Object.entries(v).sort((a, b) => b[1] - a[1])[0];
const sure = (top, reads) => top && top[1] >= 3 && top[1] / reads >= 0.6;

async function readOdometer(worker, buf, W, H) {
  const votes = {}; let reads = 0;
  const steps = [[CLOSEUP, false], [STRIPS, false], [CLOSEUP, true], [STRIPS, true]];   // stop as soon as the readings agree
  for (const [boxes, neg] of steps) {
    reads += await scan(worker, buf, W, H, boxes, neg, votes);
    if (sure(best(votes), reads)) break;
  }
  const top = best(votes);
  if (!top) return null;
  const confidence = Math.round(100 * top[1] / reads);
  return { value: Number(top[0]), confidence, method: 'ocr-scan', verified: !!sure(top, reads) };
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