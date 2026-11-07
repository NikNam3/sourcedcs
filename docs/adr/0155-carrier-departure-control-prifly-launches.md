# 0155: The carrier has a departure control Position, PriFly creates the launch, and in Case III the launch goes PriFly, departure, Marshal

**Status.** Built (2026-11-07). Amends, without editing (P4): ADR 0064/0074 (four CARRIER Positions; the Marshal owned
LAUNCH), ADR 0137 (the Marshal created both carrier Strips) and ADR 0154 (PriFly's part was skipped: the Marshal's own
"Launched" put the Strip in its airborne Bay). Keeps ADR 0154's end: the Marshal holds the airborne launch until it drops
it, and nobody hands the flight off the ship. [SOURCE-DEFINED]: the human's ruling of 2026-11-07 ("PriFly hands strips to
departure who hands to marshal; keep it simple"); CV NATOPS was not re-read for this.

## Decision

1. **A fifth CARRIER Position, `CV_DEP`** (departure control), built like an approach lane: `MILITARY_ATC`, position
   letter `D`, the ship's radar (`kind: carrier`, CVN-72), no ship-level capability, no CreateStrip. One Bay,
   `cv-dep-departures`, implying `LAUNCHED`. On every carrier offer list after the lanes and before PriFly; its own list
   is Marshal, APP1, APP2, PriFly. An owner of the carrier circle (`efsp-airspaces.json`).
2. **PriFly creates the launch.** "PriFly · Launch" in a new Bay `cv-prifly-launch` (implies `LAUNCH`); the Marshal's
   `cv-marshal-departures` is gone. `LAUNCH` is PriFly's; `LAUNCHED` is departure control's and the Marshal's. A MARSHAL
   Strip may be created only by the owner of its first state (`creatorOwnsInitialState`, `board/ops/create-strip.js`):
   PriFly cannot make a recovery, the Marshal cannot make a launch.
3. **Three new carrier handoffs** (`carrier/handoffs.js`, `handoff-effects.js`), all `CONTROLLER_INITIATED`, no stack
   effect, the MARSHAL strip type unchanged:
   - `LAUNCH_TO_DEPARTURE` "Launched", PriFly → `CV_DEP`, **Case III only**;
   - `LAUNCH_TO_MARSHAL` "Launched", PriFly → `CV_MARSHAL`, Case I and II (no departure control outside Case III, as the
     human ruled);
   - `DEPARTURE_TO_MARSHAL` "To Marshal", `CV_DEP` → `CV_MARSHAL`, any Case (a flight departure control holds must
     still be handed on after PriFly changes the Case).
   PriFly's NLA at `LAUNCH` picks the row by the Case; departure control's NLA at `LAUNCHED` is To Marshal, the Marshal's
   is Drop. The two "Launched" rows share a label by design (one button, the Case decides where it goes, never both legal
   at once); the handoff test keeps every other label distinct.
4. **The approach lanes are unchanged**: APP1 and APP2 still work Case II and III.

## Consequences

- `WIRE_PROTOCOL` 2 → 3 (`wire:record`: the three handoff kinds). crc-sync and crc-desktop must ship together.
- A `state/` copy of `efsp-facility-carrier.json`, if one exists, still names `cv-marshal-departures` and no `CV_DEP`;
  it must be deleted or redone, or PriFly has no launch Bay.
- A persisted Board Strip in the removed `cv-marshal-departures` Bay is not moved; the mission reset (ADR 0108) clears it.
- Freeze goldens re-recorded (the facility config is in the snapshot, the permission tables gained `CV_DEP`).
