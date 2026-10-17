# How to Play — `dlb`

**Open this in your browser:**

```
http://localhost:5173/web/
```

A server is already running. If it has stopped, restart it with:

```bash
cd <project root>
npm run serve          # prints the URL to open
```

Add `?seed=42` to the URL for a reproducible run: `http://localhost:5173/web/?seed=42`

> **Correction 2026-10-16:** this file says **40 cards** below. The shipped build has **42 card
> definitions** (`src/kernel/content/cards.json`); 40 was the planning target. The text is left as
> written so the intent stays visible. "40" in the questions at the end is a standalone sentiment —
> it stands.

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
- **End Turn** — the enemies then act
- **Map** — the path through the act, with clickable nodes
- **Rewards** — pick one of three cards after each fight
- **`Help` button** — how to play plus the full keyword glossary
- **Speed** — `1×`, `2×`, and `»` above the fight. `»` skips the combat animations. The same skip happens if you click the empty foundry floor.

### How the game works

You have **3 energy per turn**, and cards cost 1–2, so you'll typically play 2–3 cards. **Block disappears at the start of your turn** — it only reduces damage *this* turn, so block based on the enemy's shown intent. Your deck cycles: when the draw pile empties, the discard pile is shuffled back in.

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
npm run serve            # http://localhost:5173/web/
```

### 2. Headless CLI (for agents and scripts)

This is what makes the project cheap to test with AI. It never reads stdin, so an automated agent can never hang.

```bash
node bin/dlb new --seed 42 --run run.json
node bin/dlb state   --run run.json     # compact text observation: ~116 tokens
node bin/dlb actions --run run.json     # 5-token action ids
node bin/dlb play p1 --run run.json
```

**Batch balance testing costs zero API tokens:**

```bash
node bin/dlb sim --runs 200 --seed-start 1 --policy greedy --threads 4 --out ./sim-out
node bin/dlb stats --from ./sim-out --by-card --format table
```

~310 games per second. The balance report labels its provenance, because these numbers describe the heuristic policy — **not** human players.

There is also a terminal wrapper (`./play.sh --seed 42`) if you ever want to play without a browser. It works, but it is not the intended way for a human.

---

## Verify the build yourself

```bash
node --test 'tests/**/*.test.js'    # 60 pass, 0 fail
node tools/check-architecture.mjs   # OK — no violations
```

The architecture gate is what keeps the browser and CLI from drifting apart. It fails if a surface file reaches into game rules, or if the game kernel imports a Node-only module — which is why the browser build cannot silently rot. The card wording is covered by `tests/ux/descriptions.test.js`, which fails if any card ends up with a placeholder or an unexplained abbreviation — so this defect cannot come back.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| `ERR_CONNECTION_REFUSED` | The server stopped. `npm run serve` and reload. |
| Page loads, nothing happens | Hard-reload (`Ctrl-Shift-R`) — a cached old module. |
| Clicks do nothing on a card | You can't afford it — the card says "needs more Energy". Check the cost badge vs your energy. |
| Not sure what something means | Click **Help** (top right). Every code is in the glossary. |
| Port already in use | `node tools/serve.mjs --port 5174` |
| Stuck at the end screen | Click **Restart**. |

Nothing is served outside the project directory, and the game makes **no network requests** — no CDN, no telemetry, no external fonts.

---

## Your feedback is the project's gate

Try a few runs (10 is the pre-registered number), then answer one question: **after losing, did you want to start another run without being asked?**

That single reaction decides whether we build the remaining 80–110 cards and the art, or stop here. The plan says clearly: if the loop isn't fun at 40 cards, we don't scale it.
