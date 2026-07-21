// Unit tests for format detection. Runs in Node (detect.js is DOM-free).
import assert from 'node:assert';
import { zipSync, strToU8 } from 'fflate';
import { detectFormat } from '../src/core/detect.js';

let pass = 0;
let fail = 0;
function check(label, bytes, name, expected) {
  const { format } = detectFormat(bytes instanceof Uint8Array ? bytes : strToU8(bytes), name);
  try {
    assert.strictEqual(format, expected);
    console.log(`  ✓ ${label} → ${format}`);
    pass++;
  } catch {
    console.log(`  ✗ ${label} → got ${format}, expected ${expected}`);
    fail++;
  }
}

const ole2 = (name) => {
  const b = new Uint8Array(64);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return { b, name };
};
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

// PDF
check('pdf magic', '%PDF-1.7\n...', 'x.pdf', 'pdf');

// OOXML — classified by inner parts (magic), not extension
check('docx', zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' }), 'a.docx', 'docx');
check('xlsx', zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<w/>' }), 'a.xlsx', 'xlsx');
check('pptx', zip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' }), 'a.pptx', 'pptx');
check('hwpx', zip({ 'version.xml': '<v/>', 'Contents/section0.xml': '<s/>' }), 'a.hwpx', 'hwpx');

// Extension mismatch should still trust the container contents
check('docx mislabeled .txt', zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' }), 'a.txt', 'docx');

// OLE2 — garbage body falls back to extension
check('doc via ext', ole2().b, 'a.doc', 'doc');
check('xls via ext', ole2().b, 'a.xls', 'xls');
check('ppt via ext', ole2().b, 'a.ppt', 'ppt');
check('hwp via ext', ole2().b, 'a.hwp', 'hwp');

// Text family
check('txt', 'hello world\nsecond line\n', 'a.txt', 'txt');
check('csv by ext', 'a,b,c\n1,2,3\n', 'a.csv', 'csv');
check('csv by heuristic (no ext)', 'name,age,city\nkim,20,seoul\nlee,30,busan\n', 'noext', 'csv');
check('txt by heuristic (no ext)', 'just some prose without delimiters here\nanother line\n', 'noext', 'txt');

// Unknown
check('unknown binary', new Uint8Array([0x00, 0x01, 0x02, 0x99, 0xfe]), 'a.bin', 'unknown');

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} detection tests passed`);
process.exit(fail ? 1 : 0);
