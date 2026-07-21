// Legacy binary Office formats: .doc (Word 97-2003) and .ppt (PowerPoint 97-2003).
//
// These OLE2 formats have no reliable pure-JS renderer. Per the chosen
// "client-only" route we do NOT convert them; instead we give an honest notice
// plus a best-effort *text* extraction scraped from the relevant OLE2 stream, so
// the user still gets the gist and can download the original.

import { readOle2 } from '../core/ole2.js';
import { el, messagePanel } from '../utils/dom.js';
import { downloadButton } from './fallback.js';

export default function render(container, ctx) {
  let text = '';
  try {
    const cfb = readOle2(ctx.bytes);
    const streamName = ctx.format === 'ppt' ? 'PowerPoint Document' : 'WordDocument';
    const stream = cfb.stream(streamName);
    if (stream) text = scrapeText(stream);
  } catch (err) {
    console.warn('[MultiViewer/legacy]', err);
  }

  container.append(
    messagePanel({
      icon: ctx.format === 'ppt' ? '📽️' : '📄',
      title: `${ctx.format.toUpperCase()} — 제한된 미리보기`,
      detail:
        '구형 바이너리 형식이라 서식 그대로의 렌더링은 지원하지 않습니다. ' +
        '아래는 문서에서 추출한 텍스트이며, 원본은 내려받아 확인할 수 있습니다.',
      actions: [downloadButton(ctx)],
    })
  );

  if (text.trim()) {
    container.append(el('pre', { class: 'mv-text mv-text--extract' }, text));
  } else {
    container.append(el('div', { class: 'mv-message__detail' }, '추출 가능한 텍스트를 찾지 못했습니다.'));
  }
}

/**
 * Pull readable runs out of a binary stream: both single-byte (Latin/CP949-ish)
 * and UTF-16LE runs of a minimum length. Deliberately conservative to avoid
 * dumping binary noise.
 */
function scrapeText(bytes) {
  const parts = [];

  // UTF-16LE runs (Word stores much of its text this way).
  let run = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (isPrintable(code)) {
      run.push(code);
    } else {
      if (run.length >= 6) parts.push(String.fromCharCode(...run));
      run = [];
    }
  }
  if (run.length >= 6) parts.push(String.fromCharCode(...run));

  // Single-byte ASCII runs, as a fallback for streams stored 8-bit.
  run = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c >= 0x20 && c < 0x7f) run.push(c);
    else {
      if (run.length >= 8) parts.push(String.fromCharCode(...run));
      run = [];
    }
  }
  if (run.length >= 8) parts.push(String.fromCharCode(...run));

  return dedupe(parts).join('\n');
}

function isPrintable(code) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code < 0x20) return false;
  if (code >= 0x7f && code <= 0x9f) return false;
  if (code === 0xfffe || code === 0xffff) return false;
  return true;
}

function dedupe(parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
