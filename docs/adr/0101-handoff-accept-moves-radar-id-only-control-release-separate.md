> Amended for H100 (2026-10-01): DR-6 (a) plus the control invariant below (new section), DR-11 (b): no SPEED control axis.
> All other DR answers are as recommended (decisions.md H100).

# 0101: On an interfacility HANDOFF, accept moves radar identification and the Strip only; communications, ControlRelease and transfer of control are separate steps

**Status.** Draft (DES-RELEASE, docs only). The CONTROL-RELEASE lane copies it to `docs/adr/` when it builds it and
records what differs. Rulings: H94 (the model), H98 (named `ControlRelease`, never a bare "Release"), H93/H94 (carrier
Positions are EFSP Positions; the Strip does not leave the EFSP), H95 (undo), S-desk3/R3-16 (clocks). Research:
`docs/parallel/research/control-release.md`. Choices marked **settled H100 (…)** are the human's answers (decisions.md H100) to the questions in
`docs/wip/DES-RELEASE.md` § "Questions for the human".

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
   **settled H100 (DR-2 c): a manual mark now, geometric detection later; none in v1**; (c) when the transferring side
   retires its Strip while it still holds control **settled H100 (DR-6 a)**, always under the invariant below. Control is `coordination.separationResponsibilityRef`, which
   already exists and today moves at accept.
5. **Before control transfers, a control instruction must be coordinated.** A `SetBlock` that writes a heading or an
   altitude (the Block Map's control axis; **speed is not one**, H100 DR-11 b) is checked: the receiver may write within the release in effect;
   outside it, and the transferring side after ACCEPT (JO 7110.65 5-4-5 b), must attest "coordinated with <Position>"
   **settled H100 (DR-1 b, DR-10 a): attestation, audited; not a hard refusal**. A speed entry is never checked and never needs
   attestation.
6. **AIT, POINT_OUT, TRAFFIC and OPERATIONAL_REQUEST are unchanged.** AIT keeps control and comms at accept: it
   requires a written directive, which is exactly JO 7110.65 2-1-15 b ("handoff and frequency change ... when
   authorized by a facility directive or letter of agreement which specifies the type and extent") **settled H100 (DR-9 a)**.
7. **Intrafacility moves carry control with ownership** (`TransferStrip`, transfer-shaped NLAs such as APP to TWR,
   `CarrierHandoff`, `SfaRotation`): the facility directive is the agreement, as today **settled H100 (DR-4 a)**.
8. **A HANDOFF to the CARRIER Facility exists**: APP or CTR hands an ARRIVAL at INBOUND to `CV_MARSHAL`; the replica is
   minted as strip type MARSHAL at `IN_STACK` and joins the Marshal stack at the next free slot on accept, exactly like
   a recovery check-in **settled H100 (DR-3 a)**. ControlRelease applies to it like any HANDOFF. From then on the carrier's
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
                                                                              //   'BOUNDARY' | 'TRANSFERRING_RETIRED' | 'RECEIVING_RETIRED' | 'AIT'
release: null | { scopes: ['TURNS'|'CLIMB'|'DESCENT'|'FULL'], climbLimitFt?, descentLimitFt?,
                  condition: string|null, effectiveAt: ms|null,              // mission time (a gate, S-desk3)
                  grantedAt, grantedBy, grantedByPositionId,
                  withdrawnAt?, withdrawnBy? }                               // a withdrawn grant stays readable
releaseRequest: null | { scopes, note, requestedAt, requestedBy, requestedByPositionId,
                         answer: null | 'GRANTED' | 'REFUSED', answeredAt, answeredBy, reason }
```

`separationResponsibilityRef` stays the authoritative "who has control" and moves at transfer of control, not at
ACCEPT; `control.holder` is the readable mirror (both Strips agree; the Strips are on two Boards). One release is in
effect at a time: a new `GRANT` replaces the previous one (the audit keeps every one). `FULL` means every axis (turns, climb, descent) and
triggers decision 4 (a).

### The control invariant (H100 DR-6): a live flight never has nobody holding comms and nobody holding control

The human kept implicit control transfer on a drop (DR-6 a) on one condition: **no aircraft can get stuck where nobody has
comms and control.** Stated as a rule the code and the tests hold:

> **I.** For every flight with a HANDOFF exchange, at every instant, the communications holder and the control holder are
> each exactly one of the two sides, and that side's Strip is **live** (not dropped, not removed) and its owner Position
> is staffed or consolidated into a staffed Position. No transition may leave either holder on a retired Strip, and none
> may leave a holder undefined. (The two holders may differ: that is the normal state between `TRANSFER_COMMS` and control
> transfer.)

`commsHolder` is the transferring side until `comms.transferred`, then the receiving side; `controlHolder` is
`control.holder`. How I holds on every path that can retire, vacate, undo or end the exchange:

| Path | What happens | Why I holds |
|---|---|---|
| ACCEPT | moves ownership and radar ID only; comms and control stay with the transferring side | it proposed, so its Strip is live |
| PROPOSE, REJECT, CANCEL before ACCEPT | the proposer keeps both | one Strip, the proposer's |
| `TRANSFER_COMMS`, `TRANSFER_CONTROL`, FULL release plus comms | the holder moves to the receiving side only if that Strip is live and its owner staffed, else `NOT_STAFFED` and nothing moves | the move is refused unless its target is live |
| `WITHDRAW` | removes a release that has not moved control; moves no holder | nothing to strand; refused after control moved |
| Transferring side drops, joins away or archives its Strip while holding control or comms | **implicit transfer** (trigger `TRANSFERRING_RETIRED`): control moves to the receiving side, and comms too if it was still with the transferring side; one audit entry; a warning to the receiver when comms had not been transferred ("comms moved by the drop") | the receiving Strip is the only live one and becomes the holder of both |
| Receiving side drops or removes its replica while holding comms or control | the exchange ends and every holder it held **returns to the transferring side** (trigger `RECEIVING_RETIRED`), which is live; one audit entry | closes the case the first draft left open (control already moved, then the receiver drops) |
| Both Strips retired | the flight has no live Strip in the EFSP; I is vacuous | the controller's own act of ending the flight; a Drop of the last live Strip of a flight with an unfinished exchange shows the same confirmation as any last-Strip drop |
| Position signs off or is vacated while owning a Strip of the exchange | the Strip follows consolidation to a staffed Position, or the sign-off is refused: a Position never becomes unstaffed with exchange Strips and no covering Position (step 0 re-finds today's sign-off rule; if it can leave Strips without a staffed owner, the lane stops and tells "main") | the holder is the owner resolved through consolidation |
| Undo of a mark, a drop or a transfer | restores the before-image of the scope, which includes both Strips' exchange records; refused with `UNDO_BLOCKED` if the restored record names a holder whose Strip is now retired (ADR 0100 §3); undo of the drop that caused an implicit transfer restores the dropped Strip and the holders together | a restore is only applied to a state that was valid, and only if its holders are still live |
| Carrier: HANDOFF into CV_MARSHAL | the Marshal replica is minted at a Position that must be staffed or consolidated; control moves by the same marks; the Marshal Strip's retirement (recovery, `carrierRetireFlight`, drop) returns what it held to the transferring side as above | same rules; the Marshal Strip is an ordinary receiving Strip |
| Carrier: `CarrierHandoff`, `SfaRotation`, `TransferStrip` (inside one Facility) | control follows ownership through the one helper (decision 7); the new owner must be staffed (the NLA's existing gate) | one holder always: the owner |
| Peer Board unreachable, process restart | the record rides the snapshot; at restore and at every HANDOFF-family mutation `assertControlInvariant` runs: in tests it throws, in production it repairs by moving the holder to the surviving live side, writing an `InterfacilityControlRepair` audit entry and an `efsp-alerts` alert | a safety net, never the primary mechanism |
| TOFI, AIT | AIT keeps both at accept (decision 6); TOFI is untouched (H97) | both held by a live side from the start |

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
0051). A sibling `controlAxisFor(stripType, blockId)` returns `TURNS` (COURSE) or `CLIMB`/`DESCENT` (ALTITUDE, by
comparing the new value with the flight's current assigned altitude; no assigned altitude needs both or `FULL`), and nothing for speed: **`9A-SPEED` has no control axis** (**settled H100 (DR-11 b)**: the aircraft is released, not its
speed; speed restrictions such as 200 kt until 5 DME are rare and get no conformance check or attestation on the Strips;
there is no `SPEED` scope and no `control: 'SPEED'` attribute). In `SetBlock`, while a HANDOFF on the Strip is ACTIVE and
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

### Undo (H95) **settled H100 (DR-5 a)**

`TRANSFER_COMMS` and `TRANSFER_CONTROL` are one-click marks and go into the undo history: undone within 10 s they
restore both Strips' records (and control, if the mark moved it); changes the other controller made after it are
voided and that controller is told, per H95. `ControlRelease` actions are **not** undoable: a release is an
authorisation another controller may already have acted on; `WITHDRAW` is the correction, as on the frequency.

### Replicas, peers, resync

Every action is applied on the acting Board and mirrored on the peer Board through the Coordination collaborator's
`receive*` methods (as ACCEPT is today), in the same causal chain (`causedBy`), producing the usual two board-deltas.
The fields ride in the Strip, so the snapshot on connect (R3-47) and the persisted Board carry them; nothing new to
resync. `receiveCoordinationPeerGone` on the receiving side with control still transferring triggers decision 4 (c)
(`TRANSFERRING_RETIRED`, comms too); on the transferring side (the receiver dropped the replica) the coordination ends
and whatever the receiver held returns to the transferring side (`RECEIVING_RETIRED`), per the invariant above.

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
