# Which Video Game Categories Succeed and Earn Most — Evidence Review

**Date:** 2026-10-10
**Scope:** Mobile (iOS/Android), PC (Steam), console. Period: FY2024 – H1 2026.
**Method:** Three parallel research threads plus one gap-closing pass. Every number carries a source tier.

## How to read the evidence

| Tier | Meaning |
|---|---|
| **[FETCHED]** | Source page was opened and the number read directly. |
| **[SNIPPET]** | Search-result snippet only — **unconfirmed**. Do not treat as verified. |
| **[INFERRED]** | My reasoning on top of sourced numbers; not a sourced claim. |
| **[NOT FOUND]** | Looked for, does not exist in accessible sources. Left empty on purpose. |

Two definitional traps run through all industry data, and most bad genre rankings are caused by them:

- **"Consumer spend" = store IAP only, excluding advertising.** Sensor Tower's mobile figure is IAP. Newzoo's mobile figure is a different, broader total. They are not comparable.
- **"Revenue" of a genre = sum over all titles (a power-law statistic)**, not the revenue of a typical game in that genre. Mean and median diverge by 100×+. Every ranking below states which one it is.

---

## 1. The short answer

There is no single ranking, because your two questions have **different answers**:

**Q1 — "Which categories earn the most money?"** (aggregate revenue capture)

1. **Mobile strategy / 4X** — the only genre in 2025 that grew on revenue, downloads *and* playtime simultaneously. [FETCHED]
2. **Console live-service shooters and sports sims** — but the money is locked to ~10 incumbent franchises. [FETCHED]
3. **Mobile match-3 / merge puzzle** — smaller pool, unusually durable, and the revenue is held by a handful of titles. [FETCHED]
4. **RPG, especially East Asian mobile MMORPG/ARPG** — large pool, gated behind publisher distribution relationships. [FETCHED]

**Q2 — "Which categories are most likely to succeed?"** (hit rate per release, PC/Steam)

1. **Open World Survival Craft** — 20.8% of tagged 2025 releases reached ≥1,000 reviews.
2. **Farming** — 8.3%
3. **Roguelike Deckbuilder** — 5.1%
4. **Simulation** — 4.1%
5. **Horror** — 3.2%, and it more than doubled year over year.
   Worst: 2D platformer 0.18%, puzzle 0.34%, city builder 0.5%. [FETCHED]

**The most exploitable single fact in this data set:** co-op games were **6% of 2023 releases but 36% of units sold** [FETCHED, VG Insights] — and on Steam, Co-op carries a **median revenue of ~$3,100, versus ~$670 for the Singleplayer tag**: roughly **4.6× the typical outcome**. Co-op is not the genre with the most total revenue — it is a *structural feature* that raises the median outcome of whatever genre it sits in. Both datasets point the same way, which is why this is the strongest single finding here.

**The single most important number for a business decision:** on PC free-to-play, revenue **per playing hour** is roughly **2× PlayStation and ~3× Xbox**, growing ~10% YoY. [SNIPPET, Newzoo] If that holds, business model beats genre as a margin explanation.

---

## 2. Market size by platform — get the denominators right

| Segment | Value | Period | Tier / Source |
|---|---|---|---|
| Global games market | $213.9B, +6.1% YoY | 2026F | [FETCHED] gamesindustry.biz / Newzoo |
| — Mobile | $121.1B (57% share), +6.8% | 2026F | [FETCHED] Newzoo |
| — Console | $46.9B (22%), +5.1% | 2026F | [FETCHED] Newzoo |
| — PC | $45.9B (21%), +5.3% | 2026F | [FETCHED] Newzoo |
| Global, revised actual | $201.6B, +9.1% | 2025 | [SNIPPET] Newzoo via gamedev.net |
| US consumer spend | $60.7B, +1.4% (content $52.3B) | 2025 | [FETCHED] Circana |
| US consumer spend | $58.65B, −1.1% (content $50.6B, +2%) | 2024 | [FETCHED] Circana |
| Steam gross revenue | ~$20B, then **$11.1B in H1 2026, +14.5% YoY** | 2025 / H1 2026 | [FETCHED] Alinea Analytics |
| Mobile IAP only | $81.75B, +1.3% (downloads 50.4B, −7.2%) | 2025 | [FETCHED] Sensor Tower via mobilegamer.biz |
| Mobile IAP only | $80.9B, +4% (downloads 49.6B, −6%) | 2024 | [FETCHED] Sensor Tower |

**Read this carefully before comparing anything.** Newzoo's mobile number ($121.1B) and Sensor Tower's mobile number ($81.75B) differ by ~$40B for overlapping years. Different scope and methodology, not a contradiction to resolve. Any "mobile is bigger than PC and console combined" claim depends entirely on which number you pick.

**Growth is modest and structural, not explosive.** Mobile IAP grew 1.3% on a shrinking download base. Console would be roughly flat without GTA 6. [FETCHED]

---

## 3. Mobile: where the money is vs where the downloads are

### 3.1 The spend/download mismatch is the whole story

| Layer | Revenue 2025 | Downloads 2025 | Share of IAP | Share of downloads |
|---|---|---|---|---|
| Midcore | $44.68B (flat) | 5.48B (−10.2%) | ~55% | ~11% |
| Casual | $32.7B (flat) | 14.35B (−19.5%) | ~40% | ~28% |
| Hybrid-casual | $4.2B (**+20%**) | 6.09B (−10.6%) | ~5% | ~12% |
| Hyper-casual | — | **22.05B (+2.2%)** | ~5% [INFERRED] | ~44% |

[FETCHED] mobilegamer.biz, Sensor Tower data. Share columns marked [INFERRED] are my arithmetic on the sourced values.

**Hyper-casual games are ~44% of all downloads and ~5% of the money.** This is the most common error in popular genre rankings — download charts are not revenue charts.

### 3.2 Genre specifics

- **Strategy / 4X is the standout.** In 2025 it was the **only genre that grew on revenue, downloads *and* playtime**, and it holds the #1 and #2 highest-grossing titles globally (*Last War*, *Whiteout Survival*). [FETCHED] sensortower.com/report/state-of-gaming-2026
- **2024 genre spend:** Strategy ~$17.5B, RPG $16.8B, Puzzle $12.2B, Casino $11.7B, Sports $2.7B; Action revenue +46%. [SNIPPET, aggregator — treat as indicative]
- **Unresolved contradiction:** Sensor Tower's own reported percentages (Strategy "just under 10%", Match Swap Puzzle 8.67%, Squad RPG 6.14%, MMORPG 5.59%, Casino Slots 5.37%, Battle Royale 3.05%) do **not** reconcile with the $17.5B/~21.5% strategy figure. Taxonomy difference, not resolved. Do not cite either as precise.
- **December 2025 top grossing:** *Last War* $136M, *Monopoly Go* $121M, *Royal Match* $103M, *Whiteout Survival* $101M. [FETCHED]
- **Puzzle is quietly the profit engine.** Match-3 held $2.5B in H1 2026, roughly flat (−0.4%), on far less UA pressure than strategy. [SNIPPET]

### 3.3 Mobile unit economics — the reason genre selection is not the main variable

| Metric | Value | Tier |
|---|---|---|
| Median D1 retention | ~22% (top 1%: 64–68%) | [FETCHED] GameAnalytics 2026 |
| Median D7 retention | <4% | [FETCHED] GameAnalytics 2026 |
| Median D30 retention | 0.68–0.79% (top 1%: 13–15%) | [FETCHED] GameAnalytics 2026 |
| D30 ROAS — casual | 47% iOS / **15% Android** | [FETCHED] Liftoff |
| D30 ROAS — sports | 80% (best in class) | [FETCHED] Liftoff |
| D30 ROAS — strategy | 60% | [FETCHED] Liftoff |
| CPI — casual | $1.41 iOS / $0.14 Android | [FETCHED] Liftoff |
| CPI — casino | $21.03 iOS | [FETCHED] Liftoff |
| GameAnalytics genre benchmarks | **withdrawn** in the 2026 edition (taxonomy rework) | [FETCHED] |

**Every D30 ROAS figure is below 100%.** Genre choice moves this number by 5× (15% → 80%), but no genre makes it good. That is a distribution problem, not a genre problem.

**Ad revenue: confirmed as large, and heavily geography-dependent.** Sensor Tower's Gaming Deep Dive: Ad Monetization puts mobile-game ad monetization at **>$12B in 2025**, but the scope is **19 markets, not global** (US, JP, KR, IN, BR…; 2.4T impressions). [SNIPPET, primary page would not open — corroborated by two outlets]

The category split of that ad revenue (Feb–Apr 2026) is the key number:

| Category | Share of mobile ad revenue |
|---|---|
| Casual | 40% |
| Hyper-casual | 40% |
| Hybrid-casual | 16% |
| Midcore | **4%** |
| Deck: Puzzle genre alone | 53% |

[FETCHED] wnhub.io full text of the Sensor Tower report.

Three consequences that a pure IAP ranking gets wrong:

1. **Strategy/4X — the "winner" on IAP — earns only 4% of ad revenue.** Its dominance is IAP-only. Casual and hyper-casual take **80% combined**, on a download base (~44% of all downloads) that IAP tables treat as near-worthless.
2. **The ad share of revenue is a geography story, not a genre story:** **India 70.3% vs USA 22.1%** (Jan–May 2026). [FETCHED] Any ad-inclusive genre ranking is therefore also a market-selection decision.
3. Ad monetization is still spreading: games carrying ads went from 45.1% (Jul 2021) to **55.6%** (May 2026). AppLovin + AdMob take 65% of that revenue. [FETCHED]

Deconstructor of Fun argues the $12B figure **underestimates** the true ad market [SNIPPET]. A **global** ads-vs-IAP split is [NOT FOUND] — a circulating "IAP 62% / ads 26% / subs 12%" claim is unverified and is **not** cited here. Treat the $12B as a floor on a 19-market basis, not a global total.

---

## 4. PC / Steam: success rate and revenue capture point in different directions

### 4.1 The mid-tail reality

| Fact | Value | Tier |
|---|---|---|
| Median Steam game, lifetime gross | **~$1,000** | [SNIPPET] |
| 2025 releases earning <$1,000 gross | **65.9%** (8,388 titles) | [SNIPPET] |
| 2025 releases selling <100 copies | **47.4%** | [SNIPPET] |
| 2025 releases reaching "real" revenue (≥1,000 reviews ≈ $150k+) | ~2.5–3% | [FETCHED] Zukowski |
| 2025 releases clearing $1M | **~1.5%** of ~20,000 | [SNIPPET] GameDiscoverCo |
| Share of Steam revenue from games grossing >$50M | **52%** (2025) | [SNIPPET] GameDiscoverCo/SteamDB |
| Share of H1 2026 Steam revenue from 2026 releases | **21%** (back catalogue = 79%) | [FETCHED] Alinea |

Steam is not a market of 20,000 competitors. It is a market of roughly 500 games that matter, plus a long tail that grosses four figures. Note also that 79% of Steam's money in H1 2026 went to **older** games — new releases fight for a fifth of the platform's revenue.

### 4.1b Steam revenue by tag — total is a breadth artifact, median is the real signal

Source: games-stats.com/steam/tags (477 tags, values labeled "Revenue Estimate"; period not stated, likely lifetime-to-date [INFERRED]). Top rows [FETCHED]:

| Tag | Total revenue | **Median revenue** |
|---|---|---|
| Singleplayer | ~$21B | ~$670 |
| Action | ~$18B | ~$570 |
| Multiplayer | ~$15B | ~$960 |
| Adventure | ~$15B | ~$1,100 |
| Atmospheric | ~$12B | ~$1,300 |
| Open World | ~$12B | ~$2,400 |
| **Co-op** | ~$10B | **~$3,100** |
| Story Rich | ~$9.4B | ~$2,700 |
| First-Person | ~$9.1B | ~$960 |
| RPG | ~$8.8B | ~$1,400 |

**Read the columns against each other.** Singleplayer leads on total and is *worst on median*. Co-op ranks 7th on total and **first on median among large tags**. Tags overlap (a game counts in many), so these totals are **not additive** — ranking by total mostly measures how broadly a tag is applied.

**The median for nearly every genre is under $1,500.** Honest tag-level tail: **63–85% of tagged games gross under $5,000**, and only **1–6% clear $1M** (Singleplayer 3%; Co-op and Open World 11%). The illusion in the "total revenue" column is that Co-op and Singleplayer look comparable; the typical game in each differs by 4.6×.

Caveats: gamalytic.com/genres renders as a JS app with no readable values [FETCHED]; VG Insights has no public genre revenue table [NOT FOUND]. Figures are model estimates, not publisher disclosures.

### 4.2 Hit rate by genre (share of releases reaching ≥1,000 reviews)

| Genre | Hit rate 2025 | vs 2024 | Hit count 2025 |
|---|---|---|---|
| Open World Survival Craft | **20.8%** | 24.5% ▼ | — |
| Farming | 8.3% | 20.8% ▼ | — |
| Roguelike Deckbuilder | 5.1% | 6.7% ▼ | 22 |
| Simulation | 4.1% | 3.8% ▲ | 43 |
| Horror | 3.2% | **1.8% ▲▲** | 39 |
| Idle / Incremental | 2.79% | 3.05% ▼ | 27 |
| RPG | 2.4% | 1.5% ▲ | 28 |
| Racing | 2.1% | 1.3% ▲ | — |
| Souls-like | 0.8% | — | — |
| City Builder | 0.5% | 2.7% ▼ | — |
| Puzzle | 0.34% | — | — |
| 2D Platformer | **0.18%** | — | — |
| **Narrative (by hit count)** | — | — | **51 (#1)** |

[FETCHED] howtomarketagame.com 2025 genre review. 9 of 10 genres repeated their position year over year. **95% of 2025's hits were AA or indie titles.**

Three things this table says that a revenue ranking hides:

1. **High hit rate ≠ big money.** Survival-craft has the best odds and the worst revenue per hit. Narrative has the most hits and a mediocre hit rate.
2. **The odds spread 100×** (0.18% → 20.8%). Genre choice is the largest single lever on probability of any commercial outcome.
3. **Momentum matters more than level.** Horror (1.8%→3.2%), Narrative (30→51 hits), Simulation (27→43 hits), Racing, RPG are all rising. Survival-craft and Farming are relaxing from a spike.

### 4.3 Co-op is the highest-leverage structural feature found

Co-op titles were **6% of 2023 releases but 36% of units sold** [FETCHED, VG Insights], and viral co-op was named a primary growth engine for Steam in H1 2026 [FETCHED, Alinea]. This is the clearest "multiplier" in the evidence set — it is a design property independent of genre. [INFERRED: co-op raises the same title's revenue rather than changing which titles are viable.]

---

## 5. Console: concentration, not genre

- **5 of the top 10 US sellers in 2024 were sports sims.** *Call of Duty* was the #1 franchise for the **16th consecutive year**; *College Football 25* was the best-selling sports game in US history; *Helldivers 2* was #3. [FETCHED] Circana
- **US 2025:** *Battlefield 6* #1, *NBA 2K26* #2, *Borderlands 4* #3. Subscriptions grew ~20% for the year, +24% in December. [FETCHED] Circana
- **More than 40% of total US PS5/Xbox playtime went to just 10 live-service games.** [SNIPPET] Eurogamer
- **Roblox was #1 by US retail dollars in FY2025** (gift cards +16%); over half of PS and Xbox active audiences played Fortnite at least once. [FETCHED]

**Console genre revenue splits by category are [NOT FOUND]** — Circana reports title-level only, and Newzoo's genre data is paywalled. Any console "genre ranking" you see is likely a chart-position count, not revenue.

---

## 6. Business model and region beat genre

| Comparison | Finding | Tier |
|---|---|---|
| Revenue per playing hour | PC F2P ~**2× PlayStation**, ~**3× Xbox**, +10% YoY | [SNIPPET] Newzoo |
| Mobile games failing within 3 years of launch | **83%** | [SNIPPET] SuperScale/Atomik 2023 |
| UA absorbed by one hit | *Monopoly Go*: up to $1.5B UA on ~$5B gross | [SNIPPET] |
| China PC games | ¥78.16B, **+14.97%** | [SNIPPET] |
| China mini-games | **+54.17%** | [SNIPPET] |
| East Asia ARPG/MMO money | Publisher-gated (Nexon $3.1B FY2025) | [SNIPPET] |
| Roblox UGC platform | 123M DAU (Q2 2026) | [SNIPPET] |
| Industry layoffs | ~45,000 (2022 → Jul 2025); 30+ studio closures | [SNIPPET] GDC/Wikipedia |
| Fastest high-profile failure | *Concord*, shut down 14 days after launch | [SNIPPET] |
| Notable online games shut down | **38 (2024) · 41 (2025) · 27 (2026 YTD)** | [FETCHED] Wikipedia tracker |

On the shutdown line: that is a **floor of notable titles**, scraped from Wikipedia's per-year lists — it excludes the long tail and includes sunsets of online features in otherwise-offline games. **The denominator does not exist:** no "N of M launched" base rate was found anywhere, and StopKillingGames' own statistics pages are still marked "Coming Soon" [FETCHED]. A "live-service death rate" of any specific percentage is therefore **unsupportable** — treat any such claim you encounter as invented.

The **fastest-growing gaming segments in 2025–2026 are not genres at all** — they are China mini-games (+54%), subscriptions (+20–24%), PC F2P per-hour yield, and UGC platforms. A genre-only frame misses all four.

---

## 7. What the popular claims get wrong

1. **"Mobile earns the most"** — true, and irrelevant. It is a distribution/UA business where 83% of titles fail and D30 ROAS is 15–80%.
2. **"Strategy/4X is the top genre"** — true of the *pool*, and dominated by two titles. The pool's existence tells you nothing about your odds.
3. **"X is the best genre"** conflates three incomparable statistics: total pool size (mean-based), hit rate (count-based), and revenue per release. Each has a different winner.
4. **Download charts are not revenue charts** — a 44%-of-downloads category holds ~5% of IAP. But the inverse also holds: that same category takes **80% of mobile ad revenue**. Pick your revenue definition before picking a winner.
5. **"The industry is growing"** — mobile IAP grew 1.3%, console is flat without GTA 6, and 79% of Steam revenue goes to back catalogue. Growth is concentrated in a few segments.
6. **Live-service is treated as a genre.** It is a business model with extreme incumbent advantage: 10 games take >40% of console playtime.

---

## 8. Structural attractiveness for a 2026 entrant

[INFERRED — this section is my judgment built on the sourced findings above, not a sourced claim.]

| Candidate | Odds | Money | Binding constraint |
|---|---|---|---|
| **Co-op PC/console (any high-hit-rate genre)** | High | Medium–High | Content volume — co-op multiplies units sold (36% of units on 6% of releases) and roughly 4.6× the median revenue |
| **Steam mid-tail in a rising hit-rate genre** (Horror, Narrative, Simulation, Idle) | Medium | Low–Medium | Discoverability; median is ~$1,000 and 63–85% of tagged games gross <$5k |
| **PC F2P live-service** | Low | Highest per hour | UA + retention; needs 2× PlayStation yield per hour |
| **China mini-games** | Unknown | Fastest growth (+54%) | Licensing, local publishing access |
| **Mobile hybrid-casual / ad-monetized casual** | Medium | Growing (+20%); **80% of ad revenue** | Geography-bound: ad share is 70% in India vs 22% in USA; $12B figure is 19-market |
| **Mobile strategy/4X** | Low | Highest IAP pool, but only **4% of ad revenue** | UA costs + two entrenched leaders |
| **Mobile puzzle (match-3/merge)** | Medium | High, durable; **53% of all mobile ad revenue** | Content velocity; incumbents (Royal Match, Monopoly Go) |
| **Console AAA live-service** | Very low | Highest ceiling | $300M+ budgets vs 1.5% hit base rate |
| **Sports sims** | Closed unless licensed | High | IP licensing (EA/NBA 2K duopoly) |

The consistent pattern: **where the money is largest, entry is gated by UA spend, licensing, or incumbent network effects. Where entry is open, the median outcome is ~$1,000.**

---

## 9. Contradictions and caveats

1. **Newzoo 2025 vintage conflict:** $188.8B forecast → $201.6B revised actual → $197B third-party. Always vintage-tag.
2. **Mobile ad revenue:** the $12B Sensor Tower figure covers **19 markets, not the globe**, and DoF argues it is an underestimate. A global ads-vs-IAP ratio is [NOT FOUND]. Ad-dependent genre rankings must state their market list.
3. **A known trap in mobile concentration figures:** the widely-quoted "29% of mobile game revenue from the top 1%" is the top 1% of **spenders** (an Everyplay survey, ~2014) — not the top 1% of titles. It has been miscited as concentration for a decade. Do not reuse it.
4. **Mobile revenue concentration, best available:** **~40% of all mobile gaming revenue flows to the top 10 publishers** [SNIPPET, appfollow citing Sensor Tower, Jun 2026]. Title-level top-1%/top-10% concentration is [NOT FOUND] from Sensor Tower, AppMagic, Appfigures, Naavik or DoF. Publisher-level is the defensible fallback.
3. **All store revenue is estimated.** No publisher discloses per-title revenue. AppMagic reports net vs Sensor Tower gross [INFERRED].
4. **Steam release counts differ 1–10%** across SteamDB/VGInsights (~20,000 in 2025), so "% of releases" figures shift with the denominator.
5. **Means are meaningless in games.** Median Steam game ≈$1,000; mean ≈$358,900. Any average is an outlier artifact.
6. **GameAnalytics withdrew genre-level benchmarks** in its 2026 edition.
7. **The "top 1% earn 84.5%" figure is unverified** and was deliberately not cited above.
8. **Tag-based genre denominators** are self-reported and approximate; a title can carry several tags.
9. **Circana is US-only**, based on publisher-reported data with known digital gaps.
10. **Survivorship bias:** every dataset conditions on games that shipped and were tracked.

### Known gaps (searched, not found)

**Closed by the gap-closing pass:** Steam genre revenue table (§4.1b) · mobile ad revenue by category (§3.3) · mobile concentration, publisher-level only (§9.4) · live-service shutdown counts, without denominator (§6).

**Still open:**
- Mobile top 1%/top 10% concentration at **title** level (publisher-level only)
- Live-service shutdown **base rate** — count exists, denominator does not
- Category-level ARPDAU for mobile
- Mobile payer-conversion percentage
- Console genre revenue splits (Circana and Newzoo do not publish this freely)
- Global ads-vs-IAP split for mobile
- Sports-licensing margin structure; LATAM/MENA category spend

---

## 10. Recommendations and open questions

**If the goal is expected value rather than a lottery ticket:** target a **rising hit-rate genre on PC/console with co-op as a core design property**. That is the only combination where the sourced numbers show both above-average odds (1,000-review bar) and a revenue multiplier — Co-op's median (~$3,100) is roughly 4.6× the Singleplayer tag's (~$670), and co-op titles were 36% of units sold on 6% of releases. Treat business model as a separate margin decision.

**If you read the ad numbers first, the mobile answer flips.** Strategy/4X is the IAP champion but earns **4% of ad revenue**. Ad-monetized casual and hyper-casual earn **80%** of it, with Puzzle alone at **53%**. If total mobile revenue (IAP + ads) is the metric, the ranking is different from the IAP-only ranking — and the choice between them is a **market-selection decision**, because the ad share runs 70.3% in India vs 22.1% in the USA.

**If the goal is maximum upside:** mobile strategy/4X or PC F2P live-service — accepting that 83% of mobile titles fail and console live-service is a 10-franchise oligopoly.

**Open questions (each with the assumption I would ship with):**

| Question | Default assumption |
|---|---|
| Is this for a new studio's first title, or portfolio/investment allocation? | **First title** — changes the answer toward hit-rate genres, away from $300M live-service |
| What is the capital budget and runway? | **< $5M** — excludes own-IP AAA live-service entirely [INFERRED] |
| Is the goal revenue, or revenue per hour of player attention? | **Revenue** — if per-hour, PC F2P wins outright [SNIPPET-dependent] |
| Do you have a distribution/UA capability or an existing audience? | **No** — if yes, mobile strategy becomes materially more viable |
| Is ad-monetized mobile in scope? | **Yes, and ad-inclusive** — on IAP-only, hybrid-casual (+20%) and puzzle (53% of ad revenue) are unfairly penalized |
| Geographic focus? | **Global/Western PC first** — China mini-games need local publishing access |

**Handoff:** the stories, acceptance criteria and constraints above are ready for the **Tech Lead** to route to **System Architect** (feasibility, platform contracts) and **UX Designer** (flows) once a candidate category is chosen. I remain the reference for "is this in scope?" until release.
