# 0134: The Strip's airspace badge is amber only while the flight is airborne inside its approved airspace and that airspace is not ACTIVE

**Status.** Built (lane U-AIRSPACE-BADGE, 2026-10-21). Ruling: decisions.md **H155 item 4** (human, 2026-10-20). Dark
cockpit **H115–H119**. **Supersedes only the badge colour rule of ADR 0119** (whose display section left the Strip's
airspace badge amber whenever the approved airspace was not ACTIVE); the rest of ADR 0119, and ADR 0124 and 0128, stand.
ADR 0119 is not edited (P4).

Editions as ADR 0119: JO 7110.65BB Basic with Chg 1 to Chg 3 (7-9-26).

## Context

A Strip approved into an airspace (`ApproveAirspaceEntry`, `strip.airspaceEntry`) shows a badge with the airspace's name,
frequency and entry block (`strip-indicators.js`). The badge was amber whenever that airspace was not ACTIVE, so a
parked aircraft approved early, or a flight en route to its block, sat amber for the whole time before the using agency
activated the airspace: a warning with nothing for the controller to do (dark cockpit).

H155 item 4: amber **only while the flight is inside its approved airspace and that airspace is not ACTIVE**; grey
otherwise. Why: activation decides who owns the block. JO 7110.65BB ¶9-3-1 c: the SUA rules stop applying when the area
*"has been released to the controlling agency"* (not active = the controlling agency's airspace); ¶9-3-4: in an active
area the transit is by the using agency's permission. So activation must precede the activity, not the entry; the
warning matters only while the user is working an unprotected block.

The client has no airspace containment code (and must not grow a second one). The server already places every tracked
flight against every airspace each second, in `efsp/airspace-entry-alert.js` (the alert, ADR 0119 §3, and the card's
flight list, ADR 0124 §1), with the airborne, speed and track-age filters.

## Decision

### 1. The server says, per Strip, whether its flight is inside its approved airspace

`AirspaceEntryAlertMonitor#tick` also yields, for every live Strip with an `airspaceEntry`, whether its flight is
**airborne inside that airspace, whatever the airspace's state**: `airspaceStore.containing(point)` (every AREA and ROUTE
of the theater, any state), which is the same `containment.evaluate` as `activeAreasContaining` uses (lateral shape and
vertical limits) against the same point (`locate`: indicated feet, as the registry's limits, I4). No second geometry.

- **Inside means airborne inside (ours).** The track passes the alert's own `_eligible` filter (airplane or helicopter,
  at least `alerting.json` `airspaceEntry.minGroundSpeedKt`, at least `minTrackAgeSec` old) and has a finite altitude.
  A flight on the ground under the block, a hovering helicopter, a flight without a correlated (CORRELATED or
  PROVISIONAL) track, or one without an altitude is **not inside**: unknown is never inside, so never amber.
- **Any of the flight's tracks** counts: the lead's correlated track or an uncorrelated formation wingman (ADR 0118's
  members), as the card list counts it.
- The fact is per Strip **and** per that Strip's approved airspace: two Strips of one flight (a handoff across a Facility
  boundary) each get the fact for their own `airspaceEntry`; a Strip whose approval is cleared has no badge and no fact.

### 2. Delivery: a new `airspaceInside` slice of `efsp-alerts`, to the Strip's holder

`efsp-alerts` gains `airspaceInside: [{ facilityId, stripId, airspaceId }]` (only the Strips that are inside; absent
means not inside). The hub asks the monitor per session (`airspaceInsideFor(positions)` → `insideFor`), as it asks
`airspaceEntryFor` and `airspaceTrafficFor`: a session is sent the facts of the Strips **one of its signed-on Positions
holds** (Facility and owner Position both match), nobody else's; the filter is never sent. An OWNED read scope also keeps
only visible Strips (`read-scope.js` `filterAlerts`). A change of the fact, or of the Strip's holder, counts as a change,
so the hub resends.

**Why this carrier and not the surveillance hint (`surveillanceHintsForStrip`).** The hint monitor (ADR 0076) is a
different monitor with its own cadence and contact-phase logic, and knows nothing about airspaces; putting the fact
there would need the airspace geometry in a second monitor, which the briefing forbids. The airspace-entry monitor
already holds the point, the containment test, the filters and each flight's live Strips on the same tick, and already
delivers per session from that tick. The hints go to every session that can see the Strip; the badge's amber is for the
one working it (H155: "the warning matters only while the user works an unprotected block"), so a per-holder slice fits.

### 3. The badge

`strip-indicators.js` `airspaceBadgeTone(airspace, inside, name)`: **amber** (tone `attn`, class
`efsp-airspace-badge-unactivated`, title `<name> is <STATE>, not active`) when `inside && airspace.state !== 'ACTIVE'`;
**grey** otherwise (tone `on`, no title, as today's grey case): approved early, on the ground, en route, inside an ACTIVE
block, or no airspace record. `bay/strip-signature.js` adds the fact to the `asp:` part, so a change of the fact
re-renders the Strip through the existing `alerts` change-bus topic (`efsp-messages.js`), never by a renderer call from
the handler.

### 4. Wire

A new top-level key of `efsp-alerts` (scanned): `cd crc-sync && npm run wire:record` recorded it; `WIRE_PROTOCOL` stays 2
(the last release speaks 1). Freeze goldens re-recorded: every `efsp-alerts` frame carries `airspaceInside` (`[]` there).

## Consequences

- A flight approved early stays grey until it is airborne inside a block nobody activated; it turns amber then, and grey
  again when the block is activated, when it leaves, or when the approval is cleared (the badge goes).
- Only the Strip's holder sees amber. Another session looking at the same Strip (a supervisor view, the using agency on
  the card) sees the grey badge; the controlling Position learns of an unactivated block being worked only from the
  Strip's holder. Accepted: H155 aims the warning at the user working the block.
- A hovering helicopter inside a cold block is not inside (the alert's 50 kt filter): grey. Ours; a follow-up could use
  the hint monitor's AIRBORNE contact phase if the human wants helicopters covered.
- The fact is a second per-tick containment pass only for flights with a Strip approved into an airspace, against the
  theater's airspaces: small.
