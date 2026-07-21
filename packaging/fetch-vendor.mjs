// Download the third-party binaries the installer bundles, so packaging needs
// no manual steps:
//   - NSSM (service wrapper)      → packaging/vendor/nssm.exe
//   - LibreOffice (portable/MSI)  → packaging/vendor/LibreOffice/program/soffice.exe
//
//   node packaging/fetch-vendor.mjs                 # both
//   node packaging/fetch-vendor.mjs --only nssm     # just NSSM
//   node packaging/fetch-vendor.mjs --lo-version 25.2.5
//
// LibreOffice ships as a Windows MSI; on Windows this script runs an
// administrative extract (msiexec /a) to produce a portable tree. On other
// OSes it downloads the MSI and prints the one extraction command to run on
// Windows (or with 7-Zip). NSSM is a plain zip and is fully handled anywhere.

import { unzipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'packaging', 'vendor');

const args = process.argv.slice(2);
const only = argValue('--only'); // 'nssm' | 'lo'
const loVersion = argValue('--lo-version') || process.env.LO_VERSION || '25.2.5';
const nssmUrl = process.env.NSSM_URL || 'https://nssm.cc/release/nssm-2.24.zip';

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Choose the right nssm.exe from an unzipped archive (prefer win64). */
export function pickNssmExe(files) {
  const names = Object.keys(files);
  const win64 = names.find((n) => /win64\/nssm\.exe$/i.test(n));
  const win32 = names.find((n) => /win32\/nssm\.exe$/i.test(n));
  const any = names.find((n) => /\/nssm\.exe$/i.test(n) || /^nssm\.exe$/i.test(n));
  const pick = win64 || win32 || any;
  if (!pick) throw new Error('nssm.exe not found in archive');
  return files[pick];
}

async function download(url, label) {
  process.stdout.write(`• downloading ${label} …\n  ${url}\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchNssm() {
  const zip = await download(nssmUrl, 'NSSM');
  const files = unzipSync(zip);
  const exe = pickNssmExe(files);
  mkdirSync(vendor, { recursive: true });
  const out = join(vendor, 'nssm.exe');
  writeFileSync(out, exe);
  console.log(`  ✓ ${out} (${exe.length.toLocaleString()} bytes)\n`);
}

async function fetchLibreOffice() {
  const file = `LibreOffice_${loVersion}_Win_x86-64.msi`;
  const stable = `https://download.documentfoundation.org/libreoffice/stable/${loVersion}/win/x86_64/${file}`;
  const archive = `https://downloadarchive.documentfoundation.org/libreoffice/old/${loVersion}/win/x86_64/${file}`;

  let msi;
  try {
    msi = await download(stable, `LibreOffice ${loVersion}`);
  } catch {
    console.log('  (stable channel missed, trying archive…)');
    msi = await download(archive, `LibreOffice ${loVersion} (archive)`);
  }

  mkdirSync(vendor, { recursive: true });
  const msiPath = join(vendor, file);
  writeFileSync(msiPath, msi);
  console.log(`  ✓ ${msiPath} (${(msi.length / 1e6).toFixed(0)} MB)`);

  const target = join(vendor, 'LibreOffice');
  if (process.platform === 'win32') {
    console.log('  • extracting (msiexec /a)…');
    execFileSync('msiexec', ['/a', msiPath, '/qn', `TARGETDIR=${target}`], { stdio: 'inherit' });
    console.log(`  ✓ ${join(target, 'program', 'soffice.exe')}\n`);
  } else {
    console.log(
      `\n  ⚠ Non-Windows host: MSI downloaded but not extracted.\n` +
        `    On Windows, run:\n` +
        `      msiexec /a "${msiPath}" /qn TARGETDIR="${target}"\n` +
        `    (or with 7-Zip: 7z x "${msiPath}" -o"${target}")\n` +
        `    Result must contain: ${join('LibreOffice', 'program', 'soffice.exe')}\n`
    );
  }
}

async function main() {
  if (only !== 'lo') await fetchNssm();
  if (only !== 'nssm') await fetchLibreOffice();
  console.log('vendor 준비 완료. 다음: packaging/README.md 의 Inno Setup 컴파일 단계.');
}

// Only run when invoked directly (keeps pickNssmExe importable for tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('\n✗ 실패:', err.message);
    if (existsSync(vendor)) console.error('  일부 파일은 packaging/vendor 에 남아 있을 수 있습니다.');
    process.exit(1);
  });
}
