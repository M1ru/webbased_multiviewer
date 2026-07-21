// Tiny DOM helpers shared by viewers.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** A centered spinner + label; returns a node you can replace when done. */
export function spinner(label = 'Loading…') {
  return el('div', { class: 'mv-loading' }, [el('div', { class: 'mv-spinner' }), el('span', {}, label)]);
}

/** A friendly error / unsupported panel. */
export function messagePanel({ icon = '📄', title, detail, actions = [] } = {}) {
  return el('div', { class: 'mv-message' }, [
    el('div', { class: 'mv-message__icon' }, icon),
    title && el('div', { class: 'mv-message__title' }, title),
    detail && el('div', { class: 'mv-message__detail' }, detail),
    actions.length && el('div', { class: 'mv-message__actions' }, actions),
  ]);
}
