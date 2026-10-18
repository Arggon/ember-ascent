# #53 card face: glyph mapping (all 44 cards and every legal temper)

Glyphs: `damage` sword, `block` whole shield, `weak` snapped blade, `vulnerable` shield split in two offset halves, `strength` fist (knuckles + thumb), `metallicize` riveted plate, `draw` card, `energy` bolt, `hp` heart, `discard` card-away, `exhaust` flame (only as the corner mark of a card that exhausts itself). `ALL` = every living enemy. Signs: gains +N, losses -N; damage unsigned.

Order: what happens on play first (repeated glyphs merged into one summed line), then trigger blocks: a **word + colon** on its own line (Turn end:, Exhaust:, HP lost:, Played:) and its lines (↳). Red-hot appears only on cards that deal damage.

Line counts are measured in a real browser by scripts/dev/viewport-check.mjs at 360x640 and 320x568 with 130% text (rows drawn; 3 is the aim, 4 the fallback, every variant must fit its card).

| card | temper | full sentence (aria-label, preview) | face | rows @360·130% | rows @320·130% |
|---|---|---|---|---|---|
| strike (Hammerfall) | — | Deal 6 damage to the enemy. | [damage] 6 | 1 | 1 |
| strike (Hammerfall) | quenched | Deal 6 damage to the enemy. Gain 3 Block. | [damage] 6 / [block] +3 | 2 | 2 |
| strike (Hammerfall) | redhot | Deal 9 damage to the enemy. Lose 2 HP. | [damage] 9 / [hp] -2 | 2 | 2 |
| strike (Hammerfall) | balanced | Deal 6 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 6 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| defend (Quench) | — | Gain 5 Block. | [block] +5 | 1 | 1 |
| defend (Quench) | quenched | Gain 5 Block. Gain 3 Block. | [block] +8 | 1 | 1 |
| defend (Quench) | balanced | Gain 5 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +5 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| bash (Anvil Blow) | — | Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy — it takes 50% more damage from attacks. | [damage] 8 / [vulnerable] +2 | 2 | 2 |
| bash (Anvil Blow) | quenched | Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy — it takes 50% more damage from attacks. Gain 3 Block. | [damage] 8 / [block] +3 / [vulnerable] +2 | 3 | 3 |
| bash (Anvil Blow) | redhot | Deal 12 damage to the enemy. Apply 2 Vulnerable to the enemy — it takes 50% more damage from attacks. Lose 2 HP. | [damage] 12 / [vulnerable] +2 / [hp] -2 | 3 | 3 |
| bash (Anvil Blow) | balanced | Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy — it takes 50% more damage from attacks. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 8 / [vulnerable] +2 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| gust (Bellows Gust) | — | Deal 4 damage to ALL enemies. | [damage] 4 ALL | 1 | 1 |
| gust (Bellows Gust) | quenched | Deal 4 damage to ALL enemies. Gain 3 Block. | [damage] 4 ALL / [block] +3 | 2 | 2 |
| gust (Bellows Gust) | redhot | Deal 6 damage to ALL enemies. Lose 2 HP. | [damage] 6 ALL / [hp] -2 | 2 | 2 |
| gust (Bellows Gust) | balanced | Deal 4 damage to ALL enemies. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 4 ALL / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| fan_flames (Fan the Flames) | — | Gain 1 Energy. Exhaust this card for the rest of the fight. | [energy] +1 / (corner exhaust flame) | 1 | 1 |
| fan_flames (Fan the Flames) | quenched | Gain 1 Energy. Exhaust this card for the rest of the fight. Gain 3 Block. | [block] +3 / [energy] +1 / (corner exhaust flame) | 2 | 2 |
| fan_flames (Fan the Flames) | balanced | Gain 1 Energy. Exhaust this card for the rest of the fight. Draw 1 card. | [energy] +1 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| anger (Spark) | — | Deal 5 damage to the enemy. | [damage] 5 | 1 | 1 |
| anger (Spark) | quenched | Deal 5 damage to the enemy. Gain 3 Block. | [damage] 5 / [block] +3 | 2 | 2 |
| anger (Spark) | redhot | Deal 7 damage to the enemy. Lose 2 HP. | [damage] 7 / [hp] -2 | 2 | 2 |
| anger (Spark) | balanced | Deal 5 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 5 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| cleave (Arc Cut) | — | Deal 4 damage to ALL enemies. | [damage] 4 ALL | 1 | 1 |
| cleave (Arc Cut) | quenched | Deal 4 damage to ALL enemies. Gain 3 Block. | [damage] 4 ALL / [block] +3 | 2 | 2 |
| cleave (Arc Cut) | redhot | Deal 6 damage to ALL enemies. Lose 2 HP. | [damage] 6 ALL / [hp] -2 | 2 | 2 |
| cleave (Arc Cut) | balanced | Deal 4 damage to ALL enemies. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 4 ALL / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| clothesline (Collar Check) | — | Deal 12 damage to the enemy. Apply 2 Weak to the enemy — its attacks deal 25% less damage. | [damage] 12 / [weak] +2 | 2 | 2 |
| clothesline (Collar Check) | quenched | Deal 12 damage to the enemy. Apply 2 Weak to the enemy — its attacks deal 25% less damage. Gain 3 Block. | [damage] 12 / [block] +3 / [weak] +2 | 3 | 3 |
| clothesline (Collar Check) | redhot | Deal 18 damage to the enemy. Apply 2 Weak to the enemy — its attacks deal 25% less damage. Lose 2 HP. | [damage] 18 / [weak] +2 / [hp] -2 | 3 | 3 |
| clothesline (Collar Check) | balanced | Deal 12 damage to the enemy. Apply 2 Weak to the enemy — its attacks deal 25% less damage. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 12 / [weak] +2 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| headbutt (Brow Strike) | — | Deal 9 damage to the enemy. | [damage] 9 | 1 | 1 |
| headbutt (Brow Strike) | quenched | Deal 9 damage to the enemy. Gain 3 Block. | [damage] 9 / [block] +3 | 2 | 2 |
| headbutt (Brow Strike) | redhot | Deal 13 damage to the enemy. Lose 2 HP. | [damage] 13 / [hp] -2 | 2 | 2 |
| headbutt (Brow Strike) | balanced | Deal 9 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 9 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| ironwave (Slag Surge) | — | Gain 5 Block. Deal 5 damage to the enemy. | [block] +5 / [damage] 5 | 2 | 2 |
| ironwave (Slag Surge) | quenched | Gain 5 Block. Deal 5 damage to the enemy. Gain 3 Block. | [block] +8 / [damage] 5 | 2 | 2 |
| ironwave (Slag Surge) | redhot | Gain 5 Block. Deal 7 damage to the enemy. Lose 2 HP. | [block] +5 / [damage] 7 / [hp] -2 | 3 | 3 |
| ironwave (Slag Surge) | balanced | Gain 5 Block. Deal 5 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +5 / [damage] 5 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| pommel (Haft Jab) | — | Deal 9 damage to the enemy. Draw 1 card. | [damage] 9 / [draw] +1 | 2 | 2 |
| pommel (Haft Jab) | quenched | Deal 9 damage to the enemy. Draw 1 card. Gain 3 Block. | [damage] 9 / [block] +3 / [draw] +1 | 3 | 3 |
| pommel (Haft Jab) | redhot | Deal 13 damage to the enemy. Draw 1 card. Lose 2 HP. | [damage] 13 / [draw] +1 / [hp] -2 | 3 | 3 |
| pommel (Haft Jab) | balanced | Deal 9 damage to the enemy. Draw 1 card. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 9 / [draw] +2 / (corner exhaust flame) | 2 | 2 |
| sword_boomerang (Returning Brand) | — | Deal 3 damage to ALL enemies. | [damage] 3 ALL | 1 | 1 |
| sword_boomerang (Returning Brand) | quenched | Deal 3 damage to ALL enemies. Gain 3 Block. | [damage] 3 ALL / [block] +3 | 2 | 2 |
| sword_boomerang (Returning Brand) | redhot | Deal 4 damage to ALL enemies. Lose 2 HP. | [damage] 4 ALL / [hp] -2 | 2 | 2 |
| sword_boomerang (Returning Brand) | balanced | Deal 3 damage to ALL enemies. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 3 ALL / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| thunderclap (Forgeclap) | — | Deal 4 damage to ALL enemies. Apply 1 Vulnerable to ALL enemies — it takes 50% more damage from attacks. | [damage] 4 ALL / [vulnerable] +1 ALL | 2 | 2 |
| thunderclap (Forgeclap) | quenched | Deal 4 damage to ALL enemies. Apply 1 Vulnerable to ALL enemies — it takes 50% more damage from attacks. Gain 3 Block. | [damage] 4 ALL / [block] +3 / [vulnerable] +1 ALL | 3 | 3 |
| thunderclap (Forgeclap) | redhot | Deal 6 damage to ALL enemies. Apply 1 Vulnerable to ALL enemies — it takes 50% more damage from attacks. Lose 2 HP. | [damage] 6 ALL / [vulnerable] +1 ALL / [hp] -2 | 3 | 3 |
| thunderclap (Forgeclap) | balanced | Deal 4 damage to ALL enemies. Apply 1 Vulnerable to ALL enemies — it takes 50% more damage from attacks. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 4 ALL / [vulnerable] +1 ALL / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| twin_strike (Twin Hammers) | — | Deal 5 damage to the enemy 2 times. | [damage] 5×2 | 1 | 1 |
| twin_strike (Twin Hammers) | quenched | Deal 5 damage to the enemy 2 times. Gain 3 Block. | [damage] 5×2 / [block] +3 | 2 | 2 |
| twin_strike (Twin Hammers) | redhot | Deal 7 damage to the enemy 2 times. Lose 2 HP. | [damage] 7×2 / [hp] -2 | 2 | 2 |
| twin_strike (Twin Hammers) | balanced | Deal 5 damage to the enemy 2 times. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 5×2 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| wild_strike (Untempered) | — | Deal 12 damage to the enemy. | [damage] 12 | 1 | 1 |
| wild_strike (Untempered) | quenched | Deal 12 damage to the enemy. Gain 3 Block. | [damage] 12 / [block] +3 | 2 | 2 |
| wild_strike (Untempered) | redhot | Deal 18 damage to the enemy. Lose 2 HP. | [damage] 18 / [hp] -2 | 2 | 2 |
| wild_strike (Untempered) | balanced | Deal 12 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 12 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| flex (Bellows) | — | Gain 2 Strength — your attacks deal 2 more damage. | [strength] +2 | 1 | 1 |
| flex (Bellows) | quenched | Gain 2 Strength — your attacks deal 2 more damage. Gain 3 Block. | [block] +3 / [strength] +2 | 2 | 2 |
| flex (Bellows) | balanced | Gain 2 Strength — your attacks deal 2 more damage. Draw 1 card. Exhaust this card for the rest of the fight. | [strength] +2 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| shrug (Cast Aside) | — | Gain 8 Block. Draw 1 card. | [block] +8 / [draw] +1 | 2 | 2 |
| shrug (Cast Aside) | quenched | Gain 8 Block. Draw 1 card. Gain 3 Block. | [block] +11 / [draw] +1 | 2 | 2 |
| shrug (Cast Aside) | balanced | Gain 8 Block. Draw 1 card. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +8 / [draw] +2 / (corner exhaust flame) | 2 | 2 |
| true_grit (True Temper) | — | Gain 7 Block. | [block] +7 | 1 | 1 |
| true_grit (True Temper) | quenched | Gain 7 Block. Gain 3 Block. | [block] +10 | 1 | 1 |
| true_grit (True Temper) | balanced | Gain 7 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +7 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| warcry (Kiln Cry) | — | Draw 1 card. Discard 1 card at random. | [draw] +1 / [discard] -1 | 2 | 2 |
| warcry (Kiln Cry) | quenched | Draw 1 card. Discard 1 card at random. Gain 3 Block. | [block] +3 / [draw] +1 / [discard] -1 | 3 | 3 |
| warcry (Kiln Cry) | balanced | Draw 1 card. Discard 1 card at random. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +2 / [discard] -1 / (corner exhaust flame) | 2 | 2 |
| armaments (Fit the Plate) | — | Gain 5 Block. | [block] +5 | 1 | 1 |
| armaments (Fit the Plate) | quenched | Gain 5 Block. Gain 3 Block. | [block] +8 | 1 | 1 |
| armaments (Fit the Plate) | balanced | Gain 5 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +5 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| havoc (Vent) | — | Draw 1 card. Gain 1 Energy. | [draw] +1 / [energy] +1 | 2 | 2 |
| havoc (Vent) | quenched | Draw 1 card. Gain 1 Energy. Gain 3 Block. | [block] +3 / [draw] +1 / [energy] +1 | 3 | 3 |
| havoc (Vent) | balanced | Draw 1 card. Gain 1 Energy. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +2 / [energy] +1 / (corner exhaust flame) | 2 | 2 |
| battle_trance (Heat Trance) | — | Draw 3 cards. | [draw] +3 | 1 | 1 |
| battle_trance (Heat Trance) | quenched | Draw 3 cards. Gain 3 Block. | [block] +3 / [draw] +3 | 2 | 2 |
| battle_trance (Heat Trance) | balanced | Draw 3 cards. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +4 / (corner exhaust flame) | 1 | 1 |
| bloodletting (Vein Tap) | — | Lose 3 HP. Gain 2 Energy. | [hp] -3 / [energy] +2 | 2 | 2 |
| bloodletting (Vein Tap) | quenched | Lose 3 HP. Gain 2 Energy. Gain 3 Block. | [block] +3 / [hp] -3 / [energy] +2 | 3 | 3 |
| bloodletting (Vein Tap) | balanced | Lose 3 HP. Gain 2 Energy. Draw 1 card. Exhaust this card for the rest of the fight. | [hp] -3 / [energy] +2 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| carnage (Sunder) | — | Deal 20 damage to the enemy. | [damage] 20 | 1 | 1 |
| carnage (Sunder) | quenched | Deal 20 damage to the enemy. Gain 3 Block. | [damage] 20 / [block] +3 | 2 | 2 |
| carnage (Sunder) | redhot | Deal 30 damage to the enemy. Lose 2 HP. | [damage] 30 / [hp] -2 | 2 | 2 |
| carnage (Sunder) | balanced | Deal 20 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 20 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| combust (Banked Coal) | — | Gain Combust: at the end of each turn, deal 1 damage to ALL enemies and lose 1 HP. | **Turn end:** / ↳ [damage] 1 ALL / ↳ [hp] -1 | 3 | 3 |
| combust (Banked Coal) | quenched | Gain Combust: at the end of each turn, deal 1 damage to ALL enemies and lose 1 HP. Gain 3 Block. | [block] +3 / **Turn end:** / ↳ [damage] 1 ALL / ↳ [hp] -1 | 4 | 4 |
| combust (Banked Coal) | balanced | Gain Combust: at the end of each turn, deal 1 damage to ALL enemies and lose 1 HP. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +1 / **Turn end:** / ↳ [damage] 1 ALL / ↳ [hp] -1 / (corner exhaust flame) | 4 | 4 |
| dark_embrace (Ash Embrace) | — | Gain Dark Embrace: whenever a card is exhausted, draw 1 card. | **Exhaust:** / ↳ [draw] +1 | 2 | 2 |
| dark_embrace (Ash Embrace) | quenched | Gain Dark Embrace: whenever a card is exhausted, draw 1 card. Gain 3 Block. | [block] +3 / **Exhaust:** / ↳ [draw] +1 | 3 | 3 |
| dark_embrace (Ash Embrace) | balanced | Gain Dark Embrace: whenever a card is exhausted, draw 1 card. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +1 / **Exhaust:** / ↳ [draw] +1 / (corner exhaust flame) | 3 | 3 |
| dropkick (Heel Drop) | — | Deal 5 damage to the enemy. Gain 1 Energy. | [damage] 5 / [energy] +1 | 2 | 2 |
| dropkick (Heel Drop) | quenched | Deal 5 damage to the enemy. Gain 1 Energy. Gain 3 Block. | [damage] 5 / [block] +3 / [energy] +1 | 3 | 3 |
| dropkick (Heel Drop) | redhot | Deal 7 damage to the enemy. Gain 1 Energy. Lose 2 HP. | [damage] 7 / [energy] +1 / [hp] -2 | 3 | 3 |
| dropkick (Heel Drop) | balanced | Deal 5 damage to the enemy. Gain 1 Energy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 5 / [energy] +1 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| entrench (Brace) | — | Double your current Block. Does nothing if you have no Block. | [block] ×2 | 1 | 1 |
| entrench (Brace) | quenched | Double your current Block. Does nothing if you have no Block. Gain 3 Block. | [block] ×2 / [block] +3 | 2 | 2 |
| entrench (Brace) | balanced | Double your current Block. Does nothing if you have no Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] ×2 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| feel_no_pain (Cinder Skin) | — | Gain Feel No Pain: whenever a card is exhausted, gain 1 Block. | **Exhaust:** / ↳ [block] +1 | 2 | 2 |
| feel_no_pain (Cinder Skin) | quenched | Gain Feel No Pain: whenever a card is exhausted, gain 1 Block. Gain 3 Block. | [block] +3 / **Exhaust:** / ↳ [block] +1 | 3 | 3 |
| feel_no_pain (Cinder Skin) | balanced | Gain Feel No Pain: whenever a card is exhausted, gain 1 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +1 / **Exhaust:** / ↳ [block] +1 / (corner exhaust flame) | 3 | 3 |
| flame_barrier (Flame Ward) | — | Gain 12 Block. | [block] +12 | 1 | 1 |
| flame_barrier (Flame Ward) | quenched | Gain 12 Block. Gain 3 Block. | [block] +15 | 1 | 1 |
| flame_barrier (Flame Ward) | balanced | Gain 12 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +12 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| ghostly_armor (Cinder Shroud) | — | Gain 10 Block. | [block] +10 | 1 | 1 |
| ghostly_armor (Cinder Shroud) | quenched | Gain 10 Block. Gain 3 Block. | [block] +13 | 1 | 1 |
| ghostly_armor (Cinder Shroud) | balanced | Gain 10 Block. Draw 1 card. Exhaust this card for the rest of the fight. | [block] +10 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| hemokinesis (Blood Hammer) | — | Lose 2 HP. Deal 15 damage. | [damage] 15 / [hp] -2 | 2 | 2 |
| hemokinesis (Blood Hammer) | quenched | Lose 2 HP. Deal 15 damage. Gain 3 Block. | [damage] 15 / [block] +3 / [hp] -2 | 3 | 3 |
| hemokinesis (Blood Hammer) | balanced | Lose 2 HP. Deal 15 damage. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 15 / [hp] -2 / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| inflame (Stoke) | — | Gain 2 Strength — your attacks deal 2 more damage. | [strength] +2 | 1 | 1 |
| inflame (Stoke) | quenched | Gain 2 Strength — your attacks deal 2 more damage. Gain 3 Block. | [block] +3 / [strength] +2 | 2 | 2 |
| inflame (Stoke) | balanced | Gain 2 Strength — your attacks deal 2 more damage. Draw 1 card. Exhaust this card for the rest of the fight. | [strength] +2 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| metallicize (Scale Up) | — | Gain 3 Metallicize — gain 3 Block at the end of each turn. | [metallicize] +3 | 1 | 1 |
| metallicize (Scale Up) | quenched | Gain 3 Metallicize — gain 3 Block at the end of each turn. Gain 3 Block. | [block] +3 / [metallicize] +3 | 2 | 2 |
| metallicize (Scale Up) | balanced | Gain 3 Metallicize — gain 3 Block at the end of each turn. Draw 1 card. Exhaust this card for the rest of the fight. | [metallicize] +3 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| pummel (Hail of Blows) | — | Deal 2 damage to the enemy 4 times. Exhaust this card for the rest of the fight. | [damage] 2×4 / (corner exhaust flame) | 1 | 1 |
| pummel (Hail of Blows) | quenched | Deal 2 damage to the enemy 4 times. Exhaust this card for the rest of the fight. Gain 3 Block. | [damage] 2×4 / [block] +3 / (corner exhaust flame) | 2 | 2 |
| pummel (Hail of Blows) | redhot | Deal 3 damage to the enemy 4 times. Exhaust this card for the rest of the fight. Lose 2 HP. | [damage] 3×4 / [hp] -2 / (corner exhaust flame) | 2 | 2 |
| pummel (Hail of Blows) | balanced | Deal 2 damage to the enemy 4 times. Exhaust this card for the rest of the fight. Draw 1 card. | [damage] 2×4 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| rampage (Climbing Heat) | — | Deal 8 damage. This card gains +5 damage permanently each time you play it. | [damage] 8 / **Played:** / ↳ [damage] +5 | 3 | 3 |
| rampage (Climbing Heat) | quenched | Deal 8 damage. This card gains +5 damage permanently each time you play it. Gain 3 Block. | [damage] 8 / [block] +3 / **Played:** / ↳ [damage] +5 | 4 | 4 |
| rampage (Climbing Heat) | balanced | Deal 8 damage. This card gains +5 damage permanently each time you play it. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 8 / [draw] +1 / **Played:** / ↳ [damage] +5 / (corner exhaust flame) | 4 | 4 |
| rupture (Split Seam) | — | Gain Rupture: whenever a card makes you lose HP, gain 1 Strength. | **HP lost:** / ↳ [strength] +1 | 2 | 2 |
| rupture (Split Seam) | quenched | Gain Rupture: whenever a card makes you lose HP, gain 1 Strength. Gain 3 Block. | [block] +3 / **HP lost:** / ↳ [strength] +1 | 3 | 3 |
| rupture (Split Seam) | balanced | Gain Rupture: whenever a card makes you lose HP, gain 1 Strength. Draw 1 card. Exhaust this card for the rest of the fight. | [draw] +1 / **HP lost:** / ↳ [strength] +1 / (corner exhaust flame) | 3 | 3 |
| shockwave (Heat Wash) | — | Apply 3 Weak to ALL enemies — its attacks deal 25% less damage. Apply 3 Vulnerable to ALL enemies — it takes 50% more damage from attacks. | [weak] +3 ALL / [vulnerable] +3 ALL | 2 | 2 |
| shockwave (Heat Wash) | quenched | Apply 3 Weak to ALL enemies — its attacks deal 25% less damage. Apply 3 Vulnerable to ALL enemies — it takes 50% more damage from attacks. Gain 3 Block. | [block] +3 / [weak] +3 ALL / [vulnerable] +3 ALL | 3 | 3 |
| shockwave (Heat Wash) | balanced | Apply 3 Weak to ALL enemies — its attacks deal 25% less damage. Apply 3 Vulnerable to ALL enemies — it takes 50% more damage from attacks. Draw 1 card. Exhaust this card for the rest of the fight. | [weak] +3 ALL / [vulnerable] +3 ALL / [draw] +1 / (corner exhaust flame) | 3 | 3 |
| uppercut (Rising Blow) | — | Deal 13 damage to the enemy. Apply 1 Weak to the enemy — its attacks deal 25% less damage. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. | [damage] 13 / [weak] +1 / [vulnerable] +1 | 3 | 3 |
| uppercut (Rising Blow) | quenched | Deal 13 damage to the enemy. Apply 1 Weak to the enemy — its attacks deal 25% less damage. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. Gain 3 Block. | [damage] 13 / [block] +3 / [weak] +1 / [vulnerable] +1 | 4 | 4 |
| uppercut (Rising Blow) | redhot | Deal 19 damage to the enemy. Apply 1 Weak to the enemy — its attacks deal 25% less damage. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. Lose 2 HP. | [damage] 19 / [weak] +1 / [vulnerable] +1 / [hp] -2 | 4 | 4 |
| uppercut (Rising Blow) | balanced | Deal 13 damage to the enemy. Apply 1 Weak to the enemy — its attacks deal 25% less damage. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 13 / [weak] +1 / [vulnerable] +1 / [draw] +1 / (corner exhaust flame) | 4 | 4 |
| bludgeon (Maul) | — | Deal 32 damage to the enemy. | [damage] 32 | 1 | 1 |
| bludgeon (Maul) | quenched | Deal 32 damage to the enemy. Gain 3 Block. | [damage] 32 / [block] +3 | 2 | 2 |
| bludgeon (Maul) | redhot | Deal 48 damage to the enemy. Lose 2 HP. | [damage] 48 / [hp] -2 | 2 | 2 |
| bludgeon (Maul) | balanced | Deal 32 damage to the enemy. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 32 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| impervious (Unbroken) | — | Gain 30 Block. Exhaust this card for the rest of the fight. | [block] +30 / (corner exhaust flame) | 1 | 1 |
| impervious (Unbroken) | quenched | Gain 30 Block. Exhaust this card for the rest of the fight. Gain 3 Block. | [block] +33 / (corner exhaust flame) | 1 | 1 |
| impervious (Unbroken) | balanced | Gain 30 Block. Exhaust this card for the rest of the fight. Draw 1 card. | [block] +30 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| limit_break (Overtemper) | — | Double your current Strength. Does nothing if you have no Strength. | [strength] ×2 | 1 | 1 |
| limit_break (Overtemper) | quenched | Double your current Strength. Does nothing if you have no Strength. Gain 3 Block. | [block] +3 / [strength] ×2 | 2 | 2 |
| limit_break (Overtemper) | balanced | Double your current Strength. Does nothing if you have no Strength. Draw 1 card. Exhaust this card for the rest of the fight. | [strength] ×2 / [draw] +1 / (corner exhaust flame) | 2 | 2 |
| offering (Blood Tithe) | — | Lose 6 HP. Gain 2 Energy. Draw 3 cards. | [hp] -6 / [energy] +2 / [draw] +3 | 3 | 3 |
| offering (Blood Tithe) | quenched | Lose 6 HP. Gain 2 Energy. Draw 3 cards. Gain 3 Block. | [block] +3 / [hp] -6 / [energy] +2 / [draw] +3 | 4 | 4 |
| offering (Blood Tithe) | balanced | Lose 6 HP. Gain 2 Energy. Draw 3 cards. Draw 1 card. Exhaust this card for the rest of the fight. | [hp] -6 / [energy] +2 / [draw] +4 / (corner exhaust flame) | 3 | 3 |
| reaper (Ash Harvest) | — | Deal 4 damage to ALL enemies. Heal HP equal to the damage dealt. | [damage] 4 ALL / "Heal that" | 2 | 2 |
| reaper (Ash Harvest) | quenched | Deal 4 damage to ALL enemies. Heal HP equal to the damage dealt. Gain 3 Block. | [damage] 4 ALL / [block] +3 / "Heal that" | 3 | 3 |
| reaper (Ash Harvest) | balanced | Deal 4 damage to ALL enemies. Heal HP equal to the damage dealt. Draw 1 card. Exhaust this card for the rest of the fight. | [damage] 4 ALL / [draw] +1 / "Heal that" / (corner exhaust flame) | 3 | 3 |
