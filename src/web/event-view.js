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
import { EVENT_CHOICE_GLYPH, glyphBox } from './glyphs.js';
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

  // The smith's temper modal: the same TILE rendering the rest site's forge keeps — the
  // offer is rolled and committed, so the picks are the only actions on the screen, and
  // each one shows the tempered card face it will produce (kernel-published chips).
  if (ev.tempering) {
    wrap.append(el('p', { cls: 'event-note', text: t('event.temperingNote') }));
    const list = el('div', { cls: 'event-cards temper-list' });
    for (const offer of ev.offers) list.append(temperPickTile(offer));
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
    // Every choice wears its own mark, the relic offer's contract (per-relic `.boon-art`):
    // the kernel-verified eventId+slug picks the ev-* mark, an unknown pair falls to the
    // generic r-unknown plate — never an empty box, never the small rune (wrong layer set
    // for this art context). Decorative: the span is aria-hidden, the kernel sentences
    // below carry the words.
    glyphBox(EVENT_CHOICE_GLYPH[ev.eventId]?.[c.slug] || 'r-unknown', 'boon-art'),
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


/** The content's definition table, loaded once — the same snapshot-free source the
 *  describe layer (combat-view's gallery path) reads. Only a tile's NAME and cost are
 *  read straight off the def when the kernel row did not publish them: cardDescribe
 *  reduces describeTile to the sentence facts and discards both. */
let EVENT_DEFS = null;
function eventDefs() {
  if (!EVENT_DEFS) EVENT_DEFS = loadContent().cards;
  return EVENT_DEFS;
}

/**
 * The cardTile INPUT FIELDS for one kernel-published temper face — the one builder both
 * the resolved beat's read-only tile and the smith's/rest site's clickable pick tiles
 * read, so the two surfaces can never disagree about a face. The row's own fields win
 * (a temper entry carries the TEMPERED sentence and chip list — the kernel's synthetic
 * def; the same shape as snapshotDeck's deck rows), and every field it does not carry
 * falls to cardDescribe / the content def: the describe layer's language twin for the
 * name, the raw id when the content no longer knows the card (the honest torn-save
 * degrade — a face-less row still renders, just without rules text).
 * @param {{cardId: string, temper?: string, temperName?: string, temperText?: string,
 *          name?: string, cost?: number, type?: string, typeLabel?: string,
 *          description?: string, chips?: any[], chipsComplete?: boolean}} ref
 * @returns {{fact: object, name: string, cost: number, type: string, typeLabel: string,
 *            description: string, chips: any[], chipsComplete: boolean}}
 */
function faceFields(ref) {
  const fact = cardDescribe(ref.cardId);
  const def = eventDefs().get(ref.cardId) ?? null;
  const es = currentLang() === 'es';
  const name = ref.name
    ?? (def ? ((es && typeof def.name_es === 'string' && def.name_es.length > 0 ? def.name_es : def.name)) : ref.cardId);
  return {
    fact,
    name,
    cost: ref.cost ?? (def ? def.cost : 0),
    type: ref.type ?? fact.type,
    typeLabel: ref.typeLabel ?? fact.typeLabel,
    description: ref.description || fact.description || name,
    // The chip row is whichever list the KERNEL chose (codexTile's rule): a tempered
    // entry's tempered list when published, the describe fact's otherwise — ORing the
    // two completeness flags could claim coverage the printed chips don't hold.
    chips: ref.chips ?? fact.chips ?? [],
    chipsComplete: (ref.chips ? ref.chipsComplete : fact.chipsComplete) === true,
  };
}

/**
 * One resolved beat's CARD TILE: the full card face — art, cost gem, type head, name,
 * flavor, effect chips — read-only (cardTile's readOnly shape: a labelled div, never
 * the hand's disabled affordance, no click). The face is the kernel's call (faceFields
 * above: a tempered beat shows the numbers the tempered copy plays, never the base
 * card's). A tempered tile wears the deck sheet's trim and forged stamp, its tooltip
 * and aria-label carrying the kernel's own temper sentence on top (the deck sheet's
 * tempered-title contract). Nothing is derived: every word on the tile is kernel or
 * content wording, and the chip row's real controls share the #pop-layer explainer
 * exactly like every other tile.
 * @param {{cardId: string, temper?: string, temperName?: string, temperText?: string,
 *          name?: string, cost?: number, type?: string, typeLabel?: string,
 *          description?: string, chips?: any[], chipsComplete?: boolean}} ref
 *        the kernel-published beat card (snapshot.event.resolved.cards[i])
 * @returns {HTMLElement} the read-only tile
 */
function eventCardTile(ref) {
  const { fact, name, description, chips, chipsComplete, cost, type, typeLabel } = faceFields(ref);
  const tile = cardTile({
    slot: `event-${ref.cardId}${ref.temper ? `-${ref.temper}` : ''}`,
    cardId: ref.cardId,
    name,
    flavor: fact.flavor,
    cost,
    type,
    typeLabel,
    description,
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
    tile.setAttribute('title', `${description} ${ref.temperText ?? ''}`.trim());
    tile.setAttribute('aria-label', `${tile.getAttribute('aria-label')} ${ref.temperText ?? ''}`.trim());
  }
  return tile;
}

/**
 * One temper OFFER as a CLICKABLE card tile — the reward-pick pattern (reward-view):
 * cardTile with `opts.onClick` → `act(actionId)`, `consumeClick` marking the event so
 * the global click handlers let the pick through, `data-action` riding the tile so the
 * hotkey path reaches the same verb. NOT the readOnly readout shape: this is a choice,
 * the offer is rolled and committed, and the tile shows the tempered face the pick will
 * produce (the kernel's temperedCardRow — trim, forged stamp, tempered chips; a
 * Balanced Maul chips its draw and its exhaust). The aria contract survives the shape
 * change verbatim: "Temper <card>. <TemperName>: <text>." — the same sentence the old
 * text-only buttons announced, so a screen reader's flow is unchanged. An offer the
 * kernel gave no actionId (a torn save) renders WITHOUT the click — never a pick the
 * engine would reject.
 * @param {{actionId: string|null, cardId: string, temper: string, temperName?: string,
 *          temperText?: string, text?: string, cardName?: string, name?: string,
 *          cost?: number, type?: string, typeLabel?: string, description?: string,
 *          chips?: any[], chipsComplete?: boolean}} offer
 *        the kernel-published offer row (snapshot.event.offers / snapshot.rest.tempers)
 * @returns {HTMLElement} the pick tile
 */
export function temperPickTile(offer) {
  const { fact, name, description, chips, chipsComplete, cost, type, typeLabel } = faceFields(offer);
  const tile = cardTile({
    // The reward-pick slot convention: the slot IS the action id, so a tile is its verb.
    slot: offer.actionId ?? `temper-${offer.cardId}-${offer.temper}`,
    cardId: offer.cardId,
    name,
    flavor: fact.flavor,
    cost,
    type,
    typeLabel,
    description,
    chips,
    chipsComplete,
    playable: true,
    showSummary: false,
    temper: offer.temper,
    temperName: offer.temperName,
    temperText: offer.temperText,
  }, {
    actionId: offer.actionId ?? undefined,
    // `act` itself refuses a null id (the torn-save offer renders but the pick no-ops,
    // exactly what the old text buttons did) — the tile never wires a hand-play click.
    onClick: (ev) => { consumeClick(ev); act(offer.actionId); },
  });
  // The announced form is the OFFER's (card + temper sentence), not the card face's:
  // the pick is a verb first, a card second — the same words the text buttons said.
  tile.setAttribute('aria-label', t('rest.temper.aria', { name: offer.cardName ?? name, text: offer.text ?? offer.temperText ?? '' }));
  return tile;
}
