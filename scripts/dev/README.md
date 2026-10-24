# scripts/dev — probes, instruments, and one-off evidence tools

Nothing in this folder ships and nothing here runs in CI or the test suite (the only
references from `tests/`, `.github/`, `package.json`, `bin/`, `src/` are comments).
Each file exists to answer **one question with evidence** — a measured number, a
screenshot, a parsed fact — rather than an opinion. When you add a probe, say in its
header what it answers and whether it is disposable; when you revisit this folder,
check a file's own header first: several tools self-identify as temporary.

## Prerequisites

| Need | For | How |
|---|---|---|
| dev server | anything with a base URL | `npm run serve` (port 5173) first |
| `chromium` on PATH | the CDP family (spawned headless) | present at `/usr/sbin/chromium` on this machine |
| devDependency `postcss` | css-parse-probe | installed with `npm ci` |
| python3 + numpy + Pillow | sprite-cutout.py | **Pillow missing here** — not runnable in this environment |

## Acceptance instruments (durable — keep)

| File | Answers | Run | Status |
|---|---|---|---|
| `viewport-check.mjs` | does the combat screen meet every LAYOUT-ACCEPTANCE.md threshold, per viewport × seed? Exit 1 on any failing row | `node scripts/dev/viewport-check.mjs [--base URL \| URL]` | current: requests `/src/web/index.html?seed=N` directly so serve.mjs's trailing-slash 301 cannot eat the seed (the bug its header records). Not run in this pass |
| `space-check.mjs` | how much vertical space is wasted per viewport; `wastePx` is the only overflow signal | `node scripts/dev/space-check.mjs [--base 'http://localhost:5173/src/web/index.html?seed={seed}']` | maintained alongside viewport-check; not run in this pass |
| `endturn-acceptance-measure.mjs` | at 4 viewports: is End Turn visible AND clickable, hand one row, nothing clipped — absent vs below-fold told apart | `node scripts/dev/endturn-acceptance-measure.mjs [URL]` | not run in this pass |
| `text-scale.mjs` | helper MODULE for the two harnesses above: emulates Android 130 % large fonts via CDP | — (imported, not standalone: direct run is a designed no-op, exit 0) | current |
| `css-parse-probe.mjs` | does `src/web/style.css` parse under postcss, and is the tail intact | `node scripts/dev/css-parse-probe.mjs` | **verified this pass**: `bytes: 343968 lines: 6936 / parsed OK / @media blocks: 71` |

## Balance / rules probes (kernel only — no server, no browser)

| File | Answers | Run | Status |
|---|---|---|---|
| `biome-balance.mjs` | win rate / floor reached for greedy+smart across every kernel BIOME | `node scripts/dev/biome-balance.mjs [N=200]` | imports resolve; not run in this pass |
| `probe-boss-race.mjs` | what a policy actually does inside the boss fight | `node scripts/dev/probe-boss-race.mjs [policy] [seedStart] [runs]` | imports resolve; not run in this pass |
| `probe-reward-bias.mjs` | how biased is the reward table vs what the deck needs | `node scripts/dev/probe-reward-bias.mjs` | **verified this pass**: prints starter-deck needs and per-card scores |
| `measure-action-shapes.mjs` | do candidate R5 action-line shapes fit the frozen 8-token ceiling, over full shipped content | `node scripts/dev/measure-action-shapes.mjs` | imports `countWorst` from `scripts/measure-tokens.mjs`; not run in this pass |

## Browser capture & measurement (chromium + `npm run serve`)

| File | Answers | Run | Status |
|---|---|---|---|
| `shoot.mjs` | real screenshots over CDP (also the itch.io page shots) | `node scripts/dev/shoot.mjs [--base URL]` | not run in this pass |
| `design-capture.mjs` | every screen at 390×844 (mobile-first design pass) | `node scripts/dev/design-capture.mjs [--seed N] [--out DIR]` | not run in this pass |
| `card-closeup.mjs` | card anatomy at high DPR for art critique | `node scripts/dev/card-closeup.mjs [--base URL]` | not run in this pass |
| `ux-evidence.mjs` | every surface at mobile + desktop @2x, plus measured HUD/enemy anatomy | `node scripts/dev/ux-evidence.mjs [--base URL]` | not run in this pass |
| `death-capture.mjs` | the end-of-run moment with a FROZEN clock (DEF-6 repro instrument) | `node scripts/dev/death-capture.mjs [--base URL] [--out DIR] [--seeds 13,1,2]` | not run in this pass |
| `inspect-dom.mjs` | measured geometry / accessibility facts from the real browser | `node scripts/dev/inspect-dom.mjs [--base URL]` | not run in this pass |

## One-off layout diagnostics (`probe-*` — kept for archaeology)

Each answered one question during the height-strategy work; they still run against a
served page but are not maintained as instruments.

| File | Answers |
|---|---|
| `probe-app-box.mjs` | does `#app` fill the viewport on each device |
| `probe-blocks.mjs` | where does the vertical space actually go |
| `probe-nesting.mjs` | what is `#stage`'s child chain, did the bands apply |
| `probe-stage-space.mjs` | how much slack sits inside `#stage` |
| `probe-toggle.mjs` | which new declaration changed the 1280×800 document |
| `probe-eleven.mjs` | 915×412 / 844×390 diagnostic — self-marked TEMPORARY, past its stated lifetime |

## No-browser DOM/logic drivers (fake-DOM against the real `src/web/app.js`)

| File | Answers | Status |
|---|---|---|
| `targeting-smoke.mjs` | are the targeting states wired, is nothing dispatched before an enemy is chosen | imports resolve; not run in this pass |
| `repro-target-click.mjs` | does clicking an enemy resolve or cancel the target | imports resolve; not run in this pass |
| `juice-effects.mjs` | does action feedback survive `replaceChildren`, and respect `prefers-reduced-motion` | imports resolve; not run in this pass |
| `render-reward.mjs` | what tree does the reward screen build | imports resolve; not run in this pass |
| `browser-path-smoke.mjs` | controller → snapshot → dispatch loop without a browser | **BROKEN today**: `import './src/surface/gui/controller.js'` resolves relative to `scripts/dev/` and throws `ERR_MODULE_NOT_FOUND` (reproduced this pass); it needs `../../src/surface/gui/controller.js`. Content-frozen this run — follow-up filed, do not copy this pattern |

## Art & assets

| File | Answers | Status |
|---|---|---|
| `card-gallery.html` | all cards in real markup + stylesheet, for art review | **stale label**: the h1 says “42 CARDS” while shipped content is 44 cards (kernel count, this pass); the gallery itself renders whatever `SHIPPED_CONTENT` holds, so only the heading lies. Open via the dev server: `http://localhost:5173/scripts/dev/card-gallery.html` |
| `cover.html` | the itch.io cover, from the game's own palette and glyphs | self-contained by design; its palette is copied by hand from `style.css`, so drift is possible by construction (its own header says so) |
| `sprite-cutout.py` | colour-key cutout for combat sprites → WebP | needs numpy + Pillow; Pillow not installed here — not runnable in this environment |

## Self-marked throwaways still present

`_probe-cls.mjs` (“TEMP probe … Deleted after Item 1”), `scratch-fix-probe.mjs`
(“SCRATCH probe (temporary, deleted at end of run)”), `_tmp-touch-audit.mjs`
(“TEMPORARY diagnostic (deleted at the end of this run)”), and `probe-eleven.mjs`
are all past their stated lifetime — safe-delete candidates, kept only because
nothing in this folder is auto-cleaned.

`_tmp-spill-control/` is **not** garbage despite the name: it is the positive-control
fixture the `wastePx`/spill gate needs — a page that MUST clip — used by pointing
`viewport-check.mjs --base` at it (see its `index.html` header).
