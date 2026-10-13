# Briefing: LT-VFR — flight following on a contact with no Strip (H136)

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-LT-VFR`, branch `lane/LT-VFR`, `E2E_LANE=3`, commit at every green step, a `wip(…)`
checkpoint at least every ~15 min). Server and client. **No ADR number**: the design is the research's "Proposed model"
and H136; write the addendum in `docs/wip/LT-VFR.md` for the supervisor to record.

## Read first

- `docs/parallel/research/vfr-flight-following.md`: V1–V4 and **"Proposed model"** (a), (b), (c). The FAA paragraphs you
  cite come from there.
- `docs/parallel/decisions.md`: **H136** (the human's answers), H134 LT-Q5 and LT-RQ16, H135, S-ARCH-50. Decisions win.
- CLAUDE.md: the EFSP layout (Board ops in `board/ops/`, every frame from `wire/frames.js`, refusal codes in
  `refusal-codes.js`, mission clock) and the client-module rules (no cycle, no `window.*`, e2e through `crc.<module>`).

## Build (H136)

1. **"Start flight following"** (VQ1 a; FAA ¶5-14-4 c, ¶5-2-7 a, ¶5-3-7; the single action is ours): one action on a
   contact with no correlated Strip, from the track panel (where the tag controls are) and as a dot command if the
   panel has one for similar actions. The controller gives the callsign and the aircraft type (Block 3 rules from
   LT-STRIP-FIELDS). In one server operation, atomic and audited: create flight data, allocate a **discrete code** from
   the existing allocator, create a Strip owned by the acting Position **directly in its working state** (OVERFLIGHT
   IN_SECTOR for a transit, VQ3; DEPARTURE/ARRIVAL stay the ordinary path for a flight using our field), and bind it to
   the contact (`BindTrack`, the explicit rung). Refuse with a clear message when the contact is already correlated, the
   Position may not hold that Strip type, or no code is free. Undo must take the whole thing back.
2. **VFR is shown the FAA way** (VQ2): **no flight-rules field**. VFR = the equipment suffix (JO 7110.65BB ¶2-3-8 c:
   read it, use the VFR form it gives if our suffix handling can carry it; say what you did) and **no clearance** (no
   assigned ALT/HDG, so conformance checks nothing). Check that conformance and the conflict alert treat such a Strip
   as tracked with nothing assigned, and that nothing crashes on an empty clearance.
3. **"Radar service terminated"** (VQ6 a; ¶5-1-9 a, ¶5-2-7 b, ¶7-6-11): one action on the Strip (⋯ menu and NLA where it
   fits) = drop the Strip, which releases the code and ends the correlation, and clears any `airspaceEntry`. The contact
   is untracked again.
4. **Entry approval** (VQ5 a): the existing `ApproveAirspaceEntry` works on a flight-following Strip with today's rights.
   Only test it; the alert by airspace type (VQ4 b) is **LT-AIRSPACE-ALERT's**, not yours.
5. A tag stays a name only and untracked (H134).

Dark cockpit (H115–H119): grey controls, app-wide font, never tell the controller their job; "Start flight following"
appears only on a contact it can apply to.

## Gates

Both unit suites; `npm run freeze` (goldens: `freeze:update` once, separate commit); `npm run walk`; `soak:selfcheck`
(a new Board op); **`npm run wire:record`** (a new op is a wire change; protocol stays 2 locally); module-graph fixture if
exports change; specs only for what you touch, on lane 3: start flight following on a contact, its Strip correlated with
a discrete code, approve entry, terminate (code released, contact untracked), and Undo of the start. Never the full
Playwright suite. Never touch `crc-sync/state/`, :3000, `crc-desktop/config.json`, or shared docs (wording goes in the
wip note).

## Report

lane-rules rule 8: branch and commits, test counts before/after, what was built per item, the wire change, defaults
taken, specs, findings for LT-MARSA (CA/MCI use "tracked" = correlated) and LT-AIRSPACE-ALERT, anything to decide.
