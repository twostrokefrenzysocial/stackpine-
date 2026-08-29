'use strict';

const path = require('path');
const { createWorker } = require('tesseract.js');

// The language model ships with the app (assets/tessdata), so recognition
// never fetches anything at runtime — screenshots stay on this server.
const TESSDATA = path.join(__dirname, '..', 'assets', 'tessdata');

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: TESSDATA,
      gzip: false,
      cacheMethod: 'none',
    });
  }
  return workerPromise;
}

/** PNG, JPEG, WebP or GIF — anything else is refused before OCR sees it. */
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  if (buf.toString('ascii', 0, 3) === 'GIF') return true;
  return false;
}

/**
 * Read the text out of a screenshot and hand back trimmed, non-empty lines.
 * The worker is shared across requests and survives a failed recognition;
 * only a worker that failed to start is thrown away.
 */
async function extractImageLines(buffer) {
  if (!looksLikeImage(buffer)) {
    const err = new Error('not an image');
    err.notImage = true;
    throw err;
  }
  let worker;
  try {
    worker = await getWorker();
  } catch (err) {
    workerPromise = null; // a worker that never started should be retried fresh
    throw err;
  }
  const { data } = await worker.recognize(buffer);
  return data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Stop the shared worker so a shutting-down process can actually exit. */
async function closeOcr() {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch (e) { /* never started */ }
}

module.exports = { extractImageLines, closeOcr };
