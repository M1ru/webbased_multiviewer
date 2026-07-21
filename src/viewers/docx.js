// DOCX viewer — docx-preview renders Word documents to styled HTML with good
// fidelity (page layout, tables, images, numbering).

import { renderAsync } from 'docx-preview';
import { el } from '../utils/dom.js';
import { toolbar } from './text.js';

export default async function render(container, ctx) {
  container.append(toolbar(ctx.filename, ['DOCX']));
  const surface = el('div', { class: 'mv-docx' });
  container.append(surface);

  await renderAsync(ctx.blob, surface, undefined, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    useBase64URL: true,
    experimental: true,
  });
}
