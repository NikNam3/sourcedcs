# HULL-STRICT (H127)

The carrier hull config (`config/efsp-carriers.json`, a `state/efsp-carriers.json` copy, or the test override
`CRCSYNC_EFSP_CARRIERS_PATH`) refuses start-up on a key this build does not know, at every level (top, per hull,
`match`), naming the file and the key path. `_comment`-style keys stay free at any level.

- `crc-sync/src/persisted-shape.js` (new leaf): the shape walker and `anyOf`/`arrayOf`/`mapOf` that `stores.js`'s
  `checkPersistedShape` used, moved out unchanged (Board snapshot messages identical) so `hull-config.js` reuses it
  without a `stores.js` ↔ `hull-config.js` require cycle. Adds `freeUnderscore`.
- `crc-sync/src/efsp/carrier/hull-config.js`: `CARRIERS_SHAPE` = `{ hulls: [{ hullId, label, angledDeckDeg, match: { unitName, type, coalition } }] }`,
  checked after the parse and before `validateHullConfig`.
- Message: `[efsp-carriers] <file> has an unknown key "hulls[].approach" (this build's hull config has no such key; an older build's, e.g. the removed hull "approach"?): delete it`
- Tests: `crc-sync/tests/hull-config-strict.test.mjs` (7).
- Docs: `docs/efsp-briefing.md` §4 `state/` notes row now says the key refuses start-up. `docs/efsp-usage-guide.md` has no such sentence.

## Defaults taken
- The key path names the hull array as `hulls[]` (no index or hull id), matching the Board snapshot's notation.

## Findings for other lanes / supervisor docs pass
- `docs/efsp-briefing.md` l.97 describes the hull file as "(id, radars, callsign, angled deck…)"; the real keys are
  `hullId`, `label`, `match` (`unitName`/`type`/`coalition`) and `angledDeckDeg`. Not this lane's line.
- `docs/wip/CARRIER-FOLLOWUP.md` default 3 is now answered (H127).
- CLAUDE.md's "`state/` is strict" sentence could name the hull config too (supervisor's file).
