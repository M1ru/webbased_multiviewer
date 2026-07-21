// Offline test for the vendor-fetch extraction logic (the network download
// itself runs on the user's build machine). We synthesise an NSSM-shaped zip
// and verify the correct executable is selected.
import assert from 'node:assert';
import { zipSync, strToU8 } from 'fflate';
import { unzipSync } from 'fflate';
import { pickNssmExe } from '../packaging/fetch-vendor.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    fail++;
  }
}

// win64 preferred over win32
const zip = zipSync({
  'nssm-2.24/win32/nssm.exe': strToU8('WIN32-BINARY'),
  'nssm-2.24/win64/nssm.exe': strToU8('WIN64-BINARY'),
  'nssm-2.24/README.txt': strToU8('readme'),
});
const files = unzipSync(zip);
const exe = pickNssmExe(files);
ok('picks win64 nssm.exe', new TextDecoder().decode(exe) === 'WIN64-BINARY');

// falls back to win32 when win64 absent
const zip32 = zipSync({ 'nssm/win32/nssm.exe': strToU8('ONLY32') });
ok('falls back to win32', new TextDecoder().decode(pickNssmExe(unzipSync(zip32))) === 'ONLY32');

// throws when no nssm.exe present
let threw = false;
try {
  pickNssmExe(unzipSync(zipSync({ 'other/file.txt': strToU8('x') })));
} catch {
  threw = true;
}
ok('throws when nssm.exe missing', threw);

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} vendor tests passed`);
process.exit(fail ? 1 : 0);
