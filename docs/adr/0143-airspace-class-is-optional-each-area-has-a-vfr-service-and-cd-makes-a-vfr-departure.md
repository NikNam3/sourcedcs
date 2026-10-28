# 0143: The airspace class is optional, each area has a VFR service, and CD makes a VFR departure in one action

**Status.** Accepted (lane U-VFR-MTMA, 2026-10-25). Ruling: decisions.md **H166** and its addendum ("the control zone
is classic airspace D"). **Amends** ADR 0125 (a JURISDICTION area's `airspaceClass` was required; `LTAG-RAPCON`'s `C`
and its "ours" note go). Builds on H136 / LT-VFR (flight following, "Radar service terminated", VFR = no clearance).
FAA paragraphs from JO 7110.65BB as quoted in `docs/parallel/research/vfr-flight-following.md`.

## Context

Türkiye does not classify its airspace. The Incirlik RAPCON is the **Adana MTMA** (military terminal control area), and
the `C` on `LTAG-RAPCON` was invented. The control zone (`LTAG-CZ`) *is* classic Class D (human, H166 addendum).
Inside the MTMA the human chose "option 2": **IFR is separated from VFR; VFR is not separated from VFR** (traffic
advisories, workload permitting); flight following is advice, safety alerts and vectors on request, not separation
(¶7-6-1 a, ¶2-1-21). A VFR aircraft navigates itself but complies with an assigned heading, altitude or speed. A VFR
flight plan is a search-and-rescue record with Flight Service; the controller never gets it.

So a VFR departure from Incirlik needs a squawk and a Strip **before takeoff**: two minutes after it leaves the Class D
control zone it is in the MTMA, where Approach separates IFR from it. Today CD's DEPARTURE runs only the IFR lifecycle
(PENDING_CLEARANCE review, flight-plan check, release and void times).

## Decision

1. **`airspaceClass` is optional** on a JURISDICTION area (absent or null = unclassified), server
   (`airspace-schema.js`) and client mirror (`airspace-validate.js`) under the parity test. Class G stays "nobody's".
   The map label and the jurisdiction card say no class when there is none. Clearing the class is a panel edit
   (`airspaceClass` and `vfrService` are clearable fields).
2. **`vfrService`**, a new optional JURISDICTION field: `ALL_SEPARATED` (VFR separated from IFR and from VFR, Class B
   ¶7-9-4), `IFR_SEPARATED` (IFR separated from VFR, VFR to VFR traffic advisories, Class C ¶7-8-2 a.3-4 and H166's
   MTMA), `ADVISORY` (no separation of VFR: traffic advisories, safety alerts, vectors on request, basic radar service
   ¶7-6-1 a). **A class implies its service** (`CLASS_VFR_SERVICE`: B all separated, C IFR separated, D/E/F advisory;
   A has no VFR, 14 CFR 91.135, and G is nobody's, so neither may name one). The field is **required only on an
   unclassified area** and is otherwise an override (for a local procedure such as a TRSA-like overlay). The effective
   service is `vfrServiceOf(def)`; `jurisdictionAt` returns it beside the class (null when unclassified). The supervisor
   asked whether a class should imply its service: it does, so the shipped Class D control zone carries no field.
3. **Shipped:** `LTAG-CZ` keeps Class D, no `vfrService` (ADVISORY by class), source text "Class D per the human
   (H166)". `LTAG-RAPCON`: no class, `vfrService: IFR_SEPARATED`. `CVN-72-CCA` and the CENTER fallback keep Class E.
4. **Nothing reads the service for behaviour yet.** The only behaviour that read the class was "Class G is nobody's"
   (`jurisdictionAt`), which stays. Conflict Alert alerts every tracked pair, IFR or VFR, in every area (ADR 0118, the
   P/CG CONFLICT ALERT definition); whether `IFR_SEPARATED`/`ADVISORY` should change that is asked, not built.
5. **Block 9K, the direction of flight** (`filed.directionOfFlight`, N NE E SE S SW W NW, magnetic like every
   direction here): what a VFR pilot gives ground or clearance delivery (AIM ¶4-1-18 a.5(b)). Sub-lettered onto Block 9
   (the route family; for a VFR departure it is all the route there is), DEPARTURE only, last in the map. On CD's,
   GC's, LC's and AP's departure face only once set.
6. **`CreateVfrDeparture`**, one stripless Board Mutation (`board/ops/create-vfr-departure.js`): callsign, Block 3
   aircraft data, direction (required), runway (optional: a typed end of this airfield, else the active one) → flight
   data (with the Facility's airfield as departure airport), a discrete code from the allocator and a DEPARTURE Strip in
   the acting Position's Bay that implies **CLEARED**. Who: a Position with the grant (`VFR_DEPARTURE_OP_KINDS`, CD's
   row), the right to create a DEPARTURE and to own its CLEARED state; the rule names no Position id (ADR 0132). Every
   check before the first write; "no code free" is the allocator's own refusal. No flight-plan lookup (the client sends
   nothing a lookup would fill and calls none). Undo removes the Strip and archives the flight data (code released).
   **Why CLEARED:** VFR has no clearance (no assigned ALT/HDG, nothing for conformance, H136 VQ2), so PENDING_CLEARANCE,
   the flight-plan check and release/void times do not apply; the release stays RELEASED. From CLEARED every next step
   is the ordinary one: CD's NLA to GC (pushback, taxi), LC (runway queue, line up, departed, takeoff stamped), Hand
   Off to AP. At AP "Radar service terminated" (`TerminateRadarService`, H136) ends it when it leaves the MTMA or the
   pilot cancels; otherwise it keeps flight following.
7. **Client:** a `VFR…` toolbar toggle (only where a VFR departure can be made) opens a form (callsign, type, DIR,
   RWY) and shows the read-out after the ack: "VIPER11, squawk 4321, maintain VFR". Keyboard: `.vfr <CALLSIGN> <TYPE>
   <DIR> [RWY]`. "Radar service terminated" is offered on a DEPARTURE with no clearance that AP holds.

## Consequences

- The wire gains a Board op kind; the surface is recorded and the protocol stays 2 (already ahead of the last released
  client). The new flight-data key is record content, not scanned.
- A Board snapshot from before this ADR restores unchanged: its `LTAG-RAPCON` keeps Class C (registry entries are
  imported once and then live in the Board), which by the class gives `IFR_SEPARATED`, the same service. Taking the
  class off is one panel edit by AP (class "none", VFR service IFR separated) or a Board reset.
- The client offers the action through an id mirror (`VFR_DEPARTURE_POSITIONS`) held to the server's tables by a test,
  like flight following's; it becomes a role when the server sends roles (U-ROLE-POSITIONS).
- The freeze corpus that walks every Block gains one step (scenario-ato renumbers after it).
