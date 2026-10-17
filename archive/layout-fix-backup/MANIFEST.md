# layout-fix-backup — rollback point (Deliverable 1)

Recorded before any edit to the two harness files. `web/style.css` is copied too because the
task that owns the CSS fix needs a pre-change copy; **no CSS file was touched by this task**
(hash `be3db6a6…` below must still match the live `web/style.css` — any drift is the other
task's edit, not this one).

- UTC timestamp: 2026-10-15T01:14:38Z
- Working dir: project root (sibling of `ux-fix-backup/`)
- No git repo in this workspace; disk-copy rollback per `LAYOUT-ACCEPTANCE.md` S7.

## Commands used (verbatim)

```bash
mkdir -p layout-fix-backup
sha256sum web/style.css tools/dev/viewport-check.mjs tools/dev/space-check.mjs
stat -c "%n %s bytes" web/style.css tools/dev/viewport-check.mjs tools/dev/space-check.mjs
date -u +"%Y-%m-%dT%H:%M:%SZ"
cp web/style.css layout-fix-backup/style.css
cp tools/dev/viewport-check.mjs layout-fix-backup/viewport-check.mjs
cp tools/dev/space-check.mjs layout-fix-backup/space-check.mjs
sha256sum layout-fix-backup/style.css layout-fix-backup/viewport-check.mjs layout-fix-backup/space-check.mjs
```

Backup hashes re-checked after copy: identical to the originals (recorded above in
`sha256-before.txt` and re-printed by the command transcript in the final report).

## Manifest

| original path | backup path | sha256 | bytes | UTC timestamp |
|---|---|---|---|---|
| `web/style.css` | `layout-fix-backup/style.css` | `be3db6a601012afae180b9a6d592aeb1d670e51c157e56c9858ecf355ea853c8` | 93092 | 2026-10-15T01:14:38Z |
| `tools/dev/viewport-check.mjs` | `layout-fix-backup/viewport-check.mjs` | `300597437f279fcb88ceab8ee15d8ad303866c2fefa5c2a547dca8f160f5468d` | 10914 | 2026-10-15T01:14:38Z |
| `tools/dev/space-check.mjs` | `layout-fix-backup/space-check.mjs` | `f5ee0cd51074d4b824b9acfc73042e3a22cf9b4333c71225453842e9e0df58db` | 6414 | 2026-10-15T01:14:53Z |

## CORRECTION — `style.css` above is NOT the baseline of the laptop-tier fix

QA caught a false S7 claim. `layout-fix-backup/style.css` (`be3db6a6…`) is the state before
**any** layout work, and it contains **no `@media (min-width: 901px)` rule at all**. The
laptop-tier fix was made from a later file, so restoring `style.css` would produce a tree that is
neither pre-fix nor post-fix. The intermediate baselines are now preserved and hashed here.

Baselines are **cumulative** — pick the one matching what you want to undo:

| restore point | sha256 | bytes | what restoring it undoes |
|---|---|---|---|
| `style.css` | `be3db6a601012afae180b9a6d592aeb1d670e51c157e56c9858ecf355ea853c8` | 93092 | **everything** — state before any layout work |
| `style.css.pre-layout-fix` | `521910b01b9f4cfb465c863e2536b903061bcac8011c531c10bff58303dede5d` | 96264 | the laptop/desktop tiers (undoes the 1366×768 + 1280×800 fix) |
| `style.css.known-good` | `620c974f5c2be4bc6accd181cab32c86dd32e641baca8d1635664bc8ee5684c8` | — | the touch-target, typography, parse and spill-gate work (keeps the viewport fix) |
| `style.css.pre-touch-fix` | `8f346ee5fcc1043e282bc1857fd6ee8897885cb452f990556102e7e157dc6d4a` | — | only the 44px touch-target fix |

Caveat recorded honestly: `style.css.pre-layout-fix` was recovered from `/tmp/style.css.orig`
before `/tmp` was cleaned; it is the pre-image of the *second* fix round, not of the very first
session. All four hashes above are complete (re-verified with `sha256sum` for this manifest), not
abbreviated.
