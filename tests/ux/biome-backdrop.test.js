// The stage backdrop is keyed off the kernel BIOMES table (review of #14).
//
// Pins: every biome names a backdrop that src/web/stage-art.js can draw; the Mines draws the
// painted tunnel and the Foundry the forge; stage-art keeps no biome ids of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO } from '../helpers/harness.mjs';
import { BIOMES } from '../../src/kernel/index.js';
import * as art from '../../src/web/stage-art.js';

test('every biome names a backdrop stage-art can draw', () => {
  assert.ok(art.BACKDROPS, 'stage-art exports BACKDROPS');
  for (const [id, b] of Object.entries(BIOMES)) {
    assert.equal(typeof b.backdrop, 'string', `${id} has a backdrop key`);
    assert.ok(art.BACKDROPS[b.backdrop], `${id}: backdrop ${b.backdrop} is drawn by stage-art`);
  }
});

test('the Mines draws the tunnel, the Foundry the forge', () => {
  assert.match(art.backdropMarkup(BIOMES.mines.backdrop), /mines\.webp/);
  assert.match(art.backdropMarkup(BIOMES.foundry.backdrop), /furnace\.webp/);
  assert.doesNotMatch(art.backdropMarkup(BIOMES.foundry.backdrop), /mines\.webp/);
});

test('stage-art keeps no biome ids of its own', () => {
  const src = readFileSync(resolve(REPO, 'src/web/stage-art.js'), 'utf8');
  assert.doesNotMatch(src, /'mines'|'foundry'/);
});
