// OLE2 / Compound File Binary reader.
//
// `readOle2StreamNames` lists directory entry names so detection can tell
// doc / xls / ppt / hwp apart (they share the CFB signature).
//
// `readOle2` parses the whole container (FAT, mini-FAT, directory tree) and can
// return the bytes of any stream — used by the HWP viewer to reach BodyText.

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/**
 * Parse a compound file into a directory of streams.
 * @param {Uint8Array} bytes
 * @returns {{ names: string[], stream(path:string): Uint8Array|null, root: Object }}
 */
export function readOle2(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) {
    throw new Error('Not an OLE2 file');
  }

  const sectorShift = dv.getUint16(30, true);
  const miniShift = dv.getUint16(32, true);
  const sectorSize = 1 << sectorShift; // 512 (v3) or 4096 (v4)
  const miniSize = 1 << miniShift; // usually 64
  const miniCutoff = dv.getUint32(56, true); // usually 4096
  const numFatSectors = dv.getUint32(44, true);
  const firstDirSector = dv.getUint32(48, true);
  const firstMiniFat = dv.getUint32(60 - 4, true); // offset 56 is cutoff; miniFAT start is 60
  const miniFatStart = dv.getUint32(60, true);
  const numMiniFat = dv.getUint32(64 - 0, true); // offset 64
  const firstDifat = dv.getUint32(68, true);
  const numDifatSectors = dv.getUint32(72, true);

  const sectorOffset = (s) => (s + 1) * sectorSize;
  const perSector = sectorSize / 4;

  // ---- FAT ----
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const loc = dv.getUint32(76 + i * 4, true);
    if (loc === FREESECT || loc === ENDOFCHAIN) break;
    fatSectors.push(loc);
  }
  let difat = firstDifat;
  let guard = 0;
  while (difat !== ENDOFCHAIN && difat !== FREESECT && numDifatSectors > 0 && guard++ < 1_000_000) {
    const base = sectorOffset(difat);
    for (let i = 0; i < perSector - 1; i++) {
      const loc = dv.getUint32(base + i * 4, true);
      if (loc === FREESECT || loc === ENDOFCHAIN) break;
      fatSectors.push(loc);
    }
    difat = dv.getUint32(base + (perSector - 1) * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((sec, idx) => {
    const base = sectorOffset(sec);
    for (let i = 0; i < perSector; i++) fat[idx * perSector + i] = dv.getUint32(base + i * 4, true);
  });

  const followFat = (start) => {
    const chain = [];
    let s = start;
    let g = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && g++ < 10_000_000) {
      chain.push(s);
      s = s < fat.length ? fat[s] : ENDOFCHAIN;
    }
    return chain;
  };

  const readFatStream = (start, size) => {
    const chain = followFat(start);
    const out = new Uint8Array(chain.length * sectorSize);
    chain.forEach((s, i) => out.set(bytes.subarray(sectorOffset(s), sectorOffset(s) + sectorSize), i * sectorSize));
    return size != null ? out.subarray(0, size) : out;
  };

  // ---- Directory entries ----
  const dirBytes = readFatStream(firstDirSector);
  const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const decoder = new TextDecoder('utf-16le');
  const dir = [];
  for (let i = 0; i + 128 <= dirBytes.length; i++) {
    const off = i * 128;
    if (off + 128 > dirBytes.length) break;
    const nameLen = ddv.getUint16(off + 64, true);
    const type = ddv.getUint8(off + 66);
    const name = nameLen >= 2 ? decoder.decode(dirBytes.subarray(off, off + nameLen - 2)) : '';
    dir.push({
      name,
      type, // 0 unused, 1 storage, 2 stream, 5 root
      start: ddv.getUint32(off + 116, true),
      size: Number(ddv.getBigUint64 ? ddv.getBigUint64(off + 120, true) : BigInt(ddv.getUint32(off + 120, true))),
    });
    if (off + 128 >= dirBytes.length) break;
  }

  // ---- Mini stream (small streams live inside the root entry's stream) ----
  const root = dir.find((e) => e.type === 5);
  const miniStreamBytes = root ? readFatStream(root.start, root.size) : new Uint8Array(0);

  // mini-FAT
  const miniFatBytes = miniFatStart === ENDOFCHAIN ? new Uint8Array(0) : readFatStream(miniFatStart);
  const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4));
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mdv.getUint32(i * 4, true);

  const readMiniStream = (start, size) => {
    const out = new Uint8Array(Math.ceil(size / miniSize) * miniSize);
    let s = start;
    let i = 0;
    let g = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && g++ < 10_000_000) {
      const from = s * miniSize;
      out.set(miniStreamBytes.subarray(from, from + miniSize), i * miniSize);
      s = s < miniFat.length ? miniFat[s] : ENDOFCHAIN;
      i++;
    }
    return out.subarray(0, size);
  };

  const streamOf = (entry) => {
    if (!entry || entry.type !== 2) return null;
    return entry.size < miniCutoff ? readMiniStream(entry.start, entry.size) : readFatStream(entry.start, entry.size);
  };

  const names = dir.filter((e) => e.type === 1 || e.type === 2).map((e) => e.name);

  return {
    names,
    root,
    entries: dir,
    /** Read a stream by name (last path segment). Case-insensitive. */
    stream(path) {
      const target = String(path).split('/').pop().toLowerCase();
      const entry = dir.find((e) => e.type === 2 && e.name.toLowerCase() === target);
      return streamOf(entry);
    },
    /** All stream entries whose name matches a predicate. */
    findStreams(predicate) {
      return dir.filter((e) => e.type === 2 && predicate(e.name)).map((e) => ({ name: e.name, data: streamOf(e) }));
    },
  };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string[]} directory entry names (storages + streams)
 */
export function readOle2StreamNames(bytes) {
  return readOle2(bytes).names;
}
