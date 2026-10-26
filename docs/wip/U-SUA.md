# U-SUA: Transit complete, FAA area types only, prohibited always in force

Lane U-SUA, 2026-10-26. ADR **0144**. Rulings H169, H170, H171 (SUA-Q1 b, Q2 b, Q3 a, Q4 a, Q5 a, Q6 a).

## What was built

1. **Transit complete** (`EndTransit`): ends one APPROVED transit. Holder of a live Strip of the flight, or a decider.
   By a decider: the transit goes at once. By the holder: it stays `COMPLETED` until a decider acknowledges it.
   One `EndTransit` audit line, `trigger: 'COMPLETED'`. A re-entry alerts again and needs a new transit.
2. **The decider's grey line**: the card row reads `transit complete` with Acknowledge (`AcknowledgeTransit`, decider
   only on a COMPLETED transit). It lifts nothing.
3. **RANGE and DANGER removed** (server schema, entry alert, transit types, client copies, layer menu, editor hint, web
   admin). No migration: strict restore names a leftover. RANGES Facility and the range control frequency unchanged.
4. **PROHIBITED always in force**: no lifecycle (state ops refused, record stays RETURNED), `inForce()` everywhere an
   in-force question is asked, card reads `IN FORCE` with no buttons, map solid and under the ACTIVE filter.

## Text for docs/efsp-usage-guide.md (transit section and airspace section)

> **Transit complete.** When a flight with an approved transit has left the area, choose **Transit complete <name>**
> on its Strip's ⋯, or **Transit complete** on its row of the airspace card. The `TRANSIT <name>` mark leaves the
> Strip. If it comes back in, it is an unapproved entry again: it alerts and needs a new transit.
> If you are not the side that decided the transit, the decider's card row shows a grey `transit complete` until they
> press **Acknowledge**. Nothing on anyone's Strip changes: if you restricted the area's users for the transit, change
> their altitudes yourself. If you decide the transit yourself, Transit complete ends it with nothing to acknowledge.
> There is no Undo: if you ended it by mistake, request the transit again.

> **Area types.** An area is a **MOA**, **restricted**, **prohibited** or **warning** area, the FAA's special use
> airspace types. A range is not an airspace type: make the airspace over the range **restricted** (over land, hazardous
> activity), **warning** (offshore, beyond 3 NM) or a **MOA** (non-hazardous), and name the range control Position as its
> using Position. A board that still holds a `RANGE` or `DANGER` airspace will not start; crc-sync names the airspace.

> **Prohibited areas** are always in force. They have no schedule, no activation and no release; the card reads
> `IN FORCE`. Any aircraft inside one without an approved entry alerts, VFR included. Approve an entry only on the
> using agency's word (Airspace… on the Strip, or the card's Approve). A prohibited area has no transit.

## Text for docs/efsp-briefing.md

- ADR 0144 is in: a transit has four states (`REQUESTED`, `APPROVED`, `DECLINED`, `COMPLETED`); `EndTransit` is both the
  controller's op and the system's audit op for every end of a transit (triggers NO_LIVE_STRIP, MISSION_RESET, COMPLETED).
- `airspace-schema.js` `inForce(record)` is the one question "is this airspace in force"; never `state === 'ACTIVE'` alone
  for an AREA. The client copy is `airspace-validate.js` (`inForce`, `displayState`), under the parity test.
- AREA types: MOA, RESTRICTED, PROHIBITED, WARNING.

## Defaults taken (P2)

- **Op name `EndTransit`** for the controller's action (the briefing's "one EndTransit audit line"), so all ends of a
  transit share one audit op; the trigger tells them apart.
- **Ended by a decider = removed at once** (no COMPLETED, nothing to acknowledge), as a self-coordinated request is
  approved at once. A controller holding both the owner and a decider sends it as the decider.
- **The holder may not acknowledge a completion; only a decider does.**
- **No IFR gate on EndTransit** (a flight that cancelled IFR inside still completes); the ACTIVE gate is implicit (an
  APPROVED transit only exists while ACTIVE).
- **A COMPLETED transit still ends with the flight's last live Strip** (the sweep), the release and the reset: the card
  never lists a row without a live Strip, so it could not be acknowledged otherwise.
- **On a COMPLETED row the decider is not offered Approve transit** (Acknowledge first); the holder is offered Request
  transit (a re-entry), and a new request replaces the completed one (the decider then sees the request instead).
- **A COMPLETED transit still suppresses the `COORD` mark** until acknowledged (as a decline does); after the
  acknowledgement the mark comes back if the filed route still crosses the active area (see findings).
- **No Undo and no keyboard path**: the other transit ops have neither.
- **Prohibited record stays RETURNED** (no new state); the client reads `IN FORCE`. Strict restore refuses a prohibited
  record not at RETURNED, with a window or with a pending request (no live file has a prohibited area).
- **The prohibited card is drawn with the active edge colour** (`airspace-state-active`), since it is in force.
- **Test fixtures named "range" were retyped RESTRICTED** (ids such as `RANGE-SOUTH` kept); the `RANGE` helper export in
  `tests/helpers/airspace-registry.mjs` keeps its name (a restricted area with a range using agency).

## Walks not done

- No Playwright walk of the decider acknowledging on a live two-session board beyond the unit DOM tests (the lane ran
  the airspace/MOA specs only).

## Findings for other lanes

- **COORD after a completed transit**: `route-geometry.filedThrough` checks the whole filed route, so after the decider
  acknowledges a completed transit, a flight whose route crosses the area gets `COORD <name>` back even though it has
  passed. Only a remaining-route check would fix it (the FAA says nothing; ours).
- **sourcedcs-web booking** still offers a prohibited area for booking (`airspace-bookings.js` reads no type). Harmless (a
  booking never changes state), but the calendar chip on an `IN FORCE` card is noise.
- The airspace card's comment "§4.1 rule 2: the `RANGE` Position" and the `RANGE slice` comments in `airspace-panel.js`
  / `airspace-state.js` / `approve-airspace-entry.js` talk about the range-control Position, not the type: left as they
  are.
