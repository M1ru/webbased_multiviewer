import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds the pdf.js Web Worker as a standalone classic script that hosts our
// compatibility shims (so Uint8Array#toHex etc. exist inside the worker realm).
// Output: dist/mv-pdf.worker.js — referenced at runtime via
// pdfjs.GlobalWorkerOptions.workerSrc = assetsPath + 'mv-pdf.worker.js'.
const TARGET = ['es2018', 'chrome80'];

export default defineConfig({
  build: {
    target: TARGET,
    emptyOutDir: false, // keep the main build's output
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/pdf.worker.entry.js'),
      name: 'MvPdfWorker',
      formats: ['iife'],
      fileName: () => 'mv-pdf.worker.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true, // single classic worker file
      },
    },
  },
  esbuild: { target: TARGET },
});
