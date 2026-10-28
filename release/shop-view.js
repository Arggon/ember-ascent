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

export function shopView() {
  const shop = snap.shop;
  const wrap = el('div', { cls: 'shop' });
  wrap.append(sceneIllus('event'));
  wrap.append(el('p', { cls: 'section-title', text: 'The Ember Vendor' }));

  // The purse is the kernel's own value (the same one the HUD chip shows) — one computed
  // number, never re-derived here, so the screen and the HUD cannot disagree about how
  // rich the player is while every price asks for a slice of it.
  const head = el('div', { cls: 'shop-head' },
    el('div', { cls: 'big-title shop-title', text: shop.removing ? 'Choose what leaves' : 'Wares for the ascent' }),
    el('span', { cls: 'shop-purse', attrs: { title: `Your purse: ${shop.purse} gold` } },
      glyphBox('coin', 'coin-glyph'),
      el('span', { text: `${shop.purse} gold` }),
    ),
  );
  wrap.append(head);

  if (shop.removing) {
    wrap.append(el('p', { cls: 'shop-note', text: 'The service is paid. Pick the copy that leaves your deck — duplicates are separate choices, and the removal is final.' }));
    const list = el('div', { cls: 'boon-list remove-list' });
    for (const d of shop.deckInstances) {
      const copyTag = d.copies > 1 ? ` · copy ${d.copy}/${d.copies}` : '';
      list.append(el('button', {
        cls: `boon remove-offer${d.temper ? ` temper-${d.temper}` : ''}`,
        attrs: {
          type: 'button',
          'data-action': d.actionId,
          'aria-label': `Remove ${d.name}${copyTag}${d.temperName ? `, ${d.temperName}` : ''}. It leaves your deck for good.`,
        },
        on: { click: () => act(d.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${d.name}${copyTag}` }),
      keywordText(el('span', { cls: 'boon-text' }), d.temperName ? `Tempered: ${d.temperName}` : `Costs ${d.cost} Energy`),
      ));
    }
    wrap.append(list);
    return page('shop', '✦ — The Vendor', 'coin', 'panel', [wrap]);
  }

  wrap.append(el('p', { cls: 'shop-note', text: 'Cards this run\u2019s rewards could still offer, priced by rarity. A grey shelf does not fit the purse \u2014 the vendor does not haggle.' }));
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
      disabledNote: o.sold ? ' Sold out.' : ` Not affordable: ${o.price} gold, purse ${shop.purse}.`,
    }, o.actionId ? {
      actionId: o.actionId,
      onClick: (ev) => { consumeClick(ev); act(o.actionId); },
    } : {});
    // The price badge rides on the tile: a coin, then the gold (or "sold"). It is the
    // one fact the reward tiles never needed and the shop always does.
    tile.append(el('span', {
      cls: 'shop-price' + (o.sold ? ' sold' : '') + (!o.affordable && !o.sold ? ' cannot' : ''),
      attrs: { title: o.sold ? 'Sold' : `Price: ${o.price} gold` },
    },
    glyphBox('coin', 'coin-glyph'),
    el('span', { text: o.sold ? 'sold' : String(o.price) }),
    ));
    row.append(tile);
  }
  wrap.append(row);

  const controls = el('div', { cls: 'controls shop-controls' });
  const rem = shop.removal;
  if (rem.done) {
    controls.append(el('span', { cls: 'hint', text: 'The removal service is spent for this visit.' }));
  } else {
    // `sold` never reaches here: buying the service flips the view into the removal
    // list above in the same breath, so an inert button can only mean the purse.
    controls.append(el('button', {
      cls: 'btn' + (rem.actionId ? '' : ' secondary'),
      text: `Remove a card \u2014 ${rem.price} gold`,
      attrs: {
        type: 'button',
        ...(rem.actionId ? { 'data-action': rem.actionId } : {}),
        ...(rem.actionId ? {} : { disabled: 'disabled' }),
        title: rem.actionId
          ? 'One removal per visit: pay, then pick the exact copy to remove.'
          : `The purse cannot cover ${rem.price} gold.`,
      },
      on: rem.actionId ? { click: () => act(rem.actionId) } : {},
    }));
  }
  controls.append(el('button', {
    cls: 'btn secondary',
    text: 'Leave',
    attrs: { type: 'button', 'data-action': shop.leaveId, title: 'Leaving is final \u2014 the shop is consumed like a fought node.' },
    on: { click: () => act(shop.leaveId) },
  }));
  wrap.append(controls);
  return page('shop', '✦ — The Vendor', 'coin', 'panel', [wrap]);
}
