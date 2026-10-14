# U-RSU-DESIGN (lane note): the RSU as a VFR list, ADR 0120, and the U-RSU build briefing draft

Lane U-RSU-DESIGN, 2026-10-14, docs + mockup only (no code, no suites). Outputs:

- `docs/adr/0120-the-rsu-works-vfr-pattern-traffic-from-a-list-after-ap-receives-the-ifr-cancellation.md`
- `docs/mockups/rsu-panel.html` (revision 1; linked from `docs/mockups/index.html`). Headless screenshots at 1280, 640
  and 420 px wide: no horizontal page scroll, no script errors; at 420 px the TYPE column drops and remarks cut early.
- this note: the build briefing draft, the questions for the human, defaults taken, findings.

FAA text was read on faa.gov on 2026-10-14 (JO 7110.65BB with Chg 1–3 by topic; AIM): ¶4-2-10, ¶3-8-2, ¶3-10-10,
¶3-10-11, ¶3-10-12, ¶2-1-17, TBL 2-3-1 / 2-3-3, AIM 5-1-15. AETCI 11-204 was not read (not FAA; everything RSU-specific
is labelled ours).

## The model in five lines

1. The flight keeps its **ARRIVAL Strip**; ARRIVAL gains **`HANDED_TO_RSU`** (owner RSU): `INBOUND (AP) →
   HANDED_TO_RSU (RSU) → TAXI_IN (GC) → DROPPED`. The RSU stops using `PATTERN` (carrier-only from now on).
2. AP first records **`CancelIfr`** ("IFR cancellation received", ¶4-2-10 b): ends the ACTIVE ALT and HDG entries, one
   audited Mutation, nothing stored (H136). The server refuses a handoff to the RSU while ALT or HDG is active
   (`IFR_NOT_CANCELLED`).
3. Then an ordinary **ADR 0122** handoff (released by default, Accept, Checked in, control moves).
4. The RSU's only Bay **`rsu-list`** (`view: 'rsu-list'`): callsign, type, PAT/STR (Block `9J-ENTRY`), T&G/FS/LA
   (Block `9J-OPTION`), remarks (`9E`), the one action due.
5. A row leaves by **Landed** (→ GC, Taxi in) or **`LeavePattern`** (`BREAKOUT` / `DEPARTED`: the Strip retires; the
   pilot calls APP and gets a new flight-following Strip, U15).

## Questions for the human (each with the recommended answer; the ADR takes it, "pending the human")

| # | Question | Options | Recommended |
|---|---|---|---|
| **RQ1** | How is the IFR cancellation kept? | **a** no new field: `CancelIfr` ends ALT and HDG, the flight reads as VFR the H136 way, the Mutation log holds the time; **b** also store a cancellation time on the flight data and show a small grey `IFR CXL hhmm` on the Strip (FAA en route strips have a cancellation symbol, TBL 2-3-1 block 18) | **a** (H136: no flight-rules field; nothing new on the Strip). Cost: a flight with no ALT/HDG entries passes the check without a `CancelIfr` |
| **RQ2** | Which airspace is the RSU's for a **not released** handoff (H142 moves control when the aircraft is inside the receiver's airspace)? | **a** the tower area (H143's 5 nm, SFC–2,500 ft AGL); **b** none: an AP→RSU handoff is always released (no switch offered) | **a** (the pattern is inside the tower area; no special case in ADR 0122's code) |
| **RQ3** | How is "home-based training only" (H130 (5)) enforced? | **a** the server refuses a handoff to the RSU when Block `3E` (home station) names another airfield, empty passes; **b** not enforced, AP decides; **c** refuse unless `3E` is LTAG | **a** |
| **RQ4** | RSU closed (nobody signed on): who works its traffic? | **a** as any Position: its hat goes to LC (`consolidation` `"RSU": ["LC"]`, ADR 0110); while nobody holds RSU in its own right, AP hands pattern traffic to LC as ordinary arrivals; LC holding the hat sees the RSU list; **b** the RSU has no hat: a flight still on the list when the RSU signs off goes back to LC as an ordinary ARRIVAL `HANDED_TO_TOWER` | **a** (no new mechanism; H130 (7) "the tower has no pattern board" is about LC's own Bays) |
| **RQ5** | The RSU frequency (H130 (3)); real Incirlik has no RSU | a value the squadron uses on its comm card | placeholder **287.0** (invented, in the mockup) until the human names one |
| **RQ6** | The carrier's `PATTERN` / `IN_PATTERN` (PriFly, Case I and II) after the RSU leaves it | **a** leave it to the carrier batch (U19 removes PriFly's pattern section; that batch renames or drops it); **b** U-RSU renames it now (e.g. `HANDED_TO_PRIFLY`), touching carrier files and goldens | **a** (carrier fixes last, H138) |
| **RQ7** | Stop-and-go (¶3-8-2 lists it beside touch-and-go and low approach) | **a** not offered (H138 names three); **b** a fourth option `S&G` | **a** |
| **RQ8** | An aircraft leaving the pattern to depart (not a breakout) | **a** same as a breakout: the row ends, the pilot calls APP (VFR), a new Strip; **b** the RSU hands the Strip back to AP as a VFR flight | **a** (one path, U15's) |
| **RQ9** | Who may set PAT/STR and T&G/FS/LA | **a** the Position holding control (AP before the handoff, the RSU after); **b** the RSU only | **a** (the pilot often states his request to AP) |
| **RQ10** | A departure from Incirlik that wants pattern work straight after take-off (closed traffic) | **a** not now: only AP hands to the RSU (H130 (4)); the pilot calls APP after take-off like any VFR aircraft; **b** LC hands a `DEPARTED` DEPARTURE to the RSU (a second entry path, a `HANDED_TO_RSU` state on DEPARTURE too) | **a** for this build; **b** is a follow-up if the live test misses it |

## Defaults taken (P2)

- The state name is **`HANDED_TO_RSU`** (H131's working name `WITH_RSU`; this one mirrors `HANDED_TO_TOWER`, the
  glossary's FAA-based style: "handoff"). Not a question: H131 left the name to the lane.
- The two choices are **Blocks** set by `SetBlock` (no new op kind), on the ARRIVAL Block Map, not drawn on the Strip
  face. Block ids `9J-ENTRY`, `9J-OPTION` (`9J` is free: `command grep -o "'9[A-Z][A-Z-]*'" crc-sync/src/efsp/block-map.js`).
- `LeavePattern` is one op with a `reason` (`BREAKOUT` | `DEPARTED`) so the log tells a breakout from a departure.
- Not on the list: legs, time in pattern, code, approach count, ADR 0075's advisories (dark cockpit, H138).
- Row order: by check-in, then by offer; no drag re-sequencing.
- "Landed" is the NLA on a `FULL_STOP` row and in the ⋯ menu on every row (a pilot may full stop anyway).
- Runway status: the list's header shows the runway in use, amber when not open; nothing refused (as at LC).

## U-RSU build briefing (draft for the supervisor)

**Needs ADR 0122 (U-RELEASE) merged first** (the handoff, Accept, Checked in, the not-checked-in threshold), and
therefore U-JURISDICTION (ADR 0125) for RQ2 a's tower area. Build on the human's answers to RQ1–RQ10.

### Server (crc-sync)

- `src/efsp/authority/strip-types/arrival.js`: `HANDED_TO_RSU` in `ARRIVAL_STATES` (after `INBOUND`), owner
  `['RSU']` via `incirlik-military.js`'s `ownsStates` (keep the derive-from-the-table rule), `computeArrivalNla`
  `HANDED_TO_RSU` → `{ toState: 'TAXI_IN', transferTo: 'GC' }` only when Block `9J-OPTION` is `FULL_STOP` (else `null`),
  with the same GC staffing inhibit as `LANDED`; a ⋯ "Landed" on another option is the same transfer by op.
- `src/efsp/authority/positions/incirlik-military.js`: RSU `createsStripTypes: []`, `ownsStates: { ARRIVAL:
  ['HANDED_TO_RSU'] }`; header comments (advisory → controls, H130).
- `src/efsp/authority/strip-types/pattern.js`, `block-map.js` (`PATTERN_BLOCK_MAP` comment): drop "shared with RSU".
- `src/efsp/block-map.js` `ARRIVAL_BLOCK_MAP`: `9J-ENTRY`, `9J-OPTION`, target `{ kind: 'pattern', field }`; the
  setter validates the enum and refuses on any state but `INBOUND` (AP) / `HANDED_TO_RSU` (RSU) (`NOT_WITH_RSU`);
  client hand copy `strip-template.js` under `efsp-block-map-parity.test.mjs`.
- New Board ops in `src/efsp/board/ops/` (one file each, registered in `board/ops/index.js`): `cancel-ifr.js`
  (`CancelIfr`: ends ACTIVE `clearance.altitude` and `clearance.heading` entries in one Mutation, Undo scope = those
  entries; refused if none active) and `leave-pattern.js` (`LeavePattern { reason }`: the `retire()` path DropStrip
  uses, Undo via `retireScope`; only the RSU holding control on `HANDED_TO_RSU`).
- The handoff guard: wherever ADR 0122 validates an intrafacility handoff offer and the control move, a target of RSU
  checks `hasNoClearance(flightData)` (`src/efsp/vfr.js`) → `IFR_NOT_CANCELLED`, and RQ3's home-station check →
  `NOT_HOME_BASED`; both codes plus `NOT_WITH_RSU` in `src/efsp/refusal-codes.js` `REFUSAL_CODES`.
- `src/efsp/surveillance-hints.js`: `EXPECTS.ARRIVAL.HANDED_TO_RSU = AIRBORNE` (its test forces every state listed).
- `config/efsp-facility-incirlik.json`: RSU Bay `rsu-list` (`rackIds ["main"]`, `impliesState "HANDED_TO_RSU"`,
  `view "rsu-list"`, `replacesRacks true`); `positionFrequencies.RSU` (RQ5). Check `facility-schema.js` accepts the
  new view name and that `hiddenBlocks` invariants still hold.
- Runway status: `runway-status.js` `RUNWAY_GATED_STATES` and client `RUNWAY_STATUS_RUNWAY_STRIP_STATES.ARRIVAL` /
  `RUNWAY_STATUS_GEAR_CHECK_STATES`: add `HANDED_TO_RSU` (the flight still uses the runway; RWY chip and hook check).

### Client (crc-desktop)

- `app/public/js/panels/efsp/rsu-list.js` (new, a leaf: pure `rsuListModel()` + `renderRsuList()`, like
  `pattern-board.js`), mounted from `bay-views.js` `renderBayDescriptorView` for `view === 'rsu-list'`; actions go
  through the existing op dispatch (`SetBlock`, the ADR 0122 accept/check-in ops, `InvokeNla`, `LeavePattern`).
  Remarks reuse `strip-remarks.js` + `bay/popovers/remarks.js`. Module graph stays acyclic (bound 0), no `window.*`.
- `efsp-nla.js`: ARRIVAL label `HANDED_TO_RSU: 'Landed'`, owners hand copy (`client-rule-tables-parity.test.mjs`),
  `PATTERN_STATE_OWNERS` without `RSU`.
- AP's handoff UI (ADR 0122's popover/⋯ menu): RSU as a target; while ALT/HDG is active the target shows "IFR
  cancellation received" as step 1 (sends `CancelIfr`), Handoff disabled with the reason on hover (mockup "AP side").
  AP's ⋯ menu also offers PAT/STR and T&G/FS/LA (RQ9 a).
- `pattern-board.js` / `bay-views.js`: remove the RSU half (`RSU_LEGS`, defaults falling back to RSU legs); PriFly's
  stays until U19.
- `tests/fixtures/module-graph-exports.json` updates for the new module.

### Tests

- crc-sync unit: arrival NLA table rows (`efsp-nla.test.mjs`), `authority-registry.test.mjs`,
  `efsp-permission.test.mjs`, `efsp-incirlik-l18-config.test.mjs`, `efsp-scenario-incirlik-l18.test.mjs` (rewrite the
  RSU half: AP `CancelIfr` → handoff → accept → checked in → options → Landed → GC; breakout; IFR refusal; home
  station refusal; Undo of `CancelIfr` and `LeavePattern`), `efsp-block-map.test.mjs`, `refusal-codes.test.mjs`,
  `efsp-consol-hat.test.mjs` (RQ4 a: an RSU list going with the hat), `formation-split-join.test.mjs` (split on
  `HANDED_TO_RSU`), `efsp-correlation-reconciler.test.mjs` / `efsp-carrier-strip-types.test.mjs` only where they
  assume RSU on PATTERN.
- crc-desktop unit: new `efsp-rsu-list.test.mjs` (model: columns, colour rules, the one action due, empty choices),
  `efsp-bay-views.test.mjs`, `efsp-pattern-board.test.mjs` (RSU cases out), `efsp-nla-client.test.mjs`,
  `efsp-block-map-parity.test.mjs`, `client-rule-tables-parity.test.mjs`, `efsp-strip-fields.test.mjs`.
- e2e (own `E2E_LANE`): rewrite the RSU part of `e2e/l18-incirlik.spec.js`; a new `e2e/u-rsu.spec.js`: AP with an
  IFR flight sees Handoff → RSU disabled, presses "IFR cancellation received", hands off; RSU accepts, checks in, sets
  STR/FS, Landed → the Strip at GC; a second aircraft T&G → Breakout → row gone → AP Start flight following on the
  contact gives a new OVERFLIGHT Strip. Re-run `u-strip.spec.js` and `par-panel.spec.js` (they mention RSU).
- Freeze (separate commit, explained): `tables-permission-data`, `tables-permission-decisions`,
  `tables-nla-coordination-config`, `table-nla`, `scenario-incirlik-l18` (the ADR lists four; `table-nla` is the
  fifth, found after the ADR was committed).
- `npm run walk` (control release, if ADR 0122 routes the RSU handoff through it); `npm run soak:selfcheck` (Board ops
  and wire move).

### Wire

`npm run wire:record`: the op table gains `CancelIfr` and `LeavePattern`, so the tool bumps `WIRE_PROTOCOL` on both
sides if the last `crc-desktop-v*` tag shipped the current number. The state, Blocks, Bay view and refusal codes ride in
that bump (not scanned, ADR 0103). If ADR 0122 has already bumped for this release, no second bump.

### Soak driver

`tools/soak/traffic.js` does not drive the RSU today (its ARRIVAL table goes `HANDED_TO_TOWER`/`FINAL` → `LANDED`).
No change needed for the build; adding an RSU profile (CancelIfr → handoff → T&G loops → Landed / LeavePattern) is
optional and would exercise the two new ops under load.

### `state/` (the human)

- `state/efsp-board.json` with a PATTERN Strip in RSU's `rsu-pattern` Bay: drop those Strips before the upgrade, or
  delete the snapshot (start-up is strict, ADR 0095).
- A `state/efsp-facility-incirlik.json` copy naming `rsu-pattern` / `IN_PATTERN`: update it or delete it.

## For the docs pass (DOCS lane; not edited here)

- Usage guide: the RSU section (ADR 0075's pattern board) is replaced by the list; AP's handoff to the RSU with "IFR
  cancellation received"; breakout = row ends, pilot calls APP.
- Glossary: `IN_PATTERN` (RSU sense) → `HANDED_TO_RSU`; "pattern board" (RSU) → "RSU list".
- Briefing: ADR 0120 in the ADR list; the RSU's PATTERN rows gone.

## Findings for other lanes

- **U-RELEASE (ADR 0122):** the RSU handoff needs a hook at offer and at the control move for a target-specific guard
  (`IFR_NOT_CANCELLED`, `NOT_HOME_BASED`). If 0122 keeps intrafacility handoffs on `TransferStrip`, the guard goes
  there.
- **U-JURISDICTION (ADR 0125):** H143 lists the receivers' areas (LC/GC tower, AP/PAR RAPCON); the RSU is not named.
  RQ2 a gives it the tower area.
- **Carrier batch (U19/U20):** `PATTERN`, `IN_PATTERN`, `pattern-board.js` and `cv-prifly-pattern` become
  carrier-only after U-RSU; decide their fate there (RQ6).
- ADR 0120 lists four freeze goldens; `table-nla.json` also holds the ARRIVAL NLA table and will move (noted above
  rather than editing the committed ADR, P4).
