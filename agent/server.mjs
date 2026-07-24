// MultiViewer local conversion agent.
//
// A small dependency-free HTTP service that converts office/HWP documents to
// PDF via LibreOffice headless, so the browser viewer can render everything
// through pdf.js. Designed to run on the user's own machine.
//
// Security posture (localhost agent):
//   - binds 127.0.0.1 only
//   - CORS restricted to localhost/127.0.0.1 origins by default (configurable)
//   - Host header must be localhost/127.0.0.1 (mitigates DNS-rebinding)
//   - optional shared token (X-MV-Token)
//   - request body size limit
//
// Endpoints:
//   GET  /health            → { ok, soffice, formats, version }
//   POST /convert           → body: raw bytes, header X-Filename; returns application/pdf
//
// Config via env: MV_PORT, MV_TOKEN, MV_ALLOWED_ORIGINS (comma list of exact or
//   wildcard patterns, or '*'), MV_ALLOWED_ORIGINS_URL (central list endpoint),
//   MV_ALLOWED_ORIGINS_TOKEN, MV_ORIGINS_REFRESH_MS, MV_MAX_BYTES,
//   MV_CONCURRENCY, MV_CACHE_DIR, MV_TIMEOUT_MS, SOFFICE_PATH.
//
// Build-time defaults (baked into the exe by packaging/build-agent.mjs):
//   --default-origins, --default-origins-url. Env vars override them.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertToPdf, probeSoffice, CONVERTIBLE } from './convert.mjs';
import { createOriginStore, parsePatterns } from './origins.js';

// Compiled-in defaults (replaced by esbuild `define` in the SEA build; undefined
// when running from source, hence the typeof guards).
const BAKED_ORIGINS = typeof __MV_DEFAULT_ORIGINS__ !== 'undefined' ? __MV_DEFAULT_ORIGINS__ : '';
const BAKED_ORIGINS_URL = typeof __MV_DEFAULT_ORIGINS_URL__ !== 'undefined' ? __MV_DEFAULT_ORIGINS_URL__ : '';

const cfg = {
  host: '127.0.0.1',
  port: Number(process.env.MV_PORT || 7391),
  token: process.env.MV_TOKEN || '',
  originsStatic: parsePatterns(process.env.MV_ALLOWED_ORIGINS || BAKED_ORIGINS),
  originsUrl: process.env.MV_ALLOWED_ORIGINS_URL || BAKED_ORIGINS_URL || '',
  originsToken: process.env.MV_ALLOWED_ORIGINS_TOKEN || '',
  originsRefreshMs: Number(process.env.MV_ORIGINS_REFRESH_MS || 5 * 60 * 1000),
  maxBytes: Number(process.env.MV_MAX_BYTES || 100 * 1024 * 1024),
  concurrency: Number(process.env.MV_CONCURRENCY || 2),
  cacheDir: process.env.MV_CACHE_DIR || join(tmpdir(), 'mv-agent-cache'),
  timeoutMs: Number(process.env.MV_TIMEOUT_MS || 120000),
  sofficePath: process.env.SOFFICE_PATH || 'soffice',
};

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

// Allow-list: localhost (dev) + static wildcard patterns + optional central list.
const originStore = createOriginStore({
  staticPatterns: cfg.originsStatic,
  url: cfg.originsUrl,
  token: cfg.originsToken,
  cacheFile: join(cfg.cacheDir, 'allowed-origins.json'),
  refreshMs: cfg.originsRefreshMs,
  log: (m) => console.log(`[mv-agent] ${m}`),
});

/** Is this Origin permitted? localhost always; else static/remote patterns. */
function originAllowed(origin) {
  if (!origin) return true; // non-CORS client (curl, native) — browser always sends Origin
  if (LOCAL_ORIGIN.test(origin)) return true;
  return originStore.allowed(origin);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-MV-Token');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return origin;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Simple concurrency gate so we don't launch unbounded soffice processes.
let active = 0;
const queue = [];
function acquire() {
  if (active < cfg.concurrency) {
    active++;
    return Promise.resolve();
  }
  return new Promise((r) => queue.push(r));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

let sofficeVersion = null;

const server = createServer(async (req, res) => {
  const origin = applyCors(req, res);

  // DNS-rebinding guard: the Host we were reached by must be localhost.
  const host = req.headers.host || '';
  if (host && !LOCAL_HOST.test(host)) return json(res, 403, { error: 'host not allowed' });

  if (req.method === 'OPTIONS') {
    // Reject disallowed origins outright at preflight.
    if (origin && !originAllowed(origin)) return json(res, 403, { error: 'origin not allowed' });
    // Private Network Access: modern Chrome preflights public→localhost calls
    // and requires this opt-in header, otherwise the request is blocked.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204).end();
    return;
  }

  if (origin && !originAllowed(origin)) return json(res, 403, { error: 'origin not allowed' });

  if (cfg.token) {
    const token = req.headers['x-mv-token'];
    if (token !== cfg.token) return json(res, 401, { error: 'invalid token' });
  }

  try {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      if (sofficeVersion === null) sofficeVersion = (await probeSoffice(cfg.sofficePath)) || false;
      return json(res, 200, {
        ok: true,
        soffice: sofficeVersion !== false,
        version: sofficeVersion || null,
        formats: [...CONVERTIBLE],
        concurrency: cfg.concurrency,
        origins: {
          static: originStore.staticCount,
          remote: originStore.remoteCount,
          remoteEnabled: originStore.remoteEnabled,
        },
      });
    }

    if (req.method === 'POST' && url === '/convert') {
      const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'input.bin';
      const body = await readBody(req, cfg.maxBytes);
      if (!body.length) return json(res, 400, { error: 'empty body' });

      // Cache by content hash.
      const hash = createHash('sha256').update(body).digest('hex');
      const cachePath = join(cfg.cacheDir, `${hash}.pdf`);
      if (existsSync(cachePath)) {
        const cached = await readFile(cachePath);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': cached.length, 'X-MV-Cache': 'hit' });
        return res.end(cached);
      }

      await acquire();
      try {
        const pdf = await convertToPdf(body, filename, { sofficePath: cfg.sofficePath, timeoutMs: cfg.timeoutMs });
        await writeFile(cachePath, pdf).catch(() => {});
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'X-MV-Cache': 'miss' });
        res.end(pdf);
      } finally {
        release();
      }
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    const code = err.statusCode || 500;
    json(res, code, { error: String(err.message || err) });
  }
});

// Kept in a function (not top-level await) so the agent can be bundled to a
// single CommonJS file for the SEA executable.
async function start() {
  await mkdir(cfg.cacheDir, { recursive: true }).catch(() => {});
  originStore.start(); // fetch central list (if configured) + schedule refresh
  server.listen(cfg.port, cfg.host, async () => {
    sofficeVersion = (await probeSoffice(cfg.sofficePath)) || false;
    console.log(`[mv-agent] listening on http://${cfg.host}:${cfg.port}`);
    console.log(`[mv-agent] soffice: ${sofficeVersion || 'NOT FOUND — set SOFFICE_PATH'}`);
    const remote = cfg.originsUrl ? ` + central(${cfg.originsUrl})` : '';
    console.log(`[mv-agent] CORS: localhost + ${cfg.originsStatic.length} pattern(s)${remote}`);
    if (cfg.originsStatic.length) console.log(`[mv-agent]   patterns: ${cfg.originsStatic.join(', ')}`);
  });
}

start();

export { server, cfg, start };
