// tests/web/app-bundle.mjs — the shared harness for driving the REAL browser surface
// against a fake DOM, the way tests/kernel/*.test.js have always done.
//
// src/web/app.js boots on import and pulls in a dozen sibling ES modules. The tests that
// need its internals (render, clickCard, pendingSlot, bursts, ...) cannot just `import`
// it: they must (a) install a fake DOM FIRST, and (b) evaluate the app's code as ONE
// sloppy-mode function body so they can stub `createController` with their own seeded
// controller and reach module internals through a `return { ... }` statement — exactly
// the contract the single-file app.js offered.
//
// This module keeps that contract for the split surface by CONCATENATING the app's
// modules into that one function body:
//
//   * every relative import that resolves INSIDE src/web/ is inlined. The import line is
//     dropped and the `export ` prefix is stripped, so all declarations share one scope
//     just as they did in the old single file. Modules are emitted in DFS post-order of
//     the import graph starting at app.js, so every binding exists before the code that
//     runs at "module evaluation" time needs it (app.js — the boot — is emitted last).
//   * every other relative import (../kernel/index.js, ../surface/gui/controller.js,
//     ./card-art.js when it was external, ...) is re-bound from the REAL module through
//     the same `__mods` prelude the tests always used, so kernel facts still come from
//     the kernel. `createController` is filtered out when `stubController` is set: the
//     factory then defines its own.
//
// GUARDS (this is a correctness tool, not hope):
//   * a declared top-level name may appear in at most ONE inlined module — the
//     concatenation would otherwise be a silent redeclaration;
//   * a name may be imported from at most ONE external specifier;
//   * every inlined import statement is fully stripped by the same regexes the tests
//     used on the single file, and the stripped forms are asserted.
//
// Modules written for this harness may therefore use exactly these export forms:
// `export function`, `export const`, `export let` (no default, no re-export lists) and
// named-brace imports only.
import { readFileSync } from 'node:fs';

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const STRIP_IMPORTS_RE = /^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm;
const EXPORT_PREFIX_RE = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm;
const DECL_RE = /^(?:export\s+)?(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const FN_RE = /^(?:export\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/gm;

/**
 * Concatenate the web app for evaluation.
 * @param {URL} appUrl the entry module (src/web/app.js) to start the walk from
 * @param {{stubController?: boolean}} [opts] stubController: leave `createController`
 *   unbound so the factory can define its own (default false)
 * @returns {Promise<{prelude: string, body: string, mods: Object[]}>} `prelude` binds the
 *   external names from `mods`; `body` is the app's code with imports stripped and
 *   exports flattened, ready to be wrapped in `new Function` and extended with a
 *   `return { ... }` statement.
 */
export async function bundleApp(appUrl, opts = {}) {
  const inlined = [];
  const seen = new Set();
  const external = []; // { spec, names: Set } in first-seen order

  function visit(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const src = readFileSync(url, 'utf8');
    const imports = [...src.matchAll(IMPORT_RE)];
    for (const [, , spec] of imports) {
      const target = new URL(spec, url);
      if (target.href.includes('/src/web/')) visit(target); // a sibling module: inline it
    }
    inlined.push({ url, src, imports });
    for (const [, names, spec] of imports) {
      const target = new URL(spec, url);
      if (target.href.includes('/src/web/')) continue;
      let entry = external.find((e) => e.spec === spec);
      if (!entry) { entry = { spec, names: new Map() }; external.push(entry); }
      for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) {
        const [orig, local = orig] = n.split(/\s+as\s+/);
        if (!entry.names.has(local)) entry.names.set(local, orig);
      }
    }
  }
  visit(appUrl);

  // Guard 1: one top-level name, one module.
  const owner = new Map();
  for (const { url, src } of inlined) {
    for (const re of [DECL_RE, FN_RE]) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        const prev = owner.get(m[1]);
        if (prev && prev !== url.href) {
          throw new Error(`app-bundle: "${m[1]}" is declared in both ${prev} and ${url.href}; the concatenated scope would redeclare it`);
        }
        owner.set(m[1], url.href);
      }
    }
  }

  // Guard 2: one external name, one specifier.
  const from = new Map();
  for (const { spec, names } of external) {
    for (const local of names.keys()) {
      const prev = from.get(local);
      if (prev && prev !== spec) {
        throw new Error(`app-bundle: "${local}" is imported from both ${prev} and ${spec}`);
      }
      from.set(local, spec);
    }
  }

  // The body: strip imports, flatten exports.
  const body = inlined.map(({ url, src }) => {
    const stripped = src.replace(STRIP_IMPORTS_RE, '');
    if (IMPORT_RE.test(stripped)) throw new Error(`app-bundle: unstripped import left in ${url.href}`);
    IMPORT_RE.lastIndex = 0;
    return `// ---- ${url.pathname.split('/').pop()} ----\n${stripped.replace(EXPORT_PREFIX_RE, '')}`;
  }).join('\n');

  // The prelude: destructure the external modules' names (minus the stubbed controller).
  const mods = [];
  const lines = [];
  for (const { spec, names } of external) {
    const bound = [...names.entries()]
      .filter(([local]) => !(opts.stubController && local === 'createController'))
      .map(([local, orig]) => (local === orig ? local : `${orig}: ${local}`));
    if (bound.length === 0) { mods.push(null); continue; }
    mods.push(await import(new URL(spec, appUrl)));
    lines.push(`const { ${bound.join(', ')} } = __mods[${mods.length - 1}];`);
  }
  return { prelude: lines.join('\n'), body, mods };
}
