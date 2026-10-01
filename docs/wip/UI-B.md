# UI-B — resync wiring, RUNWAY_CHANGE label, observed-departure bypass (S-PARITY, S-L19 open point, S-UIA)

Branch `lane/UI-B-followup`, cut from `lane/UI-A-followup`. `E2E_LANE=2`. No ADR taken: the resync server half is ADR 0081
(unchanged), the rest are label/hook choices recorded here.

**Base note.** PARITY's commits are not in UI-A's branch. I cherry-picked the four PARITY test commits (`653599a`,
`0ef0c42`, `11555ff`, `0478f6d`) so the `test.todo` to flip and the parity tests that must stay green exist here. The
integrator merging PARITY will find them identical (same patches); the only edits on top of them are listed under
"Edits to PARITY's tests".

## 1. Client resync (S-12, ADR 0081)

**What the wire allows.** A Board's seq jumps by more than one per change (a rebalance bumps one per re-keyed Strip), so a
client cannot see a "gap" in a delta's seq. Three real triggers remain, all wired:

| Trigger | Detected by | Answer |
|---|---|---|
| Board epoch changed (server restarted/restored) | any `efsp-board-delta` / `efsp-mutation-ack` whose `boardEpoch` differs from the one held for that Facility | the server answers a different epoch with an `efsp-snapshot` |
| A delta never arrived | `efsp-heartbeat` names the default Facility's seq, ahead of ours on two beats in a row (deltas arrive in order, so after applying them ours must equal it) | an `efsp-board-delta` from our seq (the ring), or a snapshot when too far behind / owned-scope session |
| Reconnect with a Board in hand | `ws.onopen`: every Facility we hold an epoch for | delta or snapshot, as above |

Code: `efsp-state.js` tracks seq and epoch **per Facility** (`efspBoardSeqByFacility/EpochByFacility`, filled from the
snapshot's `boardSeqByFacility/boardEpochByFacility`, advanced by deltas) and exposes `efspEpochChangeOf`,
`efspResyncPositionFor`, `efspHeldBoardFacilities`, `efspHeartbeatGapOf`. `efsp-ws.js`: `sendEfspResync(facilityId)` now
sends `{facilityId, lastBoardSeq, boardEpoch}`; `requestEfspResync` keeps at most one resync per Facility in flight (an
answer is any snapshot/delta; a lost answer is retried after 10 heartbeats, no wall clock). `app.js`: five small calls in
the existing cases (`onopen`, `efsp-snapshot`, `efsp-board-delta`, `efsp-heartbeat`, `efsp-mutation-ack`).

Two bugs fixed on the way: (a) `efspBoardSeq` was overwritten by *any* Facility's delta or ack (a CENTER delta moved
INCIRLIK's seq); (b) an ack's `boardSeq` is **not** adopted any more: its broadcast delta carries the same seq and moves our
position, so a delta lost after its ack still shows as a heartbeat gap. A delta from another epoch is applied but its seq/epoch
are not adopted.

Tests: `ws-message-contract.test.js` todo flipped to "S-12: efsp-resync is wired" (each trigger is called from app.js and reaches
`sendEfspResync`); `ACCEPTED_BUT_NEVER_SENT_BY_UI` is empty. `crc-sync/tests/efsp-scenario-resync.test.mjs` runs the shipped
client files in a vm against a real `createEfsp()`: missed delta -> two heartbeats -> resync -> converge on a delta; a delta from
a restarted server (new `createEfsp()` over the same snapshot) -> snapshot; reconnect with/without a Board.
`crc-desktop/tests/efsp-resync-state.test.js` (per-Facility tracking, epoch flag, heartbeat debounce). Playwright
`ui-b-resync.spec.js`: the socket is killed (the global `WebSocket` is aimed at a dead port, so app.js's own 2 s retry loop
is exercised), another controller creates a Strip meanwhile, the reconnect sends `efsp-resync` carrying the held epoch and seq
and ends with the server's exact Board.

## 2. RUNWAY_CHANGE suspension label

`SUSPENSION_LABELS.RUNWAY_CHANGE = 'runway change in progress'` in `field-state.js` and the client mirror
(`FIELD_STATE_SUSPENSION_LABELS`); reads `runway 05/23 suspended — runway change in progress`. `client-mirror-parity` (labels
deepEqual) stays green; new server and client tests (`efsp-ui-b-hooks.test.mjs`, `efsp-field-state-client.test.js`) pin the
words and that every `SUSPENSION_KINDS` entry has a label. Wording is `[SOURCE-DEFINED]` like the WORKS one.

## 3. Observed departure and the runway suspension (S-L19 open point 1, H19)

**Decision.** The chip's SetState to DEPARTED may bypass the **runway gate** (`_setStateRunwayRefusal`) and nothing else.
Reason: the aircraft is already off the ground; refusing to record it keeps the Board wrong while the controller can do
nothing about the runway. H19 stands for every other SetState: a typed one is refused as before, and the owner check
(`_setStateOwnerRefusal`) still runs first.

**Mechanism** (`board-store.js`, `_applySetStateGated`): the bypass needs ALL of: `op.observedAirborne === true`,
`strip.role === 'DEPARTURE'`, `op.toState === 'DEPARTED'`, and `this._airborneObserver(strip) === true`. The last one is
the point: a flag the client sets is a claim, not evidence, so any client could otherwise skip the runway gate by adding a
field. The server vouches through `boardStore.setAirborneObserver(fn)`; unset (as on this branch, L19 is not in the base)
**no SetState is ever let past**, so the hook is inert until wired. The audit line carries
`bypass: { gate: 'RUNWAY_INHIBIT', inhibit: <the refused wording>, reason: 'OBSERVED_AIRBORNE' }` (absent when nothing was
bypassed). Tests: `efsp-ui-b-hooks.test.mjs` (typed refused; flag alone refused; vouched but unflagged refused; flag on LUAW
refused; flag + vouched on DEPARTED recorded and audited; wrong owner still refused; open runway records no bypass).

**What the integrator must add when L19 is merged (two one-liners):**

1. The chip, `strip-view.js` (L19's `accept`):
   `sendEfspMutation(_resolveActingPositionId(live), live, { kind: 'SetState', toState: h.toState });`
   becomes
   `sendEfspMutation(_resolveActingPositionId(live), live, { kind: 'SetState', toState: h.toState, observedAirborne: true });`
2. The server wiring, where the hint monitor and the Boards are both in scope (L19's `server.js`/`index.js`, next to where the
   `SurveillanceHintMonitor` is created):
   `for (const id of facilityIds) efsp.boardStoreFor(id).setAirborneObserver((s) => hints.getAll().some(h => h.stripId === s.stripId && h.kind === 'AIRBORNE_ADVANCE'));`
   (the chip's own hint, so "the server agrees the chip is on").

If (2) is forgotten the chip is refused during a suspension exactly as it is today (safe failure). Merge note: L19 also edits
`board-store.js` (`_stampTakeoffOnStateChange` after the `switch`); my hunk is the `case 'SetState'` line, the new methods
beside `_setStateRunwayRefusal` and one `bypass:` line in `_recordAudit`; they do not overlap.

## 4. "with AIC/JTAC" tab and GCI: skipped, with the reason

The tab exists so a TAC_C2-only controller can answer CTR's TOFI exit on a line TAC_C2 handed down. `permission.js`
`TACTICAL_CAPABILITIES` gives AIC `tofiAnsweredBy: 'TAC_C2'`; **GCI has no row**, so TAC_C2 answers nothing on a GCI-held
line (ADR 0080: "GCI answers nothing on ..."). A GCI-held line in that tab would be a row TAC_C2 can neither act on nor needs
to (GCI is a full MRU Position with its own Bays). Under L23's read scope TAC_C2 and GCI both read ALL, so TAC_C2 already
receives those lines; H58/H59 are about what a session holding no Position / only JTAC sees, and H59's binding rule (the JTAC
sees what TAC_C2 handed it) is untouched. No code change; the tab name stays "with AIC/JTAC".

## Defaults taken (P2)

- Resync on reconnect is sent as asked, although the server also sends a fresh snapshot on every connect (`ws-hub.js`), so
  the reconnect case is redundant today: the resync arrives after that snapshot, gets a (near-empty) delta, and after a server
  restart a second snapshot. Harmless; if the supervisor would rather not pay for the duplicate, drop
  `resyncHeldEfspBoardsOnOpen` (one call in `app.js`), the other two triggers do not depend on it.
- Gap detection is the heartbeat, which names only the default Facility's seq (ws-hub.js sends `boardStore.currentSeq`), so a
  lost delta on CENTER/TACTICAL is caught only through the epoch trigger or a reconnect. Not widened: a per-Facility
  heartbeat is a server change in `ws-hub.js`.
- The bypass flag is `op.observedAirborne` (the brief said "a flag on the mutation"; on the op it rides the same validation,
  replay and audit paths).
- RUNWAY_CHANGE wording: "runway change in progress".
- The GCI line tab: skipped (section 4).

## Edits to PARITY's tests (for the integrator)

- `bay-descriptor-parity.test.js`: `withOthers` added to `NOT_DESCRIPTOR_FIELDS`. UI-A's client-local pseudo-Bay
  (`efsp-panel.js`, `{ ..., withOthers: true }`) made the test read `bay.withOthers` and fail against the server's descriptors.
  This failure appears the moment PARITY and UI-A are merged, whoever merges first.
- `wire-payload-contract.test.mjs`: the delta test scans `applyEfspDelta` plus `_boardSyncOf` and `_adoptBoardSeq` (the
  seq/epoch/facility reads moved into those two helpers).

## Walks not done / findings for other lanes

- L19 chip with the suspension was exercised through the server hook only (L19 is not in this base): the real
  chip-during-suspension walk is owed after integration (supervisor: S-L19 open point 2 is a real-mission walk anyway).
- A client that is `OWNED`-scope (JTAC only) gets a snapshot for every resync; with the heartbeat trigger a hidden-Strip change
  does not cause one (deltas still carry the seq even when filtered to nothing; checked in `read-scope.js`).
- `ATO import` broadcasts an `efsp-board-delta` with `boardSeq` but no `boardEpoch` (`efsp-ws.js` ~line 1087): the client treats
  a missing epoch as "no change", and adopts the seq. Suggest L14/L26 stamp it like the others.
