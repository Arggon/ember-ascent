// src/web/tour.js — the first-run product tour: five coach-marks over the REAL screens.
//
// ONBOARDING-TOUR spec (docs/specs/ONBOARDING-TOUR-spec.md). PRESENTATION ONLY: it reads
// `snap` (the kernel's value model) and localStorage, never a rule. Its layer is the
// PERSISTENT #tour-layer, a sibling of #stage declared in index.html, so `render()`
// rebuilding #stage can never destroy a coach-mark mid-read. The five steps anchor to
// elements the views already paint:
//   kindling → .boon-list   map → .map   hand → .hand   intent → .e-intent   endTurn → .controls
// Next/click and Enter/→ advance; ← goes back; Escape, Skip and a shade click dismiss.
// Dismissing or finishing writes BOTH onboarding flags, which is what keeps a fresh boot
// from ever falling back to the retired auto-opened Help sheet. A player with NEITHER
// flag is "fresh onboarding" — the tour replaces that auto-Help as the first-run surface;
// an old-Help veteran (helpSeen set) is onboarded and re-enters through Help's Replay.
// The shade ring is four dim boxes AROUND the anchor's rect: the marked element is the
// one visible — and clickable — region, so the tour teaches by doing.

import { snap, repaint } from './runtime.js';
import { el, announce } from './dom.js';
import { t } from './i18n.js';

// The onboarding flag pair (spec §4): finishing or dismissing the tour writes BOTH, so
// the strings live here and hud.js consumes HELP_SEEN_KEY from this module — no drift.
export const TOUR_SEEN_KEY = 'dlb.tourSeen.v1';
export const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/** The five steps in player order. `phase` gates the contextual jump (a phase change
 *  under an open tour lands on the new phase's first step); `sel` is the real anchor
 *  the shade ring is measured against — a live element the views paint, nothing invented. */
const STEPS = [
  { id: 'kindling', phase: 'kindling', sel: '.boon-list' },
  { id: 'map', phase: 'map', sel: '.map' },
  { id: 'hand', phase: 'combat', sel: '.hand' },
  { id: 'intent', phase: 'combat', sel: '.e-intent' },
  { id: 'endTurn', phase: 'combat', sel: '.controls' },
];

export let tourOpen = false;
export let tourStep = 0;
/** The step the overlay last painted, so focus and the live announcement fire on a step
 *  CHANGE only — tourSync runs on every repaint (a hover re-measures the ring), and
 *  refocusing the card per hover would steal the caret from the player. */
let paintedAt = -1;

const read = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return true; } };
const write = (key) => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } };

/** Fresh onboarding: neither onboarding flag is set. HELP_SEEN_KEY is read, never
 *  written here — old-Help veterans and the e2e harness are onboarded already. */
export function freshOnboarding() {
  return !read(TOUR_SEEN_KEY) && !read(HELP_SEEN_KEY);
}

function layer() {
  const root = document.getElementById('tour-layer');
  return root && root.isConnected ? root : null;
}

/** Close without repainting — the ONLY form tourSync may call (it runs mid-paint; a
 *  repaint from inside the paint sink would recurse). Event handlers use dismissTour. */
function closeTour() {
  tourOpen = false;
  write(TOUR_SEEN_KEY);
  write(HELP_SEEN_KEY);
  const root = layer();
  if (root) root.replaceChildren();
}

/** Dismiss for good (Skip, Escape, Done, a shade click): both flags, then repaint so the
 *  page shows the plain screens again. Never called mid-render. */
export function dismissTour() {
  closeTour();
  repaint();
}

export function tourNext() {
  if (!tourOpen) return;
  if (tourStep >= STEPS.length - 1) { dismissTour(); return; }
  tourStep += 1;
  paintTour();
}
export function tourBack() {
  if (!tourOpen || tourStep === 0) return;
  tourStep -= 1;
  paintTour();
}

/** Open the tour on demand (the Help sheet's Replay entry) at the step for the CURRENT
 *  phase; an unknown phase parks on step 1. Opening writes no flag; paintedAt resets so
 *  the landed step announces and takes the caret even if a previous visit painted it. */
export function startTour() {
  const at = STEPS.findIndex((s) => s.phase === snap.phase);
  tourStep = at === -1 ? 0 : at;
  tourOpen = true;
  paintedAt = -1;
  paintTour();
}

/** One coach-mark over the current anchor. Rebuilt wholesale per paint (the stage
 *  repaints per action; this layer repaints with it), so no node of it can go stale. */
function paintTour() {
  const root = layer();
  if (!root) return;
  if (!tourOpen) { root.replaceChildren(); return; }
  const step = STEPS[tourStep];
  const count = t('tour.stepOf', { n: tourStep + 1, m: STEPS.length });
  const title = t(`tour.step.${step.id}.title`);
  const card = el('div', { cls: 'tour-card', attrs: { role: 'dialog', 'aria-label': `${t('tour.title')} — ${count}` } });
  card.append(el('span', { cls: 'tour-count', text: count }));
  card.append(el('h3', { cls: 'tour-head', text: title }));
  card.append(el('p', { cls: 'tour-body', text: t(`tour.step.${step.id}.body`) }));
  const nav = el('div', { cls: 'tour-nav' });
  if (tourStep > 0) nav.append(el('button', {
    cls: 'btn secondary tour-back', text: t('tour.back'), attrs: { type: 'button' }, on: { click: tourBack },
  }));
  nav.append(el('button', {
    cls: 'btn tour-next',
    text: tourStep >= STEPS.length - 1 ? t('tour.done') : t('tour.next'),
    attrs: { type: 'button' },
    on: { click: tourNext },
  }));
  nav.append(el('button', {
    cls: 'btn ghost tour-skip', text: t('tour.skip'), attrs: { type: 'button' }, on: { click: dismissTour },
  }));
  card.append(nav);
  root.replaceChildren();

  // The ring: four shades AROUND the anchor's rect (a hole, not an outline), so the
  // marked element stays the visible — and clickable — region while everything else
  // dims behind the shades. A shade CLICK dismisses (the .modal-back convention).
  const W = window.innerWidth; const H = window.innerHeight;
  const anchor = document.querySelector(step.sel);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    // This paint may be the one that STARTED the phase entrance (.enter fade-up, the map
    // rows' ea-rise — both translateY for ~0.42s), so r can sit ~10px from where the
    // element RESTS. The ring dims what is on screen (r); the card's placement decides
    // on the resting geometry — a band chosen on a rect that then settles leaves the
    // card over its anchor for the screen's life (measured: a 1.2px graze at 390x844, a
    // covered travel node at 640x460). Subtracting the ancestors' summed translate
    // recovers it; real scroll is already inside r.
    let dx = 0; let dy = 0;
    for (let e = anchor; e; e = e.parentElement) {
      const tr = getComputedStyle(e).transform;
      if (tr && tr !== 'none') {
        const m = tr.match(/^matrix\(([^)]+)\)$/);
        if (m) { const p = m[1].split(',').map(Number); dx += p[4]; dy += p[5]; }
      }
    }
    const rest = { left: r.left - dx, top: r.top - dy, right: r.right - dx, bottom: r.bottom - dy };
    const pad = 10;
    const vx0 = Math.max(0, r.left - pad); const vy0 = Math.max(0, r.top - pad);
    const vx1 = Math.min(W, r.right + pad); const vy1 = Math.min(H, r.bottom + pad);
    // Shades FIRST, the card LAST: positioned siblings paint in DOM order, so appending
    // the card after the ring keeps the card — and its Next — above the dim bands.
    const shade = (style) => root.append(el('div', {
      cls: 'tour-shade', attrs: { style }, on: { click: dismissTour },
    }));
    shade(`left:0;top:0;width:${W}px;height:${vy0}px`);
    shade(`left:0;top:${vy0}px;width:${vx0}px;height:${vy1 - vy0}px`);
    shade(`left:${vx1}px;top:${vy0}px;width:${W - vx1}px;height:${vy1 - vy0}px`);
    shade(`left:0;top:${vy1}px;width:${W}px;height:${H - vy1}px`);
    root.append(card);
    if (W <= 620 || H <= 480) { // the phone / landscape-phone bands park the card
      // AC7: the parked card must not cover its anchor — and, when the anchor is a whole
      // board so BOTH vertical bands cross it, nothing essential inside it. Score the
      // bands by actionable elements covered first (a travel node hidden behind the card
      // is the unrecoverable loss — 640x460), then by anchor overlap (390x844: the
      // resting map ends at 666.5 and the bottom band's edge 671.3 clears it while the
      // top grazes). An exact tie falls to the bottom band, the reference default.
      const h = card.offsetHeight;
      const bands = [
        { top: H - 8 - h, bottom: H - 8, hits: 0, area: 0 },
        { top: 8, bottom: 8 + h, hits: 0, area: 0 },
      ];
      for (const b of bands) {
        for (const n of anchor.querySelectorAll('button, a')) {
          const nr = n.getBoundingClientRect();
          if (nr.bottom > b.top && nr.top < b.bottom && nr.right > 0 && nr.left < W) b.hits += 1;
        }
        b.area = Math.max(0, Math.min(rest.bottom, b.bottom) - Math.max(rest.top, b.top));
      }
      bands.sort((p, q) => p.hits - q.hits || p.area - q.area);
      if (bands[0].top === 8) { card.style.top = '8px'; card.style.bottom = ''; card.style.left = '8px'; card.style.right = '8px'; }
      else { card.style.left = '8px'; card.style.right = '8px'; card.style.bottom = '8px'; }
    } else {
      const y0 = Math.max(0, rest.top - pad); const y1 = Math.min(H, rest.bottom + pad);
      const below = y1 + 12 + 230 < H;
      card.style.top = below ? `${y1 + 12}px` : `${Math.max(8, y0 - 242)}px`;
      card.style.left = `${Math.min(Math.max(8, Math.max(0, rest.left - pad)), Math.max(8, W - 348))}px`;
    }
  } else {
    // A missing anchor (a kill-hold stage, a phase racing the views) parks the card
    // bottom-centre with no ring: the copy still reads.
    card.style.left = '50%'; card.style.transform = 'translateX(-50%)'; card.style.bottom = '8px';
    root.append(card);
  }
  if (paintedAt !== tourStep) {
    paintedAt = tourStep;
    announce(`${title}. ${t(`tour.step.${step.id}.body`)}`); // the step is text, not colour
    const primary = card.querySelector('.tour-next');
    if (primary) { try { primary.focus({ preventScroll: true }); } catch { /* best effort */ } }
  }
}

/** The paint-path hook, called by render() AFTER the stage and its sheets are painted,
 *  with the paint's own `phaseChanged`. Opens the tour on a fresh-onboarding boot (the
 *  auto-Help's replacement), jumps an open tour to the new phase's first step, closes it
 *  (both flags) when the run leaves the tour phases for good — the shades must never
 *  block a spoils click — and re-measures the ring for this layout. Mutates ONLY this
 *  module's state and #tour-layer — never repaints, never touches a game rule
 *  (render.js's deal-clock arming is the paint-sink precedent). */
export function tourSync(phaseChanged) {
  if (!tourOpen) {
    if (freshOnboarding() && snap.phase === 'kindling') tourOpen = true;
  } else {
    const at = STEPS.findIndex((s) => s.phase === snap.phase);
    if (at === -1) { closeTour(); return; }
    if (phaseChanged && STEPS[tourStep].phase !== snap.phase) tourStep = at;
  }
  paintTour();
}
