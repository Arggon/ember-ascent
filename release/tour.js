// src/web/tour.js — the first-run product tour: five coach-marks over the REAL screens.
//
// ONBOARDING-TOUR spec (docs/specs/ONBOARDING-TOUR-spec.md). PRESENTATION ONLY: it reads
// `snap` (the kernel's value model) and localStorage, never a rule. Its layer is the
// PERSISTENT #tour-layer, a sibling of #stage declared in index.html, so `render()`
// rebuilding #stage can never destroy a coach-mark mid-read. The five steps anchor to
// elements the views already paint:
//   kindling → .boon-list   map → .map   hand → .hand   intent → .e-intent   endTurn → .controls
// Navigation is PHASE-GATED (review round 2): a Next/Back exists — and is keyed — only
// when its DESTINATION step shares the phase on screen; where the way forward is an
// ACTION (take the boon, travel a node) the card shows a hint line instead and
// tourSync's phase jump carries the tour across. Escape, Skip and a shade click dismiss.
// Dismissing or finishing writes BOTH onboarding flags, which is what keeps a fresh boot
// from ever falling back to the retired auto-opened Help sheet. A player with NEITHER
// flag is "fresh onboarding" — the tour replaces that auto-Help as the first-run surface;
// an old-Help veteran (helpSeen set) is onboarded and re-enters through Help's Replay.
//
// THE LANGUAGE PRE-STEP (LANG_STEP): on a fresh onboarding boot whose player has never
// picked a language (i18n.js langChosen() false — no dlb.lang written), the tour's FIRST
// card is the language choice, BEFORE the boon step: bilingual copy (its whole job is
// to be readable before any language exists) and two native-named buttons. Picking one,
// pressing Next, or ANY other exit (Skip, Escape, an act on the undimmed kindling screen
// below) persists the language — dlb.lang is written and the pre-step never shows again.
// The replay entry (startTour) NEVER opens it: a veteran is past onboarding. No ring —
// the kindling screen underneath stays fully visible, because watching it flip to the
// chosen language is the point of choosing HERE.
//
// The shade ring is four dim boxes AROUND the anchor's rect: the marked element is the
// one visible — and clickable — region, so the tour teaches by doing.

import { snap, repaint, ctl, setSnap } from './runtime.js';
import { el, announce } from './dom.js';
import { t, setLang, currentLang, langChosen } from './i18n.js';

// The onboarding flag pair (spec §4): finishing or dismissing the tour writes BOTH, so
// the strings live here and hud.js consumes HELP_SEEN_KEY from this module — no drift.
export const TOUR_SEEN_KEY = 'dlb.tourSeen.v1';
export const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/** The language pre-step's index in `tourStep`: NOT a member of STEPS (the other five
 *  keep their 'n of 5' counter), one card BEFORE the boon step, shown only while
 *  `langChosen()` is false on a fresh onboarding boot. */
const LANG_STEP = -1;

/* The language pre-step's copy is BILINGUAL BY DESIGN, not STRINGS rows: its whole job
 * is to be READABLE BEFORE any language has been picked, so both languages show at once
 * (the title pairs them; the two buttons carry each language's NATIVE name) and a player
 * who reads neither current default can still find their own. `t()` renders ONE language
 * at a time — exactly wrong here — so these literals stay local and the i18n unit test's
 * every-key-has-an-en-row rule deliberately does not see them. Every OTHER tour string
 * stays in STRINGS (spec §7); the pre-step's chrome (Next, Skip) does too, because by
 * the time it renders the browser default already speaks the player's locale. */
const LANG_TITLE = 'Idioma — Language';
const LANG_BODY_ES = 'Elige el idioma del juego — toda la interfaz lo sigue, y puedes cambiarlo después con el botón de idioma de la cabecera (EN/ES).';
const LANG_BODY_EN = 'Pick the game\u2019s language — the whole interface follows it, and you can change it later with the header\u2019s language button (EN/ES).';
/** Native names, keyed by the i18n language id — never translated: each button reads as
 *  itself in the language it selects. */
const LANG_NAMES = Object.freeze({ en: 'English', es: 'Español' });

/** The five steps in player order. `phase` gates BOTH the contextual jump (a phase change
 *  under an open tour lands on the new phase's first step) and the Next/Back buttons (a
 *  button is painted — and keyed — only when its destination step shares the phase on
 *  screen); `sel` is the real anchor the shade ring is measured against — a live element
 *  the views paint, nothing invented. `hint` names the i18n line shown where a Next would
 *  mis-teach: the way forward is the player's own act, not a button. */
const STEPS = [
  { id: 'kindling', phase: 'kindling', sel: '.boon-list', hint: 'tour.hint.kindling' },
  { id: 'map', phase: 'map', sel: '.map', hint: 'tour.hint.map' },
  { id: 'hand', phase: 'combat', sel: '.hand' },
  { id: 'intent', phase: 'combat', sel: '.e-intent' },
  { id: 'endTurn', phase: 'combat', sel: '.controls' },
];

export let tourOpen = false;
export let tourStep = 0;
/** The step the overlay last painted, so focus and the live announcement fire on a step
 *  CHANGE only — tourSync runs on every repaint (a hover re-measures the ring), and
 *  refocusing the card per hover would steal the caret from the player. The sentinel is
 *  -2 because -1 is a REAL step now (the language pre-step). */
let paintedAt = -2;

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
 *  repaint from inside the paint sink would recurse). Event handlers use dismissTour.
 *  Leaving the language pre-step by ANY route persists the current language (the ask's
 *  "toda salida del paso persiste la elección"): a player who saw the choice and walked
 *  away keeps the browser default rather than being asked again next boot. */
function closeTour() {
  if (tourStep === LANG_STEP) setLang(currentLang());
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
  // The language pre-step's Next CONFIRMS the current (browser-default) language — the
  // explicit write is the exit's persist — and moves on to the boon step. No ring was
  // dimming anything, so no repaint is needed; the card alone changes.
  if (tourStep === LANG_STEP) { setLang(currentLang()); tourStep = 0; paintTour(); return; }
  if (tourStep >= STEPS.length - 1) { dismissTour(); return; }
  // The phase gate (review round 2): the next step lives on ANOTHER screen, so the way
  // forward there is the action — the key (like the absent button) does nothing, and a
  // coach-mark can never park over a screen its anchor is not painted on.
  if (STEPS[tourStep + 1].phase !== snap.phase) return;
  tourStep += 1;
  paintTour();
}
export function tourBack() {
  // `<= 0` also holds the language pre-step: it has NO Back — nothing exists before it.
  if (!tourOpen || tourStep <= 0) return;
  // Same gate backwards: the previous step of another phase is another screen.
  if (STEPS[tourStep - 1].phase !== snap.phase) return;
  tourStep -= 1;
  paintTour();
}

/** Open the tour on demand (the Help sheet's Replay entry) at the step for the CURRENT
 *  phase; an unknown phase parks on step 0. findIndex returns the FIRST match, so a
 *  kindling phase lands on the boon step (STEPS[0]) — under the fixed start that choice
 *  IS the run's first decision. NEVER the language pre-step: a replaying veteran is
 *  past onboarding whatever dlb.lang says. Opening writes no flag; paintedAt resets so
 *  the landed step announces and takes the caret even if a previous visit painted it. */
export function startTour() {
  const at = STEPS.findIndex((s) => s.phase === snap.phase);
  tourStep = at === -1 ? 0 : at;
  tourOpen = true;
  paintedAt = -2;
  paintTour();
}

/** The language pre-step's pick: persist through i18n (which also flips <html lang>),
 *  then re-narrate the CURRENT run in the chosen language — a fresh `ctl.snapshot
 *  ({ lang })` and a repaint, the exact move switchLang() makes (actions.js) — so the
 *  kindling screen UNDER the card flips too, which is why the pre-step dims nothing.
 *  tourStep moves first, so the repaint's tourSync already lands on the boon step in
 *  the new language; the trailing paintTour() only covers hosts whose repaint hook is
 *  not yet registered. */
function chooseLang(id) {
  tourStep = 0;
  setLang(id);
  if (ctl) setSnap(ctl.snapshot({ lang: currentLang() }));
  repaint();
  paintTour();
}

/** The language pre-step's card (ONBOARDING-TOUR, the language ask): bilingual copy and
 *  two native-named buttons, NO step counter (it is a pre-step — the five real steps keep
 *  their 'n of 5') and NO shade ring — the kindling screen underneath must stay fully
 *  visible and clickable, because the choice is supposed to flip it before the player's
 *  eyes. The card parks bottom-centre (the missing-anchor convention) and its Next
 *  confirms the current default. */
function paintLangChoice(root) {
  const card = el('div', {
    cls: 'tour-card',
    attrs: { role: 'dialog', tabindex: '-1', 'aria-label': LANG_TITLE },
  });
  card.append(el('h3', { cls: 'tour-head', text: LANG_TITLE }));
  // Two paragraphs, Spanish first to match the title's pairing — one <p> would need
  // white-space tricks to keep the two languages apart.
  card.append(el('p', { cls: 'tour-body', text: LANG_BODY_ES }));
  card.append(el('p', { cls: 'tour-body', text: LANG_BODY_EN }));
  const langs = el('div', { cls: 'tour-langs' });
  for (const id of ['es', 'en']) {
    langs.append(el('button', {
      cls: 'btn secondary tour-lang',
      text: LANG_NAMES[id],
      attrs: { type: 'button', 'aria-pressed': String(currentLang() === id) },
      on: { click: () => chooseLang(id) },
    }));
  }
  card.append(langs);
  const nav = el('div', { cls: 'tour-nav' });
  nav.append(el('button', {
    cls: 'btn tour-next',
    text: t('tour.next'),
    attrs: { type: 'button' },
    on: { click: tourNext },
  }));
  nav.append(el('button', {
    cls: 'btn ghost tour-skip', text: t('tour.skip'), attrs: { type: 'button' }, on: { click: dismissTour },
  }));
  card.append(nav);
  root.replaceChildren();
  card.style.bottom = '8px';
  root.append(card);
  // Bottom-centre is a COMPUTED pixel `left`, never an inline transform: the .tour-card
  // entrance keyframes end in `transform: none` and, with fill-mode 'both', that final
  // value overrides an inline translateX(-50%) for the card's WHOLE life — measured with
  // motion normal at 390x844 the card hung 125px off the right edge (left 195 + width
  // 320 = 515) and 'English'/Next were unreachable by click. offsetWidth reads the
  // settled width rule (min(320px, calc(100vw - 24px))); max(8, …) cannot matter today
  // but keeps a wider-than-viewport card on screen.
  card.style.left = `${Math.max(8, (window.innerWidth - card.offsetWidth) / 2)}px`;
  if (paintedAt !== tourStep) {
    paintedAt = tourStep;
    announce(`${LANG_TITLE}. ${LANG_BODY_ES} ${LANG_BODY_EN}`);
    const primary = card.querySelector('.tour-next');
    try { (primary || card).focus({ preventScroll: true }); } catch { /* best effort */ }
  }
}

/** One coach-mark over the current anchor. Rebuilt wholesale per paint (the stage
 *  repaints per action; this layer repaints with it), so no node of it can go stale. */
function paintTour() {
  const root = layer();
  if (!root) return;
  if (!tourOpen) { root.replaceChildren(); return; }
  if (tourStep === LANG_STEP) { paintLangChoice(root); return; }
  const step = STEPS[tourStep];
  const count = t('tour.stepOf', { n: tourStep + 1, m: STEPS.length });
  const title = t(`tour.step.${step.id}.title`);
  // The phase-gated nav (review round 2): buttons only where their destination shares
  // the phase on screen; an action step carries the hint line instead. The last step's
  // Done is always offered — dismissal is not a phase crossing.
  const canNext = tourStep < STEPS.length - 1 && STEPS[tourStep + 1].phase === snap.phase;
  const canBack = tourStep > 0 && STEPS[tourStep - 1].phase === snap.phase;
  const last = tourStep >= STEPS.length - 1;
  // tabindex so an action step (no Next to focus) can still take the caret on its step
  // change, keeping every step-change focus INSIDE the dialog.
  const card = el('div', { cls: 'tour-card', attrs: { role: 'dialog', tabindex: '-1', 'aria-label': `${t('tour.title')} — ${count}` } });
  card.append(el('span', { cls: 'tour-count', text: count }));
  card.append(el('h3', { cls: 'tour-head', text: title }));
  card.append(el('p', { cls: 'tour-body', text: t(`tour.step.${step.id}.body`) }));
  if (step.hint) card.append(el('p', { cls: 'tour-hint', text: t(step.hint) }));
  const nav = el('div', { cls: 'tour-nav' });
  if (canBack) nav.append(el('button', {
    cls: 'btn secondary tour-back', text: t('tour.back'), attrs: { type: 'button' }, on: { click: tourBack },
  }));
  if (canNext || last) nav.append(el('button', {
    cls: 'btn tour-next',
    text: last ? t('tour.done') : t('tour.next'),
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
    // The visible rect (raw) and the resting rect (translate-unwound): this paint may be
    // the one that STARTED the phase entrance (.enter fade-up, the map rows' ea-rise —
    // both translateY for ~0.42s), so r can sit ~10px from where the element RESTS. The
    // ring dims what is on screen (r); the card's placement decides on the resting
    // geometry — a band chosen on a rect that then settles leaves the card over its
    // anchor for the screen's life (measured: a 1.2px graze at 390x844, a covered travel
    // node at 640x460). Subtracting the ancestors' summed translate recovers it; real
    // scroll is already inside r.
    const r = anchor.getBoundingClientRect();
    let dx = 0; let dy = 0;
    for (let e = anchor; e; e = e.parentElement) {
      const tr = getComputedStyle(e).transform;
      if (tr && tr !== 'none') {
        const m = tr.match(/^matrix\(([^)]+)\)$/);
        if (m) { const p = m[1].split(',').map(Number); dx += p[4]; dy += p[5]; }
      }
    }
    const vx0 = r.left; const vy0 = r.top; const vx1 = r.right; const vy1 = r.bottom;
    const rx0 = r.left - dx; const ry0 = r.top - dy;
    const rx1 = r.right - dx; const ry1 = r.bottom - dy;
    const pad = 10;
    const x0 = Math.max(0, vx0 - pad); const y0 = Math.max(0, vy0 - pad);
    const x1 = Math.min(W, vx1 + pad); const y1 = Math.min(H, vy1 + pad);
    // Shades FIRST, the card LAST: positioned siblings paint in DOM order, so appending
    // the card after the ring keeps the card — and its Next — above the dim bands.
    const shade = (style) => root.append(el('div', {
      cls: 'tour-shade', attrs: { style }, on: { click: dismissTour },
    }));
    shade(`left:0;top:0;width:${W}px;height:${y0}px`);
    shade(`left:0;top:${y0}px;width:${x0}px;height:${y1 - y0}px`);
    shade(`left:${x1}px;top:${y0}px;width:${W - x1}px;height:${y1 - y0}px`);
    shade(`left:0;top:${y1}px;width:${W}px;height:${H - y1}px`);
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
        b.area = Math.max(0, Math.min(ry1, b.bottom) - Math.max(ry0, b.top));
      }
      bands.sort((p, q) => p.hits - q.hits || p.area - q.area);
      if (bands[0].top === 8) { card.style.top = '8px'; card.style.bottom = ''; card.style.left = '8px'; card.style.right = '8px'; }
      else { card.style.left = '8px'; card.style.right = '8px'; card.style.bottom = '8px'; }
    } else {
      const by0 = Math.max(0, ry0 - pad); const by1 = Math.min(H, ry1 + pad);
      const below = by1 + 12 + 230 < H;
      card.style.top = below ? `${by1 + 12}px` : `${Math.max(8, by0 - 242)}px`;
      card.style.left = `${Math.min(Math.max(8, Math.max(0, rx0 - pad)), Math.max(8, W - 348))}px`;
    }
  } else {
    // A missing anchor (a kill-hold stage, a phase racing the views) parks the card
    // bottom-centre with no ring: the copy still reads. Centred by a COMPUTED pixel
    // `left`, not an inline transform — same reason as the language pre-step above (the
    // entrance keyframes' `transform: none` override, fill-mode 'both').
    card.style.bottom = '8px';
    root.append(card);
    card.style.left = `${Math.max(8, (W - card.offsetWidth) / 2)}px`;
  }
  if (paintedAt !== tourStep) {
    paintedAt = tourStep;
    // The step is text, not colour; an action step's hint IS its way forward, so it is
    // announced with the body.
    announce(`${title}. ${t(`tour.step.${step.id}.body`)}${step.hint ? ` ${t(step.hint)}` : ''}`);
    // Focus follows the step change into the dialog: the primary button when the phase
    // offers one, else the card itself (an action step's only way forward is the
    // player's act, not a card button).
    const primary = card.querySelector('.tour-next');
    try { (primary || card).focus({ preventScroll: true }); } catch { /* best effort */ }
  }
}

/** The paint-path hook, called by render() AFTER the stage and its sheets are painted,
 *  with the paint's own `phaseChanged`. Opens the tour on a fresh-onboarding boot (the
 *  auto-Help's replacement), jumps an open tour to the new phase's first step (the
 *  action-gate's other half: the player's act, not a button, walks the tour across a
 *  screen), closes it (both flags) when the run leaves the tour phases for good — the
 *  shades must never block a spoils click — and re-measures the ring for this layout.
 *  Mutates ONLY this module's state and #tour-layer — never repaints, never touches a
 *  game rule (render.js's deal-clock arming is the paint-sink precedent). */
export function tourSync(phaseChanged) {
  if (!tourOpen) {
    if (freshOnboarding() && snap.phase === 'kindling') {
      tourOpen = true;
      // The language pre-step leads ONLY while the player has never chosen (dlb.lang
      // unwritten): a chosen or veteran boot lands straight on the boon step.
      tourStep = langChosen() ? 0 : LANG_STEP;
    }
  } else {
    const at = STEPS.findIndex((s) => s.phase === snap.phase);
    if (at === -1) { closeTour(); return; }
    if (tourStep === LANG_STEP) {
      // The kindling screen under the language card is NOT dimmed, so the player may act
      // on it — that act is another exit from the pre-step: persist the language, then
      // the ordinary phase jump follows (the tour follows the player's hands).
      if (phaseChanged) { setLang(currentLang()); tourStep = at; }
    } else if (phaseChanged && STEPS[tourStep].phase !== snap.phase) {
      tourStep = at;
    }
  }
  paintTour();
}
