// HWP / HWPX viewer powered by @rhwp/core (Rust + WebAssembly).
//
// rhwp parses both the binary HWP 5.x format and XML-based HWPX and renders each
// page to SVG — vector output that stays crisp at any zoom and is well supported
// on older Chromium. The 7 MB WASM binary is hosted as a separate asset (see
// vite assetsInlineLimit: 0) and its URL is overridable via MultiViewer options.

import initRhwp, { HwpDocument } from '@rhwp/core';
import { el } from '../utils/dom.js';
import { assetUrl } from '../core/config.js';
import { toolbar } from './text.js';

let initPromise = null;

function ensureRhwp() {
  if (initPromise) return initPromise;

  // rhwp calls back into JS to measure text width during layout; must be set
  // before WASM initialisation.
  if (typeof globalThis.measureTextWidth !== 'function') {
    let mctx = null;
    let lastFont = '';
    globalThis.measureTextWidth = (font, text) => {
      if (!mctx) mctx = document.createElement('canvas').getContext('2d');
      if (font !== lastFont) {
        mctx.font = font;
        lastFont = font;
      }
      return mctx.measureText(text).width;
    };
  }

  initPromise = initRhwp({ module_or_path: assetUrl('rhwp_bg.wasm') });
  return initPromise;
}

export default async function render(container, ctx) {
  await ensureRhwp();

  const doc = new HwpDocument(ctx.bytes);
  const pageCount = doc.pageCount();

  let zoom = 1;
  const zoomOut = el('button', { class: 'mv-btn', title: '축소', onClick: () => setZoom(zoom / 1.15) }, '−');
  const zoomIn = el('button', { class: 'mv-btn', title: '확대', onClick: () => setZoom(zoom * 1.15) }, '+');

  container.append(
    toolbar(ctx.filename, [ctx.format.toUpperCase(), `${pageCount} pages`], [zoomOut, zoomIn]),
    // fall through: build the page list below
  );
  const pages = el('div', { class: 'mv-hwp mv-hwp--rhwp' });
  container.append(pages);

  const wrappers = [];
  for (let i = 0; i < pageCount; i++) {
    const wrap = el('div', { class: 'mv-hwp__page' });
    wrap.innerHTML = doc.renderPageSvg(i);
    const svg = wrap.querySelector('svg');
    const base = svg ? baseWidth(svg) : 0;
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
    }
    wrappers.push({ wrap, base });
    pages.append(wrap);
  }
  setZoom(1);

  if (typeof doc.free === 'function') {
    // Free WASM memory once the surface is torn down.
    const observer = new MutationObserver(() => {
      if (!document.contains(pages)) {
        try {
          doc.free();
        } catch {
          /* ignore */
        }
        observer.disconnect();
      }
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* no body (unlikely) */
    }
  }

  function setZoom(z) {
    zoom = Math.min(4, Math.max(0.3, z));
    for (const { wrap, base } of wrappers) {
      wrap.style.width = base ? `${Math.round(base * zoom)}px` : `${Math.round(zoom * 100)}%`;
    }
  }
}

function baseWidth(svg) {
  const w = parseFloat(svg.getAttribute('width'));
  if (w) return w;
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/);
  return vb.length === 4 ? parseFloat(vb[2]) : 0;
}
