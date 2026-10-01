# 0101: On an interfacility HANDOFF, accept moves radar identification and the Strip only; communications, ControlRelease and transfer of control are separate steps

**Status.** Draft (DES-RELEASE, docs only). The CONTROL-RELEASE lane copies it to `docs/adr/` when it builds it and
records what differs. Rulings: H94 (the model), H98 (named `ControlRelease`, never a bare "Release"), H93/H94 (carrier
Positions are EFSP Positions; the Strip does not leave the EFSP), H95 (undo), S-desk3/R3-16 (clocks). Research:
`docs/parallel/research/control-release.md`. Defaults marked **[default, DR-n]** are the recommendations in
`docs/wip/DES-RELEASE.md` § "Questions for the human"; the human may overturn any of them before the lane starts.

Written in the post-RENAME vocabulary (`docs/parallel/research/vocabulary.md`, H96/H98): Position, staffed, sign
on/off, consolidation, handoff, `CarrierHandoff`, flight data (today FDR, `fdrId`), strip type (today Strip Role),
`Interfacility*` audit kinds (today `Peer*`), coordination state `INITIATED` (today `PROPOSED`), departure release
(today `releaseState`). Position IDs are written APP, CTR, CV_MARSHAL; RENAME's FAA position names replace them where
it maps them. "Control" always means separation responsibility (P/CG TRANSFER OF CONTROL); "owner" means the
Position whose Bay holds a Strip. They are different things and stay different.

## Decisions at a glance

1. **ACCEPT of a HANDOFF ("RADAR CONTACT") moves radar identification and Strip ownership (the replica becomes a
   working Strip at the receiver), nothing else.** Communications and control stay with the transferring Position.
   This replaces today's all-at-accept effect (`coordination.js` `COORDINATION_EFFECTS.HANDOFF`, applied in
   `board-store.js` `_applyCoordinationAccept` and `receiveCoordinationResponse`).
2. **Transfer of communications is its own step**, `HANDOFF` action `TRANSFER_COMMS`, as TOFI has had since ADR 0025.
   Either side may record it (the transferring controller said "contact", or the receiver heard the check-in); the
   first record wins, the second is a no-op.
3. **`ControlRelease`** is one op kind with four actions: `GRANT` (transferring side: scopes `TURNS`, `CLIMB`,
   `DESCENT` or `FULL`, optional altitude limit for climb/descent, optional free-text condition, optional
   `effectiveAt` mission time), `REQUEST` (receiving side, the scopes it wants), `REFUSE` (transferring side answers a
   request: "UNABLE", optional reason), `WITHDRAW` (transferring side removes a grant; only before control transferred).
   A `GRANT` while a request is open answers it.
4. **Transfer of control** happens (a) automatically when communications are transferred and a `FULL` release is in
   effect, in either order; (b) at the boundary, recorded by a `HANDOFF` action `TRANSFER_CONTROL` from either side
   **[default, DR-2: a manual mark; no geometric detection in v1]**; (c) when the transferring side retires its Strip
   while it still holds control **[default, DR-6]**. Control is `coordination.separationResponsibilityRef`, which
   already exists and today moves at accept.
5. **Before control transfers, a control instruction must be coordinated.** A `SetBlock` that writes a heading,
   altitude or speed (the Block Map's control axis) is checked: the receiver may write within the release in effect;
   outside it, and the transferring side after ACCEPT (JO 7110.65 5-4-5 b), must attest "coordinated with <Position>"
   **[default, DR-1 and DR-10: attestation, audited; not a hard refusal]**.
6. **AIT, POINT_OUT, TRAFFIC and OPERATIONAL_REQUEST are unchanged.** AIT keeps control and comms at accept: it
   requires a written directive, which is exactly JO 7110.65 2-1-15 b ("handoff and frequency change ... when
   authorized by a facility directive or letter of agreement which specifies the type and extent") **[default, DR-9]**.
7. **Intrafacility moves carry control with ownership** (`TransferStrip`, transfer-shaped NLAs such as APP to TWR,
   `CarrierHandoff`, `SfaRotation`): the facility directive is the agreement, as today **[default, DR-4]**.
8. **A HANDOFF to the CARRIER Facility exists**: APP or CTR hands an ARRIVAL at INBOUND to `CV_MARSHAL`; the replica is
   minted as strip type MARSHAL at `IN_STACK` and joins the Marshal stack at the next free slot on accept, exactly like
   a recovery check-in **[default, DR-3]**. ControlRelease applies to it like any HANDOFF. From then on the carrier's
   own `CarrierHandoff`s move control inside the CARRIER Facility (decision 7). The Strip never leaves the EFSP (H94).
9. **TOFI gets none of this** (H97, ADR 0102). Departure release (ADR 0017/0028/0039, Block 14A, the HELD NLA
   "Release") is a different concept and is untouched; no code path, field or label is shared with it.

## Context

H94 approved the research's model "at full detail": after ACCEPT the transferring controller may release (turns,
climb, descent or full; optional condition); the receiver may request release (granted or refused); comms transfer is
its own step; control transfers at comms transfer plus a full release, or at the boundary; until released the
receiver must coordinate every instruction. The FAA (JO 7110.65 2-1-14, 2-1-15, 5-4-5, 5-4-6) and ICAO (Doc 4444
10.1.2.2, phraseology 12.3.5.2) separate three things the EFSP currently fuses at ACCEPT: radar identification,
communications and control. EUROCONTROL's guideline 3.5 gives the release its shape (a partial authorisation for a
manoeuvre before transfer of control).

Today `COORDINATION_EFFECTS.HANDOFF` is `{ radarIdTransfers, commsTransfers, dataOwnershipMoves,
separationResponsibilityMoves }` all `true`, written onto both Strips (receiver: `_applyCoordinationAccept`; sender:
`receiveCoordinationResponse`). Nothing else in the Board reads `separationResponsibilityRef` except the client's
POINT_OUT halves (`strip-view.js` `_coordinationExchange`), so moving it later changes no other rule.

## Decision

### The record (on both Strips of the exchange, mirrored)

`strip.coordination` (HANDOFF only) gains:

```
comms:   { transferred: false, at: null, by: null, byPositionId: null }      // replaces the boolean commsTransferred
control: { holder: 'TRANSFERRING' | 'RECEIVING', at, by, trigger }           // trigger: 'COMMS_AND_FULL_RELEASE' |
                                                                              //   'BOUNDARY' | 'TRANSFERRING_RETIRED' | 'AIT'
release: null | { scopes: ['TURNS'|'CLIMB'|'DESCENT'|'FULL'], climbLimitFt?, descentLimitFt?,
                  condition: string|null, effectiveAt: ms|null,              // mission time (a gate, S-desk3)
                  grantedAt, grantedBy, grantedByPositionId,
                  withdrawnAt?, withdrawnBy? }                               // a withdrawn grant stays readable
releaseRequest: null | { scopes, note, requestedAt, requestedBy, requestedByPositionId,
                         answer: null | 'GRANTED' | 'REFUSED', answeredAt, answeredBy, reason }
```

`separationResponsibilityRef` stays the authoritative "who has control" and moves at transfer of control, not at
ACCEPT; `control.holder` is the readable mirror (both Strips agree; the Strips are on two Boards). One release is in
effect at a time: a new `GRANT` replaces the previous one (the audit keeps every one). `FULL` means every axis and
triggers decision 4 (a).

### Wire and audit

- Op kinds: `HANDOFF` gains actions `TRANSFER_COMMS` and `TRANSFER_CONTROL` (beside `PROPOSE/ACCEPT/REJECT/CANCEL`);
  new op kind `ControlRelease` `{ action: 'GRANT'|'REQUEST'|'REFUSE'|'WITHDRAW', scopes?, climbLimitFt?,
  descentLimitFt?, condition?, effectiveAt?, reason?, note? }`. Both travel on the ordinary Board mutation message and
  reuse its ack and board-delta; no new wire family. `SetBlock` gains an optional `coordinatedWith: positionId`.
- Audit: one entry per outcome (ADR 0083). Acting side: kind `HANDOFF`/`ControlRelease` with `auditFields`
  `{ controlRelease: { action, scopes, condition, effectiveAt } }`, `{ comms: … }`, `{ control: { trigger } }`; the
  mirror on the peer Board is `InterfacilityControlRelease` / `InterfacilityCoordinationResponse` (action
  `TRANSFER_COMMS`/`TRANSFER_CONTROL`), each with `causedBy`. An automatic transfer of control (decision 4 a, c) is
  recorded inside the entry of the op that caused it (`control: { trigger }`), never as a second entry.
  A coordinated `SetBlock` carries `coordinatedWith` and `controlAxis` in its audit line.
- Refusals use existing reasons: `VALIDATION_ERROR` (wrong state or side, unknown scope, limit on the wrong scope,
  `WITHDRAW` after control moved) and `PERMISSION_DENIED` (authority).

### Who may do what (authority registry, AUTH)

| Action | Who | When |
|---|---|---|
| `ControlRelease GRANT/REFUSE/WITHDRAW` | owner of the transferring-side Strip | coordination ACTIVE, control with transferring side |
| `ControlRelease REQUEST` | owner of the receiving-side Strip | same; one open request at a time |
| `HANDOFF TRANSFER_COMMS` | owner of either Strip | coordination ACTIVE, comms not yet transferred |
| `HANDOFF TRANSFER_CONTROL` | owner of either Strip | coordination ACTIVE, control with transferring side |
| control-axis `SetBlock` without attestation | the control holder; the receiver within the release in effect | — |

A Position family that has the coordination ops gets these. CV_MARSHAL gets `HANDOFF ACCEPT/REJECT`,
`ControlRelease REQUEST`, `TRANSFER_COMMS` and `TRANSFER_CONTROL` as a receiver only (it still proposes nothing:
"the carrier does not talk to the centre" stays true outbound, DR-3). Consolidation applies as for any op: the
Position the Strip's owner is consolidated at acts for it.

### The control-axis check

The Block Map already says what a Block means: `interlockFor(role, blockId)` returns `COURSE` or `ALTITUDE` (ADR
0051). A sibling `controlAxisFor(stripType, blockId)` returns `TURNS` (COURSE), `CLIMB`/`DESCENT` (ALTITUDE, by
comparing the new value with the flight's current assigned altitude; no assigned altitude needs both or `FULL`) or
`SPEED` (a new `control: 'SPEED'` attribute on `9A-SPEED`, covered only by `FULL` **[default, DR-11]**; a separate
attribute so MARSA's `voidForAssignment` is unaffected). In `SetBlock`, while a HANDOFF on the Strip is ACTIVE and
control has not transferred:

- the acting side holds control and the coordination is past ACCEPT → needs `coordinatedWith` (the receiver);
- the acting side is the receiver → allowed if the release in effect covers the axis, is not withdrawn, its
  `effectiveAt` is due on the mission clock and the value respects `climbLimitFt`/`descentLimitFt`; otherwise needs
  `coordinatedWith` (the transferring Position);
- missing attestation → `VALIDATION_ERROR` naming the Position to coordinate with and the missing scope. The client
  turns that into the prompt; it never silently retries.

### Timers and clocks (S-desk3, R3-16, ADR 0096)

`effectiveAt`, every `at` on the record, and the audit `at` are **mission time** (facts and gates). There is no expiry
on a request or a grant: an open request shows "since HHMM" until answered or cancelled by the coordination ending.
The only wall-clock duration is the undo window (10 s, H95).

### Undo (H95) **[default, DR-5]**

`TRANSFER_COMMS` and `TRANSFER_CONTROL` are one-click marks and go into the undo history: undone within 10 s they
restore both Strips' records (and control, if the mark moved it); changes the other controller made after it are
voided and that controller is told, per H95. `ControlRelease` actions are **not** undoable: a release is an
authorisation another controller may already have acted on; `WITHDRAW` is the correction, as on the frequency.

### Replicas, peers, resync

Every action is applied on the acting Board and mirrored on the peer Board through the Coordination collaborator's
`receive*` methods (as ACCEPT is today), in the same causal chain (`causedBy`), producing the usual two board-deltas.
The fields ride in the Strip, so the snapshot on connect (R3-47) and the persisted Board carry them; nothing new to
resync. `receiveCoordinationPeerGone` on the receiving side with control still transferring triggers decision 4 (c);
on the transferring side (the receiver dropped the replica) the coordination ends and control stays where it is.

## Consequences

- Existing tests asserting `commsTransferred === true` after a HANDOFF accept change (behaviour change; outside the
  refactor window no golden fixtures are maintained, S-desk3/S-ARCH2 13).
- The client shows a third exchange state on a HANDOFF Strip ("RADAR CONTACT · comms not moved · control: CTR"), the
  release chip, and the attestation prompt.
- A controller who never transfers comms or marks the boundary leaves control at the transferring side until it
  drops its Strip (decision 4 c). The NLA status monitor may later surface "control not transferred" as an
  obligation; not in this ADR.

## Alternatives rejected

- **Release as a field on the flight data.** Control is between two Positions of one exchange, not a fact about the
  flight; two simultaneous exchanges (a Point Out alongside) would collide.
- **Geometric boundary detection now.** APP/CTR sectors have no geometry in the registry (0098 is about SUA/ATCAA and
  routes); a manual mark is what the controller does on the frequency anyway (DR-2).
- **Folding into departure release.** Different FAA concept (JO 7110.65 4-3-4 vs 2-1-15); vocabulary A4.
