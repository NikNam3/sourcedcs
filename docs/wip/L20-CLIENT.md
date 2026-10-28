# L20-CLIENT wip

## Report
Branch lane/L20-CLIENT, base 277e65f. Codecheck: comment-only: no code change (run from worktree root).
Scan CLIENT column before -> after: comment lines 4151 -> 4170ish, stale file ptr 30 -> 0 real (scanner still flags
`obligations.js` no longer; see Kept below), stale _method 5 -> 1 (`_ord`, kept), board-store lines 27 -> 3 (all verified:
`board-store.js` getRack, double-tap map, module comment on orderKey), vocab 139 -> 6 (kept senses), module.exports 4 -> 0,
SOURCE-DEFINED 26 -> 36.
Tests: crc-desktop npm test 883/881 pass/0 fail/2 todo before and after; crc-sync npm test 2118/2117/0/1 after.
Rows: C14, C15 (W4A wording from L20-WIRE), D2 (comment only: the quoted message is not a client string; the server's
placement.js comment "doctrine check" is L20-BOARD's), D6, U7, U10, U17, C-1, C-10 (label set, suspension labels Q40,
RWY chip state set), C-13 (comment says fallback; removal is a UI lane's).
Kept-because: `_ord` (history clause); claim x3 (not JWT, "claimed" prose); station x3 (ON_STATION, on-station time,
"station-derived"); `held`/holding left where it means ownership of a Strip.

## Step 0 (base 277e65f)
l20scan CLIENT column: files 54, comment lines 4151, stale file ptr 30, stale _method ptr 5, board-store mention 27,
vocab total 139 (FDR 32, Role 32, TWR/GND/APP 47, held/hold Position 9, field state 7, station 3, module.exports 4,
occupied/manned 1, claim 3, SQUAWK label 1), SOURCE-DEFINED markers 26.
Baseline crc-desktop `npm test`: 883 tests, 881 pass, 0 fail, 2 todo.

## Code as found
Native ES modules throughout; headers still describe the removed module.exports guard / script order (ESM-1).
Always-true typeof guards remain (ESM-GUARDS's, untouched).

## Mirror lines (received)
- WIRE C14/C15 (efsp-nla.js): matched, wording pasted verbatim.
- CORE time-chains.js hunks 1-3: matched, byte for byte; comments now identical to CORE's server copy except the module guard.
- DOMAINS runway-status-rules.js label set / SUSPENSION_LABELS Q40: matched ([SOURCE-DEFINED] (docs/adr/0068) and (decisions.md Q40)).
- DOMAINS marsa-badge.js U17: matched (reworded as before-L7 history).

## Findings
- Server comments name functions that no longer exist (found while verifying pointers): `board/strip-ops.js:119,324,344` and
  `traffic-count.js:98` use `_rejectedReplicaOpRefusal`/`_isRejectedReplica`; `authority/strip-types/departure.js:30`
  `_validateBayImpliedTransition` (now `Placement#validateBayImpliedTransition`); `board/persistence.js:44`, `board/tofi.js:343`
  `_retireStrip` (now `StripOps#retire`); `order-key.js:81` `_resolveOrderKey` (now `Placement#resolveOrderKey`). Owners: L20-BOARD / CORE / WIRE.
- `panel/refusal.js` and other client files still carry ESM-GUARDS `typeof` guards (untouched).
- `bay/popovers/airspace-entry.js` has a misplaced comment (the "Strip awaiting a second press on Convert to Arrival" text sits under the airspace-entry one): UI lane.
## ADR errata
## Defaults taken
- `permission.js`/`nla.js` pointers name the owning `authority/**` file; `board-store.js getRack` kept (the facade still has it).
- Vocab done by a comment-only regex pass (LC/GC/AP, flight data, strip type, runway status) then reviewed by diff.
- `efsp-tactical-client.test.js` (no such test) -> `client-mirror-parity.test.mjs`.
