// src/web/event-view.js — the wayside event (S6): the story, its choices, and the beat
// after one resolves.
//
// The kernel decides everything this screen shows: which choices are buttons and which
// are dimmed (`actionId` is null exactly when no action exists — an unmet requirement,
// the same afford-filter that greys an unaffordable shelf), what every choice costs
// (`cost`/`hpLoss` are the chips' facts), and the resolved beat's own sentences. A
// choice the purse or the belt cannot cover stays VISIBLE with its reason, dimmed —
// the shop's inert-shelf contract. The story, choice labels and requirement reasons
// arrive already in the snapshot's language (I18N-1); this module only localizes its
// own chrome.

import { snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { consumeClick } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { glyphBox } from './glyphs.js';
import { cardDescribe, cardTile } from './combat-view.js';
import { loadContent } from '../kernel/index.js';
import { currentLang, t } from './i18n.js';

/** One cost chip: a coin for gold, a droplet for HP — the belt chip's own glyph family. */
function costChip(kind, value) {
  const chip = el('span', {
    cls: `event-cost ${kind}`,
    attrs: { title: kind === 'gold' ? t('event.cost.gold', { n: value }) : t('event.cost.hp', { n: value }) },
  },
  glyphBox(kind === 'gold' ? 'coin' : 'droplet', 'event-cost-glyph'),
  el('span', { text: kind === 'gold' ? `${value}g` : `${value} HP` }));
  return chip;
}

export function eventView() {
  const ev = snap.event;
  const wrap = el('div', { cls: 'event' });
  wrap.append(sceneIllus('event'));
  wrap.append(el('p', { cls: 'section-title', text: t('event.title') }));
  wrap.append(el('div', { cls: 'big-title event-head', text: ev.name }));
  if (ev.story) wrap.append(el('p', { cls: 'event-story', text: ev.story }));

  // The smith's temper modal: the same rendering the rest site's offers keep — the
  // offer is rolled and committed, so the picks are the only actions on the screen.
  if (ev.tempering) {
    wrap.append(el('p', { cls: 'event-note', text: t('event.temperingNote') }));
    const list = el('div', { cls: 'boon-list temper-list' });
    for (const offer of ev.offers) {
      list.append(el('button', {
        cls: `boon temper-offer temper-${offer.temper}`,
        attrs: { type: 'button', 'data-action': offer.actionId, 'aria-label': t('rest.temper.aria', { name: offer.cardName, text: offer.text }) },
        on: { click: () => act(offer.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${offer.cardName} · ${offer.temperName}` }),
      keywordText(el('span', { cls: 'boon-text' }), offer.text.split(': ').slice(1).join(': '))));
    }
    wrap.append(list);
    return page('event', t('page.event'), 'rune', 'panel', [wrap]);
  }

  // A torn save (an event id the kernel no longer knows): no story, no choices — but
  // the continue is always the way out, so the run can never strand on this screen.
  if (!ev.known && !ev.resolved) {
    wrap.append(el('p', { cls: 'event-note', text: t('event.unclear') }));
    wrap.append(el('div', { cls: 'restart-row' },
      el('button', {
        cls: 'btn', text: t('event.continue'),
        attrs: { type: 'button', 'data-action': ev.continueId },
        on: { click: () => act(ev.continueId) },
      })));
    return page('event', t('page.event'), 'rune', 'panel', [wrap]);
  }

  // The resolved beat: the kernel's own result sentences — a line that names a card
  // shows the CARD itself (the sentence as caption above a read-only tile), the rest
  // stay plain text — then the way out.
  if (ev.resolved) {
    const lines = ev.resolved.lines ?? [];
    // Parallel to `lines` by index (the kernel's beatCards): the card each line names,
    // or null. A snapshot without the field (an old surface reading a new kernel is not
    // a thing, but a torn beat degrades the same way) degrades to plain sentences — the
    // lines alone always carried the whole story.
    const cards = Array.isArray(ev.resolved.cards) ? ev.resolved.cards : [];
    const list = el('ul', { cls: 'event-result' });
    for (let i = 0; i < lines.length; i += 1) {
      const sentence = String(lines[i] ?? '').replace(/^- /, '');
      const ref = cards[i] ?? null;
      if (!ref || typeof ref.cardId !== 'string') {
        list.append(el('li', { text: sentence }));
        continue;
      }
      list.append(el('li', { cls: 'has-card' },
        el('p', { cls: 'event-card-caption', text: sentence }),
        el('div', { cls: 'event-cards' }, eventCardTile(ref))));
    }
    wrap.append(list);
    wrap.append(el('div', { cls: 'restart-row' },
      el('button', {
        cls: 'btn',
        text: t('event.continue'),
        attrs: { type: 'button', 'data-action': ev.continueId, title: t('event.continue.title') },
        on: { click: () => act(ev.continueId) },
      })));
    return page('event', t('page.event'), 'rune', 'panel', [wrap]);
  }

  wrap.append(el('p', { cls: 'event-note', text: t('event.choose') }));
  const list = el('div', { cls: 'event-choices' });
  for (const c of ev.choices) {
    const affordable = c.actionId !== null;
    const btn = el('button', {
      cls: `boon event-choice${affordable ? '' : ' dim'}`,
      attrs: {
        type: 'button',
        ...(c.actionId ? { 'data-action': c.actionId } : {}),
        ...(affordable ? {} : { disabled: 'disabled' }),
        'aria-label': affordable
          ? `${c.label}. ${c.effect}`
          : `${c.label}. ${t('event.unavailable', { reason: c.reason })}`,
      },
      on: affordable ? { click: (e) => { consumeClick(e); act(c.actionId); } } : {},
    },
    el('span', { cls: 'boon-name', text: c.label }),
    keywordText(el('span', { cls: 'boon-text' }), c.effect),
    // The dimmed button still says WHY: the requirement is a fact, not a mystery.
    el('span', { cls: 'event-reason', text: affordable ? '' : c.reason }));
    // Cost chips ride the corner: gold when the choice spends, HP when it bleeds.
    if (c.cost !== null || c.hpLoss !== null) {
      const chips = el('span', { cls: 'event-chips' });
      if (c.cost !== null) chips.append(costChip('gold', c.cost));
      if (c.hpLoss !== null) chips.append(costChip('hp', c.hpLoss));
      btn.append(chips);
    }
    list.append(btn);
  }
  wrap.append(list);
  return page('event', t('page.event'), 'rune', 'panel', [wrap]);
}

/* ------------------------------------------------- the resolved beat's card reveal */

/** The content's definition table, loaded once — the same snapshot-free source the
 *  describe layer (combat-view's gallery path) reads. Only the tile's NAME and cost are
 *  read straight off the def: cardDescribe reduces describeTile to the sentence facts
 *  and discards both. */
let EVENT_DEFS = null;
function eventDefs() {
  if (!EVENT_DEFS) EVENT_DEFS = loadContent().cards;
  return EVENT_DEFS;
}

/**
 * One resolved beat's CARD TILE: the full card face — art, cost gem, type head, name,
 * flavor, effect chips — read-only (cardTile's readOnly shape: a labelled div, never
 * the hand's disabled affordance, no click). Where the face comes from is the kernel's
 * call: a TEMPERED beat's ref carries the tempered face itself (beatCards' synthetic
 * def — sentence, chips, name, cost — the deck sheet's row shape, so the tile shows the
 * numbers the tempered copy actually plays, never the base card's), and every other
 * card beat falls to cardDescribe (the kernel's describeTile — the codex tile's own
 * source, cached per language) with the name and cost read off the content def beside
 * it. A tempered tile wears the deck sheet's trim and forged stamp, its tooltip and
 * aria-label carrying the kernel's own temper sentence on top (the deck sheet's
 * tempered-title contract). Nothing is derived: every word on the tile is kernel or
 * content wording, and the chip row's real controls share the #pop-layer explainer
 * exactly like every other tile. An id the content no longer knows (a torn save's
 * beat) degrades to the raw id as the name and no rules text — visible, never thrown
 * away.
 * @param {{cardId: string, temper?: string, temperName?: string, temperText?: string,
 *          name?: string, cost?: number, type?: string, typeLabel?: string,
 *          description?: string, chips?: any[], chipsComplete?: boolean}} ref
 *        the kernel-published beat card (snapshot.event.resolved.cards[i])
 * @returns {HTMLElement} the read-only tile
 */
function eventCardTile(ref) {
  const fact = cardDescribe(ref.cardId);
  const def = eventDefs().get(ref.cardId) ?? null;
  const es = currentLang() === 'es';
  // The name follows the describe layer's language: the kernel row's own when the beat
  // published one (a tempered face is worded kernel-side), else a `name_es` twin when
  // the def carries one and the session asks for Spanish, the English name otherwise,
  // the raw id when the content no longer knows the card at all.
  const name = ref.name
    ?? (def ? ((es && typeof def.name_es === 'string' && def.name_es.length > 0 ? def.name_es : def.name)) : ref.cardId);
  // The chip row is whichever list the KERNEL chose (codexTile's rule): a tempered
  // beat's tempered list when published, the describe fact's otherwise — ORing the two
  // completeness flags could claim coverage the printed chips don't hold.
  const chips = ref.chips ?? fact.chips ?? [];
  const chipsComplete = (ref.chips ? ref.chipsComplete : fact.chipsComplete) === true;
  const tile = cardTile({
    slot: `event-${ref.cardId}${ref.temper ? `-${ref.temper}` : ''}`,
    cardId: ref.cardId,
    name,
    flavor: fact.flavor,
    cost: ref.cost ?? (def ? def.cost : 0),
    type: ref.type ?? fact.type,
    typeLabel: ref.typeLabel ?? fact.typeLabel,
    description: ref.description || fact.description || name,
    chips,
    chipsComplete,
    playable: false,
    showSummary: false,
    temper: ref.temper,
    temperName: ref.temperName,
    temperText: ref.temperText,
  }, { readOnly: true });
  if (ref.temper) {
    // The deck sheet's tempered-title contract: the tile's own (tempered) sentence plus
    // the kernel's temper sentence, on hover and for screen readers — the temper
    // sentence names exactly what the forge changed, so nothing the tile's resting face
    // does not show is hidden.
    const full = `${ref.description || fact.description || name} ${ref.temperText ?? ''}`.trim();
    tile.setAttribute('title', full);
    tile.setAttribute('aria-label', `${tile.getAttribute('aria-label')} ${ref.temperText ?? ''}`.trim());
  }
  return tile;
}
