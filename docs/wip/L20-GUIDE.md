# L20-GUIDE wip

Branch `lane/L20-GUIDE`, base `4e90958`.

## Rows
| Row | Result |
|---|---|
| B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B13, B14, B15, B16, B17 | applied in the usage guide (`docs/efsp-usage-guide.md`), vocabulary LC/GC/AP, strip type, runway status, CA |
| B12 | moot: §8J already names `config/theaters.json` and Syria 10,000 ft; §8E now says "the theater's transition altitude (§8J)" |
| B18, E9 | applied: new section 8F1 "What is ours and what is sourced" (after 8F, before 8G); the three "What is ours, not doctrine" paragraphs link to it |
| F45 | applied: "guide §1 \"Rack\", Annex §9" |
| S-RENA1 | guide §4.8, §4.8.1, WP1A heading, the 4.8.7 metric row say position relief; no number changed; no anchor was linked from anywhere |
| Glossary | note on the hand-over row, "Corrections to committed ADRs: docs/adr/0077" line |
| ADR 0077 | written: house style, mirrored pairs, 5 errata rows |

## Extra
- Usage guide §2 named `_validateBayImpliedTransition`; now `board/placement.js`'s `Placement#validateBayImpliedTransition`.
- Consolidation deviations from guide §4.8.6 (from L20-CORE) are in 8F1's Consolidation row.

## Defaults taken (P2)
- New section number is 8F1 (the guide's 8C1 style), so no existing section number changed.
- ADR 0081 row says "described without a reply type of its own" (the ADR never says "bare"); 0033 row does not assert what real facilities have.
- Facility values to verify with the squadron (Incirlik headings 56/236, SFA frequencies, pad names, `LTAG`) are flagged "to verify" in 8F1.

## Findings (not fixed)
- WIRE's `efsp-nla.js` comment cites "guide line 215": a fix-up lane is replacing it with §3.4. Guide §3.4 text is unchanged by this lane.
- L20-DOMAINS: store-header ordinals "FIFTH/SIXTH/EIGHTH store" disagree; left.
- Usage guide still has old-vocabulary "strip-transfer-shaped" (§2) and "holds" prose; kept senses, not touched.
- Guide §4.8 prose still says "radar stations" (Saab's word and a design statement); untouched.
