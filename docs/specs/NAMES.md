# Names — the Ember Ascent id contract (0.5.0 `dlb-0.5.0-dests`)

Every internal id now names its own Ember Ascent concept: the StS-lexeme ids, enemy
`stateName`s, sprite file names, pose tokens and CSS keys were renamed to the Ember
vocabulary in the 0.5.0 content build. Mechanics, costs, numbers, Spanish twins and
display sentences are unchanged — the ONLY player-visible change is that the internal
names now match the names the player already read.

- **ids** (`snake_case`) — keys of the content tables and the tokens of the action line
  (`p1 hammerfall`).
- **stateName** — the English Ember display string copied into run state (enemy rows and
  encounter-table labels). It stays part of the content hash; from 0.5.0 it IS the Ember
  display name (`stateName === name` for every act-1 encounter row).
- **name / name_es** — what the player reads, unchanged by this build.

## Compatibility break (the 0.5.0 shim)

A save, log or `?hero=` link written before 0.5.0 carries the OLD ids. What happens to it:

- **Saves: they still load.** `loadObject` runs the load-time migration shim
  (`src/kernel/legacy-ids.js`) after `validateSave` and before any table lookup: every
  id-bearing structure is remapped to the new vocabulary (deck + all four combat piles,
  draft pool, reward cards and relic offers, shop offers, relics + relic pool + the B4-era
  singular relic, enemy rows and encounter-table spawn ids, the `state.powers` keys, the
  character id, and the hash-inert stateName strings). The migrated save **does not keep
  its old hash** — identity re-derives from the migrated state at the next record build;
  two loads of the same save yield the same migrated hash. Unknown ids keep degrading
  through the standing tolerance rulings (raw id, never a throw).
- **Pre-rename action LOGS: not promised.** A log whose entries carry old card tokens
  replays against content that no longer contains those ids — the replay break is
  documented here and in the shim header; golden logs were regenerated against 0.5.0.
- **`?hero=` and `--character`: old values still work.** `ironclad` and `bellows` are
  legacy aliases resolved to the canonical id before validation (`HERO_ALIASES`,
  `src/kernel/legacy-ids.js`); the canonical ids are `ashwright` and `bellows_keeper`.
  `?biome=` is untouched.

## Hero and relic

| id | legacy id | display name |
|---|---|---|
| `ashwright` | `ironclad` | Ashwright |
| `bellows_keeper` | `bellows` | Bellows Keeper |
| `kindled_heart` | `burning_blood` | Kindled Heart (6 HP after a won fight) |

## Enemies and their moves

| id | legacy id | stateName (hashed, = display) |
|---|---|---|
| `cinder_maw` | `jaw_worm` | Cinder Maw |
| `ash_cantor` | `cultist` | Ash Cantor |
| `kiln_mite` | `red_louse` | Kiln Mite |
| `slag_ooze` | `acid_slime` | Slag Ooze |
| `cinder_brute` | `gremlin_nob` | Cinder Brute |
| `slag_warden` | `the_guardian` | Slag Warden |

The mines/kiln roster (`slag_crawler`, `ash_wraith`, `ash_wraith_elite`,
`cinder_foreman`) was already Ember and is unchanged. Encounter ids (`weak_*`,
`strong_*`, `elite_1`, `boss_1`, `mines_*`, `kiln_*`) and biome ids (`foundry`,
`mines`, `kiln`) are generic/Ember and unchanged.

Renamed enemy moves: `maw_chomp`, `coil_thrash`, `ash_bellow` (Cinder Maw);
`ritual`, `hex_strike` (Ash Cantor); `mite_bite`, `mite_grow` (Kiln Mite);
`ooze_tackle`, `acid_lick` (Slag Ooze); `brute_rush`, `brute_smash`, `fury`
(Cinder Brute); `plating_up`, `piston_bash`, `steam_vent`, `shield_spin` (Slag
Warden); `sorrow_wail`, `soul_drain` (Ash Wraith); `cinder_shroud`,
`ember_soulfire`, `mourning_hex`, `grave_swing` (Ash Matriarch). Move ids never
enter run state, so no shim row is needed for them.

Renamed encounter stateNames: the compounds `Twin Mites`, `Mite and Ooze`, `Maw and
Mite`, `Cantor and Ooze`, `Cinder Brute`, `Slag Warden`, `Ooze and Mite`, `Maw and
Ooze`, `Cantor and Crawler`, `The Wraith Pack`, `Brute and Mite`, `Matriarch and
Wraith` (legacy: `Two Lice`, `Louse + Slime`, `Jaw Worm + Louse`, `Cultist + Slime`,
`Gremlin Nob`, `The Guardian`, `Slime + Louse`, `Jaw Worm + Slime`, `Cultist +
Crawler`, `Two Wraiths + Slime`, `Gremlin Nob + Louse`, `Ash Matriarch + Wraith`).
The full legacy→new string map lives in `LEGACY_ID_MAP.stateNames`.

## Cards

Ids are the action-line tokens (`p1 hammerfall`). Flavor and Spanish twins are
unchanged; rules text and numbers are unchanged. The 29 cards that already carried
Ember ids (`cinder_flick`, `heavy_swing`, `kindled_blade`, `slag_shrapnel`,
`scrap_shield`, `bellows_work`, `forge_stance`, `ember_ward`, `tallow_rub`,
`forge_rhythm`, `slag_wall`, `cinder_storm`, `anvil_rain`, `pressure_spike`,
`weight_of_iron`, `tempered_strike`, `seam_finder`, `furnace_heart`, `kiln_wrath`,
`great_pyre`, `ember_tide`, `pyre_feast`, `blaze_bellows`, `rekindle`,
`hearth_stand`, `forge_flood`, `slag_barb`, `kiln_fume`, `anvil_guard`) are unchanged.

| id | legacy id | display name |
|---|---|---|
| `hammerfall` | `strike` | Hammerfall |
| `quench` | `defend` | Quench |
| `anvil_blow` | `bash` | Anvil Blow |
| `bellows_gust` | `gust` | Bellows Gust |
| `fan_the_flames` | `fan_flames` | Fan the Flames |
| `spark` | `anger` | Spark |
| `arc_cut` | `cleave` | Arc Cut |
| `collar_check` | `clothesline` | Collar Check |
| `brow_strike` | `headbutt` | Brow Strike |
| `slag_surge` | `ironwave` | Slag Surge |
| `haft_jab` | `pommel` | Haft Jab |
| `returning_brand` | `sword_boomerang` | Returning Brand |
| `forgeclap` | `thunderclap` | Forgeclap |
| `twin_hammers` | `twin_strike` | Twin Hammers |
| `untempered` | `wild_strike` | Untempered |
| `bellows` | `flex` | Bellows |
| `cast_aside` | `shrug` | Cast Aside |
| `true_temper` | `true_grit` | True Temper |
| `kiln_cry` | `warcry` | Kiln Cry |
| `fit_the_plate` | `armaments` | Fit the Plate |
| `vent` | `havoc` | Vent |
| `heat_trance` | `battle_trance` | Heat Trance |
| `vein_tap` | `bloodletting` | Vein Tap |
| `sunder` | `carnage` | Sunder |
| `banked_coal` | `combust` | Banked Coal |
| `ash_embrace` | `dark_embrace` | Ash Embrace |
| `heel_drop` | `dropkick` | Heel Drop |
| `brace` | `entrench` | Brace |
| `cinder_skin` | `feel_no_pain` | Cinder Skin |
| `flame_ward` | `flame_barrier` | Flame Ward |
| `cinder_shroud` | `ghostly_armor` | Cinder Shroud |
| `blood_hammer` | `hemokinesis` | Blood Hammer |
| `stoke` | `inflame` | Stoke |
| `scale_up` | `metallicize` | Scale Up |
| `hail_of_blows` | `pummel` | Hail of Blows |
| `climbing_heat` | `rampage` | Climbing Heat |
| `split_seam` | `rupture` | Split Seam |
| `heat_wash` | `shockwave` | Heat Wash |
| `rising_blow` | `uppercut` | Rising Blow |
| `maul` | `bludgeon` | Maul |
| `unbroken` | `impervious` | Unbroken |
| `overtemper` | `limit_break` | Overtemper |
| `blood_tithe` | `offering` | Blood Tithe |
| `ash_harvest` | `reaper` | Ash Harvest |

The power ids follow the cards that grant them: `banked_coal`, `ash_embrace`,
`cinder_skin`, `split_seam` (legacy `combust`, `dark_embrace`, `feel_no_pain`,
`rupture`) — these are `state.powers` KEYS, so the shim remaps them with stacks
preserved. Kindling BOON ids (`bellows`, `ironskin`, `sparkfall`, `purge`, `stoke`)
are a DIFFERENT namespace and are unchanged — `bellows` (boon) is not `bellows`
(card) and not `bellows_keeper` (hero).

**Kept StS-verbatim, on purpose:** the STATUS key `metallicize` (the `Scale Up`
card's own status: `STATUSES`, `STATUS_KINDS`, the `.pill.metallicize` rule and the
status describe rows). It is not in the ordered rename lexicon; renaming it is a
follow-up slice touching every status-key surface.

## Pose tokens and art

The three pose tokens that carried a card lexeme renamed with their cards:
`browstrike` (was `headbutt`), `heeldrop` (was `dropkick`), `ashsweep` (was
`reapsweep`) — `HERO_MOVES` values, `HERO_POSE_MS`, `POSE_VALUES`,
`MELEE_APPROACH_MOVES` and the `.fig.pose-*` / `@keyframes hero-*` / `frame-*` CSS
all follow. Every other pose token is Ember already. Enemy pose names (`maw-wind`,
`cantor-rite`, `mite-dart`, `ooze-lunge`, `brute-charge`, `warden-wall`, …) are Ember
and unchanged; the generic words `strike`, `brace`, `vent`, `uppercut`, `stoke` stay
where they are motion words, not ids.

Sprite files renamed with their ids (`cinder_maw.webp`, `ash_cantor.webp`,
`kiln_mite.webp`, `slag_ooze.webp`, `cinder_brute.webp`, `slag_warden.webp` and
their `-windup`/`-guard` layers); the `.spr-<id>` class follows the sprite key
(`.spr-slag_warden`). Glyph-art keys renamed only where they carried a lexeme:
`e-cantor` (was `e-cultist`), `e-mite` (was `e-louse`), `r-kindled_heart` (was
`r-burning_blood`).

## Mark

| id | wording |
|---|---|
| `boss_down` | Warden down / Defeat the Slag Warden |

Status keywords (Strength, Vulnerable, Weak, Dexterity, Metallicize) and the compact
codes (`A6`, `B5`, `PWR`, `VULN`) are the rules vocabulary, not card titles, and are
unchanged.

Historical status logs that quote a captured screenshot still use the old wording on
purpose. They describe a picture that was taken then.
