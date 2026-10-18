# #53 card face: glyph mapping (all 44 cards)

What each glyph stands for: `damage` = sword, `block` = shield, `weak` = Weak (snapped blade), `vulnerable` = Vuln (cracked shield), `strength` = Strength (fist), `metallicize` = Metallicize (riveted plate), `draw` = card, `energy` = bolt, `hp` = heart, `discard` = card-away, `exhaust` = flame. `ALL` means every enemy is hit. A plain-text face line is a unique mechanic.

Line counts are measured in a real browser by scripts/dev/viewport-check.mjs, at 360x640 and 320x568, both with 130% text. The limit is 3 lines; 4 lines at 320 is a fallback only.

| id | name | full sentence (aria-label, preview) | face lines | lines @360x640·130% | lines @320x568·130% |
|---|---|---|---|---|---|
| strike | Hammerfall | Deal 6 damage to the enemy. | [damage] 6 | 1 | 1 |
| defend | Quench | Gain 5 Block. | [block] 5 | 1 | 1 |
| bash | Anvil Blow | Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy — it takes 50% more damage from attacks. | [damage] 8 / [vulnerable] 2 | 2 | 2 |
| gust | Bellows Gust | Deal 4 damage to ALL enemies. | [damage] 4 ALL | 1 | 1 |
| fan_flames | Fan the Flames | Gain 1 Energy. Exhaust this card for the rest of the fight. | [energy] +1 / [exhaust]  | 2 | 2 |
| anger | Spark | Deal 5 damage to the enemy. | [damage] 5 | 1 | 1 |
| cleave | Arc Cut | Deal 4 damage to ALL enemies. | [damage] 4 ALL | 1 | 1 |
| clothesline | Collar Check | Deal 12 damage to the enemy. Apply 2 Weak to the enemy — its attacks deal 25% less damage. | [damage] 12 / [weak] 2 | 2 | 2 |
| headbutt | Brow Strike | Deal 9 damage to the enemy. | [damage] 9 | 1 | 1 |
| ironwave | Slag Surge | Gain 5 Block. Deal 5 damage to the enemy. | [block] 5 / [damage] 5 | 2 | 2 |
| pommel | Haft Jab | Deal 9 damage to the enemy. Draw 1 card. | [damage] 9 / [draw] 1 | 2 | 2 |
| sword_boomerang | Returning Brand | Deal 3 damage to ALL enemies. | [damage] 3 ALL | 1 | 1 |
| thunderclap | Forgeclap | Deal 4 damage to ALL enemies. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. | [damage] 4 ALL / [vulnerable] 1 | 2 | 2 |
| twin_strike | Twin Hammers | Deal 5 damage to the enemy 2 times. | [damage] 5×2 | 1 | 1 |
| wild_strike | Untempered | Deal 12 damage to the enemy. | [damage] 12 | 1 | 1 |
| flex | Bellows | Gain 2 Strength — your attacks deal 2 more damage. | [strength] 2 | 1 | 1 |
| shrug | Cast Aside | Gain 8 Block. Draw 1 card. | [block] 8 / [draw] 1 | 2 | 2 |
| true_grit | True Temper | Gain 7 Block. | [block] 7 | 1 | 1 |
| warcry | Kiln Cry | Draw 1 card. Discard 1 card at random. | [draw] 1 / [discard] 1 | 2 | 2 |
| armaments | Fit the Plate | Gain 5 Block. | [block] 5 | 1 | 1 |
| havoc | Vent | Draw 1 card. Gain 1 Energy. | [draw] 1 / [energy] +1 | 2 | 2 |
| battle_trance | Heat Trance | Draw 3 cards. | [draw] 3 | 1 | 1 |
| bloodletting | Vein Tap | Lose 3 HP. Gain 2 Energy. | [hp] -3 / [energy] +2 | 2 | 2 |
| carnage | Sunder | Deal 20 damage to the enemy. | [damage] 20 | 1 | 1 |
| combust | Banked Coal | Gain Combust: at the end of each turn, deal 1 damage to ALL enemies and lose 1 HP. | [damage] 1 ALL / [hp] -1 / "each turn" | 3 | 4 |
| dark_embrace | Ash Embrace | Gain Dark Embrace: whenever a card is exhausted, draw 1 card. | [exhaust] → / [draw] +1 | 2 | 2 |
| dropkick | Heel Drop | Deal 5 damage to the enemy. Gain 1 Energy. | [damage] 5 / [energy] +1 | 2 | 2 |
| entrench | Brace | Double your current Block. Does nothing if you have no Block. | [block] ×2 | 1 | 1 |
| feel_no_pain | Cinder Skin | Gain Feel No Pain: whenever a card is exhausted, gain 1 Block. | [exhaust] → / [block] +1 | 2 | 2 |
| flame_barrier | Flame Ward | Gain 12 Block. | [block] 12 | 1 | 1 |
| ghostly_armor | Cinder Shroud | Gain 10 Block. | [block] 10 | 1 | 1 |
| hemokinesis | Blood Hammer | Lose 2 HP. Deal 15 damage. | [damage] 15 / [hp] -2 | 2 | 2 |
| inflame | Stoke | Gain 2 Strength — your attacks deal 2 more damage. | [strength] 2 | 1 | 1 |
| metallicize | Scale Up | Gain 3 Metallicize — gain 3 Block at the end of each turn. | [metallicize] 3 | 1 | 1 |
| pummel | Hail of Blows | Deal 2 damage to the enemy 4 times. Exhaust this card for the rest of the fight. | [damage] 2×4 / [exhaust]  | 2 | 2 |
| rampage | Climbing Heat | Deal 8 damage. This card gains +5 damage permanently each time you play it. | [damage] 8 / "+5 each play" | 3 | 3 |
| rupture | Split Seam | Gain Rupture: whenever a card makes you lose HP, gain 1 Strength. | "HP lost:" / [strength] +1 | 2 | 2 |
| shockwave | Heat Wash | Apply 3 Weak to the enemy — its attacks deal 25% less damage. Apply 3 Vulnerable to the enemy — it takes 50% more damage from attacks. | [weak] 3 / [vulnerable] 3 | 2 | 2 |
| uppercut | Rising Blow | Deal 13 damage to the enemy. Apply 1 Weak to the enemy — its attacks deal 25% less damage. Apply 1 Vulnerable to the enemy — it takes 50% more damage from attacks. | [damage] 13 / [weak] 1 / [vulnerable] 1 | 3 | 3 |
| bludgeon | Maul | Deal 32 damage to the enemy. | [damage] 32 | 1 | 1 |
| impervious | Unbroken | Gain 30 Block. Exhaust this card for the rest of the fight. | [block] 30 / [exhaust]  | 2 | 2 |
| limit_break | Overtemper | Double your current Strength. Does nothing if you have no Strength. | [strength] ×2 | 1 | 1 |
| offering | Blood Tithe | Lose 6 HP. Gain 2 Energy. Draw 3 cards. | [hp] -6 / [energy] +2 / [draw] 3 | 3 | 3 |
| reaper | Ash Harvest | Deal 4 damage to ALL enemies. Heal HP equal to the damage dealt. | [damage] 4 ALL / "Heal that much" | 3 | 3 |

Over 3 lines at 320x568·130% (uses the 4-line fallback): combust. Over 3 lines at 360x640·130%: none.
