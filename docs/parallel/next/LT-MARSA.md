# Briefing: LT-MARSA — MARSA, air refueling, formation and Conflict Alert eligibility (ADR 0118)

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-LT-MARSA`, branch `lane/LT-MARSA`, `E2E_LANE=3`, commit at every green step, a `wip(…)`
checkpoint at least every ~15 min). Server and client. ADR **0118** is yours.

## Read first

- `docs/parallel/next/LIVE-TEST-FIXES.md` "### 7. LT-MARSA" and the Gates; T14–T18 in `docs/parallel/live-test-2026-10-11.md`.
- `docs/parallel/research/live-test-faa.md` **Q6** (air refueling, MARSA), **Q7** (CA inside a formation), **Q12** (CA
  eligibility); `docs/parallel/research/vfr-flight-following.md` **V4** (MCI). Quote the paragraphs in ADR 0118.
- `docs/parallel/decisions.md` (decisions win): **H134** LT-RQ10, RQ15, RQ16; **H136** VQ7, VQ8; S-ARCH-56 (tracked =
  correlated, from LT-VFR). The older ADRs: 0041 (MARSA), 0058 (conformance/STCA), 0099 (formations); `docs/glossary.md`.
- `crc-sync/src/conflict-alert.js`, `crc-sync/src/efsp/conformance.js`, the MARSA store/ops, `app/monitors.js`.

## Build

1. **Conflict Alert eligibility (H134 LT-RQ16 a, FAA model).** CA only between **two correlated tracks** (P/CG CONFLICT
   ALERT, "tracked targets"). Nothing between two uncorrelated targets. Remove the "Not suppressed: a pair with no
   Strips" rule and its header text.
2. **Mode C Intruder alert (H134 RQ16 a, H136 VQ7 a, VQ8 a).** A correlated track vs an **uncorrelated target that
   reports altitude** (no MCI for primary-only targets), only when the intruder is above the **base altitude**: a Facility
   setting, default **500 ft AGL** for a terminal Facility (JO 7210.3EE ¶12-6-12 b) and **5,000 ft MSL** for CENTER
   (¶8-2-5 b; 1,500 ft AGL where the ground is above 5,000 MSL if terrain is available, else say so), with a
   **per-Position inhibit** (¶12-6-12 d). Its own alert kind on the wire and in the client, shown like CA but named MCI.
   Delivery follows CA's (ATC Positions that see both).
3. **Formation and MARSA grouping (T16, research Q7).** The effect of a standing ERAM Group Suppression / STARS inhibit
   (JO 7110.65BB ¶5-13-1 c, ¶5-14-6 c): no CA/MCI between members of one formation, nor between MARSA participants
   while MARSA lasts. Alerts against non-participants stay, measured from each member. In DCS a wingman may still
   squawk: a formation member that is uncorrelated must not raise MCI against its own lead (say how you know it is a
   member, e.g. proximity to the lead within the formation's dimensions, and label that ours).
4. **Air refueling (T17/T18, research Q6, H134 LT-RQ10).** The tanker join is MARSA, never a formation Join: the receiver
   keeps its flight plan. Once the tanker has accepted MARSA, the receiver's ordinary LEVEL_BUST/WRONG_WAY against its
   assigned altitude stop; instead alert only when the receiver leaves the **refueling block relative to the tanker**:
   about **±1,000 ft and 3 NM** (7610.14A ¶5-5-3 c.3 "within 3 miles"; read ¶5-5-6 a and the AR block paragraphs and
   quote what the order gives for the vertical, label anything ours) with the human's rules: the **ordinary wrong-way
   logic** applies (2,000 ft below and climbing toward the block is fine; 1,350 ft below and descending away is not) and
   **our usual altitude buffer** is added. Back to normal conformance when MARSA terminates.
5. **T14 "MARSA voided" notice (H134 LT-RQ15 a):** stays until a controller holding either Strip acknowledges it.
6. **T15:** after a void, clicking a separation-responsibility field makes both Strips reorder. Reproduce, find the
   rebuild/reorder trigger (likely a press re-rendering the Strip, or two render signatures depending on each other),
   fix, spec with a real click.

Dark cockpit (H115–H119) for every alert and notice.

## Gates

Both unit suites; `npm run freeze` (goldens: `freeze:update` once, separate commit); `npm run walk`; `soak:selfcheck`;
`npm run wire:record` (a new alert kind is a wire change; protocol stays 2); module-graph fixture; specs only for what you
touch, on lane 3. Never the full Playwright suite. Never touch `crc-sync/state/`, :3000, `crc-desktop/config.json`, or
shared docs (wording in `docs/wip/LT-MARSA.md`).

## Report

lane-rules rule 8: branch and commits, test counts, ADR 0118 summary, per item, the wire change, defaults taken, specs,
findings for LT-AIRSPACE-ALERT, anything to decide.
