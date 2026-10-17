# First Game Recommendation — $100 Budget, Agent-Led Build

**Date:** 2026-10-10
**Constraint set (given by owner):** **$100 USD total cash**, an existing AI coding plan, a team of **AI agents run by one human orchestrator**, **no paid marketing**, risk appetite = *"hit and recoup first, scale later."*
**Decision this document makes:** which game to build first.

## Evidence tiers

**[FETCHED]** page opened and the number read. **[SNIPPET]** search result only — unconfirmed. **[INFERRED]** my reasoning on top of sourced numbers. **[NOT FOUND]** looked for, does not exist. Cash cost and time cost are separated everywhere, because at this budget **time is the only real currency**.

---

## 1. The constraint that actually binds

The $100 budget is not the hard part. **Discovery is.**

| Fact | Value | Tier |
|---|---|---|
| Steam Direct fee | **$100.00 USD**, per product, one-time, non-refundable | [FETCHED] partner.steamgames.com/steamdirect |
| Steam fee recouped when | Only after **$1,000.00 USD Adjusted Gross Revenue** (≈200 sales at $5) | [FETCHED] same |
| Steam mandatory launch clock | 30-day wait after payment **plus** public "coming soon" page ≥2 weeks ≈ **6 weeks minimum**, independent of build time | [FETCHED] same |
| Steam payout floor | **$100** earned before payment; monthly, USD wire/ACH only | [FETCHED] partner.steamgames.com doc/finance |
| itch.io cost | **$0** to list and sell; default revenue share **10%** (you set it); processor ≈$0.30 + 2.9% | [FETCHED] itch.io/docs/creators |
| itch.io payout floor | **$5.00**, revenue vests 7 days | [FETCHED] same |
| Google Play | $25 one-time | [FETCHED] support.google.com |
| Roblox / UEFN | $0 to publish; Roblox min cash-out ≈$114 | [FETCHED] en.help.roblox.com |
| Godot engine | MIT, free, no royalties | [FETCHED] godotengine.org/license |
| Kenney asset packs | CC0, free | [FETCHED] kenney.nl |
| Realistic paid-asset benchmark | **Vampire Survivors: ~£1,100** of assets/music for version 1 | [FETCHED] Wikipedia |
| Cheapest credible launch | **$0** on itch.io + web portals | [FETCHED] |
| **What $100 buys** | Exactly one Steam app. **Zero assets.** | arithmetic on the above |

**Conclusion:** the entire budget goes to one Steam listing. There is no money for art, audio, ads, or a second attempt. Every asset must be CC0 or agent-generated, and the product must be *code-and-data-complete* before the $100 is spent.

### The real barrier: wishlist math

| Metric | Value | Tier |
|---|---|---|
| Wishlist→first-week sale conversion, <5k wishlists | **15%** median | [FETCHED] howtomarketagame.com/benchmarks |
| — 5k–40k wishlists | 20% | [FETCHED] same |
| — 40–100k / 100k+ | 23% / 25% | [FETCHED] same |
| Conversion by revenue target | $1k → 11.9%; $10k → 20.5%; $100k → 25.4% | [FETCHED] same (Carless study) |
| **~8,000 launch wishlists** | **≈ only ~$10k first week** | [INFERRED] on the sourced ratios |
| Median Steam game, lifetime gross | **~$1,000** | [SNIPPET] |
| 2025 Steam releases earning <$1,000 | **65.9%** | [SNIPPET] |
| 2025 releases reaching ≥1,000 reviews | **~2.5–3%** | [FETCHED] Zukowski |
| Mobile games failing within 3 years | **83%** | [SNIPPET] SuperScale |

**This is the whole problem in one line:** a game can be fully built, correct, and fun, and still earn near-zero, because earning requires wishlists and wishlists require attention. **$100 and no marketing buy zero attention.** Therefore the first game must be selected for its ability to generate attention *without money*.

### What actually generated attention in low-budget winners

Across 11 successful PC cases from 2023–2026, the reported acquisition channel was:

- **Streamer / TikTok / social virality — 7 cases** (Lethal Company, Content Warning, R.E.P.O., Schedule I, Supermarket Simulator, Buckshot Roulette, PEAK)
- **Publisher or Next Fest pipeline — 2 cases** (Balatro via Playstack, Fields of Mistria via Wholesome Direct)
- **Genre visibility — 1 case** (Rusty's Retirement)
- **Paid UA — 1 case** (My Perfect Hotel) — and that one is **disqualified** as a low-investment case, because it was publisher-scale paid traffic (~133M downloads est.)

**No successful low-budget case used paid ads as the mechanism.** But note the other half: **none of them succeeded by merely existing either.** [INFERRED] The free lever is *shareable moments* — clips that travel. That is a design property, and it is the thing to optimize.

---

## 2. The decision

### Recommended first game: a compact, data-driven roguelike deckbuilder

**Not the genre with the most money. The genre with the best combination of agent-producible content, legible-on-Steam presentation, low cash cost, and no post-launch obligation.**

**Why this and not the alternatives:**

1. **Highest agent-content share among Steam-legible categories.** Cards are data + text + balance rules — deterministic systems, which is precisely what code-generating agents do reliably. Estimated agent-producible share ~70–85%, versus ~50% for tower defense or autobattler (which need unit art and level design). [INFERRED]
2. **Art cost is survivable at $0–500.** The visible product is cards and numbers, not environments. CC0 packs plus one commissioned capsule image is enough. Balatro's look is vector-clean and cheap to approximate; it did **5M+ copies by Jan 2025** from a **solo dev, ~2.5 years**. [FETCHED] Wikipedia
3. **Proven solo precedent, twice.** *Slay the Spire*: **2 people, ~3.5 years, 14 months in Early Access, 1.5M copies by Mar 2019.** [FETCHED] Wikipedia. This is the most replicated low-budget path in PC gaming.
4. **Mid-table hit rate with 25× better odds than the worst category.** Roguelike Deckbuilder **5.1%** of tagged releases hit ≥1,000 reviews, versus 2D platformer **0.18%** and puzzle 0.34%. [FETCHED] Zukowski
5. **No live-service obligation.** This is decisive at a $100 budget. Deckbuilders are ship-and-tail: *Slay the Spire* added a free 4th character a year after 1.0 and then stopped. Compare cozy sims (Stardew has shipped free updates for 8+ years; Fields of Mistria is a 15-person studio still adding content) or idle games (Cookie Clicker, 13 years of development). [FETCHED/SNIPPET]. **A genre that demands perpetual content is unaffordable here.**
6. **Downside is recoverable, not fatal.** *Slay the Spire* sold about **2,000 copies in its first EA days** and grew from there. [FETCHED] Wikipedia. A slow start is not a death sentence in this genre — which matches "hit and recoup first."

### Deliberately rejected

| Candidate | Why not |
|---|---|
| **Co-op horror** (Lethal Company, R.E.P.O., Content Warning) | Highest revenue per unit of content — co-op is **6% of releases but 36% of units sold**, and the Co-op tag median is **~$3,100 vs ~$670** for Singleplayer [FETCHED]. **But: (a)** it needs multiplayer netcode, the riskiest thing to delegate to agents; **(b)** the famous "1-month sprint" case is **not replicable** — Content Warning was **5 named developers at Landfall**, an established studio with an existing audience, launching free-for-24h to reach **6.2M claims**. That is a marketing stunt plus a pre-built audience, not a small scope. [FETCHED]. **Revisit as game #2, once the pipeline is proven.** |
| **Idle / incremental** | Cheapest and fastest (agent-content share ~90–95%) — but idle's art-lightness is exactly its worst fit for **Steam discovery, which runs on capsule and screenshot appeal**. Hit rate lower (**2.79%**). And the ad-funded web portals that suit it pay **nothing** during CrazyGames Basic Launch. [FETCHED]. **Good fallback if the goal shifts to fastest first dollar.** |
| **Mobile F2P** | **83% of games fail within 3 years** and D30 ROAS runs **15–80%**; the category is a paid-user-acquisition business. With $0 for UA this is not a market entry, it is a donation. |
| **Cozy / farming sim** | **Highest** minimum content volume (Stardew: 4 years solo; Fields of Mistria: 15-person studio) **and** the strongest perpetual update obligation. Both are unaffordable. |
| **AAA-style live-service anything** | Closed. Console playtime is concentrated in ~10 incumbent live-service games. |

### Scope for the first build

**In:**
- One core loop: run → draft cards → build synergies → die → meta-progression
- **~120–150 cards**, 3 acts, **one playable character**
- **3–6 hours** to a first completion; replayability from synergy combinations, not content volume
- CC0/agent-generated art; **one commissioned capsule image** (the single highest-leverage paid asset)
- One language (English), no voice acting
- Price **$5–10**; no DLC at launch

**Out:** multiplayer, modding API, localization, achievements beyond defaults, Steam Workshop, mobile port, console port, sequel hooks.

**Deferred:** co-op horror follow-up (needs proven pipeline + netcode), paid expansions, additional characters as post-launch free content *only if the game earns*.

### Time-to-market

| Phase | Duration | Basis |
|---|---|---|
| Playable core loop | 3–6 weeks | [INFERRED] agent-assisted scope |
| Content + balance to launchable 1.0 | 8–14 weeks | [INFERRED] |
| Steam page live (required 2 weeks before release) | overlaps | [FETCHED] Steam Direct |
| **Total to first revenue on Steam** | **~3–4 months + Steam's 6-week clock** | [INFERRED] |
| **Total to first revenue on itch.io** | **~3 months, $0** | [FETCHED] itch terms |

For reference, the human-team baselines are **~12 months** (Vampire Survivors, solo) and **2.5–3.5 years** (Balatro, Slay the Spire). [FETCHED] Agent throughput is the entire reason a 3–4 month target is plausible — and it is also the most likely place this plan slips. Treat it as an estimate to be falsified at the first playable.

**Sequencing that spends $0 until there is evidence:** build the game → ship a free demo and paid build on **itch.io at $0** → submit the same web build to **CrazyGames** in parallel → **pay Steam's $100 only after paid traction exists.** This keeps pre-revenue cash at $0 and defers the $1,000-recoup exposure until the loop is validated. Steam's 6-week clock then runs in the background while wishlists accumulate.

---

## 3. User stories

**US-1 — Validate the loop before spending money**
*As the builder, I want a playable vertical slice on itch.io before paying Steam's $100, so that the fee is spent only on a game with demonstrated interest.*
- **Given** a playable build, **when** it is listed on itch.io at $0 cost, **then** it is publicly downloadable and a purchase is possible.
- **Given** 14 days of listing, **when** I check the dashboard, **then** I can state day-1/7/14 wishlist-equivalent interest and refund rate as numbers.
- **Given** the $100 fee is unspent, **when** the slice shows no interest, **then** scope can be cut or the concept changed at zero cash loss.

**US-2 — A first-time player understands the game in 60 seconds**
*As a new player, I want the core loop legible from the store page and the first run, so that I do not refund.*
- **Given** a player who has never seen the game, **when** they view the capsule and the first three screenshots, **then** they can describe the core loop correctly. *(Testable: 5 unaided testers, ≥4 correct.)*
- **Given** a new player, **when** they finish run 1, **then** they have made at least 3 meaningful card choices and understand why they lost.
- **Given** a refund request, **when** measured over launch week, **then** refund rate is below the platform-typical band. *(Threshold to be set from the first week's actual data.)*

**US-3 — Synergies produce shareable moments without developer-authored content**
*As the builder, I want emergent card interactions to generate clip-able moments, so that discovery does not depend on paid marketing.*
- **Given** ~120 cards with modifier stacking, **when** a run reaches act 3, **then** the player's board state is visually and numerically distinct from a run 1 state in a correctly describable way. *(This is the property that makes clips travel.)*
- **Given** a completed run, **when** the player screenshots the final board, **then** the numbers and card set are self-explanatory without commentary.

**US-4 — The build is content-complete and fixed-cost before launch**
*As the builder, I want the shipped 1.0 to require no mandatory post-launch content, so that $0 remains available after release.*
- **Given** launch, **when** no update is ever shipped, **then** the game remains complete and internally consistent.
- **Given** the store page, **when** it describes post-launch plans, **then** it promises no paid DLC and no live-service cadence.
- **Given** the $100 fee and a $1,000 recoup threshold, **when** 200 units sell at $5, **then** the fee is recovered. *(Arithmetic on Steam's published terms.)*

**US-5 — Assets cost $0 except one deliberate exception**
*As the builder, I want all art and audio sourced from CC0 or agent generation, so that total cash outlay stays at the Steam fee plus at most one commissioned asset.*
- **Given** the shipping build, **when** asset provenance is audited, **then** every file is CC0, agent-generated, or the single commissioned capsule, and each is documented.
- **Given** any AI-generated asset, **when** the store page is published, **then** the required AI disclosure is present and accurate. *(Steam mandates disclosure of pre-generated and live-generated AI content; itch.io requires an AI Disclosure tag and segregates tagged projects into an "AI Assisted" browse page — failing to tag "may result in delisting.")*

**US-6 — Wishlist accumulation starts before the game is finished**
*As the builder, I want the Steam page live as early as possible, so that the 2-week requirement is satisfied and organic wishlists accrue during development.*
- **Given** the Steam page is public, **when** 6 weeks pass, **then** both the 30-day wait and the 2-week coming-soon requirement are satisfied.
- **Given** a public devlog or clip posted weekly, **when** the page goes live, **then** wishlist count is tracked weekly as the single leading indicator.

---

## 4. Priorities

**Ranking rule:** *probability of recouping at $0 marketing × agent-producible content share ÷ irreversibility of cash spent.* Cash irreversibility dominates, because there is no second $100.

| # | Priority | Must / Should / Could |
|---|---|---|
| 1 | Prove the loop playable and fun | **Must** |
| 2 | Ship to itch.io at $0; keep pre-revenue cash at $0 | **Must** |
| 3 | Capsule art that does not read as an asset flip | **Must** |
| 4 | Steam page live ≥6 weeks before launch | **Must** |
| 5 | Content-complete 1.0 with no post-launch obligation | **Must** |
| 6 | 120–150 cards with functioning synergy stacking | **Must** |
| 7 | Weekly devlog/clip cadence (the only free acquisition lever) | **Should** |
| 8 | Web build to CrazyGames as a parallel channel | **Should** |
| 9 | Second character as free post-launch content | **Could** |
| 10 | Localization, Workshop, ports | **Could** |

---

## 5. Success metrics

| Metric | Target | Observed via |
|---|---|---|
| Playable core loop exists | Within 6 weeks | Build handed to ≥3 outside testers |
| Store-page legibility | ≥4 of 5 unaided testers describe the loop correctly | Recorded test sessions |
| First revenue | Any amount, on itch.io, at $0 cash outlay | itch.io dashboard |
| Steam fee recouped | 200 sales at $5 (≈$1,000 AGR) | Steam sales report |
| Launch wishlists | 1,000 minimum; 5,000 stretch (~$5k–$10k week 1) | Steam wishlist page |
| Launch-week conversion | Within 15–25% band for the wishlist tier | Steam sales report |
| Refund rate | Below the platform-typical band, set from week-1 data | Steam reports |
| Year-1 multiplier | ≥3× week-1 revenue (published median for 75+ games) | Steam reports |

**Honest expected value.** [INFERRED, on the sourced distributions] Recouping the $100 and earning a few hundred to low-thousands is the *probable* outcome for a competent, well-presented small deckbuilder. Crossing $10k first week needs ~8,000 wishlists and real audience-building. Crossing $100k sits in the ~2.5–3% band that reaches 1,000 reviews. **The first game's primary deliverable is a proven pipeline and a validated discovery mechanism; the revenue is secondary and should be planned as such.**

---

## 6. Open questions

Only the ones that change scope, each with the default I would ship with:

| Question | Default assumption |
|---|---|
| Do you have **any** existing audience (followers, Discord, friends who stream)? | **None** — if any exists, it is the single largest asset and changes the launch plan |
| Will you do the **weekly devlog/clip work** yourself? | **Yes** — this is the only free acquisition lever, and 7 of 11 low-budget winners relied on creator attention |
| **Full-time or evenings?** | **Full-time** — the 3–4 month estimate assumes it; part-time makes it 8–12 months |
| Steam **$100 now or after itch validation?** | **After** — keeps pre-revenue cash at $0 |
| Is a **web/portal build** acceptable in parallel? | **Yes** — free extra channel; note CrazyGames Basic Launch pays nothing |
| Have you shipped a commercial game before? | **No** — if yes, tighten the timeline and skip itch validation |

## 7. The strongest argument against this recommendation

**A 3–4 month agent-built deckbuilder may be exactly the "2,000-copy launch" case.** *Slay the Spire* took 3.5 years and *Balatro* 2.5 years for a reason: this genre's quality comes from hand-tuned balance, and balance is the least agent-producible part of the work. Estimated content share (70–85%) measures *volume*, not *tuning depth* — and Steam has thousands of competent-but-forgettable deckbuilders already. The honest alternative: if the balance problem proves intractable, fall back to **idle/incremental shipped web-first at $0**, which is faster and even cheaper, and accept the lower ceiling. **Kill criterion: if the loop is not fun with 40 cards, do not build 150.**

**Handoff:** this brief goes to the **Tech Lead** for routing — **System Architect** for the card/save data model and build pipeline, then engineering. I remain the reference for "is this in scope?" until release.
