# CONTROL-RELEASE: ControlRelease, comms transfer and control transfer on HANDOFF (H94)

> Read `docs/parallel/refactor/README.md` (conventions, test policy) and `docs/parallel/lane-rules.md` first.
> Rulings: H94, H98 (`ControlRelease`, never bare "Release"), H93 (carrier Positions are EFSP Positions), H95 (undo),
> S-desk3/R3-16 (clocks), S-TEST. ADR draft: `docs/wip/DES-RELEASE-adr-0101.md` (copy it to `docs/adr/0101-…md` in
> your first commit, then record what you changed in its "Status"). Design notes, questions (DR-1…DR-11) and the
> UI sketch: `docs/wip/DES-RELEASE.md`. **decisions.md wins over this briefing**: if the human answered a DR question
> differently from the default, follow the answer.

| | |
|---|---|
| Start | after the refactor window closes (RENAME merged) and L20's comment sweep on `crc-sync/src/efsp/board/**` |
| Worktrees / branches | `sourcedcs-CR-S` on `lane/CR-S-control-release` (server); `sourcedcs-CR-C` on `lane/CR-C-control-release-ui` (client), cut from CR-S's first commit that lands the wire shape |
| ADR | 0101 |
| Size / model | CR-S 1.25 lanes, CR-C 1 lane / Sonnet 5.5 |
| Parallel with | Split/Join+undo (shares the undo history: coordinate through "main"), TOFI-REGIME (disjoint server files; the client exchange rows are shared, so CR-C merges first) |

All names below are the post-RENAME ones (vocabulary.md, H98). Where this briefing names today's symbol it is from
`165a517`; re-find each by symbol at your base in step 0.

## Goal

ACCEPT of an interfacility HANDOFF moves radar identification and ownership only. Communications transfer, the
`ControlRelease` (grant/request/refuse/withdraw) and transfer of control become their own steps; until control
transfers, control instructions outside the release need a "coordinated with" attestation. A HANDOFF into the
CARRIER Facility (CV_MARSHAL) is added (DR-3). AIT, POINT_OUT, TRAFFIC, OPERATIONAL_REQUEST, intrafacility moves,
TOFI and departure release are unchanged.

## Owns

CR-S: `crc-sync/src/efsp/coordination.js` (the effect table: HANDOFF row), `src/efsp/board/coordination.js`
(`Coordination`: new actions and `receive*` mirrors), new `src/efsp/board/ops/control-release.js`, the HANDOFF op file
(`board/ops/coordination.js` or wherever BOARD-3 put PROPOSE/ACCEPT), the `SetBlock` op file (the control-axis check
only), `src/efsp/block-map.js` (`controlAxisFor`, the `control: 'SPEED'` attribute on 9A-SPEED), `src/efsp/authority/
positions/{civil-atc,carrier}.js` and `authority/roles/{arrival,marshal}.js` (grants; the CARRIER replica row),
the CARRIER facility JSON (a Coordination Bay for CV_MARSHAL), the retirement path in `board/strip-ops.js` (trigger
`TRANSFERRING_RETIRED` only), the undo history registration for the two marks (with the Split/Join lane), new tests
`crc-sync/tests/control-release*.test.mjs`, existing tests that assert comms at accept, `docs/adr/0101-…md`,
`docs/wip/CR-S.md`.

CR-C: `crc-desktop/app/public/js/panels/efsp/strip-view.js` (or the `bay/popovers/` module ESM-2a put
`_coordinationExchange` in): the HANDOFF exchange row, release menu, chips; the Block editor's attestation prompt;
the client parity copy of `controlAxisFor` if PARITY keeps one; CSS for the new chips; touched Playwright specs;
`docs/wip/CR-C.md`. The usage guide section on coordination (§4.6 wording) is CR-C's, one paragraph plus the table.

## Design (ADR 0101 is the spec; these are the build notes)

1. **Effect table.** `COORDINATION_EFFECTS.HANDOFF` → `{ radarIdTransfers: true, commsTransfers: false,
   dataOwnershipMoves: true, separationResponsibilityMoves: false, controlModel: 'STEPS' }`; AIT keeps
   `separationResponsibilityMoves: true, commsTransfers: true` and gets `controlModel: 'AT_ACCEPT'` (its control
   record is stamped `trigger: 'AIT'`). Read `controlModel` in `Coordination`; do not test `primitive === 'HANDOFF'`.
2. **Record.** `coordination.comms`, `.control`, `.release`, `.releaseRequest` exactly as in ADR 0101 § "The record";
   initialise at PROPOSE (on both Strips) so the snapshot shape is stable. Drop the boolean `commsTransferred` (no
   compatibility, R3-2), and update every reader (grep both trees).
3. **One transfer-of-control function** in `Coordination`: `_transferControl(strip, trigger, meta)` moves
   `separationResponsibilityRef` to the receiving Position, sets `control`, and is called by: `TRANSFER_COMMS` when a
   FULL release is in effect, `ControlRelease GRANT` of FULL when comms already moved, `TRANSFER_CONTROL`, and the
   retirement path (transferring Strip retired with control still at the transferring side). It mirrors to the peer
   in the same call chain (`causedBy`).
4. **`effectiveAt`.** A future `effectiveAt` does not schedule anything: FULL with a future `effectiveAt` transfers
   control on the first later op that checks it, or by `TRANSFER_CONTROL`. The control-axis check compares
   `effectiveAt` with the injected mission clock. No ticker.
5. **Control-axis check** in the `SetBlock` op's `authorize`/`apply` (wherever BOARD-3 placed the MARSA void hook):
   `controlAxisFor(stripType, blockId)` → `TURNS` | `CLIMB` | `DESCENT` | `SPEED` | null, CLIMB/DESCENT by comparing
   with the flight's current assigned altitude (`activeClearanceEntry`). Only when the Strip's HANDOFF coordination
   is ACTIVE with `controlModel: 'STEPS'` and control not transferred. Refusal detail names the Position and scope.
   `coordinatedWith` must be the other party's Position id, else `VALIDATION_ERROR`.
6. **Carrier inbound (DR-3).** `coordinationEligibleState` already allows ARRIVAL/INBOUND to propose. The CARRIER
   role table gives a replica-on-receipt mapping ARRIVAL/INBOUND → MARSHAL/IN_STACK (a strip-type change at mint,
   in the authority role registry beside `REPLICA_STATE_ON_RECEIPT`, never a branch in `Coordination`). On ACCEPT the
   relocation appends to the Marshal stack through the carrier store's existing check-in path (the same call a
   recovery `CreateStrip` makes). CV_MARSHAL's grant gains HANDOFF ACCEPT/REJECT and the receiver-side actions, not
   PROPOSE. A CV Position proposing anything stays refused. Consolidation (APP2 → APP1 → Marshal) is untouched.
7. **Intrafacility moves** keep moving control with ownership: if the Strip carries an ACTIVE HANDOFF whose control
   holder is this Facility, an owner change inside the Facility (`TransferStrip`, `CarrierHandoff`, `SfaRotation`,
   transfer NLAs) updates `separationResponsibilityRef.positionId` to the new owner. One helper, called from the
   ownership-change point in `StripOps`, not from each op.
8. **Undo (DR-5).** `TRANSFER_COMMS` and `TRANSFER_CONTROL` register in the undo history the undo lane builds (H95,
   10 s wall clock). If the undo lane has not merged yet, ship without undo and leave a `test.todo` naming it.
   `ControlRelease` never registers.
9. **Audit.** One entry per outcome; `auditFields` per ADR 0101 § "Wire and audit"; the peer mirror kinds are
   `InterfacilityControlRelease` and `InterfacilityCoordinationResponse` (action `TRANSFER_COMMS`/`TRANSFER_CONTROL`).

## Steps

0. Step 0 per README (both suite counts; "Code as found": every symbol above re-found, plus every reader of
   `commsTransferred` and `separationResponsibilityRef` in both trees).
1. CR-S: effect table + record + accept change; fix existing tests (one commit, `behaviour(CR-S): …`).
2. CR-S: `TRANSFER_COMMS`, `TRANSFER_CONTROL`, `_transferControl`, retirement trigger, peer mirrors.
3. CR-S: `ControlRelease` op file (GRANT/REQUEST/REFUSE/WITHDRAW), authority grants.
4. CR-S: `controlAxisFor` + the SetBlock check + `coordinatedWith`.
5. CR-S: carrier inbound HANDOFF (Coordination Bay in the CARRIER JSON, role mapping, stack append).
6. CR-S: undo registration (or the todo); ADR 0101 status; report. Send "main" a note after step 3 so CR-C can cut.
7. CR-C: exchange rows (both sides), release menu, chips, attestation prompt, guide paragraph, specs.

## Tests

Server (`node --test tests/control-release*.test.mjs` while working; both full suites once before the report;
`soak:selfcheck` because `board/**` is touched):

- accept: radar ID and ownership moved, comms and control not, on both Boards; AIT and POINT_OUT rows unchanged;
- each action: right side only, right state only (before ACCEPT, after REJECT/CANCEL, after control moved → refused);
- control transfer: comms then FULL, FULL then comms, `TRANSFER_CONTROL` from each side, transferring Strip retired
  (with and without comms → warning), receiver replica dropped (control stays);
- control-axis matrix: {receiver, transferring} × {TURNS, CLIMB, DESCENT, SPEED} × {no release, covering, not
  covering, withdrawn, `effectiveAt` future/past (fake mission clock), limit respected/violated} × {attested, not};
  no assigned altitude → CLIMB/DESCENT both needed;
- intrafacility owner change moves the control Position; MARSA's `voidForAssignment` unaffected by SPEED;
- request: one open at a time; GRANT answers it; REFUSE carries the reason; request after control moved refused;
- audit: exactly one entry per outcome, keys in the documented order; peer entries carry `causedBy`;
- snapshot/restore round-trip keeps the record; resync snapshot carries it;
- carrier: APP/CTR → CV_MARSHAL HANDOFF mints MARSHAL/IN_STACK, ACCEPT appends at the next free slot; a CV Position
  proposing is refused;
- undo of each mark inside 10 s restores both Strips; after 10 s refused (fake wall clock).

Client (CR-C): unit tests for the row builders; Playwright: only the coordination and carrier specs you touched plus
the boot smoke, on `E2E_LANE` the supervisor assigns. Never the full suite (S-TEST); the supervisor runs it after the
merge (a visible behaviour change).

## Acceptance

Both suites green; selfcheck green; ADR 0101 committed with its "differs from the draft" list; the DR answers in
decisions.md followed; a two-Facility manual walk (CTR → APP with release, comms, boundary; CTR → CV_MARSHAL) written
up in `docs/wip/CR-C.md` with screenshots; usage guide updated.
