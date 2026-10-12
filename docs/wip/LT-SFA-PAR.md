# LT-SFA-PAR (live test 2026-10-11: T1, T5, T11) — ADR 0117

Branch `lane/LT-SFA-PAR`, server and client. Wire change (protocol stays 2 locally; the last release speaks 1). Rulings: H128,
H134 LT-RQ5 a to LT-RQ9 a. FAA quotes: `docs/parallel/research/live-test-faa.md` Q1 to Q3; ADR 0117 cites JO 7610.14A
(effective 8-7-25, Chg 2) and JO 7110.65BB (Chg 3).

## What changed, per finding

| Finding | Change | Files | Tests |
|---|---|---|---|
| **T1** (H128) | No `SFA` Position: gone from the Incirlik config (positions, classes, letters, consolidation, radars, Bays), the capability table, the combination's non-local list (T26's line no longer names it) and the client mirrors. The SFA frequencies are AP's Bay `ap-sfa` (five Racks; filing there assigns the frequency, as before). Config `singleFrequencyApproach` is `{ jurisdiction: 'AP', pool: [{ rackId, mhz, use }] }`, `use` ROTATION ×3 / INITIAL_CONTACT / SPARE (H134 LT-RQ5 a), validated (≥5 UHF, exactly 3 rotating, the Bay is AP's, no unknown key). **No rotation record**: who has a rotating frequency follows the flight (PAR while it holds the flight's Strip, else AP), derived on the client; `sfa-store.js`, the `efsp-sfa-*` family, `SetSfaRotation`, `SfaRotation` and the SFA heartbeat/resync entry are gone. **AP → PAR is an ordinary `TransferStrip`** into PAR's ON_FINAL Bay: the server converts ARRIVAL/INBOUND to FINAL/ON_FINAL in place (`par-final.js` `PAR_HANDOFF`), so every path works (the live test's refused drop, a drag onto the PAR tab, the new **Hand off to PAR** button on AP's arrival on a rotating frequency). The frequency is never touched. | crc-sync: `config/efsp-facility-incirlik.json`, `facility-schema.js`, `facility-config.js` (`sfaPool` on the SFA Bay descriptor), `sfa.js`, `par-final.js` (new), `board/ops/transfer-strip.js`, `authority/positions/incirlik-military.js`, `permission.js`, `facility-rules.js`, `required-rules.js`, `stores.js` (`DROPPED_KEYS`), `combination.js`, wire/mission-reset/index/metrics/soak shadow/wire tools. crc-desktop: `sfa-state.js` (rewritten, pure), `bay-views.js` (SFA header, `finalHandoffButtons`), `strip-view.js`, `efsp-state.js`, `efsp-messages.js`, `efsp-ws.js`, `efsp-change-bus.js`, `bay-view.js`, `facility-topology.js`, `combination-rules.js`, `formation-rules.js`, `strip-fields.js`, `efsp-nla.js` | crc-sync `efsp-scenario-incirlik-l18`, `efsp-incirlik-l18-config`, `efsp-restore-refusal` (old snapshot with `sfaRotation` restores); crc-desktop `efsp-sfa-client`, `efsp-bay-views`; e2e `l18-incirlik` 01, 01b |
| **T5** | "Landing assured" is gone (no FAA order uses it). Op **`FinalCall`** (`call`: `BEGIN_DESCENT`, `CLEARED_TO_LAND`, `LANDED`), held by PAR's `recordsFinalCalls` column, never on the carrier. **Landed** sends the Strip to **GC directly** as ARRIVAL/TAXI_IN in `gc-taxi-in` (H134 LT-RQ6 b) through the same TransferStrip (`LANDED` conversion), so `par-final` is free and the next aircraft is handed in; GC drops it the ordinary way. FINAL's NLA at an airfield is Landed (same transfer); BALL is the carrier's alone. The FINAL Bay line has the Strip's **⋯ menu and Drop** (racks are hidden there). | crc-sync `board/ops/final-call.js` (new), `authority/strip-types/final.js`, `stores.js` (`finalCalls` on the persisted Strip). crc-desktop `par-model.js`, `par-panel.js`, `bay-views.js`, `strip-menu.js` (`openStripMenu` exported), `efsp-nla.js`, CSS | crc-sync scenario (Landed to GC, Bay free, second aircraft in; missed approach; GC unstaffed refused; undo); e2e `l18-incirlik` 02 and `par-panel` 06 assert the Bay (`gc-taxi-in`, `par-final` empty) and a second aircraft handed to PAR afterwards |
| **T11** | FINAL Block Map gains `7A` (ALT) and `9A-VECTOR` (HDG), the flight's clearance, so PAR amends AP's assignments; the FINAL Bay line has HDG and ALT fields (sent on Enter/leaving the field). **Begin descent** supersedes the assigned altitude with none (¶5-12-3). Conformance: on a final (FINAL Strip ON_FINAL, or the carrier's BALL) **no heading check** (H134 LT-RQ9 a); at an airfield the altitude is checked until Begin descent ends it (LT-RQ8 a); **carrier final: no altitude check either (ours, JO 7110.65 silent)**; a missed approach is checked again (¶5-10-12 climb-out). | crc-sync `block-map.js`, `conformance.js` (`finals` dep), `app/monitors.js`. crc-desktop `strip-template.js`, `strip-fields.js`, `bay-views.js` | crc-sync `conformance.test.mjs` (4 new), scenario (PAR sets HDG/ALT, Begin descent clears ALT); crc-desktop `efsp-bay-views`, `efsp-block-map-parity`, `efsp-ui-reachability`; e2e `l18-incirlik` 02 |

## Defaults taken (P2)

1. **The rotation is derived, not stored.** ¶5-10-15 c makes the selector follow the handoff, so a record AP must keep in step was
   removed instead of re-shaped. AP's SFA header shows, grey, each frequency with `AP`/`PAR` on the three that rotate, `INIT` and
   `SPARE` on the others. Nothing to set.
2. **Old snapshots with `sfaRotation` restore** (the key is read and dropped, `stores.js` `DROPPED_KEYS`) instead of stopping
   start-up. Otherwise the human's and the server's `state/efsp-board.json` would have to be deleted. Remove the line after the
   deploy (supervisor). Strips keep the field name `sfaTransfer` for the same reason (its `kind` is now `PAR_HANDOFF`).
3. **Which pool frequencies:** freq-1 (232.1) initial contact, freq-2..4 rotate, freq-5 (236.1) spare. Placeholders, as before.
4. **Hand off to PAR button only on a rotating frequency;** any other arrival is handed to PAR by a drag (same op). Keeps AP's
   ordinary inbound Strips as they were.
5. **No ¶4-7-3 a–e flagging.** The exceptions are about the pilot's radio; the Board has nothing to check them against. The FREQ
   Block stays AP's to amend.
6. **An unstaffed PAR** receives the handoff with `UNSTAFFED_RECEIVER` (ADR 0110: the Strip waits at PAR, AP is offered PAR's hat)
   instead of the old "PAR must be staffed" refusal. **Landed with GC unstaffed** and nobody offered GC is refused
   (`NO_RECEIVING_POSITION`); with GC's hat offered (LC, AP) it is delivered to GC.
7. **FINAL NLA at an airfield = Landed**, never inhibited on GC's staffing (that would also refuse the missed-approach drag via
   `alsoLegal`); the transfer itself refuses an unreachable GC.
8. **"On a final" for conformance = ON_FINAL (and the carrier's BALL).** BOLTER_WAVEOFF is checked again.
9. **The carrier's FINAL Strip also gets HDG and ALT** (one Block Map for FINAL). The carrier FINAL line was not changed.
10. **Recorded calls stay on the line greyed** (disabled button = the record) rather than vanishing.
11. **The empty FINAL line** reads "No aircraft on final." at both kinds (dropped "Rotate an aircraft in from SFA or AP": it told
    the controller their job).
12. **Missed approach** unchanged: FINAL's BOLTER_WAVEOFF in `par-missed`, back on final by its NLA. Who works the climb-out next
    (usually AP for another approach, research Q2 "inference") is not built: a question for the human (below).

## Usage-guide wording (for the docs pass)

- **Single frequency approach:** "There is no SFA Position. A single frequency approach is worked by AP and PAR (JO 7610.14A
  ¶7-1-5). AP files the arrival on one of the frequency Racks of its **SFA** Bay, which gives the flight that frequency. Three of the
  five frequencies rotate between AP and PAR; the first is AP's initial-contact frequency and the last a spare. The header over the
  Racks shows who has each rotating frequency now: PAR while it works the flight on it, otherwise AP. To hand the aircraft to the
  final controller press **Hand off to PAR** on its Strip (or drag it onto PAR). The pilot does not change frequency
  (JO 7110.65BB ¶5-10-15); PAR holds one aircraft on final at a time."
- **PAR final:** "The FINAL Bay shows one line per aircraft: its name (opens the PAR panel), the range, the assigned **HDG** and
  **ALT** (type a new value and press Enter), and **Begin descent**, **Cleared to land**, **Landed** and **Missed approach**. Begin
  descent ends the assigned altitude: on the glidepath nothing is checked against an altitude. Cleared to land records that you
  relayed the tower's clearance. Both stay on the line, greyed, once pressed. **Landed** hands the Strip to GC (Taxi In) and frees
  the final for the next aircraft. The ⋯ and ✕ at the end of the line are the Strip's menu and Drop."
- **Conformance (§ alerts):** "Heading is not checked on a final (PAR's or the carrier's): course guidance is the final
  controller's own call. Altitude is checked on a PAR final until Begin descent, and not at all on the carrier final (ours). A
  missed approach is checked again against what is then assigned."
- **Briefing (docs/efsp-briefing.md):** INCIRLIK has seven Positions; five synced stores (the SFA store is gone); `FinalCall` is a
  Board op; ADR 0117 supersedes the SFA parts of 0075 and 0093. CLAUDE.md's "six stores" in the soak paragraph becomes five
  (`tools/soak/shadow.js` already says five).

## Walks done / not done

Done (crc-sync scenario): handoff on a rotating frequency and off the SFA Bay; who may hand off; pilot switches frequency before
the handoff; Landed to GC with a second aircraft in; NLA and drag both land; Begin descent/Cleared to land once; missed approach
with a second aircraft landing first; PAR unstaffed (offered) and late; GC unstaffed with nobody offered; undo of the handoff and of
Landed; PAR vacates on final. Not done: a pilot asking for a frequency change mid-approach (¶4-7-3 b) — nothing to build, the
Board does not model the radio; the conformance `finals` map is unit-tested and wired in `app/monitors.js` but not walked live.

## Gates

crc-sync 2673 → 2676 tests (all pass; the SFA-store and rotation tests replaced by the handoff, Landed, FinalCall and conformance ones); crc-desktop 1267 → 1267 (all pass; tests replaced, not added in number); `npm run freeze`
56/56 after one `freeze:update` (large but explained diff: INCIRLIK's position lists and snapshot hashes without SFA, the random
walks reshuffled because SFA left their pick list, the L18 scenario rewritten; no new refusal kinds); `npm run walk` 23/23;
`soak:selfcheck` PASS; `wire:record` (protocol stays 2); module-graph fixture re-recorded. Playwright lane 3: `l18-incirlik`,
`par-panel`, `store-resync` 12/12 (`l18-incirlik` again 4/4 after a spec-hygiene fix), plus `smoke` and `gclc-combine` 3/3.

## Findings for other lanes / the supervisor

- **Missed approach (question for the human):** who works it after PAR's missed-approach Bay? Today it goes back on final at PAR.
  Usual military practice (research Q2, inference) is back to AP for another approach: that would be a FINAL → ARRIVAL INBOUND
  conversion to AP, the mirror of PAR_HANDOFF.
- **T22 metric:** the AP → PAR handoff is now a `TransferStrip`, so it counts as a transfer; Landed is a `FinalCall` (its transfer
  runs inside) and is not counted. Whether Landed should count is LT-UI's / the metrics owner's call.
- **`DROPPED_KEYS` in stores.js** tolerates the old `sfaRotation` key: remove after the deploy, or decide to refuse.
- **Docs pass:** CLAUDE.md and the briefing mention "six stores" and the SFA Position; ADRs 0075/0093 are superseded in part.
