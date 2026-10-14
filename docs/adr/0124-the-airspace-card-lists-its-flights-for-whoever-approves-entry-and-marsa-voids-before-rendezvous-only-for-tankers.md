# 0124: The airspace card lists the flights inside or filed through it for whoever may approve entry; MARSA voids before rendezvous only under TANKER_ACCEPTED

**Status.** Built (lane U-MOA, 2026-10-14). Rulings: decisions.md **H140** (LT-AQ1 b), **H141** (U-RQ6 a), **S-ARCH-58**
(OPS is Incirlik's using agency and approves entry). Research: `docs/parallel/research/release-and-par.md` **R7**.
**Amends** ADR 0119 §1 (how the using agency reaches a flight it holds no Strip for) and the void-before-rendezvous rule of
ADR 0051 / ADR 0118 (it applies to tanker MARSA only). Neither is edited (P4).

Editions as R7: JO 7110.65BB Basic with Chg 1 to Chg 3 (7-9-26); JO 7610.14A with Chg 1 and Chg 2 (7-9-26).

## Context

1. ADR 0119 lets the using agency (OPS at Incirlik) approve entry into an airspace (14 CFR 73.15 (c) (2), "Authorize
   transit through, or flight within"), but OPS's Bays hold only OPS's own Strips. A flight AP or CTR is working, inside or
   bound for the MOA, could only be approved by the Position holding its Strip relaying for OPS. The human ruled (H140
   LT-AQ1 b) that the airspace card lists the aircraft inside or filed through the airspace, each with Approve.
2. `marsa-store.js` `voidForAssignment` voided every ACTIVE MARSA without a rendezvous on the first heading or altitude
   assignment. That rule is the refueling one (JO 7110.65BB ¶9-2-13 d NOTE, *"Altitude or course changes issued will
   automatically void MARSA."*, before rendezvous). A MARSA declared between two flights in a MOA (JO 7610.14A ¶3-3-4 a,
   "unless MARSA is established") has no rendezvous, so the first assignment voided it unless the controller knew to press
   "Mark rendezvous" (R7 gap 1). The human ruled (H141 U-RQ6 a) that the void applies only under `TANKER_ACCEPTED`.

## Decision

### 1. The airspace card's flight list

- **Who is listed.** For every airspace whose type makes an entry approval mean something (RESTRICTED, PROHIBITED, RANGE,
  DANGER, MOA, WARNING; never a ROUTE): every **tracked** flight **inside** it (the airspace-entry monitor's own test, so
  approved, VFR or alerting alike), and every live flight **filed through** it. An untracked contact has no Strip, so it is
  not listed and cannot be approved here (ADR 0119 stands).
- **"Filed through"** (ours): a filed route is text and nothing resolves it to geometry, so it means any of: a live Strip of
  the flight already approved into the airspace; the flight data's working airspace (`comms.airspaceId`); the filed route
  naming the airspace by its id or name as a whole word, any case (`routeNames`).
- **What a row says**: callsign, why it is listed (`inside`, `filed`, `inside · filed`), and either **approved** (grey, no
  button) or **Approve**. The row is **amber only while the flight alerts** (inside, unapproved, and the ADR 0119 rule for
  the type alerts it; a VFR flight in a MOA is listed but never amber). Everything else is grey (dark cockpit).
- **Who sees it**: a session holding the airspace's **using agency** (`airspaceStore.isUsingAgency`) or its **controlling
  Position**. Any other session is sent no list and the card shows none (the card's old "flights in this block" summary
  stays for them).
- **Approve** is the ordinary `ApproveAirspaceEntry` on one of the flight's live Strips, sent as the Strip's owner when this
  controller holds it, else as the using agency: same op, same rights, same refusals (`board/ops/approve-airspace-entry.js`).
  It never moves the Strip. The alert clears on the next monitor tick, on every session that had it.
- **Wire**: the list rides the existing per-session `efsp-alerts` frame as `airspaceTraffic`
  (`[{airspaceId, flights: [{flightDataId, callsign, inside, filed, approved, alerting, strips: [{facilityId, stripId,
  positionId}]}]}]`), computed by `AirspaceEntryAlertMonitor` on the same tick and filtered per session by `trafficFor`
  (the hub asks `airspaceTrafficFor(positions)`, as it asks `airspaceEntryFor` for the alert). A change in the list alone
  counts as a change, so the hub resends. No new frame type; `wire:record` run.

### 2. MARSA voids before rendezvous only under `TANKER_ACCEPTED`

`voidForAssignment` returns no void unless the ACTIVE relation's `startEvent` is `TANKER_ACCEPTED` and no rendezvous is
marked. A `LOCAL_DECLARATION` (MARSA in a MOA) or `MTR_ENTRY` relation survives heading and altitude assignments and ends
only by End MARSA (or its end condition). The client applies the same test (`marsaInterlockArmed`): only an armed tanker
MARSA shows `MARSA ⚠`, the "assigning a heading or altitude VOIDS this" hint, the armed exchange line and "Mark rendezvous".

## Consequences

- OPS (and any using agency) approves a flight AP or CTR is working without a Strip of its own; the controlling Position
  sees the same list. Positions that may not approve see nothing new.
- Every `efsp-alerts` frame carries `airspaceTraffic` (`[]` when empty); freeze goldens re-recorded.
- "Filed through" is name-matching, not geometry: a route that crosses a MOA without naming it is not listed until the
  flight is inside or approved. Route geometry would need a route resolver nobody has yet (deferred).
- A non-tanker MARSA has no rendezvous step; the server still accepts `MarkRendezvous` on one (harmless; the client no
  longer offers it).
