// pdf.js Web Worker entry, wrapped so our compatibility shims load *inside* the
// worker realm before pdf.js runs. pdf.js v5 calls Uint8Array#toHex / fromBase64
// in the worker, which older Chromium lacks and main-thread polyfills can't fix.
import './polyfills.js';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
