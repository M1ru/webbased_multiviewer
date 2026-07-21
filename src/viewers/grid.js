// Excel-like grid rendering via x-data-spreadsheet.
//
// SheetJS / PapaParse only give us cell *values*; on their own they render a
// plain HTML table with no spreadsheet feel. x-data-spreadsheet supplies the
// familiar grid: A/B/C column headers, row numbers, gridlines, cell selection,
// a sheet tab bar, and (for xlsx) merged cells.

// Import the prebuilt UMD bundle + CSS directly to avoid pulling the package's
// .less source (which would require a Less toolchain at build time). The webpack
// UMD registers a global factory `x_spreadsheet(el, opts)` rather than an ES
// export, so we consume it that way.
import 'x-data-spreadsheet/dist/xspreadsheet.js';
import 'x-data-spreadsheet/dist/xspreadsheet.css';

function xspreadsheet(host, options) {
  const factory = (typeof window !== 'undefined' && window.x_spreadsheet) || globalThis.x_spreadsheet;
  if (!factory) throw new Error('x-data-spreadsheet failed to load');
  return factory(host, options);
}
import { el } from '../utils/dom.js';
import { toolbar } from './text.js';

/**
 * @param {HTMLElement} container
 * @param {{name:string, rows:any[][], merges?:{s:{r:number,c:number},e:{r:number,c:number}}[]}[]} sheets
 * @param {{filename?:string, tags?:string[]}} [meta]
 */
export function renderGrid(container, sheets, meta = {}) {
  container.append(toolbar(meta.filename, meta.tags || []));
  const host = el('div', { class: 'mv-grid' });
  container.append(host);

  const data = sheets.map((s) => toXSheet(s));
  // x-data-spreadsheet sizes itself from the host element, so mount after it is
  // in the DOM and give it read-only options.
  const ss = xspreadsheet(host, {
    mode: 'read',
    showToolbar: false,
    showContextmenu: false,
    showBottomBar: sheets.length > 1,
    view: {
      height: () => host.clientHeight,
      width: () => host.clientWidth,
    },
    row: { len: maxRows(sheets), height: 25 },
    col: { len: maxCols(sheets), width: 110, indexWidth: 56, minWidth: 60 },
  });
  ss.loadData(data);
  // Re-layout once the flex host has a real size.
  requestAnimationFrame(() => {
    try {
      ss.reRender();
    } catch {
      /* ignore */
    }
  });
  return ss;
}

function maxRows(sheets) {
  return Math.max(50, ...sheets.map((s) => s.rows.length + 5));
}
function maxCols(sheets) {
  return Math.max(26, ...sheets.map((s) => Math.max(0, ...s.rows.map((r) => r.length)) + 2));
}

/** Convert {name, rows, merges} → x-data-spreadsheet sheet JSON. */
function toXSheet({ name, rows, merges = [] }) {
  const xrows = {};
  rows.forEach((row, r) => {
    const cells = {};
    row.forEach((val, c) => {
      if (val === null || val === undefined || val === '') return;
      cells[c] = { text: String(val) };
    });
    if (Object.keys(cells).length) xrows[r] = { cells };
  });
  xrows.len = Math.max(50, rows.length + 5);

  const xmerges = merges.map((m) => `${cellRef(m.s.r, m.s.c)}:${cellRef(m.e.r, m.e.c)}`);
  // Merged anchor cells need a `merge: [rowspan, colspan]` on the top-left cell.
  merges.forEach((m) => {
    const r = m.s.r;
    const c = m.s.c;
    if (!xrows[r]) xrows[r] = { cells: {} };
    if (!xrows[r].cells[c]) xrows[r].cells[c] = { text: '' };
    xrows[r].cells[c].merge = [m.e.r - m.s.r, m.e.c - m.s.c];
  });

  return { name: name || 'Sheet', rows: xrows, merges: xmerges };
}

function cellRef(r, c) {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s}${r + 1}`;
}
