# 0152: Normal landing is the manual's short-field landing

**Status.** Accepted (TOLD step 0 design review, 2026-10-28). Spec: `docs/wip/TOLD.md`, sections 1.1 and 1.4.

## Context

AFMAN 11-2F-16V3 para. 2.5.1 requires landing data on the mission data card: final approach speed, touchdown speed,
landing distance and runway used, for normal landing weight and heavyweight, dry and wet. Appendix B Part 7 gives the
speeds in Figure B7-1 (13° AOA) and the distance in Figure B7-2: sheet 1 the uncorrected short field landing distance,
sheet 2 the correction for RCR, wind and slope. Its other sheets are the SEC engine control and the drag chute.

## Decision

1. **Normal landing is the manual's short-field landing**: aerodynamic braking to 100 KIAS, then maximum braking. The
   landing distance is B7-2 sheets 1 and 2.
2. **Speeds at 13° AOA**, as the manual states (B7-1). No other AOA is computed.
3. Heavyweight landing uses the takeoff gross weight; normal landing uses the typed landing gross weight (from step 3,
   the flight plan's).

## Consequences

- One landing technique, the manual's. A pilot who lands another way (a full aerodynamic brake, a different AOA) uses
  more or less runway than perf shows. The Limitations page states the technique.
- The runway rules (AFMAN 11-2F-16V3 3.18: landing roll over 80 %, RCR below 10) are checked against this distance.
- The SEC sheet (×1.04) and the drag chute sheets (B7-2 sh. 4 to 6) are configuration options for later, each a
  separate decision.
- The golden tests: B7-1 at 20,000 lb gives touchdown 125 KIAS and final approach 136 KIAS; B7-2 sh. 1 at 2,000 ft,
  40 °C, 28,000 lb gives 3,902 ft PRI; sh. 2 from 3,902 ft with RCR 16, 10 kt headwind and 1 % uphill gives 3,375 ft
  (the sheet's "SEC" label on 3,902 ft is the first `manual-errata.yaml` entry, ADR 0148).
