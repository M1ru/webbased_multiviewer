// Maps a detected format to a lazily-loaded viewer module.
//
// Each entry is a function returning a dynamic import() of the viewer module.
// The module's default export is a `render(container, file, ctx)` function.
// Dynamic import keeps heavy libraries (pdf.js, SheetJS, …) out of the initial
// evaluation cost and lets the ESM build code-split them.

const registry = {
  pdf: () => import('../viewers/pdf.js'),
  txt: () => import('../viewers/text.js'),
  csv: () => import('../viewers/csv.js'),
  xlsx: () => import('../viewers/spreadsheet.js'),
  xls: () => import('../viewers/spreadsheet.js'),
  docx: () => import('../viewers/docx.js'),
  pptx: () => import('../viewers/pptx.js'),
  hwp: () => import('../viewers/rhwp.js'),
  hwpx: () => import('../viewers/rhwp.js'),
  doc: () => import('../viewers/legacy.js'),
  ppt: () => import('../viewers/legacy.js'),
  unknown: () => import('../viewers/fallback.js'),
};

export function resolveViewer(format) {
  return registry[format] || registry.unknown;
}

/** Formats we can render natively in-browser (pure client-side). */
export const SUPPORTED = Object.keys(registry).filter((k) => k !== 'unknown');
