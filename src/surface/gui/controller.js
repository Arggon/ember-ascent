// DOM-free GUI controller (R1, PM ruling §8.3).
//
// This is the module a browser renderer will drive in phase 6. It is deliberately
// unable to render: it exposes state and intents as data, and it must never contain
// a rule. Its whole job is to prove that the second surface exists at the same
// moment as the first one, so divergence is a test failure in phase 3 instead of a
// rewrite in phase 6.
//
// It shares submit() with the CLI — there is no second code path to drift.
import {
  begin,
  submit,
  legal,
  view,
  snapshotOf,
  describeApi,
  descriptionsOf,
  actionLines,
  runHash,
  loadObject,
  saveText,
  EXIT,
} from '../session.js';

/**
 * Resolve the optional renderer. Absence is normal, not an error: the controller is
 * usable with no renderer at all (that is the "renderer unresolvable" case the
 * golden test exercises), and it falls back to the kernel's text dump.
 * @returns {Promise<any|null>}
 */
export async function resolveRenderer() {
  try {
    const mod = await import('./renderer.js');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a controller over a run.
 * @param {{session?: any, renderer?: any}} [opts]
 */
export function createController(opts = {}) {
  let session = opts.session ?? begin(opts.run ?? {});
  let renderer = opts.renderer ?? null;
  let lastError = null;

  return {
    /** The surface's name, used by the golden test to label both adapters. */
    surface: 'gui-controller',

    get state() {
      return session.state;
    },

    /** The submitted action log of this run (read-only view; the run record counts it). */
    get submitted() {
      return session.submitted;
    },

    /** Attach a renderer after construction; null is a valid (headless) value. */
    attach(rendererImpl) {
      renderer = rendererImpl;
    },

    hasRenderer() {
      return renderer !== null && renderer !== undefined;
    },

    /** Legal actions as descriptors — data, never DOM. */
    actions() {
      return legal(session);
    },

    /**
     * The kernel's structured view of the current state — a JSON-safe value model
     * with card names/costs, enemy intents, reachable map nodes, etc. All of it is
     * computed in the kernel; the controller (and any renderer) only transports it.
     */
    snapshot() {
      return snapshotOf(session);
    },

    /**
     * The kernel's plain-English layer, as data: the glossary, the first-run help topics
     * and the decoded statuses / powers / enemy intents of the CURRENT state. A renderer
     * that needs sentences reads them here — it never composes a game rule itself.
     */
    descriptions() {
      return descriptionsOf(session);
    },

    /** The raw describe functions, for a renderer that has its own value to explain. */
    describe() {
      return describeApi();
    },

    /** R5 lines, produced by the kernel. */
    actionLines() {
      return actionLines(session);
    },

    /** R4 dump, produced by the kernel. */
    render(opts) {
      const text = view(session, opts);
      if (this.hasRenderer() && typeof renderer.render === 'function') {
        // A renderer receives data and returns nothing; it cannot feed anything back.
        renderer.render({ text, state: session.state, actions: legal(session), snapshot: snapshotOf(session) });
      }
      return text;
    },

    /**
     * Dispatch one action. Illegal ids return the same structured error the CLI
     * reports, and the no-op is recorded exactly as the CLI records it.
     * @param {unknown} id
     */
    dispatch(id) {
      const out = submit(session, id);
      session = out.session;
      lastError = out.error;
      return { error: out.error, events: out.events, changed: out.changed };
    },

    /** Run identity after the last dispatch — the golden test's comparison key. */
    hash() {
      return runHash(session);
    },

    lastError() {
      return lastError;
    },

    /** Serialized save (same canonical bytes the CLI writes). */
    save() {
      return saveText(session);
    },

    /** Replace the current run from an untrusted parsed save. */
    load(raw) {
      const res = loadObject(raw);
      if (!res.ok) return { ok: false, problems: res.problems, code: EXIT.corruptSave };
      session = res.session;
      return { ok: true, problems: [] };
    },

    // Aliases so a renderer author can call either spelling.
    submit: (id) => submit(session, id),
  };
}
