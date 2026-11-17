**Project title:** Ember Ascent

# ITCH-UPLOAD.md — publish checklist for the owner

**You must run this yourself.** Creating an itch.io account needs your email, your
password and your acceptance of itch.io's Terms of Service, so it cannot and has not
been done for you. Nothing in this release requires payment: itch.io hosting for an
HTML5 game is **$0**, and this artifact costs $0 to build and serve.

Work top to bottom. Checked boxes are things already done and verified in this repo.

---

## Before you start — the one upload file

- [x] **`release.zip`** exists in this workspace root. That is the artifact.
- [x] **SHIPPED 2026-11-17 as 0.4.4**: `butler push release.zip
      arggondev/ember-ascent:html --userversion 0.4.4` → build `#2419481` on the
      `html` channel. Zip SHA-256
      `f88b80b2e259fc19f33d9c8627b17f8b48931dc2ccd94b6c7595f9b90342a8d3`
      — 95 entries, **2,724,857 bytes**; butler re-used 98.38% against 0.4.3
      (patch 30.95 KiB). Content: the climb to act 2 no longer heals the hero —
      the between-acts gift is the +5 max HP ALONE (designer ruling
      2026-11-17): act 2 opens on exactly the hp the act-1 victory chain left
      behind, the act_transition heal event is retired, and the campfire and
      relics are the only healing again. Pre-push ritual held: two deterministic
      rebuilds at the same zip sha, veteran+es boot (kindling → map → Skirmish,
      Spanish chrome) and fresh boot (bilingual language card) with zero console
      errors.
      Superseded by nothing — this is the live build.
- [x] **SHIPPED 2026-11-16 as 0.4.3**: `butler push release.zip
      arggondev/ember-ascent:html --userversion 0.4.3` → build `#2411130` on the
      `html` channel. Zip SHA-256
      `78af31ff76098eca37a2b45e8f5188e67a490f75c3439c655af87022370263ef`
      — 95 entries, **2,724,741 bytes**; butler re-used 74.83% against 0.4.2
      (patch 340.62 KiB). Content: discrete multi-hit strikes — parry and bleed
      react PER HIT and poison ticks at the turn's close (3 new cards: Slag Barb,
      Kiln Fume, Anvil Guard; Ash Matriarch's hex reads "A7x2 BLEED2", the Slag
      Crawler guards with "PARRY20"), one beat per golpe in the presentation, and
      the health bar that follows the hits — a 4×2 card lowers the bar 2 at a
      time, heals glide up, and no repaint rewinds the bar to its pre-hit width.
      Superseded by 0.4.4 (2026-11-17).
- [x] **SHIPPED 2026-11-10 as 0.4.2**: `butler push release.zip
      arggondev/ember-ascent:html --userversion 0.4.2` → build `#2351423` on the
      `html` channel. Zip SHA-256
      `e9bad7a6d1faf0ca8c32a2baac8a13f1bb7f0ecc342a7489030d85f1a075747f`
      — 95 entries, **3,722,079 bytes**; butler re-used 96.70% against 0.4.1
      (patch 48.88 KiB). Content: the tour's step-zero language card — a fresh
      boot asks Idioma — Language (Español / English) BEFORE the tour speaks,
      the pick repaints the whole interface and persists `dlb.lang`; while no
      explicit choice exists the browser's own language decides the default
      without writing anything. Superseded by 0.4.3 (2026-11-16).
- [x] **SHIPPED 2026-11-10 as 0.4.1**: `butler push release.zip
      arggondev/ember-ascent:html --userversion 0.4.1` → build `#2350047` on the
      `html` channel. Zip SHA-256
      `3b38ac490acb8989ca482cfb75295a88c5fe990ee4090b6fcc3717d96a9968c1`
      — 95 entries, **3,722,079 bytes**; butler re-used 66.55% against 0.4.0
      (patch 455.21 KiB). Content: the first-run guided tour (six contextual
      coach-marks anchored to the real screens, phase-gated navigation, replayable
      from Help, i18n en/es) and the defeat hold — the killing enemy turn now plays
      on the retained stage (attack pose + damage float over the hero), the hero
      falls in its own ash dissolve, and the defeat panel arrives after; plus the
      elite sprite scale fix. Superseded by 0.4.2 (2026-11-10).
- [x] **SHIPPED 2026-10-30 as 0.4.0**: `butler push release.zip
      arggondev/ember-ascent:html --userversion 0.4.0` -> build `#2257168` on the
      `html` channel. Zip SHA-256
      `cc4561fe3b3b82f8a84ff87d50dfeb5312009888ea21b76778efbbd7d217cb12`
      — 93 entries, **3,092,725 bytes**. Content: the full StS-parity roadmap — two
      acts (The Kiln Deeps), gold/shop/potions/events/relics with meta-unlocks, 70
      cards, weaving paths, sequenced enemy turns, half-speed cinematic pacing, the
      deck viewer and card codex. Superseded by 0.4.1 (2026-11-10).
- [x] Zip SHA-256 `64964d19442c4a7e37fb55bbc747c2eb8394468f8e407211779a026a97f5fc03`
      — 87 entries, **2,483,583 bytes**. Rebuilt 2026-10-24 at `daba4b4` (the refactored
      module layout plus the melee-approach animation and the ended-screen fix) and
      **SHIPPED the same day**: `butler push release.zip arggondev/ember-ascent:html
      --userversion 0.3.2` → build `#2203120` on the `html` channel. Regenerates
      byte-for-byte with `node scripts/build-release.mjs` (deterministic by design).

> **Note on earlier hashes.** This file previously recorded `b86764e4…`/101,861 B and
> `../RELEASE-NOTES.md` recorded `72d1dc63…`/104,895 B. Neither matched the zip on disk, which was
> itself `f629b29c…`/119,618 B and predated the layout fix. Those were superseded on 2026-10-15 by
> `4a662160…`/123,283 B, then by the module-refactor artifact `ed79756a…`/2,480,641 B (85 entries,
> 2026-10-24), and **that one by the hash above** — the 0.3.2 build of 2026-10-24, the one that
> shipped. Earlier versions went up as manual zip uploads; 0.3.2 was the first butler push.
- [x] **`index.html` is at the zip root** (not nested inside `src/web/`). Verified against
      itch.io's rule that the ZIP must contain `index.html` as the entry point.
- [x] No file path in the zip exceeds 240 characters; the longest is 34
      (`src/kernel/content/cards.bundle.js`).
- [x] 85 extracted files, far below itch.io's 1,000-file limit.
- [x] Every `.js` in the artifact is served as `text/javascript`; all **49** runtime
      `.js` modules returned 200 (re-verified 2026-10-24 against the rebuilt artifact through its
      own `tools/serve.mjs`).

### ✅ Screenshots and cover art — available now

**This section previously said screenshots could not be produced here. That is no longer true** —
the measuring harness renders real screenshots headlessly, and `shots/` now holds **301 PNGs**.
You can still capture your own if you prefer, but the files below are genuine renders, not
placeholders.

Ready to use:

| Purpose | File |
|---|---|
| **Map** screen (the climb, node types) | `shots/map.png`, `shots/map-390x844.png`, `shots/design/mobile/02-map.png` |
| **Reward / card-pick** (the deckbuilder loop) | `shots/reward.png`, `shots/reward-390x844.png`, `shots/design/mobile/04-reward.png` |
| **Combat** (pick a seed; one per viewport/seed) | `shots/viewport/desktop-1280x800-s1..s12.png` |
| **Phone captures** (proof mobile works) | `shots/viewport/phone-small-360x640-s1..s12.png`, `iphone-14-390x844-*.png` |

Still worth capturing yourself, because the harness walks the map by script and does not fight the
boss on demand:

1. A **combat mid-turn** with an enemy intent visible — the `desktop-1280x800-s*.png` set covers this.
2. **The Slag Warden** boss fight (the payoff screen). Scripting a run to the boss is the one shot the
   harness does not produce; `?seed=N` plus playing to the end, or the itch.io preview, will get it.

Cover art: **`shots/cover-ember-ascent.png`** (1260×1000, a 2× render of itch.io's 630×500) is
ready to upload. Honest caveat: it is a **minimalist text-led banner** — title, subtitle, content
stats (`42 CARDS | 1 ACT | 8 FLOORS | 1 BOSS`) and a fanned hand. It is legible and not broken, but
it has no illustration, so it reads as a promo card rather than illustrated dark-fantasy key art.
Upload it as-is to ship now, or commission art later and swap it — itch.io lets you change the
cover without re-uploading the build.

---

## Step 1 — Create the account

1. Go to `https://itch.io/register`, choose a username, confirm your email, accept the
   ToS. Free, no card, no payment details.
2. Optionally set your profile name and avatar under **Settings**.

## Step 2 — Create the project

1. **Dashboard → Create new game.**
2. **Title:** `Deckbuilder` (or your own title). The project URL is generated from it;
   shorten it under the title field if you like.
3. **Project type / "Kind of Game":** choose **HTML** (itch.io lists it as
   *"HTML Game"* / *HTML5*). This is what makes itch.io embed it in the page instead of
   making people download a file. Anything else turns it into a download.
4. **Classification:** source category **Games**, then pick the genre (see Step 5).

## Step 3 — Upload the artifact and set the embed

1. Click **Upload files** and choose **`release.zip`**.
2. Wait for itch.io to finish processing the archive — it takes a moment the first time.
3. On the upload, tick **"This file will be played in the browser"**.
4. **Embed options:** pick **Embed in page**, and set the viewport to **1280 × 800** (measured:
   the board clears the fold by ~75px at that size). 1280×720 is also workable but was never
   measured, so 1280×800 is the evidence-backed choice. Alternatively use **Click to launch in
   fullscreen**, which needs no dimensions and gives the game the whole viewport — safest if you
   are unsure, because the layout now adapts down to 360×640.
5. Leave **Click to play** enabled (default). It keeps the page light and avoids
   browsers muting anything on autostart.
6. **Do NOT tick "Mobile Friendly."** ~~Mobile is untested and out of scope for this build~~ —
   **this instruction is superseded; see the corrected embed table at the bottom of this file.**
   Mobile is now measured and supported, so **tick it.** (Original text kept struck through so the
   change is visible rather than silently rewritten.)
7. Leave **Scrollbars** off.

## Step 4 — Pricing: free

- Set the price to **`$0 or Donate`** — this is itch.io's literal option name for a
  "name your own price" free release. It prompts for a suggested donation and offers
  *"No thanks, just take me to the downloads"*, so nobody is blocked.
- Do **not** choose **Paid**. This release is free, and the plan is to post it and see
  whether anyone bites — not to charge.
- **Do not** choose **No payments** either, unless you specifically want the donation
  path off. `$0 or Donate` is the right default for "free, but tip jar exists".

## Step 5 — Genre and tags (this is what discovery actually runs on)

- **Genre:** `Strategy` — it is a deckbuilder. (`Card Game` is not a top-level genre on
  itch.io; `Strategy` plus tags is the combination that works.)
- **Tags — pick up to 10, favour the specific over the vague:**
  `roguelike`, `deckbuilding`, `card-game`, `turn-based`, `roguelike-deckbuilder`,
  `dark-fantasy`, `singleplayer`, `hard`, `procedural-generation`, `html5`.
- **Metadata tab** (available after the page is saved once): set
  **Input: Mouse** (and Keyboard if you keep the `n` shortcut). Add **Average session:
  15–40 minutes** if you want, and mark **Multiplayer: No**.
- **Engine detection:** itch.io scans the archive for known engines. This is a
  hand-written ES-module project with no engine fingerprint, so expect **no engine
  match** — that is correct and not a problem.

## Step 6 — Cover image and screenshots

Dimensions below are itch.io's own published guidance, not guesses:

| Asset | Requirement | Source |
|---|---|---|
| **Cover image** | **315:250 aspect ratio required. 315×250 minimum, but "it's best to include a larger image with the same aspect ratio, like 630×500."** Set it from the edit page. | itch.io, *Your first itch.io page* |
| **Screenshots** | **"Screenshots can be any size, it's recommended to upload between 3 and 5 of them."** | itch.io, *Your first itch.io page* |
| Cover, community-measured upper bounds | max 3840×2160, max file size 3 MB | community guide, secondary source — treat as guidance only |

- [ ] Upload a **630×500** cover image (this is the size itch.io itself recommends).
- [ ] Upload **3–5 screenshots** (see the capture list above — **no longer a blocker:
      `shots/` holds 301 PNGs, and the rows above name the specific files to use**; the one
      shot still worth taking yourself is the boss fight, see above).

## Step 7 — Page text

A description that answers "what is this, how long, how hard, what do I press".
`../RELEASE-NOTES.md` is the source: copy the "What this demo IS", the controls line, and
the "is NOT" list across. Be upfront that it is one act and that it is hard — a player
who feels misled writes a worse comment than one who was warned.

- [x] Suggested short description: *"A hard, dark-fantasy roguelike deckbuilder in your
      browser. One act, one boss, forty-two cards, no install."*
- [ ] Under **More information / instructions**, paste the run-locally command from
      `HOW-TO-RUN-LOCALLY.txt` so anyone who downloads rather than plays can run it.

## Step 8 — Visibility, then publish

1. New pages are **private by default**. This is useful: preview first.
2. Use **Save & view page**, then **play the game through the embed once yourself** —
   confirm it loads, that a card can be played, and that the console is clean. ~~This is
   the one check nobody here could perform, because there is no browser.~~
   **CORRECTED 2026-10-16: the struck reason was false — a browser IS present** (`chromium
   152.0.7977.82`/`firefox` on PATH; `scripts/dev/shoot.mjs` drives headless Chromium over CDP,
   zero dependencies). The game **has** been rendered and screenshotted here; see the
   screenshots section above and `shots/`. **What is still owner-only is narrower and real:**
   playing through *itch.io's own embed*, and confirming **itch.io accepts and sizes** the frame.
   That depends on your account and a live page, so it genuinely remains yours to do.
3. When satisfied: edit the page and set **Visibility → Public**.
   (`Public restricted` keeps the page visible but blocks downloads — not what you want
   here, since the download is the same free zip.)
4. Optionally set a **release status** of `Released` rather than `In development`.

## Step 9 — After publishing

- [ ] Re-check the page in a **logged-out** browser window, to see a stranger's view.
- [ ] If anyone reports a bug, `../RELEASE-NOTES.md` is the reference for whether the
      behaviour is intended scope or a real defect.
- [ ] To ship a fix: edit the code, run `node scripts/build-release.mjs`, then upload the
      new `release.zip` on the same project page and delete the old file.

---

## What is verified vs. what only you can verify

| Claim | Status |
|---|---|
| The zip has `index.html` at the root | **Verified** here (zip listing + fresh extraction) |
| Every runtime module is served 200 as `text/javascript` | **Verified** here (clean-dir serve test) |
| No external/CDN/font request anywhere | **Verified** here (grep over the artifact) |
| The build is reproducible byte-for-byte | **Verified** here (3 runs, identical SHA-256) |
| The engine runs without errors from the artifact | **Verified** here (headless, 3,000 steps, 0 errors) |
| It renders correctly in a real browser | **NOW VERIFIED — see correction below** (was "NOT verified — no display server here") |
| **Cover image quality** | **NOT verifiable** — depends on art you have not made yet *(unchanged; needs a design judgement, not a capture)* |
| **Screenshots** | **NOW PRODUCIBLE, and produced** — 301 PNGs in `shots/`, incl. the 1260×1000 cover **(was: "NOT producible here — owner must capture (⛔ blocker)")** |
| **Whether the embed sizes well on itch.io** | **NOT verified** — only testable after upload *(unchanged, and honestly so: this needs a live itch.io page)* |

> **Correction — 2026-10-16 (Technical Writer, DEF-3).** Two rows above were false. This file said
> *"no display server here"* and that screenshots were *"NOT producible here"* and an **owner
> blocker**. **A browser is present:** `chromium 152.0.7977.82` and `firefox` are on PATH, and
> `scripts/dev/shoot.mjs` renders and captures the real game headlessly over CDP with zero
> dependencies. `shots/` holds **301 PNGs**, counted 2026-10-16, including the 1260×1000 cover. So
> the blocker is gone and the screenshot tasks below are no longer blocked. The rows that stay
> **NOT verified** are the ones only a live itch.io page can settle — the embed's sizing, and the
> cover's *artistic* quality (a taste call, not a capture).
>
> **Not claimed:** the itch page is **NOT live**. Nothing here has been uploaded. This file is a
> checklist for you, not a record of a publish.


## Embed options — measured recommendations

These were measured by rendering the game in real headless Chromium at each viewport
(`node scripts/dev/viewport-check.mjs`), not guessed.

| itch.io field | Set it to | Why |
|---|---|---|
| **Embed in page** | keep | — |
| **Viewport width x height** | **1280 x 800**, or larger if you like | The game fits at 1280x800. A bigger frame is safe: itch scales the iframe. |
| **Mobile friendly** | **CHECK IT** | The layout is verified playable at 360x640, 390x844, 414x896 and 844x390 with 44px touch targets. This box was previously left unchecked because it was a false claim; it is now true and re-verified after the screen-size fix. |
| **Viewport width x height** | **1280 x 800** (not 1280x720) | Measured: ~75px of clearance below End Turn at 1280x800. 1280x720 was never measured. |
| **Automatically start on page load** | **unchecked** | itch warns about this, and the game boots instantly anyway. |
| **Fullscreen button** | **CHECK IT** | Gives players a bigger view on any screen. |
| **Enable scrollbars** | **OPTIONAL** | No longer required: at 1280x800 the game fits. Turn it on only if you set a shorter frame. |

**Phone support is now real, not aspirational.** Measured after the mobile pass:

| viewport | content height vs viewport | End Turn visible | card rows | min touch target |
|---|---|---|---|---|
| 360x640 | fits | yes | 1 | 44px |
| 390x844 | fits | yes | 1 | 44px |
| 414x896 | fits | yes | 1 | 44px |
| 844x390 (landscape) | fits | yes | 1 | 44px |

**Known limit on phones:** the card effect text is ~11.7px at the smallest sizes, which is
readable but tight. The five-card hand is kept on one row on purpose — a hand you have to
scroll is worse than small text. Tap a card to see its full effect in the toast/aria text.
