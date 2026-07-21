// CSV / TSV viewer — parse with PapaParse, render in the spreadsheet grid.

import Papa from 'papaparse';
import { decodeText } from '../utils/encoding.js';
import { renderGrid } from './grid.js';

export default function render(container, ctx) {
  const { text, encoding } = decodeText(ctx.bytes);
  const delimiter = ctx.ext === 'tsv' ? '\t' : '';
  const parsed = Papa.parse(text, {
    delimiter, // '' → auto-detect , ; \t |
    skipEmptyLines: 'greedy',
  });

  const rows = parsed.data;
  renderGrid(container, [{ name: 'CSV', rows }], {
    filename: ctx.filename,
    tags: [encoding, `${rows.length.toLocaleString()} rows`],
  });
}
