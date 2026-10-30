// S4 shop: the node, the phase, the wares, the removal service, and the way out.
//
// Pins:
//   - Exactly ONE shop node per generated act run, at row 5's middle slot, reachable
//     from the entry on every seed (UX-6 weave: from the feeder lanes r4n0/r4n1 —
//     NOT from r4n2, whose lane band is {r5n2} alone; the vendor is now
//     route-conditional by design), labelled through NODE_TYPES like any other node.
//     Its encounter-table entry spawns nothing and consumes no draw.
//   - Inventory and prices roll at ENTRY time from the live counter: a full inventory
//     is exactly 10 draws (one pickAt pick + one price roll per offer). Same seed =>
//     same shelves; offers come from the run's OWN narrowed draft pool, never repeat,
//     and never include starters (the pool excludes them by construction).
//   - Prices sit in the StS-like rarity bands, one draw per price; an unknown rarity
//     is priced on the common band.
//   - Buying deducts immediately and appends a real deck instance; the offer is sold
//     and cannot be bought twice. An offer the purse cannot cover is NOT an action
//     (R6, like an unaffordable card play) — submitting its id anyway is the one R6
//     rejection path. Many buys, then ONE leave; leaving is final.
//   - The removal service is one per visit at a flat 75: paying it opens a modal
//     removal step whose only actions are the deck's instances (`x<n>`, uid-precise);
//     the pick removes exactly one copy and returns to the shelves. A deck of one
//     card can never shrink further (hard invariant).
//   - A pre-shop save (no `state.shop`, a map with no shop node) loads and plays with
//     the shop phase never occurring; a shop in a save must carry sane prices; and a
//     negative purse is refused (S3 review P3, exercised where it bites — spending).
//   - A real run that walks into the shop, buys, and leaves replays hash-for-hash
//     through the same log machinery every other run does.
//   S4.1 review fixes:
//   - a validate-accepted save with no player.gold (optional field) standing in a shop
//     buys onto an EMPTY purse — 0, never NaN (which made hash()/serializeSave throw);
//   - a torn shop (the field absent or null) enumerates only the leave — the service
//     id is not a legal no-op against the handler's own guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, content as contentFixture } from '../helpers/harness.mjs';
import { begin, submit, legal, saveObject, loadObject, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';
import { PRICE_BANDS, REMOVAL_PRICE, SHOP_OFFERS, priceFor, rollShopInventory } from '../../src/kernel/rules/shop.js';
import { SHOP_ROW, SHOP_SLOT, NODE_TYPES } from '../../src/kernel/rules/map.js';

const K = await loadKernel();
const { newRun, step, actions, observe, snapshot, hash, validateSave } = K;
const C = await contentFixture();

/** Walk a fresh run to row 4, then open the shop through the public step.
 *  `over` patches the pre-travel state (gold, deck, ...) the way gold.test does. */
function shopVisit(seed, over = {}) {
  const base = newRun({ seed });
  const staged = {
    ...base,
    floor: 4,
    mapNodeId: 'r4n0',
    player: { ...base.player, ...(over.player ?? {}) },
    ...(over.state ?? {}),
  };
  const travel = actions(staged).find((a) => a.nodeType === 'shop');
  assert.ok(travel, 'the shop node is travel-legal from row 4');
  const out = step(staged, travel.id);
  assert.equal(out.error, null);
  return out.state;
}

test('every generated act map holds exactly one shop, at row 5, reachable from its feeder lanes', () => {
  // Reachability from the entry (BFS over the stored edges) — the weave's guarantee.
  const reachable = (rows) => {
    const seen = new Set(rows[0].map((n) => n.id));
    for (let r = 1; r < rows.length; r += 1) {
      for (const node of rows[r]) {
        if (rows[r - 1].some((prev) => seen.has(prev.id) && prev.next.includes(node.id))) seen.add(node.id);
      }
    }
    return seen;
  };
  for (let seed = 0; seed < 60; seed += 1) {
    const s = newRun({ seed });
    const shops = s.map.rows.flat().filter((n) => n.type === 'shop');
    assert.equal(shops.length, 1, `seed ${seed}: exactly one shop node`);
    assert.equal(shops[0].id, `r${SHOP_ROW}n${SHOP_SLOT}`, `seed ${seed}: the shop is row 5's middle slot`);
    // Reachable on every seed — from the FEEDER LANES, not from all of row 4: under
    // the weave node 0 → {0,1} and node 1 → {1,2}, so r4n0 and r4n1 link to r5n1
    // while r4n2's lane is {r5n2} alone. The vendor is route-conditional by design
    // (the S4-era "every row-4 node links to the shop" pin is superseded — that
    // full-row linking was exactly the "no choice ever blocks anything" shape UX-6
    // replaced).
    const seen = reachable(s.map.rows);
    assert.ok(seen.has(shops[0].id), `seed ${seed}: the shop is reachable from the entry`);
    const feeders = s.map.rows[SHOP_ROW - 1].filter((n) => n.next.includes(shops[0].id)).map((n) => n.id);
    assert.deepEqual(feeders.sort(), ['r4n0', 'r4n1'], `seed ${seed}: the shop's feeder lanes are r4n0/r4n1`);
    // And no other row grew a shop.
    assert.equal(s.map.rows[SHOP_ROW].filter((n) => n.type === 'shop').length, 1);
  }
  // The node type is labelled like any other: the CLI map dump and the snapshot map
  // both read NODE_TYPES[n.type].label.
  assert.equal(NODE_TYPES.shop.label, 'shop');
  const snapMap = snapshot(newRun({ seed: 1 })).map;
  const shopNode = snapMap.rows[SHOP_ROW].find((n) => n.type === 'shop');
  assert.equal(shopNode.label, 'shop');
  assert.ok(!shopNode.available, 'row 5 is not available at run start');
});

test('the shop opens from a real travel step, its table spawns nothing, and the dump shows prices', () => {
  const s = shopVisit(3);
  assert.equal(s.phase, 'shop');
  assert.equal(s.mapNodeId, `r${SHOP_ROW}n${SHOP_SLOT}`);
  const entry = s.map.encounterTable[s.mapNodeId];
  assert.deepEqual(entry.spawn, [], 'the vendor keeps no enemies');
  assert.equal(entry.reward, 'shop');
  const dump = observe(s);
  assert.match(dump, /SHOP — spend or move on/);
  assert.match(dump, / b1 .+ \d+g/);
  assert.match(dump, / x remove a card — 75g/);
  assert.match(dump, / l leave \(purse \d+\)/);
  // The action lines stay name-only (price lives in the dump, same ruling as Energy).
  const kinds = actions(s).map((a) => a.kind);
  assert.ok(kinds.includes('shop_removal') && kinds.includes('shop_leave'));
});

test('inventory: deterministic, pool-bounded, duplicate-free, exactly 2 draws per offer', () => {
  const a = shopVisit(11);
  const b = shopVisit(11);
  assert.deepEqual(a.shop.offers, b.shop.offers, 'same seed => same shelves');
  assert.ok(a.shop.offers.length > 0 && a.shop.offers.length <= SHOP_OFFERS);

  // Entry drew exactly 2 draws per offer (one pick + one price); a full inventory
  // from the ~65-card default pool is exactly 10.
  const pre = { ...newRun({ seed: 11 }), floor: 4, mapNodeId: 'r4n0' };
  assert.equal(a.rngDraws - pre.rngDraws, 2 * a.shop.offers.length, `entry consumed exactly ${2 * a.shop.offers.length} draws`);

  const pool = new Set(newRun({ seed: 11 }).draftPool);
  const seen = new Set();
  for (const o of a.shop.offers) {
    assert.ok(pool.has(o.cardId), `${o.cardId} comes from the run's own draft pool`);
    assert.ok(!seen.has(o.cardId), `${o.cardId} is offered once`);
    seen.add(o.cardId);
    const def = C.cards.get(o.cardId);
    assert.notEqual(def.rarity, 'starter', 'starters are never on the shelves');
    const [lo, hi] = PRICE_BANDS[def.rarity] ?? PRICE_BANDS.common;
    assert.ok(o.price >= lo && o.price <= hi, `${o.cardId} (${def.rarity}) priced ${o.price} in [${lo}, ${hi}]`);
  }

  // The whole inventory re-rolls byte-identically from the pre-entry counter — the
  // property that makes entry-time rolls replayable from the action log forever.
  const rerolled = rollShopInventory({ ...a, rngDraws: a.rngDraws - 2 * a.shop.offers.length }, C.cards);
  assert.deepEqual(rerolled.offers, a.shop.offers);
});

test('prices cover the band across seeds, and an unknown rarity lands on the common band', () => {
  const seenByRarity = new Map(Object.keys(PRICE_BANDS).map((r) => [r, new Set()]));
  for (let seed = 0; seed < 40; seed += 1) {
    const s = shopVisit(seed, { player: { gold: 999 } });
    for (const o of s.shop.offers) {
      const def = C.cards.get(o.cardId);
      const band = PRICE_BANDS[def.rarity] ?? PRICE_BANDS.common;
      assert.ok(o.price >= band[0] && o.price <= band[1], `${def.rarity} ${o.price} in [${band[0]}, ${band[1]}]`);
      seenByRarity.get(def.rarity)?.add(o.price);
    }
  }
  // The bands are ranges, not constants: 40 seeds must spread inside each rarity.
  for (const [rarity, seen] of seenByRarity) {
    assert.ok(seen.size >= 3, `rarity ${rarity} spread across its band (saw ${[...seen].sort((x, y) => x - y).join(', ')})`);
  }
  // Deterministic, and the unknown-rarity fallback never overcharges.
  assert.equal(priceFor('common', 7, 100), priceFor('common', 7, 100));
  const [clo, chi] = PRICE_BANDS.common;
  const weird = priceFor('mythic', 7, 100);
  assert.ok(weird >= clo && weird <= chi, 'an unknown rarity is priced as a common');
});

test('buying: gold moves by exactly the price, the deck gains an instance, the slot sells out', () => {
  let s = shopVisit(3, { player: { gold: 500 } });
  const purse0 = s.player.gold;
  const deck0 = s.deck.length;
  const offer = s.shop.offers[0];
  const buy = actions(s).find((a) => a.kind === 'shop_buy');
  assert.equal(buy.price, offer.price);
  s = step(s, buy.id).state;
  assert.equal(s.player.gold, purse0 - offer.price, 'the price left the purse');
  assert.equal(s.deck.length, deck0 + 1, 'the deck grew by the bought instance');
  assert.equal(s.deck.at(-1).cardId, offer.cardId);
  assert.equal(s.shop.offers[0].sold, true, 'the slot is sold');
  // The sold slot emits no action; the OTHERS still do (many buys, one leave — StS parity).
  assert.equal(actions(s).find((a) => a.kind === 'shop_buy' && a.index === 0), undefined, 'a sold slot is not an action');
  assert.ok(actions(s).some((a) => a.kind === 'shop_buy'), 'the rest of the shelves stay open');
  assert.ok(actions(s).some((a) => a.kind === 'shop_leave'), 'and leaving waits for the player');
  // A full buy-out of everything affordable, then one leave.
  for (let g = 0; g < 10; g += 1) {
    const next = actions(s).find((a) => a.kind === 'shop_buy');
    if (!next) break;
    s = step(s, next.id).state;
  }
  assert.ok(!actions(s).some((a) => a.kind === 'shop_buy'), 'the affordable shelves are empty');
  assert.ok(s.shop.offers.some((o) => o.sold));
  s = step(s, 'l').state;
  assert.equal(s.phase, 'map');
});

test('afford-filter: an offer above the purse is not an action, and its id is the R6 rejection', () => {
  const s = shopVisit(3, { player: { gold: 10 } });
  const purse = s.player.gold;
  for (const o of s.shop.offers) {
    assert.ok(o.price > purse, 'fixture: every offer exceeds the purse');
  }
  // With 10 gold nothing is buyable: no b<n>, no service (75) — only the way out.
  assert.deepEqual(actions(s).map((a) => a.id), ['l']);
  // And forcing the id is the ONE rejection path: a legal no-op with the structured error.
  const out = step(s, 'b1');
  assert.equal(out.state, s, 'a rejected buy does not move the state');
  assert.equal(out.error?.code, 2);
  assert.equal(out.error?.error, 'illegal_action');
});

test('the removal service: pay 75, pick one uid-precise instance, land back on the shelves', () => {
  let s = shopVisit(3, { player: { gold: 300 } });
  const purse0 = s.player.gold;
  const deck0 = [...s.deck];
  assert.equal(actions(s).find((a) => a.kind === 'shop_removal').price, REMOVAL_PRICE);
  s = step(s, 'x').state;
  assert.equal(s.player.gold, purse0 - REMOVAL_PRICE, 'the flat price left the purse');
  assert.equal(s.shop.removal.sold, true);
  assert.equal(s.shop.removing, true);

  // MODAL: while the pick is owed, the ONLY actions are the deck's instances.
  let L = actions(s);
  assert.equal(L.length, s.deck.length, 'one action per deck instance');
  assert.ok(L.every((a) => a.kind === 'shop_remove_pick'), 'no buying, no leaving mid-removal');
  assert.deepEqual(L.map((a) => a.id), s.deck.map((_, i) => `x${i + 1}`));

  // uid-precise: remove ONE copy of a duplicated card; its uid is gone, its siblings stay.
  const dup = s.deck
    .map((inst, i) => ({ inst, i }))
    .find((x) => s.deck.filter((y) => y.cardId === x.inst.cardId).length > 1);
  assert.ok(dup, 'fixture: the starting deck holds duplicates');
  const copies = deck0.filter((c) => c.cardId === dup.inst.cardId).length;
  s = step(s, `x${dup.i + 1}`).state;
  assert.equal(s.deck.length, deck0.length - 1);
  assert.ok(!s.deck.some((c) => c.uid === dup.inst.uid), 'the chosen instance left the deck');
  assert.equal(s.deck.filter((c) => c.cardId === dup.inst.cardId).length, copies - 1, 'its siblings stayed');
  assert.equal(s.shop.removing, false);
  assert.equal(s.shop.removal.done, true);
  assert.equal(s.shop.removal.sold, true);

  // Back on the shelves: buys and the leave exist again, the service does not.
  L = actions(s);
  assert.ok(L.some((a) => a.kind === 'shop_buy'));
  assert.ok(L.some((a) => a.kind === 'shop_leave'));
  assert.ok(!L.some((a) => a.kind === 'shop_removal'), 'one removal per visit');
  s = step(s, 'l').state;
  assert.equal(s.phase, 'map');
});

test('the deck-of-one invariant: no service is sold, and the pick handler refuses anyway', () => {
  // The action space is honest first: a deck of exactly 1 never gets an `x`.
  const lone = shopVisit(3, { state: { deck: [{ uid: 'last', cardId: 'strike' }] }, player: { gold: 300 } });
  assert.ok(!actions(lone).some((a) => a.kind === 'shop_removal'), 'a one-card deck cannot buy removal');
  // And the handler — the one place the deck shrinks — holds the line regardless of
  // how a pick is reached (the step is legal in removing mode; the removal is not).
  const paid = { ...lone, shop: { ...lone.shop, removal: { ...lone.shop.removal, sold: true }, removing: true } };
  assert.ok(actions(paid).some((a) => a.id === 'x1'), 'removing mode enumerates even a lone card');
  const out = step(paid, 'x1');
  assert.equal(out.error, null);
  assert.equal(out.state.deck.length, 1, 'the last card cannot be removed');
  assert.equal(out.state.shop.removing, true, 'the pick did not settle — the step is still owed');
});

test('leaving is final: the room closes, the node is consumed, the run moves on', () => {
  let s = shopVisit(3);
  s = step(s, 'l').state;
  assert.equal(s.phase, 'map');
  assert.equal(s.shop, null, 'the shop state closed with the room');
  // The node sits in floor 4's wake; travel continues to the NEXT row (row 6: the
  // rest pair and the elite, ahead of the boss row).
  const L = actions(s);
  assert.ok(L.every((a) => a.kind === 'travel'), 'back on the map');
  assert.ok(L.every((a) => a.nodeType !== 'shop'), `row 6 awaits: ${L.map((a) => a.nodeType).join(',')}`);
  s = step(s, L[0].id).state;
  assert.notEqual(s.phase, 'shop', 'the run continues past the shop');
});

test('a pre-shop legacy save loads, plays, and never meets the shop phase', () => {
  // What a pre-S4 save looks like: no `state.shop` field, and a stored map whose row 5
  // holds only the old pool types (its encounter table still serves that combat node).
  let session = begin({ seed: 7 });
  const save = JSON.parse(JSON.stringify(saveObject(session)));
  delete save.state.shop;
  save.state.map.rows = save.state.map.rows.map((row) => row.map((n) => (n.type === 'shop' ? { ...n, type: 'combat_strong' } : n)));
  assert.deepEqual(validateSave(save), [], `a legacy save still validates: ${JSON.stringify(validateSave(save))}`);
  const res = loadObject(save);
  assert.equal(res.ok, true, `the legacy save loads: ${JSON.stringify(res.problems ?? [])}`);
  session = res.session;
  assert.equal(session.state.shop, undefined);
  // It plays: no shop node is ever travel-legal, no shop action ever exists.
  let sawShop = false;
  for (let g = 0; g < 30 && session.state.phase !== 'ended'; g += 1) {
    const L = legal(session);
    if (L.some((a) => a.nodeType === 'shop') || L.some((a) => a.kind.startsWith('shop_'))) sawShop = true;
    const pick = L.find((a) => a.kind === 'travel') ?? L[0];
    session = submit(session, pick.id).session;
  }
  assert.equal(sawShop, false, 'the shop phase never occurs on a legacy map');
  assert.notEqual(session.state.phase, 'shop');
});

test('a save carrying a shop must be sane: negative prices are refused, honest ones load', () => {
  const inShop = shopVisit(3);
  const blank = JSON.parse(JSON.stringify(saveObject(begin({ seed: 3 }))));
  // A shop save round-trips (loadObject uses raw.state; the outer fields only feed replay).
  const honest = JSON.parse(JSON.stringify({ ...blank, state: inShop, actions: [{ act: 'n2' }] }));
  assert.deepEqual(validateSave(honest), [], `an honest shop save validates: ${JSON.stringify(validateSave(honest))}`);
  assert.equal(loadObject(honest).ok, true);
  // A negative offer price would PAY the purse on purchase — refused.
  const tampered = JSON.parse(JSON.stringify(honest));
  tampered.state.shop.offers[0].price = -20;
  assert.ok(validateSave(tampered).some((p) => p.includes('offers[0]')), 'validateSave names the bad price');
  assert.equal(loadObject(tampered).ok, false, 'a tampered shelf does not load');
  // So is a negative service price.
  const tampered2 = JSON.parse(JSON.stringify(honest));
  tampered2.state.shop.removal.price = -1;
  assert.ok(validateSave(tampered2).some((p) => p.includes('removal.price')));
});

test('the shop ride replays: same action list, same hashes, gold and all', () => {
  const drive = () => {
    let s = shopVisit(5, { player: { gold: 400 } });
    const hashes = [hash(s)];
    s = step(s, actions(s).find((a) => a.kind === 'shop_buy').id).state;
    hashes.push(hash(s));
    s = step(s, 'x').state;
    hashes.push(hash(s));
    s = step(s, 'x3').state;
    hashes.push(hash(s));
    s = step(s, 'l').state;
    hashes.push(hash(s));
    return hashes;
  };
  assert.deepEqual(drive(), drive(), 'enter, buy, pay, remove, leave — identical every time');
});

test('a real run that enters the shop, buys, and leaves replays hash-for-hash', () => {
  // greedy everywhere EXCEPT: at floor 4 it must take the shop (its routing ranks the
  // shop last, which is exactly what a purchase-less bot should do the rest of the
  // time), and inside the shop it buys the cheapest affordable shelf before leaving.
  // The full action list is legal from a bare newRun(header), so the log replays.
  const driver = (seed) => {
    const greedy = makePolicy('greedy');
    let session = begin({ seed });
    const memory = {};
    for (let guard = 0; guard < 3000; guard += 1) {
      const st = session.state;
      if (st.phase === 'ended') break;
      const L = legal(session);
      let id;
      if (st.phase === 'map' && st.floor === 4) {
        id = (L.find((a) => a.nodeType === 'shop')?.id ?? greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id);
      } else if (st.phase === 'shop') {
        const cheapest = L.filter((a) => a.kind === 'shop_buy').sort((x, y) => x.price - y.price)[0];
        id = cheapest?.id ?? L.find((a) => a.kind === 'shop_leave')?.id;
      } else {
        id = greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id;
      }
      if (id == null) break;
      session = submit(session, id).session;
      // Bought, left, moved on: stop the walk on the row the shop's exits face.
      if (session.state.phase === 'map' && session.state.floor === 5) break;
    }
    return session;
  };
  // Find a seed that survives to row 4 (greedy usually does), visits, and buys.
  let session = null;
  for (let seed = 1; seed <= 30 && !session; seed += 1) {
    const run = driver(seed);
    const bought = run.events.some((e) => e.t === 'shop_open') && run.events.some((e) => e.t === 'card_bought');
    if (bought && run.state.phase === 'map' && run.state.floor === 5) session = run;
  }
  assert.ok(session, 'some seed in 1..30 walks into the shop and buys');
  const parsed = parseLog(renderLog(session));
  assert.equal(parsed.ok, true, `log parses: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `hash-for-hash: ${JSON.stringify(result.mismatches ?? [])}`);
  assert.equal(runHash(session), result.finalHash);
  // And the shop left its traces in the event stream: one entry, at least one purchase
  // (the driver buys every affordable shelf), exactly one leave.
  assert.equal(session.events.filter((e) => e.t === 'shop_open').length, 1);
  assert.ok(session.events.filter((e) => e.t === 'card_bought').length >= 1);
  assert.equal(session.events.filter((e) => e.t === 'shop_left').length, 1);
});

test('snapshot: shelves carry action/affordable facts, the removal list is uid-precise with copy labels', () => {
  const s = shopVisit(3, { player: { gold: 120 } });
  const shop = snapshot(s).shop;
  assert.equal(shop.purse, 120);
  assert.equal(shop.leaveId, 'l');
  assert.equal(shop.removal.price, REMOVAL_PRICE);
  assert.equal(typeof shop.removal.actionId, 'string', '120 covers 75: the service is a button');
  // At 45 gold (the common band's floor) everything above a cheap common greys out.
  const poor = snapshot(shopVisit(3, { player: { gold: 45 } })).shop;
  assert.ok(poor.offers.some((o) => o.actionId === null), 'fixture: some shelf exceeds 45 gold');
  assert.equal(poor.removal.actionId, null, '45 does not cover the service: no button');
  for (const o of shop.offers) {
    assert.equal(o.affordable, o.actionId !== null, `${o.name}: the afford fact and the action agree`);
    if (o.price > 120) assert.equal(o.actionId, null, `${o.name} is unaffordable and unpainted`);
    assert.ok(typeof o.summary === 'string' && o.description.length > 0, `${o.name} describes itself`);
    assert.ok(['common', 'uncommon', 'rare'].includes(o.rarity), `${o.name} names its rarity`);
  }
  // The removal census: duplicates are separately labelled choices, in deck order.
  const rem = step(s, 'x').state;
  const snap = snapshot(rem).shop;
  assert.equal(snap.removing, true);
  assert.equal(snap.deckInstances.length, rem.deck.length);
  const byCard = new Map();
  for (const d of snap.deckInstances) {
    const arr = byCard.get(d.cardId) ?? [];
    arr.push(d.copy);
    byCard.set(d.cardId, arr);
  }
  const duplicated = [...byCard.values()].filter((arr) => arr.length > 1);
  assert.ok(duplicated.length >= 1, 'fixture: the starting deck holds duplicates');
  for (const [cardId, arr] of byCard) {
    assert.deepEqual(arr, Array.from({ length: arr.length }, (_, i) => i + 1), `${cardId}: copy numbers count 1..n in deck order`);
  }
  assert.deepEqual(snap.deckInstances.map((d) => d.actionId), rem.deck.map((_, i) => `x${i + 1}`));
});

test('a validate-accepted shop save with no player.gold buys at 0 and stays hashable (S4.1 P2)', () => {
  // The exact P2 shape: validateSave keeps player.gold OPTIONAL, so a pre-gold save may
  // stand in a shop phase; a 0-price offer is a legal buy from an empty purse. The
  // deduction read the field bare (`undefined - 0` => NaN), and NaN made canonical() —
  // hash() and every save — throw. The purse floors at 0 instead.
  const inShop = shopVisit(3);
  const blank = JSON.parse(JSON.stringify(saveObject(begin({ seed: 3 }))));
  const staged = JSON.parse(JSON.stringify({ ...blank, state: inShop, actions: [{ act: 'n2' }] }));
  delete staged.state.player.gold;
  for (const o of staged.state.shop.offers) o.price = 0;
  assert.deepEqual(validateSave(staged), [], `no purse + zero prices validate: ${JSON.stringify(validateSave(staged))}`);
  const res = loadObject(staged);
  assert.equal(res.ok, true, `the torn purse loads: ${JSON.stringify(res.problems ?? [])}`);
  const s = res.session.state;
  assert.equal(s.player.gold, undefined);
  const out = step(s, 'b1');
  assert.equal(out.error, null, 'a free offer is affordable at an empty purse');
  assert.equal(out.state.player.gold, 0, 'the purse reads 0, never NaN');
  assert.ok(Number.isInteger(out.state.player.gold));
  assert.doesNotThrow(() => hash(out.state), 'the bought state must stay hashable');
  assert.doesNotThrow(() => snapshot(s), 'the shop snapshot must tolerate the missing purse');
  assert.match(observe(out.state), /GOLD 0/);
  assert.match(observe(out.state), /purse 0/);
});

test('a torn shop (field absent or null) offers only the leave, never a legal no-op x (S4.1 P3)', () => {
  // The id layer must mirror the handler's guard: with the shop field torn (absent or
  // null), `x` used to be enumerated while buyRemoval refused it — a legal no-op that
  // bumped stepIndex, inverting the R6 ruling this file pins above.
  const base = newRun({ seed: 3 });
  for (const shop of [null, undefined, { offers: [], removal: null }]) {
    const s = { ...base, phase: 'shop', shop, floor: 4, mapNodeId: 'r5n1' };
    assert.deepEqual(actions(s).map((a) => a.id), ['l'], `shop ${JSON.stringify(shop)}: no offers, no service, just the exit`);
    const out = step(s, 'x');
    assert.equal(out.error?.code, 2, `shop ${JSON.stringify(shop)}: forcing x is the R6 rejection, not a no-op`);
    assert.equal(out.state, s, 'a rejected x does not move the state');
  }
});

test('both heuristic policies leave at once; the random policy survives a full visit', async () => {
  for (const name of ['greedy', 'smart']) {
    const policy = makePolicy(name);
    let s = shopVisit(3, { player: { gold: 300 } });
    let guard = 0;
    while (s.phase === 'shop' && guard < 20) {
      const L = actions(s);
      const choice = policy.choose({ session: { state: s }, state: s, legal: L, stepIndex: s.stepIndex, memory: {} });
      assert.ok(L.some((a) => a.id === choice.id), `${name} chose a legal id`);
      s = step(s, choice.id).state;
      guard += 1;
    }
    assert.equal(s.phase, 'map', `${name} left the shop immediately (${guard} steps)`);
    assert.equal(s.player.gold, 300, `${name} bought nothing`);
  }
  // random: deterministic, and it can buy/remove — it must always land back on the map.
  const policy = makePolicy('random');
  for (const seed of [3, 5, 7]) {
    let s = shopVisit(seed, { player: { gold: 999 } });
    let guard = 0;
    while (s.phase === 'shop' && guard < 60) {
      const L = actions(s);
      const choice = policy.choose({ session: { state: s }, state: s, legal: L, stepIndex: s.stepIndex, memory: {} });
      assert.ok(L.some((a) => a.id === choice.id), `random chose a legal id (seed ${seed})`);
      s = step(s, choice.id).state;
      guard += 1;
    }
    assert.equal(s.phase, 'map', `seed ${seed}: random emptied the room and left`);
    assert.ok(s.deck.length >= 1, 'the deck never fell below one card');
  }
});
