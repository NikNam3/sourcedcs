# L20-DOMAINS wip

## Code as found (base 277e65f)
- Owns: 29 files, 2,078 comment lines; stale pointers 1 file (`_handleAtoMutation`), 22 `board-store` lines, vocab 87 sites (FDR 51, TWR/GND/APP 18, field state 6, claim 4, occupied 2, station 2, Role 1), SOURCE-DEFINED markers 42.
- codecheck self vs HEAD: comment-only. crc-sync `npm test` before: 2118 tests, 2117 pass, 0 fail, 1 todo.

## Final counts (base 277e65f -> HEAD)
| | before | after |
|---|---|---|
| stale file / `_method` pointers | 1 / 0 | 0 / 0 |
| `board-store` lines | 22 | 7 (all name the `BoardStore` class, which still exists: `applyMutation`, the audit contrast) |
| vocab sites | 87 | 10, all kept senses: "claim" (tokenizer/rack/key claims, not JWT), "on-station" (USAF), "occupied" Marshal slots, `CV_APP1/2` lanes |
| `[SOURCE-DEFINED]` markers | 42 | 48 |
codecheck `comment-only: no code change`. crc-sync `npm test` 2118 / 2117 pass / 0 fail / 1 todo, before and after; crc-desktop 883 / 881 pass / 0 fail / 2 todo.

## Rows
C12 done (`airspace-store.js` authority comment, marker + docs/adr/0036, example Position is AP). D8 done (taxonomy sentences, "Turkey publishes"/"outside the US" dropped). U3 done (`activeEndIntoWind`, marker H22/S-L1d; the store only calls it). U11 done (`BINGO_FIELD_MAX_LEN` engineering bound; the 1 deg step exists as `shipStateChanged`'s `headingStepDeg = 1`, named and marked). U17 done (before L7 / H39 history). C-10 done (marker on `RUNWAY_GATED_STATES`, plus one on `RUNWAY_CHANGE_STATES`). `ato-board.js` `_handleAtoMutation` -> `wire/families/ato.js`. All 22 board-store lines verified and re-pointed (`board/ops/set-block.js`, `board/strip-ops.js`, `board/ops/carrier-handoff.js`, `board/ops/create-strip.js`, `board/audit.js`, `sync/replay-cache.js`, index.js rule). `efsp-ws.js` verification claims -> `wire/skeleton.js` gate. FDR (51) -> flight data; TWR/GND/APP -> LC/GC/AP; field state -> runway status; carrier "transfer" -> handoff (guide quotes and the string at `handoffs.js:88` kept).

## Re-sweep (c12cd7c..HEAD on Owns)
| Item | Classification |
|---|---|
| `carrier-store.js` / `sfa-store.js` `TRANSITIONS_CAP` 200 / 100 | engineering bound, said so |
| `carrier/sun.js` `NIGHT_BELOW_DEG = -6` | ours, marked in its header (kept) |
| `carrier/handoff-effects.js` "holds no carrier doctrine" | not a claim; board-store pointer fixed |
| `carrier/handoffs.js` markers (H30 lane parity, Case I row, labels) | ours, marked (kept) |
| `runway-status.js` hung-ordnance "local practice at one base, not doctrine" | ours, marked (kept) |
| `ship-state.js` "9 deg ... the commonly published figure" | overclaim: reworded "SOURCE's adopted figure"; 1 deg step marked |
| `flight-record.js` "the common DCS radio preset range" | overclaim: reworded "SOURCE's choice" |
| `flight-record.js` header "L17 adds it to defaultMilitary()" | false (namespace created by `setCarrier`): rewritten |
| `airspace-config.js` altitude 0..100000 ft, frequency 30..400 MHz | engineering bounds on typed input, said so |
| `runway-status.js` `RUNWAY_CHANGE_STATES` | ours, marked |
| marshal-stack numbers (6, 15, 60 s, 10 s, 2 ft) | sourced (guide §9.12, "binding", default) |
New markers since prep in Owns: carrier/handoffs.js, sun.js, runway-status.js, handoff-effects.js (listed above); none lacked a marker.

## Mirror lines
- `crc-desktop/app/public/js/panels/efsp/runway-status-rules.js`: the button label set (CLOSE/OPEN/WORKS/WRK DONE/INSP OK/ACCEPT/REJECT/REQ CLS/REQ WRKS/REQ OPEN/CHG RWY/SELF CHG/ACK/WITHDRAW/BEGIN) and `RUNWAY_STATUS_SUSPENSION_LABELS` need `// [SOURCE-DEFINED] (decisions.md Q40)` on that side; server wording of the gated state set: "which states count as using the runway is our reading of rule 1".
- `marsa-badge.js:88` (L20-CLIENT): "unretractable-badge problem this codebase already has once" is stale since L7; suggested: "the problem forwarding-obligations.js had before L7 (decisions H39)".
- `scramble.js` / `ordnance-advisory.js`: meaning unchanged, no Mirror line.

## Findings (not fixed; strings/code)
- L20-STR: `runway-status-store.js` strings "no field state at ...", "field state is at rev ...", log "unset until the wind or TWR sets it"; `marsa-store.js` / `carrier-store.js` "unknown FDR ..." strings.
- Ordinal claims "FIFTH/SIXTH/EIGHTH store" in store headers do not agree (carrier says sixth but lists runway-status as a peer): ADR numbering, left; for L20-GUIDE if wanted.
- `docs/adr/0036:11` uses APP (old id), expected under the glossary; no errata.

## Defaults taken (P2)
Guide §9.12-cited carrier numbers treated as sourced; "SOURCE practice" strings untouched; no byte-chasing of client mirrors.
