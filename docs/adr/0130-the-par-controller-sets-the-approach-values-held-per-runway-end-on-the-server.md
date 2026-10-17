# 0130: The PAR controller sets the approach values, held per runway end on the server

**Status.** Built (lane U-PAR-VALUES, 2026-10-17). Ruling: decisions.md **H153** (the LTAG PAR plate values are the
controller's to set: *"there is not one number depending on the situation and weather the controller wants freedom here"*).
Amends ADR 0112 (the sample's `approach`, the default glideslope) and **H116**'s per-controller default glideslope, neither of
which is edited. ADR 0123 (degrees, the 0.5° lower limit), H115 (dark cockpit) and H116's tolerances stand. Lane notes:
`docs/wip/U-PAR-VALUES.md`.

## Context

A PAR approach's threshold-relative values came from the Facility file (`efsp-facility-incirlik.json` `parApproaches`, every
value `[SOURCE-DEFINED]`, TDZE left to the DCS airfield elevation) and `config/par.json` (`defaultGlideslopeDeg` 3.06), both
read once at start-up (P5). The only run-time freedom was H116's per-controller "Default glideslope" in the PAR Settings tab,
used when the approach published no angle: the client re-measured the elevation deviation against it. So two PAR scopes could
draw two different glidepaths for one approach, and neither matched what `par-monitor.js` measured. The squadron owed an LTAG
plate to fill the file; H153 removes that debt by giving the values to the controller.

## What the sources say

- **JO 7110.65 ¶5-12-6:** *"Inform the aircraft when it reaches the published decision altitude."* The final controller is the
  one who uses DA (`docs/parallel/research/release-and-par.md`).
- **Order 8200.1D ch 14 ¶17 h:** *"the ground controller verifies the glidepath and decision height cursors are properly
  aligned"*: on a real PAR the cursors are set at the PAR, by its controller's side; nothing makes them a per-scope preference.
- **8200.1D checklist legend / ¶17 k:** the "B" cursor, the lower safe limit, is normally 0.5° below the commissioned glidepath,
  and obstacle clearance is verified against it (ADR 0123). With a controller-set angle the 0.5° lower limit follows the set
  angle; the flight-inspected surface does not. That is the human's call under H153 (*"the controller wants freedom"*) and is
  stated in the guide note, not enforced.
- No order gives a range a controller may type. The ranges below are **ours**.

## Decision

1. **Where.** The values live on the server, **one set per runway end**, on the **runway-status record** (`parValues`,
   `runway-status-store.js`): a Facility's field data, one home per Facility, already synced (`efsp-runway-status-delta`),
   persisted in the Board snapshot and audited. No new store, no new wire family, no new message type.
2. **Which.** `tdzeFt`, `tchFt`, `dhFt` (DA = TDZE + DH, shown, never typed) and `gpaDeg`. Threshold position and course are not
   settable (not now; listed in the lane notes).
3. **The op.** `efsp-runway-status-mutation` `{ kind: 'SetParApproach', runwayEnd, field, value }`; `value: null` resets that
   field to the default. One value per op, so the Mutation log (at the mission clock) says exactly what changed; the record's
   `transitions` gets `{ op, runwayEnd, field, from, to, positionId, at, by }`. An equal value is an unchanged success (no rev).
   No `baseRev` from the client: values are independent, last write wins, and a rev check would refuse a value because LC
   closed a runway meanwhile.
4. **Who.** The Position the final is handed to (`incirlik-military.js`, `receivesFinal`: **PAR**), through the ordinary
   runway-status gate (Primary at that Position at that Facility). AP working the PAR does so holding PAR's hat (ADR 0110), so
   no AP column is added.
5. **Ranges (ours).** TDZE −1,500 to 15,000 ft and TCH 0 to 200 ft (as the Facility file allows them); DH 100 to 1,000 ft; GPA
   2.5° to 3.5°. Whole feet, hundredths of a degree. `surveillance/par.js` `PAR_VALUE_LIMITS`, mirrored verbatim by the client
   (`par-model.js`, a parity test).
6. **Lifetime.** Kept until changed or reset. The **mission reset (ADR 0108) keeps them**: they are field data, not traffic.
   Restore drops a value for a runway end no longer configured or now out of range (with a warning; the default applies), and
   an **unknown field stops start-up** (H88).
7. **The monitor.** `par-monitor.js` measures against the values in force (set, else the Facility default, a null TDZE being
   the DCS field elevation and a null angle `par.json`'s). The sample's `approach` carries the values in force, `defaults` (the
   four defaults) and `set` (the fields a controller set); `gpaPublished` is gone. A set TDZE also clears `NO_TDZE`.
8. **H116's per-controller default glideslope is folded in and removed.** One number per approach is what H153's "every PAR scope
   and the monitor agree" needs; a per-controller fallback would bring back two glidepaths for one approach. The Settings PAR tab
   keeps Autoscale and the three tolerances (those stay per controller: they colour the picture, they do not move it). The client
   no longer re-measures a plot (`replot`, `effectiveGpa` removed).
9. **The UI.** On the PAR panel's approach header: TDZE, TCH, DH, GPA, then DA. Grey, editable in place by the setter (click,
   type, Enter; empty or **Default** resets; Escape or leaving the field abandons). A set value has a dotted underline and a small
   grey mark, with the default in its tooltip, **never amber** (a set value is not a problem, H115). An invalid value keeps the
   field open and the message line says the range, grey. A refusal is the ordinary runway-status refusal notice.

## Consequences

- Wire: one new op kind on `efsp-runway-status-mutation`; the sample's approach keys changed. Recorded with `wire:record`
  (protocol stays 2: the last release speaks 1).
- The values can be set only while a flight is on the panel (the panel shows a sample); setting them before the first aircraft
  is not built (lane notes, open question).
- Facility-file values stay the defaults; nothing writes the Facility file (P5).

## Rejected

- **Per controller (today's H116 setting, for all four values).** Two scopes, two glidepaths, and the monitor's own deviation
  disagreeing with both; H153's recommendation.
- **A new synced store.** A store, a registry entry, a sync key, a delta type and a client cursor for four numbers per runway end
  that already have a home with every one of those.
- **Cleared by the mission reset.** The values describe the field and the weather, not the traffic; a new mission on the same
  field keeps them, as it keeps the active runway.
