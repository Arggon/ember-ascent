// CLI adapter — argv parsing and stdout/stderr formatting ONLY (R1, R8).
//
// No game logic lives here. Everything this file prints was produced by the kernel
// through surface/session.js, which is also what the DOM-free GUI controller calls.
// That is the R1 guarantee made mechanical: both surfaces format kernel output,
// neither one owns it.
//
// stdout carries machine output only. Diagnostics, errors and truncation notices go
// to stderr, because an agent parsing stdout must never have to filter noise.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  begin,
  submit,
  legal,
  view,
  actionLines,
  runHash,
  malformed,
  saveText,
  saveObject,
  loadObject,
  parseLog,
  assertReplay,
  replay,
  renderLog,
  EXIT,
} from './session.js';
import { measureRun, CEILINGS } from './tokens.js';

/** Common flags accepted by every subcommand. */
export const COMMON = {
  '--run': { type: 'path', default: './run.json', desc: 'save file to read/write' },
  '--json': { type: 'bool', default: false, desc: 'emit machine JSON instead of text' },
  '--timeout': { type: 'int', default: 10000, desc: 'watchdog in ms (surface-level, exit 6)' },
  '--max-lines': { type: 'int', default: 0, desc: 'truncate stdout to N lines (0 = unlimited)' },
};

/** Per-subcommand flag specs. Types and defaults are printed by --help. */
export const SPECS = {
  new: { ...COMMON, '--seed': { type: 'int', default: 0 }, '--character': { type: 'string', default: 'ironclad' }, '--difficulty': { type: 'int', default: 0 }, '--kindling': { type: 'bool', default: false }, '--tempers': { type: 'bool', default: false }, '--quests': { type: 'bool', default: false }, '--biome': { type: 'string', default: 'foundry' } },
  state: { ...COMMON, '--brief': { type: 'bool', default: false }, '--verbose': { type: 'bool', default: false }, '--tokens': { type: 'bool', default: false } },
  actions: { ...COMMON },
  play: { ...COMMON },
  save: { ...COMMON },
  load: { ...COMMON },
  replay: { ...COMMON, '--assert': { type: 'bool', default: false }, '--hash-every': { type: 'int', default: 1 }, '--hash-alg': { type: 'string', default: 'sha256' } },
  sim: { ...COMMON, '--runs': { type: 'int', default: 100 }, '--seed-start': { type: 'int', default: 1 }, '--policy': { type: 'string', default: 'greedy' }, '--threads': { type: 'int', default: 1 }, '--out': { type: 'path', default: null } },
  stats: { ...COMMON, '--from': { type: 'path', default: './sim-out' }, '--by-card': { type: 'bool', default: false }, '--format': { type: 'string', default: 'table' }, '--provenance': { type: 'string', default: 'heuristic' } },
};

const EXIT_TABLE = `exit codes
  0  success
  1  internal error
  2  illegal action (legal no-op, counted as malformed)
  3  usage / flag / seed error
  4  corrupt or version-incompatible save
  5  replay mismatch
  6  timeout`;

const USAGE = `dlb — agent-playable deckbuilder, headless CLI

usage: dlb <command> [flags]

commands
  new --seed N --character S --difficulty N   start a run, write --run (S: ironclad | bellows)
      [--kindling] [--tempers]                opt in to act-start boons (k<n>) / rest tempers (t<n>)
      [--quests]                              opt in to three seeded ember quests (side goals)
      [--biome mines]                         the Cinder Mines: alternate backdrop and enemy set
  state [--brief|--verbose]                   current observation (R4 dump)
  actions                                     legal actions, one per line (R5)
  play <id>                                   apply one action id
                                              multi-enemy: p<N>_<K> aims card N at enemy K
                                              (1-based, living enemies only; p<N> works alone)
  save <path>                                 write the run save
  load <path>                                 restore a run save
  replay <log> [--assert] [--hash-every N]    re-run an action log
  sim --runs N --seed-start S --policy P --threads T [--out DIR]
  stats --from <dir> --by-card [--format table|json|csv]

common flags: --run <path> (default ./run.json)  --json  --timeout <ms> (default 10000)  --max-lines N
global: --help [--json]

${EXIT_TABLE}

copy-pasteable full run
  $ dlb new --seed 7 --character ironclad --difficulty 0
  $ dlb state
  $ dlb actions
  $ dlb play n1
  $ dlb play p1
  $ dlb play p2_1        (two enemies: hand slot 2 at the 1st living enemy)
  $ dlb play e1
  $ dlb state`;

/**
 * Parse argv against a flag spec without touching process.argv.
 * @param {string[]} argv
 * @param {Record<string, any>} spec
 * @returns {{ok: true, flags: any, positional: string[]} | {ok: false, problems: string[]}}
 */
export function parseArgs(argv, spec) {
  const flags = {};
  for (const [name, def] of Object.entries(spec)) flags[name] = def.default;
  const positional = [];
  const problems = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      flags['--help'] = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    let name = token;
    let inline = null;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      name = token.slice(0, eq);
      inline = token.slice(eq + 1);
    }
    const def = spec[name];
    if (!def) {
      problems.push(`unknown flag "${name}"`);
      continue;
    }
    if (def.type === 'bool') {
      if (inline === null) flags[name] = true;
      else if (inline === 'true' || inline === 'false') flags[name] = inline === 'true';
      else problems.push(`flag "${name}" is boolean; got "${inline}"`);
      continue;
    }
    let value = inline;
    if (value === null) {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined) {
      problems.push(`flag "${name}" needs a value`);
      continue;
    }
    if (def.type === 'int') {
      const n = Number(value);
      if (!Number.isInteger(n)) problems.push(`flag "${name}" needs an integer; got "${value}"`);
      else flags[name] = n;
    } else {
      flags[name] = value;
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, flags, positional };
}

/** Help text for one subcommand, self-documenting per R8. */
export function helpText(cmd) {
  const spec = SPECS[cmd];
  const flagLines = Object.entries(spec)
    .map(([name, def]) => `  ${name}${def.type === 'bool' ? '' : ` <${def.type}>`}  default ${JSON.stringify(def.default)}`)
    .join('\n');
  return `${USAGE}\n\nflags for "${cmd}"\n${flagLines}`;
}

/** Machine form of help: the same data, marked as machine data (R8). */
export function helpJson(cmd) {
  return JSON.stringify(
    {
      command: cmd,
      flags: Object.fromEntries(
        Object.entries(SPECS[cmd]).map(([name, def]) => [name, { type: def.type, default: def.default }]),
      ),
      exitCodes: { ok: 0, internal: 1, illegal_action: 2, usage: 3, corrupt_save: 4, replay_mismatch: 5, timeout: 6 },
      common: COMMON,
      example: [
        'dlb new --seed 7 --character ironclad --difficulty 0',
        'dlb state',
        'dlb actions',
        'dlb play n1',
        'dlb play p1',
        'dlb play e1',
      ],
    },
    null,
    2,
  );
}

/** Raised by a command to end the process with a specific class. */
export class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Read a save file; a missing or malformed file is a corrupt-save class failure. */
function readSave(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new CliError(`cannot read save "${path}": ${e.message}`, EXIT.corruptSave);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CliError(`save "${path}" is not JSON: ${e.message}`, EXIT.corruptSave);
  }
  const res = loadObject(raw);
  if (!res.ok) {
    throw new CliError(`save "${path}" refused:\n - ${res.problems.join('\n - ')}`, EXIT.corruptSave);
  }
  return res.session;
}

/**
 * Execute one command.
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{write?: Function, writeErr?: Function}} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(cmd, argv, io = {}) {
  const out = io.write ?? ((s) => process.stdout.write(s));
  const err = io.writeErr ?? ((s) => process.stderr.write(s));

  if (cmd === undefined || cmd === '--help' || cmd === 'help') {
    out(`${USAGE}\n`);
    return EXIT.ok;
  }
  if (!SPECS[cmd]) {
    err(`dlb: unknown command "${cmd}"\n\n${USAGE}\n`);
    return EXIT.usage;
  }

  const parsed = parseArgs(argv, SPECS[cmd]);
  if (!parsed.ok) {
    err(`dlb ${cmd}: ${parsed.problems.join('; ')}\n\n${USAGE}\n`);
    return EXIT.usage;
  }
  const { flags, positional } = parsed;

  if (flags['--help']) {
    out(flags['--json'] ? `${helpJson(cmd)}\n` : `${helpText(cmd)}\n`);
    return EXIT.ok;
  }
  if (!Number.isInteger(flags['--timeout']) || flags['--timeout'] <= 0) {
    err(`dlb ${cmd}: --timeout must be a positive integer\n`);
    return EXIT.usage;
  }
  if (!Number.isInteger(flags['--max-lines']) || flags['--max-lines'] < 0) {
    err(`dlb ${cmd}: --max-lines must be a non-negative integer\n`);
    return EXIT.usage;
  }

  try {
    return await dispatch(cmd, flags, positional, out, err);
  } catch (e) {
    if (e instanceof CliError) {
      err(`dlb ${cmd}: ${e.message}\n`);
      return e.code;
    }
    err(`dlb ${cmd}: internal error: ${e?.stack ?? e}\n`);
    return EXIT.internal;
  }
}

async function dispatch(cmd, flags, positional, out, err) {
  switch (cmd) {
    case 'new': {
      const session = begin({ seed: flags['--seed'], character: flags['--character'], difficulty: flags['--difficulty'], kindling: flags['--kindling'], tempers: flags['--tempers'], quests: flags['--quests'], biome: flags['--biome'] });
      writeSave(flags['--run'], session);
      if (flags['--json']) {
        out(`${JSON.stringify({ ok: true, run: flags['--run'], hash: runHash(session), state: summary(session) })}\n`);
      } else {
        out(`new run: seed ${session.state.seed} character ${session.state.character} difficulty ${session.state.difficulty}\n`);
        out(`saved to ${flags['--run']}\n`);
        out(`hash ${runHash(session)}\n`);
      }
      return EXIT.ok;
    }

    case 'state': {
      const session = readSave(flags['--run']);
      const opts = { verbose: flags['--verbose'], brief: flags['--brief'] };
      const text = view(session, opts);
      if (flags['--json']) {
        out(`${JSON.stringify({ ok: true, phase: session.state.phase, hash: runHash(session), dump: text })}\n`);
      } else {
        out(emit(text, flags, err));
      }
      if (flags['--tokens']) {
        const t = await measureRun([{ dump: text, actionLines: [] }]);
        err(`state dump tokens: worst=${t.stateDump?.worst} ceiling=${CEILINGS.stateDump} ${t.stateDump?.pass ? 'PASS' : 'FAIL'}\n`);
      }
      return EXIT.ok;
    }

    case 'actions': {
      const session = readSave(flags['--run']);
      const lines = actionLines(session);
      if (flags['--json']) {
        out(`${JSON.stringify({ ok: true, hash: runHash(session), actions: legal(session) })}\n`);
      } else {
        out(emit(lines, flags, err));
      }
      return EXIT.ok;
    }

    case 'play': {
      const id = positional[0];
      if (id === undefined) throw new CliError('play needs an action id, e.g. `dlb play p1`', EXIT.usage);
      let session = readSave(flags['--run']);
      const res = submit(session, id);
      session = res.session;
      writeSave(flags['--run'], session);
      if (res.error) {
        // R6: stdout stays silent for the no-op; the structured error goes to stderr.
        err(`${JSON.stringify({ error: res.error.error, id: res.error.id, code: res.error.code })}\n`);
        out(emit(view(session), flags, err));
        return EXIT.illegalAction;
      }
      if (flags['--json']) {
        out(`${JSON.stringify({ ok: true, id, phase: session.state.phase, hash: runHash(session), events: res.events })}\n`);
      } else {
        out(emit(view(session), flags, err));
      }
      return EXIT.ok;
    }

    case 'save': {
      const path = positional[0] ?? flags['--run'];
      const session = readSave(flags['--run']);
      writeSave(path, session);
      out(`saved ${path} (stepIndex ${session.state.stepIndex}, hash ${runHash(session)})\n`);
      return EXIT.ok;
    }

    case 'load': {
      const path = positional[0];
      if (path === undefined) throw new CliError('load needs a path, e.g. `dlb load ./run.json`', EXIT.usage);
      const session = readSave(path);
      writeSave(flags['--run'], session);
      out(`loaded ${path} -> ${flags['--run']} (phase ${session.state.phase}, stepIndex ${session.state.stepIndex})\n`);
      return EXIT.ok;
    }

    case 'replay': {
      const logPath = positional[0];
      if (logPath === undefined) throw new CliError('replay needs a log path, e.g. `dlb replay ./run.log.jsonl --assert`', EXIT.usage);
      let text;
      try {
        text = readFileSync(logPath, 'utf8');
      } catch (e) {
        throw new CliError(`cannot read log "${logPath}": ${e.message}`, EXIT.usage);
      }
      const parsed = parseLog(text);
      if (!parsed.ok) throw new CliError(`log "${logPath}" refused:\n - ${parsed.problems.join('\n - ')}`, EXIT.corruptSave);
      if (flags['--hash-alg'] !== 'sha256') throw new CliError(`--hash-alg "${flags['--hash-alg']}" unsupported; the run identity is sha256`, EXIT.usage);

      if (flags['--assert']) {
        const result = assertReplay(parsed, { hashEvery: flags['--hash-every'] });
        if (!result.ok) {
          err(`${JSON.stringify({ error: 'replay_mismatch', checked: result.checked, mismatches: result.mismatches })}\n`);
          return EXIT.replayMismatch;
        }
        out(flags['--json']
          ? `${JSON.stringify({ ok: true, steps: parsed.entries.length, checked: result.checked, finalHash: result.finalHash })}\n`
          : `replay OK: ${parsed.entries.length} steps, ${result.checked} hashes checked, finalHash ${result.finalHash}\n`);
        return EXIT.ok;
      }

      const replayed = replay(parsed.header, parsed.entries);
      out(flags['--json']
        ? `${JSON.stringify({ ok: true, steps: replayed.steps.length, finalHash: runHash(replayed.session) })}\n`
        : `${emit(view(replayed.session), flags, err)}`);
      return EXIT.ok;
    }

    case 'sim': {
      const { simulate } = await import('./sim.js');
      const result = await simulate({
        runs: flags['--runs'],
        seedStart: flags['--seed-start'],
        policy: flags['--policy'],
        threads: flags['--threads'],
        outDir: flags['--out'],
        onProgress: flags['--json'] ? null : (line) => err(line),
      });
      if (flags['--json']) {
        out(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        out(`${emit(result.report, flags, err)}`);
        for (const [k, v] of Object.entries(result.summary)) {
          if (typeof v === 'object' && v !== null && 'worst' in v) out(`${k}: worst ${v.worst} tokens (o200k ${v.o200k_base}, cl100k ${v.cl100k_base})\n`);
        }
      }
      return EXIT.ok;
    }

    case 'stats': {
      const { stats } = await import('./stats.js');
      const result = stats({ from: flags['--from'], byCard: flags['--by-card'], format: flags['--format'], provenance: flags['--provenance'] });
      out(emit(result.text, flags, err));
      return EXIT.ok;
    }

    default:
      return EXIT.usage;
  }
}

/** Write a save with the canonical serialization, then confirm with a fresh read. */
function writeSave(path, session) {
  writeFileSync(path, saveText(session));
}

/** Compact machine summary used by --json on new. */
function summary(session) {
  const s = session.state;
  return {
    phase: s.phase,
    stepIndex: s.stepIndex,
    rngDraws: s.rngDraws,
    hp: s.player.hp,
    maxHp: s.player.maxHp,
    floor: s.floor,
    contentVersion: s.contentVersion,
  };
}

/** Apply --max-lines with an explicit, never-silent truncation notice (R7). */
function emit(text, flags, err) {
  const max = flags['--max-lines'];
  const lines = text.split('\n');
  if (max > 0 && lines.length > max) {
    err(`# truncated: showing ${max} of ${lines.length} lines\n`);
    return `${lines.slice(0, max).join('\n')}\n`;
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

export { saveObject, renderLog, malformed, EXIT };
