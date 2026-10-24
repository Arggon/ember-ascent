// src/web/map-view.js — the ascent map: nodes, routes, quests, travel marker, pins.
//
// The kernel connects every node on a floor to every node on the next one, so every pair
// is drawn; the legs the player can take right now are lit. Geometry is read from the
// laid-out nodes, so it follows any breakpoint. Map pins are browser-only planning marks
// in localStorage, keyed by the run's seed and NEVER in run state.

import { prevMapCurrent, prevMapFloor, repaint, snap } from './runtime.js';
import { el, announce } from './dom.js';
import { NODE_GLYPH, NODE_WORDS, glyphBox } from './glyphs.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { storeGet, storePut } from './run-history.js';

/* ---------------------------------------------------------------------- MAP */

/**
 * The map. `travel` is the burst for a step just taken (or null), so the node the player
 * LEFT is drawn once more as an inert marker that travels toward the node they now stand
 * on. Both are located by the kernel's own `row` / `current` fields: no coordinate is
 * measured, and nothing is inferred about where the player may go next.
 * @param {any} travel the `travel` burst for this paint, or null
 */
export function mapView(travel = null) {
  // The wrapper carries `.panel`; this inner div is content only.
  const wrap = el('div');
  wrap.append(el('p', { cls: 'section-title', text: `Map — floor ${snap.map.floor + 1}/${snap.map.floorCount}` }));
  if (snap.quests) wrap.append(questStrip(snap.quests));
  const travelFromId = travel ? (prevMapCurrent ?? null) : null;
  const travelFromRow = travel ? (prevMapFloor ?? null) : null;
  const map = el('div', { cls: 'map' });
  snap.map.rows.forEach((row, r) => {
    const rowEl = el('div', { cls: 'map-row' });
    rowEl.append(el('span', { cls: 'map-floor-label', text: `${r + 1}` }));
    // The row the step STARTED on gets one extra, inert marker: the node that was just
    // left. It sits at the end of its own row, which is where a "was here" mark belongs,
    // and it is never a button, so it cannot be clicked and cannot shift a real node.
    const showTravel = travel !== null && travelFromId !== null && r === travelFromRow;
    // "You are here" as TEXT (UX rev 3): the fact survives reduced motion and greyscale, and
    // on a phone a ribbon answers "where am I" better than a tint ever does.
    if (row.some((n) => n.current)) rowEl.append(el('div', { cls: 'node-you', text: 'you are here' }));
    for (const n of row) rowEl.append(mapNode(n));
    if (showTravel) rowEl.append(travelMarker(travel));
    map.append(rowEl);
  });
  // The world behind the path (decorative, constant markup): lava at the foot where the
  // climb starts, two ridge lines, and the Guardian's spire at the summit.
  const world = el('div', { cls: 'map-world', attrs: { 'aria-hidden': 'true' } });
  world.innerHTML = MAP_WORLD;
  map.prepend(world);
  wrap.append(map);
  requestAnimationFrame(() => drawRoutes(map));
  wrap.append(el('p', { cls: 'hint', text: 'Click a glowing node to travel. Fight something weak, risk an elite, or rest.' }));
  return page('map', 'I — The Path', 'route', 'panel', [wrap]);
}

/** B3 Ember quests: one compact chip per quest, progress as text and as a bar. */
function questStrip(quests) {
  const strip = el('div', { cls: 'quests', attrs: { 'aria-label': 'Ember quests' } });
  for (const q of quests) {
    const pct = Math.round((100 * q.progress) / q.goal);
    const chip = el('div', {
      cls: `quest${q.done ? ' done' : ''}`,
      attrs: { title: `${q.text} Reward: ${q.rewardText}.` },
    },
    el('span', { cls: 'q-name', text: q.name }),
    el('span', { cls: 'q-prog', text: q.done ? `done · ${q.rewardText}` : `${q.progress}/${q.goal} · ${q.rewardText}` }));
    const bar = el('span', { cls: 'q-bar' });
    bar.style.setProperty('--q', `${pct}%`);
    chip.append(bar);
    strip.append(chip);
  }
  return strip;
}

const MAP_WORLD = '<svg viewBox="0 0 400 600" preserveAspectRatio="none">'
  + '<path class="w-sky" d="M0 0 H400 V600 H0 Z"/>'
  + '<path class="w-far" d="M0 150 L40 120 L70 135 L110 80 L150 110 L200 30 L250 100 L290 75 L330 115 L370 90 L400 110 V600 H0 Z"/>'
  + '<path class="w-spire" d="M188 70 L196 18 L200 4 L204 18 L212 70 Z"/>'
  + '<path class="w-mid" d="M0 330 L50 290 L90 310 L140 250 L190 290 L240 240 L290 280 L340 245 L400 285 V600 H0 Z"/>'
  + '<path class="w-crack" d="M140 250 L150 300 L138 340 M290 280 L282 330"/>'
  + '<path class="w-near" d="M0 500 L60 470 L120 490 L180 455 L250 485 L320 460 L400 490 V600 H0 Z"/>'
  + '<path class="w-lava" d="M0 575 C70 555 130 590 200 570 C270 550 330 588 400 566"/>'
  + '</svg>';

/**
 * Draw the routes between floors. The kernel connects every node on a floor to every node
 * on the next one (rules/map.js availableNodes), so every pair is drawn; the legs the player
 * can take right now are lit. Geometry is read from the laid-out nodes, so it follows any
 * breakpoint. Decorative: aria-hidden, pointer-inert, and it carries no fact the node
 * buttons do not already state.
 * @param {HTMLElement} map
 */
function drawRoutes(map) {
  if (!map.isConnected) return;
  const box = map.getBoundingClientRect();
  if (box.width === 0) return;
  const rows = [...map.querySelectorAll('.map-row')].map((r) => [...r.querySelectorAll('.node')]);
  // offset* geometry, not getBoundingClientRect: it ignores the rows' entrance transform,
  // so the routes are drawn where the nodes come to rest.
  const c = (n) => { const r = n.parentElement; return [r.offsetLeft + n.offsetLeft + n.offsetWidth / 2, r.offsetTop + n.offsetTop + n.offsetHeight / 2]; };
  let lit = '';
  let dim = '';
  for (let r = 0; r + 1 < rows.length; r += 1) {
    for (const a of rows[r]) {
      for (const b of rows[r + 1]) {
        const [x1, y1] = c(a); const [x2, y2] = c(b);
        const my = (y1 + y2) / 2;
        const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
        if (a.classList.contains('current') && b.classList.contains('available')) lit += d; else dim += d;
      }
    }
  }
  // innerHTML on a constant template keeps this file free of any namespace URL string;
  // the only interpolated values are numbers this function computed.
  const holder = el('div');
  holder.innerHTML = `<svg class="map-routes" aria-hidden="true" width="${Math.round(box.width)}" height="${Math.round(box.height)}">`
    + (dim ? `<path class="route-dim" d="${dim}"/>` : '') + (lit ? `<path class="route-lit" d="${lit}"/>` : '') + '</svg>';
  const svg = holder.firstChild;
  map.querySelector('.map-routes')?.remove();
  map.insertBefore(svg, map.querySelector('.map-row'));
}

/**
 * The inert marker left behind on the row a step started from. It carries the kernel's label
 * for where the player now stands, so the "where did I just get to" fact is readable without
 * any motion at all — which is what makes this safe under reduced motion.
 * @param {any} travel the `travel` burst
 */
function travelMarker(travel) {
  const mark = el('span', { cls: 'node-travel' + (travel.boss ? ' to-boss' : ''),
    attrs: { title: `Just travelled from floor ${(prevMapFloor ?? 0) + 1}` } },
    el('span', { cls: 'ntravel-from', text: 'you were here' }),
    el('span', { cls: 'ntravel-to', text: travel.label ? `→ ${travel.label}` : '→ next' }),
  );
  return mark;
}

/* Map pins (M5): up to 3 planning marks per run, kept in localStorage under the run's
   seed and NEVER in run state, so the kernel, replays and hashes are untouched. */
const PINS_KEY = 'dlb.mapPins.v1';
const PIN_MAX = 3;
function mapPins() {
  const all = storeGet(PINS_KEY);
  const list = all && Array.isArray(all[String(snap.seed)]) ? all[String(snap.seed)] : [];
  return list.filter((x) => typeof x === 'string');
}
function toggleMapPin(id) {
  let list = mapPins();
  list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-PIN_MAX);
  // Only the current seed is kept, so the store never grows across runs.
  storePut(PINS_KEY, { [String(snap.seed)]: list });
  announce(list.includes(id) ? 'Pin placed.' : 'Pin removed.');
}

function mapNode(n) {
  const short = n.type.replace('combat_', '');
  const cls = `node t-${short}` + (n.available ? ' available' : '') + (n.current ? ' current' : '');
  const node = el(n.available ? 'button' : 'span', {
    cls,
    attrs: n.available ? { type: 'button', title: `Travel to ${n.label}`, 'aria-label': `Travel to ${(NODE_WORDS[short] || [n.label])[0]}` } : {},
    on: {
      ...(n.available && n.actionId ? { click: () => act(n.actionId) } : {}),
      // Right-click (long-press on touch) drops or lifts a planning pin. Browser-only state.
      contextmenu: (ev) => { ev.preventDefault(); toggleMapPin(n.id); repaint(); },
    },
  });
  if (n.available) node.title = `Travel to ${n.label} · right-click to pin`;
  else node.setAttribute('title', 'Right-click to pin this node');
  node.append(glyphBox(NODE_GLYPH[short] || 'rune', 'ntype-mark'));
  if (mapPins().includes(n.id)) {
    node.classList.add('pinned');
    node.append(el('span', { cls: 'node-pin', attrs: { 'aria-label': 'pinned' } }));
  }
  const words = NODE_WORDS[short] || [n.label, ''];
  node.append(el('span', { cls: 'ntype', text: words[0] }));
  if (words[1]) node.append(el('span', { cls: 'nsub', text: words[1] }));
  return node;
}
