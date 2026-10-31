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
import { el, keywordText, sceneIllus } from './dom.js';
import { cardTile } from './combat-view.js';
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
    const list = el('div', { cls: 'boon-list remove-list' });
    for (const d of shop.deckInstances) {
      const copyTag = d.copies > 1 ? t('shop.copy', { a: d.copy, b: d.copies }) : '';
      list.append(el('button', {
        cls: `boon remove-offer${d.temper ? ` temper-${d.temper}` : ''}`,
        attrs: {
          type: 'button',
          'data-action': d.actionId,
          'aria-label': t('shop.remove.aria', {
            name: d.name,
            copy: copyTag,
            temper: d.temperName ? `, ${d.temperName}` : '',
          }),
        },
        on: { click: () => act(d.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${d.name}${copyTag}` }),
      keywordText(el('span', { cls: 'boon-text' }), d.temperName ? t('shop.tempered', { name: d.temperName }) : t('shop.costsEnergy', { n: d.cost })),
      ));
    }
    wrap.append(list);
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
