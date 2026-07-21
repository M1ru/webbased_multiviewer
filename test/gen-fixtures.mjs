// Generate sample files for the smoke test. Only formats we can synthesise
// reliably in Node: txt, csv, xlsx (SheetJS), and a minimal hand-built PDF.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { zipSync, strToU8 } from 'fflate';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(dir, { recursive: true });

// --- txt (includes Korean to exercise decoding) ---
writeFileSync(resolve(dir, 'sample.txt'), '안녕하세요 MultiViewer\nline 2\n숫자 12345\n');

// --- csv ---
writeFileSync(resolve(dir, 'sample.csv'), '이름,나이,도시\n홍길동,30,서울\n김철수,25,부산\n');

// --- xlsx ---
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['제품', '수량', '단가'],
  ['사과', 10, 1500],
  ['배', 5, 3000],
]);
XLSX.utils.book_append_sheet(wb, ws, '재고');
XLSX.writeFile(wb, resolve(dir, 'sample.xlsx'));

// --- minimal but valid DOCX (OOXML zip) ---
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const docx = zipSync({
  '[Content_Types].xml': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CT}"/></Types>`
  ),
  '_rels/.rels': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ),
  'word/document.xml': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>안녕하세요 DOCX MultiViewer</w:t></w:r></w:p></w:body></w:document>'
  ),
});
writeFileSync(resolve(dir, 'sample.docx'), docx);

// --- minimal PDF with a correct xref table ---
writeFileSync(resolve(dir, 'sample.pdf'), buildPdf());

function buildPdf() {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    (() => {
      const stream = 'BT /F1 24 Tf 40 120 Td (Hello MultiViewer) Tj ET';
      return `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
    })(),
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

console.log('fixtures written to', dir);
