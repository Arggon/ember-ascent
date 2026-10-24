// src/web/rest-view.js — the rest site: heal, move on, or temper a card at the forge.

import { arriving, snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { act } from './actions.js';
import { page } from './page-frame.js';

/* --------------------------------------------------------------------- REST */

export function restView() {
  const wrap = el('div', { cls: 'rest' + (arriving.rest ? ' rest-arriving' : '') });
  wrap.append(el('p', { cls: 'section-title', text: 'Rest Site' }));
  // The pause is a SHAPE: a slowly breathing ember ring behind the words, plus an arrival
  // beat on the first paint. Nothing on this screen is a form field and nothing moves on a
  // click, so the two choices below never shift out from under a pointer.
  wrap.append(el('div', { cls: 'rest-embers', attrs: { 'aria-hidden': 'true' } },
    el('span', { cls: 'ember e1' }), el('span', { cls: 'ember e2' }), el('span', { cls: 'ember e3' }),
  ));
  wrap.append(sceneIllus('event'));
  wrap.append(el('div', { cls: 'big-title rest-head', text: 'A quiet moment' }));
  // The one thing this screen must SAY without motion: resting is safe, and leaving is safe.
  wrap.append(el('p', { cls: 'rest-note', text: `HP ${snap.player.hp}/${snap.player.maxHp} — you may heal ${snap.rest.heal} or move on.` }));
  wrap.append(el('p', { cls: 'rest-calm', text: 'Nothing is hunting you here. Take the breath, or walk on.' }));
  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: `Rest (+${snap.rest.heal} HP)`, attrs: { type: 'button' }, on: { click: () => act(snap.rest.healId) } }),
    el('button', { cls: 'btn secondary', text: 'Move on', attrs: { type: 'button' }, on: { click: () => act(snap.rest.leaveId) } }),
  ));
  // B2: or temper one card instead of healing. Offers and sentences come from the kernel.
  const tempers = snap.rest.tempers || [];
  if (tempers.length > 0) {
    wrap.classList.add('has-tempers');
    wrap.append(el('p', { cls: 'temper-head', text: 'Or temper a card at the forge (instead of resting):' }));
    const list = el('div', { cls: 'boon-list temper-list' });
    for (const t of tempers) {
      list.append(el('button', {
        cls: `boon temper-offer temper-${t.temper}`,
        attrs: { type: 'button', 'data-action': t.actionId, 'aria-label': `Temper ${t.cardName}. ${t.text}` },
        on: { click: () => act(t.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${t.cardName} · ${t.temperName}` }),
      keywordText(el('span', { cls: 'boon-text' }), t.text.split(': ').slice(1).join(': '))));
    }
    wrap.append(list);
  }
  return page('rest', 'IV — The Ember', 'flame', 'panel', [wrap]);
}
