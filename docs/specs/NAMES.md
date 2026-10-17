# Names

Display names for Ember Ascent. Mechanics, ids, costs, and numbers are unchanged.
`stateName` is the string copied into run state (enemy rows and encounter-table labels). It is part of the content hash, so it stays on the old spelling and replays, seeds, and golden fixtures keep verifying. Everything a player reads uses `name`.

The character id stays `ironclad`. The relic id stays `burning_blood` (6 HP after a won fight).

## Hero and relic

| id | old (player-facing) | new |
|---|---|---|
| `ironclad` | Ironclad | Ashwright |
| `burning_blood` | Burning Blood | Kindled Heart |

## Enemies

| id | stateName (hashed, unchanged) | display name |
|---|---|---|
| `jaw_worm` | Jaw Worm | Cinder Maw |
| `cultist` | Cultist | Ash Cantor |
| `red_louse` | Red Louse | Kiln Mite |
| `acid_slime` | Acid Slime | Slag Ooze |
| `gremlin_nob` | Gremlin Nob | Cinder Brute |
| `the_guardian` | The Guardian | Slag Warden |

## Encounters

| id | stateName (hashed, unchanged) | display name |
|---|---|---|
| `weak_1` | Jaw Worm | Cinder Maw |
| `weak_2` | Cultist | Ash Cantor |
| `weak_3` | Two Lice | Twin Mites |
| `weak_4` | Acid Slime | Slag Ooze |
| `strong_1` | Louse + Slime | Mite and Ooze |
| `strong_2` | Jaw Worm + Louse | Maw and Mite |
| `strong_3` | Cultist + Slime | Cantor and Ooze |
| `elite_1` | Gremlin Nob | Cinder Brute |
| `boss_1` | The Guardian | Slag Warden |

## Mark

| id | old | new |
|---|---|---|
| `boss_down` | Guardian down / Defeat The Guardian | Warden down / Defeat the Slag Warden |

## Cards

Ids are the action-line tokens (`p1 strike`). Flavor is new; there was none before. Rules text is unchanged.

| id | old | new | flavor |
|---|---|---|---|
| `strike` | Strike | Hammerfall | The first lesson of the forge: hit it until it yields. |
| `defend` | Defend | Quench | Cool iron holds. |
| `bash` | Bash | Anvil Blow | The anvil answers louder than the hammer. |
| `anger` | Anger | Spark | A small heat, spent at once. |
| `cleave` | Cleave | Arc Cut | One swing, every face in the fire. |
| `clothesline` | Clothesline | Collar Check | The jaw meets the haft. |
| `headbutt` | Headbutt | Brow Strike | The helm does the talking. |
| `ironwave` | Iron Wave | Slag Surge | A wall of cooling metal, then the follow-through. |
| `pommel` | Pommel Strike | Haft Jab | The blunt end still counts. |
| `sword_boomerang` | Sword Boomerang | Returning Brand | Heat you threw comes back. |
| `thunderclap` | Thunderclap | Forgeclap | The whole shop flinches. |
| `twin_strike` | Twin Strike | Twin Hammers | Left, then right, before the glow fades. |
| `wild_strike` | Wild Strike | Untempered | No form. All weight. |
| `flex` | Flex | Bellows | Work the lungs of the forge. |
| `shrug` | Shrug It Off | Cast Aside | The blow slides off the pauldron. |
| `true_grit` | True Grit | True Temper | Hold the heat. Do not flinch. |
| `warcry` | Warcry | Kiln Cry | The furnace answers. |
| `armaments` | Armaments | Fit the Plate | Strap on what the climb still owes you. |
| `havoc` | Havoc | Vent | Open the flue. The room fills with work. |
| `battle_trance` | Battle Trance | Heat Trance | The world narrows to the next swing. |
| `bloodletting` | Bloodletting | Vein Tap | Pay in blood. Take the breath back. |
| `carnage` | Carnage | Sunder | Too much hammer for one body. |
| `combust` | Combust | Banked Coal | Leave a coal in the grate. It works while you do. |
| `dark_embrace` | Dark Embrace | Ash Embrace | What burns away still warms the hands. |
| `dropkick` | Dropkick | Heel Drop | The boot comes down where the hammer cannot. |
| `entrench` | Entrench | Brace | Set your feet in the clinker. |
| `feel_no_pain` | Feel No Pain | Cinder Skin | The burn stops meaning anything. |
| `flame_barrier` | Flame Barrier | Flame Ward | A curtain of fire that bites back. |
| `ghostly_armor` | Ghostly Armor | Cinder Shroud | Ash remembers the shape of armor. |
| `hemokinesis` | Hemokinesis | Blood Hammer | The swing costs a little of you. |
| `inflame` | Inflame | Stoke | Feed the fire in the arm. |
| `metallicize` | Metallicize | Scale Up | Plates knit between blows. |
| `pummel` | Pummel | Hail of Blows | Four short strikes, then nothing left. |
| `rampage` | Rampage | Climbing Heat | Each swing teaches the next. |
| `rupture` | Rupture | Split Seam | When you bleed, the hammer gets heavier. |
| `shockwave` | Shockwave | Heat Wash | A wave that leaves them open and weak. |
| `uppercut` | Uppercut | Rising Blow | Up from the floor of the furnace. |
| `bludgeon` | Bludgeon | Maul | One stroke. The argument ends. |
| `impervious` | Impervious | Unbroken | Nothing gets through. Then the plate is spent. |
| `limit_break` | Limit Break | Overtemper | Past the point the metal was meant to hold. |
| `offering` | Offering | Blood Tithe | Feed the kiln. It pays you back in breath and cards. |
| `reaper` | Reaper | Ash Harvest | What you cut comes back as heat in the chest. |

Status keywords (Strength, Vulnerable, Weak, Dexterity, Metallicize) and the compact codes (`A6`, `B5`, `PWR`, `VULN`) are the rules vocabulary, not card titles, and are unchanged.

Historical status logs that quote a captured screenshot still use the old wording on purpose. They describe a picture that was taken then.
