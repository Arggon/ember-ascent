// Payload-token measurement for run summaries (R9a).
//
// R9 splits into R9a (shipped: the game's OWN payload tokens) and R9b (dev-only:
// whole LLM sessions). This file is R9a. It measures the text the game actually
// emits, with js-tiktoken, in BOTH encodings, and reports the worst of the two —
// because a ceiling that only holds under one tokenizer is not a ceiling.
//
// js-tiktoken is a devDependency on purpose: the shipped game holds zero runtime
// dependencies. When it is absent (e.g. a stripped install), measurement reports
// `available: false` and a reason instead of guessing a count. No fabricated numbers.
export const CEILINGS = { stateDump: 250, actionLine: 8 };

/** Cached encoder handles; built lazily so importing this file costs nothing. */
let ENC = null;
let ENC_ERROR = null;

async function encoders() {
  if (ENC !== null || ENC_ERROR !== null) return ENC;
  try {
    const [{ Tiktoken }, o200k, cl100k] = await Promise.all([
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/o200k_base'),
      import('js-tiktoken/ranks/cl100k_base'),
    ]);
    ENC = {
      o200k_base: new Tiktoken(o200k.default ?? o200k),
      cl100k_base: new Tiktoken(cl100k.default ?? cl100k),
    };
  } catch (e) {
    ENC_ERROR = e;
  }
  return ENC;
}

/**
 * Worst-of count for one payload.
 * @param {string} text
 * @returns {{o200k_base: number, cl100k_base: number, worst: number} | {available: false, reason: string}}
 */
export async function countWorst(text) {
  const e = await encoders();
  if (!e) return { available: false, reason: `js-tiktoken unavailable (${ENC_ERROR?.message ?? 'unknown'})` };
  const o = e.o200k_base.encode(text).length;
  const c = e.cl100k_base.encode(text).length;
  return { o200k_base: o, cl100k_base: c, worst: Math.max(o, c) };
}

/**
 * Measure a whole run's payload against both frozen ceilings.
 * Per-line maxima are reported, not averages: a ceiling is a bound on the worst
 * single line an agent must read, so an average would hide the failure.
 * @param {Array<{dump: string, actionLines: string[]}>} samples one per step
 * @returns {Promise<any>}
 */
export async function measureRun(samples) {
  const e = await encoders();
  if (!e) {
    return { available: false, reason: `js-tiktoken unavailable (${ENC_ERROR?.message ?? 'unknown'})` };
  }
  let dumpMax = { text: '', o200k_base: 0, cl100k_base: 0, worst: 0 };
  let lineMax = { text: '', o200k_base: 0, cl100k_base: 0, worst: 0 };
  let linesMeasured = 0;
  for (const s of samples) {
    const d = await countWorst(s.dump);
    if (d.worst > dumpMax.worst) dumpMax = { text: s.dump, ...d };
    for (const line of s.actionLines) {
      const l = await countWorst(line);
      linesMeasured += 1;
      if (l.worst > lineMax.worst) lineMax = { text: line, ...l };
    }
  }
  return {
    available: true,
    stateDump: {
      ...dumpMax,
      ceiling: CEILINGS.stateDump,
      pass: dumpMax.worst <= CEILINGS.stateDump,
    },
    actionLine: {
      ...lineMax,
      ceiling: CEILINGS.actionLine,
      pass: lineMax.worst <= CEILINGS.actionLine,
      linesMeasured,
    },
  };
}
