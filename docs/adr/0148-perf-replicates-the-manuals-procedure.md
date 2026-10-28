# 0148: perf replicates the manual's procedure

**Status.** Accepted (TOLD step 0 design review, 2026-10-28). Spec: `docs/wip/TOLD.md`, "Goal and principles" 1,
section 5.3 and "Decisions of 28 Oct 2026".

## Context

perf, the F-16 TOLD calculator, outputs what a pilot working the charts of T.O. GR1F-16CJ-1-1 (HAF supplement, Change 8,
Appendix B, F110-GE-129) by hand would get. The values are copied by hand onto the mission data card. A calculator can
often be smarter than the manual: a better slope model, a smoother interpolation, an extrapolation past the drawn
curves, a model of the DCS altimeter. Each of those gives a number no pilot with the paper charts would get, and nobody
can check it against the book.

The clearest case is pressure altitude. A pilot works it by hand: field elevation plus the altimeter-setting correction
from the standard atmosphere. The DCS altimeter (`crc-sync/src/altimetry.js`: reference temperature 288.97 K, with a
temperature error) reads differently on a non-standard day, about 150 ft at 2,000 ft on a 40 °C day.

## Decision

1. **The manual's text is the spec.** Where the calculator could do better than the manual, it does what the manual
   says:
   - slope is the end-to-end elevation difference over the runway length, as Part 2 defines it (uphill positive);
   - RCR is interpolated as the manual writes it;
   - fixed corrections are applied as printed (CG 0.8 kt per 1 %, 8° pitch ×1.08 speed and ×1.18 distance, RCR
     decrements, roll trim 2 kt per dot);
   - nothing is extrapolated outside a chart: an input outside the drawn range is `OutOfChart`, naming the figure and
     the input;
   - the charts are chained in the order the manual's text prescribes (`src/core/told/`).
2. **The recorded example: pressure altitude is the pilot's hand calculation**, not what the DCS altimeter at 29.92
   shows:

   ```
   PA = field elevation + 145442 ft × [1 − (QNH / 29.921)^0.190263]      (QNH in inHg)
   ```

   It is not a model of the DCS altimeter. A parity test pins only the ISA constants the two share with
   `crc-sync/src/altimetry.js`: P0 (`ISA_P0`, 101,325 Pa = 29.921 inHg) and the exponent (`ISA_INV`, 0.190263). The two
   compute different things otherwise. The hot-day difference is stated on the Limitations page.
3. **A misprint is not patched silently.** A known error in the manual goes into `perf/extraction/manual-errata.yaml`
   (figure, where, printed value, correct value, reason); the sample-problem tests read it. The first entry: B7-2 sh. 2
   labels its 3,902 ft entry "SEC", although 3,902 ft is the PRI value.

## Consequences

- Every TOLD value can be checked against the paper charts by a pilot, and the manual's sample problems are the golden
  tests (2 % tolerance, errata applied).
- perf can differ from what the aircraft does in DCS. That difference is documented, never corrected (a DCS comparison
  is a later validation layer, TOLD.md "Validation and testing").
- A value the manual does not cover gives no number. The cell shows "—" with the figure and input named.
- The parity test lives in perf and only reads `crc-sync/src/altimetry.js`. It arrives in step 1 with `src/core/inputs/`;
  the CI workflow's path filter already names that file.
