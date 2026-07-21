// xlsx / xls viewer — parse with SheetJS, render every sheet in the grid.

import * as XLSX from 'xlsx';
import { renderGrid } from './grid.js';

export default function render(container, ctx) {
  const wb = XLSX.read(ctx.bytes, { type: 'array', cellDates: true });

  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,       // array-of-arrays
      raw: false,      // formatted strings (dates, numbers) as displayed
      defval: '',
      blankrows: true,
    });
    const merges = (ws['!merges'] || []).map((m) => ({ s: m.s, e: m.e }));
    return { name, rows, merges };
  });

  const nonEmpty = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];
  renderGrid(container, nonEmpty, {
    filename: ctx.filename,
    tags: [ctx.format.toUpperCase(), `${nonEmpty.length} sheet${nonEmpty.length > 1 ? 's' : ''}`],
  });
}
