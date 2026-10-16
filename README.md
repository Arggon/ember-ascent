# Ember Ascent

Agent-playable roguelike deckbuilder — browser demo, zero runtime dependencies.

- 1 act, 42 cards, 6 enemies, 1 boss (the Slag Warden). The hero is the Ashwright.
- Deterministic: run = pure function of seed (`?seed=7`)
- Plain ES modules + CSS, no build step, no network calls

## Play

```sh
npm install
npm run serve
# open http://localhost:8080/?seed=7
```

Or open `web/index.html` via a static server, or see `release/` for a self-contained build.

See `RELEASE-NOTES.md`, `PLAYING.md`, `docs/AGENT-PLAY-GUIDE.md`.
