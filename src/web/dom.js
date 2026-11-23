// src/web/dom.js — the tiny DOM helpers every view and effect builds with.
//
// `el()` is the one node factory (class, text, attrs, listeners, kids); `keywordText()`
// fills a node with kernel glossary words wrapped in gold spans; `toast()` and
// `announce()` are the two feedback channels; `capitalize()` and `sceneIllus()` are
// shared small builders. Nothing here knows a rule.

import { snap, toastEl, liveEl } from './runtime.js';


export function el(tag, opts = {}, ...kids) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) node.addEventListener(k, v);
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

/**
 * Fill `node` with `text`, wrapping kernel glossary words (Block, Vulnerable, Exhaust…)
 * in gold keyword spans with the kernel's own meaning as the tooltip, and "Lose N HP"
 * costs in ember red. Text nodes only: nothing is parsed as HTML. Presentation only.
 * @param {HTMLElement} node
 * @param {string} text
 * @returns {HTMLElement}
 */
export function keywordText(node, text) {
  const terms = new Map();
  for (const row of snap.glossary || []) {
    if ((row.group === 'A' || row.group === 'B') && /^[A-Z][a-z]+$/.test(row.label || '')) terms.set(row.label.toLowerCase(), row.meaning);
  }
  const str = String(text ?? '');
  if (terms.size === 0) { node.textContent = str; return node; }
  const words = [...terms.keys()].sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(Lose \\d+ (?:max )?HP)|\\b(${words})\\b`, 'gi');
  let at = 0;
  for (const m of str.matchAll(re)) {
    if (m.index > at) node.append(str.slice(at, m.index));
    if (m[1]) node.append(el('span', { cls: 'kw kw-cost', text: m[1] }));
    else node.append(el('span', { cls: 'kw', text: m[2], attrs: { title: terms.get(m[2].toLowerCase()) || '' } }));
    at = m.index + m[0].length;
  }
  if (at < str.length) node.append(str.slice(at));
  return node;
}

export function toast(msg, kind = 'warn') {
  toastEl.textContent = msg;
  toastEl.className = kind === 'info' ? 'show info' : 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.className = ''; }, 1600);
}

/**
 * Announce a line to the live region so the pending state is not purely visual. A fresh
 * text node is appended rather than assigning {textContent} twice, so a repeat of the
 * same sentence is still a change the assistive technology can see.
 * @param {string} msg
 */
export function announce(msg) {
  if (!liveEl) return;
  liveEl.replaceChildren(document.createTextNode(msg));
}

export const capitalize = (s) => (typeof s === 'string' && s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);

/** Header illustration for the reward and rest scenes: a local WebP, decorative only. */
export function sceneIllus(key) {
  const box = el('div', { cls: `scene-illus scene-${key}`, attrs: { 'aria-hidden': 'true' } });
  box.append(el('img', { attrs: { src: `assets/sprites/${key}.webp`, alt: '', draggable: 'false', decoding: 'async' } }));
  return box;
}

/** Centre an fx node on a measured point (the node's own CSS size does the rest). */
export function placeAt(node, p, dx = 0, dy = 0) {
  node.style.left = `${p.x + dx}px`;
  node.style.top = `${p.y + dy}px`;
}
