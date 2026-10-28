> Amended for H100 (2026-10-01): the questions are settled; Q-SJ1 (b), Q-SJ2, Q-SJ3 (c), Q-U2 (b) and the speed cell (DR-11 b)
> changed the drafts. Lanes: SJ-S now 1.25. See decisions.md H100.

# DES-SPLIT: design for formation Split/Join and undo for every one-click move (docs only)

## Report

Branch `lane/DES-SPLIT-split-join-undo` from `165a517`. Docs only, no code, no tests run (none needed).

Files:
- `docs/wip/DES-SPLIT-adr-0099.md`: draft ADR 0099, formation split and join.
- `docs/wip/DES-SPLIT-adr-0100.md`: draft ADR 0100, undo for every one-click Strip move, 10 s (supersedes ADR 0009).
- `docs/parallel/post-refactor/SPLIT-JOIN.md`: briefing, lanes SJ-S (server) and SJ-C (client).
- `docs/parallel/post-refactor/UNDO.md`: briefing, lanes UNDO-S (server) and UNDO-C (client).
- this file: code as found, design notes, defaults, findings, questions for the human.

Key decisions (**settled H100** = answered by the human, see "Questions" below):
1. `SplitFormation` is one op on the lead's Strip: gates first (no side effects on refusal), new flight data copied
   from the lead (plan, mission, identity), typed callsign, new code from the allocator, the assignment written as a
   clearance entry, lead size N−k, the new Strip right after the lead, one audit entry with a `records` array.
2. MARSA return: the assignment is **still required** (settled H100 Q-SJ1 b, reversing the H91 supervisor assumption); new
   code still allocated; `marsaReturn` is a controller-declared, audited label that relaxes nothing. On the ground (by Strip
   state, `groundStates` per family) a split needs no assignment (H100 Q-SJ2).
3. Speed is a flight-data clearance cell beside altitude and heading **only so a split can be recorded by speed**: a plain
   recorded assignment, no conformance, no control axis (H100 DR-11 b). Kept: the cell, the display Blocks that make an
   assignment visible, and ARRIVAL's `9A-SPEED` retarget (one display place). Dropped: anything that checks or coordinates
   speed. ADR 0099 §3 has the reasoning.
4. `JoinFormation` addresses the joiner: retired through the one retirement path as DROPPED with `endReason: 'JOINED'`,
   flight data `voided`, code released, lead size grows. Both Strips must be the acting Position's (settled H100 Q-SJ5 a); a
   joiner with live Strips at another Facility is refused.
5. Counting: a split part is its own flight (with lineage); a `JOINED` drop is excluded; aircraft are conserved
   (settled H100 Q-SJ4 a). Two metrics counters.
6. Undo: one process-wide `UndoHistory`, one record per action keyed by its `clientMutationId`, 10 s on the injected
   wall clock. Every op module declares `undo` (`'none'` or a scope); restore is whole-record from before-images of the
   declared scope (no per-op inverse logic), with three side-store compensators (code, carrier stack, MARSA) and
   `receiveUndoRestore` for another Board.
7. Later changes inside the Facility are voided and listed; a later change from another Facility, a system change, or
   a Mutation that reached outside the scope blocks the undo (`UNDO_BLOCKED`) (settled H100 Q-U3 a). Append-only cells
   (clearance, annotations) mark voided entries `VOIDED` instead of erasing them (settled H100 Q-U4 a).
8. Only the performing Position may undo, whoever owns the Strip now (settled H100 Q-U5 a). The voided Position is told by
   a panel message only (`efsp-undo-voided`); no `undoNotice` on the Strip, nothing persisted (settled H100 Q-U2 b).
9. Client: one undo slot per session in the EFSP panel's status line, Ctrl+Z and `.undo` send its `actionId`
   (settled H100 Q-U6 a). The ack says what is undoable; the client keeps no list.

Lanes: UNDO-S 1.5 (Opus), UNDO-C 0.5, SJ-S 1.25, SJ-C 0.5 (Sonnet): 3.75 agent-lanes, about 2 days elapsed. Order: UNDO-S's
contract commit → SJ-S cut from it; UNDO-S merges first, SJ-S after. Proposed E2E lanes 5 (UNDO-C) and 6 (SJ-C).

## Inputs read

decisions.md H78, H85, H89, H90, H91, H92–H98, S-desk3, S-ARCH2, S-TEST, S-R3-80; `docs/wip/ARCH-plan.md` (all, §2 in
detail); `docs/parallel/refactor/README.md`, `BOARD-3.md`; `docs/parallel/lane-rules.md`;
`docs/parallel/research/vocabulary.md`; ADRs 0009, 0083, 0093; guide §3.5 rule 5 (`EFSPImplementationGuide.md`); code
below.

## Code as found (`165a517`)

| Area | Symbol | What it does today |
|---|---|---|
| Undo window | `BoardStore._nlaHistory`, `_applyInvokeNla` | `{invokedAt, prevState, expiresAt: wallNow + 30000}` per Strip, written only for a state-only NLA (not transfer-shaped, not carrier-shaped). Same map holds the 400 ms double-tap latch |
| Undo | `_applyUndo` | sets the state back through `_applySetState`; on DROPPED: remove indicator off, `reacquireFdr`, forget `_droppedWallAt` |
| Undo cleared | `_applyTransferStrip`, `_applyCarrierTransfer`, `_applySfaRotation`, `archiveStrip` | `_nlaHistory.delete` (ADR 0009) |
| Undo gates | `_dispatch` | owner check, `baseRev` check; `Undo` is an `OP_KINDS` grant (`permission.js`) |
| Carrier handoff | `_applyCarrierTransfer`, `CARRIER_TRANSFER_EFFECTS` (`carrier/transfer-effects.js`), `carrierApplyEffect` | role/state/owner change + stack effect `MARK_PUSHED` / `REMOVE_NO_CLOSE_UP` in `carrier-store.js`; `strip.carrierTransfer` record; also reached from `InvokeNla` |
| SFA rotation | `_applySfaRotation` | ARRIVAL INBOUND → FINAL ON_FINAL at PAR; `strip.sfaTransfer`; no flight data write |
| L19 chip | client `strip-view.js` indicator `hint` → `{kind:'SetState', toState, observedAirborne:true}`; server `_applySetStateGated`, `_observedDeparture` | bypasses the runway gate only, audit `bypass` |
| TOFI Exit primary | client `_tofiExitIsPrimary` / `tofiExitDueFor` (`efsp-nla.js`) → `_dispatchTofi(strip,'PROPOSE','EXIT')`; server `_applyTofiPropose` + MRU Board `receiveTofiExitProposal` (`PeerTofiExitProposal`) | writes both Strips; TOFI has no withdraw/cancel action |
| Takeoff stamp | `_stampTakeoffOnStateChange` | set/cleared on every state change into/out of airborne |
| Drop | `_retireStrip`, `_releaseFdrIfLastStrip` | the one path to DROPPED: code release, `retireMarsaForFdr`, `carrierRetireFlight`, `receiveCoordinationPeerGone` |
| Formation size | flight data `identity.flightSize` (`createFdr`, `WRITABLE_PATHS`, ATO seed) | one identity per formation (guide §3.2 rule 2); `AFFINITY_FORMATION` in `correlation-match.js` |
| Codes | `CodeAllocator.allocate/release/reassign/holderOf`, `FdrStore.reacquireFdr`, `archiveFdr` | rotating cursor (ADR 0081); D23 never steals |
| Clearance | `CLEARANCE_FIELDS = {altitude, heading}`, `setClearance` | append-only cells, ACTIVE / SUPERSEDED / STRUCK; no speed |
| Speed | `block-map.js` ARRIVAL `9A-SPEED` | Strip annotation; DEPARTURE has no heading/speed Block, OVERFLIGHT has `7A`, `9A-VECTOR` |
| Audit | `_recordAudit`, `_recordPeer` | one entry per successful Mutation, addressed Strip's before/after + extras; peer entries with `causedBy` (ADR 0083) |
| Traffic count | `isDropTransition`, `isUndoOfDrop`, `countability`, `_buildRecord` | COUNT per drop, `flightSize` frozen from the flight data at the drop, VOID on undo of a drop |
| Metrics | `metrics.js` `_post` | `recordTransfer` for `TransferStrip` and NLA transfers; no undo counter |
| Archiving | `archiver.js`, `archiveStrip` | 2 h or mission change; ADR 0082 rule 4: nothing archived can be undone |
| Delta | `efsp-ws.js` `_boardDelta` | a touched id no longer on the Board goes into `gone` |
| Client undo | `efsp-nla.js` `UNDO_WINDOW_MS = 30000`, `isUndoAvailable`; `efsp-panel.js` `.undo` | no visible affordance; `.undo` sends `{kind:'Undo'}` for the selected Strip; parity test pins 30 s |

## Design notes

- **Why whole-record restore and not per-op inverses.** ADR 0009 excluded transfers because reverting the *state*
  after the *owner* moved produced impossible Strips. Restoring the whole record (state, owner, Bay, Rack, role/strip
  type, coordination fields) removes that hazard by construction, and one mechanism covers twelve op kinds. The ops only
  declare what they touch; a scope-escape check keeps the declarations honest.
- **Why scope + blocking instead of a transitive closure.** Voiding a later Mutation that changed a record the undone
  action never touched widens the undo beyond what the controller did, and 10 s makes the case rare. Refusing with the
  blocking Mutation named is predictable and safe.
- **Why cross-Facility blocks.** H95's example is two controllers on one Strip. Another Facility's answer is a handshake
  (TOFI accept, coordination response); silently reversing it would leave that controller's picture and their pilot's
  instruction out of step. Before an answer, withdrawing one's own proposal is exactly the mis-click fix.
- **Why `VOIDED` entries.** JO 7110.65 2-3-1 (cited in `_applyConvertToArrival`'s comment) forbids erasing a strip
  item; a clearance B gave the pilot was said on frequency, so B must see it struck as voided, not vanish.
- **Why the undo slot is panel-level.** After a handoff or rotation the Strip leaves the sender's Bay; a Strip-anchored
  button would disappear with it.
- **Why `actionId` = `clientMutationId`.** It is already unique, already in the action's audit line and its ack; no new
  id field is needed. Unkeyed Mutations (tests, tools) are not undoable.
- **Naming.** `SplitFormation` / `JoinFormation`, not Split/Join: "the AR join" (ADR 0071, `arJoinFor`) is the tanker
  join under MARSA.
- **The undo slot's 10 s on the client** starts at the ack's arrival, so the visible window is a little shorter than the
  server's; the server is authoritative.

## Defaults taken (P2)

- Drafted against the post-RENAME vocabulary and the post-refactor layout as instructed; exact identifiers
  (`flightDataId`, the flight-data store's file name, Position ids) are left to the RENAME mapping table.
- E2E lanes 5 (UNDO-C) and 6 (SJ-C): no post-refactor lane has one yet. The supervisor may renumber.
- `UNDO_WINDOW_MS` is a named code constant (a human ruling, not tuning), like `ARCHIVE_AFTER_MS`.
- Mixed-type join keeps the lead's aircraft type and warns; not put to the human.
- `metrics.js` belongs to UNDO-S (adds SPLIT-JOIN's two counters too); `traffic-count.js` belongs to SJ-S (owns the
  `records` reader). This keeps the two lanes' files disjoint.

## Findings (for the lanes and the supervisor)

- **F1 (existing gap):** undoing a terminal NLA Drop today restores the state and code only. A MARSA relation ended by
  `retireMarsaForFdr`, a carrier stack entry removed by `carrierRetireFlight` and a proposer's link ended through
  `receiveCoordinationPeerGone` stay ended. ADR 0100's compensators close it; nothing to fix before.
- **F2:** there is no visible Undo in the client; only `.undo`. `isUndoAvailable` is exported and tested but unused.
- **F3:** TOFI has no withdraw action; ADR 0100 gives it one only through Undo, inside 10 s. A deliberate withdrawal
  later is the release+TOFI lane's call.
- **F4:** a DEPARTURE Strip has no heading or speed Block, so an assignment given to an airborne DEPARTURE is invisible on
  its Strip today. ADR 0099 §3 adds them (kept after DR-11 b: they only display the split's assignment).
- **F6 (H100 contradiction check):** DR-11 (b) says speed is no control axis and has no conformance; the speed cell here looked
  at first like a conflict. Resolved: split by speed (H90) is an assignment kind, and recording it needs the cell and a place
  to show it, nothing more. The earlier draft already had no conformance, so only the wording changes (and the release
  lane's `control: 'SPEED'` attribute is gone).
- **F5:** guide §3.5 rule 5 and the usage guide's Undo line (30 s, state-only) become wrong when UNDO merges; UNDO-C owns
  the usage guide lines, the implementation guide is L20's or the next doc sweep's.

## Dependencies on other post-refactor lanes

- **RENAME (W7) and L20** merge first (both briefings are written on the final names and layout).
- **Release + TOFI lane (H94, H97):** its new ops (`ControlRelease`, request/grant, the comms-transfer step) declare
  `undo: 'none'` (coordination-family answers, not one-click moves); whichever of UNDO-S and that lane merges second adds
  the declarations. Its H97 change makes the TOFI regime effective at airspace entry: that write is a system write and
  must be listed as observed (never restored by an undo). It owns `board/tofi.js` internals; UNDO-S only declares the
  TOFI op module's `undo` scope.
- **AIRSP phase 2 (ADR 0098):** occupancy must follow split and join (automatic if derived from live Strips; a stored
  count must recount on `SplitFormation`/`JoinFormation`); any field its monitors write on a Strip or flight data is
  listed as observed. `airspaceEntry` is copied to a split part.
- **WIRE-B / SYNC-B:** none beyond using the generic broadcasts and `SyncLog` `gone`.

## Questions for the human (all answered, decisions.md H100)

Each keeps its question and recommendation; the **Settled H100** line is the answer the drafts follow.

**Q-SJ1 — Split on return from MARSA (confirms the supervisor's assumption in H91).** When a formation comes back from
MARSA still split and the controller records it: (a) the heading/speed/altitude assignment is optional (they are already
separated), the new beacon code is still allocated, and the controller ticks "back from MARSA", which is audited;
(b) an assignment is still required; (c) optional assignment and no new code. **Recommend (a).**
**Settled H100 (b):** the assignment is still required on return from MARSA; no "back from MARSA" exemption (reverses H91's supervisor assumption). The new code is still allocated.

**Q-SJ2 — Which strips can split or join.** (a) Airborne IFR strips only: DEPARTURE after takeoff (DEPARTED, HANDED_OFF), ARRIVAL
INBOUND, OVERFLIGHT INBOUND or IN_SECTOR; never MISSION lines (MARSA side) or the carrier strips (Marshal/final/pattern);
(b) as (a) plus ARRIVAL HANDED_TO_TOWER/FINAL (a formation breaking up for landing); (c) any live strip.
**Recommend (a).**
**Settled H100:** any live IFR Strip (DEPARTURE, ARRIVAL, OVERFLIGHT; every state but DROPPED) may split or join, airborne not required; on the ground (DEPARTURE `PROPOSED`, `PENDING_CLEARANCE`, `CLEARED`, `HELD`, `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE`, `LUAW`; ARRIVAL `LANDED`, `TAXI_IN`) a split needs no heading, speed or altitude. MISSION lines and carrier Strips stay excluded (MARSA records nothing; carrier control is its own regime).

**Q-SJ3 — Who may split or join.** (a) APP, CTR and SFA (the radar positions that give IFR assignments to airborne
flights), only on strips they own; (b) (a) plus TWR and RSU; (c) every ATC position. **Recommend (a).**
**Settled H100 (c):** every ATC Position may split or join, on Strips it owns (Q-SJ5 a).

**Q-SJ4 — Traffic count after a split.** (a) Each part counts as a flight when its strip is dropped, with its own
aircraft count, and the record says which flight it split from (a 4-ship that splits 2+2 counts 2 flights, 4 aircraft;
one that rejoins counts 1 flight, 4 aircraft); (b) a split part is folded back into the original flight (1 flight,
4 aircraft either way); (c) count splits and joins as events only. A joined flight is never counted on its own: its
aircraft count under the lead. **Recommend (a).**
**Settled H100 (a).**

**Q-SJ5 — Join between two controllers.** (a) The controller must own both strips (hand the joiner over first);
(b) the lead's owner may join a strip another position at the same facility owns. **Recommend (a).**
**Settled H100 (a).**

**Q-U1 — Which actions can be undone.** (a) Exactly the NLA and the four in H95 (carrier handoffs, SFA rotation, the
airborne chip, TOFI Exit); (b) every action that moves a strip in one gesture: the NLA, state changes, drags and
transfers, Drop, carrier handoffs, SFA rotation, Convert to arrival, TOFI proposals, Split and Join; (c) every change,
edits included. Not undoable in (b): creating a strip, field edits, coordination answers (they have Cancel).
**Recommend (b).**
**Settled H100 (b).**

**Q-U2 — How the controller whose change was voided is told.** (a) The strip shows an UNDONE marker listing what was
voided, kept until that controller or the owner clicks it or the strip next changes, plus a one-line message on their
panel if they are signed on; (b) only the panel message (lost if they are disconnected); (c) only the audit log.
**Recommend (a).**
**Settled H100 (b):** the voided controller is told by a panel message only; no `undoNotice` on the Strip, no wire field on the Strip, no persistence, no `AckUndoNotice`. The audit still records what was voided.

**Q-U3 — Undo after another facility has answered.** Example: CTR presses TOFI Exit by mistake and the MRU accepts within
10 s. (a) The undo is refused once another facility has answered or changed the strip; before the answer it withdraws the
proposal on both boards; (b) the undo also reverses the other facility's answer, and that controller is told.
**Recommend (a).**
**Settled H100 (a).**

**Q-U4 — A clearance given after the undone action.** Example: APP issues FL240 two seconds after LC's handoff and LC
undoes. (a) FL240 stays in the clearance history marked "voided by undo" and the earlier altitude is active again;
(b) FL240 is removed. **Recommend (a)** (a strip item is never erased; APP sees what it told the pilot was voided).
**Settled H100 (a).**

**Q-U5 — Who may undo.** (a) Only the position that did the action, even if the strip now belongs to someone else;
(b) also the strip's current owner. **Recommend (a).**
**Settled H100 (a).**

**Q-U6 — Where Undo lives on screen.** (a) One "Undo <action> · 7 s" slot in the EFSP panel's status line, plus Ctrl+Z and
`.undo`; (b) an Undo button on the strip itself (it disappears when the strip moves to another position's bay).
**Recommend (a).**
**Settled H100 (a).**
