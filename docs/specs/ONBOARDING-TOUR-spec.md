# ONBOARDING-TOUR — the first-run Product Tour (five coach-marks over the real screens)

**Owner:** Tech Lead → Frontend Engineer · 2026-11-09.
**Ask:** "El juego puede ser un poco difícil de jugarlo por primera vez… agrega un Product Tour, User Onboarding o Guías dinámicas de interfaz para hacer más ameno el juego para usuarios primerizos."
**Language ask (2026-11-10):** "El tutorial inicia por defecto en inglés. Como usuario quiero poder elegir el idioma del juego antes del tutorial." — answered by the **language pre-step** (§3.5): the tour's FIRST card on a never-chose boot is the bilingual language choice, and the browser's locale decides the pre-choice default without writing anything.
**Format:** tagged claims like `UX-9-enemy-action-fx-spec.md` — `[READ]` = re-verified in source or executed this run; `[INFERRED]` = this spec's design decision. Every decision the ask required is stated as a decision, not an option.
**Sibling specs:** `UX-9-enemy-action-fx-spec.md` (spec format), `NAMES.md` (the proper nouns the tour copy uses: Ashwright, Slag Warden).

---

## 1. Context

The boot lands on a **boon/kindling screen, not combat** `[READ, executed]`: the browser's boot is `newGame()`, which builds the controller with `kindling: true` (`src/web/actions.js:584`), and the kernel answers `phase: 'kindling'`, `stepIndex: 0` for a fresh run. Measured this run:

```
$ node -e "import('./src/kernel/index.js').then(k => console.log(k.newRun({ seed: 7, kindling: true, character: 'ironclad' }).phase))"
phase: kindling
```

(without the `kindling` flag the raw kernel boots at `phase: 'map'` — the flag is what the page passes, so the page boots at kindling. The e2e boot walk agrees: `tests/web/e2e.browser.spec.js:272` "boot: kindling choice leads to the map".)

Today a first-time player's only guidance is the **auto-opened Help sheet**: `render()` appends `helpPanel()` whenever `dlb.helpSeen.v1` is unset (`src/web/render.js:296-302`), a wall of kernel help topics plus a ~40-row glossary (`src/web/hud.js:317-383`). It explains vocabulary, not the loop, and it covers the screen the player must act on. This spec replaces that first-run surface with a **five-step contextual tour**: short coach-marks anchored to elements the views already paint, phase-gated so a step only advances onto the screen it describes, dismissable by click and by keyboard, replayable by veterans, localized in both languages, presentation-only, zero dependencies.

## 2. Current mechanism (real names)

- **The one paint path:** `render()` rebuilds `#stage` after every action (`src/web/render.js:91-344`); `#stage`'s children never survive a paint. The persistent siblings that survive are `#hud`, `#fx-layer` (`z-index: 55`, fixed, `pointer-events: none` — `style.css:1734-1741`), `#toast` (60) and `#live` (`src/web/index.html:21-44`). Modal sheets paint INTO `#stage` per paint (`.modal-back`, `z-index: 70` — `style.css:1592-1603`).
- **The Help flag:** `HELP_SEEN_KEY = 'dlb.helpSeen.v1'` (`hud.js:292`). Written by the sheet's "Got it" (`hud.js:369`) and by Escape on the first-run paint (`app.js:71-79`); read by the paint sink for the auto-open (`render.js:297-302`) and by the keyboard guard to mean "the sheet is open via first-run paint" (`app.js:71-79`).
- **The keyboard contract:** one `keydown` listener whose guards run in order — Help sheet, deck (`d`), codex (`k`), belt popover, sheet toggles, targeting, the UX-5 busy gate, then the phase shortcuts (`app.js:52-155`). A guard `return`s without `preventDefault` for keys it only swallows from the game, so native Tab still moves focus — the accepted (unfixed) limitation shared by every sheet.
- **Runtime handles:** `snap` (the kernel's value model), `repaint` (the registered paint hook, `runtime.js:507-509`), `reducedMotion` (`runtime.js:35-37`), `announce()` (`dom.js`), `el()` (`dom.js:9-18`). `#fx-layer` is null-guarded because narrow test harnesses build only `#hud/#stage/#toast/#live/#app` (`runtime.js:21-27`) — the tour layer must follow the same guard.
- **Anchors the views already paint** `[READ]`: `.boon-list` (`kindling-view.js`), `.map` (`map-view.js:34`), `.hand` (`combat-view.js:458`), the energy orb `.energy-orb` (`combat-view.js:299-311`), the enemy intent row `.e-intent` (`combat-view.js:608,611`), the controls row `.controls` with the End Turn button (`combat-view.js:360-391`).
- **Test harness:** every existing e2e walk seeds `localStorage.setItem('dlb.helpSeen.v1','1')` before goto (`e2e.browser.spec.js:116` and 10 more call sites — 11 in total; the twelfth `addInitScript` at `:1996` seeds the veteran ledger, not a flag). Any onboarding rule that keyed on `dlb.helpSeen.v1` **alone** would auto-open the tour in every existing test and break the suite — this fact drives the flag rule in §4.
- **Gates:** `npm run gate` (`scripts/check-architecture.mjs`) — clean baseline this run ("scanned 67 files under src/, OK"); `scripts/check-surface-art.mjs` requires every class a `src/web` module emits to have a rule in `style.css` and top-level selectors to stay unique (`style.css:52-53` banner); `scripts/measure-tokens.mjs` exports `countWorst()` (worst of o200k_base / cl100k_base) and its CLI spike is dev-only, not a gate.

## 3. The tour at a glance

**Review round 2 (a real player, live, 2026-11-09)** reported two things: pressing Next showed the next message but not the next screen (on the MAP the card read "Your hand and your Energy" parked bottom-centre with no ring, because Next had stepped the tour onto `hand` and `.hand` does not exist on the map), and the hero/path pick should have its own guide instead of being folded into the kindling step's copy while the ring only covered `.boon-list`. Round 2's answer shipped six steps with a union ring over both picks. The **fixed-start ruling (2026-11-18)** then retired the hero/path pickers outright — every run starts the same hero on the same start path, and the `?hero=/?biome=` seeding in actions.js is the only chooser — and with the pickers went the heroes step and the union ring. The shipped tour is the **five steps, phase-gated navigation** below.

Five steps, in player order, each anchored to a real element:

| # | id | fires when | anchor (live selector) | teaches |
|---|----|-----------|------------------------|---------|
| 1 | `kindling` | boot (`phase: 'kindling'`) | `.boon-list` | take exactly ONE kindling — each gift has a price, and taking it starts the ascent |
| 2 | `map` | first arrival at `phase: 'map'` under an open tour | `.map` | click a glowing node to travel; fights pay cards, campfire heals, the Slag Warden is at the top |
| 3 | `hand` | first arrival at `phase: 'combat'` under an open tour | `.hand` | click a card; the `.energy-orb` counts the turn's Energy |
| 4 | `intent` | within the combat steps (Next/Enter) | first `.e-intent` | the enemy's row announces its next move; a number is damage headed your way |
| 5 | `endTurn` | within the combat steps (Next/Enter) | `.controls` | End Turn passes; enemies act; a fresh hand is dealt — the whole loop |

**Decision — phase-gated navigation ("teach by doing")** `[INFERRED, review round 2]`: a Next/Back button exists **only when its DESTINATION step shares the phase on screen** (`STEPS[n].phase === snap.phase`); where the continuation is an **action** (the kindling step → the map, the map step → combat) there is no Next and the card carries a readable **hint line** instead (`tour.hint.kindling` / `tour.hint.map`), because the player's own act — taking the boon, travelling a node — is what advances the tour, via the phase jump that already existed in `tourSync` (`phaseChanged` → the new phase's FIRST step; `findIndex` returns the first match, so kindling resolves to the boon step (`STEPS[0]` — under the fixed start the boon IS the run's first decision), map to `map`, combat to `hand` — that jump is kept untouched). The gate binds the keyboard too: `tourNext()`/`tourBack()` no-op across a phase boundary, so no key can park a coach-mark over a screen its anchor is not painted on — the player's exact bug. Navigation matrix: `kindling` has neither button and a hint (it is the FIRST step — nothing exists before it); `map` has neither button and a hint (Skip remains everywhere); `hand` has Next only; `intent` has both; `endTurn` has Back and Done.

## 3.5 Decision — the language pre-step (the language ask)

**The complaint:** the tour (and the whole first boot) started in English regardless of the player, and the language could only be changed afterwards via the HUD's EN/ES toggle. The fix has three moving parts `[INFERRED]`:

1. **The pre-choice default is the browser's, in memory only** (`src/web/i18n.js readLang`): while `dlb.lang` is unwritten, a `navigator.language` that starts with `'es'` reads Spanish and anything else English — **nothing is written**. An explicit choice (`'en'` or `'es'`, the only values `setLang` writes) always wins. So a Spanish browser boots already in Spanish BEFORE choosing, and the pre-step confirms or changes it; e2e runs with locale `en-US` read `'en'`, which is why the pre-existing walks never change language. `langChosen()` is the new reader: true iff the key holds a value this module writes (a storage-less host reads CHOSEN — the tour.js `read()` convention — so an un-persistable choice never re-asks).
2. **The tour's first card is the language choice** on a fresh-onboarding boot whose `langChosen()` is false: `tourStep = -1` (`LANG_STEP`), a card that is NOT a member of `STEPS` — the five real steps keep their 'n of 5' counter, the pre-step carries none. Title and bodies are BILINGUAL literals local to `tour.js` (`'Idioma — Language'`, one Spanish and one English paragraph — §7 explains why these deliberately do NOT live in `STRINGS`); the two buttons carry each language's NATIVE name ('Español', 'English', `LANG_NAMES`) and the current default wears `aria-pressed`. The copy points at "el botón de idioma de la cabecera (EN/ES)" — the HUD toggle shows ONE code at a time (`t('lang.toggle')` is 'EN' or 'ES', never the pair), so the pair names the control's two states, never a literal button label. **No shade ring** — the kindling screen underneath stays fully visible and clickable, because the choice re-snapshots the run with `{ lang }` (`chooseLang()` = `setLang` + `ctl.snapshot({ lang })` + `repaint()`, the exact move `switchLang()` makes) and watching the screen flip IS the point of choosing here.
   **The card's bottom-centre parking is a COMPUTED pixel `left`** (`max(8, (innerWidth − card.offsetWidth)/2)`), never an inline `translateX(-50%)`: the `.tour-card` entrance keyframes end in `transform: none` (`style.css`, `@keyframes tour-in`) and, with `fill-mode: both`, that final value overrides an inline transform for the card's whole life — review round 1 measured the stomp at 390×844 with motion NORMAL (left 195 + width 320 = 515 > 390, 'English' and 'Next' unreachable by click; the reduced-motion e2e default had hidden it). The same mechanism is the missing-anchor park's (§5.2's kill-hold case). Pinned by the motion-normal legibility walk (§11.5) at 1280×800, 390×844 and 640×460.
3. **Every exit persists.** Picking a language → persists it and lands the kindling step. Next → confirms the current default (`setLang(currentLang())`, which writes) and advances. Skip / Escape / an act on the undimmed kindling screen below (a phase change under the pre-step, `tourSync`) → persist, then dismiss or follow. A storage-blocked player is therefore asked once per boot at most, never twice per choice.

**When it never appears:** `startTour()` (the Help sheet's Replay entry) never opens the pre-step — a replaying veteran is past onboarding whatever `dlb.lang` says; `tourBack()` holds it (`tourStep <= 0` guard — the pre-step has no Back); and once any exit has written `dlb.lang`, later boots open straight on the kindling step. The keyboard guard chain (§5.4) needs no change: Enter/→ run `tourNext` (persist + advance on the pre-step), ← no-ops, Escape dismisses-and-persists through `closeTour`, and Enter on a focused language BUTTON activates it natively like every other card button.

## 4. Decision — flags and coexistence with the Help sheet

Two keys in the `dlb.*` family `[INFERRED]`:

- **`dlb.tourSeen.v1`** (new, owned by `tour.js` as `TOUR_SEEN_KEY`): `'1'` once the tour is finished **or dismissed** — one flag, all-or-nothing. A player who closes a coach-mark says "not now"; re-prompting at the next screen is the classic onboarding failure, and the Help sheet's Replay entry (§6) is the way back.
- **`dlb.helpSeen.v1`** (existing): keeps its key and its writer, and gains one new reader — see below. It is **not** retired.

**The exact coexistence rule** `[INFERRED]`:

1. **Fresh onboarding** = neither flag is set. On a fresh-onboarding boot the tour opens on the kindling screen and the Help sheet's auto-open is **retired**: `render()` drops the `!seen` half of its condition (`render.js:297-302` becomes `if (helpOpen) stageEl.append(helpPanel());`). Help is never auto-opened again by anything; it stays exactly where it is via its HUD button (`hud.js:103-110`).
2. **Old-Help veterans** (helpSeen `'1'`, tourSeen unset) and **the e2e harness** (which seeds helpSeen) are treated as onboarded: nothing auto-opens, in either language, ever. This is what makes the feature a zero-churn landing for the existing 2,653-line suite.
3. **Dismiss or finish writes BOTH flags** (`tourSeen` and `helpSeen`): the pair is monotone, every current reader of helpSeen stays truthful ("this player saw the first-run explanation" — the tour IS one), and no code path can fall back to the retired auto-Help.
4. The tour guard owns the keyboard while it shows (`tourOpen` OR fresh onboarding — the second covers the keystroke that races the boot paint); it stands **before** the Help guard (`app.js:71-79`), whose `!helpSeen` half is **deleted** — a fresh boot means the tour owns the keys, not Help. Help's guard reduces to `if (helpOpen)` + Escape.

## 5. Architecture

### 5.1 The module — `src/web/tour.js`

Exports `[INFERRED, reference implementation in Appendix A]`:

| export | role |
|---|---|
| `TOUR_SEEN_KEY` | the localStorage key (`'dlb.tourSeen.v1'`) |
| `tourOpen`, `tourStep` | module-owned presentation state (the `helpOpen` pattern, `hud.js:291`) |
| `freshOnboarding()` | neither flag set — the guard's and the trigger's predicate |
| `dismissTour()` | close + write both flags + `repaint()` (event handlers only) |
| `tourNext()` / `tourBack()` | step navigation; `tourNext()` past the last step dismisses |
| `startTour()` | the veteran entry: open at the step for the current phase, writes no flag |
| `tourSync(phaseChanged)` | the paint-path hook render.js calls (§5.3) |

Imports: `snap`, `repaint`, `ctl`, `setSnap` from `./runtime.js` (the last two exist for `chooseLang`'s re-snapshot — the same runtime handles `switchLang` uses, so no new module edge); `el`, `announce` from `./dom.js`; `t`, `setLang`, `currentLang`, `langChosen` from `./i18n.js`. Nothing else — no kernel import, no view import, **no cycle** (render.js may import tour.js; tour.js imports none of them back). Zero dependencies, no `node:*` (gate R1a/R3 rules, `scripts/check-architecture.mjs:111-118`).

### 5.2 The persistent layer — outside `#stage`

`index.html` gains one sibling after `#live`: `<div id="tour-layer"></div>` (the `#fx-layer` declaration convention, `index.html:39`; the null-guard convention for harnesses without it, `runtime.js:21-27`). `tour.js` grabs it per paint; `#tour-layer:empty { display: none }` makes the idle layer invisible and unhit. Per paint the layer holds: one `.tour-card` (`role="dialog"`, `tabindex="-1"` so an action step with no button can still take the caret on its step change) and, when the anchor exists, **four `.tour-shade` boxes around the anchor's measured rect** — a hole, not an outline.

**One hole per step** `[INFERRED; the union retired with the pickers]`: a step's `sel` is a single live selector the views paint (`document.querySelector(step.sel)` in `paintTour()`). The union bounding box the old heroes step drew — one hole over the hero row AND the path row — served two competing picks that the fixed start retired, so the machinery collapsed with them and nothing on the kindling screen competes for its hole. A selector that does not resolve (a kill-hold stage, a phase racing the views) leaves no ring and the card falls to the missing-anchor parking below. The e2e ring helpers stay array-capable (a list still measures the union box), the way the retired step used to be measured.

**The hole passes pointer events through** (`#tour-layer` is `pointer-events: none`; only the shades and the card opt back in): the anchored element stays visible AND clickable, so the boon click / node click that advances the run also advances the tour. Shades swallow clicks elsewhere; a shade click dismisses the tour (the `.modal-back` click-through convention, `hud.js:319`).

Geometry is measured per paint with `getBoundingClientRect()` on the anchor and re-emitted as the shades' inline boxes — the `placeAt()` precedent (`dom.js`, fx positioning). No stage node is ever touched: the tour never adds classes to, or reads rules from, the views' DOM beyond the anchor rect.

### 5.3 Integration into the paint path

`render()` calls `tourSync(phaseChanged)` once per paint, after the phase view and the sheets are appended (after `render.js:317-320`, before the one-paint flag release). Contract:

- `!tourOpen` + `freshOnboarding()` + `snap.phase === 'kindling'` → open at the FIRST step (the boot trigger — the auto-Help's replacement, per §4.1); under the fixed start that is the kindling/boon step, `STEPS[0]`.
- `tourOpen` + `phaseChanged` → jump to the new phase's first step; a phase with no step (`reward`, `ended`, `rest`, `shop`, `event`) → `closeTour()` **without repaint** (mid-paint rule; the deal-clock arming at `render.js:112-129` is the paint-sink precedent for mutating only its own presentation state). Auto-close on `reward`/`ended` exists so the shades can never block a spoils click or a summary button.
- Every paint: re-measure the ring, rebuild the card (the stage rebuilds too — no stale nodes), and fire `announce()` + focus **only when the step changed** (a hover repaint must not steal the caret; `paintedAt` tracks it).
- The `endHeld` early return (`render.js:219-275`) skips `tourSync` for that paint — irrelevant there; the next paint syncs.

### 5.4 Integration into the keyboard guard chain

The guard at the very top of the listener (`app.js`), before the Help guard — as shipped (the round-2 phase gate plus the two exceptions its review round 1 added):

```
tourOpen || freshOnboarding()  →
  Escape (or Esc)  → dismissTour()      [preventDefault]
  Enter on a focused BUTTON inside #tour-layer
                    → return (native activation: THAT button runs — Back steps back,
                      Skip dismisses; the guard used to preventDefault here and run
                      tourNext instead of the focused control)
  Enter, ArrowRight → tourNext()        [preventDefault; no-ops across a phase
                                         boundary — the way forward there is the act]
  ArrowLeft         → tourBack()        [preventDefault; same phase gate]
  anything else     → return (swallowed: no sheet, no card, no turn, no run)
```

Two corollaries keep the contract honest. (1) **On the kindling step the phase gate is the arrows' only answer**: the fixed start retired the kindling pickers, so there is no focused pick for an arrow to act on any more — the guard's ←/→ are the only arrow handlers, and on the first step BOTH no-op (← has nothing before step 0, → dies on the gate: the map step is another screen). Pinned by the e2e walks (ArrowLeft/ArrowRight on the kindling step leave `{ step: 0 }` unchanged); before the fixed start this corollary instead documented the pickers' `stopPropagation` shim, which died with them. (2) Enter on the card div itself (an action step's caret target) still advances — the exception is scoped to real `<button>`s inside `#tour-layer`.

Everything else falls through untouched, so native Tab keeps working exactly as it does behind every existing sheet (§2). Space is deliberately NOT bound (it is End Turn muscle memory; unbound avoids training a conflict) and natively activates a focused card button on keyup. After a dismiss both flags are set, so the guard's fresh-onboarding half goes false and the chain behaves as today. The Help guard that follows loses its `!helpSeen` half (§4.4); `window.__dlb` gains `tour: () => ({ open: tourOpen, step: tourStep })` beside `busy()` (`app.js:161`) so walks wait on the tour's own published truth instead of querying CSS.

## 6. Veteran re-entry (rejugable)

The Help sheet footer (`hud.js:364-379`) gains one button between "Got it" and "New Run": **"Replay the guided tour"** (`t('tour.replay')`, `.btn.secondary`), which closes the sheet and calls `startTour()`. It is visible to every veteran who opens Help, needs no new HUD chrome (the HUD row is already five buttons wide and the ≤620px band trims it), and reopens the tour at the step for the phase the player is standing on — a veteran in combat gets the combat steps (hand → intent → endTurn), a veteran on the map gets the map step (§11 test 7), not a kindling lecture. Escape still closes Help without starting anything.

## 7. i18n (en/es) — no hardcoded strings

All copy lives in `STRINGS` (`src/web/i18n.js`) under a `tour.*` group, verbatim (this exact block is what §10 measures; **review round 1** reworded the hand/endTurn bodies to the click path — the tour's own keyboard guard swallows those shortcuts while it shows, §5.4 — and dropped the unused `tour.aria`; **review round 2** gave the hero/path picks their own step, reduced the kindling body to the boon and added the two action hints; **the fixed-start ruling (2026-11-18)** retired that picks step along with the pickers — its two rows are DELETED, the Replay title counts five, and the kindling step is the tour's first real step; `src/web/i18n.js` is the living copy):

```js
/* ---- product tour (ONBOARDING-TOUR) ---------------------------------- */
'tour.title': { en: 'First steps at the forge', es: 'Primeros pasos en la forja' },
'tour.stepOf': { en: 'Step {n} of {m}', es: 'Paso {n} de {m}' },
'tour.next': { en: 'Next', es: 'Siguiente' },
'tour.back': { en: 'Back', es: 'Atrás' },
'tour.done': { en: 'Done — climb', es: 'Listo — a escalar' },
'tour.skip': { en: 'Skip the tour  (Esc)', es: 'Saltar el recorrido  (Esc)' },
'tour.replay': { en: 'Replay the guided tour', es: 'Repetir el recorrido guiado' },
'tour.replay.title': { en: 'Five short steps over the real screens', es: 'Cinco pasos cortos sobre las pantallas reales' },
'tour.hint.kindling': { en: 'Take a boon to continue — the tour follows.', es: 'Toma un rescoldo para continuar — el recorrido te sigue.' },
'tour.hint.map': { en: 'Travel to a glowing node to continue — the tour follows.', es: 'Viaja a un nodo brillante para continuar — el recorrido te sigue.' },
'tour.step.kindling.title': { en: 'The kindling', es: 'El rescoldo' },
'tour.step.kindling.body': { en: 'Take exactly one below: each gift has a price, and taking it starts the ascent.', es: 'Toma exactamente uno abajo: cada regalo tiene un precio, y tomarlo inicia el ascenso.' },
'tour.step.map.title': { en: 'The ascent map', es: 'El mapa del ascenso' },
'tour.step.map.body': { en: 'You climb floor by floor: click a glowing node to travel. Fights pay cards, the campfire heals, the Slag Warden waits at the top — you can only reach the nodes linked to your floor.', es: 'Subes piso a piso: haz clic en un nodo brillante para viajar. Las peleas pagan cartas, la hoguera cura, y el Guardián de Escoria espera arriba — solo puedes alcanzar los nodos enlazados a tu piso.' },
'tour.step.hand.title': { en: 'Your hand and your Energy', es: 'Tu mano y tu Energía' },
'tour.step.hand.body': { en: 'Click a card to play it. The orb counts the Energy left this turn — every card costs its gem, and the hand refills each turn. (Number keys come back when the tour ends.)', es: 'Haz clic en una carta para jugarla. El orbe cuenta la Energía que queda este turno — cada carta cuesta su gema, y la mano se rellena cada turno. (Las teclas de número vuelven cuando termina el recorrido.)' },
'tour.step.intent.title': { en: 'What the enemy intends', es: 'Lo que el enemigo pretende' },
'tour.step.intent.body': { en: 'The row over each enemy announces its next move — a number is damage headed your way. Read it before you spend the turn: the enemy acts the moment you end the turn.', es: 'La fila sobre cada enemigo anuncia su próximo movimiento — un número es daño que viene hacia ti. Léelo antes de gastar el turno: el enemigo actúa en cuanto termines el turno.' },
'tour.step.endTurn.title': { en: 'End the turn', es: 'Termina el turno' },
'tour.step.endTurn.body': { en: 'When the Energy is spent or the plan is set, click End Turn. The enemies act, then a fresh hand is dealt. That is the whole loop: play, end, climb. (The e and Space keys come back when the tour ends.)', es: 'Cuando gastes la Energía o el plan esté listo, haz clic en Terminar turno. Los enemigos actúan y llega una mano nueva. Ese es todo el bucle: jugar, terminar, escalar. (Las teclas e y Espacio vuelven cuando termina el recorrido.)' },
```

Proper nouns follow `NAMES.md` (Ashwright is id-stable and renders identically; "Slag Warden" localizes as "El Guardián de Escoria", the enemy table's own twin — the same convention `map.node.boss` already uses, `i18n.js:234`). Step titles/bodies are resolved per paint via `t()`, so a language switch mid-tour repaints the card in the new language on the next render. The `i18n` unit test (`tests/web/i18n.test.js`) already fails a key missing its `en` row; it now also covers the `tour.*` rows automatically.

**The language pre-step's copy is the documented exception** (the language ask): its title (`'Idioma — Language'`), its two body paragraphs (one per language) and the two button names (`LANG_NAMES`: 'Español', 'English') are BILINGUAL LITERALS local to `tour.js`, NOT `STRINGS` rows. The reason is the feature itself: the pre-step must be readable BEFORE any language has been picked, so both languages show AT ONCE and each button reads as itself in the language it selects — `t()` renders exactly one language per call, which is exactly wrong here, and the i18n unit test's every-key-has-an-en-row rule deliberately does not see them. The pre-step's own chrome (Next, Skip) DOES stay in `STRINGS`: by the time it renders, the browser default already speaks the player's locale, like the rest of the page.

## 8. Accessibility

- The card is `role="dialog"` with `aria-label` = "`tour.title` — `tour.stepOf`" (the belt panel's pattern, `hud.js:218`). Step changes are announced through `announce()` into `#live` (the targeting-step channel) — the tour's meaning is never colour/motion alone.
- On each step change focus moves to the card's primary button (best-effort `try/catch`, the `endFocusPending` pattern, `render.js:323-327`); `preventScroll: true` so a coach-mark never yanks the page. No focus trap — the same accepted limitation every sheet already ships (§2); Tab order inside the card is Back → Next → Skip.
- Every control is a real `<button type="button">` wearing the shared `.btn` chrome. Keyboard parity is total: advance (Next / Enter / →), back (Back / ←), dismiss (Skip / Escape / shade click).
- **Reduced motion:** the card's entrance animation is disabled in the `@media (prefers-reduced-motion: reduce)` block (the §10 convention, e.g. `style.css:7092`); the shade ring is static geometry in both paths — it is a colour fill, not a transition, and it carries no information the card text doesn't restate.

## 9. Responsive

Base rules keep the card at `width: min(320px, calc(100vw - 24px))`; **the small bands are handled in JS**, not CSS overrides: `paintTour()` parks the card bottom-centre full-width (`left: 8px; right: 8px; bottom: 8px`) when `innerWidth <= 620 || innerHeight <= 480` — the same thresholds the stylesheet's phone tier pairs on (`style.css:2479`, `@media (max-width: 620px), (max-height: 480px)`; the ≤700px-and-short rows at `style.css:3960`/`7293`/`7541`). There the hand and controls sit in the lower half of the stage, so a bottom-sheet card never covers its own anchor. The language pre-step (and the missing-anchor park) bottom-centre at EVERY viewport by a computed pixel `left`, never an inline transform — §3.5's keyframe-override note; pinned with motion normal at 1280×800, 390×844 and 640×460 (§11.5). CSS contributes only the cosmetic narrowings (`.tour-body` size at the 620px tier) inside a self-contained §10-style block appended at end of file with its own banner — never across a §9 theme boundary (`style.css:41-49`), and every new class name gets a rule for `check-surface-art.mjs`. New top-level selectors (`#tour-layer`, `.tour-card`, `.tour-shade`, `.tour-count`, `.tour-head`, `.tour-body`, `.tour-nav`) are unique today `[READ, grep]`.

## 10. Budget — measured this run

`node scripts/measure-tokens.mjs` (the CLI spike, run as-is; its own docblock calls it a spike, not a gate — the two FAIL rows are its documented stale samples, not this feature):

```
PASS  R4 state dump (prescribed shape)          worst=99   ceiling=250
PASS  R4 --verbose dump (+pile list)            worst=131  ceiling=250
PASS  R8 --help example block                   worst=42   ceiling=60
```

The tour's own payloads, measured with the script's exported `countWorst()` (worst of o200k_base/cl100k_base) over the SHIPPED sources (**review round 2, corrected by its review round 1**: the first round-2 table quoted 1633/399/523 for the three i18n rows and did not reproduce — it had measured the wrong span and a key+value join; the rows below re-measure with the extraction commands quoted verbatim so the table self-verifies. Appendix A's reference measured 2392/947):

| payload | o200k | cl100k | **worst** |
|---|---|---|---|
| `src/web/tour.js` (shipped source, whole file) | 6023 | 6017 | **6023** |
| `tour.*` i18n block in `i18n.js` (en+es source: the banner comment through the last `'tour.*'` row) | 1252 | 1319 | **1319** |
| player-visible strings, en only (the 22 `tour.*` values, `'\n'`-joined) | 316 | 317 | **317** |
| player-visible strings, es only (same join) | 378 | 443 | **443** |

Extraction, reproducible as-is:

```
node -e "import('./scripts/measure-tokens.mjs').then(async (m) => {
  const lines = (await import('node:fs')).readFileSync('src/web/i18n.js', 'utf8').split('\n');
  const first = lines.findIndex((l) => l.includes('---- product tour'));
  const lastTour = lines.reduce((acc, l, i) => (/^\s*'tour\./.test(l) ? i : acc), -1);
  console.log('block', m.countWorst(lines.slice(first, lastTour + 1).join('\n')));
  const { strings } = await import('./src/web/i18n.js');
  const tours = Object.entries(strings()).filter(([k]) => k.startsWith('tour.'));
  console.log('en', m.countWorst(tours.map(([, v]) => v.en).join('\n')));
  console.log('es', m.countWorst(tours.map(([, v]) => v.es).join('\n')));
})"
```

(The independent review probe measured the same block span at 1283 and the visible rows at 341/460 under an unspecified join — the block agrees to the boundary newline; the visible-row delta is the join, so the table cites its own command instead.)

There is no pre-existing ceiling for UI module source (the frozen ones are engine-output payloads: dump ≤250, action line ≤8, `tests/budget.test.js:19`). History of the ceiling sentence: this spec first set **≤ 3,000 combined** and then annotated 2392 + 947 = 3339 against it — self-contradictory from the start, so that nominal line never operated as a gate. The operative rule is the growth limit: **past ~4,000 worst combined, split rather than grow.** Review round 1's mandated fixes took the payload to 3113 + 1040 = **4153**; review round 2's live-player rework took it further to 4099 + 1284 = **5383** — the six-step split (a new step with its own copy), the phase gate, the union ring and the two hint lines are all ask-mandated structure, not prose; and the **language ask (2026-11-10)** took it to 5790 + 1319 = **7109** — the pre-step's own card painter, its persistence-on-every-exit plumbing and the §3.5 design comments are likewise ask-mandated structure — and its review round 1 (the motion-normal keyframe-override fix, §3.5's computed-left centring, plus its evidence comments) took it to 6023 + 1319 = **7342** (the player-visible `tour.*` payload is UNCHANGED at 317 en / 443 es; the pre-step's bilingual literals live in `tour.js` by design, §7). The prescribed remedy (split strings from code) still does not map: no player string lives in `tour.js`; the mass is geometry code plus its evidence comments. The disclosed follow-up remains the Tech Lead's call — raise the line for coach-mark geometry or split the parking/union math into its own module. Against the *player-visible* payload (317 en / 443 es) the feature still costs the reader ~one Help topic. Numbers measured 2026-11-10 on this tree with the command above.

## 11. Test plan — `tests/web/e2e.browser.spec.js`

All new tests carry **`tour`** in the title, use the file's existing helpers (`freshPage`'s context shape, `waitIdle`, `readState`), real clicks only, and seed `dlb.tourSeen.v1`/`dlb.helpSeen.v1` explicitly where the flag state matters (the inverse of today's `addInitScript` contract). **Review round 2** shaped the phase-gated walk and added the two Replay/landing claims; **the language ask** grew the walk (every fresh-boot walk crosses the pre-step first, `freshTourPage` takes a `locale`, the veterans' walks pin that the pre-step never reaches them; its review round 1 added the motion-normal legibility walk and the act-under-the-pre-step exit); **the fixed-start ruling (2026-11-18)** re-anchored every walk to the five steps — the kindling step is the first real one, counters read "N of 5" — and added the `?hero=` seeding walk. The ring helpers (`tourRing`, `tourCardClearOfAnchor`) take a selector OR an array — array-capable since the retired union, though every caller passes a single selector now.

1. **`tour: a fresh boot opens on the language choice, then the guided tour on the kindling screen`** — no seeded flags → goto → the FIRST card is the bilingual pre-step: no `.tour-count`, title 'Idioma — Language', both body paragraphs, both native buttons, NO shades, `{ open: true, step: -1 }`, `.modal` count 0 (the auto-Help is gone), the HUD Help button still renders; clicking 'English' writes `dlb.lang='en'` and lands the kindling step ("Step 1 of 5") with the `.boon-list` ring, the clickable first boon and the ArrowRight no-op claim (the phase gate, §5.4).
2. **`tour: choosing Español flips the tour AND the kindling screen to Spanish at once and persists the choice`** — click 'Español' → "Paso 1 de 5", the kindling step in Spanish ('El rescoldo'), `<html lang>='es'`, `dlb.lang='es'`, the `.kindling-head` reads "La forja ofrece un rescoldo", the HUD reads 'Ayuda'; Skip → reload → no tour card, Spanish stands, the choice survived.
3. **`tour: a Spanish browser boots in Spanish before any choice, and nothing is written until it chooses`** — `newContext({ locale: 'es-ES' })`, no flags, no dlb.lang → the first paint is Spanish (`<html lang>`, the kernel's kindling narration) while `dlb.lang` is null; the pre-step is up with 'Español' wearing `aria-pressed`; Next writes the key.
4. **`tour: every exit from the language step persists — Next confirms the default, Escape writes it too`** — (a) Next on the untouched pre-step (en-US) → `dlb.lang='en'`, kindling step; (b) Escape on the pre-step → tour closed, both flags written, `dlb.lang='en'` — no exit leaves the choice unwritten.
5. **`tour: the steps advance by click and keyboard, follow the phase, and a shade click writes both flags`** — after the pre-step's Next the tour stands on the kindling step, the FIRST step: **no `.tour-next` (the hint line reads "Take a boon to continue — the tour follows.") and no `.tour-back` (nothing exists before it)**; Enter is a no-op (the phase gate — the map step is another screen) and so are ← / →; a real boon click **through the hole** lands the map step ("Step 2 of 5") with the `.map` ring; on the map step there is **no Next and no Back, only the hint "Travel to a glowing node to continue — the tour follows."**; `d`/`n` are swallowed mid-tour (no deck sheet, run intact); a shade click dismisses; localStorage then holds `dlb.tourSeen.v1=1` AND `dlb.helpSeen.v1=1`; a `d` press afterwards opens the deck sheet again (guard released).
6. **`tour: a dismissed tour never auto-opens again, and the Help sheet carries the Replay entry`** — seed both flags (NO dlb.lang) → no tour, no auto Help, two consecutive boots, `dlb.lang` still null; open Help → the Replay button exists → clicking it opens the tour at the kindling step ("Step 1 of 5") — NEVER the language pre-step — without changing the run snapshot and without writing a language; Skip closes the tour, flags unchanged, `dlb.lang` still null — once by clicking Skip and once by focusing it and pressing Enter (native activation again).
7. **`tour: the combat steps anchor the hand, the intent row and End Turn, and finishing releases the keyboard`** — fresh flags, fixed seed, pre-step Next → boon click → travel to the first fight → steps 3/4/5 exist with anchors `.hand`, `.e-intent`, `.controls` (the ring's shades cover everything but the anchored element); **the hand step has no Back** (its previous step lives on the map screen); Next chains hand → intent → endTurn → "Done" dismisses → End Turn (`e`) works immediately, `waitIdle` confirms the gate is the game's own.
8. **`tour: the coach card parks and stays legible in the small bands`** — viewport 390×844 (portrait phone) and 700×440 (landscape phone): the pre-step parks fully on screen with NO ring, then 'English' lands the kindling card bottom-parked over its ring; the PRIMARY claim is that no `.boon` button's centre sits under the card (the band-scoring that parks it counts covered buttons), with the rect-level card-vs-`.boon-list` disjunction pinned beside it; Escape still dismisses.
9. **`tour: taking a boon under the open tour lands the map step anchored to the map`** — the player's bug, pinned: after the pre-step's Next, take the boon, and the tour must land on "Step 2 of 5" over the map screen with a REAL ring (hole clear, corner shaded), not a parked ringless card.
10. **`tour: Replay from the map lands on the map step`** — a veteran climbs to the map, replays from Help, and `startTour` resolves the standing phase to its OWN first step ("Step 2 of 5", `{ open: true, step: 1 }`), not a kindling lecture.
11. **`tour: the language card stays centred and every control click-reachable with motion normal`** — review round 1's bug, pinned at the MECHANISM: with `reduce: false` at 1280×800, 390×844 and 640×460 the resting card is fully inside the viewport, centred within 1px, and `elementFromPoint` at each control's centre returns it (both `.tour-lang` buttons, `.tour-next`, `.tour-skip`) — the inline `translateX(-50%)` the entrance keyframes used to stomp is gone (§3.5).
12. **`tour: taking a boon under the still-open language pre-step persists the default and follows the phase`** — §3.5's act-exit, pinned: with the pre-step still at `{ open: true, step: -1 }` a real boon click on the UNDIMMED kindling screen writes `dlb.lang='en'` and lands "Step 2 of 5" over the map with the ring up — the persistence-on-every-exit rule includes the player's own act.
13. **`fixed start: the seeded other hero (?hero=bellows) names himself in the HUD, in English and in Spanish after the toggle`** — the fixed-start hard constraint in the browser: a `freshPage` seeded `?hero=bellows` shows 'Bellows Keeper' in `.hud-char` (kernel-side `characterName`), and after the HUD language toggle 'Custodio del Fuelle' with `dlb.lang='es'` persisted — the seeded hero lives on with NO picker anywhere (its own page: a toggle inside the language walk would poison that walk's English assertions).

Compatibility pin: with `dlb.helpSeen.v1` seeded (every existing walk), **zero** existing test may see a `.tour-card` — if one does, the §4 rule regressed. The help-sheet guard test (`e2e.browser.spec.js:1913`) must keep passing unchanged; its first-run `!helpSeen` branch is what §4.4 deleted. The HUD language test (`e2e.browser.spec.js:2476`) boots through `freshPage` (helpSeen seeded) with locale `en-US`: the browser-default rule reads 'en', so its default-English and toggle claims hold untouched.

## 12. Acceptance criteria

- AC1: Fresh boot (no flags) shows the tour on the kindling screen at the kindling step (`STEPS[0]`, the boon); `.modal` count 0; five steps in the §3 order with the §3 anchors (the kindling step's ring is the `.boon-list` hole).
- AC2: Navigation is phase-gated (§3): a Next/Back exists only where its destination shares the phase, an action step carries its hint line and is crossed by the player's act (the `tourSync` jump), and the keyboard obeys the same gate (Enter/→ and ← no-op across a boundary); dismiss by Escape, Skip, or a shade click — dismissing anywhere writes both flags and never auto-opens again.
- AC3: `dlb.helpSeen.v1`-seeded boots (all existing tests, old veterans) never see the tour; the Help sheet's auto-open is retired for everyone; Help remains reachable by its button and gains the Replay entry.
- AC4: The tour is presentation-only: it reads `snap` and localStorage, imports no kernel/rules module (gate stays green), mutates no state outside `tour.js` and `#tour-layer`, and the run underneath survives every tour key.
- AC5: No hardcoded player-visible string; `t()` covers all copy in en and es; a mid-tour language switch repaints the card.
- AC6: `role="dialog"`, aria-label, step announcements via `#live`, focus on the primary button per step change, Escape dismisses; reduced motion disables the entrance animation.
- AC7: 390×844 and 700×440 both park the card legibly without covering the anchor.
- AC8: `npm run gate` green; `check-surface-art.mjs` green (every emitted class has a rule); the §10 token numbers annotated in this file are the MEASURED ones and the growth past the ~4,000 line is disclosed there with its follow-up (the nominal ≤3,000 ceiling never gated — it was exceeded by the spec's own first annotation).
- AC9 (the language ask): a never-chose fresh boot opens on the bilingual language pre-step (no counter, no ring, native-named buttons); the pre-choice default is the browser locale in memory only — `dlb.lang` is written by an explicit choice alone (a pre-step pick, its Next, or any other exit; or the HUD toggle); a Spanish-locale browser boots Spanish before choosing; a replaying veteran never sees the pre-step; the five real steps keep 'n of 5'.

## Appendix A — reference implementation

**Round-0 reference only** — kept verbatim as the spec's starting point. The SHIPPED `src/web/tour.js` is the authority: review round 1 added the resting-geometry parking and the shade-click dismissal, and review round 2 reworked it to six steps, phase-gated navigation (§3), the union ring (§5.2) and the hint lines. Do not transcribe this appendix into the tree.

`src/web/tour.js`, transcribable as-is (2392 tokens worst-of-both as measured in §10):

```js
// src/web/tour.js — the first-run product tour: five coach-marks over the REAL screens.
//
// ONBOARDING-TOUR spec (docs/specs/ONBOARDING-TOUR-spec.md). The tour is PRESENTATION
// ONLY: it reads `snap` (the kernel's value model) and localStorage, never a rule. Its
// layer is the PERSISTENT #tour-layer, a sibling of #stage declared in index.html, so
// `render()` rebuilding #stage can never destroy a coach-mark mid-read.
//
// The five steps anchor to elements the views already paint:
//   kindling → .boon-list   map → .map   hand → .hand   intent → .e-intent   endTurn → .controls
// A step advances on its Next button (click) or Enter/→ (keyboard); ← goes back; Escape,
// the Skip button and a shade click dismiss the whole tour. Dismissing or finishing
// writes BOTH onboarding flags (TOUR_SEEN_KEY and hud.js's HELP_SEEN_KEY), which is what
// keeps a fresh boot from ever falling back to the old auto-opened Help sheet.
//
// The first-run TRIGGER replaces render.js's auto-open of the Help sheet: a player with
// NEITHER flag set is "fresh onboarding" — the tour opens on the boot's kindling screen
// instead of Help, and Help stays reachable through its own HUD button. A player who
// already saw the old first-run Help (helpSeen set, tourSeen unset) is treated as
// onboarded: nothing auto-opens, and the Help sheet carries the Replay entry.
//
// The shade ring is four dim boxes AROUND the anchor's rect, so the marked element is
// the one visible (and clickable) region — the tour teaches by doing; the coach card is
// the explicit way forward.

import { snap, repaint } from './runtime.js';
import { el, announce } from './dom.js';
import { t } from './i18n.js';

export const TOUR_SEEN_KEY = 'dlb.tourSeen.v1';

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

/** Fresh onboarding: neither onboarding flag is set. HELP_SEEN_KEY (hud.js) is read,
 *  never written here — old-Help veterans and the e2e harness (which seeds that flag)
 *  are onboarded as far as the tour is concerned. */
export function freshOnboarding() {
  return !read(TOUR_SEEN_KEY) && !read('dlb.helpSeen.v1');
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
  write('dlb.helpSeen.v1');
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
 *  phase; an unknown phase parks on step 1. Opening writes no flag. */
export function startTour() {
  const at = STEPS.findIndex((s) => s.phase === snap.phase);
  tourStep = at === -1 ? 0 : at;
  tourOpen = true;
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
  root.replaceChildren(card);

  // The ring: four shades AROUND the anchor's rect (a hole, not an outline), so the
  // marked element stays the visible — and clickable — region while everything else
  // dims behind the shades. A missing anchor (a kill-hold stage, a phase racing the
  // views) parks the card bottom-centre with no ring: the copy still reads.
  const W = window.innerWidth; const H = window.innerHeight;
  const anchor = document.querySelector(step.sel);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const pad = 10;
    const x0 = Math.max(0, r.left - pad); const y0 = Math.max(0, r.top - pad);
    const x1 = Math.min(W, r.right + pad); const y1 = Math.min(H, r.bottom + pad);
    const shade = (style) => root.append(el('div', { cls: 'tour-shade', attrs: { style } }));
    shade(`left:0;top:0;width:${W}px;height:${y0}px`);
    shade(`left:0;top:${y0}px;width:${x0}px;height:${y1 - y0}px`);
    shade(`left:${x1}px;top:${y0}px;width:${W - x1}px;height:${y1 - y0}px`);
    shade(`left:0;top:${y1}px;width:${W}px;height:${H - y1}px`);
    const small = W <= 620 || H <= 480; // the phone / landscape-phone bands park the card
    if (small) { card.style.left = '8px'; card.style.right = '8px'; card.style.bottom = '8px'; }
    else {
      const below = y1 + 12 + 230 < H;
      card.style.top = below ? `${y1 + 12}px` : `${Math.max(8, y0 - 242)}px`;
      card.style.left = `${Math.min(Math.max(8, x0), Math.max(8, W - 348))}px`;
    }
  } else {
    card.style.left = '50%'; card.style.transform = 'translateX(-50%)'; card.style.bottom = '8px';
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
 *  auto-Help's replacement), jumps an open tour to the new phase's first step, parks it
 *  (and flags it seen) when the run leaves the tour phases for good (reward/ended: the
 *  shades must never block a spoils click), and re-measures the ring for this layout.
 *  Mutates ONLY this module's state and #tour-layer — never repaints, never touches a
 *  game rule (render.js's deal-clock arming is the paint-sink precedent). */
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
```

### Appendix A.1 — the four touchpoint diffs, in full

**`src/web/index.html`** — one sibling after `#live` (line 43):

```html
<!-- The PRODUCT TOUR layer (ONBOARDING-TOUR spec): a PERSISTENT sibling of #stage that
     render() never clears, exactly like #fx-layer — a coach-mark must survive the
     repaint that the action it describes causes. Empty, it is display:none. -->
<div id="tour-layer"></div>
```

**`src/web/render.js`** — two edits. (1) Replace the first-run auto-Help (`:296-302`):

```js
  // The first-run explanation is now the TOUR (tourSync below): a fresh boot paints the
  // coach-marks on the kindling screen instead of the auto-opened Help sheet, and BOTH
  // onboarding flags are written when the tour ends (tour.js closeTour). Help still
  // opens through its own HUD button, exactly as before — never automatically.
  if (helpOpen) stageEl.append(helpPanel());
```

(2) After the belt-popover block (`:317-320`), call the hook:

```js
  // The product tour's paint-path hook (ONBOARDING-TOUR spec): it may open on a fresh
  // boot, follow a phase change, and re-measure its shade ring against THIS paint's
  // layout. It repaints nothing and owns no rule (see tour.js tourSync).
  tourSync(phaseChanged);
```

with `tourSync` added to the imports from `./tour.js` (new import line beside the hud.js one, `:52`).

**`src/web/app.js`** — the guard chain. New first guard (before the Help guard at `:71`), and the Help guard loses its `!helpSeen` half:

```js
  // --- the product tour owns the keyboard while it shows (ONBOARDING-TOUR spec) ----
  // It stands BEFORE the sheet guards: on a fresh boot the tour IS the first-run surface,
  // and no sheet, no card, no turn and no run may be driven from behind its shades.
  // freshOnboarding() covers the keystroke that races the boot paint. Escape dismisses
  // (both flags, tour.js), Enter/→ advance, ← steps back; everything else is swallowed
  // the same way the Help guard swallows — native Tab still moves focus.
  if (tourOpen || freshOnboarding()) {
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); dismissTour(); return; }
    if (k === 'Enter' || k === 'ArrowRight') { ev.preventDefault(); tourNext(); return; }
    if (k === 'ArrowLeft') { ev.preventDefault(); tourBack(); return; }
    return;
  }
  if (helpOpen) {
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); toggleHelp(false); }
    return;
  }
```

plus the import `{ tourOpen, freshOnboarding, tourNext, tourBack, dismissTour }` from `./tour.js`, and `window.__dlb` gains `tour: () => ({ open: tourOpen, step: tourStep })` (`:161`).

**`src/web/hud.js`** — one button in `helpPanel()`'s footer (`:364-379`), between "Got it" and "New Run":

```js
    // ONBOARDING-TOUR: the veteran's way back in. It reopens the tour at the step for
    // the phase the player is standing on and writes no flag (only finishing or
    // dismissing the tour does, tour.js).
    el('button', {
      cls: 'btn secondary',
      text: t('tour.replay'),
      attrs: { type: 'button', title: t('tour.replay.title') },
      on: { click: () => { toggleHelp(false); startTour(); } },
    }),
```

with `startTour` imported from `./tour.js` (no cycle: `tour.js` imports only runtime/dom/i18n).

### Appendix A.2 — `style.css` block (appended at end of file, own §10-style banner)

```css
/* ===================================================== ONBOARDING-TOUR: the product tour ==
   One persistent overlay layer (#tour-layer, a sibling of #stage at z-index 80 — above
   the sheets' 70) with a four-shade ring around the anchored element and one coach card.
   No page box moves: the layer is fixed, its children absolute, and the stage never
   learns the tour exists. The layer is pointer-events:none; the shades and the card opt
   back in, so the hole over the anchor is CLICKABLE — the tour teaches by doing. */
#tour-layer { position: fixed; inset: 0; z-index: 80; pointer-events: none; }
#tour-layer:empty { display: none; }
.tour-shade { position: absolute; background: rgba(4, 7, 12, 0.78); pointer-events: auto; }
.tour-card {
  position: absolute; pointer-events: auto;
  width: min(320px, calc(100vw - 24px));
  background: linear-gradient(180deg, var(--raised) 0%, #10151f 100%);
  border: 1px solid var(--edge); border-radius: var(--radius-lg);
  padding: 14px 16px 12px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
  animation: tour-in 0.24s ease-out both; /* screen-level arrival: base pace, not --pace */
}
@keyframes tour-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.tour-count { display: block; font-size: var(--fs-1); letter-spacing: 0.08em; color: var(--faint); text-transform: uppercase; }
.tour-head { margin: 4px 0 6px; font-size: var(--fs-4); color: var(--ink); }
.tour-body { margin: 0 0 10px; font-size: var(--fs-2); color: var(--dim); line-height: 1.45; }
.tour-nav { display: flex; gap: 8px; align-items: center; }
.tour-skip { margin-left: auto; }
@media (max-width: 620px) { .tour-body { font-size: var(--fs-1); } }
@media (prefers-reduced-motion: reduce) { .tour-card { animation: none; } }
```

(The small bands need no further CSS: `paintTour()` parks the card itself at ≤620px/≤480px — §9.)
