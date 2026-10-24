// src/web/fx-add.js — the one primitive every effect shares: put a node on the persistent
// layer, take it off after `ms`. A leaf by design: fx.js (the dispatcher) and
// fx-signatures.js (the per-card effects) both sit above it, so neither imports the other
// to reach this, and the effect layer's import graph stays acyclic.

import { fxEl, reducedMotion, later } from './runtime.js';

/** Put one effect node on the persistent layer; removed after `ms`. */
export function fxAdd(node, ms) {
  if (!fxEl || reducedMotion) return;
  fxEl.append(node);
  // `parentNode`, not `parent`: DOM nodes have no `.parent`, so effect nodes used to pile up forever.
  later(() => { node.remove(); }, ms);
}
