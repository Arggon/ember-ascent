// src/web/audio.js — the procedural SFX layer: 100% WebAudio synthesis, zero assets.
//
// A pure leaf module (no imports), so fx.js can call it from the dispatcher and the
// combat view can toggle it without a cycle. Four synthesized sounds:
//   * 'strike-impact'  — the golpe's crack (bandpassed noise) + thump (sine drop) +
//     click (square blip), tiered by the freeze weight the feel schedule computed;
//   * 'hero-guard'     — two triangle plate rings a fifth apart over a bright clash;
//   * 'card-play'      — a filtered-noise whoosh, the card leaving the hand;
//   * 'enemy-death'    — a 320→40 Hz fall plus an ash tail sized to the collapse
//     (render.js's COLLAPSE_MS base — audio owns no animMs, it is a leaf).
//
// The context is LAZY: nothing constructs an AudioContext before the player's first
// gesture (pointerdown/keydown/touchstart listeners registered at load, guarded because
// the fake-DOM test hosts may carry a bare document). primeAudio() is the only
// constructor and is idempotent, so sfx() called before any gesture is a silent no-op
// and AC1's "no context before the first click" holds by construction.
//
// Throttle, two levels, so no sound burst can machine-gun the mix (AC4):
//   * a per-name fold — the same name inside 100ms plays once, the rest fold;
//   * a rolling budget — at most 5 scheduled sounds per trailing second, whatever the
//     name. Both folds are counted in audioState().throttled for the tests to pin.

export const SFX_MUTED_KEY = 'ea.sfxMuted';

let actx = null; // the AudioContext, created by primeAudio() at the first gesture
let masterGain = null;
let noiseBuf = null; // one shared white-noise buffer per context, reused by every layer
let sfxMuted = readMuted();
const sfxCounts = {};
const sfxBudget = []; // trailing-second schedule times (the budget's rolling window)
const sfxLastAt = {}; // per-name last scheduled time (the fold's window)
let sfxFolded = 0;
let sfxLastParams = null;

const FOLD_MS = 100; // one sound per name per window
const BUDGET_MS = 1000;
const BUDGET_MAX = 5;
// The impact's pitch band: ±6% around the tier's base frequencies, so two golpes in one
// play never read as a loop. Published through audioState().lastParams.
const PITCH_BAND = [0.94, 1.06];
// The strike's weight ladder — the same three tiers IMPACT_FEEL.freezeMs speaks (0 light
// / 1 mid / 2 heavy-killing), so a weight-2 golpe sounds like the freeze it opens.
const STRIKE_TIERS = [
  { gain: 0.2, ms: 120, hz: 2200 }, // light — a flick's slap
  { gain: 0.32, ms: 150, hz: 1400 }, // mid — a solid hit
  { gain: 0.48, ms: 190, hz: 850 }, // heavy — a killing or deep blow
];

function readMuted() {
  try {
    return localStorage.getItem(SFX_MUTED_KEY) === '1';
  } catch { return false; } // private mode: sound state simply does not persist
}

/** Persist the toggle and take effect at once (no context needed to go silent). */
export function setSfxMuted(m) {
  sfxMuted = Boolean(m);
  try {
    localStorage.setItem(SFX_MUTED_KEY, sfxMuted ? '1' : '0');
  } catch { /* private mode */ }
}

/** Build the context and the master bus. The FIRST GESTURE's only audio side effect —
 *  called from the load-time listeners below (and callable directly by tests). Idempotent:
 *  every listener may call it, only the first gesture constructs anything. */
export function primeAudio() {
  if (actx || typeof AudioContext !== 'function') return;
  actx = new AudioContext();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(actx.destination);
  // A gesture usually unlocks a suspended context, but an early keydown may arrive
  // while the tab's own policy still holds it — ask for the resume either way.
  if (actx.state === 'suspended' && actx.resume) actx.resume();
}

/** The published truth: the context's state ('none' before the first gesture), the
 *  toggle, the per-name schedule counts, the fold count and the last synthesis's
 *  parameters (the pitch randomize is visible here). Read-only snapshot. */
export function audioState() {
  return {
    ctx: actx ? actx.state : 'none',
    muted: sfxMuted,
    counts: { ...sfxCounts },
    throttled: sfxFolded,
    lastParams: sfxLastParams,
  };
}

/** Schedule one sound by name. Returns false when muted, unprimed, unknown or folded —
 *  callers ignore the result; the counters are the observable. */
export function sfx(name, opts = {}) {
  if (sfxMuted) return false;
  if (!actx) return false;
  const synth = SYNTHS[name];
  if (!synth) return false;
  const now = Date.now();
  while (sfxBudget.length > 0 && now - sfxBudget[0] >= BUDGET_MS) sfxBudget.shift();
  if (sfxBudget.length >= BUDGET_MAX) {
    sfxFolded += 1;
    return false;
  }
  if (now - (sfxLastAt[name] ?? -Infinity) < FOLD_MS) {
    sfxFolded += 1;
    return false;
  }
  sfxLastAt[name] = now;
  sfxBudget.push(now);
  sfxCounts[name] = (sfxCounts[name] ?? 0) + 1;
  sfxLastParams = { name, ...(synth(opts) ?? {}) };
  return true;
}


function noiseFor() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(actx.sampleRate * 0.6);
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function noiseSource() {
  const src = actx.createBufferSource();
  src.buffer = noiseFor();
  return src;
}

/** THE GOLPE (AC2): three layers on the same instant, tiered by the freeze weight the
 *  feel schedule computed. The pitch randomize rides every layer's base frequency. */
function playStrike(opts = {}) {
  const weight = opts.weight === 2 ? 2 : (opts.weight === 1 ? 1 : 0);
  const tier = STRIKE_TIERS[weight];
  const pitch = PITCH_BAND[0] + Math.random() * (PITCH_BAND[1] - PITCH_BAND[0]);
  const at = actx.currentTime;
  const dur = tier.ms / 1000;
  // layer 1 — the crack: bandpassed noise at the tier's own band
  const crack = noiseSource();
  const band = actx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = tier.hz * pitch;
  band.Q.value = 1.2;
  const cg = actx.createGain();
  cg.gain.setValueAtTime(tier.gain, at);
  cg.gain.exponentialRampToValueAtTime(0.001, at + dur);
  crack.connect(band);
  band.connect(cg);
  cg.connect(masterGain);
  crack.start(at);
  crack.stop(at + dur);
  // layer 2 — the thump: a sine dropping an octave, the blow's body
  const thump = actx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(170 * pitch, at);
  thump.frequency.exponentialRampToValueAtTime(52 * pitch, at + dur);
  const tg = actx.createGain();
  tg.gain.setValueAtTime(tier.gain * 0.9, at);
  tg.gain.exponentialRampToValueAtTime(0.001, at + dur);
  thump.connect(tg);
  tg.connect(masterGain);
  thump.start(at);
  thump.stop(at + dur);
  // layer 3 — the click: a 12ms square blip carrying the attack transient
  const click = actx.createOscillator();
  click.type = 'square';
  click.frequency.value = 1400 * pitch;
  const kg = actx.createGain();
  kg.gain.setValueAtTime(tier.gain * 0.5, at);
  kg.gain.exponentialRampToValueAtTime(0.001, at + 0.012);
  click.connect(kg);
  kg.connect(masterGain);
  click.start(at);
  click.stop(at + 0.012);
  return { pitch, weight };
}

/** THE GUARD: two plate rings a fifth apart — the crossing-plates spark's own chord —
 *  over a short bright clash. Deterministic (no randomize): the pose is a stance, not
 *  an impact. */
function playGuard() {
  const at = actx.currentTime;
  for (const hz of [520, 780]) {
    const osc = actx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.22, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.28);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(at);
    osc.stop(at + 0.28);
  }
  const clash = noiseSource();
  const hp = actx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const hg = actx.createGain();
  hg.gain.setValueAtTime(0.18, at);
  hg.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
  clash.connect(hp);
  hp.connect(hg);
  hg.connect(masterGain);
  clash.start(at);
  clash.stop(at + 0.09);
  return { plates: [520, 780] };
}

/** THE CARD LEAVING THE HAND: a bandpass sweep up and back down over one noise breath. */
function playCard() {
  const at = actx.currentTime;
  const dur = 0.16;
  const whoosh = noiseSource();
  const band = actx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.6;
  band.frequency.setValueAtTime(220, at);
  band.frequency.exponentialRampToValueAtTime(1500, at + dur * 0.6);
  band.frequency.exponentialRampToValueAtTime(320, at + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.001, at);
  g.gain.exponentialRampToValueAtTime(0.3, at + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  whoosh.connect(band);
  band.connect(g);
  g.connect(masterGain);
  whoosh.start(at);
  whoosh.stop(at + dur);
  return { ms: 160 };
}

/** THE COLLAPSE (AC6's own moment): a sawtooth falling 320→40 Hz across the ash-fall's
 *  own base (render.js's COLLAPSE_MS, 500) with a low-passed ash tail on the same span —
 *  the sound lands where the ghost starts shattering, because that is where dispatchFx
 *  fires it. */
function playDeath() {
  const at = actx.currentTime;
  const dur = 0.5;
  const fall = actx.createOscillator();
  fall.type = 'sawtooth';
  fall.frequency.setValueAtTime(320, at);
  fall.frequency.exponentialRampToValueAtTime(40, at + dur);
  const fg = actx.createGain();
  fg.gain.setValueAtTime(0.26, at);
  fg.gain.exponentialRampToValueAtTime(0.001, at + dur);
  fall.connect(fg);
  fg.connect(masterGain);
  fall.start(at);
  fall.stop(at + dur);
  const ash = noiseSource();
  const low = actx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 500;
  const ag = actx.createGain();
  ag.gain.setValueAtTime(0.14, at);
  ag.gain.exponentialRampToValueAtTime(0.001, at + dur);
  ash.connect(low);
  low.connect(ag);
  ag.connect(masterGain);
  ash.start(at);
  ash.stop(at + dur);
  return { fromHz: 320, toHz: 40, ms: 500 };
}

const SYNTHS = {
  'strike-impact': playStrike,
  'hero-guard': playGuard,
  'card-play': playCard,
  'enemy-death': playDeath,
};


function onFirstGesture() {
  primeAudio();
}

// Registered at LOAD, guarded: the fake-DOM test hosts carry a document whose
// addEventListener may not exist, and this module must load everywhere the surface does.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('pointerdown', onFirstGesture);
  document.addEventListener('keydown', onFirstGesture);
  document.addEventListener('touchstart', onFirstGesture);
}
