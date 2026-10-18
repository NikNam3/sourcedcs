# Briefing: U-MOA-TRANSIT-BUILD (server + client): transit through active SUA, ADR 0128 (supersedes 0127)

Written 2026-10-17 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-MOA-TRANSIT-BUILD`, branch `lane/U-MOA-TRANSIT-BUILD`, `E2E_LANE=7`). **Commit at
every green step, at least every ~15 minutes.** ADR number **0128** (yours). ADR 0127 stays as it is (P4); 0128 says
"Supersedes 0127" and why.

Running beside you: **U-SMALL2** (tests/soak only, `crc-desktop/tests/`, `crc-sync/tools/soak/`). U-CLOCK (ADR
0129), U-PAR-VALUES (ADR 0130) and U-FREQ-EDITOR (ADR 0131: runtime frequency table `frequency-table.js`, wire family
`efsp-frequency-*`, FREQUENCIES panel; it leaves airspace working/control frequencies to the airspace editor) are merged
into your base. If you touch `stores.js`, `app.js` or `ws-hub.js`, keep the hunk small; the supervisor merges and
re-runs `wire:record`. A sharded Playwright run (lanes 1,2,4,5) runs beside you: use only lane 7.

## Read first

- `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md` **H151** (the human's answers, read it whole; it
  overrides everything below where they differ), **H152** (no fix coordinates until AIRAC), H148, H128 (FAA model,
  always), dark cockpit H115–H119.
- ADR 0127 and `docs/wip/U-MOA-TRANSIT.md` (phase 1: design, build plan) and `docs/research/moa-transit.md` (the FAA
  quotes; reuse them, do not re-research). Most of 0127 is **void** under H151: no release record, no users' block on the
  airspace, no bust alerts on a release, no Resume ops, no pass marks, no lateral feature, no VFR advisory, no name match.
- ADR 0119 (entry alert, using agency approves), 0124 (card flight list), 0125 (jurisdiction), 0102 (MRU regime), 0091
  (assigned altitude blocks).
- Code: `crc-sync/src/efsp/airspace-entry-alert.js`, `airspace-store.js` (`_approveActivation` for the request/approve
  and self-coordination pattern), `authority/airspace.js`, `board/ops/approve-airspace-entry.js`, `conformance.js`,
  `stores.js`; client `panels/efsp/airspace-entry-list.js`, `airspace-card.js`, `bay/popovers/airspace-entry.js`.

## What to build (the H151 model)

1. **Scope:** an `ACTIVE` airspace of type **MOA, WARNING or RESTRICTED** (H151 MT-Q8). Our restricted-like RANGE and
   DANGER follow RESTRICTED (default, log it); PROHIBITED has no transit. Not ACTIVE: nothing (¶9-3-1 c). **IFR only**
   (`vfr.js` `hasNoClearance` false); VFR: nothing new (MT-Q5 b).
2. **Transit request → decision** (MT-Q1 a). A Position holding a live Strip of the flight **requests** a transit of an
   airspace (Strip ⋯ menu, and the card row for a flight listed `filed`). The **decider** is the side that separates the
   airspace's users: the using agency when it is an MRU (TACTICAL Facility; its airspace-use Position, TAC_C2), else the
   airspace's controlling Position; a scheduling using agency (Incirlik OPS) sees it read-only. The decider **approves**
   or **declines** (optional reason) on the airspace card. Requester = decider: approved at once, `selfCoordinated`. The
   decider may approve a listed flight without a request. The requester may cancel while requested.
   - **Where it lives (recommended):** a small per-airspace list on the airspace record (`transits[]`: flightDataId,
     callsign, state REQUESTED/APPROVED/DECLINED, who/when for request and decision, reason), changed by new ops on the
     airspace store's existing mutation family; audited; mission clock; no undo. This is **not** 0127's release record:
     no blocks, no restriction data. If the Board/flight data fits better, argue it in the ADR.
   - **Ends:** the airspace leaves ACTIVE, the flight's last live Strip goes, a decline is shown for a while then
     forgotten (ours), the mission reset (`efsp/mission-reset.js`, ADR 0108). Old snapshots without the key restore.
   - An APPROVED transit counts as an approved entry for ADR 0119 (`_approved`): no entry alert for it. It does **not**
     change the flight's frequency (unlike `ApproveAirspaceEntry`). A declined or requested flight that enters alerts as
     today.
3. **Restrictions are ordinary Strip assignments** (MT-Q2 b, MT-Q3 c, MT-Q4). The transit's restriction is its normal
   assigned altitude; the users' restriction is their assigned altitude/block or `airspaceEntry.altitudeBlock`. When the
   users continue, the controller clears/changes the assignment: no button, no proposal. Build the **missing UI** that
   sends `ApproveAirspaceEntry`'s `altitudeBlock` (set and amend; re-issuing amends) in the entry popover/card.
4. **Bust alert: check first** (H151 "only if conformance does not already cover it"). Conformance checks the assigned
   altitude incl. blocks (ADR 0091) but, as far as the supervisor read, not `airspaceEntry.altitudeBlock`. If so, make
   conformance check an entry's `altitudeBlock` like an assigned block when the flight has no assigned altitude (the
   assigned ALT is the clearance and wins; ours, log it). No new alert kind, no new tuning keys.
5. **Marks: grey only** (MT-Q7 b). The transit's Strip shows a grey mark for REQUESTED / APPROVED (`TRANSIT <name>`) /
   DECLINED; the card row shows the state and, for the decider, Approve / Decline. Dark cockpit: nothing amber that is
   not a problem.
6. **"Filed through" by route geometry only** (MT-Q6 c, H152). Replace `routeNames` with a pure resolver
   (`efsp/airspace/route-geometry.js`): filed route tokens (drop `DCT`, drop a `/…` suffix) resolved against the DCS
   mission's nav points (`missionData.waypoints`), airports by ICAO, and our ROUTE airspaces' named fixes, plus the
   filed departure/destination; consecutive resolved points make legs; filed through = a leg crosses the lateral shape
   and the filed (else assigned) altitude is inside the limits or unknown. Fewer than two points: not filed through (no
   fallback). The other `filed` reasons (a live Strip approved there, `comms.airspaceId`) stay. No fix table, no
   `approaching` projection (not asked for; list it as a follow-up).

## Wire, tests, gates

- New op kinds and any new row keys: `cd crc-sync && npm run wire:record` (protocol 2 is unreleased: the last release,
  `crc-desktop-v1.5.0`, speaks 1; the tool decides). New refusal codes only if unavoidable (join `REFUSAL_CODES`).
- Rights in `authority/` with the client mirror and its parity test. No `window.*`, no import cycle.
- Unit tests: request/approve/decline/cancel, self-coordination, decider per type and using agency (MRU vs OPS), rights
  refusals, ending on RELEASE/RETURN/last Strip/mission reset, old snapshot restore, `_approved` with a transit, the
  geometry resolver (nav point, ICAO, ROUTE fix, `/D1+00`, unresolved, altitude outside limits), conformance on an entry
  block, hub delivery of the card rows. Client: row builder, the altitude-block UI. Playwright: only your own specs
  (card flow), `E2E_LANE=7`.
- Before the report: both unit suites, `npm run walk`, `npm run freeze` (`freeze:update` in its own commit, explain the
  diff), `soak:selfcheck`, `wire:record`, module-graph fixture re-record if exports change.

## Output

Commits; ADR 0128 (supersedes 0127; FAA cites from the research note, ours labelled); `docs/wip/U-MOA-TRANSIT-BUILD.md`
(usage-guide and briefing wording for the docs pass, defaults taken, follow-ups); final message per lane-rules rule 8.
