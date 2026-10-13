# LT-PAR-MISSED: a missed approach on the PAR final goes back to AP (H137 LT-PQ1 a)

Branch `lane/LT-PAR-MISSED`, server and client, a follow-up to LT-SFA-PAR (ADR 0117). No new ADR: the addendum below is for
the supervisor to record in decisions.md. Wire changed (two new keys, `wire:record`: protocol stays 2).

## Addendum to ADR 0117 (for decisions.md)

**Ours** (the orders are silent on who works the climb-out; research Q2): after a missed approach on a PAR final at an
airfield the Strip goes **back to AP** as an ARRIVAL at **INBOUND**, for re-sequencing.

1. **Built like Landed.** A third conversion in `par-final.js`, `MISSED_APPROACH`: FINAL at ON_FINAL **or** BOLTER_WAVEOFF
   becomes ARRIVAL at INBOUND with AP, through the one `TransferStrip` (same Strip, same flight, nothing else on the flight
   touched). Reached three ways, all the same transfer:
   - the FINAL line's (and the PAR panel's) **Missed approach**, now op `FinalCall` `call: 'MISSED_APPROACH'` (was
     `SetState BOLTER_WAVEOFF`);
   - FINAL's **NLA at BOLTER_WAVEOFF** at an airfield, `{ toState: 'INBOUND', transferTo: 'AP' }`, labelled **Back to AP**
     (was "Back on final" to ON_FINAL);
   - a drag of the FINAL Strip onto AP.
   Only the final controller (`recordsFinalCalls`, PAR) makes it. AP unreachable (unstaffed, nobody offered AP's hat) is
   refused `NO_RECEIVING_POSITION`, as Landed is with GC.
2. **Why INBOUND.** It is the state AP works an arrival in (`ARRIVAL_STATE_OWNERS.INBOUND`), the state AP's SFA Bay
   implies, and the only state `PAR_HANDOFF` converts from, so the second approach is AP's ordinary **Hand off to PAR**.
   ARRIVAL has no "re-sequenced" state and needs none.
3. **Where it lands.** On AP's SFA frequency Bay (`ap-sfa`), on the Rack that is the flight's frequency, when the flight
   is on a pool frequency; otherwise AP's first INBOUND Bay (`ap-inbound`). New `Placement#transferTargetFor`, used by
   `FinalCall` and by every transfer-shaped NLA (`invoke-nla.js`). Only a Position with an `sfa-freqs` Bay implying the
   target state is affected, which today is AP for INBOUND only. The pilot does not change frequency (¶4-7-4 g: none
   before the missed approach altitude; ¶5-10-15 c): the rotating frequency shows AP again because PAR no longer holds a
   Strip of a flight on it. PAR's `par-final` is free at once.
4. **Climb-out.** PAR types the climb-out heading and altitude in the FINAL line's HDG and ALT before pressing Missed
   approach (¶5-10-12: "a specific heading and altitude"). They are the flight's clearance, so they stay with the flight,
   and conformance checks them as any arrival's (an ARRIVAL at INBOUND is not "on a final"). Nothing new in
   `conformance.js`.
5. **`finalCalls` are cleared** by the conversion (`delete strip.finalCalls`), so Begin descent and Cleared to land can be
   recorded again on the next approach. The history stays in the Mutation log, where each FinalCall is its own line. Undo
   puts them back with the rest of the Strip. `sfaTransfer` is kept: it names the last handoff to PAR, and the next one
   overwrites it.
6. **PAR's `par-missed` Bay stays.** A drag there (ON_FINAL's `alsoLegal`) keeps the aircraft with PAR, for example when AP
   cannot take it. Its NLA is Back to AP. A drag from there back onto PAR's final is now refused: re-sequencing is AP's.
7. **The carrier is unchanged.** A bolter or waveoff is CV procedure, not FAA. `conversionFor` never converts at the
   carrier, `FinalCall` is refused there, and its BOLTER_WAVEOFF NLA is still "Back on final" to ON_FINAL.

## Carrier FINAL: HDG and ALT are the PAR final's (supervisor ruling, for decisions.md)

The sharded run failed `e2e/l17-carrier.spec.js` 03: the carrier FINAL Strip had two editable cells, because LT-SFA-PAR's
default 9 gave the shared FINAL Block Map HDG (`9A-VECTOR`) and ALT (`7A`). Ruling: they belong to an **airfield's PAR
final** only. The carrier FINAL has nothing to type (ADR 0116, H125), and no conformance (ADR 0117 decision 8), so they
are also **hidden** there (dark cockpit, H115 to H119), not shown read-only.

- crc-sync `block-map.js`: `PAR_FINAL_ONLY_BLOCKS` (`7A`, `9A-VECTOR`); `resolveBlockTarget(stripType, blockId, facilityId)`
  returns null for them on FINAL at `CARRIER`, so SetBlock is refused `VALIDATION_ERROR` (`facility-rules.js` passes its
  facility id). The L17 scenario asserts both refusals.
- crc-desktop `strip-template.js`: the same list and `isParFinalOnlyOnCarrier()`. `isBlockEditable(…, facilityId)` uses
  it (`bay/block-edit.js` passes `strip.facilityId`). `strip-fields.js` `compactBlocksFor()` leaves them off the
  carrier FINAL's face (by `facilityOfPosition(owner)`), and `bay/strip-expanded.js` leaves them out of the expanded
  view. Parity test: `efsp-block-map-parity`. Unit tests: `efsp-strip-fields` and `efsp-ui-reachability` (the carrier
  FINAL has no editable cell, no input, and neither Block).
- The FINAL line's HDG/ALT inputs (`bay-views.js`) were already on the airfield kind only.

## Defaults taken (P2)

1. **The Missed approach button goes straight to AP**; it does not stop in `par-missed` first. That is one press, as
   Landed is. `par-missed` is still there for PAR to keep the aircraft (item 6).
2. **The receiving Position is AP by the arrival state table** (`ARRIVAL_STATE_OWNERS.INBOUND[0]`), as Landed's GC is
   `TAXI_IN[0]`. It is not read from `sfaTransfer.from`.
3. **No re-check against the ¶4-7-4 g altitude.** The Board does not know the missed approach altitude, so the move to AP
   is the controller's press, never gated on altitude.
4. **The NLA label comes from the server's `strip.nla.transferTo`** (client `FINAL_TRANSFER_LABELS`, parity-tested
   against `computeFinalNla`). The wire did not change for it.

## Usage-guide wording (for the docs pass)

- **PAR final** (replaces the Missed approach sentence): "**Missed approach** hands the aircraft back to AP for another
  approach (ours: the orders do not say who works the climb-out). Give the climb-out heading and altitude in HDG and ALT
  first; they stay assigned and are checked. The Strip goes to AP's SFA Bay, on its frequency, and your final and that
  frequency are free for the next aircraft. Begin descent and Cleared to land start fresh on the next approach. To keep
  the aircraft yourself, drag it to the missed-approach Bay; its button there is **Back to AP**."
- **AP, single frequency approach:** "A missed approach comes back to you on its frequency Rack. Press **Hand off to
  PAR** again when it is sequenced."
- **Carrier:** "Bolter and waveoff are unchanged: the aircraft stays with the approach lane and goes back on final."

## Walks done / not done

Done (crc-sync `efsp-scenario-incirlik-l18`): Missed approach after Begin descent and Cleared to land with a climb-out
set, then a second aircraft lands first and the first is handed in again and lands (calls re-recordable, climb-out
kept, frequency unchanged, Mutation log keeps both approaches' calls); off the SFA frequencies to `ap-inbound`; AP cannot
press it; `par-missed` drag then NLA, and a drag onto AP; AP unstaffed with nobody offered; undo restores the final with
its calls. Playwright lane 3: `l18-incirlik` 02b (FINAL line: missed approach, back to AP on `freq-3`, header "· AP",
Hand off to PAR, second approach, Landed) and 02c (`par-missed` NLA reads "Back to AP"); `par-panel` 05 (the panel's
Missed approach goes to AP).
Not done: the climb-out alerts live. Conformance is unchanged and the flight is an ordinary arrival.

## Gates

crc-sync 2687 → 2691 (all pass). crc-desktop 1272 → 1275 (all pass). `npm run freeze` 56/56 after two `freeze:update`
runs, each committed separately: `scenario-incirlik-l18.json` (the missed-approach walks, rewritten and added) and
`scenario-carrier-l17.json` (two refused carrier HDG/ALT SetBlocks; the ids after them renumber). `npm run walk` 23/23.
`soak:selfcheck` PASS, run again after every change. `wire:record` adds `parFinal.conversions` and `finalCalls`
`MISSED_APPROACH`; the protocol stays 2. Module-graph fixture re-recorded (`efsp-nla.js` `FINAL_TRANSFER_LABELS`;
`strip-template.js` `PAR_FINAL_ONLY_BLOCKS`, `isParFinalOnlyOnCarrier`). Playwright on lane 3, the three specs together:
`l17-carrier` 6/6 (03 included), `l18-incirlik` 6/6, `par-panel` 7/7, which is 19/19 on two runs in a row. An earlier
interrupted run reported 17/19 (`par-panel` 06 `toBeVisible`, plus one more). It did not come back on either re-run,
one before and one after the hiding change, so I count it as a timing flake on the shared Board, not a defect.

## Findings for other lanes / the supervisor

- **T22 metric:** the missed approach is a `FinalCall` (its transfer runs inside), so it is not counted as a transfer,
  the same as Landed. A drag onto AP or the `par-missed` NLA is counted.
- **Stale comment:** `crc-sync/src/surveillance/par-monitor.js` line 10 still says "Landing assured". It was not
  changed here (the file was not otherwise touched).
- **`overflight-shared-state-names` ALLOWED** gains `final.js` and `final-call.js`: their INBOUND is ARRIVAL's, through
  the conversion.
- **Docs pass:** ADR 0117 decision 6 says the carrier's FINAL Strip "gets them too". The ruling above supersedes that
  half; record it with the addendum.
