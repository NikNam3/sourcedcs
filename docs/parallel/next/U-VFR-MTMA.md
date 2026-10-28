# Briefing: U-VFR-MTMA (server + client): unclassified airspace, VFR service per area, the VFR departure

Written 2026-10-25 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-VFR-MTMA`, branch `lane/U-VFR-MTMA`, `E2E_LANE=6`). **ADR 0143** (yours). Read
**H166** in `decisions.md` (and H136, H143–H145, H165); H160 binds you (design for N areas/airfields, no literal
Position ids, rule 9). FAA model always (quote the paragraph; `docs/parallel/research/vfr-flight-following.md` has the
JO 7110.65BB quotes already, cite it). Dark cockpit.

## The ruling (H166, human 2026-10-25)

- **Türkiye does not classify its airspace.** The Incirlik RAPCON is the **Adana MTMA** (military terminal control
  area), not Class C or E. Our `airspaceClass` `D` on `LTAG-CZ` and `C` on `LTAG-RAPCON` were invented.
- **VFR service in the MTMA is "option 2":** IFR is **separated from VFR**; VFR is not separated from VFR (traffic
  advisories only, workload permitting); flight following on request is advice + safety alerts + vectors on request,
  **not** separation (¶7-6-1, ¶2-1-21). A VFR aircraft flies own navigation; the controller may assign HDG/ALT/SPD
  and the pilot complies.
- **VFR flight plans are SAR records with Flight Service; the controller never gets them.**
- Consequence: a VFR departure from Incirlik gets a **squawk and a Strip before takeoff** so Approach can separate it
  from IFR (the IFR-vs-VFR rule of ¶7-8-2 a.3, applied by area setting, not by class).

## What to build

1. **Class optional.** `airspaceClass` on a JURISDICTION area becomes optional (absent = unclassified), server
   (`airspace-schema.js`, `jurisdiction.js`, `jurisdictionAt` result) and client mirror (`airspace-validate.js`,
   `jurisdiction-section.js`, map label `airspace-layer.js`: no "Class" text when absent). Remove the class from
   `LTAG-CZ` and `LTAG-RAPCON` in `config/efsp-airspaces.json` and fix their `sourceText`/`_comment`. Leave the
   carrier circle and the CENTER fallback as they are, but say in the wip note whether the fallback's `E` is
   still meaningful. Class G "nobody's" stays a class rule.
2. **VFR service per area**, a new optional JURISDICTION field (name yours, e.g. `vfrService`), values at least
   **`IFR_SEPARATED`** (H166 option 2) and **`ADVISORY`** (basic radar service only, ¶7-6-1); validated both sides,
   editable in the jurisdiction section like the other fields. `LTAG-RAPCON`: `IFR_SEPARATED`. **Default taken for
   `LTAG-CZ`:** `IFR_SEPARATED` as well (the supervisor will confirm with the human; one config line). Wherever the
   app today reads the class to decide behaviour, read this instead (there should be nothing yet: confirm).
   Do not add new separation alerting in this lane; say in the wip note what Conflict Alert does for a tracked VFR
   vs IFR pair and VFR vs VFR, and whether `IFR_SEPARATED` should change it (a question for the human, not a build).
3. **The VFR departure** (CD). Today CD's DEPARTURE Strip runs the IFR lifecycle. Add a quick **VFR departure**
   action for the Position that may create DEPARTURE Strips at the airfield (CD today, by role/permission table,
   not by id): callsign, type, **direction of flight** (eight-point compass N…NW, a structured flight-data field on
   the face for CD/GC/LC/AP; give it a Block number in the house style), runway optional (active runway default).
   One action: flight data + **discrete code** (shown to read out) + a DEPARTURE Strip. Rules:
   - **No flight-plan lookup** (no DD1801 auto-fill, no filed-plan suggestions) for it.
   - VFR = no clearance (no ALT/HDG), as H136: nothing for conformance to check.
   - It skips the IFR clearance steps: no pending-clearance review, no release/void time, requested altitude and
     destination not required. Pick the starting state/Bay so the next steps are the ordinary ones (GC pushback/taxi,
     LC runway queue, departed, Hand Off to AP); walk it and say what you chose. Phraseology note for the guide:
     "VIPER11, squawk 4321, departure frequency …, maintain VFR".
   - At AP, a VFR departure gets **Radar service terminated** (H136's action, today only on an OVERFLIGHT) for when
     it leaves the MTMA or the pilot cancels; or it keeps flight following.
   - Undo as for Start flight following. Keyboard path like `.ff` (name yours).
   - If the wire changes, `npm run wire:record` (bump as its rule says).

## Gates

Unit tests for each item (schema both sides + parity; the VFR departure op: one Mutation, all checks before the first
write, code allocated, no lookup, Undo; its lifecycle walk to AP and termination). Both unit suites once before the
report; `npm run walk`, `npm run freeze` (goldens may move: `freeze:update` in a separate commit, explain);
`npm run soak:selfcheck`. Specs for what you touched only, `E2E_LANE=6` (`jurisdiction`, the CD create spec, the boot
smoke). Every command under `nice -n 19`. Output `docs/wip/U-VFR-MTMA.md` with the usage-guide text (CD section,
§8C2, jurisdiction areas), defaults taken, questions for the human. Final message per rule 8.
