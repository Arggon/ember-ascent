# Ember Ascent

Agent-playable roguelike deckbuilder — browser demo, zero runtime dependencies.

- 1 act, 42 cards, 6 enemies, 1 boss (The Guardian)
- Deterministic: run = pure function of seed (`?seed=7`)
- Plain ES modules + CSS, no build step, no network calls

## Play

```sh
npm install
npm run serve
# open http://localhost:5173/src/web/index.html?seed=7
```

Or serve the repo root with any static server and open `src/web/index.html`, or see
`release/` for the self-contained itch.io build. Terminal play: `./scripts/play.sh`
(or the `dlb` CLI in `bin/`).

## Develop

```sh
npm test        # node --test 'tests/**/*.test.js'  (Node >= 24)
npm run gate    # architecture gate: scripts/check-architecture.mjs
node scripts/check-surface-art.mjs   # static CSS/markup checks for src/web/
node scripts/build-release.mjs       # regenerate release/
```

## Repository layout

```
.
├── README.md, AGENTS.md, package.json, package-lock.json, .gitignore
├── bin/                 dlb CLI entry point (npm "bin")
├── src/
│   ├── kernel/          deterministic game rules, content, RNG, run records
│   ├── surface/         CLI / GUI controllers, sessions, policies, sim
│   └── web/             browser renderer (index.html, app.js, style.css, card art)
├── assets/
│   └── fonts/           bundled OFL web fonts + licence texts (loaded by src/web/)
├── tests/               node:test suites (kernel, cards, content, golden, history, ux, qa-layout-fix)
├── scripts/             build, gate, content-gen, serve, token-measure, play.sh
│   └── dev/             dev-only probes, browser captures, layout-contract harnesses
├── docs/
│   ├── guides/          PLAYING, AGENT-PLAY-GUIDE, ITCH-UPLOAD
│   ├── specs/           requirements, UX spec, LAYOUT-ACCEPTANCE (layout contract)
│   ├── status/          per-phase / per-fix status reports and verification logs
│   ├── research/        market and genre research
│   ├── team/            TEAM.md (agent team playbook)
│   ├── evidence/        release, simulation and sample-run evidence
│   └── RELEASE-NOTES.md
├── archive/             pre-change backups kept for reference (not built or tested)
└── release/             generated itch.io artifact (scripts/build-release.mjs)
```

See [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md), [docs/guides/PLAYING.md](docs/guides/PLAYING.md),
[docs/guides/AGENT-PLAY-GUIDE.md](docs/guides/AGENT-PLAY-GUIDE.md) and the layout contract
[docs/specs/LAYOUT-ACCEPTANCE.md](docs/specs/LAYOUT-ACCEPTANCE.md).
