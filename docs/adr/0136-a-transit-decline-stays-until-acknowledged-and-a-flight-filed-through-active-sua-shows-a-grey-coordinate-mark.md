# 0136: A transit decline stays until the flight's holder acknowledges it, and a flight filed through active SUA with nothing coordinated shows a grey "coordinate" mark

**Status.** Built (lane U-SMALL-FIXES, 2026-10-21). Rulings: decisions.md **H156** (human, 2026-10-20, Decision Desk
round 13) **MTB-Q2 b** and **MTB-Q3**. Dark cockpit **H115–H119**. **Changes two behaviours of ADR 0128**, which is not
edited (P4): its §2 "a decline has been kept 5 minutes" end of a transit is void (§1 below), and §6 gains a mark (§2
below). The rest of ADR 0128, and ADR 0119, 0124 and 0134, stand.

## Context

ADR 0128 forgot a declined transit after 5 minutes of mission time (`DECLINED_TRANSIT_SHOWN_MS`, ours), so a requester
who was busy for those minutes never saw the answer. H156 MTB-Q2 b: *the decline stays until the requester acknowledges
it.*

ADR 0128 listed no "approaching" projection and no ¶8-1-9 b.1 "5 minutes prior" cue (JO 7610.14A ¶8-1-9 b.1: coordinate
with the MRU *"at least 5 minutes prior to the ATCAA/SUA boundary penetration"*). H156 MTB-Q3: no 5-minute feature
(*"nobody can accurately predict the 5 minutes"*); a grey mark telling the controller that a flight filed through an
active SUA still needs coordinating is enough.

## Decision

### 1. A decline stays until acknowledged (H156 MTB-Q2 b)

- New op **`AcknowledgeTransit { flightDataId }`** on the airspace mutation family (`efsp-airspace-mutation`, audited,
  mission clock, no undo, no `baseRev`, like the other transit ops). It removes a **DECLINED** transit from
  `record.transits` and bumps the record's `rev`. Refused (VALIDATION_ERROR) when the flight has no declined transit of
  that airspace: a request is cancelled (`CancelTransit`), an approval is declined by the decider.
- **Who acknowledges: whoever holds a live Strip of the flight now** (PERMISSION_DENIED otherwise), not only the Position
  that asked. Ours, the briefing's recommended default: a handoff between the request and the decline moves the flight
  to a controller who must read the answer, and the request's Position may have been left. The decider does not
  acknowledge its own decline unless it also holds a Strip of the flight.
- Not gated on ACTIVE or IFR: a decline is read whatever happened to the airspace or the clearance since (the airspace
  leaving ACTIVE ends every transit anyway, ADR 0128 §2).
- The `airspace-transits` sweep keeps only the **last live Strip gone** end (`NO_LIVE_STRIP`); the `DECLINE_SHOWN` end
  and `DECLINED_TRANSIT_SHOWN_MS` are gone. The release and the mission reset still end every transit.
- After acknowledging, the holder may request again (as after a decline, ADR 0128 §2).
- **Client.** The Strip's ⋯ menu has **Acknowledge transit decline <name>** for a holder of the Strip's owner
  (`transit-rules.js` `acknowledgeableTransits`); the airspace card's row has **Acknowledge** for a Position holding one
  of the flight's Strips (`transitRowOffer().acknowledgeAs`). The grey `TRANSIT <name> DECLINED` mark stays until then.

### 2. The grey "coordinate" mark (H156 MTB-Q3)

- **The fact, on the server.** The airspace-entry monitor (`efsp/airspace-entry-alert.js`), in the pass that already
  works out "filed through" for the card list (ADR 0124 §1, ADR 0128 §5), marks each live Strip of a flight when:
  the airspace is **ACTIVE**, an AREA of a **transit type** (`TRANSIT_TYPES`: MOA, WARNING, RESTRICTED, and RANGE and
  DANGER as restricted; PROHIBITED has no transit); the flight's **filed route crosses it by geometry**
  (`route-geometry.js` `filedThrough`; not the other "filed" reasons, which are approvals); the flight is **IFR**
  (`vfr.js`; H151 MT-Q5 b: a VFR flight gets nothing new); it has **no transit of that airspace in any state** (a request,
  an approval and a decline are each their own grey mark); and it has **no approved entry** (`_approved`: a Strip
  working the airspace, the working airspace, an APPROVED transit, an MRU's TOFI). No time or distance to the boundary.
- **Delivery.** `efsp-alerts` gains `airspaceCoordinate: [{ facilityId, stripId, airspaceId }]`, per session to the
  Strip's holder only (`coordinateFor(positions)`, Facility and owner Position both match), exactly as ADR 0134's
  `airspaceInside`; an OWNED read scope keeps only visible Strips (`read-scope.js`). A change of the fact or of the
  holder counts as a change, so the hub resends.
- **The mark.** `strip-indicators.js` draws a grey (`on`) `COORD <name>` in the transit slot, beside the transit marks,
  titled `Filed through <name> (<STATE>): no transit or entry approval`. It goes when a transit is requested (or
  approved directly), an entry is approved, the airspace leaves ACTIVE, the route is amended off it, or the flight
  becomes VFR; it comes back if the transit ends with nothing approved (a request cancelled, a decline acknowledged).
  `bay/strip-signature.js` adds the fact, so the existing `alerts` change-bus topic re-renders the Strip.
- **Why the holder only.** The mark is for the controller working the flight, who requests the transit; the decider and
  the using agency already see the flight on the airspace card as "filed".

### 3. Wire

A new op kind on the airspace family and a new top-level key of `efsp-alerts` (both scanned): `cd crc-sync && npm run
wire:record` recorded them; `WIRE_PROTOCOL` stays 2 (the last release speaks 1). Freeze goldens re-recorded: every
`efsp-alerts` frame carries `airspaceCoordinate` (`[]` there). No new refusal code, no new tuning key, no persisted
shape change (a transit's keys are unchanged).

## Consequences

- A declined transit is never lost to a busy controller; a decline nobody acknowledges stays on the record until the
  flight's last live Strip goes, the airspace is released, or the mission resets.
- A flight filed through an active MOA, warning or restricted area shows one grey mark until something is coordinated.
  It depends on the filed route resolving (ADR 0128 §5: the mission's nav points, airports or our ROUTE fixes); a route
  that does not resolve shows nothing, as it is not listed as filed either.
- A flight cleared through by phone and never recorded keeps the mark until an entry is approved or a transit recorded:
  the mark says what the board knows.
