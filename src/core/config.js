// Runtime configuration shared across viewers.
//
// Heavy assets (the rhwp WASM binary and the polyfilled pdf.js worker) are NOT
// bundled — they are hosted as separate files and fetched at runtime from
// `assetsPath`. This keeps the JS bundle small and works identically in the ESM
// and UMD builds and inside an iframe (no import.meta.url / base-URL guessing).
//
//   new MultiViewer({ container, assetsPath: '/viewer-assets/' })
//
// Files expected under assetsPath:
//   - rhwp_bg.wasm        (from @rhwp/core, copied into dist by the build)
//   - mv-pdf.worker.js    (polyfills + pdf.js worker, built into dist)

const config = {
  assetsPath: './',
  rhwpWasmUrl: null, // explicit override for the WASM binary

  // Optional local conversion agent (server-side LibreOffice → PDF).
  // { url, token, formats: string[], timeoutMs }. When a detected format is in
  // `formats`, the file is sent to the agent and the returned PDF is rendered;
  // if the agent is unreachable or conversion fails, we fall back to the
  // client-side viewer for that format.
  converter: null,
};

export function setConfig(patch = {}) {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) config[k] = v;
  }
}

export function getConfig() {
  return config;
}

/** Resolve the URL of a separately-hosted asset. */
export function assetUrl(name) {
  if (name === 'rhwp_bg.wasm' && config.rhwpWasmUrl) return config.rhwpWasmUrl;
  const base = config.assetsPath.endsWith('/') ? config.assetsPath : `${config.assetsPath}/`;
  return base + name;
}
