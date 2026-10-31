// src/web/rest-view.js — the rest site: heal, move on, or temper a card at the forge.

import { arriving, snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { act } from './actions.js';
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
  // B2: or temper one card instead of healing. Offers and sentences come from the kernel.
  const tempers = snap.rest.tempers || [];
  if (tempers.length > 0) {
    wrap.classList.add('has-tempers');
    wrap.append(el('p', { cls: 'temper-head', text: t('rest.temperHead') }));
    const list = el('div', { cls: 'boon-list temper-list' });
    for (const offer of tempers) {
      list.append(el('button', {
        cls: `boon temper-offer temper-${offer.temper}`,
        attrs: { type: 'button', 'data-action': offer.actionId, 'aria-label': t('rest.temper.aria', { name: offer.cardName, text: offer.text }) },
        on: { click: () => act(offer.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${offer.cardName} · ${offer.temperName}` }),
      keywordText(el('span', { cls: 'boon-text' }), offer.text.split(': ').slice(1).join(': '))));
    }
    wrap.append(list);
  }
  return page('rest', t('page.rest'), 'flame', 'panel', [wrap]);
}
