# 0140: A click on the track label assigns heading, speed and altitude, for the Strip's owner

**Status.** Accepted (lane U-LABEL-MENU, 2026-10-24). Ruling: decisions.md **H164 FT-Q4 a** (v2: a track-label menu for
heading, speed and altitude, for whichever Position owns the correlated Strip). Binding: ADR 0132 (the rule names the one
acting Position), H160 (N Facilities, no literal ids), H71 default 7 (a click on the block opens the track panel), H100
DR-1/DR-10/DR-11 (attestation, release; speed is no control axis). Amends ADR 0088's "a click on the block still opens the
track panel" for the owner of the contact's Strip; everyone else keeps it.

## Context

A controller vectoring a flight reads it on the scope, but had to find its Strip to type the heading, speed or altitude
they had just given. The human asked for the assignment from the data block itself (FT-Q4 a).

## Decision

1. **Who.** A click on a contact's data block (tactical or ATC label) opens the menu when the controller acts (Primary)
   at the **owning Position of a correlated, live Strip, in that Strip's Facility**. Nothing else is asked: not "holds a
   Position with role X", not an id. With N Facilities each holding a copy of the flight, the controller who owns one of
   them gets it; owning two, the one whose Bay is open, else the first. crc-sync's owner gate (`NOT_OWNER`) stays the
   authority; the client rule only decides what is offered (`label-assign-rules.js`, `labelAssignmentFor`).
2. **What.** The Strip's own clearance cells for heading, speed and altitude, found in the strip type's Block Map
   (`target.kind === 'clearance'`, field `heading`/`speed`/`altitude`) and filtered by `isBlockEditable` for the
   Strip's Facility, listed HDG, SPEED, ALT under the Block's own label. A strip type with none (MISSION, MARSHAL,
   PATTERN, a carrier FINAL's HDG/ALT) offers none of them; with no cell at all there is no menu.
3. **How it writes.** Enter sends, for each cell whose text changed, the **same `SetBlock {blockId, value}` the Strip
   cell sends**, as the owning Position. So conformance (ADR 0058), the control-release attestation line (ADR 0101,
   H100 DR-1), release (DR-10), the Mutation log, undo, the refusal banner and the refused cell reopening on the Strip
   (F-207) behave exactly as typed on the Strip. Two changed cells go one after the other (the second needs the rev the
   first leaves); a refusal or an attestation stops the rest, and the banner says what was refused. Emptying a cell
   clears it, as on the Strip. No server change.
4. **Keyboard.** The menu opens with HDG focused and selected: type, Enter (click + value + Enter). Tab moves to SPEED and
   ALT. Esc, or a press outside, closes it and sends nothing.
5. **Today's click stays reachable** (H71 default 7): the menu's **TRACK** item, and **Shift+click** on the block, open
   the track panel. No Strip, not the owner, an Observer, or an uncorrelated contact: the click opens the track panel,
   as before. A drag still moves the block; a click on the target keeps ADR 0088's STARS gesture.
6. **Dark cockpit.** Grey on the app's panel background, no colour of its own; it shows only the three cells it can
   write.

## Consequences

- The owner no longer gets the track panel from a plain click on the block; TRACK or Shift+click gives it.
- A new strip type with clearance cells gets the menu with no edit here.
- The heading typed is the controller's magnetic value, as on the Strip (H15); nothing converts it.
