# U-MOA-TRANSIT-BUILD (transit through active SUA, ADR 0128, supersedes 0127)

Lane agent, 2026-10-18. Branch `lane/U-MOA-TRANSIT-BUILD`, E2E lane 7. Built to H151/H152; ADR 0127 untouched (P4).

## What was built

**crc-sync**
- `authority/airspace.js`: `TRANSIT_TYPES` (MOA, WARNING, RESTRICTED, RANGE, DANGER), `transitDeciders` /
  `isTransitDecider` (the using Facility's class-MRU Positions with the `use` row, else the controlling Position).
- `airspace-store.js`: `record.transits[]`; ops `RequestTransit`, `ApproveTransit`, `DeclineTransit`, `CancelTransit` on the
  existing `efsp-airspace-mutation` family (audited, mission clock, no undo, no state transition); `approvedTransit`,
  `transitDecidersFor`, `sweepTransits` (last live Strip gone, decline shown 5 min), `resetForMission`; `ReleaseAirspace`
  ends every transit (`transitsEnded` on the transition). Store deps: `transitFlight` (callsign, IFR, live-Strip holders)
  and `authority.classOf`, wired in `stores.js`; persisted shape gains `transits` (old snapshots restore with `[]`).
- `airspace/route-geometry.js` (new, pure) and `containment.legCrossesPolygon`: "filed through" by geometry; `routeNames`
  removed. `airspace-entry-alert.js`: approved transit counts in `_approved`; rows gain `transit`, groups of transit types
  `transitDeciders`; a flight with a transit is listed whatever its route; `missionData` injected (`app/monitors.js`).
- `conformance.js` `altitudeToCheck`: `airspaceEntry.altitudeBlock` checked as a block when nothing is assigned
  (`entryBlocks` dep, `app/monitors.js`).
- `wire/frames.js` `airspaceDelta`; `efsp.sweepTransits` + ticker `airspace-transits` (5 s); `mission-reset.js` ends
  transits (one airspace delta per record).
- `npm run wire:record`: new op kinds recorded, protocol stays 2. Freeze goldens re-recorded in their own commit
  (`60241d57`): every airspace record gains `"transits":[]` (+14 chars), card rows gain `transit: null`, so the
  `efsp-alerts` hashes move; new golden `scenario-transit.json`. Nothing else differed.

**crc-desktop**
- `airspace-capabilities.js`: `TRANSIT_TYPES`, `MRU_POSITIONS`, `transitDeciders`, `isTransitAirspace` (parity-tested).
- `transit-rules.js` (pure: marks, Strip choices, row offers), `transit-actions.js` (sends, no baseRev),
  `bay/popovers/transit.js` ("Transit…" picker), `entry-block.js` (block field parsing).
- Strip: grey `TRANSIT <name>` / `… REQ` / `… DECLINED` marks (`strip-indicators.js`, indicator key `transit`), the
  render signature includes the transits; ⋯ menu "Request transit <name>" (or "Transit…"), "Transit <name> (approve)"
  when this controller also holds the decider, "Cancel transit request <name>", and "Entry block…".
- Airspace card rows: transit state (grey), decider's Approve transit / Decline transit (inline optional reason), holder's
  Request transit / Cancel request.
- Entry popover ("Airspace…"): optional block lower/upper fields; "Entry block…" re-issues ApproveAirspaceEntry with the
  same airspace and frequency to amend or lift the block.
- E2E: `e2e/moa-transit.spec.js` (card flow with two controllers; entry block). `e2e/u-moa.spec.js` test 1 now files its
  route by geometry (Incirlik ICAO + a ROUTE fix) instead of the airspace name, and its cleanup passes `baseDefRev`.

## Usage-guide wording (for the docs pass)

> **Transit through an active MOA, warning or restricted area.** If an IFR flight you work needs to go through an active
> MOA, warning, restricted, range or danger area, open its Strip's ⋯ menu and choose *Request transit <area>*. The
> request goes to whoever separates that airspace's users: TAC_C2 when the using agency is TACTICAL, otherwise the
> airspace's controlling Position (OPS only sees it). They answer on the airspace card with *Approve transit* or *Decline
> transit* (an optional reason). Your Strip shows a grey `TRANSIT <area> REQ`, then `TRANSIT <area>` or
> `TRANSIT <area> DECLINED`. An approved transit is an approved entry: no airspace-conflict alert. It does not move the
> flight's frequency. The restrictions are the ordinary assignments: give the transit its altitude (ALT) and the users
> theirs (ALT, or *Entry block…* for an approved entry); clear them when the transit is through. A decline is forgotten
> after 5 minutes; a transit ends when the flight's last Strip goes, when the airspace is released, or on a new mission.
> The decider may approve a listed flight without a request. If you hold both sides, the request is approved at once.

Briefing (`docs/efsp-briefing.md`) rows: ADR 0128 under airspace; "filed through" is route geometry (nav points, ICAOs,
ROUTE fixes; unresolved routes are not listed); entry blocks are conformance-checked when nothing is assigned; the
`airspace-transits` ticker; `transits` on the airspace record and in the strict persisted shape.

## Defaults taken (P2)

- RANGE and DANGER follow RESTRICTED; PROHIBITED has no transit (briefing default).
- Decider for a RANGES-used (range control Position) airspace: the controlling Position (only an MRU using agency decides).
- DeclineTransit also withdraws an APPROVED transit (ours); CancelTransit only while REQUESTED (briefing).
- Re-request after a decline is allowed (replaces the declined entry).
- Decline kept 5 min mission time (`DECLINED_TRANSIT_SHOWN_MS`).
- Self-coordination: requester = decider → approved at once; one controller holding both → client sends request then
  approval, the approval is `selfCoordinated` (same controllerId), as activation.
- Transit ops sent with no baseRev (a transit bumps `rev`; unrelated record changes must not STALE_REV it).
- Assigned altitude wins over the entry block in conformance (briefing).
- The callsign is kept on the transit entry (audit readability); an OWNED-read session therefore sees it on the airspace
  record (airspaces are not filtered, ADR 0080).
- End-of-transit sweep runs every 5 s as its own ticker; audit lines `EndTransit` with actor `system`.

## Not done / follow-ups

- No `approaching` (5-minute projection) reason and no "5 minutes prior" text (not asked for).
- Fix table for the stereo-route fixes waits for AIRAC (H152).
- Soak profile does not drive transit ops (selfcheck passes; the new ticker runs in the soak host).

## Findings for other lanes

- Clearing an assigned altitude (`setClearance(..., { value: '' })`) leaves an ACTIVE entry with an empty value; `vfr.js`
  `hasNoClearance` treats any ACTIVE entry as a clearance, so a flight whose ALT was cleared still counts as IFR (it would
  still be offered a transit, and ADR 0119 still alerts it in a MOA). Worth a look by whoever owns vfr.js.
- Existing e2e cleanups (`airspace-entry-alert.spec.js`) send DeleteAirspace without `baseDefRev`, which the server
  refuses, so their test airspaces are left on the lane's crc-sync.
