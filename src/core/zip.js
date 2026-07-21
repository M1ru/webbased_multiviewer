// Minimal ZIP reader — just enough to list entry names for format detection.
// We read the End-Of-Central-Directory record, then walk the central directory.
// (Full extraction is delegated to real libraries per-format.)

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;

/**
 * @param {Uint8Array} bytes
 * @returns {string[]} entry names (paths inside the archive)
 */
export function readCentralDirectoryNames(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(dv, bytes.length);
  if (eocd < 0) throw new Error('EOCD not found');

  const total = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  const names = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (let i = 0; i < total && offset + 46 <= bytes.length; i++) {
    if (dv.getUint32(offset, true) !== CDFH_SIG) break;
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    names.push(decoder.decode(bytes.subarray(nameStart, nameStart + nameLen)));
    offset = nameStart + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Scan backwards for the EOCD signature (comment can push it off the very end). */
function findEocd(dv, len) {
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}
