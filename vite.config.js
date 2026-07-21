import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Main library build → ESM + UMD.
//
//  - dist/multiviewer.js       ESM  (`import { MultiViewer } from ...`)
//  - dist/multiviewer.umd.cjs  UMD  (standalone `<script>`, window.MultiViewer)
//  - dist/multiviewer.css      stylesheet
//
// Heavy assets are NOT bundled; they are emitted/copied as separate files and
// fetched at runtime from `assetsPath` (see src/core/config.js):
//  - dist/rhwp_bg.wasm      copied here from @rhwp/core
//  - dist/mv-pdf.worker.js  built by vite.worker.config.js
//
// Compatibility target: embedded Chromium ~80–99 → es2018 syntax; missing
// built-in methods are polyfilled at runtime (src/polyfills.js).
const TARGET = ['es2018', 'chrome80'];
const require = createRequire(import.meta.url);

/**
 * The @rhwp/core glue has a default `new URL('rhwp_bg.wasm', import.meta.url)`
 * used only when init() is called with no path. Vite statically resolves that
 * and base64-inlines the 7 MB WASM into the JS bundle. We always pass an
 * explicit path, so neutralise the literal to keep the WASM a separate file.
 */
function externalizeRhwpWasm() {
  return {
    name: 'externalize-rhwp-wasm',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('@rhwp/core') && code.includes("new URL('rhwp_bg.wasm', import.meta.url)")) {
        return {
          code: code.replace("new URL('rhwp_bg.wasm', import.meta.url)", "'rhwp_bg.wasm'"),
          map: null,
        };
      }
      return null;
    },
  };
}

/** Copy the rhwp WASM binary next to the bundle after the build. */
function copyRhwpWasm() {
  return {
    name: 'copy-rhwp-wasm',
    apply: 'build',
    closeBundle() {
      const src = require.resolve('@rhwp/core/rhwp_bg.wasm');
      copyFileSync(src, resolve(__dirname, 'dist/rhwp_bg.wasm'));
    },
  };
}

export default defineConfig({
  plugins: [externalizeRhwpWasm(), copyRhwpWasm()],
  build: {
    target: TARGET,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'MultiViewer',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'multiviewer.js' : 'multiviewer.umd.cjs'),
    },
    sourcemap: true,
    rollupOptions: {
      output: {
        exports: 'named',
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'multiviewer.css' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  esbuild: { target: TARGET },
});
