# U-RESEARCH (wip)

Research-only lane: release, transfer of control and comms (U5–U9), PAR display (U11), MARSA in a MOA (U17).
Output: `docs/parallel/research/release-and-par.md` (R1–R7, corrections to `control-release.md`, U-RQ1…U-RQ6, build
sketches for U-RELEASE and U-PAR's U11). No code changed.

## Progress

- [x] FAA sources downloaded to the scratchpad (`u-research/`): JO 7110.65BB Basic w/ Chg 1–3 (7-9-26) PDF + HTML
      chapters, P/CG HTML glossary pages, JO 7210.3EE w/ Chg 3, JO 7610.14A w/ Chg 2, JO 7400.2R w/ Chg 3, Order 8200.1D
      w/ CHG 2, ICAO Doc 4444 (BAZL consolidated), EUROCONTROL guideline ed 2.0.
- [x] R1–R7 written, corrections listed, questions and build sketches written.

## Defaults taken

1. "Full release" read in the FAA sense (¶5-4-5 k "releasing control" = transfer of control); the build sketch assumes
   U-RQ1 a. If the human picks b, U8 is fixed by the client/server REQUEST checks alone.
2. The receiver's "take control" precondition uses "comms with the receiver" as the stand-in for "the aircraft is in your
   airspace" (¶2-1-17 a puts comms before the boundary). Labelled inference; U-RQ3.
3. The PAR display unit question could not be settled from primary text (the DAFMAN/NAVAIR/TM sources were unreadable);
   recommended degrees because the human asked for it and nothing read contradicts it (U-RQ4).
4. The 8200.1D "B-cursor" (lower safe limit 0.5° below the glidepath) taken as the FAA elevation lower limit; raised as a
   question (U-RQ5) rather than as a defect, since H116 set ±1° deliberately.
5. No ADR number taken (research only); the build sketch names one new ADR for U-RELEASE.

## Findings for other lanes

- **U-PAR / PAR panel (safety):** H116's −1° elevation tolerance is wider than the FAA lower safe limit (−0.5°, 8200.1D
  ¶17 k); an aircraft between −0.5° and −1° is below the obstacle-cleared surface and shows grey (U-RQ5).
- **MARSA (U17):** two Strips in one MOA can declare MARSA today ("MARSA…" → local declaration); but
  `marsa-store.js` `voidForAssignment` voids every start event before "Mark rendezvous", which a MOA declaration never has
  (U-RQ6).
- **ADR 0101** cites the LOA transfer as "2-1-15 b"; it is ¶2-1-15 a 2 (ADR not edited, P4; the next ADR should cite a 2).
- **Docs pass:** the usage guide's handoff section should name the FAA steps as in R1's table (radar ID → comms → control;
  release = coordination; full release = control) once U-RELEASE lands.

## Walks not done

- No live walk of the handoff buttons on :3000 (never touched); the U8 path is read from code, not reproduced.
