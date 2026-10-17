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
- [x] Zip SHA-256 `4a6621600c69f409aa83b2733dd9d0374fe591a2badceb45e5a830c6f48ed0db`
      — 25 entries, **123,283 bytes**. Rebuilt 2026-10-15 after the screen-size layout fix;
      regenerates byte-for-byte with `node scripts/build-release.mjs` (verified: two runs, same SHA).

> **Note on earlier hashes.** This file previously recorded `b86764e4…`/101,861 B and
> `../RELEASE-NOTES.md` recorded `72d1dc63…`/104,895 B. Neither matched the zip on disk, which was
> itself `f629b29c…`/119,618 B and predated the layout fix. All three are now superseded by the
> hash above, which is the artifact you should upload.
- [x] **`index.html` is at the zip root** (not nested inside `src/web/`). Verified against
      itch.io's rule that the ZIP must contain `index.html` as the entry point.
- [x] No file path in the zip exceeds 240 characters; the longest is 34.
- [x] 25 extracted files, far below itch.io's 1,000-file limit.
- [x] Every `.js` in the artifact is served as `text/javascript`; all 24 runtime
      requests returned 200 in the clean-directory serve test.

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
