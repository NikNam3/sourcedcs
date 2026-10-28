# USMTF control agency type: what real ATOs do, and how atobrief's ABM / IC / RADAR should map

Research note for Decision Desk item **L11-8** (decision H45). It complements
`docs/parallel/research/usmtf-ato.md` §CONTROLA and `docs/parallel/wave1/L11.md` §10 Q8.

## Summary for the human

- A real US ATO names each mission's controller in one line, the **`CONTROLA`** ("Control of Air
  Assets") set: `CONTROLA/<agency type>/<callsign>/PFREQ:<primary>/SFREQ:<secondary>/<report-in point>//`.
- Field 1 is the **kind of facility or platform** doing the controlling, not the person's job. The
  only codes we could confirm in public sources are **`AWAC`** (airborne warning and control, e.g. an E-3),
  **`CRC`** (Control and Reporting Center, a ground radar unit) and **`OTR`** (other). A USAF
  training ATO uses `CONTROLA/CRC/SLAPSTICK/PFREQ:122.0/SFREQ:331.0/NAME:AWACSS`.
- The official code list is in MIL-STD-6040, which is restricted (Distribution C). We could not read
  it, so we **don't know if it has more codes** (ASOC, DASC and so on are plausible, but unconfirmed).
- **ABM** (Air Battle Manager) and **IC** (Intercept Controller) are **job titles for people**, not
  agency types. ABMs are USAF officers who work aboard AWACS/E-7 aircraft or in a CRC. "Air Intercept
  Controller" is the US Navy title for the same kind of job on ships and E-2s. So a real ATO would never
  say `CONTROLA/ABM/...`. It gives the platform the ABM or IC works from.
- **"RADAR"** isn't a real category either. In ojw1v5 it is Incirlik's airfield radar (`LTAG RADAR`),
  which is air traffic control, not a combat control unit. The nearest code is `OTR`.
- The type field in atobrief is free text, and the SPINS C1 generator prints it as a heading
  (`**PRIMARY <type>**`). That is how job titles ended up in a field that USMTF uses for the platform.

## atobrief's types in use

- `AWACS` is the miztoyaml default (`tools/miztoyaml/build_doc.py:107`), and the editor's placeholder
  is "AWACS / CRC" (`atobrief/public/js/editor/editor-registry.js:80`).
- `CRC` appears in docs and placeholders.
- ojw1v5 adds `ABM`, `IC` and `RADAR` (`registry.control_agencies`, lines 1176–1188). Its
  `registry.frequencies` labels THUMPER **"Airborne Battle Manager"** and MAGIC **"IC"**.
- No other values appear in atobrief or ojw1v5. The field accepts any text.

## Proposed mapping

| atobrief `type` | What it is in real life | USMTF field 1 | Confidence | Source |
|---|---|---|---|---|
| `AWACS` | E-3 or other AEW&C aircraft controlling the mission | `AWAC` | High (the code is community-documented and consistent) | [455], [AFIT] via usmtf-ato.md |
| `CRC` | Ground Control and Reporting Center | `CRC` | High | [455], [505TRS] |
| `ABM` | **A job title**. USAF 13B officer on an E-3/E-7 or in a CRC. It says nothing about the platform | Use the platform: `AWAC` if airborne, `CRC` if ground. With no platform known, `OTR` | Role fact: high. Code: needs the platform | [WIKI-ABM], [NATO-E3A] |
| `ABM` in ojw1v5 (THUMPER, "Airborne Battle Manager") | Airborne controller | `AWAC` | Medium (inferred from the frequency label) | ojw1v5 lines 1340–1342 |
| `IC` | **A job title**. Navy AIC (ship CIC or E-2), or DCS shorthand for the tactical intercept controller | Use the platform. On a ship, `OTR`. On an E-2/E-3, `AWAC`. With no platform known, `OTR` | Role fact: high. Code: needs the platform | [USNI-AIC] |
| `IC` in ojw1v5 (MAGIC) | MAGIC is one of DCS's standard AWACS callsigns | `AWAC` probably, but only the mission designer knows | Low–medium | DCS convention (unsourced) |
| `RADAR` (ojw1v5: `LTAG RADAR`) | Airfield or approach radar (ATC), controlling the LTAG MTMA ROZ | `OTR` | Medium | [JP3-52] lists ATC separately from the CRC and airborne C2 |
| anything else | – | `OTR`, and the callsign still names the agency | High (OTR is a documented catch-all) | [455] |

**Can't be confirmed publicly:** whether MIL-STD-6040 has more codes (for example for ASOC,
DASC, TAOC, TACP/JTAC, FAC(A), E-2 or JSTARS), and their exact spelling. Don't emit such codes
until someone can check the standard. Joint doctrine does treat ASOC, DASC, TAOC, TACP, Navy TACC and
ATC as distinct control agencies [JP3-52][AFDP3-52], so a longer official list is likely.

## Pitfalls

- **Type is not the callsign or the role.** Field 1 is the platform, field 2 the callsign (free
  text, spaces allowed, e.g. `MAGIC 11`), field 3/4 `PFREQ:`/`SFREQ:` (MHz) or `PDESIG:`/`SDESIG:`
  (a comm plan designator). Field 5 is the report-in point. Don't put a role in field 1 and don't leave the
  frequency without its key word.
- **`7CONTROL` belongs to the controller's own mission** (the AWACS or CRC line lists the missions
  it controls). atobrief doesn't model AWACS as missions, so it can only export `CONTROLA`.
- **US vs NATO.** NATO ATOs use APP-11/ADatP-3 formats. The ATO sets are closely related to USMTF,
  but we found **no public NATO code list** for this field. NATO E-3A crews also use different titles:
  "Fighter Allocator" and "Weapons Controller" instead of the US "Senior Director" and "ABM/weapons
  director" [NATO-E3A]. So "ABM" is US-specific terminology.
- Community sources vary: [VRF] shows `CONTROLA/BOT/...` (unexplained code, bare frequency). Treat the
  set as open on import (L3), but emit only the codes we can confirm.

## Options for the human

1. **Keep the current default.** `AWACS`→`AWAC`, `CRC`→`CRC`, everything else→`OTR`, and the
   callsign names the agency. There's nothing to change and the output is always valid, but THUMPER
   and MAGIC export as `OTR` even though they are really airborne controllers.
2. **Split "platform" from "role" in atobrief (recommended).** Make `type` a dropdown of platforms
   (`AWACS`, `CRC`, `OTHER`, and optionally `SHIP` and `ATC`, which both export as `OTR`). Add an
   optional free-text `role` (ABM, IC, "Approach"…) that SPINS C1 prints as its heading. The export
   then maps 1:1. For ojw1v5 the author would pick AWACS/ABM for THUMPER, AWACS/IC for MAGIC and
   ATC/Radar for LTAG. Old files with `ABM`/`IC`/`RADAR` still load, export as `OTR` with the
   `AGENCY_TYPE_OTR` info, and the editor prompts the author to pick a platform.
3. **Fixed alias table.** `ABM`→`AWAC`, `IC`→`AWAC`, `RADAR`→`CRC`. This is a one-line change and
   right for ojw1v5's THUMPER and MAGIC, but wrong in general: a ground ABM is a CRC and a ship's IC is
   `OTR`. It also wrongly makes an airfield ATC radar a CRC.
4. **Emit the atobrief label as-is** (`CONTROLA/ABM/...`). This isn't a USMTF value, and L3 would
   reject it or need a special case. Not recommended.

**Recommendation:** option 1 now (it is already what L11 emits, and L3 keeps the mapping in one table,
so it's a one-line change later), then **option 2** as a small atobrief editor change. The real ATO
field describes the platform, and atobrief currently has no place to record it.

## Sources

- **[455]** 455 vAEW wiki, *ATO, ACO & SPINS Guide: ATO*, <https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato>.
  CONTROLA fields 1–5, and field 1 values "AWAC (Airborne Warning And Control)", "CRC (Control
  Reporting Center)", "OTR (Other)". Example `CONTROLA/AWAC/DARKSTAR/PDESIG:GREEN/SDESIG:WHITE/DR01/NAME:JIM//`.
  Community source (read in full).
- **[505TRS]** T. B. Williams, *Reading an Air Tasking Order (ATO) USMTF 2000: A Primer*, 505th Training Squadron
  (the AOC formal training unit), training ATO dated March 2002, <https://www.coursehero.com/file/8720202/ATO-Primer/>
  and <https://www.coursehero.com/file/p1uhom/USMTF2000-OPER505-th-TRS-TRAINING-MSGIDATOWILLIAMSATOTRGMARCHG-AKNLDGNO/>.
  **Seen only as a search excerpt** (the page returns 403). Excerpt: `CONTROLA/CRC/SLAPSTICK/PFREQ:122.0/SFREQ:331.0/NAME:AWACSS`.
- **[AFIT], [VRF], [6040]**: see `docs/parallel/research/usmtf-ato.md` §0. MIL-STD-6040 is
  Distribution C and was **not consulted**. Its official code list for this field is unknown to us.
- **[JP3-52]** Joint Publication 3-52, *Joint Airspace Control*, 20 May 2010,
  <https://www.globalsecurity.org/military/library/policy/dod/joint/jp3_52_2010.pdf>. The ATO definition
  ("call signs, targets, controlling agencies"), control agencies (CRC, AWACS, E-2C, ATC, Navy TACC)
  and the ACM request "(F) Controlling Agency" field referring to MIL-STD-6040. Read in full text.
- **[AFDP3-52]** AFDP 3-52, *Airspace Control*, <https://www.doctrine.af.mil/Portals/61/documents/AFDP_3-52/3-52-AFDP-AIRSPACE-CONTROL.pdf>.
  Seen as a search excerpt only (403). It lists "CRC, airborne C2, ASOC, JAGIC, DASC, Navy TACC, TACP, ATC"
  as tactical airspace control elements.
- **[ALSSA-ACC]** ATP 3-52.4 / MCRP 3-20F.10 / NTTP 6-02.9 / AFTTP 3-2.8, *MTTP for Air Control
  Communication*, <https://www.alssa.mil/Portals/9/Documents/mttps/acc_2024.pdf>. **Not read (403).** This is the
  best candidate for the official controller-role terms if someone can get it.
- **[WIKI-ABM]** Wikipedia, *Air battle manager*, <https://en.wikipedia.org/wiki/Air_battle_manager>.
  USAF 13B rated officer, serving on the E-3, E-8 and in CRCs and NORAD sectors.
- **[NATO-E3A]** NATO AWACS, *The Crew*, <https://awacs.nato.int/operations/mission-crew> (search excerpt).
  Titles Tactical Director, Fighter Allocator and Weapons Controllers.
- **[USNI-AIC]** USNI *Proceedings*, "Improve Lethality in Enlisted Air Intercept Controllers", March 2022,
  <https://www.usni.org/magazines/proceedings/2022/march/improve-lethality-enlisted-air-intercept-controllers>
  (search excerpt). AIC is a Navy qualification (NEC W16A) held by ship CIC operators and E-2D NFOs.
