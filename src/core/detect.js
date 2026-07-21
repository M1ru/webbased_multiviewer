// Format detection.
//
// Strategy: never trust the extension alone. We sniff the leading bytes
// (magic number) first, and for container formats (ZIP / OLE2-CFB) we look
// *inside* the container to tell siblings apart, since docx/xlsx/pptx/hwpx all
// share the ZIP signature and doc/xls/ppt/hwp all share the OLE2 signature.

import { readCentralDirectoryNames } from './zip.js';
import { readOle2StreamNames } from './ole2.js';

/** @typedef {'pdf'|'txt'|'csv'|'xlsx'|'xls'|'docx'|'pptx'|'hwp'|'hwpx'|'doc'|'ppt'|'unknown'} FormatId */

const textExt = new Set(['txt', 'text', 'log', 'md', 'json', 'xml', 'yml', 'yaml', 'ini']);

function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

function startsWith(bytes, sig, offset = 0) {
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

const SIG = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  zip: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
  zipEmpty: [0x50, 0x4b, 0x05, 0x06],
  ole2: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};

/**
 * Distinguish OOXML / HWPX / plain-zip by inspecting the archive's entries.
 * @param {Uint8Array} bytes
 */
function classifyZip(bytes) {
  let names = [];
  try {
    names = readCentralDirectoryNames(bytes);
  } catch {
    /* fall through to unknown */
  }
  const has = (n) => names.includes(n);
  const some = (re) => names.some((n) => re.test(n));

  // HWPX: OWPML package — has mimetype "application/hwp+zip" and version.xml.
  if (has('version.xml') || some(/^Contents\/(section\d+|header)\.xml$/) || some(/hwpml|owpml/i)) {
    return 'hwpx';
  }
  // OOXML: parts live under word/, xl/, ppt/.
  if (some(/^word\//)) return 'docx';
  if (some(/^xl\//)) return 'xlsx';
  if (some(/^ppt\//)) return 'pptx';
  return 'unknown';
}

/**
 * Distinguish doc / xls / ppt / hwp by inspecting OLE2 storage/stream names.
 * @param {Uint8Array} bytes
 */
function classifyOle2(bytes) {
  let names = [];
  try {
    names = readOle2StreamNames(bytes).map((n) => n.toLowerCase());
  } catch {
    /* fall through */
  }
  const has = (n) => names.includes(n.toLowerCase());
  // HWP 5.x: OLE2 with a "FileHeader" stream (signature "HWP Document File").
  if (has('fileheader') || has('bodytext') || has('docinfo')) return 'hwp';
  if (has('worddocument')) return 'doc';
  if (has('workbook') || has('book')) return 'xls';
  if (has('powerpoint document') || has('pp40') || has('currentuser')) return 'ppt';
  return 'unknown';
}

/**
 * Detect the format of a file.
 * @param {Uint8Array} bytes  Leading bytes of the file (whole file is fine).
 * @param {string} [filename] Optional original name, used as a tie-breaker.
 * @returns {{ format: FormatId, via: 'magic'|'extension'|'heuristic', ext: string }}
 */
export function detectFormat(bytes, filename = '') {
  const ext = extOf(filename);

  if (startsWith(bytes, SIG.pdf)) return { format: 'pdf', via: 'magic', ext };

  if (startsWith(bytes, SIG.zip) || startsWith(bytes, SIG.zipEmpty)) {
    let format = classifyZip(bytes);
    if (format === 'unknown') {
      // Extension tie-breaker for zip payloads we couldn't classify.
      if (ext === 'docx') format = 'docx';
      else if (ext === 'xlsx') format = 'xlsx';
      else if (ext === 'pptx') format = 'pptx';
      else if (ext === 'hwpx') format = 'hwpx';
    }
    return { format, via: format === 'unknown' ? 'extension' : 'magic', ext };
  }

  if (startsWith(bytes, SIG.ole2)) {
    let format = classifyOle2(bytes);
    if (format === 'unknown') {
      if (ext === 'doc') format = 'doc';
      else if (ext === 'xls') format = 'xls';
      else if (ext === 'ppt') format = 'ppt';
      else if (ext === 'hwp') format = 'hwp';
    }
    return { format, via: format === 'unknown' ? 'extension' : 'magic', ext };
  }

  // No binary signature → text family. Decide csv vs txt.
  if (ext === 'csv' || ext === 'tsv') return { format: 'csv', via: 'extension', ext };
  if (textExt.has(ext)) return { format: 'txt', via: 'extension', ext };

  if (looksLikeText(bytes)) {
    return { format: looksLikeCsv(bytes) ? 'csv' : 'txt', via: 'heuristic', ext };
  }

  // Last resort: trust the extension if we recognise it.
  const byExt = {
    pdf: 'pdf', txt: 'txt', csv: 'csv',
    xlsx: 'xlsx', xls: 'xls', docx: 'docx', doc: 'doc',
    pptx: 'pptx', ppt: 'ppt', hwp: 'hwp', hwpx: 'hwpx',
  }[ext];
  return { format: byExt || 'unknown', via: 'extension', ext };
}

/** Rough "is this text?" check over the first chunk: no NULs, mostly printable. */
function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return true;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false; // NUL ⇒ binary
    // Allow tab/LF/CR and anything >= space; count other control bytes.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++;
  }
  return suspicious / n < 0.1;
}

/** Heuristic: the first few lines have consistent comma/semicolon/tab columns. */
function looksLikeCsv(bytes) {
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
  const lines = sample.split(/\r?\n/).filter((l) => l.length).slice(0, 5);
  if (lines.length < 2) return false;
  for (const delim of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(delim).length);
    if (counts[0] > 1 && counts.every((c) => c === counts[0])) return true;
  }
  return false;
}
