// PDF viewer built on Mozilla's pdf.js (legacy build for older Chromium).
// The worker is our polyfill-wrapped entry, so Uint8Array#toHex / fromBase64
// exist inside the worker realm too.

import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
import { el } from '../utils/dom.js';
import { assetUrl } from '../core/config.js';
import { toolbar } from './text.js';

let workerSet = false;
function ensureWorker() {
  if (!workerSet) {
    // Our polyfilled worker (built separately to dist/mv-pdf.worker.js) is a
    // classic script hosted next to the bundle — no import.meta.url needed, so
    // it resolves the same in ESM, UMD and iframe contexts.
    pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('mv-pdf.worker.js');
    workerSet = true;
  }
}

export default async function render(container, ctx) {
  ensureWorker();
  const pages = el('div', { class: 'mv-pdf__pages' });
  let scale = 1.25;

  const zoomOut = el('button', { class: 'mv-btn', title: '축소', onClick: () => setScale(scale / 1.2) }, '−');
  const zoomIn = el('button', { class: 'mv-btn', title: '확대', onClick: () => setScale(scale * 1.2) }, '+');
  const pageInfo = el('span', { class: 'mv-tag' }, '…');

  container.append(
    toolbar(ctx.filename, [], [zoomOut, zoomIn, pageInfo]),
    el('div', { class: 'mv-pdf' }, pages)
  );

  // pdf.js transfers the buffer to the worker, so hand it a private copy.
  const doc = await pdfjs.getDocument({ data: ctx.bytes.slice() }).promise;
  pageInfo.textContent = `${doc.numPages} pages`;

  const canvases = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = el('canvas', { class: 'mv-pdf__page' });
    pages.append(canvas);
    canvases.push({ canvas, page: await doc.getPage(i) });
  }
  await drawAll();

  async function drawAll() {
    const dpr = window.devicePixelRatio || 1;
    for (const { canvas, page } of canvases) {
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext('2d');
      await page.render({
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
    }
  }

  function setScale(next) {
    scale = Math.min(4, Math.max(0.25, next));
    drawAll();
  }
}
