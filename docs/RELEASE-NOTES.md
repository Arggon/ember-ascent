# Release notes — Ember Ascent (free browser demo)

**Version 0.3.0 · free · playable in a browser · no install · no account · no network calls**

This is a short, honest description written for a stranger who is deciding whether to
play this and whether to report a bug. It tells you what you are getting, what you are
not getting, and what is rough.

---

## What this demo IS

An **agent-playable roguelike deckbuilder** played in a browser. Dark fantasy. You
climb a single act, fight what is in your way, and face one boss at the end.

| | |
|---|---|
| **Acts** | 1 (eight rows: entry, fights, elites/rests, and a fixed boss row) |
| **Cards** | **42** — 20 attack, 16 skill, 6 power |
| **Character** | 1 — the Ashwright, 60 max HP, plus one starting relic (Kindled Heart) |
| **Enemies** | 6, across 9 encounters (4 weak, 3 strong, 1 elite, 1 boss) |
| **Boss** | 1 — the Slag Warden |
| **Run length** | roughly **15–40 minutes** per run |
| **Difficulty** | HARD. Losing is the normal outcome early on. |
| **Tech** | plain ES modules + CSS. Zero runtime dependencies, no build step, no bundler, no CDN, no network access |
| **Price** | free. No paid tier, no ads, no upsell. |

Everything is deterministic: a run is a pure function of its seed. Playing `?seed=7`
twice gives you exactly the same cards, enemies and intents both times — that is a
deliberate design property, not a coincidence, and it is what makes runs shareable.

**Controls:** it is all mouse/tap plus a few keys. `n` starts a new run. There is a
"How to play" panel behind the help button on first load.

**Play a specific run:** add `?seed=N` to the URL, e.g. `?seed=7`.

---

## What this demo deliberately is NOT

> ### ⚠️ DATED NOTICE — added 2026-10-16: two claims below are SUBJECT TO AN IN-FLIGHT REVISION
>
> **This section is accurate about the build these notes describe (v0.3.0). It is NOT safe to
> quote as current.** A revision in progress adds **run history, a score, and an unlock spine**
> (options only, never power), persisted **locally, with no account**. That changes two claims
> below specifically:
>
> | Claim below | Status |
> |---|---|
> | *"No save or resume… There is no run persistence at all, by design."* | **Will change** — the revision persists run history locally. |
> | *"No meta-progression. Nothing carries over between runs. No unlocks, no currency, no account, no leaderboard."* | **Will change** — the revision adds an unlock spine. Treat "no currency / no account / no leaderboard" as **unconfirmed for the next release**, not as promised. |
>
> **Nothing here is a feature announcement.** These features are **not built as of this notice**;
> I am not claiming they exist and nothing above should be read as promising them. The point is the
> opposite — *the text below is going to become false*, and a reader must not be misled meanwhile.
>
> **Open action — owner: Technical Writer.** Before the next release, re-verify every claim in this
> section against the actual build, rewrite it to match, then delete this notice. **Do not delete
> the notice without doing the re-verification** — that is exactly the failure mode recorded as
> `DEF-3` in `requirements-run-history-and-legible-combat.md`, and it is how a status document
> starts lying to the project. **[Inferred:** the specific claim→change mapping above is taken from
> that requirements document's in-flight scope; I did not measure the revision's behaviour myself.**]**

Read this list before filing a bug — most of it is scope, not breakage.

- **No second act.** One act, one boss. Killing the boss ends the run.
- **No save or resume.** Closing the tab loses the run. There is no run persistence at
  all, by design. (The *only* thing this build remembers is that you have already seen
  the How-to-play panel, in `localStorage`. Nothing about your run is stored.)
- **No meta-progression.** Nothing carries over between runs. No unlocks, no currency,
  no account, no leaderboard.
- **No difficulty settings or options menu.** There is a How-to-play panel; that is not
  a settings screen. If you want an easier time, that is out of scope for this build.
- **No sound and no music.** The demo is silent. There are no audio files in it.
- **No mobile guarantee.** ~~It is built for a desktop browser with a mouse. It may work
  on a tablet or phone; that has not been verified, so treat mobile as unsupported.~~
  **Superseded as of 2026-10-15: mobile is now supported and measured.** Verified playable at
  360×640, 390×844, 414×896 and 844×390 in landscape, with 44px touch targets and the five-card
  hand held on a single row. The card effect text is ~11.7px at the smallest sizes — readable but
  tight; tapping a card shows its full effect text.
- **No story, no cutscenes.** Flavour text and card blurbs only.
- **No telemetry, no analytics, no font downloads, no external requests.** When you
  play this, the only server that talks to your browser is the one hosting the files.

---

## Known rough edges

Honest list. These are the things most likely to look like bugs.

1. **Balance is first-pass.** Some cards and some encounters are clearly stronger or
   weaker than others. The elite fight in particular can end a good run very quickly.
   This is tuning, not a crash.
2. **The card pool is small (42), so runs repeat.** You will see the same cards often.
3. **A red/opaque token-count badge may read "n/a".** That badge shows a token count
   for the agent-facing observation. It needs a tokenizer that is deliberately **not**
   shipped in a browser build, so it degrades to "n/a" instead of guessing. This is
   intended behaviour and is not a broken feature. (See `src/surface/tokens.js` in the
   artifact — the import fails on purpose and is caught.)
4. **Every action repaints the stage.** Animations that need to survive a repaint live
   in a separate effect layer, so a mid-animation click can occasionally cut a flourish
   short. Cosmetic only; state has never been observed to diverge in testing.
5. **Reduced-motion support exists but is coarse** — it reduces animation durations
   rather than removing every transition.
6. **No undo.** A misclick is permanent for that turn. The game does confirm targeting
   for multi-enemy fights, but single-target plays commit immediately.
7. ~~**Small-screen layout is untested and will look cramped** below roughly 1024 px wide.~~
   **Resolved 2026-10-15.** Small screens are now measured, not untested: the board fits with
   End Turn fully visible at 360×640, 390×844, 414×896 and 844×390 (landscape), with 44px touch
   targets. Also fixed in the same pass: a 1366×768 laptop window used to overflow by ~100px and
   require scrolling, and 1280×800 by ~68px; both now fit with no scroll.
8. **If the page is blank**, the host is almost certainly serving `.js` as `text/plain`;
   browsers then refuse to load ES modules. See `HOW-TO-RUN-LOCALLY.txt`.

---

## The exact build command

From a clean checkout, on Node 24:

```bash
node tools/build-release.mjs
```

This regenerates:

- `release/` — the artifact directory, with `index.html` at its top level
- `release.zip` — the exact file to upload to itch.io

The build has **zero dependencies** (`node:fs`, `node:path`, `node:zlib`, `node:crypto`
only) and is **byte-reproducible**: three consecutive runs produced the same zip SHA-256.
Override the output location with `OUT=/some/dir node tools/build-release.mjs`.

To run the artifact locally:

```bash
cd release && node tools/serve.mjs
# then open http://localhost:5173/
```

## This build, in numbers

| | |
|---|---|
| Files | **25** |
| Total size | **361,806 bytes (353.3 KiB)** |
| Zip size | **123,283 bytes (120.4 KiB)** |
| Zip SHA-256 | `4a6621600c69f409aa83b2733dd9d0374fe591a2badceb45e5a830c6f48ed0db` |
| Zip root | `index.html`, `app.js`, `style.css`, `tokens.js`, `HOW-TO-RUN-LOCALLY.txt`, `src/`, `tools/` |
| External requests at runtime | **0** |

The zip contains 25 entries, well inside itch.io's limits (1,000 files, 500 MB
extracted, 240-character paths). These numbers are from the build of **2026-10-15**, which
includes the screen-size layout fix; two consecutive runs produced the identical SHA-256 above.

One deliberate transformation to note: the build rewrites exactly one import path in `app.js`
(`'../src/surface/gui/controller.js'` → `'./src/surface/gui/controller.js'`) because the file
moves from `web/` to the zip root. That is why the `app.js` inside the zip is 84,797 bytes while
`web/app.js` is 84,798 — the 1-byte difference is that path, and it is documented in
`tools/build-release.mjs`. It is not a stale-file problem.

---

## A note on the card count

Project documents written earlier describe this as a **"40-card"** vertical slice. The
shipped content bundle actually contains **42 card definitions**. Both numbers are true
of different things: 40 was the planning target, and 42 is what is in
`src/kernel/content/cards.bundle.js` at release time. The release notes quote the
measured number (42) rather than the planned one, because a player counting cards will
count 42.

> **RECONCILED 2026-10-16 (Technical Writer, DEF-3) — 42 is confirmed; 40 was a planning target,
> now marked as such in the planning docs.**
>
> **How 42 was verified (independent of both documents):** counted the shipped card definitions
> directly in `src/kernel/content/cards.json` — **42 entries, one `"id"` per card**, breaking down
> as **20 attack / 16 skill / 6 power**, which matches the Cards row of the table at the top of this
> file. The content bundle `cards.bundle.js` is generated from that JSON by `tools/gen-content.mjs`
> and guarded against drift by `tests/content/bundle-drift.test.js`, so the JSON is the source of
> truth and the bundle follows it.
>
> **Could not re-verify by executing the count:** the writing agent had no shell this Run, so this is
> a **direct file count (`grep -c '"id"' src/kernel/content/cards.json`) reported by inspection**,
> not an executed command. It is a count of a file I read in full, and it agrees with this file's own
> independent release-time figure — but the strongest available check is to run
> `node -e "console.log(require('./src/kernel/content/cards.json'))"` or
> `grep -c '"id"' src/kernel/content/cards.json` and confirm 42.
>
> **No history was rewritten.** The planning documents keep their original "40 cards" text; they
> now carry a dated correction line pointing here, so a reader sees both the intent and the outcome.

This discrepancy is now closed at the source of truth; the planning documents carry the correction.


## Difficulty, measured honestly

The reference bot (`--policy greedy`) wins **7.2%** of runs and kills the boss in **13.0%** of
the runs that reach it, over 2000 seeded runs.

**Treat that 7.2% as a floor, not the real difficulty.** It is a crude bot: it cannot plan
multi-turn combos, does not time debuff windows (a 3-turn Vulnerable is just damage to it),
and plays a card then ends the turn. A human who times a Vulnerable window will do
substantially better. It is quoted here because it is the only number we have measured, and
because a number with its limits stated is more useful than a flattering one.

Mobile is supported: verified playable at 360x640, 390x844, 414x896 and 844x390 (landscape)
with 44px touch targets and the hand on one row. Verified against the shipped artifact of
2026-10-15 (zip SHA-256 `4a6621600c69f409aa83b2733dd9d0374fe591a2badceb45e5a830c6f48ed0db`).
