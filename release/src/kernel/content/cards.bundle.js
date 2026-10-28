// GENERATED FILE — do not edit by hand. Run: node scripts/gen-content.mjs
//
// Source of truth: src/kernel/content/cards.json (the single source of card data).
// This module exists so the kernel can carry NO node:* builtin and therefore run
// unchanged in a browser. tests/content/bundle-drift.test.js re-reads cards.json in
// Node and deep-compares it against this object, so the two can never silently drift.

/** Parsed contents of src/kernel/content/cards.json. */
export const cardsBundle = {
  "contentVersion": "dlb-0.3.0-act1",
  "characters": {
    "ironclad": {
      "name": "Ashwright",
      "maxHp": 60,
      "startingDeck": [
        "strike",
        "strike",
        "strike",
        "strike",
        "strike",
        "defend",
        "defend",
        "defend",
        "defend",
        "bash"
      ],
      "startingRelic": "burning_blood",
      "relicName": "Kindled Heart"
    },
    "bellows": {
      "name": "Bellows Keeper",
      "maxHp": 54,
      "startingDeck": [
        "strike",
        "strike",
        "strike",
        "strike",
        "defend",
        "defend",
        "defend",
        "defend",
        "gust",
        "fan_flames"
      ],
      "startingRelic": "cyan_lantern",
      "relicName": "Cyan Lantern"
    }
  },
  "cards": [
    {
      "id": "strike",
      "name": "Hammerfall",
      "cost": 1,
      "type": "attack",
      "rarity": "starter",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 6
        }
      ],
      "flavor": "The first lesson of the forge: hit it until it yields."
    },
    {
      "id": "defend",
      "name": "Quench",
      "cost": 1,
      "type": "skill",
      "rarity": "starter",
      "target": "none",
      "effects": [
        {
          "verb": "block",
          "amount": 5
        }
      ],
      "flavor": "Cool iron holds."
    },
    {
      "id": "bash",
      "name": "Anvil Blow",
      "cost": 2,
      "type": "attack",
      "rarity": "starter",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 8
        },
        {
          "verb": "status",
          "status": "vulnerable",
          "amount": 2,
          "to": "enemy"
        }
      ],
      "flavor": "The anvil answers louder than the hammer."
    },
    {
      "id": "gust",
      "name": "Bellows Gust",
      "cost": 1,
      "type": "attack",
      "rarity": "starter",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 4,
          "target": "all_enemies"
        }
      ],
      "flavor": "One long breath across the coals.",
      "hero": "bellows"
    },
    {
      "id": "fan_flames",
      "name": "Fan the Flames",
      "cost": 0,
      "type": "skill",
      "rarity": "starter",
      "target": "none",
      "effects": [
        {
          "verb": "energy",
          "amount": 1
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Work the leather and the fire leans in.",
      "hero": "bellows"
    },
    {
      "id": "anger",
      "name": "Spark",
      "cost": 0,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 5
        }
      ],
      "flavor": "A small heat, spent at once."
    },
    {
      "id": "cleave",
      "name": "Arc Cut",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 4,
          "target": "all_enemies"
        }
      ],
      "flavor": "One swing, every face in the fire."
    },
    {
      "id": "clothesline",
      "name": "Collar Check",
      "cost": 2,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 12
        },
        {
          "verb": "status",
          "status": "weak",
          "amount": 2,
          "to": "enemy"
        }
      ],
      "flavor": "The jaw meets the haft."
    },
    {
      "id": "headbutt",
      "name": "Brow Strike",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 9
        }
      ],
      "flavor": "The helm does the talking."
    },
    {
      "id": "ironwave",
      "name": "Slag Surge",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "block",
          "amount": 5
        },
        {
          "verb": "damage",
          "amount": 5
        }
      ],
      "flavor": "A wall of cooling metal, then the follow-through."
    },
    {
      "id": "pommel",
      "name": "Haft Jab",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 9
        },
        {
          "verb": "draw",
          "amount": 1
        }
      ],
      "flavor": "The blunt end still counts."
    },
    {
      "id": "sword_boomerang",
      "name": "Returning Brand",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "random_enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 3,
          "target": "all_enemies"
        }
      ],
      "flavor": "Heat you threw comes back."
    },
    {
      "id": "thunderclap",
      "name": "Forgeclap",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 4,
          "target": "all_enemies"
        },
        {
          "verb": "status",
          "status": "vulnerable",
          "amount": 1,
          "to": "enemy"
        }
      ],
      "flavor": "The whole shop flinches."
    },
    {
      "id": "twin_strike",
      "name": "Twin Hammers",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 5
        },
        {
          "verb": "damage",
          "amount": 5
        }
      ],
      "flavor": "Left, then right, before the glow fades."
    },
    {
      "id": "wild_strike",
      "name": "Untempered",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 12
        }
      ],
      "flavor": "No form. All weight."
    },
    {
      "id": "flex",
      "name": "Bellows",
      "cost": 0,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "strength",
          "amount": 2,
          "to": "self"
        }
      ],
      "flavor": "Work the lungs of the forge."
    },
    {
      "id": "shrug",
      "name": "Cast Aside",
      "cost": 1,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 8
        },
        {
          "verb": "draw",
          "amount": 1
        }
      ],
      "flavor": "The blow slides off the pauldron."
    },
    {
      "id": "true_grit",
      "name": "True Temper",
      "cost": 1,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 7
        }
      ],
      "flavor": "Hold the heat. Do not flinch."
    },
    {
      "id": "warcry",
      "name": "Kiln Cry",
      "cost": 0,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "draw",
          "amount": 1
        },
        {
          "verb": "discard",
          "amount": 1
        }
      ],
      "flavor": "The furnace answers."
    },
    {
      "id": "armaments",
      "name": "Fit the Plate",
      "cost": 1,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 5
        }
      ],
      "flavor": "Strap on what the climb still owes you."
    },
    {
      "id": "havoc",
      "name": "Vent",
      "cost": 1,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "draw",
          "amount": 1
        },
        {
          "verb": "energy",
          "amount": 1
        }
      ],
      "flavor": "Open the flue. The room fills with work."
    },
    {
      "id": "battle_trance",
      "name": "Heat Trance",
      "cost": 0,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "draw",
          "amount": 3
        }
      ],
      "flavor": "The world narrows to the next swing."
    },
    {
      "id": "bloodletting",
      "name": "Vein Tap",
      "cost": 0,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "bloodletting"
        }
      ],
      "flavor": "Pay in blood. Take the breath back."
    },
    {
      "id": "carnage",
      "name": "Sunder",
      "cost": 2,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 20
        }
      ],
      "flavor": "Too much hammer for one body."
    },
    {
      "id": "combust",
      "name": "Banked Coal",
      "cost": 1,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "combust"
        }
      ],
      "flavor": "Leave a coal in the grate. It works while you do."
    },
    {
      "id": "dark_embrace",
      "name": "Ash Embrace",
      "cost": 2,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "dark_embrace"
        }
      ],
      "flavor": "What burns away still warms the hands."
    },
    {
      "id": "dropkick",
      "name": "Heel Drop",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 5
        },
        {
          "verb": "energy",
          "amount": 1
        }
      ],
      "flavor": "The boot comes down where the hammer cannot."
    },
    {
      "id": "entrench",
      "name": "Brace",
      "cost": 2,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "entrench"
        }
      ],
      "flavor": "Set your feet in the clinker."
    },
    {
      "id": "feel_no_pain",
      "name": "Cinder Skin",
      "cost": 1,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "feel_no_pain"
        }
      ],
      "flavor": "The burn stops meaning anything."
    },
    {
      "id": "flame_barrier",
      "name": "Flame Ward",
      "cost": 2,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 12
        }
      ],
      "flavor": "A curtain of fire that bites back."
    },
    {
      "id": "ghostly_armor",
      "name": "Cinder Shroud",
      "cost": 1,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 10
        }
      ],
      "flavor": "Ash remembers the shape of armor."
    },
    {
      "id": "hemokinesis",
      "name": "Blood Hammer",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "custom",
          "handler": "hemokinesis"
        }
      ],
      "flavor": "The swing costs a little of you."
    },
    {
      "id": "inflame",
      "name": "Stoke",
      "cost": 1,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "strength",
          "amount": 2,
          "to": "self"
        }
      ],
      "flavor": "Feed the fire in the arm."
    },
    {
      "id": "metallicize",
      "name": "Scale Up",
      "cost": 1,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "metallicize",
          "amount": 3,
          "to": "self"
        }
      ],
      "flavor": "Plates knit between blows."
    },
    {
      "id": "pummel",
      "name": "Hail of Blows",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 2
        },
        {
          "verb": "damage",
          "amount": 2
        },
        {
          "verb": "damage",
          "amount": 2
        },
        {
          "verb": "damage",
          "amount": 2
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Four short strikes, then nothing left."
    },
    {
      "id": "rampage",
      "name": "Climbing Heat",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "custom",
          "handler": "rampage"
        }
      ],
      "flavor": "Each swing teaches the next."
    },
    {
      "id": "rupture",
      "name": "Split Seam",
      "cost": 1,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "rupture"
        }
      ],
      "flavor": "When you bleed, the hammer gets heavier."
    },
    {
      "id": "shockwave",
      "name": "Heat Wash",
      "cost": 2,
      "type": "skill",
      "rarity": "uncommon",
      "target": "all",
      "effects": [
        {
          "verb": "status",
          "status": "weak",
          "amount": 3,
          "to": "enemy"
        },
        {
          "verb": "status",
          "status": "vulnerable",
          "amount": 3,
          "to": "enemy"
        }
      ],
      "flavor": "A wave that leaves them open and weak."
    },
    {
      "id": "uppercut",
      "name": "Rising Blow",
      "cost": 2,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 13
        },
        {
          "verb": "status",
          "status": "weak",
          "amount": 1,
          "to": "enemy"
        },
        {
          "verb": "status",
          "status": "vulnerable",
          "amount": 1,
          "to": "enemy"
        }
      ],
      "flavor": "Up from the floor of the furnace."
    },
    {
      "id": "bludgeon",
      "name": "Maul",
      "cost": 3,
      "type": "attack",
      "rarity": "rare",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 32
        }
      ],
      "flavor": "One stroke. The argument ends."
    },
    {
      "id": "impervious",
      "name": "Unbroken",
      "cost": 2,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 30
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Nothing gets through. Then the plate is spent."
    },
    {
      "id": "limit_break",
      "name": "Overtemper",
      "cost": 1,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "limit_break"
        }
      ],
      "flavor": "Past the point the metal was meant to hold."
    },
    {
      "id": "offering",
      "name": "Blood Tithe",
      "cost": 0,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "custom",
          "handler": "offering"
        }
      ],
      "flavor": "Feed the kiln. It pays you back in breath and cards."
    },
    {
      "id": "reaper",
      "name": "Ash Harvest",
      "cost": 2,
      "type": "attack",
      "rarity": "rare",
      "target": "all",
      "effects": [
        {
          "verb": "custom",
          "handler": "reaper"
        }
      ],
      "flavor": "What you cut comes back as heat in the chest."
    },
    {
      "id": "cinder_flick",
      "name": "Cinder Flick",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 3,
          "hits": 3
        }
      ],
      "flavor": "Three sparks before the iron knows it has been hit."
    },
    {
      "id": "heavy_swing",
      "name": "Heavy Swing",
      "cost": 2,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 14
        }
      ],
      "flavor": "Both hands. All shoulder. No apology."
    },
    {
      "id": "kindled_blade",
      "name": "Kindled Blade",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 7
        },
        {
          "verb": "retain"
        }
      ],
      "flavor": "It never quite leaves your grip."
    },
    {
      "id": "slag_shrapnel",
      "name": "Slag Shrapnel",
      "cost": 1,
      "type": "attack",
      "rarity": "common",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 2,
          "hits": 4
        }
      ],
      "flavor": "The wheel throws sparks; you throw worse."
    },
    {
      "id": "scrap_shield",
      "name": "Scrap Shield",
      "cost": 0,
      "type": "skill",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 4
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Off-cuts hold a blow. Once."
    },
    {
      "id": "bellows_work",
      "name": "Bellows Work",
      "cost": 1,
      "type": "power",
      "rarity": "common",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "dexterity",
          "amount": 1,
          "to": "self"
        }
      ],
      "flavor": "A steady draw makes steady hands."
    },
    {
      "id": "forge_stance",
      "name": "Forge Stance",
      "cost": 1,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "dexterity",
          "amount": 2,
          "to": "self"
        }
      ],
      "flavor": "Feet like anvils. Hands like water."
    },
    {
      "id": "ember_ward",
      "name": "Ember Ward",
      "cost": 2,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 14
        },
        {
          "verb": "retain"
        }
      ],
      "flavor": "Hold the glow. It holds you."
    },
    {
      "id": "tallow_rub",
      "name": "Tallow Rub",
      "cost": 1,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "heal",
          "amount": 6
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Old smoke, new skin."
    },
    {
      "id": "forge_rhythm",
      "name": "Forge Rhythm",
      "cost": 1,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "draw",
          "amount": 2
        },
        {
          "verb": "discard",
          "amount": 1
        }
      ],
      "flavor": "Strike, turn, strike — the beat does the work."
    },
    {
      "id": "slag_wall",
      "name": "Slag Wall",
      "cost": 2,
      "type": "skill",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 16
        }
      ],
      "flavor": "Pour it cool and stand behind it."
    },
    {
      "id": "cinder_storm",
      "name": "Cinder Storm",
      "cost": 2,
      "type": "attack",
      "rarity": "uncommon",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 3,
          "hits": 4,
          "target": "all_enemies"
        }
      ],
      "flavor": "The draft turns and everyone is downwind."
    },
    {
      "id": "anvil_rain",
      "name": "Anvil Rain",
      "cost": 2,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 6,
          "hits": 3
        }
      ],
      "flavor": "What goes up quenched comes down angry."
    },
    {
      "id": "pressure_spike",
      "name": "Pressure Spike",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 9
        },
        {
          "verb": "energy",
          "amount": 1
        }
      ],
      "flavor": "Vent the chamber through the target."
    },
    {
      "id": "weight_of_iron",
      "name": "Weight of Iron",
      "cost": 2,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 12
        },
        {
          "verb": "status",
          "status": "weak",
          "amount": 2,
          "to": "enemy"
        }
      ],
      "flavor": "Heavy things argue best."
    },
    {
      "id": "tempered_strike",
      "name": "Tempered Strike",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 6
        },
        {
          "verb": "block",
          "amount": 6
        }
      ],
      "flavor": "Quenched at the edge, hard at the face."
    },
    {
      "id": "seam_finder",
      "name": "Seam Finder",
      "cost": 1,
      "type": "attack",
      "rarity": "uncommon",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 4,
          "hits": 3
        },
        {
          "verb": "status",
          "status": "vulnerable",
          "amount": 1,
          "to": "enemy"
        }
      ],
      "flavor": "Every casting has one. Find it."
    },
    {
      "id": "furnace_heart",
      "name": "Furnace Heart",
      "cost": 2,
      "type": "power",
      "rarity": "uncommon",
      "target": "self",
      "effects": [
        {
          "verb": "status",
          "status": "strength",
          "amount": 3,
          "to": "self"
        }
      ],
      "flavor": "It does not beat. It roars."
    },
    {
      "id": "kiln_wrath",
      "name": "Kiln Wrath",
      "cost": 3,
      "type": "attack",
      "rarity": "rare",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 12,
          "hits": 3
        }
      ],
      "flavor": "The whole kiln, delivered at once."
    },
    {
      "id": "great_pyre",
      "name": "Great Pyre",
      "cost": 2,
      "type": "attack",
      "rarity": "rare",
      "target": "enemy",
      "effects": [
        {
          "verb": "damage",
          "amount": 18
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Build it tall. Walk away."
    },
    {
      "id": "ember_tide",
      "name": "Ember Tide",
      "cost": 2,
      "type": "attack",
      "rarity": "rare",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 5,
          "hits": 4,
          "target": "all_enemies"
        }
      ],
      "flavor": "Open every grate at once."
    },
    {
      "id": "pyre_feast",
      "name": "Pyre Feast",
      "cost": 2,
      "type": "attack",
      "rarity": "rare",
      "target": "all",
      "effects": [
        {
          "verb": "damage",
          "amount": 8,
          "target": "all_enemies"
        },
        {
          "verb": "heal",
          "amount": 5
        }
      ],
      "flavor": "The fire eats. You eat first."
    },
    {
      "id": "blaze_bellows",
      "name": "Blaze Bellows",
      "cost": 1,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "energy",
          "amount": 2
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "One great heave and the room is white."
    },
    {
      "id": "rekindle",
      "name": "Rekindle",
      "cost": 2,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "heal",
          "amount": 10
        },
        {
          "verb": "draw",
          "amount": 2
        },
        {
          "verb": "exhaust"
        }
      ],
      "flavor": "Bank the coals. Breathe. Begin again."
    },
    {
      "id": "hearth_stand",
      "name": "Hearth Stand",
      "cost": 3,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "block",
          "amount": 20
        },
        {
          "verb": "retain"
        }
      ],
      "flavor": "The last stand is taken at the hearth."
    },
    {
      "id": "forge_flood",
      "name": "Forge Flood",
      "cost": 2,
      "type": "skill",
      "rarity": "rare",
      "target": "self",
      "effects": [
        {
          "verb": "draw",
          "amount": 3
        },
        {
          "verb": "energy",
          "amount": 1
        }
      ],
      "flavor": "Open the sluice. Let the work pour."
    }
  ],
  "statuses": {
    "strength": {
      "name": "PWR",
      "decays": false,
      "kind": "buff"
    },
    "vulnerable": {
      "name": "VULN",
      "decays": true,
      "kind": "debuff"
    },
    "weak": {
      "name": "WK",
      "decays": true,
      "kind": "debuff"
    },
    "dexterity": {
      "name": "DEX",
      "decays": false,
      "kind": "buff"
    },
    "metallicize": {
      "name": "METAL",
      "decays": false,
      "kind": "buff"
    }
  }
};
