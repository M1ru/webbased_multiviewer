// In-browser smoke test: serve the project, load the real viewer page (built
// ESM bundle + separately-hosted assets), render each format we can synthesise,
// and assert the expected DOM appears. Catches runtime/bundling failures that a
// successful build does not (worker path, x-spreadsheet global, pdf.js worker).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.pdf': 'application/pdf', '.csv': 'text/csv', '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const filePath = resolve(root, `.${url}`);
    if (!filePath.startsWith(root)) return res.writeHead(403).end();
    const buf = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const cases = [
  { file: 'sample.txt', expect: '.mv-text', label: 'txt' },
  { file: 'sample.csv', expect: '.mv-grid canvas', label: 'csv' },
  { file: 'sample.xlsx', expect: '.mv-grid canvas', label: 'xlsx' },
  { file: 'sample.docx', expect: '.mv-docx .docx-wrapper', label: 'docx' },
  { file: 'sample.pdf', expect: '.mv-pdf__page', label: 'pdf' },
];

const port = 5199;
await new Promise((r) => server.listen(port, r));
const base = `http://localhost:${port}`;

// Use the pre-installed Chromium in this environment rather than the version
// pinned by the installed playwright package.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const errors = [];
const responses = new Map();
page.on('response', (r) => responses.set(r.url().split('/').pop(), r.status()));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon\.ico/.test(t) && !/status of 404/.test(t)) errors.push(t);
});
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
try {
  await page.goto(`${base}/demo/viewer.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mv, { timeout: 10000 });

  for (const c of cases) {
    try {
      const detected = await page.evaluate(async ({ url, name }) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const det = await window.__mv.render(bytes, name);
        return det.format;
      }, { url: `${base}/test/fixtures/${c.file}`, name: c.file });

      await page.waitForSelector(c.expect, { timeout: 15000 });
      console.log(`  ✓ ${c.label.padEnd(5)} → detected=${detected}, rendered "${c.expect}"`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${c.label.padEnd(5)} FAILED: ${String(err).split('\n')[0]}`);
    }
  }

  // rhwp probe: route a .hwp (OLE2 magic) to the rhwp viewer and confirm the
  // 7 MB WASM loads/instantiates from the hosted assetsPath. The garbage body
  // then fails to parse → error panel, which is the expected outcome here.
  try {
    const detected = await page.evaluate(async () => {
      const b = new Uint8Array(512);
      b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2 signature
      const det = await window.__mv.render(b, 'probe.hwp');
      return det.format;
    });
    await page.waitForSelector('.mv-message', { timeout: 20000 });
    const wasmStatus = responses.get('rhwp_bg.wasm');
    const ok = detected === 'hwp' && wasmStatus === 200;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} hwp   → detected=${detected}, rhwp_bg.wasm HTTP ${wasmStatus} (WASM load)`);
  } catch (err) {
    failed++;
    console.log(`  ✗ hwp   FAILED: ${String(err).split('\n')[0]}`);
  }
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.log('\nBrowser errors:');
  for (const e of errors.slice(0, 15)) console.log('  ! ' + e);
}
console.log(failed ? `\n${failed} case(s) failed` : '\nAll smoke cases passed');
process.exit(failed || errors.length ? 1 : 0);
