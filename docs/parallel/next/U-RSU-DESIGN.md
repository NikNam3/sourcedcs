# Briefing: U-RSU-DESIGN (docs + mockup only): the RSU as a visual VFR list (U14, U15) — ADR 0120

Written 2026-10-14 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-RSU-DESIGN`, branch `lane/U-RSU-DESIGN`; no code, no `E2E_LANE` except a headless
screenshot of your mockup). **Commit at every green step, at least every ~15 minutes.** ADR number **0120** (reserved
since the live-test batch; yours). Output is for the human's approval; the build lane **U-RSU** follows it.

## Why

The human's round-2 findings **U14, U15** (`docs/parallel/live-test-2026-10-13.md` §D) and rulings, read whole in
`decisions.md`: **H130** (the RSU stays, ours, modelled on AETCI 11-204; controls while active; own frequency; AP hands
over directly; home-based training traffic only; the tower has no pattern board), **H131** (rename `IN_PATTERN`; its
"columns keep the leg" part is **superseded by H138**), **H138** (the RSU works visually and **only VFR**; AP cancels the
IFR clearance before handing over; **the RSU's only Bay is a list** of its aircraft, each with **pattern or
straight-in** and **touch-and-go / full stop / low approach**; **no leg columns**; a **pattern breakout** calls APP as a
new VFR aircraft and gets a Strip the normal way, LT-VFR flight following), **S-ARCH-61** (the list shows remarks).
The earlier LT-RSU-DESIGN stopped before any commit and was dropped: start from these rulings, not from it.

Also in force: H128 (FAA model, always: where the FAA has a rule — IFR cancellation (AIM 5-1-15; find the JO 7110.65 paragraph),
VFR pattern entry, transfer of communications — cite the paragraph; where we invent, label it ours), dark cockpit
(H115–H119), U-RELEASE's coming handoff model (**H142**: every handoff released by default, the receiver marks "Checked
in", control never moves before check-in; ADR 0122 is being built separately — design the AP → RSU handoff on H142).

## What to produce

1. **ADR 0120** (`docs/adr/0120-…md`): the RSU model. At least:
   - who the RSU is (Position, Facility INCIRLIK, own frequency, active/inactive), what it controls (VFR pattern
     traffic only) and what stays LC's (runway status authority, unchanged);
   - the **AP → RSU** handoff: IFR cancelled first (who does it, how the Strip shows it, what the server refuses if AP
     hands over an IFR flight), then an ordinary H142 handoff to the RSU;
   - the **list** (the RSU's only Bay): one row per aircraft, columns (callsign, type, pattern/straight-in,
     touch-and-go/full stop/low approach, remarks, whatever the controller truly needs: dark cockpit), how rows are
     added (handoff accepted), changed (the RSU sets the two choices), and leave (full stop landed → to GC / LC per the
     existing ground flow; low approach/touch-and-go departing the pattern; **pattern breakout** → U15: the row ends,
     the pilot calls APP, a new VFR Strip the normal way);
   - the state rename (`IN_PATTERN` → a name in the glossary's FAA-based style, e.g. `WITH_RSU`), every place it
     reaches (server authority/strip types, surveillance hints, carrier handoff effects, client pattern board, NLA,
     carrier map model: `command grep -rn "IN_PATTERN"` in `crc-sync/src` and `crc-desktop/app/public/js`), and what
     happens to `pattern-board.js` and the PATTERN strip type (kept, reduced, or replaced by the list);
   - the wire change it implies (for U-RSU's `wire:record`) and any `state/` action for the human (old Boards).
2. **Mockup** `docs/mockups/rsu-panel.html` (self-contained, the app's dark tokens and font, see the other mockups in
   `docs/mockups/`): the RSU list with three or four aircraft in different states, the AP-side handoff with the IFR
   cancellation step, a pattern breakout. Screenshot it headless (`NODE_PATH=crc-desktop/node_modules node script.cjs`,
   script in the scratchpad) and check it reads at panel sizes.
3. **U-RSU build briefing draft** in `docs/wip/U-RSU-DESIGN.md`: files to touch, tests (unit + e2e), wire, freeze
   traces that will move, soak driver impact, and the order relative to U-RELEASE (U-RSU must build on ADR 0122).
4. **Questions for the human** in the same wip note, each with a recommended answer (the supervisor puts them on the
   Decision Desk). Take the recommended default in the ADR and mark it "pending the human".

## Gates

Docs only: no suites. Final message per lane-rules rule 8, with the mockup's path and the question list.
