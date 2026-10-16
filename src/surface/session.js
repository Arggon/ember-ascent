// Run session — the shared driver every surface uses (R1, R2, R3, R6).
//
// WHY THIS EXISTS: the CLI and the DOM-free GUI controller must not each decide
// what "playing an action" means. Both call submit() here, so equal hashes after
// every step is a property of one code path rather than a promise about two.
//
// This file holds NO game rules. It sequences kernel calls, records what was
// submitted, and derives the JSONL action log. Every rule lives in src/kernel/**.
import {
  newRun,
  actions as legalActions,
  step,
  observe,
  observeActions,
  snapshot,
  describeCard,
  describeEffect,
  describeStatus,
  describePower,
  describeIntent,
  describeTile,
  describePlayability,
  describeCardType,
  glossary,
  helpTopics,
  hash,
  toSave,
  validateSave,
  serializeSave,
  canonical,
  ENGINE_VERSION,
  FORMAT_VERSION,
} from '../kernel/index.js';

/** Exit-code classes, mirroring the frozen R8 table. */
export const EXIT = {
  ok: 0,
  internal: 1,
  illegalAction: 2,
  usage: 3,
  corruptSave: 4,
  replayMismatch: 5,
  timeout: 6,
};

/** Log format identity. The header carries these verbatim. */
export const LOG_FORMAT = 'dlb-log';
export const LOG_VERSION = 1;

/**
 * Begin a fresh run.
 * @param {{seed?: number, character?: string, difficulty?: number, content?: any}} opts
 * @returns {{state: any, submitted: Array<{act: string}|{reject: string}>, events: any[]}}
 */
export function begin(opts = {}) {
  return { state: newRun(opts), submitted: [], events: [] };
}

/**
 * Submit one action id.
 *
 * R6: an illegal or unknown id is a legal NO-OP carrying a structured error; it is
 * recorded as a rejection so the malformed rate stays measurable on replay. It is
 * never retried and never throws.
 *
 * DR-6 — THE EVENT STREAM IS ACCUMULATED HERE, AND THIS IS THE ONLY PLACE IT CAN BE.
 * The run record's score needs kill / elite / boss counts, and `snapshot()` carries no
 * such counters: they exist only in the per-step `events` this function receives. A
 * caller that keeps the actions but drops the events produces a record that scores zero
 * kills while looking perfectly well-formed, so the stream is kept alongside them, in
 * the same order, with no filtering — including the `rejected` event of a no-op, which
 * a later reader can use to reconcile `steps` against `actions`.
 * @param {any} session
 * @param {unknown} raw
 * @returns {{session: any, error: any, events: any[], changed: boolean}}
 */
export function submit(session, raw) {
  const id = typeof raw === 'string' ? raw : String(raw);
  const res = step(session.state, id);
  const entry = res.error ? { reject: id } : { act: id };
  const seen = Array.isArray(res.events) ? res.events : [];
  return {
    session: {
      state: res.state,
      submitted: [...session.submitted, entry],
      events: [...(session.events ?? []), ...seen],
    },
    error: res.error,
    events: res.events,
    changed: res.error === null,
  };
}

/**
 * The accumulated kernel event stream (DR-6), for a caller building a run record.
 * @param {any} session
 * @returns {any[]}
 */
export function eventsOf(session) {
  return Array.isArray(session?.events) ? session.events : [];
}

/** Legal action descriptors for the current state. */
export function legal(session) {
  return legalActions(session.state);
}

/** R4 observation dump text. */
export function view(session, opts) {
  return observe(session.state, opts);
}

/** Structured, DOM-free view of the state (kernel-owned); a renderer draws this. */
export function snapshotOf(session) {
  return snapshot(session.state);
}

/**
 * The kernel's plain-English layer, passed through unchanged.
 *
 * A renderer needs sentences, not abbreviations — but sentences about cards ARE game
 * knowledge, so they are computed in the kernel and only transported here. Routing them
 * through the session is what lets the browser explain `HP3` without importing
 * `src/kernel/rules/**` (which the architecture gate forbids, and rightly).
 */
export function describeApi() {
  return {
    card: describeCard,
    effect: describeEffect,
    status: describeStatus,
    power: describePower,
    intent: describeIntent,
    tile: describeTile,
    playability: describePlayability,
    cardType: describeCardType,
    glossary,
    help: helpTopics,
  };
}

/**
 * The current state's plain-English descriptions: the glossary, the first-run help
 * topics, and the decoded statuses / powers / intents of the live state.
 * @param {any} session
 */
export function descriptionsOf(session) {
  const s = snapshot(session.state);
  const api = describeApi();
  return {
    glossary: api.glossary(),
    help: api.help(),
    statuses: s.player.statuses.map((x) => ({ key: x.key, stacks: x.stacks, text: api.status(x.key, x.stacks) })),
    powers: s.player.powers.map((x) => ({ key: x.key, stacks: x.stacks, text: api.power(x.key, x.stacks) })),
    enemies: s.enemies.map((e) => ({ index: e.index, id: e.id, intentText: api.intent(e) })),
  };
}

/** R5 action lines text. */
export function actionLines(session) {
  return observeActions(session.state);
}

/** R3 run identity. */
export function runHash(session) {
  return hash(session.state);
}

/** Count of rejected submissions and the resulting malformed rate. */
export function malformed(session) {
  const rejected = session.submitted.filter((e) => 'reject' in e).length;
  const total = session.submitted.length;
  return { rejected, total, rate: total === 0 ? 0 : rejected / total };
}

/** The frozen save object for a session. */
export function saveObject(session) {
  return toSave(session.state, session.submitted);
}

/** Canonical save text (LF terminated). */
export function saveText(session) {
  return serializeSave(saveObject(session));
}

/**
 * Restore a session from an untrusted parsed save object.
 * Version-incompatible or structurally invalid saves are refused, not repaired.
 * @param {unknown} raw
 * @returns {{ok: true, session: any} | {ok: false, problems: string[]}}
 */
export function loadObject(raw) {
  const problems = validateSave(raw);
  if (Array.isArray(raw?.actions)) {
    for (const [i, a] of raw.actions.entries()) {
      const shaped = a !== null && typeof a === 'object' && ('act' in a || 'reject' in a);
      if (!shaped) problems.push(`save.actions[${i}]: entry must be {"act":...} or {"reject":...}`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  // A save file carries the actions but never the event stream (the save format is
  // frozen), so a restored session starts with an empty one. That is honest: a run
  // restored mid-play cannot report kills it did not observe after the restore.
  return { ok: true, session: { state: raw.state, submitted: raw.actions.slice(), events: [] } };
}

/** Log header line object for a session's originating run. */
export function logHeader(session) {
  return {
    format: LOG_FORMAT,
    v: LOG_VERSION,
    seed: session.state.seed,
    contentVersion: session.state.contentVersion,
    // Additive to the frozen header: replay cannot reconstruct a non-default run
    // without these two, and they change none of the specified fields.
    character: session.state.character,
    difficulty: session.state.difficulty,
    // Additive (B1): only present for an opted-in Kindling run, so old headers are unchanged.
    ...(session.state.kindling ? { kindling: true } : {}),
  };
}

/**
 * Replay a submitted list from its header, hashing after every step.
 *
 * Pure with respect to the input: it rebuilds the run from (seed, header) and
 * re-submits each recorded action through the same submit() the live run used,
 * so a rejection is replayed through the same fallback path that produced it.
 * @param {any} header parsed log header
 * @param {Array<{act?: string, reject?: string}>} entries
 * @returns {{state: any, steps: Array<{index: number, hash: string, error: any}>}}
 */
export function replay(header, entries) {
  let session = begin({
    seed: header.seed,
    character: header.character ?? 'ironclad',
    difficulty: header.difficulty ?? 0,
    kindling: header.kindling === true,
  });
  const steps = [];
  for (const [i, entry] of entries.entries()) {
    const raw = 'reject' in entry ? entry.reject : entry.act;
    const out = submit(session, raw);
    session = out.session;
    steps.push({ index: i + 1, hash: runHash(session), error: out.error });
  }
  return { state: session.state, steps, session };
}

/** Render the JSONL action log for a session, hashes included (R3, replay contract). */
export function renderLog(session) {
  const header = logHeader(session);
  const lines = [JSON.stringify(header)];
  // Replaying from zero is what makes every logged hash correct by construction:
  // the log is a recording of a derivable run, never an independent claim about one.
  const { steps } = replay(header, session.submitted);
  session.submitted.forEach((entry, i) => {
    lines.push(JSON.stringify({ ...entry, h: steps[i].hash }));
  });
  lines.push(JSON.stringify({ steps: session.submitted.length, finalHash: runHash(session) }));
  return `${lines.join('\n')}\n`;
}

/**
 * Parse a JSONL action log.
 * @param {string} text
 * @returns {{ok: true, header: any, entries: any[], footer: any} | {ok: false, problems: string[]}}
 */
export function parseLog(text) {
  const problems = [];
  const rows = text.split('\n').filter((l) => l.trim() !== '');
  if (rows.length < 2) return { ok: false, problems: ['log: needs a header and a footer'] };
  let header;
  let footer;
  const entries = [];
  try {
    header = JSON.parse(rows[0]);
  } catch (e) {
    return { ok: false, problems: [`log: header is not JSON (${e.message})`] };
  }
  if (header?.format !== LOG_FORMAT) problems.push(`log: format must be "${LOG_FORMAT}", got ${JSON.stringify(header?.format)}`);
  if (header?.v !== LOG_VERSION) problems.push(`log: v ${header?.v} != ${LOG_VERSION} (version-incompatible)`);
  if (!Number.isInteger(header?.seed)) problems.push('log: header needs an integer seed');
  if (typeof header?.contentVersion !== 'string') problems.push('log: header needs a contentVersion');
  for (let i = 1; i < rows.length - 1; i += 1) {
    let row;
    try {
      row = JSON.parse(rows[i]);
    } catch (e) {
      problems.push(`log line ${i + 1}: not JSON (${e.message})`);
      continue;
    }
    if (!('act' in row) && !('reject' in row)) problems.push(`log line ${i + 1}: needs "act" or "reject"`);
    entries.push(row);
  }
  try {
    footer = JSON.parse(rows[rows.length - 1]);
  } catch (e) {
    problems.push(`log: footer is not JSON (${e.message})`);
  }
  if (!Number.isInteger(footer?.steps)) problems.push('log: footer needs integer "steps"');
  if (typeof footer?.finalHash !== 'string') problems.push('log: footer needs "finalHash"');
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, header, entries, footer };
}

/**
 * Assert a replayed log against its own recorded hashes (R3, exit 5 on mismatch).
 * @param {{header: any, entries: any[], footer: any}} parsed
 * @param {{hashEvery?: number}} [opts]
 * @returns {{ok: boolean, checked: number, skipped: number, mismatches: any[], finalHash: string, footerHash: string}}
 */
export function assertReplay(parsed, opts = {}) {
  const hashEvery = Math.max(1, opts.hashEvery ?? 1);
  const out = replay(parsed.header, parsed.entries);
  const mismatches = [];
  let checked = 0;
  let skipped = 0;
  out.steps.forEach((s, i) => {
    const logged = parsed.entries[i]?.h;
    if (typeof logged !== 'string') {
      skipped += 1;
      return;
    }
    const due = (i + 1) % hashEvery === 0 || i + 1 === out.steps.length;
    if (!due) {
      skipped += 1;
      return;
    }
    checked += 1;
    if (logged !== s.hash) mismatches.push({ step: s.index, logged, actual: s.hash });
  });
  const finalHash = runHash(out.session);
  if (finalHash !== parsed.footer.finalHash) {
    mismatches.push({ step: 'final', logged: parsed.footer.finalHash, actual: finalHash });
  }
  return { ok: mismatches.length === 0, checked, skipped, mismatches, finalHash, footerHash: parsed.footer.finalHash };
}

export { canonical, ENGINE_VERSION, FORMAT_VERSION };
