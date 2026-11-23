---
name: verify-fx-generation
description: "Check the browser effect queue's generation protocol after any change to src/web/fx.js dispatchFx, src/web/runtime.js later/skipAnim/clearFxTimers, or the delayed-hit lifecycle. Run this before reviewing such a change."
---

# Verify FX generation

Use this skill when a change touches any of these files or the delayed-beat lifecycle they implement:

- `src/web/fx.js` — `dispatchFx()` and its `fire()` helper
- `src/web/runtime.js` — `later()`, `clearFxTimers()`, `skipAnim()`
- `src/web/actions.js` — plan retirement around `dispatchFx()`
- `src/web/fx-particles.js` — generation-cancelled WAAPI embers

## The property

One player action captures exactly one effect generation. Every delayed beat of that action carries it. A beat fires only while its generation is still live.

The harm when it breaks: delayed signature effects silently cancel themselves and never appear (commit `bfa7bf7`: stage shake, shockwave, anvil, salvo, rend, launch), or an old action's beat fires after a newer action retired it (`c8ee3f7`, `7906900`).

## Run it

```sh
npm run verify:formal
```

It is also part of `npm run gate`, which CI runs on every pull request. Exit 0 means the source conforms and the model behaves as expected. Exit 1 prints the source violation with the fix in the message, or a model trace.

## Read a result

A `SOURCE ... FXn:` line is a real finding. It names the file, the fix and the historical commit. Do not weaken the check to make it pass.

An `OK <variant>` line followed by `fx-generation: verified` is a pass. The three variants are deliberate:

- `current` must be accepted. It is the protocol the shipped code implements.
- `per-timer-generation` must be rejected with `never fired`. It replays `bfa7bf7`, where each timer took its own `++animGen` and a later bump cancelled them all.
- `unguarded-fire` must be rejected with `generation retired`. It replays a stale beat landing after a newer action.

A counterexample reads left to right in code terms. `dispatch(a1) -> tick -> skipAnim() -> tick` means: an effect was scheduled, time advanced, the skip bumped the generation, and the remaining beats were retired. That is expected. A `never fired` trace with no skip, restart or newer action is a bug in the guard.

If the variant result reads `FAIL <variant>`, the verifier itself drifted. Fix `scripts/verify-fx-generation.mjs`, not the product code.

## Scope

The model explores every interleaving of at most two actions, six ticks, one skip and one restart, with three delayed beats per action. It checks the generation protocol only. It does not check real timers, DOM node identity, animation frames, or audio. A pass covers that bounded model plus the source-shape rules, not the whole browser surface.

## Coverage record

| Check | Covered code |
|---|---|
| FX1 | `src/web/fx.js` `dispatchFx()` — exactly one `const gen = bumpAnimGen()` |
| FX2 | `src/web/fx.js` `dispatchFx()` — guarded `fire()` shared by all delayed beats |
| FX3 | `src/web/runtime.js` `skipAnim()` — bump retires pending beats |
| FX4 | `src/web/runtime.js` `later()` — timers tracked for `clearFxTimers()` |
| model | interleavings of dispatch, tick, skip, restart under three generation protocols |

Last confirmed against the code at commit `50c53fa`. After a change to a covered file, run the check and move this commit forward only when the result still describes the code. Point `/maintain-formal-verification-skill` at this skill when the product code moves.
