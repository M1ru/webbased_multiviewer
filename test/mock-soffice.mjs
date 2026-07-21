#!/usr/bin/env node
// A stand-in for `soffice` used to test the agent without a working LibreOffice.
// Understands the subset of CLI we invoke: --version, and
// --convert-to pdf --outdir <dir> <input>. Writes a minimal valid PDF.
import { writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('MockOffice 1.0 (mock)');
  process.exit(0);
}

const outIdx = args.indexOf('--outdir');
const outdir = outIdx >= 0 ? args[outIdx + 1] : '.';
const input = args[args.length - 1];
const base = basename(input, extname(input));

const pdf =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF';
writeFileSync(join(outdir, `${base}.pdf`), pdf);
process.exit(0);
