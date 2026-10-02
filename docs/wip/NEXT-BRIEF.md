# NEXT-BRIEF: notes behind the next-lane briefings

Branch `lane/NEXT-BRIEF`, cut from `efsp-wp5-correlation` at `99c9577` (S-L20-DONE). Docs only. No test suite and no
Playwright was run, because a full Playwright run was in progress on the machine. The facts below come from reading
and `git grep`.

Output:
- `docs/parallel/next/README.md`: the dispatch table, slot plan, chains, shared files, merge order, and the items that
  need the human;
- the briefings VERSION, MAPKEY, BRIDGE, ESM-GUARDS, DATA-3, AUDIT-GAPS, WIRE-B, and SYNC-B (S and C).

## Facts checked while writing (so the lanes do not re-derive them)

- **Per-frame `version: 1` is load-bearing for the soak.** `tools/soak/driver.js` ~169, `host-core.js` ~138/142 and
  `tests/freeze/freeze-world.mjs` ~69 match literal `'{"version":1,"type":…'` prefixes. That is why VERSION adds a
  separate `WIRE_PROTOCOL` and leaves `version` alone. A bump of `VERSION` would silently disable the soak's fault
  injection.
- **No crc-sync CI job runs `npm test`** (questions-W6 Q6-BC-8, confirmed in `crc-sync-docker.yml`), and `deploy.yml`
  deploys whatever image built. The "production" environment is chosen by branch, and its reviewer is a GitHub
  setting (R3-4).
- `sourcedcs-web` `GET /api/releases/latest` returns `{ win, linux }` parsed manifests. VERSION's gate reads the
  version from it and the protocol from the git tag `crc-desktop-v<version>`, so sourcedcs-web needs no change.
- Tests and the soak call `WsHub._onConnect` directly with fake requests (10 test files). VERSION's check therefore
  sits in `attach()`'s connection listener (`_admit`), not in `_onConnect`.
- The browser WebSocket API cannot read an HTTP status on a refused upgrade (only 1006), but can read an
  application close code. Hence accept, then one `update-required` frame and close 4426.
- MapTiler: `app/maptiler.js` `DEFAULT_MAPTILER_KEY` is still a literal (S-QAC). The style's vector source is a
  TileJSON URL with the key, and `glyphs` also carries it (`sprite` does not). The map is created before login.
  e2e servers set no key today, so specs fetch real tiles with the shipped key.
- The bridge puts **674** names on `window` (fixture), not ≈668. The e2e specs use at most **71** of them, in 32 files
  (whole-word scan, an upper bound). `history` is `app.js`'s exported Map. Sender replacement happens in
  `l15-metrics`, `l2-block-editing` and `helpers/app.js`'s wrap loop.
- Guards on imported names: a narrow scan (named imports only) finds **333 in 45 files** at `99c9577`, against
  L20-BRIEF's 362/52 (a wider scan). ESM-GUARDS re-counts with a saved script.
- `geojson.js`'s `trueHeading` is now at ~677-678, inside `buildExtendedCenterline`. The wanted value is
  `_aprtRwyTrueDeg` (imported, used at ~654). The ticks throw, so the extended centreline is not drawn at all when it
  has ticks.
- `tools-panel.js`'s calculator needs `pressureAtAlt` plus the ISA constants. Their owner is crc-sync
  `src/altimetry.js`. The client has no copy, so ESM-GUARDS adds a hand copy with a parity test (ARCH-D7).
- Duplicated constants: `DAY_MS` is **×6** now (`theater-context`, `metrics`, `mutation-log`, `zulu-time`,
  `ato-board`, `traffic-count`), `MS_PER_KT` ×3, ISA ×2 (`altimetry.js`, `grpc-client.js`).
- The three `test.todo` left in the suites are all covered: crc-sync `wire-skeleton` F1 (AUDIT-GAPS), and crc-desktop
  `module-graph` ×2 (ESM-GUARDS).
- Code `covering` identifiers left: `board/ops/transfer-strip.js`, `board/ops/carrier-handoff.js`, `efsp-ws.js`
  ~274-278.
- U18's comment was already reworded by L20-CORE (it now says what the test does not catch). The stronger test is
  still open, so it is in AUDIT-GAPS.
- Board system audit records written inline: PeerGone (`board/coordination.js`), SystemReassign ×2
  (`board-store.js`), Archive (`board/persistence.js`). Their key orders differ, hence AUDIT-GAPS's "only where the
  bytes stay identical".
- Seq key names after W7: `runwayStatusSeq` (SYNC.md still says `fieldStateSeq`).
- ADR numbers: 0098-0102 are taken by the post-refactor drafts. **0103 VERSION, 0104 WIRE-B, 0105 SYNC-B** are
  assigned here. 0090/0092 stay unused (ARCH-plan). MAPKEY, BRIDGE, ESM-GUARDS, DATA-3 and AUDIT-GAPS write none.
- E2E lanes: UNDO-C 5 and SJ-C 6 were already set. Assigned here: BRIDGE 1, ESM-GUARDS 2, VERSION 3 (then WIRE-B),
  MAPKEY 4 (then SYNC-B-C), CR-C 7, 2P-A 8, 2P-B 9, TOFI-REGIME 0.

## Defaults taken (P2)

- **BRIDGE and ESM-GUARDS run in parallel**, partitioned by file, rather than in sequence. Their only shared files are
  the module-graph test and its fixture, and ESM-GUARDS puts its new tests in a new file. Sequencing them would delay
  every client feature half by a lane-length.
- BRIDGE's mechanism: the specs `import()` the app's modules inside the page (the same module records, live bindings)
  through one test-side helper `window.crc.<module>`. No production test hook.
- VERSION: an exact protocol match; a fail-closed deploy gate with a human-only skip; the protocol is bumped
  mechanically by `wire:record` only when the current number has shipped.
- MAPKEY: `CRCSYNC_MAPTILER_CLIENT_KEY`, falling back to `CRCSYNC_MAPTILER_KEY`, so no operator change is required;
  no key before login; `maptiler.js` and `CRC_MAPTILER_KEY` deleted.
- DATA-3: no weather poll until the theater is known; the comm card in `config/` as a tuning file; `metrics.js`'s
  `DAY_MS` left for the supervisor at UNDO-S's and 2S-A's merge.
- AUDIT-GAPS merges first in wave A, and its registry rows go in a new `authority/narrowing.js` (2S-A owns
  `positions/*.js` in the same wave).
- WIRE-B is one lane editing both sides. SYNC-B splits into S and C, as the other feature lanes do.
- The three human items (S-APP0 soak, the TIME-B follow-up, RP-F1) are listed in the README with options and a
  recommendation, not briefed.

## Open questions

None blocking. For the supervisor: whether DATA-3's `metrics.js` `DAY_MS` line and the `wire:record` runs for
pre-VERSION lanes are done at merge by the supervisor (the README's default) or by a small follow-up lane.
