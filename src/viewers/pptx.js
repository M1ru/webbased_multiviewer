// PPTX viewer powered by pptx-viewer, which parses the OOXML package and
// renders each slide to SVG (crisp, offline, old-Chromium friendly).

import { loadPresentation, renderSlideToElement } from 'pptx-viewer';
import { el } from '../utils/dom.js';
import { toolbar } from './text.js';

export default async function render(container, ctx) {
  const presentation = await loadPresentation(ctx.bytes);
  const slides = presentation.slides || [];

  container.append(toolbar(ctx.filename, ['PPTX', `${slides.length} slides`]));
  const deck = el('div', { class: 'mv-pptx' });
  container.append(deck);

  slides.forEach((_, i) => {
    const card = el('div', { class: 'mv-slide' });
    card.append(el('div', { class: 'mv-slide__no' }, `${i + 1}`));
    const body = el('div', { class: 'mv-slide__body' });
    card.append(body);
    deck.append(card);
    try {
      renderSlideToElement(presentation, i, body);
      const svg = body.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
      }
    } catch (err) {
      body.append(el('div', { class: 'mv-slide__empty' }, `슬라이드 ${i + 1} 렌더 실패`));
      console.warn('[MultiViewer/pptx]', err);
    }
  });

  if (!slides.length) {
    deck.append(el('div', { class: 'mv-message__detail' }, '슬라이드를 찾지 못했습니다.'));
  }

  // Release blob URLs when the surface is removed.
  if (typeof presentation.dispose === 'function') {
    const observer = new MutationObserver(() => {
      if (!document.contains(deck)) {
        try {
          presentation.dispose();
        } catch {
          /* ignore */
        }
        observer.disconnect();
      }
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
  }
}
