# CARRIER-FLOW: the carrier strip flow (design, 2026-11-08)

ADR **0156** holds the decision; this note is the design the plan is written from. The rulings are the human's, in
session on 2026-11-08 (the flow, the buttons, the panel, the scopes); nothing here was taken from CV NATOPS beyond what
ADR 0113/0114/0137 already quote.

## 1. The flow

```
DEPARTURE                                            ARRIVAL
Case I    PriFly ON_DECK ─┬─ DROP                     Case I      Marshal STACK ── TO PATTERN ──▶ PriFly CV_PATTERN ── DROP
                          └─ to Marshal ─▶ STACK
Case II   PriFly ON_DECK ── Launched ──▶ Dep          Case II/III Marshal STACK ── COMMENCE ──▶ COMMENCED
Case III     CV_AIRBORNE ── KILO ─┬─ DROP                         ── TO APPR ──▶ lane FINAL_APPROACH ── DIRTY UP ──▶ DIRTY
                                  └─ to Marshal ─▶ STACK          ── FLY BULLS ──▶ BULLSEYE ── TO PATTERN ──▶ CV_PATTERN ── DROP
```

- "to Marshal" changes `CV_LAUNCH` to `CV_RECOVERY` in place (as ConvertToArrival does, ADR 0023), accepted automatically, joins
  the stack at the next free slot with the ship's current Case as its `recoveryCase`.
- Back to stack (the Marshal, from STACK / COMMENCED / FINAL_APPROACH / DIRTY) and the lane's hand back (from
  FINAL_APPROACH / DIRTY) are one transfer: next free slot, new EAT, Angels/DME derived again, HDG/SPD/ALT and the panel
  overrides cleared.
- Abort to the Case II/III stack: "…" on a Case I `CV_RECOVERY` (STACK or CV_PATTERN), only while the ship's Case is II or
  III. Sets `recoveryCase` to the ship's Case and puts it at STACK, new slot.
- Lane choice at TO APPR: `laneFor()` (push-order alternation, H30) as the default; the Marshal may pick the other lane
  from "…" before pressing it.

## 2. Server (crc-sync)

| Piece | Where | Change |
|---|---|---|
| Strip types | `efsp/authority/strip-types/` | new `cv-dep.js`, `cv-arr.js`; remove `marshal.js`, `pattern.js`; `final.js` loses its CARRIER branches (PAR only) |
| State owners | the two new tables | `CV_PATTERN` owner by `recoveryCase`: PriFly in I, the lane in II/III (owner table gains a Case-aware form, or the NLA and `mayAdvance` read it: decide in the plan, prefer data) |
| Handoffs | `efsp/carrier/handoffs.js`, `handoff-effects.js` | rows: LAUNCH_TO_DEPARTURE, DEPARTURE_TO_MARSHAL (converts), PRIFLY_TO_MARSHAL (Case I, converts), MARSHAL_TO_APPROACH (TO APPR), MARSHAL_TO_PRIFLY_CASE_I (TO PATTERN), RETURN_TO_STACK (Marshal or lane), ABORT_TO_STACK; the rest removed |
| Stack | `efsp/carrier/marshal-stack.js` | keyed on `CV_RECOVERY`; `SetAngels`, `SetDme` beside `SetEat` (stored overrides, cleared on return to stack); DME derived Angels + 15 |
| Fields | flight data / carrier flight record | `departureRadialDeg` (magnetic), `recoveryCase` on the Strip; side number required at create for a carrier Strip, callsign optional |
| Create | `board/ops/create-strip.js`, `creatorOwnsInitialState` | PriFly creates `CV_LAUNCH`, the Marshal `CV_RECOVERY`; side number, not callsign |
| Set callsign | carrier op or flight-data edit | binds the ATO line (`carrier/ato-bind.js`) at that moment |
| Squawk | existing allocation | Case II/III only, kept through the conversion |
| Correlation | correlation path | no auto-correlation for a Case I `CV_RECOVERY`/`CV_LAUNCH`; manual bind allowed |
| Conformance | `efsp/conformance` | on for Case II/III carrier Strips, assigned values only |
| Conflict alert | `conflict-alert.js` | skip a pair where both tracks are correlated to a live carrier Strip |
| Presentation | `surveillance/presentation.js`, `identity.js` | a carrier Strip gives identity only at the carrier map (side number) and at TACTICAL (callsign, once set); elsewhere sensors only |
| Facility | `config/efsp-facility-carrier.json` | Bays: PriFly `cv-prifly-launch` (ON_DECK), `cv-prifly-pattern` (CV_PATTERN); Dep `cv-dep-departures` (CV_AIRBORNE, KILO in the same Bay); Marshal `cv-marshal-stack` (STACK, COMMENCED); lanes `cv-appN-approach` (FINAL_APPROACH, DIRTY, BULLSEYE), `cv-appN-pattern` (CV_PATTERN); `cv-marshal-airborne`, `cv-prifly-recovered`, the lane `final`/`bolter` Bays go |
| Counting | strip-type `countablePreDropStates` | a launch counts once: from CV_AIRBORNE or KILO (II/III), from ON_DECK in Case I (PriFly drops a Case I departure once it is airborne, so a cancelled Case I launch counts too: accepted, there is no airborne state to tell them apart); a recovery counts at CV_PATTERN; a departure converted to an arrival counts as a launch and later as a recovery |

The carrier map's "where is this aircraft" (the circle, the Case II/III graphic) needs a track for a Case I flight only
if the controller bound one; an unbound Case I flight is listed in the table and not drawn.

## 3. Client (crc-desktop)

- `strip-template.js` / block maps: the Blocks of ADR 0156 §8, nothing else, for `CV_LAUNCH` and `CV_RECOVERY`.
- `panel/create-strip.js`: side number field at carrier Positions; PriFly gets type and departure radial, the Marshal type
  and fuel.
- `strip-menu.js` ("…"): Set callsign; Back to stack (Marshal); Hand back to Marshal (lane); Abort to Case II/III stack
  (Marshal, Case I flight, ship Case II/III); lane override (Marshal, at COMMENCED).
- `marshal-board-model.js`, `marshal-panel.js`, `marshal-picture.js`: rows are every `CV_RECOVERY`; the button per row, live
  for the owner; Case I table + circle (ship-up, live bearing/range, side number + Angels); Case II/III table + the
  current graphic; click-to-edit FUEL, EAT, ANG, DME; the fuel/bingo colouring and `marshalLowStateMarginKlb` removed.
  Which layout a row is in follows its `recoveryCase`, so a panel can hold both while Case I flights finish after a
  Case change: the circle shows the Case I rows, the graphic the II/III rows.
- `carrier-map-panel.js`: the measure line, reusing the main map's measure code (`map-layers-overlays.js`) rather than a
  copy; carrier tracks labelled there only.
- Cursor readout (ADR 0156 §15): in `carrier-map-panel.js` only, `RRR/DDD` from the ship the map is drawn around, in the
  ring-label green (`COL.ringText`), drawn by the carrier map itself (not the topbar's `#cursor-bra`); the magnetic text from
  the same helper the panel's bearings use (`carrierBearingText`).
- `track-label.js` needs no carrier rule: it renders what `presentTrack()` sent.

## 4. Wire, data, docs

- `npm run wire:record` (new strip types, states, handoff kinds, stack ops, fields): `WIRE_PROTOCOL` bump.
- Freeze goldens re-recorded (`npm run freeze:update`, committed alone).
- No migration: the mission reset clears carrier Strips; a `state/efsp-facility-carrier.json` on the server must go.
- Docs: `docs/efsp-usage-guide.md` carrier chapter, `crc-desktop/build-assets/release-notes.md`, ADR 0156 to Built.

## 5. Tests

- Server: per strip type the NLA table for each Case and owner; every handoff (legal / refused by Case, Position, state);
  the conversion keeps Strip id, flight and squawk; return to stack gives a new slot and clears overrides and
  assignments; Abort only in the right Case; conflict-alert exemption (both carrier: none; one carrier: alert);
  presentation per Position class; create by side number, ATO bind on Set callsign.
- Scenarios: replace `efsp-scenario-carrier-l17` / `-ato` with a Case I, a Case II and a Case III walk from ON_DECK to
  DROP, one round trip departure → Marshal → recovery, one Case I abort after a Case change, one lane hand back.
- Client: `marshal-board-model` rows and buttons by owner; Strip Blocks per type and Case; e2e `l17-carrier.spec.js`
  rewritten for the new buttons.

## 6. Lanes (for the plan)

1. **Server model**: strip types, handoffs, stack ops, fields, create, facility file, counting. Everything depends on it.
2. **Server surveillance**: presentation, conflict exemption, conformance, Case I no-auto-correlation (after 1's types exist).
3. **Client Strips and Marshal panel** (after 1).
4. **Carrier map measure line and the carrier cursor readout** (independent, can start at once).
