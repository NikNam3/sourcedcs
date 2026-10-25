# Research: what happens when a transit ends, and our special use airspace types against the FAA (lane R-SUA)

Written 2026-10-25 for the human's two questions in `docs/parallel/next/R-SUA.md`, under **H128** ("FAA model, always":
where an order covers it, build what it says; label anything of ours as ours; where the orders are silent, **silent:
the human decides**). Builds on `docs/research/moa-transit.md` (U-MOA-TRANSIT, same editions) and ADR 0119, 0124, 0128,
0136, which it cites rather than redoes.

**Rulings that came in while this lane ran (supervisor relay, 2026-10-25), applied throughout:**

- "ranges arent airspace anyway": our `RANGE` area type is wrong as an airspace type. Q2 says what the FAA uses instead
  and how to remove it.
- "it doesnt matter how turkey does it, we follow the FAA rulings and Americanisms when setting up our training areas
  (MOAs). ignore Turkish rulings.": **no Türkiye AIP work here.** No ENR 5.1/5.2 page was fetched or read. Our special use
  airspace follows 14 CFR 73, JO 7400.2R, the AIM, the P/CG and JO 7110.65 only.
- "everything training airspace type wise needs to follow FAA regulations, so if I'm confusing something just use the
  correct FAA ruling.": the human's remarks "all MOAs are danger areas" and "moas are nearly always warning areas" are
  **not requirements**. Where they disagree with the FAA, the FAA wins. Each gets one line below, with the quote that settles it.

Every quotation below was read in the copy named in "Sources and editions" on 2026-10-25. Where a paragraph is not quoted,
it was not read, and nothing here paraphrases it. Paragraph letters are as printed. The faa.gov HTML of JO 7110.65BB
§9-3 drops the a./b. list letters. The letters used here are the ones `docs/research/moa-transit.md` gives (it read the
same Change 3). The wording was checked against the HTML.

## Sources and editions

| Short name | Edition read | Copy read (all fetched 2026-10-25, `curl` with a browser User-Agent) |
|---|---|---|
| 14 CFR | Part 73 (whole), §91.133, §1.1 (SUA definitions), eCFR point-in-time **2026-10-20** | `ecfr.gov/api/versioner/v1/full/2026-10-20/title-14.xml?part=73` / `?section=91.133` / `?section=1.1` |
| JO 7110.65BB | Air Traffic Control, **Change 3, effective 7/9/2026** (the index page says "Effective: 7/9/2026 Change: Change 3") | faa.gov HTML `atc_html/chap9_section_3.html`; chapter 8 sections 1–10 searched for "warning area" / "special use" (nothing beyond the section title) |
| JO 7400.2R | Procedures for Handling Airspace Matters, Basic 2/20/25 with Chg 1–3 (7/9/26) | `faa.gov/documentLibrary/media/Order/7400.2R_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` (pdftotext): ch. 21–28 |
| JO 7610.14A | Non-Sensitive Procedures and Requirements for Special Operations, Basic 8/7/25 with Chg 1 and **Chg 2 (7/9/26)** | `…/Order/7610.14_Basic_w_Chg1_and_Chg_2_dtd_7-9-26.pdf`: §3-3, §4-5-4, §8-1 |
| JO 7210.3EE | Facility Operation and Administration, Basic with Chg 1–3 (7/9/26) | `…/Order/7210.3EE_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf`: ¶2-1-18, ¶2-1-19, ¶4-5-1 |
| AIM | Aeronautical Information Manual, **Change 3, effective 7/9/2026** | faa.gov HTML `aim_html/chap3_section_4.html` (3-4-1 … 3-4-9) |
| P/CG | Pilot/Controller Glossary, faa.gov HTML, effective 7/9/26, Change 3 (the index page) | `pcg_html/glossary-{a,c,d,m,n,p,r,s,w}.html` |

**Not read:** ICAO Annex 11 and Doc 8126 (not public). The only ICAO text quoted here is the ICAO definitions that the
P/CG reprints. JO 7610.4 (sensitive, not public). No joint-use LOA of a real MOA, restricted area or warning area was read.
The orders leave the transit detail to those letters, so where a point depends on an LOA it says so.

---

## Q1. "Once a transit through an airspace is complete, what then?"

### What the orders say

**Permission is to transit, and it is the using agency's.** JO 7110.65BB ¶9-3-1: the SUA rules stop applying when
*"a. The pilot informs you that permission has been obtained from the using agency to operate in the airspace. b. The
using agency informs you they have given permission for the aircraft to operate in the airspace. NOTE- Using agency
permission may be relayed to the pilot. c. The restricted/warning area, MOA, ATCAA, or stationary ALTRV has been released
to the controlling agency."* ¶9-3-4 TRANSITING ACTIVE SUA/ATCAA: *"If a LOA/LOP has been coordinated with the Using Agency
and permission has been granted to transit the area: a. Comply with the instruction/clearances issued by the Using Agency
and provide the applicable separation minima between aircraft when two or more aircraft are transiting the area; or [...]
b. If unable to comply with instructions/clearances, clear the aircraft in accordance with paragraph 9-3-2, Separation
Minima."* ¶9-3-2 NOTE: *"Nonparticipating aircraft refers to those aircraft for which you have separation responsibility
and which have not been authorized by the using agency to operate in/through the special use airspace, ATCAA, or
stationary ALTRV."*

**14 CFR 73.15 (b), (c)(2)** (restricted areas): *"Upon the request of the FAA, the using agency shall execute a letter
establishing procedures for joint use of a restricted area by the using agency and the controlling agency, under which the
using agency would notify the controlling agency whenever the controlling agency may grant permission for transit through
the restricted area in accordance with the terms of the letter."* *"(c) The using agency shall— [...] (2) Authorize transit
through, or flight within, the restricted area as feasible"*. §73.17: *"the controlling agency is the FAA facility that may
authorize transit through or flight within a restricted area in accordance with a joint-use letter issued under § 73.15."*

**The MRU's altitude release for a transit** (JO 7610.14A ¶8-1-9 b.1): *"Provide separation between participating and
non−participating IFR aircraft cleared to transit an ATCAA/SUA. Such separation must be accomplished by coordination with
the MRU at least 5 minutes prior to the ATCAA/SUA boundary penetration to obtain from the MRU a release to ATC of
altitude(s) and/or flight level(s) throughout the entire ATCAA/SUA. [...] ATC will transfer flight information of
non−participating aircraft to the MRU. NOTE− ATC retains the authority to recall delegated airspace as specified in a
LOA."* b.2: *"Coordinate, track/log spill−in/out aircraft as required."*

**What the military side gives back, and when** (JO 7610.14A ¶8-1-11, the MRU must): *"g. Advise the associated ATC
facility whenever the activities within the delegated airspace are terminated. [...] k. Return to ATC facility any portion
of ATCAA/SUA airspace not required to complete missions. l. Return airspace to ATC facility as directed."* ¶8-1-11 a.2
(participants): *"When communications cannot be established, instruct aircraft to contact the ATC facility prior to
exiting ATCAA/SUA."*

**The letters** (JO 7400.2R ¶21-1-8 d): *"Joint−use procedures must be specified in a joint-use Letter of Agreement (LOA)
or Letter of Procedure (LOP) between the using agency and the controlling agency. These letters should include provisions
for the real-time activation/deactivation of the airspace and timely notification to the controlling agency when the
scheduled activity has changed, been canceled, or was completed for the day."* ¶23-1-5 b (restricted): *"The joint−use
letter must include procedures for the timely activation, return, or recall of the airspace. The letter may also specify
conditions and procedures whereby the controlling agency may route traffic through the area while in use provided approved
separation can be maintained between nonparticipating aircraft and the using agencies' activities."* ¶24-1-5 (warning
areas) applies ¶23-1-5 *"as appropriate"*. ¶25-1-6 b (MOA): *"Procedures for access to the airspace by nonparticipating IFR
traffic must be specified in a letter of agreement between the controlling and using agencies."* JO 7210.3EE ¶4-5-1 a:
*"Facility air traffic managers must prepare letters of procedures for stating specific terms regarding the release by the
using agency of restricted areas as defined in 14 CFR part 73."*

**Restricted areas, pilot side** (AIM 3-4-3): *"If the restricted area is active and has not been released to the
controlling agency (FAA), the ATC facility will issue a clearance which will ensure the aircraft avoids the restricted
airspace unless it is on an approved altitude reservation mission or has obtained its own permission to operate in the
airspace and so informs the controlling facility."*

**What the orders do *not* say** (searched in every copy above: "transit", "exit", "spill", "complete", "terminat"):

- No paragraph read tells ATC to **notify the using agency when a transiting aircraft has left** the area. **Silent.**
- No paragraph read says when a transit **permission lapses**, or whether a **second entry** needs a new one. The words
  are "permission [...] to **transit** the area" (¶9-3-4), "authorize **transit through**" (73.15 (c)(2)), and the release
  is "throughout the entire ATCAA/SUA" for the aircraft "cleared to transit" (¶8-1-9 b.1). **Inference:** a transit is one
  passage through the area. Once the aircraft is out, it is a nonparticipant again (¶9-3-2 NOTE), and coming back in
  needs new permission. The orders do not say this in so many words: the human decides.
- No paragraph read covers **handing the released altitudes back** to the MOA users after the transit. The orders have
  only the reverse direction: the MRU returns airspace to ATC (¶8-1-11 k, l), and ATC recalls delegated airspace
  (¶8-1-9 b.1 NOTE). The rest is in the LOA (¶21-1-8 d, ¶23-1-5 b). This was already found in `docs/research/moa-transit.md`
  R2 and ruled on by H151 MT-Q3 c (*"there is no such button"*).
- The one end the orders do state is the **release**: once the area is released to the controlling agency, ¶9-3-1 c takes
  it out of the section, so no transit is left to hold.

### What our app does today

A transit is one entry in `record.transits[]` on the airspace record (ADR 0128 §2), in state `REQUESTED`, `APPROVED` or
`DECLINED` (`crc-sync/src/efsp/airspace-store.js:53`). An approved transit ends **only** in these cases:

| End | Where | FAA |
|---|---|---|
| The airspace is released (`ReleaseAirspace`): every transit goes, `transitsEnded` is counted on the RELEASED transition | `airspace-store.js:776-787` (`_signOff`) | **matches** ¶9-3-1 c |
| The flight's last live Strip goes: system sweep every 5 s, one `EndTransit` audit line, trigger `NO_LIVE_STRIP` | `airspace-store.js:963-976`, `_endTransits` `:992`; ticker `crc-sync/src/app/tickers.js:81` | **ours** (silent) |
| The mission reset (ADR 0108), trigger `MISSION_RESET` | `airspace-store.js:979-990` | **ours** |
| The decider withdraws the approval (`DeclineTransit` on an APPROVED transit: "the users need the airspace back") | `airspace-store.js:893-906` | **matches in spirit** ¶8-1-9 b.1 NOTE (recall), the reverse direction; ours as an op |
| (`CancelTransit` ends only a REQUESTED one; `AcknowledgeTransit` only a DECLINED one) | `:908`, `:927` | ours |

**Nothing ends a transit when the aircraft leaves the airspace,** and no controller action says "transit complete". So:

- **The aircraft leaves the volume:** the transit stays `APPROVED`. On the airspace card, the flight's row stays listed
  (a flight with a transit is listed "whatever its route says", `crc-sync/src/efsp/airspace-entry-alert.js:301-308`), with
  `inside` now false (`:250`) and the grey text `transit approved` (`crc-desktop/app/public/js/panels/efsp/transit-rules.js:108`).
  The row stays until the Strip goes or the airspace is released.
- **What the controlling/using agency sees:** that same row. Nothing tells the decider that the aircraft has passed, so
  nothing prompts it to lift the users' restriction. The restriction is the users' ordinary assigned altitude or
  `airspaceEntry.altitudeBlock` on their own Strips (ADR 0128 §3), and it stays until a controller changes it.
- **Re-entry:** while the transit is `APPROVED` and the airspace `ACTIVE`, `approvedTransit()` (`airspace-store.js:950-954`)
  makes `_approved()` true (`airspace-entry-alert.js:177-186`). A second entry, minutes or hours later, raises **no**
  airspace-entry alert and needs no new approval.
- **On the Strip:** the grey `TRANSIT <name>` mark (`transit-rules.js:33-40`) stays on every live Strip of the flight
  until the transit ends as above. It moves with the flight across handoffs, because the transit belongs to the flight
  and not to a Position. Because the flight has a transit, the grey `COORD <name>` mark (ADR 0136 §2) is suppressed.
  Nothing else on the Strip changes: a transit never touches the frequency or the assigned altitude (ADR 0128 §3).
- **The entry route instead of the transit route** (`ApproveAirspaceEntry`): `strip.airspaceEntry` stays until
  `ClearAirspaceEntry` ("Leave airspace", `crc-sync/src/efsp/board/ops/clear-airspace-entry.js:8-23`) or
  `TerminateRadarService`. Leaving the volume does not clear it either (ADR 0134 only colours the badge).

### Answer in plain words

Today a transit has no end of its own. Once approved, it lasts as long as the flight has a Strip, the airspace stays
active, and nobody withdraws it. The aircraft flying out changes nothing on the board except the `inside` flag on the
card row. The aircraft can fly back in without an alert. Nobody, controlling or using side, is shown that the transit is
over.

The FAA orders don't fill that gap. They grant permission "to transit the area" and leave the rest to the joint-use
letter. They have no "transit complete" call and no notice to the using agency on exit. The one end they do give is the
area being released. Our reading (inference) is that a transit is one passage: once out, the aircraft is a nonparticipant
again, and a second entry needs a new permission. If that reading is right, our open-ended approval is too generous.

### Gaps

| # | Gap | FAA | Status |
|---|---|---|---|
| G1 | An APPROVED transit outlives the passage: a later re-entry is silently approved | silent (inference: permission is for one passage, ¶9-3-4, 73.15 (c)(2), ¶8-1-9 b.1) | **differs** from the inference: the human decides (Desk SUA-Q1) |
| G2 | The decider is not shown that the transit is done, so the users' restriction is never prompted off | silent; H151 MT-Q3 c ruled out a "Resume ops" button | **silent**: the human decides (Desk SUA-Q2) |
| G3 | The card row of a transit that has passed stays until the Strip goes | follows from G1 | goes away with SUA-Q1 a |
| G4 | ¶8-1-9 b.2 "track/log spill−in/out" and ¶8-1-11 d Whiskey Alert: nothing records a participant leaving its block | FAA (voice) | known (ADR 0128 §4 hands a bust to conformance); not a transit-end question, no Desk item |

---

## Q2. "Are we modelling danger, warning, restricted and prohibited areas correctly by FAA rules?"

### What the orders say

**The FAA's types, and only these** (JO 7400.2R ¶21-1-3 b): *"The types of SUA areas are Prohibited Area, Restricted
Area, Military Operations Area (MOA), Warning Area, Alert Area, Controlled Firing Area (CFA), and National Security Area
(NSA)."* ¶21-1-4: *"There are two categories of SUA: regulatory (rulemaking) and other than regulatory (nonrulemaking).
Prohibited Areas and Restricted Areas are rulemaking actions that are designated by amendment to part 73. MOAs, Warning
Areas, Alert Areas, and NSAs are implemented by nonrulemaking action [...]"* AIM 3-4-1: *"Prohibited and restricted
areas are regulatory special use airspace and are established in 14 CFR part 73 through the rulemaking process. Warning
areas, MOAs, alert areas, CFAs, and national security areas (NSA) are nonregulatory special use airspace."* Neither list
has a "danger area" or a "range".

**Joint use** (JO 7400.2R ¶21-1-8): *"a. SUA must be returned to the controlling agency and become available for access by
nonparticipating aircraft during periods when the airspace is not needed by the using agency for its designated purpose.
b. Restricted areas, warning areas, and MOAs must be designated as joint-use unless it is demonstrated that this would
result in negative impacts to the using agency's mission. [...] c. Joint−use does not apply to prohibited areas. Alert
areas and CFAs are joint−use by design because nonparticipating aircraft may transit these areas without limitation."*
¶21-2-5 NOTE: *"A controlling agency is not designated for prohibited areas, alert areas, controlled firing areas, or
national security areas."* ¶21-7-4 b: *"Activated. The time−period during which the controlling agency has released the
restricted area or MOA airspace to the using agency; regardless of whether any activity is actually occurring."*

**ATC's rules apply to four of them** (JO 7110.65BB ¶9-3-1, NOTE): *"These procedures are not applicable to Alert Areas or
Controlled Firing Areas."* ¶9-3-2 separates nonparticipants from an active *"prohibited/restricted/warning
area/MOA/ATCAA/stationary ALTRV"* (500 ft / 1,000 ft above FL290 vertically, 3 NM laterally; quoted in full in
`docs/research/moa-transit.md` R1). ¶9-3-1 e: *"Operations in special use airspace and stationary ALTRVs located in
offshore/oceanic airspace will be conducted in accordance with the procedures in Chapter 8, Offshore/Oceanic Procedures."*
¶9-3-4 NOTE: *"The FAA has no jurisdictional authority over the use of nonjoint use prohibited/restricted/warning area
airspace; therefore, clearance cannot be issued for flight therein without the appropriate approval."*

#### Prohibited area

- 14 CFR 1.1: *"A prohibited area is airspace designated under part 73 within which no person may operate an aircraft
  without the permission of the using agency."* §73.83: *"No person may operate an aircraft within a prohibited area unless
  authorization has been granted by the using agency."* §91.133 (a): *"No person may operate an aircraft within a
  restricted area (designated in part 73) contrary to the restrictions imposed, or within a prohibited area, unless that
  person has the permission of the using or controlling agency, as appropriate."*
- JO 7400.2R ¶22-1-2: *"Prohibited areas are designated when necessary to prohibit flight over an area on the surface in
  the interest of national security."* ¶22-1-4: *"Prohibited areas normally extend from the surface upward to a specified
  altitude, with a "continuous" time of designation"*. ¶22-1-5: *"No person may conduct operations within a prohibited
  area without permission of the using agency and a certificate of waiver/authorization issued by the FAA Administrator."*
- AIM 3-4-2: *"Prohibited areas contain airspace of defined dimensions identified by an area on the surface of the earth
  within which the flight of aircraft is prohibited. Such areas are established for security or other reasons associated
  with the national welfare."*

#### Restricted area

- 14 CFR 1.1: *"A restricted area is airspace designated under Part 73 within which the flight of aircraft, while not wholly
  prohibited, is subject to restriction."* §73.13: *"No person may operate an aircraft within a restricted area between the
  designated altitudes and during the time of designation, unless he has the advance permission of (a) The using agency
  described in § 73.15; or (b) The controlling agency described in § 73.17."* §73.15 (c): *"The using agency shall— (1)
  Schedule activities within the restricted area; (2) Authorize transit through, or flight within, the restricted area as
  feasible; and (3) Contain within the restricted area all activities conducted therein in accordance with the purpose for
  which it was designated."*
- JO 7400.2R ¶23-1-2: *"Restricted areas are designated when determined necessary to confine or segregate activities
  considered hazardous to nonparticipating aircraft."* ¶23-1-5 a: *"[...] Flight within an active restricted area is
  controlled by the using agency except when the area has been returned to the controlling agency. During such periods, the
  controlling agency may permit nonparticipating aircraft operations in the restricted area."*
- AIM 3-4-3: *"Restricted areas denote the existence of unusual, often invisible, hazards to aircraft such as artillery
  firing, aerial gunnery, or guided missiles. Penetration of restricted areas without authorization from the using or
  controlling agency may be extremely hazardous to the aircraft and its occupants."*
- P/CG, SPECIAL USE AIRSPACE, Restricted Area: *"Most restricted areas are designated joint use and IFR/VFR operations in
  the area may be authorized by the controlling ATC facility when it is not being utilized by the using agency."*
- JO 7210.3EE ¶2-1-18: *"Some prohibited/restricted areas and stationary ALTRVs are established for security reasons or to
  contain hazardous activities, and do not require a boundary separation minima. These areas may be exempted from vertical
  and lateral separation minima when identified by facility management."* (c lists *"1. Explosives detonation. 2. Ground
  firing of various types."*)

#### MOA

- 14 CFR 1.1: *"A military operations area (MOA) is airspace established outside Class A airspace to separate or segregate
  certain nonhazardous military activities from IFR Traffic and to identify for VFR traffic where theses activities are
  conducted."* (JO 7400.2R ¶25-1-1 has the same wording.) ¶25-1-2: *"MOAs are established to contain nonhazardous,
  military flight activities including, but not limited to, air combat maneuvers, air intercepts, low altitude tactics,
  etc."*
- ¶25-1-5: *"MOAs must not be established offshore beyond the United States 12 NM territorial limit."*
- ¶25-1-6: *"a. In effect, MOAs are always joint use in that VFR aircraft are not denied access, and IFR aircraft may be
  routed through the airspace, by agreement between controlling and using agencies, when approved separation can be
  provided from the MOA activity. b. Procedures for access to the airspace by nonparticipating IFR traffic must be specified
  in a letter of agreement between the controlling and using agencies."*
- AIM 3-4-5: *"Whenever a MOA is being used, nonparticipating IFR traffic may be cleared through a MOA if IFR separation can
  be provided by ATC. Otherwise, ATC will reroute or restrict nonparticipating IFR traffic. [...] Prior to entering an
  active MOA, pilots should contact the controlling agency for traffic advisories."*
- JO 7610.14A ¶3-3-4 a: *"When IFR service is provided by the ATC facility within the area, the separation within the area
  is the responsibility of the ATC facility unless MARSA is established [...]"*. ¶8-1-9 a.1: *"ATC facilities providing radar
  advisory service to VFR non−participating aircraft must alert them of the active MOA/Warning Area. If the pilot indicates
  that the aircraft will penetrate the areas, ATC must advise the MRU of the VFR penetration and transfer flight information
  on the VFR non−participating aircraft to the MRU."*

#### Warning area

- 14 CFR 1.1 (the same text in JO 7400.2R ¶24-1-2, AIM 3-4-4 and the P/CG): *"A warning area is airspace of defined
  dimensions, extending from 3 nautical miles outward from the coast of the United States, that contains activity that may
  be hazardous to nonparticipating aircraft. The purpose of such warning areas is to warn nonparticipating pilots of the
  potential danger. A warning area may be located over domestic or international waters or both."*
- JO 7400.2R ¶24-1-3 b: *"No new warning areas may be established in, or existing warning areas expanded into, domestic
  airspace overlying the waters between 3 and 12 NM from the shoreline. For new requirements that arise for SUA within 12 NM
  from the shoreline, the appropriate type of domestic SUA, (i.e., prohibited area, restricted area or MOA) must be
  designated or established."* ¶24-1-3 d: *"Nonparticipating VFR pilots, while not excluded from warning areas, are on
  notice that military activity, which may be hazardous to nonparticipating aircraft, is conducted in those areas."*
- ¶24-1-5: *"Warning areas must be considered for joint−use if the area, or portions thereof, can be returned to the
  controlling agency during periods when it is not required for its designated purpose, and provided the warning area is
  located in airspace wherein the FAA exercises ATC authority under ICAO agreements. When designating a warning area for
  joint−use, a letter of agreement must be executed between the controlling and using agencies to define the conditions and
  procedures under which the controlling agency may authorize nonparticipating IFR aircraft to transit or operate within the
  area. Apply the provisions of paragraph 23−1−5, Joint−Use, as appropriate."*

#### Alert area, controlled firing area, national security area (FAA types we do not have)

- JO 7400.2R ¶26-1-5: *"a. Only those activities that do not pose a hazard to other aircraft may be conducted in an alert
  area. b. All alert area activities must be conducted in accordance with VFR and in compliance with applicable Sections of
  14 CFR, without waiver."* AIM 3-4-6: *"[...] pilots of participating aircraft as well as pilots transiting the area must be
  equally responsible for collision avoidance."*
- ¶27-1-3 b (CFA): *"The distinguishing feature of a CFA, compared to other SUA, is that CFA activities must be suspended
  immediately when a nonparticipating aircraft approaches the area. The responsibility lies totally with the CFA user to
  terminate activities so that there is no impact on aviation. There is no requirement for nonparticipating aircraft to
  avoid the airspace, nor are any communications or ATC separation requirements imposed."* ¶27-1-6 b: *"CFAs are not
  intended to contain aerial activities including aircraft ordnance delivery and ground−to−air fires targeting aircraft or
  other objects in the air."*
- ¶28-1-2 (NSA): *"An NSA is established to identify locations where voluntary flight avoidance is requested."*

#### "Danger area" (ICAO) and how the FAA treats it

- P/CG: *"DANGER AREA [ICAO]- An airspace of defined dimensions within which activities dangerous to the flight of aircraft
  may exist at specified times. Note: The term "Danger Area" is not used in reference to areas within the United States or
  any of its possessions or territories."* No other copy read (14 CFR 73, JO 7400.2R, AIM 3-4, JO 7110.65BB §9-3, JO 7610.14A,
  JO 7210.3EE) has the words "danger area".
- The P/CG prints ICAO definitions beside the FAA ones only for prohibited and restricted areas (*"PROHIBITED AREA [ICAO]-
  [...] within which the flight of aircraft is prohibited."*, *"RESTRICTED AREA [ICAO]- [...] within which the flight of
  aircraft is restricted in accordance with certain specified conditions."*). For a danger area it gives the ICAO definition
  and says the FAA does not use the term.
- **What the FAA has in its place** (inference from the definitions above): an ICAO danger area is *"activities dangerous to
  the flight of aircraft"*. Over water beyond 3 NM, the FAA's word for that is a **warning area** (*"activity that may be
  hazardous to nonparticipating aircraft"*, *"to warn nonparticipating pilots of the potential danger"*). Within 12 NM,
  ¶24-1-3 b sends any new requirement to *"prohibited area, restricted area or MOA"*: a **restricted area** if the activity
  is hazardous (¶23-1-2), a **MOA** if it is not (¶25-1-1). No paragraph read maps the ICAO term onto an FAA type explicitly.

#### "Range"

- No FAA SUA type is called a range (¶21-1-3 b). In the orders, a range is **the facility and organisation that uses the
  airspace**. JO 7400.2R ¶21-3-3 g.1 (proposal content): *"Identify the facility or agency that will provide radio and/or
  radar monitoring, e.g., range control, military radar unit (MRU), airborne radar unit (ARU), Fleet Area Control and
  Surveillance Facility (FACSFAC)."* ¶24-1-1 d: *"DoD determined that the boundaries of selected warning areas could not be
  moved because of the need for continued connectivity to existing range resources (e.g., DoD missile launches)."*
- The airspace over firing is a **restricted area**: AIM 3-4-3 *"artillery firing, aerial gunnery, or guided missiles"*;
  ¶23-1-2 *"activities considered hazardous to nonparticipating aircraft"*; ¶23-1-4 a *"The restricted area floor may be
  established to the surface only when the using agency owns, leases, or by agreement, controls the underlying surface."*
  Offshore, the airspace is a **warning area** (¶24-1-2). The range itself is the **using agency** (¶21-1-11 a: *"the
  organization, or military command/unit whose activity established the requirement for the SUA"*; 73.15 (a)(1)). That
  matches the human's "ranges arent airspace anyway".

#### The human's remarks, settled by the FAA (one line each, no Desk question)

- **"All MOAs are danger areas."** Not by the FAA. A MOA is for *"nonhazardous military activities"* (14 CFR 1.1, ¶25-1-1),
  and *"The term "Danger Area" is not used in reference to areas within the United States"* (P/CG).
- **"moas are nearly always warning areas."** Not by the FAA. *"MOAs must not be established offshore beyond the United
  States 12 NM territorial limit"* (¶25-1-5), while a warning area is *"extending from 3 nautical miles outward from the
  coast"* and *"may be hazardous"* (14 CFR 1.1). They are two different designations, one over land and non-hazardous, the
  other offshore and possibly hazardous. What they share is how ATC treats them: both are joint use, VFR is not denied
  (¶25-1-6 a, ¶24-1-3 d), and IFR transits by LOA (¶25-1-6 b, ¶24-1-5).
- ADR 0038 added `DANGER` (and the ICAO vocabulary) on the human's earlier remark *"MOAs are generally danger or restricted
  airspaces (see FAA manual)"* and for Türkiye. Both reasons are now withdrawn by the 2026-10-25 rulings.

### What our app does today

**The type list.** `AREA_TYPES = ['MOA', 'RANGE', 'DANGER', 'RESTRICTED', 'PROHIBITED', 'WARNING']`
(`crc-sync/src/efsp/airspace-schema.js:22`). Client copies: `crc-desktop/app/public/js/panels/efsp/airspace-validate.js:12`
and the map's layer menu `crc-desktop/app/public/js/airspace-layer-menu.js:14`. The web admin copy is
`sourcedcs-web/public/js/airspace-admin.js:6`. Route types are `IR, VR, SR, LLTR` (`airspace-schema.js:23`). Every AREA needs
a `controllingPositionId` (`airspace-schema.js:286`) and an activation approval (`ACTIVATION_BY_KIND.AREA = 'APPROVE'`).
An entry alert only fires while the area is `ACTIVE`.

**Where the type is read for behaviour** (everything else only displays it: the card's header `airspace-card.js:76`, the
transit popover `bay/popovers/transit.js:21`, the alert reason `strip-alerts.js:85`, the layer toggle `airspace-layer-menu.js:71`):

| Reader | Sets | Where |
|---|---|---|
| Airspace-entry alert | `RESTRICTED_LIKE = RESTRICTED, PROHIBITED, RANGE, DANGER`: any aircraft without an approved entry alerts, VFR included. `JOINT_USE = MOA, WARNING`: a tracked VFR flight never alerts, a tracked IFR flight without approval alerts. An untracked contact reporting altitude alerts in any active area | `airspace-entry-alert.js:66-83` (ADR 0119 §3, H136 VQ4 b) |
| Airspace card's flight list | `ENTRY_TYPES` = both sets | `airspace-entry-alert.js:69`, `:247-251`, `:276` |
| Transit ops and deciders | `TRANSIT_TYPES = MOA, WARNING, RESTRICTED, RANGE, DANGER` (PROHIBITED has no transit) | `crc-sync/src/efsp/authority/airspace.js:135`; client copy `airspace-capabilities.js:156`; store `airspace-store.js:818`, `:945` |
| Grey `COORD` mark | `TRANSIT_TYPES` | `airspace-entry-alert.js:285` |

**The range as a using agency is a separate thing, not the type.** A range-control Position is an airspace's
`usingPositionId`. The derived **RANGES** Facility is built from every definition's `usingPositionId`, whatever the type
(`crc-sync/src/efsp/facility-config.js:192-197`; `airspace-store.js:90-94` refuses `usingFacilityId: 'RANGES'`). The
using-agency class row gives it `edit: 'FREQUENCY'`: "a range may change only its own control frequency"
(`authority/airspace.js:32-34`, applied at `airspace-store.js:602-605`). `controlFrequencyMhz` ("RANGE FREQ MHz",
`airspace-draft.js:19`) is the frequency `ApproveAirspaceEntry` moves a flight to (`board/ops/approve-airspace-entry.js:44`).
ADR 0038 already said this: the range's behaviour comes from `usingPositionId` and `controlFrequencyMhz`, "neither is
inferred from `type`". **Nothing of the RANGES Facility reads `type === 'RANGE'`.**

**Where `RANGE` / `DANGER` appear as data:** no shipped definition (`crc-sync/config/efsp-airspaces.json` holds only the
three JURISDICTION areas). The human's live `crc-sync/state/efsp-board.json` in the main checkout holds 3 airspaces, all
`MOA` (read only, counted with grep), and the two `state-backup-*` folders and `sourcedcs-web/data` hold none. In tests, 12
non-golden test files use `type: 'RANGE'` (crc-sync: `airspace-entry-alert`, `airspace-wire`, `airspace-containment`,
`efsp-scenario-airspace`, `efsp-scenarios`, `efsp-sfa-frequency-follow`, `helpers/airspace-registry.mjs`; crc-desktop:
`airspace-editor`, `efsp-airspace-panel`, `airspace-panel-views`, `efsp-ui-reachability`, `e2e/airspace-panel.spec.js`),
plus freeze goldens (29 files in all match). The editor's kind hint says *"AREA (an outline: MOA, range, danger area...)"*
(`airspace-editor.js:139`). sourcedcs-web's "ranges" are **booking resources** with a one-time legacy migration onto
airspaces (`sourcedcs-web/airspace-bookings.js:40`, `public/js/airspace-admin.js:393`). They name a bookable range, not a
type, and are out of this question.

**MOA vs WARNING in our app.** They are in the same sets everywhere above (`JOINT_USE`, `ENTRY_TYPES`, `TRANSIT_TYPES`),
so **they behave identically**. The only differences are display: separate layer-menu toggles and the type word in labels.
MARSA (`marsa-store.js`), TOFI/regime and conformance never read the type. ADR 0127, which would have treated a MOA
differently, was superseded by ADR 0128 (§1: "all warning and restricted airspaces, not MOA only").

### Cross-check, row by row

| Behaviour | Ours | FAA quote | Mark |
|---|---|---|---|
| Type list | MOA, RANGE, DANGER, RESTRICTED, PROHIBITED, WARNING | ¶21-1-3 b: P, R, MOA, W, Alert, CFA, NSA | **differs**: RANGE and DANGER are not FAA types; Alert, CFA, NSA missing |
| PROHIBITED: entry alerts for any aircraft unless approved | `RESTRICTED_LIKE` | 73.83, 91.133 (a), ¶22-1-1 | **matches** |
| PROHIBITED: no transit | `TRANSIT_TYPES` excludes it | ¶21-1-8 c "Joint−use does not apply"; ¶22-1-5 using agency **and** an FAA waiver | **matches** |
| PROHIBITED: who approves entry | the Position working the Strip (relaying) or the using agency (ADR 0119 §2) | 73.83 "authorization [...] by the using agency"; ¶9-3-1 NOTE relay | **matches** if the Position relays the using agency's word; ours as an op |
| PROHIBITED: scheduled and activated like any AREA; alerts only while ACTIVE; has a controlling Position | `ACTIVATION_BY_KIND.AREA`, schema `:286` | ¶22-1-4 "normally [...] 'continuous'"; ¶21-2-5 NOTE: no controlling agency for prohibited areas | **differs**: Desk SUA-Q5 |
| RESTRICTED: alerts for IFR and VFR unless approved | `RESTRICTED_LIKE` | 73.13 "No person [...] unless he has the advance permission" | **matches** |
| RESTRICTED: transit by request, decided by the side that separates the users | ADR 0128 | 73.15 (c)(2), §73.17, ¶9-3-4, ¶23-1-5 b | **matches** |
| RESTRICTED: not ACTIVE = no alert, no transit | `activeAreasContaining`, `_liveIfr` | ¶9-3-1 c; ¶23-1-5 a "During such periods, the controlling agency may permit" | **matches** |
| RESTRICTED: no "exempt from boundary separation" flag | none | 7210.3EE ¶2-1-18 (facility management identifies them) | **silent** for us: no Desk item (we have no boundary-separation check to exempt) |
| MOA: tracked VFR never alerts | `JOINT_USE` | ¶25-1-6 a "VFR aircraft are not denied access" | **matches** |
| MOA: tracked IFR without approval alerts | `alertsIn` | ¶9-3-2 (separate nonparticipants); AIM 3-4-5 "reroute or restrict" | **ours** (an aid to ¶9-3-2; the FAA's own aid is EDST's predictive probe, ADR 0119) |
| MOA: IFR transit by request and decision | ADR 0128 | ¶25-1-6 a–b, ¶9-3-4, 7610.14A ¶8-1-9 b.1 | **matches** |
| MOA/WARNING: VFR penetration advised to the MRU | not built (H151 MT-Q5 b) | 7610.14A ¶8-1-9 a.1 | **differs**, by the human's ruling (H151); no new Desk item |
| WARNING: behaves as MOA | same sets | ¶24-1-3 d (VFR not excluded), ¶24-1-5 (IFR by LOA), ¶9-3-1/2/4 list them together | **matches** for ATC's procedures |
| WARNING: offshore only, ≥ 3 NM from the coast | nothing checks it | 14 CFR 1.1, ¶24-1-3 b | **silent** for us (a placement rule for the airspace designer, not ATC); the editor could say it; no Desk item |
| WARNING/RESTRICTED: nonjoint-use areas | every area is treated as joint use | ¶21-1-8 b (joint use is the default), ¶9-3-4 NOTE | **matches** the default; a nonjoint-use area is a real choice: Desk SUA-Q6 |
| DANGER: restricted-like (alerts VFR, transit) | `RESTRICTED_LIKE`, `TRANSIT_TYPES` | P/CG: "not used in reference to areas within the United States" | **differs**: not an FAA type. Removed under the 2026-10-25 rulings (Desk SUA-Q3 is only about moving existing data) |
| RANGE: restricted-like | same | ¶21-1-3 b (no such type); AIM 3-4-3, ¶23-1-2 (restricted), ¶21-3-3 g.1 (range control is the using agency) | **differs**: not an FAA type. Removed under the 2026-10-25 rulings (Desk SUA-Q3) |
| Range control as using agency (`usingPositionId`, RANGES Facility, control frequency, FREQUENCY edit scope) | `facility-config.js:192-197`, `authority/airspace.js:32-34` | ¶21-1-11 a, 73.15 (a)(1), ¶21-3-3 g.1 | **matches**, and independent of the type |
| Alert area, CFA, NSA | absent | ¶26, ¶27, ¶28; ¶9-3-1 NOTE (no ATC procedures for alert areas/CFAs) | **silent** on whether we need them: Desk SUA-Q4 |
| Routes IR, VR | ROUTE types, never alert | P/CG "MILITARY TRAINING ROUTES" (IFR/VFR MTRs) | **matches** (ADR 0119: ours that an MTR never alerts) |
| Routes SR, LLTR | ROUTE types | not found in any copy read | **ours**; they do not bear on Q2 (a ROUTE never alerts, has no transit) |

### Answer in plain words

Mostly yes for the four FAA types we have: prohibited, restricted, MOA and warning area behave the way the FAA rules say.
Restricted and prohibited areas keep everyone out without permission, VFR included. MOAs and warning areas let VFR in and
take IFR through only by agreement. Releasing any of them to ATC lifts everything.

Two of our six types are not FAA airspace at all:

- **`DANGER`** is the ICAO word the FAA does not use. Depending on where it is and how hazardous the activity is, it
  becomes a restricted area, a MOA or a warning area.
- **`RANGE`** is a using agency, not an airspace. The airspace over a range is a restricted area (or a warning area
  offshore), and the range's controllers are its using agency. Our app already models that part correctly and separately
  (`usingPositionId`, the RANGES Facility, the range control frequency), so dropping the type loses nothing.

On the human's remarks: by the FAA, a MOA is neither a danger area nor a warning area. A MOA is over land and
non-hazardous, a warning area is offshore and may be hazardous. ATC handles the two alike, and so does our app, which is
right.

Three smaller gaps:

- A prohibited area is treated like a schedulable block. The FAA makes it continuous, with no controlling agency.
- The FAA's other three types (alert area, controlled firing area, national security area) are missing. None of them
  involves ATC separation.
- Nothing models a nonjoint-use area.

### Gaps

| # | Gap | Status |
|---|---|---|
| T1 | `RANGE` and `DANGER` are not FAA types | FAA settles it (rulings 2026-10-25); how existing data moves: Desk **SUA-Q3** |
| T2 | PROHIBITED is scheduled/activated and has a controlling Position; alerts only while ACTIVE | FAA "normally continuous", no controlling agency: Desk **SUA-Q5** |
| T3 | ALERT, CFA, NSA absent | FAA defines them; need is ours: Desk **SUA-Q4** |
| T4 | Nonjoint-use restricted/warning areas not modelled | FAA default is joint use; Desk **SUA-Q6** |
| T5 | WARNING placement (≥ 3 NM offshore) not checked | silent for ATC; at most an editor hint; no Desk item |
| T6 | The editor hint *"MOA, range, danger area..."* and the H136 VQ4 b wording "restricted/prohibited/range/danger alert unless approved" | wording follows T1 |

**What removing `RANGE` and `DANGER` touches** (for the lane that builds SUA-Q3; inventory only, no code changed here):
`airspace-schema.js:22`, `airspace-entry-alert.js:66` (and its header comment), `authority/airspace.js:132-135`, the client
`airspace-capabilities.js:156` (parity test), `airspace-validate.js:12`, `airspace-layer-menu.js:14` (a saved layer-menu
setting with a `RANGE`/`DANGER` key just stops being read: `bool(raw.kinds && raw.kinds[k], …)` reads only `MENU_KINDS`),
`airspace-editor.js:139`, `sourcedcs-web/public/js/airspace-admin.js:6`, the 12 test files listed above, and the freeze
goldens (`npm run freeze:update`, separate commit). Whether the wire changes: the type is record content, not scanned
(ADR 0128 §7), so probably no `wire:record` is needed (inference; the build lane runs `wire-protocol.test.mjs` to be sure).
The `restore` path refuses an unknown type and stops start-up (`airspace-store.js:1065-1068`), as the strict-`state/`
rule wants. No live file holds one today.

---

## Proposed Decision Desk questions

**SUA-Q1. When does an approved transit end?** (Q1 G1, G3; FAA silent; inference: one passage.)
- **a.** It ends by itself when the flight, having been inside, is outside the airspace's volume (lateral and vertical) for
  a short hold, say 30 s of mission time to ride out an edge clip (ours). One `EndTransit` audit line, trigger
  `LEFT_AIRSPACE`. A later entry is unapproved again: it alerts and needs a new transit. The existing ends stay.
- **b.** A "Transit complete" action for the flight's holder or the decider. Nothing automatic.
- **c.** Keep today's behaviour: it lasts until the Strip goes, the release, the reset or a withdrawal.
- **Recommended: a.** It matches the reading that permission is "to transit the area" (¶9-3-4, 73.15 (c)(2), ¶8-1-9 b.1
  "throughout the entire ATCAA/SUA" for the aircraft "cleared to transit"). It needs no click (dark cockpit), and the
  re-entry alert then catches the case the FAA would call a nonparticipant (¶9-3-2 NOTE). The tick already computes
  `inside` per flight and airspace.

**SUA-Q2. Is the decider shown that a transit is done?** (Q1 G2; FAA silent; H151 MT-Q3 c ruled out a "Resume ops" button.)
- **a.** No. The row leaves the card when the transit ends (with SUA-Q1 a). That is the only signal, and the users'
  restriction stays on their Strips for the controller to change.
- **b.** A grey `transit complete` line on the decider's card row until the decider acknowledges it (as H156 MTB-Q2 b did
  for a decline). Its only job is to prompt the controller to lift the users' block. There is no button that lifts it.
- **c.** A grey mark on each user's Strip that carries an entry block, until changed.
- **Recommended: b.** It is the same pattern the human chose for a decline. It tells the side that restricted the users
  that the reason has gone (the MRU-side counterpart is 7610.14A ¶8-1-11 g, "Advise the associated ATC facility whenever the
  activities [...] are terminated": inference by analogy). It changes no assignment, so H151 MT-Q3 c stands.

**SUA-Q3. `RANGE` and `DANGER` go (FAA: not SUA types). What do existing definitions become?** (Q2 T1.)
- **a.** Remove both types with no automatic migration. A `state/` Board snapshot holding one stops start-up and names the
  airspace (the strict-`state/` rule; no live file has one). The squadron retypes it in the panel or web: **RESTRICTED** for
  the airspace over a firing range or other hazardous activity over land, **WARNING** offshore beyond 3 NM, **MOA** for
  non-hazardous military flying. The range-control using agency (`usingPositionId`, the RANGES Facility, `controlFrequencyMhz`,
  the FREQUENCY edit scope) stays as it is. Tests and goldens move to RESTRICTED.
- **b.** Remove both, and on restore rewrite `RANGE` → `RESTRICTED` and `DANGER` → `RESTRICTED` automatically.
- **c.** Keep them as display aliases that behave as RESTRICTED.
- **Recommended: a.** Lane rule 5 says no backwards compatibility. No live data is affected, and only a human can tell an
  offshore, hazardous or non-hazardous area apart (¶24-1-3 b, ¶23-1-2, ¶25-1-1). An automatic RESTRICTED would mislabel
  a danger area that should be a MOA. (c) keeps the non-FAA words the rulings remove.

**SUA-Q4. Add the FAA types we lack: alert area, controlled firing area, national security area?** (Q2 T3; the FAA
defines them, whether the squadron needs them is our choice.)
- **a.** None now. Add one when a mission needs it.
- **b.** ALERT only: charted, never alerts, no transit, no activation (¶21-1-8 c "nonparticipating aircraft may transit
  these areas without limitation"; ¶9-3-1 NOTE: no ATC procedures).
- **c.** All three (CFA and NSA as display-only areas: ¶27-1-3 b no ATC separation, ¶28-1-2 voluntary avoidance).
- **Recommended: a.** None of the three asks anything of ATC (¶9-3-1 NOTE, ¶27-1-3 b, ¶28-1-2), no squadron use is
  known, and v2 lanes run lean. The type list stays open for N, so adding one later is a one-line schema change plus
  the sets above.

**SUA-Q5. A prohibited area: continuous, and approved only by its using agency?** (Q2 T2; the FAA says "normally"
continuous, so this is a real choice.)
- **a.** A PROHIBITED area is always in force: no schedule or activation, and it alerts whenever an aircraft is inside
  without approval. The approval is the using agency's (73.83), relayed or given directly as today (ADR 0119 §2). Ours: it
  keeps a `controllingPositionId` only so the alert has someone to go to (¶21-2-5 NOTE designates none).
- **b.** Keep today's lifecycle (scheduled, activated, released).
- **Recommended: a.** It follows ¶22-1-4 ("continuous" time of designation) and ¶22-1-2 (security of an area on the
  surface). Today a prohibited area nobody activated does not alert at all, which is the opposite of the FAA's intent.

**SUA-Q6. Model a nonjoint-use restricted or warning area?** (Q2 T4; the FAA default is joint use, ¶21-1-8 b.)
- **a.** No. Every area is joint use, as now.
- **b.** A per-area `jointUse: false`: while it is active, only the using agency may approve a transit or an entry (¶9-3-4
  NOTE: no clearance "without the appropriate approval"), never the controlling Position on its own.
- **Recommended: a.** The FAA makes joint use the rule and nonjoint use the exception that needs justification
  (¶21-1-8 b), and no squadron area is known to be nonjoint-use. If one turns up, (b) is a small change to `transitDeciders`.

**Not a Desk question (the FAA settles it):** collapsing MOA, WARNING and DANGER into fewer types. MOA and warning area
are separate FAA designations, over land and non-hazardous vs offshore and possibly hazardous (14 CFR 1.1, ¶25-1-5,
¶24-1-3 b). Our app already treats them alike, which matches how ATC treats them (¶9-3-1/2/4, 7610.14A ¶8-1-9 a). DANGER
goes under SUA-Q3. Both MOA and WARNING stay.
