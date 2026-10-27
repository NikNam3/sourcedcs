# U-VFR-REDO (ADR 0146): VFR as a minimal VFR strip on a tagged track

Lane note. Shared docs (guide, briefing, CLAUDE.md) are not this lane's; what they should say is below.

## Step 0: code as found (base 44cfb209)

- Suites at base: crc-sync 2973/2973, crc-desktop 1518/1518, freeze 58/58.
- `crc-sync/src/efsp/board/ops/start-flight-following.js` `StartFlightFollowing`: AP/CTR only (`AP_CTR_ONLY_OP_KINDS`), an
  OVERFLIGHT Strip IN_SECTOR in the strip-type Bay, always a discrete code, binds the track (`bindTrackOnStart`).
- `board/ops/create-vfr-departure.js` `CreateVfrDeparture`: CD (`VFR_DEPARTURE_OP_KINDS`), DEPARTURE at CLEARED, needs
  Block 9K `filed.directionOfFlight` (`flight-data-store.js` `normalizeDirectionOfFlight`, `DIRECTIONS_OF_FLIGHT`).
- `board/ops/terminate-radar-service.js` `TerminateRadarService`: DropStrip + airspace entry cleared + binding ended.
- `src/efsp/vfr.js` `hasNoClearance` (VFR = no ACTIVE assigned ALT/HDG), read by `airspace-entry-alert.js` (joint-use
  rule, filed-through coordination) and `stores.js` (`transitFlight().ifr`). Client copy `panels/efsp/vfr.js`.
- Client: `panels/efsp/flight-following.js` (track panel "Start flight following", `FLIGHT_FOLLOWING_POSITIONS`),
  `panels/efsp/vfr-departure.js` (CD toolbar `VFR…` form, `.vfr`), `strip-fields.js` 9K `DIR_WHEN_SET`,
  `keepIfrHidden`; `label-menu.js` (ADR 0140 HDG/SPD/ALT for the owner, ADR 0145 SUPPRESS).

## What was built (ADR 0146)

- crc-sync: strip type `VFR` (TRACKED/DROPPED, holder works it, any Bay of the holder, minimal Block Map); Bay flag `vfr`
  (facility schema) on CD `cd-cleared`, GC `gc-taxi-out`, LC `lc-runway-queue`, AP `ap-overflight`, CTR `ctr-overflight`;
  `StartFlightFollowing` reworked into the tag (any Position with a VFR Bay, type optional, no code unless `code: true`);
  new `VfrHandoff` (INITIATE/ACCEPT/RECALL), `AssignCode`, `ChangeFlightRules` (to IFR / to VFR in place);
  `VFR_OP_KINDS` replaces `VFR_DEPARTURE_OP_KINDS` and the AP/CTR-only flight-following grant; pattern ops move a VFR
  strip; TransferStrip and CreateStrip refuse a VFR strip; `vfr.js` is `isVfrStrip`/`isVfrFlight` (strip type), read by
  the airspace-entry alert and transits. Removed `CreateVfrDeparture`, Block 9K, `filed.directionOfFlight`.
- crc-desktop: label menu TAG / ACCEPT / HO / RECALL / CODE / RADAR SVC TERM; target click accepts a VFR handoff
  (`atc-scope.js`); strip menu handoff, recall, code, `IFR → <type>`, `IFR cancelled → VFR`; altitude cell `VFR` /
  `VFR/045`, tab `VFR · TRACKED`, grey `HO LC` mark; track panel "Tag VFR"; `.ff` type optional; CD toolbar VFR form and
  `.vfr` removed.

## Defaults taken (P2)

- VR-Q3: recommendation taken (CD form and the Start-flight-following OVERFLIGHT Strip removed, replaced by the tag).
- VR-Q4: recommendation taken (no code by default; CODE from the label menu or the strip menu).
- Strip type rather than a flight-rules field (briefing default was a field): the case is in ADR 0146 §2; the supervisor
  accepted it conditionally (tower, conversions, holder) and the ADR answers each.
- Op name `StartFlightFollowing` kept (wire churn); the client calls it "Tag VFR" / TAG.
- LC's VFR Bay is the runway queue (a GC hand-off is the common case at the tower); an inbound from AP lands there too and
  LC drags it or uses Closed traffic. A per-Position choice is a facility-file edit.
- IFR cancelled ends the IFR altitude/heading/speed assignments (an IFR clearance no longer binds a VFR aircraft).
- A VFR handoff is inside one Facility only (see "for the supervisor").

## What the usage guide / briefing should say

- Guide: replace the VFR departure (CD form, `.vfr`, DIR) and "Start flight following" sections with: tag a track (data
  block menu or track panel, callsign, type optional), the VFR strip (`VFR · TRACKED`, ALT reads VFR/045), HDG/SPEED/ALT
  from the data block, HO <Position> and the receiver's ACCEPT (data block menu or a click on the blinking target),
  RECALL, CODE, IFR → <type>, IFR cancelled → VFR, Radar service terminated, `.ff <track> <CALLSIGN> [TYPE]`, `.term`.
- Briefing: VFR is a strip type; `vfr: true` Bays decide who works VFR strips.

## Deploy note

- Production: nothing beyond the v2 step that already deletes `efsp-board.json` (production never ran ADR 0143).
- **Local/dev state only** (the human's :3000 Board, made after ADR 0143): strip the removed key before starting, or the
  strict snapshot check stops start-up on `filed.directionOfFlight`:
  `jq 'walk(if type == "object" then del(.directionOfFlight) else . end)' state/efsp-board.json > /tmp/b.json && mv /tmp/b.json state/efsp-board.json`
- A state/ copy of a facility file keeps working but has no `vfr` Bay, so nobody there can tag a VFR until the flag is
  added (or the state/ copy deleted).

## Walks (pilot requests, memory rule)

Walked in `crc-sync/tests/efsp-vfr-strip.test.mjs` unless noted:
- VFR pops up IFR: `ChangeFlightRules to IFR` at AP → OVERFLIGHT IN_SECTOR in ap-overflight, same strip/binding, code given.
- IFR cancels IFR in the air: airborne DEPARTURE at AP → VFR strip in place, binding and code kept, assignments ended; Undo.
- Track lost and back: binding kept while unseen (second tag refused), correlates again when seen (code or none).
- Two controllers tag the same track: second refused, "already tagged as <callsign>".
- Handoff not accepted: the holder keeps it; RECALL; a second INITIATE refused until recalled; only the named Position
  accepts.
- VFR into active SUA: restricted area entry approved then terminated (cleared); MOA never alerts a VFR strip
  (`airspace-entry-alert.test.mjs`); a VFR strip asks no transit (`efsp-scenario-transit.test.mjs`).
- LTAG departure/arrival: GC tag → LC (runway queue rack by Block 8A) → Leave pattern → Closed traffic → landed Bay → GC →
  terminated.
- Not walked: a VFR crossing to CENTER (not built), a VFR at PAR (no VFR Bay, by design).

## Findings for other lanes / the supervisor

- **Cross-Facility VFR handoff is not built.** VfrHandoff is intra-Facility; the cross-Facility HANDOFF brings replicas
  and control release, which H175 rejects for VFR. AP → CTR for a VFR is today "Radar service terminated" at AP and a new
  tag at CTR. Needs a decision: a cross-Facility VfrHandoff (a peer-Board accept), or HANDOFF with release forced off.
- FAA ch. 2 sec. 3 has no "VFR" altitude-block marking (the briefing's citation); the strip copies the ERAM data block
  (`VFR/055`) and STARS's `V`. Quoted in ADR 0146.
- U-CA-OWNER (H176): the holder of a VFR strip is `strip.ownerPositionId` at all times; `vfrHandoff` is only the ask.
- The client still mirrors strip origins by Position id (`panel/create-strip.js` `CREATE_STRIP_ORIGINS`), which
  `ifrStripTypesAt` reads for the IFR conversion items: existing rule-9 debt, to go with U-ROLE-POSITIONS.
