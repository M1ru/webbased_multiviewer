// Build the conversion agent into a single self-contained executable using
// Node's official SEA (Single Executable Applications) feature.
//
//   node packaging/build-agent.mjs                 → host-platform binary
//   node packaging/build-agent.mjs --node <path> --out mv-agent.exe
//
// Cross-compiling for Windows from any OS: pass the Windows node.exe via
// --node (download from https://nodejs.org/dist/<ver>/win-x64/node.exe). The
// blob generation uses the local node, and postject (pure JS) injects into the
// target binary regardless of host OS.
//
// Steps: esbuild bundle (mjs → single cjs) → SEA blob → copy target node →
// postject inject → executable.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { inject } from 'postject';
import { readFile } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');
const bundle = join(outDir, 'mv-agent.cjs');
const blob = join(outDir, 'mv-agent.blob');
const seaConfig = join(outDir, 'sea-config.json');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const args = process.argv.slice(2);
const nodeBin = argValue('--node') || process.execPath;
const isWindows = /\.exe$/i.test(nodeBin) || argValue('--out')?.endsWith('.exe') || process.platform === 'win32';
const outFile = resolve(root, argValue('--out') || (isWindows ? 'build/mv-agent.exe' : 'build/mv-agent'));

// Build-time defaults baked into the exe. Handy for enterprise rollout so the
// installed agent already knows its allowed origins / central-list URL without
// per-machine env vars. Env vars still override these at runtime.
const defaultOrigins = argValue('--default-origins') || '';
const defaultOriginsUrl = argValue('--default-origins-url') || '';

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

mkdirSync(outDir, { recursive: true });

// 1) Bundle the ESM agent to a single CommonJS file (SEA main must be CJS).
console.log('• bundling agent (esbuild)…');
if (defaultOrigins) console.log(`  default-origins: ${defaultOrigins}`);
if (defaultOriginsUrl) console.log(`  default-origins-url: ${defaultOriginsUrl}`);
await build({
  entryPoints: [join(root, 'agent/server.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: bundle,
  legalComments: 'none',
  define: {
    __MV_DEFAULT_ORIGINS__: JSON.stringify(defaultOrigins),
    __MV_DEFAULT_ORIGINS_URL__: JSON.stringify(defaultOriginsUrl),
  },
});

// 2) SEA config + blob.
console.log('• generating SEA blob…');
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3) Copy the target node binary and inject the blob.
console.log(`• injecting into ${isWindows ? 'Windows' : 'host'} node binary…`);
copyFileSync(nodeBin, outFile);
const resource = await readFile(blob);
await inject(outFile, 'NODE_SEA_BLOB', resource, {
  sentinelFuse: SENTINEL,
  ...(process.platform === 'darwin' && !isWindows ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (!isWindows) chmodSync(outFile, 0o755);

rmSync(seaConfig, { force: true });
console.log(`\n✓ built ${outFile}`);
