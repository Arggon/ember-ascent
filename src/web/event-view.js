// src/web/event-view.js — the wayside event (S6): the story, its choices, and the beat
// after one resolves.
//
// The kernel decides everything this screen shows: which choices are buttons and which
// are dimmed (`actionId` is null exactly when no action exists — an unmet requirement,
// the same afford-filter that greys an unaffordable shelf), what every choice costs
// (`cost`/`hpLoss` are the chips' facts), and the resolved beat's own sentences. A
// choice the purse or the belt cannot cover stays VISIBLE with its reason, dimmed —
// the shop's inert-shelf contract.

import { snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { consumeClick } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { glyphBox } from './glyphs.js';

/** One cost chip: a coin for gold, a droplet for HP — the belt chip's own glyph family. */
function costChip(kind, value) {
  const chip = el('span', {
    cls: `event-cost ${kind}`,
    attrs: { title: kind === 'gold' ? `Costs ${value} gold` : `Costs ${value} HP` },
  },
  glyphBox(kind === 'gold' ? 'coin' : 'droplet', 'event-cost-glyph'),
  el('span', { text: kind === 'gold' ? `${value}g` : `${value} HP` }));
  return chip;
}

export function eventView() {
  const ev = snap.event;
  const wrap = el('div', { cls: 'event' });
  wrap.append(sceneIllus('event'));
  wrap.append(el('p', { cls: 'section-title', text: 'The Wayside' }));
  wrap.append(el('div', { cls: 'big-title event-head', text: ev.name }));
  if (ev.story) wrap.append(el('p', { cls: 'event-story', text: ev.story }));

  // The smith's temper modal: the same rendering the rest site's offers keep — the
  // offer is rolled and committed, so the picks are the only actions on the screen.
  if (ev.tempering) {
    wrap.append(el('p', { cls: 'event-note', text: 'The hammer is in your hand. Pick the card to temper — the choice is committed.' }));
    const list = el('div', { cls: 'boon-list temper-list' });
    for (const t of ev.offers) {
      list.append(el('button', {
        cls: `boon temper-offer temper-${t.temper}`,
        attrs: { type: 'button', 'data-action': t.actionId, 'aria-label': `Temper ${t.cardName}. ${t.text}` },
        on: { click: () => act(t.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${t.cardName} · ${t.temperName}` }),
      keywordText(el('span', { cls: 'boon-text' }), t.text.split(': ').slice(1).join(': '))));
    }
    wrap.append(list);
    return page('event', '✧ — The Wayside', 'rune', 'panel', [wrap]);
  }

  // A torn save (an event id the kernel no longer knows): no story, no choices — but
  // the continue is always the way out, so the run can never strand on this screen.
  if (!ev.known && !ev.resolved) {
    wrap.append(el('p', { cls: 'event-note', text: 'The way is unclear, but it is open.' }));
    wrap.append(el('div', { cls: 'restart-row' },
      el('button', {
        cls: 'btn', text: 'Continue',
        attrs: { type: 'button', 'data-action': ev.continueId },
        on: { click: () => act(ev.continueId) },
      })));
    return page('event', '✧ — The Wayside', 'rune', 'panel', [wrap]);
  }

  // The resolved beat: the kernel's own result sentences, then the way out.
  if (ev.resolved) {
    const list = el('ul', { cls: 'event-result' });
    for (const line of ev.resolved.lines) list.append(el('li', { text: line.replace(/^- /, '') }));
    wrap.append(list);
    wrap.append(el('div', { cls: 'restart-row' },
      el('button', {
        cls: 'btn',
        text: 'Continue',
        attrs: { type: 'button', 'data-action': ev.continueId, title: 'The wayside is spent — back to the ascent.' },
        on: { click: () => act(ev.continueId) },
      })));
    return page('event', '✧ — The Wayside', 'rune', 'panel', [wrap]);
  }

  wrap.append(el('p', { cls: 'event-note', text: 'Choose. The wayside does not offer twice.' }));
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
          : `${c.label}. Unavailable: ${c.reason}.`,
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
  return page('event', '✧ — The Wayside', 'rune', 'panel', [wrap]);
}
