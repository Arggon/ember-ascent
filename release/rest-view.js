// src/web/rest-view.js — the rest site: heal, move on, or temper a card at the forge.

import { arriving, snap } from './runtime.js';
import { el, sceneIllus } from './dom.js';
import { act } from './actions.js';
import { temperPickTile } from './event-view.js';
import { page } from './page-frame.js';
import { t } from './i18n.js';

/* --------------------------------------------------------------------- REST */

export function restView() {
  const wrap = el('div', { cls: 'rest' + (arriving.rest ? ' rest-arriving' : '') });
  wrap.append(el('p', { cls: 'section-title', text: t('rest.title') }));
  // The pause is a SHAPE: a slowly breathing ember ring behind the words, plus an arrival
  // beat on the first paint. Nothing on this screen is a form field and nothing moves on a
  // click, so the two choices below never shift out from under a pointer.
  wrap.append(el('div', { cls: 'rest-embers', attrs: { 'aria-hidden': 'true' } },
    el('span', { cls: 'ember e1' }), el('span', { cls: 'ember e2' }), el('span', { cls: 'ember e3' }),
  ));
  wrap.append(sceneIllus('event'));
  wrap.append(el('div', { cls: 'big-title rest-head', text: t('rest.head') }));
  // The one thing this screen must SAY without motion: resting is safe, and leaving is safe.
  wrap.append(el('p', { cls: 'rest-note', text: t('rest.note', { hp: snap.player.hp, max: snap.player.maxHp, heal: snap.rest.heal }) }));
  wrap.append(el('p', { cls: 'rest-calm', text: t('rest.calm') }));
  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: t('rest.heal', { n: snap.rest.heal }), attrs: { type: 'button' }, on: { click: () => act(snap.rest.healId) } }),
    el('button', { cls: 'btn secondary', text: t('rest.moveOn'), attrs: { type: 'button' }, on: { click: () => act(snap.rest.leaveId) } }),
  ));
  // B2: or temper one card instead of healing. The offers render as the GAME'S tempered
  // card tiles — the smith's event modal shares this exact builder (event-view's
  // temperPickTile; the comment there carries the reward-pick wiring) — and the faces
  // come from the ONE kernel publisher (observe.js temperedCardRow), so the forge can
  // never disagree with the wayside about what a temper produces.
  const tempers = snap.rest.tempers || [];
  if (tempers.length > 0) {
    wrap.classList.add('has-tempers');
    wrap.append(el('p', { cls: 'temper-head', text: t('rest.temperHead') }));
    const list = el('div', { cls: 'event-cards temper-list' });
    for (const offer of tempers) list.append(temperPickTile(offer));
    wrap.append(list);
  }
  return page('rest', t('page.rest'), 'flame', 'panel', [wrap]);
}
