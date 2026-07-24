// Agent tests: HTTP pipeline, conversion (via mock soffice), caching, and the
// localhost CORS / Host-header security guards. No real LibreOffice needed.
import { spawn } from 'node:child_process';
import { request as httpRequest, createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 7395;
const base = `http://127.0.0.1:${PORT}`;

// Start from a clean cache so the cache-miss assertion is deterministic on re-run.
rmSync(resolve(here, '.agent-cache'), { recursive: true, force: true });
rmSync(resolve(here, '.agent-cache2'), { recursive: true, force: true });
let server2 = null;
let central = null;

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    fail++;
  }
}

const server = spawn(process.execPath, [resolve(here, '../agent/server.mjs')], {
  env: {
    ...process.env,
    MV_PORT: String(PORT),
    SOFFICE_PATH: resolve(here, 'mock-soffice.mjs'),
    MV_CACHE_DIR: resolve(here, '.agent-cache'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return await r.json();
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('agent did not start');
}

try {
  const health = await waitUp();
  ok('health: ok + soffice detected (mock)', health.ok && health.soffice === true, JSON.stringify(health));
  ok('health: lists convertible formats', Array.isArray(health.formats) && health.formats.includes('doc'));

  // Convert (mock produces a valid %PDF)
  const body = new Uint8Array([1, 2, 3, 4, 5]);
  const conv = await fetch(`${base}/convert`, {
    method: 'POST',
    headers: { 'X-Filename': 'sample.doc', 'Content-Type': 'application/octet-stream' },
    body,
  });
  const buf = new Uint8Array(await conv.arrayBuffer());
  const head = String.fromCharCode(...buf.slice(0, 4));
  ok('convert: 200 application/pdf', conv.status === 200 && conv.headers.get('content-type') === 'application/pdf', `status=${conv.status}`);
  ok('convert: body is a PDF', head === '%PDF', `head=${head}`);
  ok('convert: first call is cache miss', conv.headers.get('x-mv-cache') === 'miss');

  const conv2 = await fetch(`${base}/convert`, {
    method: 'POST',
    headers: { 'X-Filename': 'sample.doc' },
    body,
  });
  await conv2.arrayBuffer();
  ok('convert: second identical call is cache hit', conv2.headers.get('x-mv-cache') === 'hit');

  // CORS: allowed localhost origin
  const good = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:3000' } });
  ok('CORS: localhost origin echoed', good.headers.get('access-control-allow-origin') === 'http://localhost:3000');

  // CORS: disallowed origin → 403
  const bad = await fetch(`${base}/health`, { headers: { Origin: 'http://evil.example.com' } });
  ok('CORS: foreign origin rejected (403)', bad.status === 403, `status=${bad.status}`);

  // Preflight for foreign origin → 403
  const pre = await fetch(`${base}/convert`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example.com' } });
  ok('CORS: foreign preflight rejected (403)', pre.status === 403, `status=${pre.status}`);

  // Private Network Access: preflight opt-in header is echoed
  const pna = await fetch(`${base}/convert`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Private-Network': 'true' },
  });
  ok('PNA: allow-private-network echoed', pna.headers.get('access-control-allow-private-network') === 'true', `status=${pna.status}`);

  // Host-header (DNS-rebinding) guard → 403. fetch/undici forbids overriding
  // Host, so use the raw http client to spoof it.
  const badHostStatus = await new Promise((res) => {
    const r = httpRequest({ host: '127.0.0.1', port: PORT, path: '/health', method: 'GET', headers: { Host: 'evil.example.com' } }, (resp) => {
      resp.resume();
      res(resp.statusCode);
    });
    r.on('error', () => res(0));
    r.end();
  });
  ok('Host guard: non-localhost Host rejected (403)', badHostStatus === 403, `status=${badHostStatus}`);

  // --- Wildcard origins (B) via env + central remote list (A) via mock endpoint ---
  const CENTRAL_PORT = 7398;
  central = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ origins: ['https://*.partner.com'] }));
  });
  await new Promise((r) => central.listen(CENTRAL_PORT, '127.0.0.1', r));

  const PORT2 = 7399;
  const base2 = `http://127.0.0.1:${PORT2}`;
  server2 = spawn(process.execPath, [resolve(here, '../agent/server.mjs')], {
    env: {
      ...process.env,
      MV_PORT: String(PORT2),
      SOFFICE_PATH: resolve(here, 'mock-soffice.mjs'),
      MV_CACHE_DIR: resolve(here, '.agent-cache2'),
      MV_ALLOWED_ORIGINS: 'https://*.company.com', // wildcard (B)
      MV_ALLOWED_ORIGINS_URL: `http://127.0.0.1:${CENTRAL_PORT}/origins`, // central list (A)
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let h2 = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base2}/health`);
      if (r.ok) {
        h2 = await r.json();
        if (h2.origins.remote > 0) break; // central list fetched
      }
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  ok('wildcard agent: up + central list loaded', !!h2 && h2.origins.static === 1 && h2.origins.remote === 1, JSON.stringify(h2 && h2.origins));

  const wc = await fetch(`${base2}/health`, { headers: { Origin: 'https://app.company.com' } });
  ok('wildcard static: *.company.com allowed', wc.headers.get('access-control-allow-origin') === 'https://app.company.com');

  const rc = await fetch(`${base2}/health`, { headers: { Origin: 'https://x.partner.com' } });
  ok('central remote: *.partner.com allowed', rc.headers.get('access-control-allow-origin') === 'https://x.partner.com');

  const fc = await fetch(`${base2}/health`, { headers: { Origin: 'https://evil.com' } });
  ok('foreign origin rejected (403)', fc.status === 403, `status=${fc.status}`);
} catch (err) {
  console.log('  ✗ agent test error:', err.message);
  fail++;
} finally {
  server.kill('SIGKILL');
  if (server2) server2.kill('SIGKILL');
  if (central) central.close();
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} agent tests passed`);
process.exit(fail ? 1 : 0);
