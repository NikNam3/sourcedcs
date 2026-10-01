# DES-RELEASE: control release on HANDOFF (H94) and the TOFI regime at airspace entry (H97)

Post-refactor design agent, docs only. Branch `lane/DES-RELEASE-release-tofi` from `165a517`.

## Report

- **Files:** `docs/wip/DES-RELEASE-adr-0101.md` (ControlRelease, comms and control transfer on HANDOFF),
  `docs/wip/DES-RELEASE-adr-0102.md` (TOFI regime effective at airspace entry or manual mark),
  `docs/parallel/post-refactor/CONTROL-RELEASE.md`, `docs/parallel/post-refactor/TOFI-REGIME.md`, this file.
- **Key decisions:** ACCEPT moves radar ID and ownership only; `TRANSFER_COMMS` and `TRANSFER_CONTROL` are HANDOFF
  actions; `ControlRelease` is one op kind `GRANT|REQUEST|REFUSE|WITHDRAW` (scopes TURNS/CLIMB/DESCENT/FULL, altitude
  limit, condition, mission-time `effectiveAt`); control = the existing `separationResponsibilityRef`, moving at
  comms+FULL, at a manual boundary mark, or when the transferring side retires its Strip; control-axis `SetBlock`s
  are checked through a `controlAxisFor` sibling of `interlockFor`, with a "coordinated with" attestation outside the
  release. AIT, POINT_OUT, intrafacility moves unchanged. HANDOFF into CV_MARSHAL added. TOFI: picked regime is
  pending until a monitor sees the flight inside an airspace ACTIVE for the MRU (0098 query) or the MRU marks
  Entered; leaving/deactivation raises an alert, never auto-reverts.
- **Questions for the human:** DR-1 … DR-11 below (each with a recommendation the drafts use).
- **Interface asked of 0098:** I1–I4 below; relayed via "main" and accepted by DES-AIRSP with three precisions (built by AIRSP-2S-A, which merges before TOFI-REGIME).
- **Lane sizing:** CONTROL-RELEASE ≈ 2.25 lanes (server 1.25 + client 1, Sonnet); TOFI-REGIME ≈ 1 lane (Sonnet),
  after AIRSP phase 2's registry merges.

## Sources read

decisions.md H78, H79, S-desk3, S-ARCH2, H92–H98, S-R3-80, S-TEST; `research/control-release.md` (all, incl. "ATC <->
military"); `research/vocabulary.md`; `docs/wip/ARCH-plan.md` §2; `refactor/README.md`, `refactor/BOARD-3.md`;
ADR 0074 and the usage guide §8K (carrier). Code (read-only, at `165a517`):

| Topic | Today's code (symbol) | Target layout (ARCH-plan §2.3) |
|---|---|---|
| All-at-accept effect | `coordination.js` `COORDINATION_EFFECTS.HANDOFF` (all four flags true) | `coordination.js` facade over `authority/` |
| Receiver accept | `board-store.js` `_applyCoordinationAccept` | `board/coordination.js` `Coordination` |
| Sender mirror | `board-store.js` `receiveCoordinationResponse` (also `SENDER_STATE_ON_ACCEPT`) | same collaborator; tables from `authority/roles/*` |
| Replica mint | `receiveCoordinationProposal` (`REPLICA_STATE_ON_RECEIPT`) | same |
| Peer gone | `receiveCoordinationPeerGone`, `_applyCoordinationCancel` | same |
| TOFI | `_applyTofiOp/_applyTofiAccept/_applyTofiTransferComms`, `receiveTofi*` | `board/tofi.js` `Tofi` |
| Regime | `fdr-store.js` `setTofi`, `SEPARATION_REGIMES`; SREG Block guarded by `activeMarsaFor` in `_applySetBlock` | unchanged store |
| Control axis | `block-map.js` `interlockFor` (COURSE/ALTITUDE), Blocks 7, 7A, 20, 21, 9A-VECTOR; 9A-SPEED is an annotation | `block-map.js` + new `controlAxisFor` |
| Carrier | `_applyCarrierTransfer`, `carrier/transfer-effects.js`; CV Positions get `NON_CREATE_OPS` (no coordination) in `permission.js` | `board/ops/carrier-handoff.js`, `authority/positions/carrier.js` |
| Departure release | `assigned.releaseState`, `release-envelope.js`, HELD NLA (ADR 0017/0028/0039) | untouched |
| Airspace | `airspace-store.js` (SCHEDULED/ACTIVE/RELEASED/RETURNED; `usingPositionId` only, RANGE); `strip.airspaceEntry` | 0098 registry (§2.7) |
| Monitors | `conformance.js` (`trackStore`, `correlationStore`, `indicatedAltFt`); alerts on `efsp-alerts` (`ws-hub.js`) | `createApp` tickers |
| Client | `strip-view.js` `_coordinationExchange`, `_tofiExchange`, TOFI indicator; `bay-view.js` `_canProposeCoordination` | `panels/efsp/bay/popovers/*`, CMSG |

Findings while reading (no action, for the lanes):
- F1 Today the carrier cannot receive any coordination (`permission.js` CV grants are literals over
  `NON_CREATE_OPS`; ADR 0074 "the carrier does not talk to the centre"), and recovery Strips appear by a Marshal
  check-in (`CreateStrip`). H94's "after a hand-over to the carrier (Marshal) the Strip does not leave the EFSP"
  therefore needs a new HANDOFF path into CARRIER (DR-3).
- F2 `airspace-store.js` has no notion of an MRU as using agency (only `usingPositionId`, the RANGE Positions), and
  today's `efsp-airspaces.json` is `[]`. "ACTIVE for that MRU" needs I1.
- F3 TOFI's `TRANSFER_COMMS` is only allowed on the MISSION side; HANDOFF's will be allowed on either side (DR text in
  ADR 0101 decision 2). Not a contradiction: the receiving side recording check-in is the common case on HANDOFF.

## Questions for the human

Each recommendation is the drafts' default (marked **[default, DR-n]** there).

| Id | Question | Options | Recommendation |
|---|---|---|---|
| DR-1 | Before release, a receiver's heading/altitude/speed entry outside the release: | (a) hard refusal; (b) allowed after a "coordinated with <Position>" attestation, audited; (c) allowed with a warning only | **(b)**: verbal coordination is the real path (2-1-14 "coordination has been completed"); the same shape as ADR 0019's degraded-track note |
| DR-2 | How is "control transfers at the boundary" detected? | (a) manual "Control" mark by either side; (b) geometric, needs APP/CTR sector polygons in the 0098 registry (not planned there); (c) both, (b) later | **(a) now, (c) later**: no sector geometry exists; the mark is what happens on the frequency |
| DR-3 | Carrier: build an interfacility HANDOFF APP/CTR → CV_MARSHAL (replica minted MARSHAL at IN_STACK, next free stack slot on accept)? And CV → CTR for carrier departures? | (a) inbound only; (b) both directions; (c) neither (Marshal keeps creating recovery Strips by hand) | **(a)**: H94 says the hand-over to Marshal happens in the EFSP; outbound is a new capability (H78/H93 spirit: defer) |
| DR-4 | Do intrafacility moves (APP → TWR transfer NLA, `TransferStrip`, `CarrierHandoff`, `SfaRotation`) get ControlRelease? | (a) no, control moves with ownership (facility directive, 2-1-15 b); (b) yes | **(a)**: H94 names HANDOFF; intrafacility moves are one-click by design (H95) |
| DR-5 | Undo (H95): | (a) `TRANSFER_COMMS`, `TRANSFER_CONTROL`, TOFI `MARK_ENTERED` undoable in 10 s; `ControlRelease` not undoable, `WITHDRAW` instead; (b) everything undoable; (c) nothing | **(a)**: a release may already have been acted on by the other controller |
| DR-6 | The transferring side drops/retires its Strip while it still holds control: | (a) control transfers implicitly (trigger `TRANSFERRING_RETIRED`), warning if comms not transferred; (b) refused until comms+control moved | **(a)**: refusing a Drop strands Strips; the audit records it |
| DR-7 | TOFI: the flight leaves the ACTIVE airspace, or the airspace deactivates, while a non-ATC regime is effective: | (a) regime stays, alert `REGIME_OUTSIDE_AIRSPACE` on both Strips until back inside or SREG→ATC; (b) auto-revert to ATC; (c) nothing | **(a)**: (b) would tell ATC it separates without anyone telling ATC (7610.14 8-1-7/8-1-11) |
| DR-8 | Manual "Entered" mark: who, and only inside an ACTIVE airspace? | (a) MRU side only, always allowed, warning when not inside; (b) either side; (c) MRU only and only when inside | **(a)**: geometry may be missing (`unknown`) and the MRU hears "entering" on its frequency |
| DR-9 | AIT keeps everything at accept? | (a) yes (requires a written directive = 2-1-15 b); (b) AIT also gets the steps | **(a)** |
| DR-10 | After ACCEPT, the transferring side's own heading/altitude/speed entries before control transfers: | (a) need the same attestation (5-4-5 b: approval of the receiver); (b) free | **(a)** |
| DR-11 | Speed: | (a) a `SPEED` control axis on 9A-SPEED, covered only by FULL; (b) speed not checked | **(a)**: 2-1-14 lists speed; no ICAO/FAA "released for speed" scope exists |

## Interface asked of 0098

Sent to "main" for relay to DES-AIRSP (2026-10-01). **Accepted by DES-AIRSP** with three precisions (its draft
`docs/wip/DES-AIRSP-adr-0098.md` §3, §6, §7); ADR 0102 § "Depends on" and TOFI-REGIME.md carry the aligned text.

- **I1** At most one using agency per definition: `usingPositionId` (RANGES) **xor** `usingFacilityId` (the MRU);
  both = `VALIDATION_ERROR`, neither = the controlling Position acts for both; `usingFacilityId` editable only while
  RETURNED; which Positions of the using Facility act is the authority capability `airspaceUse` (0098 DA-7: TAC_C2
  only). ACTIVE for MRU F ⇔ `state === 'ACTIVE'` and (`usingFacilityId === F` or `usingPositionId` belongs to F).
- **I2** `activeContaining({ lat, lon, altFt }, { usingFacilityId }) → { inside: [{airspaceId, kind, name}], unknown:
  [...] }`, pure and synchronous, ~1 Hz per flight, current theater only (`MissionSession.theatre`), injected
  through deps. AREA: point in polygon and inclusive band (null = unbounded). ROUTE: legs `segments[i].fix →
  segments[i+1].fix` (last element = exit fix only), within half the leg width and inside the leg's band. `unknown`
  only when `geometry === null` (DCS drawing points are copied at selection, 0098 DA-2).
- **I3** `isActiveFor(airspaceId, usingFacilityId) → boolean` (as asked).
- **I4** Limits are indicated feet (`altimetry.js` `indicatedAltFt`: QNH feet below transition altitude, FL × 100 at
  and above); the caller converts and polls.
- Built by lane **AIRSP-2S-A** (`crc-sync/src/efsp/airspace/containment.js`), which merges before TOFI-REGIME;
  TOFI-REGIME codes against a stub until then. Also offered: `containing(point)` (any state), not needed.
- Not needed: a change listener (the monitor polls), APP/CTR sector geometry (DR-2 (c) would need it later).

## UI sketch (text)

HANDOFF, receiving side (APP's Strip after ACCEPT):

```
┌ HANDOFF ← CTR   RADAR CONTACT 1412 · comms: CTR · control: CTR ───────────────┐
│ release: TURNS, DESCENT ≥ FL120 "after GAPRA" (CTR 1413)                      │
│ [Request release ▾]  [Checked in]  [Control]                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

- `Request release ▾`: chips TURNS / CLIMB / DESCENT / FULL + note → `ControlRelease REQUEST`; the row then reads
  "release requested 1414 · TURNS" until answered; a refusal shows "UNABLE (CTR): traffic" in the attention colour.
- `Checked in` = `TRANSFER_COMMS`; `Control` = `TRANSFER_CONTROL` (title: "control at the boundary").
- Editing Block 7/7A/20/21/9A-VECTOR/9A-SPEED outside the release opens a one-line prompt in the Block editor:
  "Not released for DESCENT. Coordinated with CTR? [Coordinated] [Cancel]" → resends with `coordinatedWith`.
- After control transfers the row collapses to the ordinary "HANDOFF ← CTR · ACTIVE" (control: APP), as today.

HANDOFF, transferring side (CTR's Strip):

```
┌ HANDOFF → APP   RADAR CONTACT 1412 · comms: CTR · control: CTR ───────────────┐
│ APP requests: TURNS (1414)                         [Refuse]  [Grant TURNS]   │
│ [Control release ▾]  [Transfer comms]  [Control]                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

- `Control release ▾` (never a bare "Release"; the HELD departure NLA keeps that word): scope chips, two optional
  altitude limits, condition text, optional "at HHMM" (mission Zulu) → `GRANT`; while a grant is in effect the menu
  offers `Withdraw`.
- A compact chip on the Strip face in both Bays: `CTL CTR` / `CTL APP`, `REL T D` (scopes), `COM ✓`.

TOFI (both Strips): SEP REG Block shows the effective regime; while pending it reads `ATC → USING_AGENCY @entry`
(dimmed), on the MISSION Strip with an `[Entered]` button; `REGIME_OUTSIDE_AIRSPACE` shows as an attention chip
"SEP REG USING_AGENCY outside R-2301 since 1432" on both Strips and in the alert list.

## Test plan (summary; details in the briefings)

Server unit tests (`node --test` on the touched files): the effect table; accept leaves comms/control; each action's
permission and state guards; mirror on the peer Board with `causedBy`; the four control-transfer triggers; the
control-axis check matrix (scope × side × climb/descent × limit × `effectiveAt` before/after on a fake mission
clock); AIT unchanged; audit one entry per outcome; undo of the marks within/after 10 s on a fake wall clock; snapshot
round-trip; CV_MARSHAL inbound HANDOFF minting MARSHAL/IN_STACK into the stack. TOFI: pending vs effective; monitor
entry with 2-tick debounce, already-inside-at-accept, leave/deactivate alert with grace, unknown geometry, MARSA
precedence, EXIT with pending, manual mark with/without containment. `soak:selfcheck` (board files touched). Client:
the exchange rows and the attestation prompt, the touched-panel Playwright specs only (S-TEST).
