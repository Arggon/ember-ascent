import { el } from './dom.js';
import { glyphBox } from './glyphs.js';

/**
 * Wrap one phase in an "engraved page": a faint chapter line and a large watermark
 * glyph behind the content. Purely atmospheric — no meaning lives in the watermark.
 * @param {string} kind phase name, used for the class hook
 * @param {string} chapter the faint uppercase line
 * @param {string} mark a GLYPHS key
 * @param {string} extra extra classes for the page element
 * @param {Element[]} kids the real content
 */
export function page(kind, chapter, mark, extra, kids) {
  const wrap = el('div', { cls: 'page page-' + kind + (extra ? ' ' + extra : '') },
    el('span', { cls: 'page-num', text: chapter }),
  );
  for (const kid of kids) wrap.append(kid);
  wrap.append(glyphBox(mark, 'page-glyph'));
  return wrap;
}
