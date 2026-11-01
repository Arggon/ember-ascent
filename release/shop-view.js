// src/web/shop-view.js — the shop (S4): the vendor's shelves, the card-removal service,
// and the way out.
//
// The kernel decides everything this screen shows: which shelves are buttons and which
// are inert (`actionId` is null exactly when no action exists — sold out, or the purse
// cannot cover the price, the same afford-filter that greys an unplayable hand tile),
// what every card says (the describe layer's own sentences), and when the room ends.
// The removal step is a modal list of deck INSTANCES — three Hammerfalls are three
// choices, labelled copy n/m in the deck order the kernel's `x<n>` ids address.

import { snap } from './runtime.js';
import { el, sceneIllus } from './dom.js';
import { cardDescribe, cardTile } from './combat-view.js';
import { consumeClick } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { glyphBox } from './glyphs.js';
import { t } from './i18n.js';

export function shopView() {
  const shop = snap.shop;
  const wrap = el('div', { cls: 'shop' });
  wrap.append(sceneIllus('event'));
  wrap.append(el('p', { cls: 'section-title', text: t('shop.title') }));

  // The purse is the kernel's own value (the same one the HUD chip shows) — one computed
  // number, never re-derived here, so the screen and the HUD cannot disagree about how
  // rich the player is while every price asks for a slice of it.
  const head = el('div', { cls: 'shop-head' },
    el('div', { cls: 'big-title shop-title', text: shop.removing ? t('shop.pickRemoval') : t('shop.wares') }),
    el('span', { cls: 'shop-purse', attrs: { title: t('shop.purse.title', { n: shop.purse }) } },
      glyphBox('coin', 'coin-glyph'),
      el('span', { text: t('shop.gold', { n: shop.purse }) }),
    ),
  );
  wrap.append(head);

  if (shop.removing) {
    wrap.append(el('p', { cls: 'shop-note', text: t('shop.removalNote') }));
    // UX-8: the deck's cards as the GAME'S card tiles — one tile per deck instance, art
    // and full description, the copy census carried in the tile's label and tooltip (the
    // copies are interchangeable; their tiles look alike on purpose, exactly the deck
    // sheet's one-tile-per-copy reading). The tile IS the pick: a click removes it, the
    // same actionId the old text rows carried. An instance without a pick id (a torn
    // step) renders read-only rather than promising a click the kernel would reject.
    const grid = el('div', { cls: 'remove-grid' });
    for (const d of shop.deckInstances) {
      grid.append(removalTile(d));
    }
    wrap.append(grid);
    return page('shop', t('page.shop'), 'coin', 'panel', [wrap]);
  }

  wrap.append(el('p', { cls: 'shop-note', text: t('shop.note') }));
  const row = el('div', { cls: 'shop-grid' });
  for (const o of shop.offers) {
    // Same tile the hand and the reward screen draw, with the same inert language:
    // `playable: false` greys it, and the disabled note names the REAL reason (gold,
    // not Energy) through cardTile's override hook.
    const tile = cardTile({
      slot: o.actionId ?? `shelf${o.index}`,
      cardId: o.cardId,
      name: o.name,
      flavor: o.flavor,
      cost: o.cost,
      type: o.type,
      typeLabel: o.typeLabel,
      summary: o.summary,
      description: o.description,
      playable: o.affordable,
      showSummary: false,
      // The tile carries no compact-code footer (reward-screen precedent), so the
      // inert reason lives in the aria label and in the price badge's tint.
      disabledNote: o.sold ? t('shop.soldNote') : t('shop.cannotNote', { price: o.price, purse: shop.purse }),
    }, o.actionId ? {
      actionId: o.actionId,
      onClick: (ev) => { consumeClick(ev); act(o.actionId); },
    } : {});
    // The price badge rides on the tile: a coin, then the gold (or "sold"). It is the
    // one fact the reward tiles never needed and the shop always does.
    tile.append(el('span', {
      cls: 'shop-price' + (o.sold ? ' sold' : '') + (!o.affordable && !o.sold ? ' cannot' : ''),
      attrs: { title: o.sold ? t('shop.sold.title') : t('shop.price.title', { n: o.price }) },
    },
    glyphBox('coin', 'coin-glyph'),
    el('span', { text: o.sold ? t('shop.sold') : String(o.price) }),
    ));
    row.append(tile);
  }
  wrap.append(row);

  const controls = el('div', { cls: 'controls shop-controls' });
  const rem = shop.removal;
  if (rem.done) {
    controls.append(el('span', { cls: 'hint', text: t('shop.removalSpent') }));
  } else {
    // `sold` never reaches here: buying the service flips the view into the removal
    // list above in the same breath, so an inert button can only mean the purse.
    controls.append(el('button', {
      cls: 'btn' + (rem.actionId ? '' : ' secondary'),
      text: t('shop.removeBtn', { n: rem.price }),
      attrs: {
        type: 'button',
        ...(rem.actionId ? { 'data-action': rem.actionId } : {}),
        ...(rem.actionId ? {} : { disabled: 'disabled' }),
        title: rem.actionId ? t('shop.removeBtn.title') : t('shop.removeBtn.poor', { n: rem.price }),
      },
      on: rem.actionId ? { click: () => act(rem.actionId) } : {},
    }));
  }
  controls.append(el('button', {
    cls: 'btn secondary',
    text: t('shop.leave'),
    attrs: { type: 'button', 'data-action': shop.leaveId, title: t('shop.leave.title') },
    on: { click: () => act(shop.leaveId) },
  }));
  wrap.append(controls);
  return page('shop', t('page.shop'), 'coin', 'panel', [wrap]);
}

/**
 * One removal TILE (UX-8): the deck instance as the full card face — art, cost gem, type
 * head, name, the describe layer's own sentence — and the tile itself IS the pick (the
 * same `actionId` the old text rows carried). `cardDescribe` supplies the facts the
 * kernel's `deckInstances` rows do not publish (description, flavor, type word), so the
 * tile's sentence is the kernel's own wording in the current language. The copy census
 * ("copy 2/5") rides the label and tooltip, not the face: the copies are interchangeable,
 * so their tiles look alike on purpose — the deck sheet's one-tile-per-copy reading. A
 * tempered instance wears the tile's own trim and stamp, which is exactly how it reads in
 * the hand; the stamp's tooltip stays empty because `deckInstances` publishes no temper
 * sentence (the deck sheet's rows do — that surface carries it).
 * @param {any} d one `snap.shop.deckInstances` row
 * @returns {HTMLElement}
 */
function removalTile(d) {
  const fact = cardDescribe(d.cardId);
  const copyTag = d.copies > 1 ? t('shop.copy', { a: d.copy, b: d.copies }) : '';
  const pickable = Boolean(d.actionId);
  const tile = cardTile({
    slot: d.actionId ?? `deck${d.index}`,
    cardId: d.cardId,
    name: d.name,
    flavor: fact.flavor,
    cost: d.cost,
    type: fact.type,
    typeLabel: fact.typeLabel,
    // The row's own tempered sentence when the kernel publishes one (deckInstances
    // does); cardDescribe stays the fallback for a caller that predates the field.
    description: d.description || fact.description || d.name,
    // A pick is not a hand play: the tile is clickable through its own action id, and it
    // must never wear the hand's "not enough Energy" affordance for a service already
    // paid for. `playable: true` keeps the full-colour face; the pick verb lives in the
    // label below.
    playable: true,
    showSummary: false,
    temper: d.temper,
    temperName: d.temperName,
    temperText: d.temperText ?? '',
  }, pickable
    ? { actionId: d.actionId, onClick: (ev) => { consumeClick(ev); act(d.actionId); } }
    : { readOnly: true });
  const temper = d.temperName ? `, ${d.temperName}` : '';
  const base = t('shop.remove.aria', { name: d.name, copy: copyTag, temper });
  tile.setAttribute('aria-label', `${base} ${fact.description}`.trim());
  tile.setAttribute('title', `${fact.description}${copyTag}${temper}`.trim() || d.name);
  return tile;
}
