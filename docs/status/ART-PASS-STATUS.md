# ART-PASS-STATUS

Owner: PM/Art pass run. Exclusive lane: `web/`. Baseline commit has no VCS, so a byte
backup of the four files was taken before editing (see "Rollback" below).

## Scope of this pass
Presentation only. No game logic, no card text, no data-model change. No image files,
no external assets, no web fonts, no network requests. No build step, no new deps.
Nothing outside `web/` was edited.

## Baseline (measured before any edit)

| Check | Command | Result |
|---|---|---|
| syntax | `node --check web/app.js` / `web/tokens.js` | both clean |
| tests | `node --test 'tests/**/*.test.js'` | 72 pass / 0 fail |
| arch gate | `node tools/check-architecture.mjs` | OK, exit 0 |
| assets | `grep -rniE 'https?://\|cdn\|@import\|googleapis\|\.woff' web/` | 1 hit: `web/index.html:7` ("No CDN") |
| motion | `grep -rn 'prefers-reduced-motion' web/` | 0 hits (empty) |
| dup rule | `.card .csum` at `style.css:279` **and** `:443` | duplicate confirmed |
| dup rule | `.card .ctype` | single (`:272`) — the earlier duplicate is already gone |

Recon of kernel data used as the art contract (no kernel change needed):
`intent.kind` ∈ {attack, block, buff, debuff}; `intent.label` compact (`A11`, `PWR3`),
`intent.text` plain English, `intent.damage`, `intent.hits`. Node types:
`combat_weak` / `combat_strong` / `elite` / `rest` / `boss` with kernel labels
`fight` / `fight+` / `elite` / `rest` / `boss`. Enemy names are the six encounter
definitions (Cinder Maw, Ash Cantor, Kiln Mite, Slag Ooze, Cinder Brute, Slag Warden). Ids are unchanged; see `NAMES.md`.
Statuses and powers are reduced to `label`/`text`/`explain` pairs by the kernel.

## Task list

- [x] T0 baseline + backup + kernel recon
- [x] T1 `web/index.html` — reword the comment containing "CDN" (defect 5)
- [x] T2 `web/style.css` — full art pass on the stated palette / type / spacing scales;
      merge the duplicate `.card .csum` (defect 2); declare `--danger` and `--accent`
      (defect 3); drop or wire the dead `.intent .iatk` rule (defect 4); add a real
      `prefers-reduced-motion` path (defect 1)
- [x] T3 `web/app.js` — type glyphs, cost gem, enemy silhouettes + portrait plates,
      four distinct intent treatments, flash-on-change incl. block, in-and-out end
      screen, per-row map trail state, hand-index digits
- [x] T4 evidence run (all 9 required checks pasted in the report)
- [ ] T5 final consistency sweep (class coverage + duplicate selectors + serve check)

## Rollback
`cp -a /tmp/dlb-art-pass-backup/. web/` restores the pre-pass bytes. md5 of the four
files was recorded before editing and matched the backup copy.

## Known-not-verified at the time — **label CORRECTED 2026-10-16: the reason given was false**

> **This section was headed "Known-not-verified (no browser in this environment)". That reason was
> WRONG and has been withdrawn.** A browser **is** present here: `chromium 152.0.7977.82` and
> `firefox` are on PATH, and `tools/dev/shoot.mjs` drives headless Chromium over CDP with **zero
> dependencies**. It renders and screenshots the real game. So the items below are **not
> unverifiable — they were simply not captured**, and each now has a method.
>
> Do not reuse this section as a licence to skip visual checks. At the time of writing these
> claims were checked by static proxy; that was a choice, not an environmental limit.

**Status of each item — "not captured", with the method to capture it:**
- **Whether cards actually grow rather than clip at 3-line descriptions** — *not captured.*
  **Method:** render the three-line case and screenshot it (`node tools/dev/shoot.mjs`,
  `node tools/dev/design-capture.mjs`, or `node tools/dev/card-closeup.mjs` for a per-card
  close-up). A frame settles it; reading CSS cannot.
- **Whether the map connectors visually line up** — *not captured.* **Method:** capture the map
  screen and inspect the connector geometry in the frame.
- **Hover-lift feel** — *not captured.* **Method:** capture with the pointer held on a card; note
  that *feel* over time is still not provable from a still, so capture a frame **sequence**.
- **Contrast measured from rendered pixels** — *was reasoned from hand-computed ratios, not
  measured from pixels.* **Method:** sample the rendered pixels from a captured frame. This is a
  genuine gap in method, and the harness is what closes it.
- **`prefers-reduced-motion` never evaluated by a rendering engine** — *not captured.*
  **Method:** Chromium can emulate reduced motion and be screenshotted under it; the media query
  can therefore be exercised rather than merely grepped.
- **All animation and transition timing asserted from source, not observed** — *partly closable.*
  **Method:** capture a frame sequence at known timestamps (the death-beat capture under
  `shots/pm-verify/death/` is the worked example: `death-000ms`, `-150ms`, `-300ms`, `-450ms`).
  **Still not provable from frames:** that the motion *reads well*, and the compositor frame rate.
  That caveat stands and is honest.
