// src/web/kindling-view.js — the act-start screen: hero pick, path pick, boon choice.
//
// B1: the boon words come from the kernel snapshot. B4/B5: the hero and biome pickers are
// radio groups (WAI-ARIA APG) — one tab stop on the checked option, arrow keys move the
// selection, selecting IS switching (the switch itself lives in actions.js, which rebuilds
// the run with the same seed).

import { DEFAULT_BIOME, } from '../kernel/index.js';
import { snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { heroMarkup } from './stage-art.js';
import { HEROES, act, switchHero, switchPath } from './actions.js';
import { page } from './page-frame.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ KINDLING */

/** A hero portrait for the select buttons (constant markup from a fixed table). */
function heroFace(id) {
  const face = el('span', { cls: 'hp-face', attrs: { 'aria-hidden': 'true' } });
  face.innerHTML = heroMarkup(id);
  return face;
}



/** B1: the act-start boon choice. Every word comes from the kernel snapshot. */
export function kindlingView() {
  const wrap = el('div', { cls: 'kindling' });
  wrap.append(sceneIllus('event'));
  // B4 hero select: only before the first choice of a run. Switching rebuilds the run
  // with the same seed for the other hero, so nothing about the climb is rerolled by hand.
  if (snap.stepIndex === 0) {
    // Radio-group semantics (WAI-ARIA APG): one tab stop (the checked hero), and the arrow
    // keys move the selection, wrapping; Home/End jump to the ends. Selecting IS switching.
    const current = snap.character ?? 'ironclad';
    const at = Math.max(0, HEROES.findIndex((h) => h.id === current));
    const heroes = el('div', {
      cls: 'hero-select',
      attrs: { role: 'radiogroup', 'aria-label': t('kindling.heroes.aria') },
      on: {
        keydown: (ev) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
          let to = null;
          if (step) to = (at + step + HEROES.length) % HEROES.length;
          else if (ev.key === 'Home') to = 0;
          else if (ev.key === 'End') to = HEROES.length - 1;
          if (to === null) return;
          ev.preventDefault();
          switchHero(HEROES[to].id);
        },
      },
    });
    for (const h of HEROES) {
      const on = current === h.id;
      const blurb = t(`hero.${h.id}.blurb`);
      heroes.append(el('button', {
        cls: `hero-pick${on ? ' on' : ''} hp-${h.id}`,
        attrs: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', title: blurb },
        on: { click: () => switchHero(h.id) },
      },
      heroFace(h.id),
      el('span', { cls: 'hp-name', text: h.name }),
      el('span', { cls: 'hp-blurb', text: blurb })));
    }
    wrap.append(heroes);
    // Radio group like the hero picker (WAI-ARIA APG): one tab stop (the checked path),
    // arrow keys move the selection, wrapping; Home/End jump to the ends. Selecting IS switching.
    const biomes = snap.biomes ?? [];
    const curBiome = snap.biome ?? DEFAULT_BIOME;
    const atBiome = Math.max(0, biomes.findIndex((b) => b.id === curBiome));
    const paths = el('div', {
      cls: 'biome-select',
      attrs: { role: 'radiogroup', 'aria-label': t('kindling.paths.aria') },
      on: {
        keydown: (ev) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
          let to = null;
          if (step) to = (atBiome + step + biomes.length) % biomes.length;
          else if (ev.key === 'Home') to = 0;
          else if (ev.key === 'End') to = biomes.length - 1;
          if (to === null || biomes.length === 0) return;
          ev.preventDefault();
          switchPath(biomes[to].id);
        },
      },
    });
    paths.append(el('span', { cls: 'bs-label', text: t('kindling.path') }));
    for (const b of biomes) {
      const on = curBiome === b.id;
      paths.append(el('button', {
        cls: `biome-pick${on ? ' on' : ''} bp-${b.id}`, text: b.name,
        attrs: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1' },
        on: { click: () => switchPath(b.id) },
      }));
    }
    wrap.append(paths);
  }
  wrap.append(el('div', { cls: 'big-title kindling-head', text: t('kindling.head') }));
  wrap.append(el('p', { cls: 'kindling-note', text: t('kindling.note') }));
  const list = el('div', { cls: 'boon-list' });
  for (const b of snap.kindling.boons) {
    list.append(el('button', {
      cls: 'boon', attrs: { type: 'button', 'data-action': b.actionId, 'aria-label': `${b.name}: ${b.text}` },
      on: { click: () => act(b.actionId) },
    },
    el('span', { cls: 'boon-name', text: b.name }),
    keywordText(el('span', { cls: 'boon-text' }), b.text)));
  }
  wrap.append(list);
  return page('kindling', t('page.kindling'), 'flame', 'panel', [wrap]);
}
