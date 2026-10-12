# Live test 2026-10-11: what the FAA orders say (LT-RESEARCH, Q1–Q12)

Research lane for the live-test fix batch (`docs/parallel/next/LT-RESEARCH.md`, findings in
`docs/parallel/live-test-2026-10-11.md`). Rule H128, "FAA model, always": every answer quotes the paragraph and
names the edition; where an order is silent it says so and the human decides; anything inferred is labelled
**inference**.

## Sources and editions (all read from faa.gov on 2026-10-12)

| Short name | Edition read | Where |
|---|---|---|
| JO 7110.65BB | Air Traffic Control, Basic 2-20-25 with Chg 1 (8-7-25), Chg 2 (1-22-26) and **Chg 3 (7-9-26)** | faa.gov HTML chapters (`atc_html/chapN_section_M.html`) and the consolidated PDF `7110.65BB_Bsc_w_Chg_1_2_and_3_dtd_7-9-26_Final.pdf` |
| JO 7610.14A | Non-Sensitive Procedures and Requirements for Special Operations, effective 8-7-25, with Chg 1 (1-22-26) and Chg 2 (7-9-26) | `7610.14_Basic_w_Chg1_and_Chg_2_dtd_7-9-26.pdf` |
| P/CG | Pilot/Controller Glossary, Basic with Chg 1, 2 and 3 (7-9-26) | `PCG_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| JO 7210.3EE | Facility Operation and Administration, Basic with Chg 1, 2 and 3 (7-9-26) | `7210.3EE_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| JO 7400.2R | Procedures for Handling Airspace Matters, Basic with Chg 1, 2 and 3 (7-9-26) | `7400.2R_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| JO 7400.10H | Special Use Airspace | `JO_7400.10H_Long_Order_-_Final_-_signed.pdf` |

**Edition note for the supervisor:** the briefing cites "JO 7610.14 (with Chg 1, 3-21-24)". The current order is
**JO 7610.14A** (effective 8-7-25) with Chg 2 (7-9-26). ¶7-1-5 is unchanged in number and words (quoted under Q1), so the
ruling H128 stands; ADRs should cite "JO 7610.14A ¶7-1-5".

Paragraph letters/numbers below are as printed in the order (sub-paragraph `a.`, `1.`, `(a)`).

---

## Q1 (T1) — SFA: how approach hands the aircraft to the GCA (PAR) controller

### What the orders say

**JO 7610.14A ¶7-1-5, SINGLE FREQUENCY APPROACH (SFA):**
> When SFA procedures are implemented by terminal facilities providing radar approach control service to airports where
> military single-piloted turbojet aircraft are regularly based, ensure that the following conditions are met:
> a. Communications capability will meet normal demands without increasing aircraft delays.
> b. At least five discrete ultra-high frequency (UHF) frequencies are available for this use.
> c. The radar approach controller retains jurisdiction over the rotation of three frequencies between himself and the
> GCA controller.
> d. A letter of agreement is completed by the FAA facility Air Traffic manager with local military authorities covering
> ATC procedures, use of frequencies, etc.

**JO 7110.65BB ¶4-7-3, SINGLE FREQUENCY APPROACHES (SFA)** (TERMINAL):
> Where SFA procedures for military single-piloted turbojet aircraft on an IFR flight plan are contained in a letter of
> agreement, do not require a radio frequency change after the aircraft begins approach or after initial contact during
> an en route descent until a landing or low approach has been completed except under the following conditions:
> a. During daylight hours while the aircraft is in VFR conditions. b. On pilot request. c. When pilot cancels IFR flight
> plan. d. In an emergency situation. e. When aircraft is cleared for visual approach.

**JO 7110.65BB ¶5-10-15, MILITARY SINGLE FREQUENCY APPROACHES** (the approach-to-final handoff itself):
> a. Utilize single frequency approach procedures as contained in a letter of agreement.
> b. Do not require a frequency change from aircraft on a single frequency approach after the approach has begun unless:
> 1. Landing or low approach has been completed. 2. The aircraft is in visual flight rules (VFR) conditions during
> daylight hours. 3. The pilot requests the frequency change. 4. An emergency situation exists. 5. The aircraft is
> cleared for a visual approach. 6. The pilot cancels instrument flight rules (IFR).
> c. Accomplish the following steps to complete communications transfer on single frequency approaches after completion
> of a handoff:
> 1. Transferring controller: Position transmitter selectors to preclude further transmissions on the special use
> frequencies.
> 2. Receiving controller: Position transmitter and receiver selectors to enable communications on the special use
> frequencies.
> 3. Do not require or expect the flight to check on frequency unless an actual frequency change is transmitted to the
> pilot.

**JO 7110.65BB ¶4-7-4** (already confirmed by the supervisor): avoid frequency and beacon changes; c. *"If practicable,
use a frequency common to both the GCA unit and approach control to minimize frequency changes."* d. *"When a GCA unit is
not able to communicate on a common frequency, a change to a GCA frequency may be authorized."* g. *"In the event of a
missed approach, do not require a frequency/radar beacon change before the aircraft reaches the missed approach altitude,
the MEA, or the MVA."*

**P/CG, SINGLE FREQUENCY APPROACH:**
> A service provided under a letter of agreement to military single-piloted turbojet aircraft which permits use of a
> single UHF frequency during approach for landing. Pilots will not normally be required to change frequency from the
> beginning of the approach to touchdown except that pilots conducting an en route descent are required to change
> frequency when control is transferred from the air route traffic control center to the terminal facility.

**The handoff (the "strip/transfer side")** is the ordinary radar handoff; nothing SFA-specific:
- JO 7110.65BB ¶5-4-5 TRANSFERRING CONTROLLER HANDOFF, e.g. c. *"Advise the receiving controller of pertinent information
  not contained in the data block or flight progress strip, including: 1. Assigned heading. … 3. Altitude information
  issued. …"*; g. *"Consider the target being transferred as identified on the receiving controller's display when the
  receiving controller acknowledges receipt verbally or accepts the automated handoff."*; i. *"… To the extent possible,
  transfer communications when the handoff has been accepted."*
- ¶5-4-6 RECEIVING CONTROLLER HANDOFF d.: identity confirmation after a handoff *"do[es] not apply at those towers and
  GCAs that have been delegated the responsibility for providing radar separation within designated areas by the
  overlying approach control facility and the aircraft identification is assured by sequencing or positioning prior to
  the handoff."*
- ¶2-1-15 CONTROL TRANSFER a.2: transfer control *"At the time a radar handoff and frequency change to the receiving
  controller have been completed and when authorized by a facility directive or letter of agreement which specifies the
  type and extent of control that is transferred."*
- ¶5-9-5 APPROACH SEPARATION RESPONSIBILITY a.: *"The radar controller performing the approach control function is
  responsible for separation of radar arrivals … Radar final controllers ensure that established separation is
  maintained between aircraft under their control and other aircraft established on the same final approach course."*
- Without SFA, the frequency change to final is ¶5-9-4 d.3 *"Contact the final controller on the appropriate frequency
  if radar service will be provided on final on a different frequency"* and ¶5-10-8 phraseology *"CONTACT (name of
  facility) FINAL CONTROLLER ON (frequency)"*. ¶5-9-4 NOTE: *"at times it will be desirable to retain an aircraft on the
  approach control frequency to provide a single-frequency approach … When this occurs, it will be necessary to relay
  tower clearances or instructions to preclude changing frequencies prior to landing or approach termination."*
- JO 7210.3EE ¶3-3-3 b.: *"Facilities must establish procedures to ensure that frequencies used on a shared basis; e.g.,
  single frequency approach operations, are continuously monitored by one of the positions of operation."*

Flight progress strips: JO 7110.65BB Chapter 2 Section 3 has **nothing SFA- or GCA-specific**; the strip follows the
handoff like any other (Q5 for the blocks).

### Answer in plain words

- AP vectors the aircraft and, at the point the LOA sets, **hands it off to the PAR (final) controller by an ordinary radar
  handoff** (¶5-4-5/5-4-6), passing assigned heading and altitude information not on the strip/data block.
- On an SFA the **pilot does not change frequency**. The frequency moves instead: after the handoff AP deselects its
  transmitter on that frequency and PAR selects transmit and receive on it (¶5-10-15 c.1–2). No check-in is expected
  (c.3). Control passes when handoff and the (selector) frequency transfer are done (¶2-1-15 a.2).
- The **rotation** is that: of at least five discrete UHF frequencies, **three** move between AP and the GCA controller
  with each aircraft, and **AP decides** which frequency goes where (7610.14A ¶7-1-5 b–c).
- **Which three of the five rotate, and what the other two are for: silent — the human decides.** The order fixes only
  "at least five" and "three rotate"; the rest is the local LOA (¶7-1-5 d, ¶5-10-15 a). **Inference:** the other two are
  the AP/approach-control frequencies the aircraft first checks in on (the en route descent check-in that the P/CG says
  *is* a frequency change) and a spare; nothing in the orders says so.
- The aircraft stays on its frequency until landing or low approach is complete, except ¶4-7-3 a–e / ¶5-10-15 b.2–6. On a
  missed approach no change before missed approach altitude/MEA/MVA (¶4-7-4 g).

### What it means for LT-SFA-PAR

No SFA Position. The AP → PAR move is a **handoff** (transfer of the FINAL/ARRIVAL Strip to PAR, accepted by PAR), and
the SFA frequency is an attribute of the flight that **travels with it**: on acceptance the frequency is "selected" at
PAR and released at AP; AP owns the assignment of the three rotating frequencies (the SFA rotation record stays AP's).
The refused drop in the test ("only valid next state from INBOUND is HANDED_TO_TOWER") must become a legal AP → PAR
handoff. A frequency change should be offered/flagged only under the ¶4-7-3 a–e exceptions; the split of the five
frequencies into "three rotating + two others" is facility config the human sets.

---

## Q2 (T5) — what ends the PAR controller's part of an approach

### What the orders say

**JO 7110.65BB ¶5-10-13, TOWER CLEARANCE:**
> a. When an aircraft is on final approach to an airport served by a tower, obtain a clearance to land, touch-and-go, or
> make low approach. Issue the clearance and the surface wind to the aircraft.
> b. If the clearance is not obtained or is canceled, inform the aircraft and issue alternative instructions.
> PHRASEOLOGY- TOWER CLEARANCE CANCELED/NOT RECEIVED (alternative instructions).

**¶5-12-7, POSITION ADVISORIES:** *"Continue to provide glidepath and course information … until the aircraft passes
over threshold."* … *"OVER LANDING THRESHOLD, (position with respect to course)."*

**¶5-12-8, APPROACH GUIDANCE TERMINATION:**
> a. Discontinue precision approach guidance when: 1. Requested by the pilot. 2. In your opinion, continuation of a safe
> approach to the landing threshold is questionable. 3. The aircraft passes over landing threshold. 4. The pilot reports
> the runway/approach lights in sight and requests to or advises that he/she will proceed visually.
> b. … advise the aircraft of its position and to proceed visually. PHRASEOLOGY- (Distance) MILE(S) FROM TOUCHDOWN,
> PROCEED VISUALLY …
> c. After a pilot has … been instructed to proceed visually, all PAR approach procedures must be discontinued.
> d. **Continue to monitor final approach and frequency. Pilots must remain on final controller's frequency until
> touchdown or otherwise instructed.**

**¶5-12-9, COMMUNICATION TRANSFER:**
> Issue communications transfer instructions.
> PHRASEOLOGY- CONTACT (terminal control function) (frequency, if required) AFTER LANDING.
> NOTE- Communications transfer instructions should be delayed slightly until the aircraft is on the landing roll-out to
> preclude diversion of the pilot's attention during transition and touchdown.

**Missed approach:** ¶5-10-11 (issue the missed approach procedure before final descent when any part of the final is
IFR), ¶5-10-12 LOW APPROACH AND TOUCH-AND-GO (*"issue appropriate departure instructions to be followed upon completion of
the approach. Climb-out instructions must include a specific heading and altitude except when the aircraft will maintain
VFR and contact the tower"*; phraseology *"AFTER COMPLETING LOW APPROACH/TOUCH AND GO: CLIMB AND MAINTAIN (altitude). TURN
… HEADING … / MAINTAIN VFR, CONTACT TOWER"*), ¶5-10-14 FINAL APPROACH ABNORMALITIES (*"… execute a missed approach if
previously given; or climb to or maintain a specified altitude and fly a specified course …"*), ¶4-7-4 g (no frequency
change before missed approach altitude/MEA/MVA), and P/CG MISSED APPROACH c. *"At locations where ATC radar service is
provided, the pilot should conform to radar vectors when provided by ATC in lieu of the published missed approach
procedure."*

**"Landing assured":** searched JO 7110.65BB, the P/CG and JO 7210.3EE: **the phrase does not exist.** The tower's
clearance relayed by the final controller is *"(runway), WIND …, CLEARED TO LAND"* (¶5-10-13 a with ¶3-10-5 a/g).
¶3-10-5 g NOTE: *"A clearance to land means that appropriate separation on the landing runway will be ensured."*

### Answer in plain words

- During the PAR final the **final controller obtains the tower's clearance** (land / touch-and-go / low approach) and
  **relays it** with the wind (¶5-10-13). If not received: "TOWER CLEARANCE NOT RECEIVED" + alternative instructions
  (usually a missed approach).
- Guidance ends **over the landing threshold** (or earlier when the pilot proceeds visually, asks, or safety is
  questionable) (¶5-12-7, ¶5-12-8 a). The pilot **stays on the final controller's frequency until touchdown** (¶5-12-8 d)
  and is told to contact the next terminal function (ground or tower) **after landing**, on the roll-out (¶5-12-9). So
  the PAR controller's part of a full-stop landing ends **at touchdown / roll-out with the "contact … after landing"
  transfer**, not at a separate "landing assured" moment.
- Low approach / touch-and-go: the climb-out instructions were issued before final descent (¶5-10-12); the aircraft then
  goes to the tower ("MAINTAIN VFR, CONTACT TOWER") or flies the issued heading/altitude (for us: back to AP for another
  approach — **inference**: the order says climb-out heading and altitude, not who works it next; that is LOA content).
- Missed approach: PAR issues the missed approach / alternative instructions and the aircraft flies the published or
  issued procedure; no frequency change before missed approach altitude/MEA/MVA (¶4-7-4 g); who receives it next is LOA
  content (**silent** in the order beyond that).

### What it means for LT-SFA-PAR

"Landing assured" is **ours** (not FAA wording). The FAA-shaped FINAL sequence on PAR is: *on final* → *cleared to land
relayed* (tower clearance obtained; optional to model) → **landed: Strip leaves PAR** (to LC/GC's Bay or finished at
touchdown) — so the Strip must not stay in `par-final`. The button should read in FAA terms (e.g. "Cleared to land" for
the relay and "Landed" / "Contact … after landing" for the end), and a "Tower clearance not received" path goes to the
missed approach. The missed approach keeps the flight with PAR until missed approach altitude, then goes where the LOA
says (the human decides: back to AP for re-sequencing is the usual military practice — **inference**).

---

## Q3 (T11) — headings and the assigned altitude on a PAR final

### What the orders say

**JO 7110.65BB ¶5-12-4, GLIDEPATH AND COURSE INFORMATION:**
> a. Issue course guidance and inform the aircraft when it is on glidepath and on course, and frequently inform the
> aircraft of any deviation from glidepath or course. Transmissions with aircraft on precision final approach should
> occur approximately every 5 seconds.
> PHRASEOLOGY- **HEADING (heading).** ON GLIDEPATH. ON COURSE, or SLIGHTLY/WELL ABOVE/BELOW GLIDEPATH. SLIGHTLY/WELL
> LEFT/RIGHT OF COURSE.

**P/CG, VECTOR:** *"A heading issued to an aircraft to provide navigational guidance by radar."*

**¶5-12-3, DESCENT INSTRUCTION:** *"When an aircraft reaches the point where final descent is to start, instruct it to
begin descent."* PHRASEOLOGY- *"BEGIN DESCENT."* (¶5-12-1: *"APPROACHING GLIDEPATH"* 10–30 s before.)

**¶5-9-4 c, ARRIVAL INSTRUCTIONS:** issue *"Approach clearance **except when conducting a radar approach**."* — a PAR
approach has **no "cleared … approach"** in the ¶4-8-1 sense. (¶5-10-2 b.1 instead: *"THIS WILL BE A P-A-R APPROACH TO
RUNWAY (number)"*.)

**¶5-9-1 c:** vector to intercept *"For a precision approach, at an altitude not above the glideslope/glidepath or below
the minimum glideslope intercept altitude specified on the approach procedure chart."*

**¶5-12-7 NOTE:** *"Glidepath and course information provided below decision altitude is advisory only."*

**¶5-10-14:** missed approach when *"Safety limits are exceeded or radical target deviations are observed"*; *"The
conditions in subparagraphs a, b, and c do not apply after the aircraft passes decision height on a PAR approach."*

**¶4-8-1** (approach clearance) applies to non-radar/own-navigation approaches; its altitude rule (b.2, *"Assigned an
altitude to maintain until the aircraft is established on a segment of a published route or instrument approach
procedure"*) is about clearing an aircraft for an IAP, not about a PAR talk-down.

### Answer in plain words

- **Headings: yes.** The PAR controller gives course guidance by headings ("HEADING 2-3-5", ¶5-12-4 phraseology), every
  ~5 s. A heading issued by ATC for radar navigation guidance is a **vector** (P/CG). Whether the order calls it an
  "assigned heading": **the term is not defined for PAR**; ¶5-4-5 c.1 lists "Assigned heading" as handoff information
  generally. **Inference:** PAR's headings are assigned headings in the ordinary sense (an ATC-issued heading the pilot
  must fly), but they change every few seconds and are *corrections*, so conformance on them is the PAR controller's own
  task (deviation calls "left/right of course"), not a standing heading to check against.
- **Altitude:** there is no approach clearance on a radar approach (¶5-9-4 c). The aircraft holds its last assigned
  altitude until the final controller says **"BEGIN DESCENT"** (¶5-12-3); from then on the reference is the **glidepath**
  (¶5-12-4, deviations "above/below glidepath"), not an assigned altitude. Below decision altitude everything is advisory
  (¶5-12-7 NOTE).

**Carrier final:** JO 7110.65BB does **not** cover carrier (CATCC/CCA) operations (no carrier procedures in the order;
they are in the Navy CV NATOPS / CATCC manuals, not read here). **Silent — the human decides.** **Inference:** a carrier
CCA final is the same radar talk-down idea (course/glidepath calls), so the PAR answer would be applied by analogy.

### What it means for LT-SFA-PAR

- Altitude conformance (LEVEL_BUST/WRONG_WAY) against AP's last assigned altitude must **stop when PAR issues "begin
  descent"** (or, if we do not model that call, at the PAR handoff/ON_FINAL — the human decides which trigger; the FAA
  trigger is "begin descent"). On the glidepath there is no assigned altitude; the FAA's own monitoring is the
  controller's glidepath deviation calls, which we do not alert on (no FAA automation alert for it was found).
- Headings: PAR may enter headings on the FINAL Strip (¶5-12-4). Whether our HEADING conformance alert runs against
  them is **silent — the human decides**; recommendation: record PAR's heading (it is handoff/missed-approach
  information, ¶5-4-5 c.1) but **do not alert** on it during the final, because the order makes course deviation the
  PAR controller's continuous verbal job and the heading changes every few seconds.
- AP's last vector must not keep alerting after the handoff: on acceptance by PAR, the heading reference becomes PAR's
  (or none).

---

## Q4 (T7) — the wake category indicator in strip Block 3

### What the orders say

**JO 7110.65BB ¶2-3-4 TERMINAL DATA ENTRIES**, TBL 2-3-3 (arrivals), TBL 2-3-4 (departures) and TBL 2-3-5
(overflights), Block 3, all three identical:
> 3. Number of aircraft if more than one, wake category indicator, type of aircraft, and aircraft equipment suffix.

This wording is **new in Chg 2 (1-22-26)**. The Chg 2 briefing guide (BG-51) shows the change: OLD *"Number of aircraft if
more than one, heavy aircraft indicator "H/" if appropriate, type of aircraft, and aircraft equipment suffix."* → NEW
*"… wake category indicator …"*, with the background: *"the contents of FAA Order JO 7110.126, Consolidated Wake
Turbulence (CWT), be incorporated into FAA Order JO 7110.65 … a single standard of wake turbulence separation will be
used by all terminal air traffic facilities. En route facilities are exempt from the CWT standard and will remain with the
legacy standards …"*. ¶2-2-6 a.2 (IFR flight progress data) got the same new words.

**En route, unchanged — JO 7110.65BB ¶2-3-2, TBL 2-3-1, Block 4:**
> 4. Number of aircraft if more than one, heavy aircraft indicator "H/" if appropriate, type of aircraft, and aircraft
> equipment suffix.

**JO 7210.3EE** (NAS flight plan format, Field 03 Aircraft Data): *"1. Super or heavy aircraft indicator (H/): When
aircraft are designated super or heavy, the heavy indicator is mandatory. 2. Type of Aircraft: … the standard aircraft
type designator, in accordance with FAA Order JO 7360.1 … 3. Equipment Suffix: … a slash followed by one letter …"*

**P/CG, AIRCRAFT WAKE CATEGORIES** (terminal): *"ATC classifies aircraft as Category A through Category I as follows:
a. CATEGORY A. The Airbus A-380-800 (A388) is classified as a super aircraft. b. CATEGORY B, C, and D. Aircraft capable
of takeoff weights of 300,000 pounds or more … heavy aircraft. c. CATEGORY E. All B757 aircraft. d. CATEGORY F, and G.
Aircraft weighing 41,000 pounds or more maximum certificated takeoff weight, up to but not including 300,000 pounds.
e. CATEGORY H and I. Aircraft of less than 41,000 pounds …"* **P/CG, AIRCRAFT CLASSES** (legacy, en route): Super,
Heavy, Large, Small, each mapped to those categories. **JO 7110.65BB ¶5-5-4 g–h** (TBL 5-5-3/5-5-4) separate by the
A–I categories in the terminal; **¶5-5-4 i** *"When NOWGT is displayed in an aircraft data block, provide 10 miles
separation …"* (TBL 1-2-1: *"NOWGT — No weight. The weight class or wake category has not been determined"*).

**JO 7360.1K, Aircraft Type Designators** (effective 06/12/2025), ¶2-6, ¶2-10, ¶2-11: three different "wake" values
per type: the **ICAO WTC** (¶2-6: *"SUPER (J)", "Heavy (H)", "Medium (M)", "Light (L)"*, written after the type in the
ICAO plan, e.g. *"A345/H"*), the **FAA weight class** (¶2-10 b: *"J – Super, H – Heavy, L – Large, S – Small"*), and
the **CWT category** (¶2-11). Examples from its Appendix A: `F16  1J/L  Medium  G` (FAA class Large, ICAO WTC Medium,
CWT **G**); `K35R 4J/H Heavy C`; `B763 2J/H Heavy C`; `C130 4T/L Medium F`; `T38 2J/S Light I`; `A10 2J/L Medium G`.

**¶2-3-6 AIRCRAFT TYPE:** *"Use the approved aircraft type designator, in accordance with FAA Order 7360.1, Aircraft
Type Designators."* **¶2-3-8 e** (suffix): *"state the aircraft type followed by the word "slant" and the appropriate
phonetic letter equivalent of the suffix. EXAMPLE- … "F-Sixteen slant Papa." …"*; TBL 2-3-10 lists the suffixes
(`/H /O /W /Z /L /X /T /U /D /B /A /M /N /P /Y /C /I /V /S /G`).

**Strip examples:** FIG 2-3-4/2-3-5/2-3-6 are block-layout drawings only (rendered and checked); they show the block
numbers, no filled-in example. **No figure or paragraph in the current order shows how the terminal "wake category
indicator" is written** (which letter set, where the slant goes). The only written forms are the legacy `H/` (en route
Block 4, and the NAS flight plan) and the ICAO `type/WTC` (JO 7360.1K ¶2-6).

### Answer in plain words

- Terminal strips (ours are terminal: TBL 2-3-3/4/5) carry **count, wake category indicator, type designator, equipment
  suffix** in that order. Since Chg 2 the terminal wake reference is the **CWT category A–I**; en route still uses the
  legacy **`H/`** heavy (and super) indicator.
- **Format of the terminal indicator: silent — the human decides.** **Inference** from the legacy form (`H/` before the
  type, `/` before the suffix): `2/H/B763/L` (legacy) or, with a CWT letter in the same slot, `2/C/B763/L`, `G/F16/P`;
  with no indicator `F16/P`, `2/F16/P` (no leading slant).
- The type is a JO 7360.1 designator (2–4 characters, letter first, e.g. `F16`, `K35R`, `B763`); the suffix is one letter
  from TBL 2-3-10.
- The human's `M/F16` is an **ICAO WTC** written in front (ICAO writes it after: `F16/M`). An F-16 is ICAO "Medium",
  FAA class "Large", CWT "G" (JO 7360.1K). Our `identity.wakeCategory` today comes from the DD-1801's ICAO WTC
  (`flight-plan-lookup.js`: `plan.wtc`), i.e. L/M/H/J — not the letter the current terminal Block 3 means.

### What it means for LT-STRIP-FIELDS

Block 3 is one field parsed as `[count/][indicator/]TYPE[/suffix]`: count = digits, type = a 7360.1-shaped designator,
suffix = one TBL 2-3-10 letter, no leading `/` when there is no indicator. Which indicator set to accept is a human
question (LT-RQ1 below). Where the value comes from (DD-1801 ICAO WTC vs a CWT lookup by type) follows the choice; a CWT
letter could be derived from the type designator by a small table from JO 7360.1K (ours to maintain), which also removes
the need to type it. A designator-shape check is safe to build now (¶2-3-6).

---

## Q5 (T8) — the FAA strip block lists, and our labels mapped to them

### The FAA block lists (JO 7110.65BB, Basic with Chg 3)

**TBL 2-3-3, terminal ARRIVAL** (¶2-3-4 a; *"Facility managers can authorize omissions and/or optional use of spaces 2A,
8A, 8B, 9A, 9B, 9C, and 10-18"*):

| Block | Information recorded (verbatim) |
|---|---|
| 1 | Aircraft identification. |
| 2 | Revision number (FDIO locations only). |
| 2A | Strip request originator. (At FDIO locations this indicates the sector or position that requested a strip be printed.) |
| 3 | Number of aircraft if more than one, wake category indicator, type of aircraft, and aircraft equipment suffix. |
| 4 | Computer identification number if required. |
| 5 | Secondary radar (beacon) code assigned. |
| 6 | (FDIO Locations.) The previous fix will be printed. (Non-FDIO Locations.) Use of the inbound airway. … |
| 7 | Coordination fix. |
| 8 | Estimated time of arrival at the coordination fix or destination airport. |
| 8A | OPTIONAL USE. |
| 8B | OPTIONAL USE, when voice recorders are operational; REQUIRED USE, when the voice recorders are not operating … record reported RA events … |
| 9 | Altitude (in hundreds of feet) and remarks. |
| 9A | Minimum fuel, destination airport/point out/radar vector/speed adjustment information. Air traffic managers may authorize … the omission of any of these items, except minimum fuel … |
| 9B, 9C | OPTIONAL USE. |
| 10-18 | Enter data as specified by a facility directive. Radar facility personnel need not enter data in these spaces except when nonradar procedures are used or when radio recording equipment is inoperative. |

**TBL 2-3-4, terminal DEPARTURE** (¶2-3-4 b): Blocks 1, 2, 2A, 3, 4, 5 as above, then:

| Block | Information recorded (verbatim) |
|---|---|
| 6 | Proposed departure time. |
| 7 | Requested altitude. |
| 8 | Departure airport. |
| 8A | OPTIONAL USE. |
| 8B | OPTIONAL USE / REQUIRED USE (RA events), as arrivals. |
| 9 | Computer-generated: Route, destination, and remarks. Manually enter altitude/altitude restrictions in the order flown, if appropriate, and remarks. / Hand-prepared: Clearance limit, route, altitude/altitude restrictions in the order flown, if appropriate, and remarks. |
| 9A, 9B, 9C | OPTIONAL USE. |
| 10-18 | Enter data as specified by a facility directive. Items, such as departure time, runway used for takeoff, check marks to indicate information forwarded or relayed, may be entered in these spaces. |

**TBL 2-3-5, terminal OVERFLIGHT** (¶2-3-4 c): Blocks 1, 2, 2A, 3, 4, 5 as above, then:

| Block | Information recorded (verbatim) |
|---|---|
| 6 | Coordination fix. |
| 7 | Overflight coordination indicator (FDIO locations only). NOTE- … identifies the facility to which flight data has been forwarded. |
| 8 | Estimated time of arrival at the coordination fix. |
| 8A / 8B | OPTIONAL USE / RA events, as arrivals. |
| 9 | Altitude and route of flight through the terminal area. |
| 9A, 9B, 9C | OPTIONAL USE. |
| 10-18 | Enter data as specified by a facility directive. NOTE- National standardization of items (10 through 18) is not practical … |

**TBL 2-3-1, EN ROUTE** (¶2-3-2), for the blocks we resemble: 3 Aircraft identification; 4 (count, `H/`, type, suffix);
5 Filed true airspeed; 14 actual time over previous fix / actual departure time; 19 *"Fix. For departing aircraft, add
proposed departure time."*; 20 *"Altitude information (in hundreds of feet)"*; 24 *"Requested altitude."*; 25 *"Point
of origin, route as required for control and data relay, and destination."*; 26 *"Pertinent remarks, minimum fuel,
point out/radar vector/speed adjustment information …"*; 27 *"Mode 3/A beacon code if applicable."*; 28
*"Miscellaneous control data (expected further clearance time, time cleared for approach, etc.)"*; 29-30 *"Transfer of
control data and coordination indicators."* **Our Blocks 19–24 are not the en route ones**: the numbers coincide, the
meanings do not (e.g. en route 20 = altitude, ours 20 = heading; en route 24 = requested altitude, ours 24 = miles-in-trail).

### FAA abbreviations available (quoted sources)

- **ACID** — aircraft identification (¶2-3-5 b: *"aircraft identifications (ACIDs)"*).
- **P TIME** — P/CG *"P TIME- (See PROPOSED DEPARTURE TIME.)"*; *"PROPOSED DEPARTURE TIME- The time that the aircraft
  expects to become airborne."* JO 7210.3EE Field 07: *"the letter "P" followed by a four-digit time group (in UTC)"*.
- **ETA** (TBL 1-2-1 *"Estimated time of arrival"*), **APREQ** (*"Approval Request"*), **EDCT** (*"Expect Departure
  Clearance Time"*), **CFR** (*"Call for Release"*; note TBL 1-2-1 also uses CFR for *"Code of Federal Regulations"*),
  **ATIS**, **MTR**, **MARSA**, **SFA**, **PAR**, **FL**, **CA** (*"Conflict Alert"*), **VCI** (*"Voice Communication
  Indicator"*, the ERAM indicator of ¶2-1-17 d — not our 2A), all from JO 7110.65BB TBL 1-2-1.
- **Clearance/strip abbreviations** TBL 2-3-11 (e.g. `L` cleared to land, `CAF` cleared as filed, `PD` pilot's
  discretion) and TBL 2-3-12 (e.g. `PA` precision approach, `SA` surveillance approach, `MA` missed approach, `RH`
  runway heading, `TL`/`TR` turn left/right).
- **Time format:** nothing in Chapter 2 Section 3 prescribes HHMM for a terminal block, but the FAA writes times as
  four-digit UTC everywhere it specifies one (8B RA events *"the time (hhmm)"*; 7210.3 Field 07). So "HHMM" in a
  placeholder/tooltip is FAA-consistent (T31 a).

## Q5 table — our Blocks → FAA names (for the human's approval)

Rules applied: label = the FAA block name, abbreviated only by an FAA abbreviation or the obvious shortening the FAA
itself uses in the block text; **≤ 8 characters and unique per strip type** (our test, ADR 0055); the tooltip is the
full FAA wording with the block number and table. **ours** = no FAA block carries it (or the FAA space is "optional use" /
"facility directive"), named plainly and marked "(ours)" in the tooltip. **#≠** = we use the FAA's name but under a
different block number than the FAA (renumbering is not proposed — ids are wire/state keys — but the tooltip says so).

### DEPARTURE (FAA TBL 2-3-4)

| Our id | Our label | FAA | FAA name | Proposed label | Tooltip (draft) |
|---|---|---|---|---|---|
| 1 | CALLSIGN | 1 | Aircraft identification | **ACID** | Block 1, aircraft identification |
| 2 | REV | 2 | Revision number | REV | Block 2, revision number |
| 2A | VOICE | (2A = strip request originator) | — | VOICE | Voice clearance issued (ours; FAA 2A is "strip request originator") |
| 3 | TYPE | 3 | Number, wake category indicator, type, equipment suffix | TYPE | Block 3, number of aircraft, wake category indicator, type of aircraft, equipment suffix |
| 3A | ACFT | 3 (part) | type of aircraft (¶2-3-6, JO 7360.1 designator) | ACFT TYP | Aircraft type designator (Block 3) |
| 3B | WAKE | 3 (part) | wake category indicator | WAKE | Wake category indicator (Block 3) |
| 3C | TAIL | — | — | TAIL | Tail number (ours) |
| 3D | UNIT | — | — | UNIT | Unit (ours) |
| 3E | HOME | — | — | HOME STN | Home station / base (ours, military) |
| 3F | HOOK | — | — | HOOK | Tailhook required (ours, military) |
| 3G | ORDNANCE | — | — | ORDNANCE | Ordnance state (ours, military) |
| 4 | CID | 4 | Computer identification number | CID | Block 4, computer identification number |
| 4A | RMV | — | — | RMV | Remove indicator (ours) |
| 4B | DATALINK | — | — | DATALINK | Datalink clearance indicator (ours) |
| 5 | BEACON | 5 | Secondary radar (beacon) code assigned | BEACON | Block 5, beacon code assigned |
| 5A | DEGR | — | — | TRK DEGR | Track degradation flag (ours) |
| 6 | PROP DEP | 6 | Proposed departure time | **P TIME** | Block 6, proposed departure time (P time), UTC HHMM |
| 7 | CRUS ALT | 7 | Requested altitude | **REQ ALT** | Block 7, requested altitude |
| 8 | DEP | 8 | Departure airport | **DEP APT** | Block 8, departure airport |
| 8A | RWY | (8A optional use) | — | DEP RWY | Departure runway (ours, in the FAA's optional space 8A) |
| 8B | DEST | (in Block 9) | destination (part of Block 9) | DEST | Destination (FAA: part of Block 9; ours as its own cell) |
| 9 | RTE | 9 | Route, destination, and remarks | ROUTE | Block 9, route (computer-generated) and manual altitude restrictions |
| 9A/9B/9C | FAC A/B/C | 9A/9B/9C | Optional use | FAC A/B/C | Block 9A/9B/9C, optional use (facility) |
| 9D | FULL RTE | — | — | FULL RTE | Full route clearance (ours) |
| 9E | RMKS | 9 (part) | remarks | RMKS | Remarks (Block 9) |
| 9F | STEREO | — | — | STEREO | Stereo route (ours, local tower-en-route canned route) |
| 9G-*/9H-* | MTR, ENTRY, ENTRY TM, EXIT, EXIT EST, EXIT ALT | — | — | unchanged | MTR fields (ours, military) |
| 9A-SPEED | SPEED | (9A on arrivals: speed adjustment) | — | SPEED | Speed assignment (ours on a departure) |
| 10 | ATIS | 10-18 (facility directive) | — | ATIS | ATIS code (ours, facility-directive space 10-18) |
| 11 | APREQ | 10-18 | — | APREQ | Approval request (APREQ) (ours, space 10-18) |
| 14 | RLS TIME | 10-18 | — | RLS TIME | Release time, UTC HHMM (P/CG RELEASE TIME; space 10-18) |
| 14A | RELEASE | 10-18 | — | RELEASE | Departure release state (ours) |
| 14D | VOID | 10-18 | — | VOID | Clearance void time, UTC HHMM (P/CG CLEARANCE VOID IF NOT OFF BY) |
| 14B | EDCT | 10-18 | — | EDCT | Expect departure clearance time, UTC HHMM |
| 14C | CFR | 10-18 | — | CFR | Call for release time, UTC HHMM |
| 14E | ALERT | — | — | ALERT | Alert status (ours, military) |
| 16 | MVMT | 10-18 | — | MVMT | Movement-area entry time, UTC HHMM (ours) |
| 17 | TAXI | 10-18 | — | TAXI | Taxi time, UTC HHMM (ours) |
| 18 | TAKEOFF | 10-18 ("departure time") | departure time | **DEP TIME** | Departure (takeoff) time, UTC HHMM (space 10-18) |
| 19 | GATE | — | — | GATE | Gate / parking (ours) |
| 20 | HDG | — (en route 20 = altitude) | — | HDG | Assigned heading (ours; not en route Block 20) |
| 21 | ALT | — | — | ALT | Assigned altitude (ours) |
| 22 | FREQ | — | — | FREQ | Frequency (ours) |
| 23 | FAC RMKS | — | — | FAC RMKS | Facility remarks (ours) |
| 24 | MIT RMKS | — (en route 24 = requested alt) | — | MIT | Miles-in-trail (P/CG MILES-IN-TRAIL; ours as a block) |
| 24A | ARSPC | — | — | ARSPC | Airspace owner (ours) |
| IFR, RSVC, SREG | KEEP IFR, RADAR, SEP REG | — | — | unchanged | TOFI fields (ours) |
| 25 | STATE | — | — | STATE | Strip state (ours) |
| 26 | NLA | — | — | NLA | Next logical action (ours) |

### ARRIVAL (FAA TBL 2-3-3) — rows that differ from DEPARTURE

| Our id | Our label | FAA | FAA name | Proposed label | Tooltip (draft) |
|---|---|---|---|---|---|
| 6 | ETA | **8** (#≠) | Estimated time of arrival at the coordination fix or destination airport | ETA | ETA at coordination fix or destination, UTC HHMM (FAA Block 8) |
| 7 | ALT | **9** (#≠) | Altitude and remarks | ALT | Assigned altitude (FAA Block 9) |
| 8 | ORIG | — | (en route 25: point of origin) | ORIGIN | Point of origin (ours on a terminal arrival) |
| 8A | FIX | **7** (#≠) | Coordination fix | COORD FX | Coordination fix (FAA Block 7) |
| 8B | RWY | (8B = RA events / optional) | — | LDG RWY | Landing runway (ours) |
| 9 | RTE | — (FAA arrival 9 = altitude and remarks) | — | ROUTE | Route (ours on an arrival) |
| 9A-FUEL | MIN FUEL | 9A | Minimum fuel | MIN FUEL | Block 9A, minimum fuel |
| 9A-DEST | DEST | 9A | destination airport | DEST | Block 9A, destination airport |
| 9A-PTOUT | PT OUT | 9A | point out | PT OUT | Block 9A, point out |
| 9A-VECTOR | HDG | 9A | radar vector | HDG | Block 9A, radar vector (assigned heading) |
| 9A-SPEED | SPEED | 9A | speed adjustment | SPEED | Block 9A, speed adjustment |
| 20, 21 | SCRATCH1/2 | — | — | SCRATCH1/2 | Scratchpad (ours) |
| — | — | **6** | Previous fix / inbound airway | (missing) | we have no cell |

### OVERFLIGHT (FAA TBL 2-3-5) — rows that differ

| Our id | Our label | FAA | FAA name | Proposed label | Tooltip (draft) |
|---|---|---|---|---|---|
| 7 | CRUS ALT | — (FAA 7 = overflight coordination indicator; en route 24 = requested altitude) | requested altitude | REQ ALT | Requested altitude (en route Block 24; FAA terminal Block 7 is the coordination indicator) |
| 7A | ALT | **9** (#≠) | Altitude and route of flight through the terminal area | ALT | Assigned altitude (FAA Block 9) |
| 8 | ORIG | — | (en route 25) | ORIGIN | Point of origin (ours) |
| 8B | DEST | — | (en route 25) | DEST | Destination (ours) |
| 9 | RTE | 9 | route of flight through the terminal area | ROUTE | Block 9, route through the terminal area |
| 9A-VECTOR, 9A-SPEED | HDG, SPEED | (9A optional on overflights) | — | HDG, SPEED | ours |
| — | — | **6**, **8** | Coordination fix; ETA at the coordination fix | (missing) | we have no cells |

### MISSION, MARSHAL, FINAL, PATTERN

No FAA flight progress strip exists for these (MISSION is the MRU/ATO record; MARSHAL/FINAL/PATTERN are the carrier's
and the Incirlik pattern board's, CV NATOPS/CATCC and AETCI 11-204 territory, not FAA). All **ours**; labels unchanged
except where Q2/Q3 change what FINAL shows. Tooltips say "(ours)".

---

## Q6 (T16, T17, T18) — air refueling and MARSA

### What the orders say

**JO 7110.65BB ¶2-1-11, USE OF MARSA:** *"a. MARSA may only be applied to military operations specified in a letter of
agreement or other appropriate FAA or military document."* … *"b. ATC facilities do not invoke or deny MARSA. Their sole
responsibility concerning the use of MARSA is to provide separation between military aircraft engaged in MARSA operations
and other nonparticipating IFR aircraft."* P/CG MARSA: *"A condition whereby the military services involved assume
responsibility for separation between participating military aircraft in the ATC system."*

**JO 7110.65BB ¶9-2-13, MILITARY AERIAL REFUELING:**
> Authorize aircraft to conduct aerial refueling along published or special tracks at their flight plan altitudes, unless
> otherwise requested. PHRASEOLOGY- CLEARED TO CONDUCT REFUELING ALONG (number) TRACK, or FROM (fix) TO (fix), and
> **MAINTAIN BLOCK (altitude) THROUGH (altitude)**, or COMMENCING AT (altitude), DESCENDING TO (altitude).
> NOTE- a. During aerial refueling, tanker aircraft are responsible for receiver aircraft communication with ATC and for
> their navigation along the track. b. Aerial refueling airspace is not sterilized airspace … c. **MARSA begins between
> the tanker and receiver when the tanker and receiver(s) have entered the air refueling airspace and the tanker advises
> ATC that he/she is accepting MARSA.** d. **MARSA ends between the tanker and receiver when the tanker advises ATC that
> the tanker and receiver aircraft are vertically positioned within the air refueling airspace and ATC advises MARSA is
> terminated.**
> a. Provide radar assistance to the rendezvous for participating aircraft: 1. When requested, and 2. **By providing
> vertical separation prior to MARSA declaration.**
> b. Do not request receiver aircraft that have been cleared to conduct air refueling and have departed the ARIP to: 1.
> Make code changes when less than 5 miles from the tanker. 2. Squawk standby when less than 1 mile or more than 3 miles
> from the tanker.
> c. … you may request a receiver to squawk standby when the receiver reaches a point 3 miles from the tanker. NOTE- 1.
> Receiver aircraft will squawk normal when separation from the tanker is greater than 3 miles. 2. **Once rendezvous is
> completed, heading and altitude assignments may be made with the tanker concurrence with MARSA remaining in effect.**
> 3. Upon rendezvous completion, the tanker must keep receiver aircraft within 3 miles of the tanker until MARSA is
> terminated.
> d. **After MARSA has been declared, you should avoid issuing course or altitude changes prior to rendezvous.** NOTE-
> **Altitude or course changes issued will automatically void MARSA.**
> e. Do not use the altitude vacated during the refueling operation until the refueling aircraft has reported reaching the
> next IFR altitude.

**JO 7610.14A ¶5-5-3, MARSA APPLICABILITY FOR AERIAL REFUELING:**
> a. MARSA begins between the tanker and receiver(s) when the tanker advises ATC that it is accepting MARSA.
> b. After MARSA has been declared, controller assigned course or altitude changes prior to rendezvous completion will
> automatically void MARSA and are to be avoided.
> c. Once rendezvous is completed: 1. Headings and altitudes assignments may be made with the tanker concurrence with
> MARSA remaining in effect. 2. **Each tanker must keep receiver(s) aircraft in either standard or nonstandard formation
> until further ATC clearances are received and approved separation is achieved.** 3. Other nonparticipating aircraft may
> be cleared through the refueling block airspace with approved separation once the tanker and receiver(s) have proceeded
> down track.
> d. MARSA ends between the tanker and receiver(s) when: 1. The tanker and receiver aircraft are vertically separated
> within the aerial refueling airspace, 2. Approved separation is established, and 3. ATC advises MARSA is terminated.

**JO 7610.14A ¶5-1-6 a (chronology, track):** *"4. Receivers are cleared to requested altitude and approved separation is
established prior to ARIP and release to tanker communication rendezvous (C/R) frequency. 5. Tanker declares MARSA. 6.
ATC releases receiver to tanker C/R frequency not later than the ARIP. 7. ATC issues clearance to conduct aerial
refueling along the track, and issues block altitude clearance, if not previously accomplished. NOTE- MARSA needs to be
declared prior to ATC issuing a clearance to conduct air refueling. … 9. Tanker and receiver aircraft complete rendezvous
and proceed down track. During aerial refueling, the tanker is responsible for receiver aircraft navigation along the
track and for all tanker/receiver communications with ATC. … 12. Prior to exit, tanker vertically positions **the
aircraft in the formation** within the air refueling airspace to facilitate breakup at the exit point (normally, tanker at
highest altitude of aerial refueling block and receiver at lowest altitude). 13. MARSA is terminated when approved
separation is established and ATC advises MARSA is terminated."*

**JO 7610.14A ¶5-5-6 a:** *"All aircraft require 1,000 feet separation between the lowest tanker altitude and the
applicable receiver altitude from the track ARIP to ARCP or from the ARIP to anchor point. If this altitude separation
cannot be provided, the participating aircraft are not authorized to proceed with the rendezvous."* ¶5-5-1 d: *"All
aircraft conducting aerial refueling operations should request and be assigned at least three (3) consecutive
altitudes/flight levels."* ¶5-5-1 a.2: *"Throughout the aerial refueling operation, controller-initiated heading
assignments may not be effected without the concurrence of the tanker."*

**¶5-5-7 d–e** (tanker): *"Receiver navigation, regardless of the number of receivers, after rendezvous completion through
completion of refueling operations …"*; *"All communications during aerial refueling operations, including those
concerning the receivers, must be between the ATC facility or military radar unit and tanker."* **¶5-5-8 c** (receiver):
*"Maintaining two-way radio contact with ATC until released by ATC to the tanker."* **¶5-5-10:** *"Radar vector assistance
for rendezvous may be given … when appropriate altitude separation is provided. Assistance must be terminated when the
receiver has visual contact with the tanker."* **¶5-5-11 a–b:** *"Approved separation is maintained until MARSA is
declared by the tanker."* / *"After MARSA is declared, receiver aircraft are released to tanker C/R frequency departing the
ARIP …"*; f–g: an ATC clearance / *"en route altitude assignment is issued for each aircraft or formation flight exiting"*.

**JO 7610.14A ¶7-3-9, AERIAL REFUELING FORMATION:** *"Aerial refueling formations are always nonstandard and require
additional airspace over a nonstandard cell formation …"*

**JO 7110.65BB ¶2-1-13, FORMATION FLIGHTS:** *"Control formation flights as a single aircraft. Separation responsibility
between aircraft within the formation rests with the flight leader and the pilots of the other aircraft in the flight.
This includes transition periods … during join-up and breakaway."* a. join-up supported when *"1. Requested by any
participating pilot. 2. All participating pilots concur. 3. Either of the participating pilots reports the other/s in
sight."* c. *"1. For a standard formation only the aircraft acting as the lead will squawk an ATC assigned beacon code …
2. For a nonstandard formation, each aircraft should squawk an ATC assigned beacon code."* **P/CG FORMATION FLIGHT:**
*"More than one aircraft which, by prior arrangement between the pilots, operate as a single aircraft with regard to
navigation and position reporting."* a. standard: *"no more than 1 mile laterally or longitudinally and within 100 feet
vertically from the flight leader"*; b. nonstandard: other dimensions approved by ATC, an ALTRV/LOA, or *"airspace
specifically designed for a special activity"*.

### Answer in plain words

1. **Before MARSA:** ATC separates tanker and receiver **vertically** (¶9-2-13 a.2; 7610.14A ¶5-5-11 a), at least
   **1,000 ft** between the tanker's lowest altitude and the receiver's altitude from ARIP to ARCP (¶5-5-6 a). ATC may
   vector the receiver to the rendezvous on request and stops when the receiver sees the tanker (¶5-5-10).
2. **MARSA begins** when the **tanker tells ATC it accepts MARSA** (¶9-2-13 NOTE c; ¶5-5-3 a), in the AR airspace. From
   then the military, not ATC, separates tanker and receiver. ATC releases the receiver to the tanker's frequency no later
   than the ARIP (¶5-1-6 a.6; ¶5-5-11 b) and clears the AR **block** ("MAINTAIN BLOCK … THROUGH …").
3. **Between MARSA and rendezvous**, ATC course/altitude changes **void MARSA** and are to be avoided (¶9-2-13 d; ¶5-5-3 b).
   The receiver's closing on the tanker, including the climb to it, is the participants' business under MARSA.
4. **After rendezvous**, tanker and receivers are **in formation** — the order says so in so many words: the tanker must
   keep receivers *"in either standard or nonstandard formation"* (¶5-5-3 c.2), the chronology calls them *"the
   formation"* (¶5-1-6 a.12), and 7610.14A ¶7-3-9 says AR formations *"are always nonstandard"*. The tanker navigates
   for and talks for the receivers; ATC assigns headings/altitudes only with tanker concurrence, MARSA remaining
   (¶9-2-13 c NOTE 2).
5. **MARSA ends** when the tanker reports the aircraft vertically positioned (separated) in the AR airspace **and ATC
   says MARSA is terminated** (¶9-2-13 NOTE d; ¶5-5-3 d); each aircraft or formation then gets its own exit clearance and
   altitude (¶5-5-11 f–g).
6. **Is it a "formation join" in the ¶2-1-13 sense?** The orders treat the post-rendezvous AR cell as a (nonstandard)
   formation for navigation, comms and the airspace it needs, but they **never merge the aircraft's flight plans**: each
   aircraft keeps its identity and code (receivers squawk normal beyond 3 mi, ¶9-2-13 c NOTE 1; ¶5-5-8 b), and ATC issues
   exit clearances *"for each aircraft or formation flight"* (¶5-5-11 f–g). The ¶2-1-13 a join-up procedure (pilots
   request, ATC supports) is **not** the AR procedure; AR runs on MARSA declared by the tanker. **Inference:** the
   human's description is right — not an app "Join" that voids the receiver's plan; it is MARSA with the tanker, and for
   separation purposes the pair is one nonstandard formation until MARSA ends.
7. **"1 NM behind and 1,000–2,000 ft below":** the FAA orders give the **1,000 ft** (¶5-5-6 a) and the rendezvous
   geometry is in the figures (7610.14A FIG 5-5-1/5-5-2, en route cell rendezvous, drawings not read as text). The
   **1 NM** in-trail position is **not** in the FAA text read here — **inference:** it is the military AR manual's
   rendezvous geometry (ATP-3.3.4.2 / T.O. 1-1C-1; not available, not read).

### What it means for LT-MARSA

- **T17 (LEVEL_BUST on the receiver):** once the tanker has declared MARSA, the receiver's ATC altitude is not a single
  altitude to hold — ATC either cleared the AR block or avoids altitude changes; the climb to the tanker is under MARSA.
  So: **no altitude/heading conformance for a receiver (or tanker) between MARSA declared and MARSA terminated**, or,
  if we model the AR block, conformance against the **block** only. ATC-issued course/altitude changes before rendezvous
  are what **void** MARSA (we already model that interlock, ADR 0051) — that is the FAA rule, keep it.
- **T18:** MARSA with the tanker, **not** a formation Join (receiver keeps its flight plan and Strip). For conflict
  alerting (Q7) and for the airspace/separation picture, treat tanker + receivers as one nonstandard formation while
  MARSA lasts. MARSA ends only by an explicit ATC "MARSA terminated" after the tanker reports the aircraft vertically
  separated.
- **T14 (how long the "MARSA voided" notice stays):** the orders say an ATC course/altitude change voids MARSA
  automatically (¶9-2-13 d NOTE) but say **nothing about a display or notice — silent, the human decides** (recommended:
  shown until acknowledged by a controller who holds either Strip, then gone; dark cockpit).

---

## Q7 (T16) — conflict alert between aircraft of one formation

### What the orders say

**JO 7110.65BB ¶2-1-13:** *"Control formation flights as a single aircraft. Separation responsibility between aircraft
within the formation rests with the flight leader and the pilots of the other aircraft in the flight."* c.1: *"For a
standard formation only the aircraft acting as the lead will squawk an ATC assigned beacon code. Ensure all other
aircraft squawk standby."* c.2: nonstandard — *"each aircraft should squawk an ATC assigned beacon code"*. ¶9-2-21 c
(nonstandard/cell): *"Control nonstandard formation/cell operations on the basis that MARSA is applicable between the
participating aircraft until they establish approved separation which is acknowledged by ATC."* ¶5-5-8: separation is
applied to the **periphery** of the formation (standard: +1 mile; nonstandard: from the perimeter/outermost aircraft).

**ERAM — JO 7110.65BB ¶5-13-1 c, Suppressing/Inhibiting CA/MCI alert:**
> 1. The controller may suppress the display of a CA/MCI alert from a control position with the application of one of
> the following suppress/inhibit computer functions: (a) The Conflict Suppress (CO) function may be used to suppress the
> CA/MCI display between specific aircraft for a specific alert. … (b) **The Group Suppression (SG) function must be
> applied exclusively to inhibit the displaying of alerts among military aircraft engaged in special military operations
> where standard en route separation criteria does not apply.** NOTE- Special military operations where the SG function
> would typically apply involve those activities where military aircraft routinely operate in proximities to each other
> that are less than standard en route separation criteria; i.e., **air refueling operations**, ADC practice intercept
> operations, etc.
> 2. The computer entry of a message suppressing a CA/MCI alert constitutes acknowledgment for the alert …
> 3. The CA/MCI alert may not be suppressed or inhibited at or for another control position without being coordinated.

**STARS (terminal) — JO 7110.65BB ¶5-14-6 c:** *"1. The suppress function may be used to suppress the display of a
specific CA/MCI alert. 2. The inhibit function must only be used to inhibit the display of CA for aircraft routinely
engaged in operations where approved separation criteria do not apply. NOTE- Examples … are ADC practice intercept
operations and air shows. … 4. CA/MCI alert may not be suppressed or inhibited at or for another control position without
being coordinated."* JO 7210.3EE ¶12-6-7 b (STARS): *"Facility air traffic managers are authorized to inhibit CA at
specific operating positions if an operational advantage is gained."*; ¶8-2-4 b (ERAM): inhibit CA at specified sectors
and within ERAM Aircraft Alert Volumes.

### Answer in plain words

- **No FAA rule or documented system behaviour automatically exempts formation members from conflict alert.** What the
  FAA has is (1) the standard formation's wingmen squawk **standby** (¶2-1-13 c.1), so the automation tracks one beacon
  target and there is no pair to alert on (**inference** from how CA works on tracked targets with altitude; the orders
  do not describe CA's logic); (2) for nonstandard formations, AR and similar MARSA operations, the **controller**
  inhibits the alerts among the participants — ERAM's **Group Suppression (SG)**, STARS's **inhibit** — and these are
  meant exactly for "aircraft … where approved separation criteria do not apply", with air refueling the named example.
- So the FAA behaviour is "**the participants are not alerted against each other once the controller has grouped
  them**", and the controller's act is an acknowledgment (¶5-13-1 c.2). Alerts between a formation (any member) and
  **non-participants** stay.

### What it means for LT-MARSA

Build the effect of a standing group suppression: **no conflict alert between members of one formation** (our Joined
formation = ¶2-1-13 "single aircraft"), and **none between MARSA participants** (tanker/receivers) while MARSA lasts —
our formation record and our MARSA record are the "grouping" the FAA controller enters by hand. Alerts against everyone
else continue, measured from each member (the ¶5-5-8 periphery idea). Whether a controller should also be able to
suppress one specific alert by hand (the FAA "CO"/suppress) is **silent for our design — the human decides**; it is not
needed for T16. **Which pairs CA processes at all** (tracked vs untracked, MCI) is Q12 below; the formation/MARSA
exclusions here apply on top of that eligibility.

---

## Q8 (T27) — controlling agency vs using agency for special use airspace

### What the orders say

**JO 7400.2R ¶21-1-10, CONTROLLING AGENCY:** *"The controlling agency is the FAA ATC facility that exercises control of
the airspace when a SUA area is not activated. A military ATC facility may be assigned as the controlling agency,
subject to the concurrence of the Service Center OSG and the concerned ARTCC. A controlling agency must be designated
for each joint-use SUA area."*

**JO 7400.2R ¶21-1-11, USING AGENCY:**
> a. The using agency is the organization, or military command/unit whose activity established the requirement for the
> SUA. The using agency is responsible for ensuring that: 1. The airspace is used only for its designated purpose. 2.
> **Scheduling procedures are established, utilized, and captured in an LOA/LOP.** 3. **The controlling agency is kept
> informed of changes in scheduled activity, to include the completion of activities for the day.** 4. A point of
> contact is made available to enable the controlling agency to verify schedules, and coordinate access for emergencies,
> weather diversions, etc. …
> c. An ATC facility may be designated as the using agency for joint-use areas when that facility has been granted
> priority for use of the airspace in a joint-use LOA/LOP.

**JO 7400.2R ¶21-1-5, SUA APPROVAL AUTHORITY:** *"FAA Headquarters is the final approval authority for all permanent and
temporary SUA, except CFAs. … The Service Center OSG must forward SUA proposals recommended for approval (except CFA)
to FAA Headquarters for a final determination."* ¶25-1-3: *"Either the proponent or the Service Center OSG selects MOA
names."* ¶25-1-7 a: temporary MOAs *"may be established for a period not to exceed 45 days"* (approved, not
self-created). ¶21-1-6: when no longer needed *"the using agency … must inform the Service Center OSG that action may
be initiated to remove and return the SUA airspace to the NAS."*

**JO 7400.2R ¶21-1-8, JOINT-USE POLICY:** *"a. SUA must be returned to the controlling agency and become available for
access by nonparticipating aircraft during periods when the airspace is not needed by the using agency …"* *"d.
Joint-use procedures must be specified in a joint-use Letter of Agreement (LOA) or Letter of Procedure (LOP) between the
using agency and the controlling agency. These letters should include provisions for the real-time
activation/deactivation of the airspace and timely notification to the controlling agency when the scheduled activity
has changed, been canceled, or was completed for the day."* **¶25-1-6** (MOA): *"a. In effect, MOAs are always joint
use … IFR aircraft may be routed through the airspace, by agreement between controlling and using agencies, when approved
separation can be provided from the MOA activity. b. Procedures for access to the airspace by nonparticipating IFR
traffic must be specified in a letter of agreement between the controlling and using agencies."*

**14 CFR 73.15/73.17** (restricted areas, reprinted in JO 7400.10H App. A): *"c. The using agency shall: (1) Schedule
activities within the restricted area; (2) Authorize transit through, or flight within, the restricted area as feasible;
…"*; *"the controlling agency is the FAA facility that may authorize transit through or flight within a restricted area in
accordance with a joint-use letter issued under § 73.15."* JO 7400.10H lists each area with both, e.g. *"Controlling
agency. FAA, Atlanta ARTCC. Using agency. Alabama Army National Guard."*

**JO 7110.65BB ¶9-3-1** (ATC around SUA): the SUA separation rules do not apply when *"a. The pilot informs you that
permission has been obtained from the using agency to operate in the airspace. b. The using agency informs you they
have given permission for the aircraft to operate in the airspace. … c. The restricted/warning area, MOA, ATCAA, or
stationary ALTRV has been released to the controlling agency."* ¶9-3-4: in an active area, *"Comply with the
instruction/clearances issued by the Using Agency"*. ¶2-1-11 c: *"DoD must ensure that military pilots requesting special
use airspace/ATCAAs have coordinated with the scheduling agency, have obtained approval for entry … ATC is not responsible
for determining which military aircraft are authorized to enter special use airspace/ATCAAs."* JO 7610.14A ¶5-5-11 i
mentions SAMS (Special Use Airspace Management System) for activity approval; JO 7110.65BB ¶13-1-17 b NOTE: *"activating or
scheduling the SAA in the Airspace Status View does NOT constitute coordination for activation of airspace"* unless an
LOA/facility directive says so.

### Answer in plain words

| Act | Who, per the orders |
|---|---|
| **Create** (establish/define) a MOA | **Neither agency on its own**: a proponent (normally the using agency) proposes; the FAA Service Center OSG and FAA HQ approve (7400.2R ¶21-1-5). The controlling and using agencies are named **in** the designation. |
| **Schedule** it | **Using agency** (¶21-1-11 a.2; 14 CFR 73.15 c(1)), keeping the controlling agency informed (a.3). |
| **Activate / deactivate** in real time | As the **joint-use LOA** says between the two (¶21-1-8 d); typically the using agency notifies, the controlling agency's automation status is updated (ERAM: the sector team or supervisor updates the Airspace Status View, ¶13-1-17, JO 7210.3EE ¶6-6-2). |
| **Release** it | The using agency returns it to the **controlling agency** when not needed (¶21-1-8 a; ¶9-3-1 c). |
| **Authorize entry** into the active area | The **using agency** (¶9-3-1 a–b; 73.15 c(2)); ATC applies ¶9-3-2 separation from the area for everyone else. |
| **Control the airspace when not active** | The **controlling agency** (¶21-1-10). |

So the using agency (e.g. Incirlik OPS for a training MOA) **books/schedules, activates per LOA, grants entry and
releases**; the controlling agency (CENTER) controls the airspace when it is not active and must be kept informed. **Who
may create the airspace record in our app is outside the orders** (they describe a rulemaking/approval process, not a
live tool): **silent — the human decides.**

### What it means for LT-AIRSPACE-ALERT (T27 rights)

The FAA split suggests: **definition** (create/edit/delete the MOA's shape and limits) belongs to whoever stands in for the
FAA approval (in our facility model the controlling Facility, or a squadron "airspace manager" role — human decision);
**schedule/activate/release** are the using agency's (OPS), with the controlling Position informed; **entry approval** is
the using agency's. Today the server lets "the controlling Position, or OPS of the controlling Facility" create; under
the FAA split, Incirlik OPS as **using agency** should be able to **book, activate, release and approve entry** for a
CENTER-controlled MOA but not redefine it. Options in LT-RQ4 below.

---

## Q9 (T29) — FAA automation that alerts on aircraft vs active SUA/SAA

### What the orders say

**P/CG:** *"AIRSPACE CONFLICT- Predicted conflict of an aircraft and active Special Activity Airspace (SAA)."* *"ALERT- A
notification to a position that there is an aircraft-to-aircraft or aircraft-to-airspace conflict, as detected by
Automated Problem Detection (APD)."* *"AIRCRAFT CONFLICT- Predicted conflict, within EDST of two aircraft, or between
aircraft and airspace. … **A Blue alert is used for conflicts between an aircraft and predefined airspace.**"* *"SPECIAL
ACTIVITY AIRSPACE (SAA)- … includes … ATCAA, ALTRV, MTR, Air Refueling Tracks and Anchors, TFR … Special Use Airspace
(SUA) is a subset of Special Activity Airspace."*

**JO 7110.65BB ¶13-1-1 (ERAM/EDST):** *"EDST uses current plan data, forecast winds, aircraft performance characteristics,
and track data to derive expected aircraft trajectories, and to predict conflicts between aircraft and between aircraft
and special use or designated airspace."* **¶13-1-2:** *"a. Actively scan EDST information for predicted
aircraft-to-aircraft and aircraft-to-airspace alerts. b. When a conflict probe alert is displayed, evaluate the alert and
take appropriate action as early as practical … e. When the Stop Probe feature is activated for an aircraft, conflict
probe for that aircraft must be restarted before transfer of control, unless otherwise coordinated."* **¶13-1-9,
ACKNOWLEDGEMENT OF AUTOMATED NOTIFICATION** exists for EDST notifications. **¶5-13-10:** controllers keep the
*"Airspace Status View/SAA Filter View"* accurate (which SAA is on/off). **¶13-1-17 b NOTE:** activating/scheduling the SAA
in the Airspace Status View does not by itself coordinate activation.

**Terminal (STARS):** JO 7110.65BB ¶5-14 lists CA/MCI, MSAW and ARV alerts; **no aircraft-to-SUA alert** is described.

### Answer in plain words

- **Yes, an FAA equivalent exists, en route only:** ERAM's **EDST conflict probe** raises an **aircraft-to-airspace
  ("Blue") alert** for a **predicted** conflict between an aircraft's trajectory and **active** SAA (which includes SUA).
  It is a **strategic, predictive** probe on the flight plan/trajectory (not a "you are inside now" alarm), the
  controller evaluates it and acts (¶13-1-2), alerts can be acknowledged (¶13-1-9), probing for one aircraft can be
  stopped ("Stop Probe") but must be restarted before transfer (¶13-1-2 e).
- **The orders do not say how the probe treats participating aircraft** (those the using agency approved): **silent**.
  The surrounding rules (¶9-3-1 a–b) make an aircraft with using-agency permission not a nonparticipant, so an alert for
  it would be noise — **inference**.
- **No terminal (STARS) equivalent** in the orders.

### What it means for LT-AIRSPACE-ALERT

H132's alert is **not purely ours**: it is the "aircraft-to-airspace" alert of the FAA's en route conflict probe, with
two differences we should say in the ADR: ours fires on **entry (actual containment)** rather than on a **predicted**
trajectory conflict, and only for **active** airspace (as the FAA's does). Following the FAA: call it an
**airspace conflict** (P/CG term), alert the Position working the flight (the FAA alerts the sector with the flight),
make it acknowledgeable, and **exclude aircraft with using-agency approval** (our `airspaceEntry`/MRU approval = ¶9-3-1
a–b). A predictive look-ahead (warn before entry) would be closer to EDST — **human decides** (LT-RQ5).

---

## Q10 (T4) — which radars present ground vehicles

### What the sources say

- **P/CG, AIRPORT SURVEILLANCE RADAR:** *"Approach control radar used to detect and display an aircraft's position in the
  terminal area."* **AIR ROUTE SURVEILLANCE RADAR:** *"ARTCC radar used primarily to detect and display an aircraft's
  position while en route between terminal areas."* (Both defined by what they are for: aircraft.)
- **P/CG, MOVING TARGET INDICATOR:** *"An electronic device which will permit radar scope presentation only from targets
  which are in motion. A partial remedy for ground clutter."* **GROUND CLUTTER:** *"A pattern produced on the radar scope by
  ground returns … The effect of ground clutter is minimized by the use of moving target indicator (MTI) circuits in the
  radar equipment resulting in a radar presentation which displays only targets which are in motion."*
- **AIM (Basic with Chg 1–3, 7-9-26) ¶4-5-1 b.1(b):** *"… using beacon radar and electronically eliminating stationary and
  slow moving targets by a method called moving target indicator (MTI) usually negate the problem."* (c): *"radar beacon
  and MTI are very effectively used to combat ground clutter … A negative characteristic of MTI is that an aircraft flying
  a speed that coincides with the canceling signal of the MTI (tangential or "blind" speed) may not be displayed …"*
- **P/CG, AIRPORT SURFACE DETECTION EQUIPMENT (ASDE):** *"Surveillance equipment specifically designed to detect aircraft,
  vehicular traffic, and other objects, on the surface of an airport, and to present the image on a tower display."*
  JO 7110.65BB ¶3-6-1 b: *"Use ASDE systems to augment visual observation of aircraft landing or departing, and aircraft
  or vehicular movements on runways and taxiways …"*
- **GCI/AWACS:** FAA orders are silent. USAF E-3 fact sheet (archived copy at gulflink.health.mil; af.mil and tinker.af.mil
  copies return 403): *"The radar combined with an identification friend or foe subsystem can look down to detect …"*
  low-flying aircraft *"… by eliminating ground clutter returns that confuse other radar systems."* (Ground-moving-target
  radars such as JSTARS exist but are a different sensor; nothing read here.)

### Answer in plain words

Air-surveillance radars (ASR, ARSR, and by the fact sheet AWACS) are built to show **aircraft**; their MTI/clutter
processing removes **stationary and slow-moving** returns (AIM ¶4-5-1), which is what ground vehicles mostly are. The FAA
radar that shows vehicles is **ASDE (surface movement radar)**, on the tower display only. **Inference:** a fast vehicle
on a road could still pass MTI on a real ASR; the sources do not say how often, and the ATC orders never treat vehicles
as radar traffic outside ASDE. Military approach radars (RAPCON/GCA ASR/PAR) are covered by the same ASR definition.

### What it means for LT-GROUND

The supervisor's proposal matches the sources: air-surveillance radars do not present ground vehicles (stationary or
slow ones removed by MTI; aircraft on the ground are the separate H6 question). ADR 0121 should cite P/CG MTI / GROUND
CLUTTER and AIM ¶4-5-1, and say that **no ASDE is modelled**. Whether to keep a speed gate (show fast-moving vehicles,
like a real MTI) is **the human's choice** (LT-RQ11); simplest FAA-shaped answer: none.

---

## Q11 (T12) — acquiring a track by its assigned beacon code

### What the orders say

- **JO 7110.65BB ¶5-3-3 d** (EN ROUTE): *"An aircraft may be considered identified when the full data block is
  automatically associated with the target symbol of an aircraft that is squawking a discrete code assigned by the
  computer."*
- **¶5-2-1 b:** *"… issue beacon codes assigned by the computer. … NOTE- The computer will assign only discrete beacon
  codes unless all the discrete codes allocated to a facility are in use."* b.2 NOTE: an ARTCC-computer code *"will cause
  auto-acquisition of the aircraft prior to handoff. When an airborne aircraft that has been assigned a beacon code by the
  ARTCC computer and whose flight plan will terminate in another facility's area cancels ATC service, appropriate action
  should be taken to remove flight plan information on that aircraft."*
- **¶5-3-4 a** (TERMINAL): *"Consider an auto-acquired aircraft as identified when the data block is displayed and is
  visible to you, and … 1. The radar or beacon identification procedures have been used to confirm the identity of the
  tagged target. 2. The aircraft is being handed off using a NAS automated system and one of the following does not appear
  in the data block: "CST", "NAT", "NT", "AMB", "OLD", "AM", or "TRK"."*
- **¶5-4-6 e** NOTE: *"When the beacon code received from the aircraft does not match the computer assigned beacon code,
  the code received (ERAM, MEARTS) or the site-adapted code … (STARS) will be displayed in the data block. When the
  aircraft changes to the computer assigned code, the code is automatically removed from the data block."*
- **JO 7210.3EE ¶12-6-6 a** (STARS): *"Establish automatic acquisition areas for arrivals and overflights …"*, *"for
  departing aircraft 1 mile or less from the runway end"*, *"automatic termination areas for arriving aircraft 1 mile or
  less from the runway threshold …"*.
- ¶5-2-12 a: *"Inform an aircraft with an operable transponder that the assigned beacon code is not being displayed."*

### Answer in plain words

- FAA automation acquires a track by matching the **assigned discrete code** of an **active flight plan** to the code the
  target is squawking, inside an acquisition area; the data block then follows the target. A mismatch shows the
  received code in the data block until the pilot squawks the assigned one.
- **Whether an earlier flight's association blocks the match: silent** — the orders do not describe the tracker's
  internals. What they do say: codes are **discrete** (one flight per code while in use), a flight's data is removed when
  it terminates/cancels (¶5-2-1 b.2 NOTE), and tracks terminate automatically near the arrival runway (7210.3 ¶12-6-6 a.4).
  **Inference:** a dropped/terminated flight holds no code, so it cannot block a new flight assigned that code; two
  *active* flights with the same code would be a duplicate the FAA prevents at assignment, not resolves at correlation.

### What it means for LT-CORRELATION

The beacon rung should match the **assigned code of an active Strip** against the squawked code, with no
"former holder" exclusion from a dropped flight (inference above) — but changing ADR 0076 S-L27 is a supervisor/human
call (the briefing already says ask first; LT-RQ12). Separately, T12's own cause (code source: SRS vs synthetic AI codes,
octal formatting) is a bug to find, not an FAA question; the FAA behaviour to show while unmatched is the received code
in the data block (¶5-4-6 e NOTE), i.e. our `NO TRK` cell could show "squawking 0003, assigned 0003" — useful for the
debug.

---

## Q12 (added 2026-10-12) — which targets FAA Conflict Alert processes

### What the orders say

**P/CG (Basic with Chg 1–3, 7-9-26), CONFLICT ALERT:** *"A function of certain air traffic control automated systems
designed to alert radar controllers to existing or pending situations **between tracked targets (known IFR or VFR
aircraft)** that require his/her immediate attention/action. (See MODE C INTRUDER ALERT.)"*

**P/CG, MODE C INTRUDER ALERT:** *"A function of certain air traffic control automated systems designed to alert radar
controllers to existing or pending situations **between a tracked target (known IFR or VFR aircraft) and an untracked
target (unknown IFR or VFR aircraft)** that requires immediate attention/action."*

**P/CG, ASSOCIATED:** *"A radar target displaying a data block with flight identification and altitude information."*
**UNASSOCIATED:** *"A radar target that does not display a data block with flight identification and altitude
information."*

**JO 7110.65BB ¶2-1-6, SAFETY ALERT:** *"Issue a safety alert to an aircraft if you are aware the aircraft is in a
position/altitude that, in your judgment, places it in unsafe proximity to terrain, obstructions, or other aircraft."*
NOTE b: *"Recognition of situations of unsafe proximity may result from MSAW/E-MSAW, automatic altitude readouts,
Conflict/Mode C Intruder Alert, observations on a PAR scope, or pilot reports."* b. *"Aircraft Conflict/Mode C Intruder
Alert. Immediately issue/initiate an alert to an aircraft if you are aware of another aircraft at an altitude that you
believe places them in unsafe proximity."* P/CG SAFETY ALERT b: *"Aircraft Conflict Alert- A safety alert issued by ATC to
**aircraft under their control** if ATC is aware of an aircraft that is not under their control …"*

**Where CA/MCI now live:** ERAM ¶5-13-1 (CA and MCI alert; suppress CO / group suppress SG, quoted under Q7); STARS
¶5-14-6 (CA/MCI; suppress/inhibit, quoted under Q7). There is no ¶5-15 in the current edition (faa.gov returns 404).

**JO 7210.3EE:** ¶8-2-4 (ERAM CA preset values from the Site Adaptation Manual; CA may be inhibited at sectors and in
Aircraft Alert Volumes); ¶8-2-5 (ERAM MCI: *"b. MCI Alert base altitude must be set at any value between ground level and
5,000 feet MSL …"*, c. temporary raise *"when excessive MCI alerts derogate the separation of IFR traffic"*, inhibit at
sectors); ¶12-6-12 (STARS MCI: *"b. MCI Alert base altitude must be set at any value between ground level and 500 feet
AGL …"*; *"d. Facility air traffic managers are authorized to inhibit the display of MCI Alert at specified
sectors/position."*); ¶12-6-3 b: *"Display Mode C on untracked (unassociated) targets within each controller's area of
responsibility …"*; ¶12-6-7 (STARS CA may be inhibited at positions). ¶6-8-6: *"The conflict alert function uses the
flight plan indication of RVSM capability to determine the appropriate separation standard to apply."* The STARS/ERAM
algorithm documents (NAS Configuration Management Documents, Site Adaptation Manuals) are not public — not read.

### Answer in plain words

| Pair | FAA function | Alert? |
|---|---|---|
| **Two untracked (unassociated) targets** | neither CA (needs two tracked) nor MCI (needs one tracked) | **No automated alert.** (A controller who notices still has ¶2-1-6, but only toward an aircraft *under their control*.) |
| **Tracked vs untracked** | **MCI** (Mode C Intruder), not CA | **Yes**, above the MCI base altitude, unless inhibited at the position. **Inference** from the name and ¶12-6-3 b: the untracked target must report **Mode C** altitude; a primary-only target with no altitude is not processed (silent in the text). |
| **Tracked VFR vs tracked IFR** (or VFR vs VFR) | **CA** — "tracked targets (known IFR or VFR aircraft)" | **Yes.** Flight rules do not matter; being tracked/known does. |

"Tracked" in the FAA sense = the automation holds a track with a flight plan/data block (associated). It is not "IFR":
a known VFR aircraft with a data block is tracked.

### What it means for `findConflicts` (LT-MARSA or whichever lane owns conflict-alert.js)

Our "tracked/associated" equivalent is a **Strip-correlated track** (it has a flight identification on the label). Then:
- **both uncorrelated → no alert** (today's "Not suppressed: a pair with no Strips. Two unknowns can still collide" is
  ours and against the FAA definition);
- **both correlated → CA**, IFR or VFR alike;
- **correlated vs uncorrelated → an MCI-type alert**, only if the uncorrelated target has an altitude (Mode C/SSR
  altitude in our presentation model) and is above a base altitude (FAA: ground–500 ft AGL terminal, ground–5,000 ft MSL
  en route, set per facility). Whether we label it "MCI" separately or fold it into CA is ours (LT-RQ16).
- Delivery: CA/MCI is for the controller **working the tracked aircraft** (¶2-1-6 issues alerts to aircraft under one's
  control), which supports sending it to the Position(s) holding the correlated Strip(s) rather than every ATC Position
  that sees both — **inference**.
- Q7's exclusions (formation members, MARSA participants) apply on top.

**LT-RQ16 (human):** CA eligibility. A. FAA model: CA only between two correlated tracks; MCI-type alert between a
correlated track and an uncorrelated target with altitude above a base altitude; nothing between two uncorrelated
targets. B. CA only between correlated tracks, no MCI at all. C. Keep today (every airborne pair). **R: A** (the P/CG
definitions, word for word).

---

## Questions for the human

Each with options and a recommendation (R). Ids `LT-RQ*` so the supervisor can put them on the Decision Desk.

| Id | For | Question | Options | R |
|---|---|---|---|---|
| LT-RQ1 | Q4/T7 | Which letters for the wake category indicator in Block 3? | A. CWT category A–I (JO 7110.65BB Chg 2 terminal), derived from the type by a JO 7360.1K table, overridable. B. Legacy `H/` (heavy/super only, as en route). C. ICAO WTC L/M/H/J (what the DD-1801 gives today). | **A** (current terminal order; derived, so nobody types it) |
| LT-RQ2 | Q4/T7 | Block 3 format | A. `[count/][indicator/]TYPE[/suffix]`, e.g. `2/G/F16/P`, `F16/P` (indicator in the old `H/` slot; the order shows no example). B. ICAO order `F16/M` (WTC after type). | **A** |
| LT-RQ3 | Q5/T8 | Label for Block 1 | A. `ACID` (FAA, ¶2-3-5 b). B. Keep `CALLSIGN`. | **A** with tooltip "aircraft identification" |
| LT-RQ4 | Q5/T8 | Approve the Q5 label table as drafted? | A. Approve as is. B. Approve with edits (list). C. Keep current labels, add FAA tooltips only. | **A** |
| LT-RQ5 | Q1/T1 | The five SFA frequencies: which three rotate, what are the other two? (7610.14A ¶7-1-5 is silent) | A. Facility config lists ≥5 UHF frequencies and marks 3 as the AP↔PAR rotation pool; the other 2 are AP's own (initial contact) and spare. B. All five in one pool, any 3 in use at a time. | **A** |
| LT-RQ6 | Q2/T5 | Where does the PAR Strip go when the aircraft lands? (¶5-12-9 "CONTACT (terminal control function) AFTER LANDING") | A. To LC (tower), who owns the runway and passes it to GC/drops it. B. To GC directly. C. Dropped at touchdown. | **A** |
| LT-RQ7 | Q2/T5 | "Landing assured" button name | A. Split into FAA steps: "Cleared to land" (relay, optional) and "Landed" (leaves PAR). B. One button "Landed". | **A** |
| LT-RQ8 | Q3/T11 | When does altitude conformance stop on a PAR final? | A. At PAR's "Begin descent" (¶5-12-3), a FINAL action. B. When PAR accepts the handoff. | **A** if the action is added, else **B** |
| LT-RQ9 | Q3/T11 | Heading conformance during the PAR final | A. None (PAR's headings recorded, not alerted; course deviation is PAR's verbal job). B. Against PAR's latest heading. | **A** |
| LT-RQ10 | Q6/T17 | Conformance while MARSA with a tanker | A. No altitude/heading conformance from "MARSA declared" to "MARSA terminated". B. Model the AR block and check against it. | **A** |
| LT-RQ11 | Q10/T4 | Ground vehicles on air-surveillance radars | A. Never presented. B. Presented only above a speed gate (MTI-like). | **A** |
| LT-RQ12 | Q11/T12 | Drop the former-holder exclusion (ADR 0076 S-L27) for the beacon rung? | A. Yes for the beacon rung (assigned discrete code of an active Strip wins). B. Keep as is. | **A** |
| LT-RQ13 | Q8/T27 | Using agency rights on a MOA another Facility controls | A. Using agency (OPS) schedules/activates/releases and approves entry; only the controlling Position defines (create/edit shape). B. OPS may also create/define. C. Keep today's rule. | **A** |
| LT-RQ14 | Q9/T29 | Airspace alert timing | A. On entry only (actual containment; ours, labelled). B. Predictive look-ahead like EDST's aircraft-to-airspace probe. C. Both. | **A** now, B later if wanted |
| LT-RQ16 | Q12 | Conflict Alert eligibility | A. FAA: CA between two correlated tracks; MCI-type alert correlated vs uncorrelated with altitude above a base altitude; none between two uncorrelated. B. CA between correlated only, no MCI. C. Keep today (every airborne pair). | **A** |
| LT-RQ15 | Q6/T14 | "MARSA voided" notice lifetime (orders silent) | A. Until acknowledged by a controller holding either Strip. B. Fixed time (e.g. 60 s). C. Until MARSA re-declared or terminated. | **A** |

## For the supervisor

- **Edition:** cite **JO 7610.14A** (effective 8-7-25, Chg 2 7-9-26), not "7610.14 with Chg 1 (3-21-24)"; ¶7-1-5 unchanged.
- **JO 7110.65BB Chg 2 (1-22-26)** changed Block 3 from the `H/` heavy indicator to the CWT "wake category indicator"
  (terminal only); TBL 2-3-3/4/5 are in ¶2-3-4, ¶2-3-6 is the type designator rule.
- **Our ARRIVAL/OVERFLIGHT block numbers do not match the FAA's** (ETA is FAA Block 8, coordination fix Block 7, altitude
  Block 9; overflight Block 7 is the coordination indicator, not requested altitude). The table keeps our ids (wire/state
  keys) and fixes only labels/tooltips; renumbering would be a separate, wire-changing decision.
- **Our Blocks 19–24 reuse en route numbers with different meanings**; labelled "ours".
- **Q7/Q9:** the FAA has real equivalents (ERAM Group Suppression/STARS inhibit; EDST aircraft-to-airspace "Blue" alert),
  so T16 and T29 are not purely ours — ADRs 0118/0119 should cite ¶5-13-1 c, ¶5-14-6 c, ¶13-1-1/13-1-2 and the P/CG.
- Sources not readable: AETCI 11-204, ATP-3.3.4.2 / T.O. 1-1C-1 (AR rendezvous geometry, the "1 NM"), CV NATOPS/CATCC
  (carrier final), JO 7110.126 (CWT, cancelled into 7110.65), af.mil pages (403).
