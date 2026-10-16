# U-MOA-TRANSIT (phase 1: research, design, mockup)

Lane agent, 2026-10-16. Branch `lane/U-MOA-TRANSIT`. Docs only, no code.

- Research: `docs/research/moa-transit.md` (JO 7110.65BB Chg 3 ¶9-3-1 to ¶9-3-4, ¶4-5-1, ¶4-5-7 g; JO 7610.14A Chg 2 ¶3-3-2,
  ¶3-3-4, ¶7-2-5, ¶8-1-1, ¶8-1-9 to ¶8-1-11, App. 2; JO 7400.2R ¶21-1-10/11, ¶25-1-1/3/6; JO 7210.3EE ¶2-1-19; AIM 3-4-5;
  three public FAA/FR airspace documents on LOA recall/floor adjustment). All read from faa.gov / govinfo.gov on 2026-10-16.
- Design: `docs/adr/0127-a-transit-through-an-active-moa-is-an-altitude-release-held-on-the-airspace-until-resume-ops.md`
  (**Proposed**).
- Mockup: `docs/mockups/moa-transit.html` (seven situations; checked headless at 1200 and 390 px, no console errors, no
  horizontal overflow), card in `docs/mockups/index.html`.

## Design in one screen

- **Not ACTIVE** (RETURNED, SCHEDULED, RELEASED): nothing (¶9-3-1 c, FAA).
- **IFR, ACTIVE MOA**: the transit's Strip holder **requests** (Strip ⋯ menu or the card row); the **side that separates the
  MOA's users decides**: an MRU using agency (TAC_C2) under ¶8-1-9 b.1, otherwise the controlling Position (ATC works the MOA,
  ¶3-3-4 a); Incirlik OPS sees it. Self-coordination collapses request and accept.
- **Decline**: the flight stays a nonparticipant, 500 ft / 3 NM (¶9-3-2); ADR 0119's SAA if it enters.
- **Accept**: one **altitude release on the airspace record**: users' block (or "release the whole area") + transit band, at
  least 1,000 ft apart (2,000 above FL410, ¶4-5-1). The transit counts as approved for ADR 0119.
- **Strips**: users get `BLK 200–240 · BLADE31`, amber until a holder marks it passed; the transit gets `TRANSIT <MOA> ≤FL190 ·
  users told n/m`.
- **Alerts** (ours, amber, `BLK` on the data block): a user outside its block, or the transit outside its band inside the MOA;
  conformance thresholds; CA stays the red net.
- **Resume ops**: the decider, manual; the row reads `clear of <MOA>` once the transit is 3 NM out (ours). Users' marks turn
  `RESUME <MOA>`, amber until passed.
- **VFR**: "Advise <MOA>" records a ¶8-1-9 a advisory; never amber.
- **"Filed through"**: filed route tokens → DCS mission nav points, airport ICAO, ROUTE fixes; polyline crossing + altitude;
  name match as a labelled fallback; new `approaching` reason (5-minute projection, ¶8-1-9 b.1).

## Where the FAA is silent (ours)

The automated bust alerts; the name and timing of "Resume ops" (H148); the "passed" marks; the 3 NM "clear" figure (borrowed
from ¶9-3-2 b); who decides for an ATC-worked MOA (inferred from ¶3-3-4 a and ¶25-1-6); the route resolver. Also our reading
that ¶8-1-9 b.1 covers a MOA (its lead-in names restricted areas, ATCAAs and warning areas; b.1 says "ATCAA/SUA").

## Questions for the human (Decision Desk)

**MT-Q1 Who accepts or declines a transit?**
- a. The side that separates the MOA's users: the MRU using agency (TAC_C2) when the MOA's using Facility is TACTICAL; otherwise
  the controlling Position (CTR/AP), with OPS seeing it read-only. **Recommended** (¶8-1-9 b.1, ¶3-3-4 a).
- b. Always the using agency (OPS for an Incirlik MOA, TAC_C2 for a TACTICAL one); the controlling Position only when there is
  none (¶9-3-4 "permission [...] granted" read strictly).
- c. Either the using agency or the controlling Position, first answer wins.

**MT-Q2 Where does the users' block restriction live?**
- a. On the airspace record (one release per transit, binds every participant including late arrivals and MRU-worked flights;
  Strips show a derived mark). **Recommended.**
- b. On each MOA flight's Strip (`airspaceEntry.altitudeBlock`, which exists): N edits, and MRU flights without an entry are
  missed.
- c. Both: the record, copied onto each Strip at accept.

**MT-Q3 Is "Resume ops" proposed or automatic?**
- a. Manual; the row reads "clear of <MOA>" once the transit is 3 NM out (no colour). **Recommended.**
- b. Automatic when the transit is clear.
- c. Manual, with no "clear" proposal.

**MT-Q4 Lateral deconfliction?**
- a. Altitude only, plus "release the whole area" so a MOA split into separately defined sub-areas (¶25-1-3; ¶8-1-9 b.1
  "sub-areas may be used") can be deconflicted laterally. **Recommended.**
- b. Altitude only.
- c. Also a drawn corridor through a MOA (new geometry, larger build).

**MT-Q5 VFR transit?**
- a. "Advise <MOA>" on a VFR (flight-following) Strip records the advisory; the users' holders see "VFR · advised" and pass it
  (¶8-1-9 a); never amber. **Recommended.**
- b. Nothing new (VFR is already listed, never amber, ADR 0124).
- c. Same request/accept as IFR.

**MT-Q6 Route geometry for "filed through"?**
- a. Filed route tokens resolved against DCS nav points, airport ICAOs and our ROUTE fixes; the name match stays as a labelled
  fallback (`filed (name)`); plus `approaching` from a 5-minute projection. **Recommended.**
- b. a, plus each correlated unit's DCS mission-editor route (new gRPC Eval per group).
- c. Geometry only; drop the name match.

**MT-Q7 "Passed" marks on the users' Strips?**
- a. Yes: amber until a holder marks the block (and later the resume) passed; the transit row counts "users told n/m".
  **Recommended** (H116's unpassed-clearance pattern).
- b. No pass step; grey marks only.
- c. Only for the block, not for the resume.

**MT-Q8 Which airspace types?**
- a. MOA only now (H148). **Recommended.**
- b. MOA and WARNING.

## Defaults taken (P2)

- JO 7610.4 (briefing) is the sensitive order; the public text is JO 7610.14A, cited throughout.
- ¶8-1-9 b.1 read as covering MOAs (see above).
- Gap check: ¶4-5-1 a/c only; the non-RVSM ¶4-5-1 b is not checked (no equipment data).
- Bust thresholds: conformance's `levelBustFt` / `levelBustPersistSec`, no new tuning keys.
- "Clear of the MOA" = 3 NM laterally outside after having been inside, or no live Strip left.
- The MOA leaving ACTIVE, and the mission reset, end open transits (system, audited).
- No new refusal code.

## Build plan (phase 2, after the answers)

Two lanes or one long one; server first.

**Server (crc-sync)**
- `src/efsp/airspace-store.js`: `record.transits[]`, `record.vfrAdvisories[]`; ops `RequestTransit`, `AcceptTransit`,
  `DeclineTransit`, `CancelTransit`, `ResumeOperations`, `PassTransitChange`, `AdviseVfrPenetration`; gap and limits checks;
  close on leaving ACTIVE; injected `liveStripHoldersOf(flightDataId)`, `isVfr(flightDataId)`; audit; mission clock.
- `src/efsp/authority/airspace.js`: the decider rule (MT-Q1).
- `src/efsp/stores.js`: `airspaces` shape gains `transits`, `vfrAdvisories`.
- `src/efsp/mission-reset.js`: end open transits.
- `src/efsp/airspace/route-geometry.js` (new, pure): token resolver and crossing test.
- `src/efsp/airspace-entry-alert.js`: transit approval in `_approved`; route geometry replaces `routeNames` (fallback);
  `approaching`; rows gain `transit`, `vfrAdvised`; the two transit alerts (or a sibling `transit-monitor.js`), `airspaceTransit`
  slice with `deliverableTo`.
- `src/ws-hub.js` / `src/app/monitors.js`: inject `missionData`, deliver `airspaceTransit` per session.
- `npm run wire:record` (new op kinds, new `efsp-alerts` key); bump only if the last `crc-desktop-v*` tag shipped protocol 2.
- Tests (`tests/*.test.mjs`): store ops and rights (request/accept/decline/cancel/resume/pass, self-coordination, gap 1,000 /
  2,000, whole-area release, refusals, closing on RELEASE/RETURN, restore of an old snapshot); route geometry (nav point,
  ICAO, ROUTE fix, `/D1+00` suffix, fewer than two points → name fallback, altitude outside limits); monitor (transit approved,
  user bust armed/not armed, band bust inside/outside lateral, delivery sets, `clear`); hub delivery per session; freeze goldens
  re-recorded where `efsp-alerts` gains the key; `soak:selfcheck` (touches `efsp-ws.js`/`wire/**` indirectly).

**Client (crc-desktop)**
- `panels/efsp/airspace-entry-list.js`: rows with Request / Accept… / Decline / Resume ops / Advise, `filed (name)`,
  `approaching`, `users told n/m`, `clear`.
- `panels/efsp/transit-dialog.js` (new): the accept dialog (proposal, gap check, users list).
- Strip marks and chips: `strip-indicators.js`, `strip-alerts.js`; Strip ⋯ menu entries ("Request transit…", "Advise…").
- `atc-scope.js`, `geojson.js`: `BLK` tag; `track-panel.js` line; `alerts-state.js` slice.
- `bay/authority-mirror.js` + parity test for the decider rule; refusal wording unchanged.
- Tests: unit tests for the row builder, dialog proposal and gap check; Playwright specs for the card flow and a bust (lane's
  own specs only).

## Findings for other lanes

- `ApproveAirspaceEntry`'s per-Strip `altitudeBlock` is shown by the client (`airspace-card.js`, `strip-indicators.js`) but no
  client UI sends it: the server path is unreachable from the panel today.
- The shipped stereo routes name KEMER, ERGEP, MANAZ, MUT, TARSU and DAN; nothing in crc-sync holds their coordinates, so route
  geometry finds them only if the DCS mission has nav points of those names. A small fix table in config would close that
  (the human's call: those coordinates are published data, not ours to invent).
- `docs/research/` did not exist; this lane created it per the briefing (other research lives in `docs/parallel/research/`).
