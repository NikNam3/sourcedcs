# U-V2-FIXES (server + client): two fixes from Desk round 14

Lane note, 2026-10-22. Briefing `docs/parallel/next/U-V2-FIXES.md`; rulings H161 (V2-Q1 a, V2-Q2 a), H156 PV-Q1 a,
H155 item 4, H160 (design for N). No ADR (none needed: item 1 builds what ADR 0130 / PV-Q1 a already ruled, item 2 applies
ADR 0134's rule; 0139 left unused).

## 1. PAR approach values on an empty final (V2-Q1 a)

**Server.** ADR 0130's op already worked with nobody on the final (`SetParApproach` reads no Strip; the existing
`efsp-par-values` ws test sets a value with no aircraft). What was missing was the approach itself: the panel only knew it
from a sample, so it hid the header. Now:

- `par-monitor.js` `finalApproaches()`: per airfield final Bay (every Facility with `runwayStatus`, every `view: 'final'`
  Bay: no count, no literal id), the approach its next aircraft flies: the runway end an ARRIVAL with no runway of its own
  resolves to (`resolveRunwayForStrip`, i.e. the active runway), with the defaults and the controller-set values exactly as
  a sample's `approach` (one code path, `_approachGeometry`). No active runway: no entry.
- The `par-sample` frame gains a top-level `approaches: [{ facilityId, positionId, approach }]`
  (`par.FINAL_APPROACH_KEYS`), filtered per session like the samples (signed on to that Facility's final Position,
  including by hat). A session holding PAR now gets a frame every PAR tick even with an empty final (small); one that loses
  both samples and approaches gets one empty frame, as before.
- Wire: `wire:record` recorded the new key; `WIRE_PROTOCOL` stays 2.

**Client.** `par-samples.js` keeps the frame's approaches (`parFinalApproaches()`). `par-panel.js`: with no sample, the
"No aircraft on your final." note stays and, when the server names an approach, the header (title, TDZE, TCH, DH, GPA, DA,
FAC) is shown above it, editable by the same rule as with a flight (the acting Position among `SetParApproach`'s owners at
that Facility). Flight row, scopes, deviations and terminal buttons are hidden. Several empty finals (any number of
airfields) get the picks row, named like the header title (`RWY 05 · LTAG`). The first aircraft brings the full panel back
with the same header; an edit in progress survives (same approach id).

**Spec.** `par-panel.spec.js` test 08: empty final, header visible under/with the note, GPA set to 3.00 on the real server
with no aircraft (`parValues` `{ '05': { gpaDeg: 3 } }`), marked set; an aircraft joins and leaves, the header stays; reset
to default; no approach: the note alone. The harness has no wind (no active runway), so the spec injects the frame's
`approaches` like it injects samples.

**Guide wording (§8L PAR, for the docs pass):** "The approach values sit on the PAR panel's header whether or not an
aircraft is on your final. With an empty final the header shows the approach the next aircraft will fly (the active
runway's) under *No aircraft on your final.*; you set TDZE, TCH, DH and the angle there exactly as with a flight. With no
active runway there is no approach to show. Working more than one airfield's final, pick the approach from the row above
the header." Remove ADR 0130's "can be set only while a flight is on the panel" from wherever the guide repeats it.

## 2. `UNACTIVATED_AIRSPACE_ENTRY` follows the badge rule (V2-Q2 a)

- `forwarding-obligations.js`: raised only when `strip.airspaceEntry`, the airspace is not ACTIVE **and**
  `ctx.insideApprovedAirspace(strip)`; without that fact, never (unknown is never inside). `dueAt` is now the tick it was
  first seen inside (the monitor keeps an episode's first dueAt), not `approvedAt`.
- The fact is the airspace-entry monitor's: new `AirspaceEntryAlertMonitor#isInside(facilityId, stripId, airspaceId)`,
  a Set over the same `_inside` list `getInside()` / `airspaceInside` come from. No second containment test.
- Wiring: `app/monitors.js` passes `insideApprovedAirspace` to the obligation monitor; `app/tickers.js` re-runs the
  obligations right after the entry monitor's tick whenever it changed (otherwise only on the 15 s sweep / an EFSP change).
- Tests: `airspace-unactivated-obligation.test.mjs` (the pilot walk on the real entry monitor and obligation monitor, two
  Facilities' Strips: parked approved early none, below the block none, en route at level none, inside cold raised on both,
  activated retracted, released with the flight inside raised, leaves retracted, back in raised, approval cleared on one
  retracted there only; dueAt = entry time); a pure test in `efsp-forwarding-obligations`; the three scenario tests now say
  when the flight is inside (`obligationAlerts(..., { inside })`).
- Freeze: ApproveAirspaceEntry, ClearAirspaceEntry and random-seed1 alert frames re-recorded (nothing flies inside there).

**Guide wording (§8A airspace, obligations):** "The orange-red *entering unactivated airspace* obligation appears only
while the flight is airborne inside the airspace you approved it into and that airspace is not active, the same moment the
badge turns amber. Approving early, on the ground or en route, raises nothing; it goes when the airspace is activated, the
flight leaves, or the approval is cleared."

## Defaults taken

- Empty final shows the **active runway end's** approach (what an ARRIVAL with no runway resolves to), not every runway
  end's. Setting the other end's values needs a flight on it or a runway change. Per-end picking is easy to add later
  (`finalApproaches` would list every configured end).
- Note placed **under** the header (CSS `order`), so the header stays where it is with a flight.
- No ADR (briefing: only if item 2 needed one).

## Findings for other lanes / supervisor

- `par-panel.spec.js` 07 (carrier lane, no PAR) failed once in the first full-spec run and passed alone and in the two
  later full runs (8/8, then 11/11 with the two airspace specs): load flake, as S-ARCH-82 saw for 06. The
  failure output was not kept.
- `RUNWAY_STATUS_ACTION_OWNERS.SetParApproach` (client mirror) is a literal Position-id list, existing code (ADR 0132 /
  U-ROLE-POSITIONS territory); I reused it unchanged.
- ADR 0134's "only the holder sees amber" vs the obligation, which goes to everyone who sees the Strip's obligations (as
  every obligation): unchanged, as before this lane.

## Gates

crc-sync 2895 → 2901, crc-desktop 1424 → 1425 (the briefing tip), walk 24/24, freeze 58/58 (goldens re-recorded in their
own commit), soak:selfcheck PASS (hub changed), wire:record (one key added, protocol 2), module-graph fixture re-recorded
(`parFinalApproaches`). Specs on `E2E_LANE=7`: par-panel 8/8, airspace-badge, airspace-entry-alert: 11/11.
