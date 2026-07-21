// Thin wrapper over fflate for reading entries out of ZIP-based formats
// (pptx, hwpx). Returns a map of path → Uint8Array.

import { unzipSync, strFromU8 } from 'fflate';

export function unzip(bytes) {
  return unzipSync(bytes);
}

export function readText(files, path) {
  const entry = files[path];
  return entry ? strFromU8(entry) : null;
}

/** List entries whose path matches a predicate, sorted naturally by name. */
export function entries(files, predicate) {
  return Object.keys(files)
    .filter(predicate)
    .sort(naturalCompare);
}

export function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export { strFromU8 };
