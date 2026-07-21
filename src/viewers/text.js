// Plain-text viewer. Decodes with encoding detection (UTF-8 / EUC-KR / UTF-16).

import { el } from '../utils/dom.js';
import { decodeText } from '../utils/encoding.js';

export default function render(container, ctx) {
  const { text, encoding } = decodeText(ctx.bytes);
  const lines = text.split(/\r\n|\r|\n/).length;

  container.append(
    toolbar(ctx.filename, [`${encoding}`, `${lines.toLocaleString()} lines`]),
    el('pre', { class: 'mv-text' }, text)
  );
}

export function toolbar(name, tags = [], extra = []) {
  return el('div', { class: 'mv-toolbar' }, [
    el('span', { class: 'mv-toolbar__name', title: name }, name || ''),
    el('span', { class: 'mv-toolbar__spacer' }),
    ...tags.map((t) => el('span', { class: 'mv-tag' }, t)),
    ...extra,
  ]);
}
