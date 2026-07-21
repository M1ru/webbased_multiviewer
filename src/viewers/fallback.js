// Fallback for formats we couldn't identify or don't support: a clear notice
// plus a download link for the original bytes.

import { el, messagePanel } from '../utils/dom.js';

export default function render(container, ctx) {
  const known = ctx.ext ? `.${ctx.ext}` : '알 수 없는 형식';
  container.append(
    messagePanel({
      icon: '🗂️',
      title: '미리보기를 지원하지 않는 형식입니다',
      detail: `${known} 파일은 이 뷰어에서 표시할 수 없습니다. 원본을 내려받아 확인해 주세요.`,
      actions: [downloadButton(ctx)],
    })
  );
}

/** A download button for the original file. */
export function downloadButton(ctx) {
  const btn = el('button', { class: 'mv-btn mv-btn--primary' }, '원본 다운로드');
  btn.addEventListener('click', () => {
    const blob = ctx.blob || new Blob([ctx.bytes]);
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: ctx.filename || `download.${ctx.ext || 'bin'}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  return btn;
}
