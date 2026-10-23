# animation-move-backup — rollback point

Recorded before any edit for the per-card hero combat movement change (hero attack/defend
animations keyed to the played card). Pre-change copies of the three files that task edits,
per `docs/specs/LAYOUT-ACCEPTANCE.md` S7.

- UTC timestamp: 2026-10-22T23:47:00Z (recording time; copies taken then)
- Working dir: project root (sibling of `layout-fix-backup/`, `ux-fix-backup/`)
- Content verified byte-identical to git `HEAD` at copy time:
  `app.js` → `98f25ca2…`, `style.css` → `6bfc0c13…`, `check-surface-art.mjs` → `3fe0b293…`

## Manifest

| original path | backup path | sha256 |
|---|---|---|
| src/web/app.js | animation-move-backup/app.js | 98f25ca22ca1da372344663602c1ee9664c6a4186375825a9c9e2809d6024c54 |
| src/web/style.css | animation-move-backup/style.css | 6bfc0c132f743cce0714fa365c9b6a2513e63e0a462ba474a80003be108ca903 |
| scripts/check-surface-art.mjs | animation-move-backup/check-surface-art.mjs | 3fe0b293f7b0e40240150c8f3d6aa8a6c2e4a655b4b8b88f3a3ed124dbd815f0 |

`SHA256SUMS.txt` uses the flat backup filenames, so `sha256sum -c SHA256SUMS.txt` works
from inside this directory.

## Restore (verbatim)

```bash
cp animation-move-backup/app.js src/web/app.js
cp animation-move-backup/style.css src/web/style.css
cp animation-move-backup/check-surface-art.mjs scripts/check-surface-art.mjs
```
