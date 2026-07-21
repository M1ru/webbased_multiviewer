// Public entry point.
//
//   import { MultiViewer } from 'webbased-multiviewer';
//   const viewer = new MultiViewer({ container: '#app' });
//   await viewer.render(file); // File | Blob | ArrayBuffer | Uint8Array
//
// Or as a standalone <script> (UMD): window.MultiViewer.

import './polyfills.js'; // must run before any viewer library
import './styles.css';
import { detectFormat } from './core/detect.js';
import { resolveViewer, SUPPORTED } from './core/registry.js';
import { setConfig } from './core/config.js';
import { clear, spinner, messagePanel } from './utils/dom.js';

export class MultiViewer {
  /**
   * @param {{ container: string|HTMLElement, assetsPath?: string, rhwpWasmUrl?: string }} opts
   *   assetsPath   Folder hosting rhwp_bg.wasm and mv-pdf.worker.js (default './').
   *   rhwpWasmUrl  Explicit URL for the rhwp WASM binary (overrides assetsPath).
   */
  constructor({ container, assetsPath, rhwpWasmUrl } = {}) {
    const node = typeof container === 'string' ? document.querySelector(container) : container;
    if (!node) throw new Error(`MultiViewer: container not found (${container})`);
    this.root = node;
    this.root.classList.add('mv-root');
    this._token = 0; // guards against out-of-order renders
    setConfig({ assetsPath, rhwpWasmUrl });
  }

  /** Detect the format of a file without rendering it. */
  async detect(input) {
    const { bytes, filename } = await normalizeInput(input);
    return detectFormat(bytes, filename);
  }

  /**
   * Render a file into the container.
   * @param {File|Blob|ArrayBuffer|Uint8Array|{data:any,name?:string}} input
   * @param {{ filename?: string }} [opts]
   * @returns {Promise<{ format: string, via: string }>}
   */
  async render(input, opts = {}) {
    const token = ++this._token;
    const { bytes, blob, filename } = await normalizeInput(input, opts.filename);
    const detection = detectFormat(bytes, filename);

    clear(this.root).append(spinner(`${filename || 'file'} 여는 중…`));

    const ctx = { bytes, blob, filename, ...detection, SUPPORTED };
    try {
      const mod = await resolveViewer(detection.format)();
      if (token !== this._token) return detection; // superseded by a newer render
      const surface = clear(this.root);
      await mod.default(surface, ctx);
    } catch (err) {
      if (token !== this._token) return detection;
      console.error('[MultiViewer]', err);
      clear(this.root).append(
        messagePanel({
          icon: '⚠️',
          title: '미리보기를 표시할 수 없습니다',
          detail: `${detection.format.toUpperCase()} · ${err?.message || err}`,
        })
      );
    }
    return detection;
  }

  /** Remove rendered content. */
  clear() {
    this._token++;
    clear(this.root);
  }
}

/** Normalize any accepted input into raw bytes + a Blob + a filename. */
async function normalizeInput(input, filenameOverride) {
  let bytes;
  let blob;
  let filename = filenameOverride || '';

  if (input && typeof input === 'object' && 'data' in input && !(input instanceof Blob)) {
    filename = filename || input.name || '';
    input = input.data;
  }

  if (input instanceof Blob) {
    blob = input;
    filename = filename || input.name || '';
    bytes = new Uint8Array(await input.arrayBuffer());
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
    blob = new Blob([input]);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    blob = new Blob([bytes]);
  } else {
    throw new Error('Unsupported input: pass a File, Blob, ArrayBuffer or Uint8Array');
  }
  return { bytes, blob, filename };
}

export { detectFormat, SUPPORTED };
export default MultiViewer;
