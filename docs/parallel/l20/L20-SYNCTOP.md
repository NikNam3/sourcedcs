# L20-SYNCTOP: comments in crc-sync's top level, surveillance, the soak harness and the config notes

> Read [README.md](README.md) first (rules 1-12, the tools, the row map). `docs/parallel/decisions.md` wins over this
> briefing; the code on your base wins over its line numbers.

| | |
|---|---|
| Wave | 1 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L20-SYNCTOP` on `lane/L20-SYNCTOP` |
| Model / size | Sonnet 5.5 / M: ~63 crc-sync files and 13 config JSONs, 2,305 crc-sync comment lines, 14 stale pointers, 7 `board-store` lines, 51 vocab hits, 17 rows (most of the L9 C-group and the U-rows live here); atobrief/sourcedcs-web/miztoyaml are check-only |
| Wip | `docs/wip/L20-SYNCTOP.md` |
| ADR / E2E lane | none / none |

## Goal

crc-sync's composition root (`server.js` → `src/app.js` `createApp()`, named tickers), its non-EFSP modules
(surveillance, Conflict Alert, theaters, mission clock and session, logging, auth, collab), the soak harness and the
shipped config notes carry true pointers, the new vocabulary, and the `[SOURCE-DEFINED]` markers L9 and the prep asked
for. The other services are checked for anything L20 must touch (expected: one comment in `tools/miztoyaml`).

## Owns

- `crc-sync/server.js`, `crc-sync/src/*.js` (top level: `app.js`, `conflict-alert.js`, `coverage.js`, `ws-hub.js`,
  `theater-context.js`, `theaters.js`, `mission-clock.js`, `mission-session.js`, `altimetry.js`, `radars.js`,
  `state-paths.js`, `tuning-file.js`, `log.js`, `auth.js`, `collab-*.js`, `grpc-client.js`, `srs-client.js`,
  `terrain.js`, `magnetic.js`, `tracks.js`, `test-reset.js`, ...), `crc-sync/src/surveillance/**`,
  `crc-sync/tools/**`, `crc-sync/Dockerfile` comments.
- `crc-sync/config/*.json` **except** `efsp-facility-*.json`: edit inside existing `_comment`/`_note` strings, or add a
  `_comment` key only to a file read through `tuning-file.js` (check the loader first; the tuning loader skips `_`
  keys). `crc-sync/data/**` likewise.
- Comments in `tools/miztoyaml/**`, `atobrief/**`, `sourcedcs-web/**` (check-only; edit only a row below).
- `docs/wip/L20-SYNCTOP.md`, `docs/wip/L20-SYNCTOP/**`. Comments and `_comment` text only.

## Frozen for you

`crc-sync/src/efsp/**` (four other lanes), `crc-sync/tests/**`, `config/efsp-facility-*.json`, `infra/**`,
`.github/**`, every string and value (`tools/soak/report.js`'s copied 2000/5000 is a code finding, README "Not L20").

## Steps

0. **Step 0** as in the README (`(cd crc-sync && npm ci)`, `nice npm test`, tools, counts, `--sites L20-SYNCTOP`
   (ignore atobrief/sourcedcs-web "claim"/"role" hits: JWT and Casdoor senses), markers, "Code as found", step-0 note).
1. **Surveillance and alerting rows.** C1 (`config/alerting.json` `_comment`: insert the literal token, "Our own
   choices" → `[SOURCE-DEFINED]: our own choices, not doctrine`; the key is `conflictAlert` now, so "STCA" in the note
   becomes "Conflict Alert (CA)"), C5 (`surveillance/transponder.js` synthetic block bullet, ADR 0059), C7
   (`conflict-alert.js`, formerly `stca.js`: marker for the prediction model, thresholds and ATC-only scoping, ADR
   0058/0059), C8 (`surveillance/presentation.js` header marker), C9 (`surveillance/iff.js` header: L10 has merged;
   `[SOURCE-DEFINED] (docs/adr/0066, 0084) — the automatic-IFF rules are ours`), D9 (`surveillance/datalink.js` "the
   way Link 16 PPLI does" → "loosely modelled on a Link 16 PPLI, not a model of one"), U9 (`presentation.js`
   `SCHEME_HOLD_SWEEPS = 2`: `[SOURCE-DEFINED] (docs/adr/0088, H41/H71)`). Commit.
2. **Config and session rows.** U1 (`config/efsp-instrumentation.json`: literal token; retention is not a guide
   requirement, cite guide D-6 and ADR 0065), U2 (`config/sensor-specs.json` `_comment`: add the `presentation`
   section: which scheme (ATC/TACTICAL) draws a contact a radar kind sees, `[SOURCE-DEFINED]`, ADR 0088), L19
   (`config/efsp-surveillance-hints.json` note: thresholds `[SOURCE-DEFINED]`, ADR 0076, if not already), U5 (the
   18,000 ft fallbacks left after TA in `theater-context.js` (`DEFAULT_TRANSITION_ALT_FT`), `altimetry.js`,
   `surveillance/index.js`: comment each as the fallback for "no `theater` message yet", `[SOURCE-DEFINED]`; re-grep
   `18000` first, TA removed several), U12 (`mission-session.js` `CLOCK_STEP_BACK_MS`, `CLOCK_ROLL_ADOPT_MS`:
   `[SOURCE-DEFINED] (docs/adr/0086)`; `LAST_AT_PERSIST_MS` is engineering). Commit.
3. **Soak and pointers.** U14 (`tools/soak/report.js` `THRESHOLDS`: "soak pass/fail thresholds, SOURCE's own; guide
   §7.9's 200 ms excepted"; the key-length 40 mirrors `order-key.js`), `report.js:20` `// board-store _pruneLog`
   (gone: `sync/sync-log.js` `RING_MAX`), `tools/soak/host-*.js` comments that describe patching `_touch`/`_log` or
   wrapping board-store privates (SYNC replaced them with `observeTouches`; `host-core.js` still wraps
   `_rebalanceRack` by name: say so plainly), `mission-clock.js:15` `theater-offsets.js` (gone: `theaters.json`
   through `theaters.js`), `app.js`/`server.js` headers (the composition root, `createApp`, named tickers, ADR 0095
   §4), `ws-hub.js:283` "original app/src/ws-server.js protocol" (history; keep only if a reader needs it),
   `state-paths.js:15` (already "since removed": keep). Commit.
4. **Vocabulary and other services.** crc-sync hits (FDR, TWR/GND/APP, covering, "held a Position", STCA). Then U16
   (`tools/miztoyaml/build_doc.py` `TANKER_AR_SYSTEM`: a `#` comment "(DCS module facts, not from the guide)"; do not
   touch the docstring, the codecheck counts docstrings as code). atobrief `usmtf-ato.js` L11 markers: keep. Write
   one line per other-service hit kind as "kept sense". Commit.
5. **Close.** `node --check`; codecheck `comment-only` (it parses the JSONs and ignores `_comment`/`_note` keys);
   `node --test tests/clock-policy.test.mjs tests/tuning-layer-keys.test.mjs tests/theater-context.test.mjs
   tests/efsp-instrumentation-config.test.mjs tests/efsp-surveillance-hints.test.mjs`; `nice npm test` once; and
   `npm run soak:selfcheck` is **not** needed (comment-only, proven). Counts, row table, report.

## Acceptance

- codecheck `comment-only`; crc-sync `npm test` identical before → after.
- L20-SYNCTOP column (crc-sync part): stale pointers 0 (or listed); 7 `board-store` lines verified; vocab reworded or
  covered; markers ≥ 12 and rising (C1, C5, C7, C8, C9, U1, U2, U5, U9, U12, U14).
- No `_comment` key added to a file whose loader does not skip `_` keys (name the loader for each JSON you touched).

## Defaults (P2)

- A `_comment` that grows past ~3 sentences is split into `_comment` and `_note` (both skipped by the tuning loader)
  rather than a new file.
- History in the composition root ("this used to live in server.js") is deleted: ADR 0095 §4 is the history.
