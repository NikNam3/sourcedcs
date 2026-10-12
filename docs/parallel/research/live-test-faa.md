# Live test 2026-10-11: what the FAA orders say (LT-RESEARCH, Q1–Q11)

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
