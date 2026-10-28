# 0075: Incirlik's RSU, SFA and PAR share L17's PATTERN and FINAL Roles; PAR's terminal event reuses `BALL`; SFA rotates controllers, never frequencies

**Status.** Part A (the client components) is **built** in this ADR's commits
(`crc-desktop/app/public/js/panels/efsp/final-panel.js`, `pattern-board.js`, with tests). Part B (the
Positions and SFA rotation in crc-sync) is a **proposal**, specified exactly in `docs/wip/L18.md`, to be built
after lane L17's Roles merge. Under decisions P4 this ADR is never edited; a departure in Part B is recorded in
the lane's wip notes and the briefing.

## Decisions at a glance

1. **RSU's Bay is a pattern board, not a strip rack** (guide 4.1 rule 4, 4.2). Its four legs are Racks; moving
   an aircraft between legs is the ordinary Move. The same component serves PriFly with its own leg list.
2. **The board advises and never refuses.** RSU has no separation authority. A crowded final, a long stay in the
   pattern or a non-open runway is a tag, never a blocked move.
3. **PAR and the carrier Final are one component** (guide 7.10) with no input element. Terminal event "Landing
   assured" (PAR) and "Ball" (carrier) both go to `BALL`; "Missed approach" and "Waveoff" both go to
   `BOLTER_WAVEOFF`. No new state: ADR 0064 left this to L18 and `nla.js` is L17's.
4. **The 5 s cadence is a metronome from the mission clock**, not tied to taps; required calls are prompted from
   the track's movement and clear themselves. Nothing here reads the wall clock (H11).
5. **SFA moves the controller, not the frequency** (guide 4.7, D17). The Strip's frequency never changes on a
   rotation transfer; APP holds rotation jurisdiction over a pool of at least five frequencies, three in rotation.
6. **RSU, SFA and PAR are `MILITARY_ATC`**; RSU's advisory nature is expressed in permissions, and RSU stays out of
   the covering chain so Strips never strand on it. RSU may only request runway changes (H18).

## Part A: what is built

See `docs/wip/L18.md`. Thresholds (0.3 deg, 0.1 deg, 4 s, 10 min) are `[SOURCE-DEFINED]`.

## Part B: proposal

The facility-config entries, `singleFrequencyApproach` config, the `SFA_ROTATION` transfer and its permission
rows are in `docs/wip/L18.md` under "Server half: exact spec".

## Alternatives considered

- **Tap per talk-down call to drive the cadence.** Rejected: guide 7.10 forbids data entry on FINAL.
- **A PAR-only terminal state.** Rejected: it would need `nla.js` and a role-blind `INELIGIBLE_STATES` entry (ADR 0041's trap) for a label difference.
- **A new Position class for RSU.** Rejected: STCA is gated on class; use permissions.
- **Model SFA as a frequency change.** Rejected: that is defect D17.
