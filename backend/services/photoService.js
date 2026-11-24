// Odometer-only reader (Tesseract). Location and time come from the phone at tap time.
// Step 1: LOCATE the digit group anywhere in the photo (sparse-text OCR with bounding boxes).
// Step 2: re-read tight crops around each candidate and vote. Step 3 (fallback): fixed-area scans.
// "verified" only when enough reads agree; otherwise the driver confirms a pre-filled value.
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const CLOSEUP = [[0, 0, 1, 1], [0, .2, 1, .8]];
const STRIPS = [.50, .53, .56, .59, .62, .65, .68, .71, .74, .77].map(y => [.44, y, .64, y + .10]);
let workerP, chain = Promise.resolve();
const getWorker = () => (workerP ||= createWorker('eng'));   // loaded once, reused across photos
const queue = fn => (chain = chain.then(fn, fn));             // one scan at a time (shared worker)
const best = v => Object.entries(v).sort((a, b) => b[1] - a[1])[0];
const sure = (top, reads) => !!top && top[1] >= 3 && top[1] / reads >= 0.6;

const wordsOf = d => d.words || d.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) || [];   // tesseract.js v5 and v6
async function read(worker, img, psm) {
  await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: psm });
  return worker.recognize(img);
}
const addVote = (votes, text) => { const t = String(text).replace(/\D/g, ''); if (t.length >= 5 && t.length <= 7) { votes[t] = (votes[t] || 0) + 1; return 1; } return 0; };

// Step 1: find where the digits are
async function locate(worker, base, votes) {
  let reads = 0; const cands = [];
  for (const th of [160, 200]) {
    const img = await sharp(base).threshold(th).png().toBuffer();
    for (const w of wordsOf((await read(worker, img, '11')).data)) {
      const t = (w.text || '').trim();
      if (/^\d{5,7}$/.test(t) && w.bbox) {
        reads += addVote(votes, t);
        const b = w.bbox, width = b.x1 - b.x0, height = b.y1 - b.y0;
        if (width / height >= 2 && !cands.some(c => Math.abs(c.x0 - b.x0) < width * .5 && Math.abs(c.y0 - b.y0) < height)) cands.push({ x0: b.x0, y0: b.y0, width, height });
      }
    }
  }
  return { reads, cands: cands.slice(0, 3) };
}
// Step 2: re-read tight crops around a candidate (plain greyscale reads best on soft, low-resolution digits)
async function verify(worker, base, BW, BH, c, votes) {
  let reads = 0;
  for (const [px, py] of [[.05, .3], [.1, .5], [.15, .6]]) {
    const left = Math.max(0, Math.round(c.x0 - c.width * px)), top = Math.max(0, Math.round(c.y0 - c.height * py));
    const width = Math.min(BW - left, Math.round(c.width * (1 + 2 * px))), height = Math.min(BH - top, Math.round(c.height * (1 + 2 * py)));
    if (width < 8 || height < 8) continue;
    const img = await sharp(base).extract({ left, top, width, height }).resize({ width: 800 }).png().toBuffer();
    for (const psm of ['7', '8']) reads += addVote(votes, (await read(worker, img, psm)).data.text);
  }
  return reads;
}
// Step 3: fixed-area fallback
async function scan(worker, buf, W, H, boxes, negate, votes) {
  let reads = 0;
  for (const [l, t, r, b] of boxes) {
    let img = await sharp(buf).extract({ left: Math.round(W * l), top: Math.round(H * t), width: Math.max(8, Math.round(W * (r - l))), height: Math.max(8, Math.round(H * (b - t))) })
      .resize({ width: 1200 }).greyscale().threshold(200).png().toBuffer();
    if (negate) img = await sharp(img).negate().png().toBuffer();
    for (const psm of ['7', '8']) reads += addVote(votes, (await read(worker, img, psm)).data.text);
  }
  return reads;
}

async function readOdometer(worker, buf, W, H) {
  const votes = {}; let reads = 0;
  const base = await sharp(buf).resize({ width: 1600 }).greyscale().png().toBuffer();
  const { width: BW, height: BH } = await sharp(base).metadata();
  const found = await locate(worker, base, votes); reads += found.reads;
  for (const c of found.cands) reads += await verify(worker, base, BW, BH, c, votes);
  if (!sure(best(votes), reads)) {
    for (const [boxes, neg] of [[CLOSEUP, false], [STRIPS, false], [CLOSEUP, true], [STRIPS, true]]) {
      reads += await scan(worker, buf, W, H, boxes, neg, votes);
      if (sure(best(votes), reads)) break;
    }
  }
  const top = best(votes);
  if (!top) return null;
  return { value: Number(top[0]), confidence: Math.round(100 * top[1] / reads), method: 'ocr-locate', verified: sure(top, reads) };
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