# How to Play — `dlb`

**Open this in your browser:**

```
http://localhost:5173/src/web/
```

A server is already running. If it has stopped, restart it with:

```bash
cd <project root>
npm run serve          # prints the URL to open
```

Add `?seed=42` to the URL for a reproducible run: `http://localhost:5173/src/web/?seed=42`

> **Correction 2026-10-16:** this file says **40 cards** below. The shipped build has **42 card
> definitions** (`src/kernel/content/cards.json`); 40 was the planning target. The text is left as
> written so the intent stays visible. "40" in the questions at the end is a standalone sentiment —
> it stands.
>
> **Addendum 2026-10-24 (reconciled after the module refactor):** the shipped build now has
> **44 card definitions** — 21 attack / 17 skill / 6 power — counted by parsing
> `src/kernel/content/cards.json`. The "42" above was true of the 2026-10-16 build.
>
> **Addendum 2026-10-27 (S8 content scale):** the pool grew to **70 card definitions** —
> 35 attack / 27 skill / 8 power — still counted by parsing `src/kernel/content/cards.json`.
> New cards bring the classic verbs the vocabulary was missing: **multi-hit** attacks
> (`A3x3` — one card, several hits), **Retain** (the card stays in your hand when your
> turn ends — held until you play or discard it) and **Heal** (restore HP, capped at your
> maximum). The unlock ladder widened to match: a fresh profile drafts 20 cards, and the
> top unlock (score 120) opens every card the forge holds. The "44" above was true of the
> 2026-10-24 build.

---

## Playing in Spanish

The game speaks **English and neutral Spanish (es-419)**. The **EN / ES** button in the
top-right HUD switches the whole interface — buttons, hints, sheet titles, toasts, the
combat HUD — and every player-facing string the engine knows: card names and flavor
lines, descriptions, statuses, powers, enemy intents, **enemy names**, **biome names**,
the hero and starter-relic names, **kindling boons**, **quests**, the score ledger's
line labels, the run marks and unlock narrations, the help topics, the glossary, and
the words of the relics, potions, tempers and wayside events — including the wayside's
**resolved-beat result lines** ("- Pagas 30 de oro."). The choice is remembered
(`localStorage`, key `dlb.lang`) and `<html lang>` follows it for screen readers.

The language is a **display choice only**: it never enters a save, a run's hash or the
action log, and a save plays identically in either language. Honest exceptions —
deliberate, not oversights:

* The small compact codes on each card (`A6`, `HP3`, the same shorthand the
  command-line agent reads) stay as they are in both languages, and the whole compact
  text dump the agent surface reads is **English-only by contract**.
* **Ashwright is a proper noun** and reads the same in either language (the hero is
  never given a gendered article — "Ashwright ha caído."); the Bellows Keeper's title
  translates ("Custodio del Fuelle", article-less by the same ruling).
* **Old saves' resolved beats are baked English sentences.** New runs store their beat
  as structured slugs and render them in either language; a save made before this
  change keeps its English sentences and shows them verbatim **even in a Spanish
  session** — the honest degrade, never a mistranslation-by-guess. Everything else in
  that save (names, descriptions, intents) renders fully Spanish.
* A card (or any swept table row) missing one of its twins renders **mixed by
  design** — each field falls back to its own English twin independently. Nothing is
  ever shown as a placeholder.

---

## Reading a card

**Cards now say what they do in plain English.** You should never have to decode a code.

| Instead of | You now see |
|---|---|
| `B5` | *Gain 5 Block.* |
| `A6` | *Deal 6 damage to the enemy.* |
| `HP3 E2` | *Lose 3 HP. Gain 2 Energy.* |
| `A8+5` | *Deal 8 damage. This card gains +5 damage permanently each time you play it.* |
| `BLKx2` | *Double your current Block. Does nothing if you have no Block.* |

The small dashed code in the corner of a card is the **agent-facing shorthand** — the same text the command-line version prints, where every character costs tokens. It is kept visible so the two surfaces stay connected, but it is never what you have to read.

**Click the `Help` button (top right) for the full keyword glossary** — every code (`HP`, `PWR`, `VULN`, `WK`, `DEX`, `METAL`, `EXH`, `+`, `x`, `A x n`) with a plain-English meaning. The glossary is written once, in the engine, so the game cannot explain a rule differently from how it enforces it.

It opens automatically the first time you play, then remembers that you have seen it.

### Reading the enemy

The enemy's announced move is written out — e.g. **"Will attack for 7 and block 5"** — with the compact `A7 B5` shown underneath. Plan around that number: an enemy showing an attack is going to hit you for exactly that much.

### Reading your status effects

Status pills read as sentences with the number in them: **"Weak 1 — your attacks deal 25% less damage"**, **"Strength 2 — your attacks deal 2 more damage"**. Hover any pill for the full explanation, including how long it lasts.

---

## Playing it

Everything is **mouse-driven**. You should never need to type anything.

| What you do | What happens |
|---|---|
| **Click a card in your hand** | Plays that card |
| **Click "End Turn"** | Ends your turn; enemies act |
| **Click a map node** | Moves to that encounter |
| **Click a reward card** | Adds it to your deck |
| **Click "Restart"** at the end | New run |

Cards you **cannot afford** are visually disabled — if it won't play, you don't have the energy, and the cost badge shows why. Hover a card to lift it out of the hand.

### What's on screen

- **The fight** — the Ashwright stands on the left, enemies on a ground line to the right, with the foundry behind them. Each enemy shows a badge for what it will do (a bigger badge means a harder hit) and the same intent in words.
- **Top bar** — hit points, energy, block, and the step count
- **Energy orb** — the energy you have left this turn, large, beside the hand
- **Draw and discard** — piles in the corners. Click one to read the cards in it
- **Hand** — your cards fanned along the bottom, each with its cost and a plain-English description
- **End Turn** — the enemies then act. Each enemy attacks **one at a time**: it winds up, dashes in, and a floating line over your hero names the attacker and its damage ("Kiln Mite −6") as it lands — block eating the whole attack says "absorbed". The attacker's intent badge lights up while it strikes. A fully-blocked attack still shows the swing; at `1×` a hard turn takes about three seconds, and `2×` brings it back to the classic pace.
- **Map** — the path through the act, with clickable nodes
- **Rewards** — pick one of three cards after each fight
- **`Help` button** — how to play plus the full keyword glossary
- **Speed** — `1×`, `2×`, and `»` above the fight. Since the UX-4 pace change, `1×` is the cinematic pace: every combat animation — card plays, the hammer arc, the enemy turn, the kill collapse, the draw being dealt card by card — runs at double the classic length, so nothing flashes past. **`2×` is the classic pace** — the timing the game shipped with before UX-4. `»` skips the combat animations entirely. The same skip happens if you click the empty foundry floor. The pace never changes what a card does.

### How the game works

You have **3 energy per turn**, and cards cost 1–2, so you'll typically play 2–3 cards. **Block disappears at the start of your turn** — it only reduces damage *this* turn, so block based on the enemy's shown intent. Your deck cycles: when the draw pile empties, the discard pile is shuffled back in.

**Retain.** A card marked *Retain* stays in your hand when your turn ends instead of being discarded — it keeps staying, turn after turn, until you play or discard it. The next turn's draw stacks on top of what you hold.

**The Kindling.** In the browser, every run opens at the forge: it offers three boons and you must take one. Each has an upside *and* a price (for example *Bellows Breath*: +1 Energy every turn, −12 max HP). Choose for your plan, not for the bigger number.

**Heroes.** Before the first choice of a run, the Kindling screen offers two heroes. The **Ashwright** (60 HP) starts with 5 Hammerfall, 4 Quench and Anvil Blow, and the Kindled Heart heals 6 after each fight. The **Bellows Keeper** (54 HP) starts with 4 Hammerfall, 4 Quench, *Bellows Gust* (1: deal 4 to ALL enemies) and *Fan the Flames* (0: gain 1 Energy, Exhaust). His **Cyan Lantern** gives +1 Energy on the first turn of every fight but never heals. His two starters are his alone and never appear as rewards. On the CLI, use `--character bellows_keeper`. The log header records the hero, so replay rebuilds the same run.

**Ember quests.** A run may carry three seeded side goals, shown above the map: *Elite Hunter* (win an elite fight, +8 max HP), *Smith's Rhythm* (play 30 cards, heal 12), *Bladework* (deal 120 damage, +6 max HP), *Ironwall* (gain 60 Block, +6 max HP) and *Pilgrim* (reach 2 campfires, heal 15). Progress counts by itself, and a finished quest pays out at once. The CLI map shows a `QUESTS` line; turn them on with `--quests`.

**The Cinder Mines.** On the opening screen, *Path* switches the climb from The Foundry to The Cinder Mines: a lantern-lit tunnel with its own foes (Slag Crawler, Ash Wraith, the elite Ash Matriarch) and the Cinder Foreman as the boss. Cards, rewards and the map rules are the same. CLI: `new --biome mines`; the log header records `"biome":"mines"` so `replay` reproduces it. A run without the flag is byte-identical to earlier builds.

**Tempers.** At a campfire you may, instead of resting, temper one of three offered cards for the rest of the run: *Quenched* (also gain 3 Block), *Red-hot* (+50% damage, lose 2 HP when played) or *Balanced* (also draw 1 card, exhausts). A tempered card wears a coloured trim and a badge.

**The Shop.** Every act holds exactly one vendor, mid-climb on floor 6 of the map (a coin marks the node). Its five card offers are seeded from what this run's rewards could still draw — priced by rarity: common 45–60 gold, uncommon 68–82, rare 135–165 — and the purse is the same one your victories fill (every fight pays by tier; you start with 99). Buying is immediate: the gold leaves, the card joins your deck, the slot is sold. A shelf you cannot afford is greyed out and is not even offered to the CLI. The vendor also sells one card *removal* per visit at a flat 75 gold: pay, then pick the exact copy that leaves — three Hammerfalls are three separate choices. Leaving closes the shop for good (the node is consumed like a fought one), so buy everything you want before you walk out. CLI action ids: `b1`–`b5` buy, `x` pay for removal, `x1`–`xn` pick the card to remove, `l` leave.

**Events.** Every act holds exactly two wayside events, on floors 3 and 7 of the map (a rune marks the node). Reaching one opens a story — one of four, drawn by seed at the moment you step in: **The Sleeping Forge** (stoke it for an Uncommon card at 8 HP, buy the ember for 30 gold and a Rare, or leave it), **The Ash Peddler** (buy a labelled-nothing bottle for 40 gold, sell a Common or Uncommon card from your deck for 50 — never the last copies above a six-card floor — or wave them on), **The Collapsed Shaft** (climb down for 60 gold at 12 HP, drop a 15-gold torch and recover 15 HP, or walk past) and **The Wandering Smith** (temper one of three cards exactly as at a campfire, hear his stories for 8 HP, or move on). A choice whose price you cannot pay is greyed out with the reason and is not offered to the CLI at all; nothing at the wayside can kill you (an HP loss stops at 1). After you choose, the results are listed, one *Continue* closes the node for good. CLI action ids: `v1`–`v3` choose, `v0` continue; the smith's temper list is `t1`–`t3`, exactly the campfire's.

Killing a low-HP enemy outright is usually better than blocking, because a dead enemy deals no damage next turn.

You are going to lose. A lot. That's the genre — the run ends with `GAME OVER — DEFEAT` and tells you how far you got.

---

## What kind of game this is

A **roguelike deckbuilder**, structurally in the family of *Slay the Spire* and *Balatro*. One act, one boss (the Slag Warden), 40 cards, one character: the Ashwright, whose Kindled Heart restores 6 HP after each fight.

It is a **vertical slice**: the mechanical core, built to prove the loop works and that AI agents can drive it at low token cost. The combat screen is drawn in the forge-lit woodcut style. There is **no sound** yet.

**What is deliberately not done:** balance is untuned, so expect the difficulty curve to feel rough. There are no meta-progression, no save-and-resume mid-run UI, no settings, no sound.

---

## Two ways to play it, one engine

The same engine core powers both surfaces, and a golden-state test asserts they stay identical — so a rule can never exist in one and not the other.

### 1. Browser (for humans) — what you're doing now

```bash
npm run serve            # http://localhost:5173/src/web/
```

### 2. Headless CLI (for agents and scripts)

This is what makes the project cheap to test with AI. It never reads stdin, so an automated agent can never hang.

```bash
node bin/dlb new --seed 42 --run run.json
node bin/dlb state   --run run.json     # compact text observation: ~116 tokens
node bin/dlb actions --run run.json     # 5-token action ids
node bin/dlb play p1 --run run.json
```

Add `--kindling` to `new` to open on the act-start boon choice the browser uses: the state shows `KINDLING` and the actions are `k1`–`k3` (no skip). Without the flag a run is byte-identical to earlier builds, so old seeds, logs and golden hashes still match. `--tempers` adds the rest-site temper offers (`t1`–`t3`, next to `c` heal and `e1` leave); the browser uses all three flags (with `--quests`). A Kindling run's log header records `"kindling":true`, so `replay` reproduces it.

**Batch balance testing costs zero API tokens:**

```bash
node bin/dlb sim --runs 200 --seed-start 1 --policy greedy --threads 4 --out ./sim-out
node bin/dlb stats --from ./sim-out --by-card --format table
```

~275 games per second, measured. The balance report labels its provenance, because these numbers describe the heuristic policy — **not** human players.

There is also a terminal wrapper (`./scripts/play.sh --seed 42`) if you ever want to play without a browser. It works, but it is not the intended way for a human.

---

## Verify the build yourself

```bash
node --test 'tests/**/*.test.js'      # 222 tests — 221 pass, 0 fail, 1 todo
node scripts/check-architecture.mjs   # OK — no violations
```

**Re-verified 2026-10-24, after the module refactor** (`src/web/app.js` split into focused ES
modules; `policies.js` value models split out; kernel draw/step loops single-sourced): the suite
reports **222 tests — 221 pass, 0 fail, 1 todo**. The todo is `§11.2` in
`tests/history/record.test.js`, a real defect deliberately marked `{ todo: true }` so it stays
visible instead of being forgotten; it is not a regression. The opt-in browser e2e
(`npm run test:browser`, Playwright over the served page) passes **8/8**. The architecture gate
scans **35 files** under `src/` and reports no violations.

The architecture gate is what keeps the browser and CLI from drifting apart. It fails if a surface file reaches into game rules, or if the game kernel imports a Node-only module — which is why the browser build cannot silently rot. The card wording is covered by `tests/ux/descriptions.test.js`, which fails if any card ends up with a placeholder or an unexplained abbreviation — so this defect cannot come back.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| `ERR_CONNECTION_REFUSED` | The server stopped. `npm run serve` and reload. |
| Page loads, nothing happens | Hard-reload (`Ctrl-Shift-R`) — a cached old module. |
| Clicks do nothing on a card | You can't afford it — the card says "needs more Energy". Check the cost badge vs your energy. |
| Not sure what something means | Click **Help** (top right). Every code is in the glossary. |
| Port already in use | `node scripts/serve.mjs --port 5174` |
| Stuck at the end screen | Click **Restart**. |

Nothing is served outside the project directory, and the game makes **no network requests** — no CDN, no telemetry, no external fonts.

---

## Your feedback is the project's gate

Try a few runs (10 is the pre-registered number), then answer one question: **after losing, did you want to start another run without being asked?**

That single reaction decides whether we build the remaining 80–110 cards and the art, or stop here. The plan says clearly: if the loop isn't fun at 40 cards, we don't scale it.
