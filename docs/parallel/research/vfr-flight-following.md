# VFR aircraft in our app: what the FAA orders say about flight following (LT-RESEARCH-VFR, V1–V4)

Research lane for H134 (LT-Q5: clear a VFR aircraft with no Strip into active airspace) and LT-Q6 (mark a known
VFR aircraft as **tracked** for Conflict Alert; the human: "research flight following for this please").
Rule H128, "FAA model, always": every answer quotes the paragraph and names the edition; where an order is silent
it says **silent — the human decides**; anything inferred is labelled **inference**.

Builds on `docs/parallel/research/live-test-faa.md` (the first research, "LT-RESEARCH"). Its Q8 (controlling vs
using agency), Q9 (aircraft-to-airspace alert), Q11 (acquiring a track by its assigned code) and Q12 (which targets
CA processes) are cited, not redone.

## Sources and editions (read 2026-10-12)

| Short name | Edition read | Where |
|---|---|---|
| JO 7110.65BB | Air Traffic Control, Basic 2-20-25 with Chg 1, 2 and **Chg 3 (7-9-26)** | faa.gov HTML chapters 2-1, 2-2, 2-3, 5-1 to 5-4, 5-13, 5-14, 7-1, 7-6 to 7-9, 9-3; the consolidated PDF for notes the HTML drops |
| P/CG | Pilot/Controller Glossary, Basic with Chg 1, 2 and 3 (7-9-26) | `PCG_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| AIM | Aeronautical Information Manual, Basic 2-20-25 with Chg 1–3 (7-9-26) | faa.gov PDF |
| JO 7210.3EE | Facility Operation and Administration, Basic with Chg 1, 2 and 3 (7-9-26) | faa.gov PDF |
| JO 7400.2R | Procedures for Handling Airspace Matters, Basic with Chg 1, 2 and 3 (7-9-26) | faa.gov PDF |
| 14 CFR | Parts 73 and 91, eCFR "up to date as of 2026-10-08" | `ecfr.gov/api/versioner/v1/full/2026-10-08/title-14.xml` |

The PDFs are the files the first research downloaded (same editions); the HTML chapters and the CFR were fetched
again for this lane. Paragraph letters/numbers are as printed (`a.`, `1.`, `(a)`).

**Not public, not read:** the STARS and ERAM operator manuals, the NAS Configuration Management Documents and Site
Adaptation Manuals (the CA/MCI algorithms and the keyboard entries that start a VFR track). Where a question needs
them the answer says so.

---

## V1. Flight following: what the service is, how it starts and how it ends

### What the orders say

**The name.** P/CG: *"FLIGHT FOLLOWING− (See TRAFFIC ADVISORIES.)"* and *"RADAR TRAFFIC INFORMATION SERVICE− (See
TRAFFIC ADVISORIES.)"* So "flight following" is not a defined service of its own: it is the pilots' name for **radar
traffic advisories** to a VFR aircraft.

**P/CG, TRAFFIC ADVISORIES:** *"Advisories issued to alert pilots to other known or observed air traffic which may be
in such proximity to the position or intended route of flight of their aircraft to warrant their attention. … Note 2:
Traffic advisory service will be provided to the extent possible depending on higher priority duties of the controller
or other limitations …"*

**P/CG, RADAR FLIGHT FOLLOWING:** *"The observation of the progress of radar−identified aircraft, whose primary
navigation is being provided by the pilot, wherein the controller retains and correlates the aircraft identity with
the appropriate target or target symbol displayed on the radar scope."*

**P/CG, RADAR CONTACT a.:** *"Used by ATC to inform an aircraft that it is identified using an approved ATC surveillance
source on an air traffic controller's display and that radar flight following will be provided until radar service is
terminated."*

**P/CG, RADAR SERVICE TERMINATED:** *"Used by ATC to inform a pilot that he/she will no longer be provided any of the
services that could be received while in radar contact."* (followed by the automatic cases, the same as ¶5-1-9 b below).

**P/CG, ADDITIONAL SERVICES:** *"Advisory information provided by ATC which includes but is not limited to … a. Traffic
advisories. b. Vectors, when requested by the pilot, to assist aircraft receiving traffic advisories to avoid observed
traffic. … The controller has complete discretion for determining if he/she is able to provide or continue to provide
a service in a particular case."*

**JO 7110.65BB ¶2-1-1 c:** *"The ATC system must provide certain additional services to the extent permitted. The
provision of additional services is not optional on the part of the controller, but rather required when the work
situation permits."*

**JO 7110.65BB ¶2-1-21, TRAFFIC ADVISORIES:** *"Unless an aircraft is operating within Class A airspace or omission is
requested by the pilot, issue traffic advisories to all aircraft (IFR or VFR) on your frequency when, in your judgment,
their proximity may diminish to less than the applicable separation minima. Where no separation minima applies, such
as for VFR aircraft outside of Class B/Class C airspace, or a TRSA, issue traffic advisories to those aircraft on your
frequency when in your judgment their proximity warrants it."* a. *"To radar identified aircraft: 1. Azimuth … 12-hour
clock … 3. Distance … 4. Direction … 5. If known, type of aircraft and altitude."* Phraseology *"TRAFFIC, (number)
O'CLOCK, … (direction) (number) MILES, (direction)-BOUND …"*; a.6 *"When requested by the pilot, issue radar vectors to
assist in avoiding the traffic …"*; a.7 *"TRAFFIC NO FACTOR/NO LONGER OBSERVED"*.

**Starting it — the pilot asks, the controller identifies.**
- AIM ¶4-1-15 b.1: *"Traffic information is routinely provided to all aircraft operating on IFR flight plans except
  when the pilot declines the service … Traffic information may be provided to flights not operating on IFR flight
  plans when requested by pilots of such flights."*
- AIM ¶4-1-18 a.3 (terminal): *"Pilots of arriving aircraft should contact approach control on the publicized
  frequency and give their position, altitude, aircraft call sign, type aircraft, radar beacon code (if transponder
  equipped), destination, and request traffic information."* a.5(c): *"Pilots of aircraft transiting the area and in
  radar contact/communication with approach control will receive traffic information on a controller workload
  permitting basis. Pilots of such aircraft should give their position, altitude, aircraft call sign, aircraft type,
  radar beacon code (if transponder equipped), destination, and/or route of flight."* a.5(b) (departures): request it
  from ground control/clearance delivery with *"proposed direction of flight"*.
- JO 7110.65BB ¶7-6-10, VFR DEPARTURE INFORMATION: *"Inform departing VFR aircraft who request radar traffic advisories
  when to contact departure control and the frequency to use. Provide traffic advisories in accordance with paragraph
  2-1-21, Traffic Advisories, after the departure is radar identified."*
- JO 7110.65BB ¶5-3-1: *"Before you provide radar service, establish and maintain radar identification of the aircraft
  involved …"* ¶5-3-3 (beacon methods): *"a. Request the pilot to activate the "IDENT" feature … b. Request the pilot to
  change to a specific discrete or nondiscrete code … and then observe the target or code display change."*
- JO 7110.65BB ¶5-3-7 a: *"Inform an aircraft of radar contact when: 1. Initial radar identification in the ATC system
  is established."* Phraseology *"RADAR CONTACT (position if required)."* ¶5-3-6: inform the aircraft of its position
  when identified by a beacon method.
- JO 7110.65BB ¶5-2-7 a, VFR CODE ASSIGNMENTS: *"For VFR aircraft receiving radar advisories, issue a computer-assigned
  beacon code."*

**What the service is, by airspace (terminal).**
- JO 7110.65BB ¶7-6-1 a (Basic Radar Service): *"Basic radar services for VFR aircraft must include: 1. Safety alerts.
  2. Traffic advisories. 3. Limited radar vectoring when requested by the pilot. 4. Sequencing at locations where
  procedures have been established …"* (same list in AIM ¶4-1-18 a.1).
- ¶7-7-3 (TRSA): *"Separate participating VFR aircraft from IFR aircraft and other participating VFR aircraft …"*;
  ¶7-8-2 a (Class C): *"3. Separation, traffic advisories, and safety alerts between IFR and VFR aircraft. 4. Mandatory
  traffic advisories and safety alerts between VFR aircraft."*; ¶7-9-4/7-9-5 (Class B): VFR separated from IFR/VFR by
  weight class, *"Provide mandatory traffic advisories and safety alerts, between all aircraft."*
- JO 7210.3EE ¶12-1-1 a: *"Basic Radar Service, TRSA Service, Class B Service, and Class C Service are the four types
  of Terminal VFR Radar Services …"*

**En route.** No separate ARTCC chapter: ¶2-1-21 and ¶5-2-7 apply to every radar facility. JO 7210.3EE ¶9-1-7 (FAA
Form 7230-14) a.2 counts them as their own category: *"VFR Advisories: The far right−hand column is for the VFR
Advisories count. The count is used in various studies of expanded ARTCC service."*

**Ending it.**
- JO 7110.65BB ¶5-1-9 a, RADAR SERVICE TERMINATION: *"Inform aircraft when radar service is terminated."* Phraseology
  *"RADAR SERVICE TERMINATED (nonradar routing if required)."* b: *"Radar service is automatically terminated and the
  aircraft needs not be advised of termination when: … 4. TERMINAL. An arriving VFR aircraft receiving radar service to
  a tower‐controlled airport within Class B airspace, Class C airspace, TRSA, or where basic radar service is provided
  has landed, or to all other airports, is instructed to change to tower or advisory frequency."*
- ¶5-2-7 b: *"Instruct … a VFR aircraft for which radar advisory service is being terminated, to squawk VFR."*
  Phraseology *"SQUAWK VFR."* or *"SQUAWK 1200."*
- ¶7-6-11, TERMINATION OF SERVICE (basic): *"RADAR SERVICE TERMINATED, SQUAWK ONE TWO ZERO ZERO, or SQUAWK VFR, then
  CHANGE TO ADVISORY FREQUENCY APPROVED, or CONTACT (frequency identification), or FREQUENCY CHANGE APPROVED."*
- ¶7-7-7 c (TRSA) and ¶7-9-2 d (Class B): *"LEAVING THE (name) TRSA / LEAVING (name) BRAVO AIRSPACE, and as
  appropriate, RESUME OWN NAVIGATION, REMAIN THIS FREQUENCY FOR TRAFFIC ADVISORIES, RADAR SERVICE TERMINATED, SQUAWK
  ONE TWO ZERO ZERO."* AIM ¶4-1-18 b.10: *"Radar service is not automatically terminated with this advisory unless
  specifically stated by the controller."*
- ¶7-8-8 (Class C): *"provide services until the aircraft departs the associated outer area."*
- The pilot may end it: AIM ¶4-1-15 b.2: *"When advisory service is no longer desired, advise the controller before
  changing frequencies and then change your transponder code to 1200, if applicable. … Except in programs where radar
  service is automatically terminated, the controller will advise the aircraft when radar is terminated."*
- The controller may decline or stop for workload: AIM ¶4-1-15 b.1 *"Controllers possess complete discretion for
  determining whether they are able to provide or continue to provide this service in a specific case."*
- Losing the target is not termination: ¶5-3-7 b *"RADAR CONTACT LOST"*; JO 7110.65BB ¶10-3-1 b treats *"an abnormal
  simultaneous loss of radar and communications with an IFR aircraft or VFR/SVFR aircraft receiving flight following
  services"* as an emergency (ALNOT).

**Moving it between controllers.** ¶5-2-7 a.1: *"If the aircraft is outside of your area of responsibility and an
operational benefit will be gained by retaining the aircraft on your frequency for the purpose of providing services,
ensure that coordination has been effected …"*. ¶2-1-16 b: *"Coordinate with the appropriate control tower for transit
authorization when you are providing radar traffic advisory service to an aircraft that will enter another facility's
airspace. NOTE- The pilot is not expected to obtain his/her own authorization through each area when in contact with a
radar facility."* The handoff paragraphs (§5-4) apply to any radar-identified aircraft; none is VFR-specific. JO 7210.3EE
¶2-2-4 c.1(d)(8) lists *"VFR advisory aircraft"* as a traffic item on the position relief checklist.

### Answer in plain words

- **Flight following = radar traffic advisories to a VFR aircraft** (P/CG sends FLIGHT FOLLOWING to TRAFFIC ADVISORIES).
  Outside Class B/C and TRSAs it is **advice, not separation**: traffic calls, safety alerts, vectors on request
  (¶2-1-21, ¶7-6-1). Inside Class B, Class C and a TRSA the same aircraft is also **separated** (¶7-7-3, ¶7-8-2/3,
  ¶7-9-4).
- **Started by the pilot's request**, then the controller (1) **radar-identifies** the aircraft (¶5-3-1, ¶5-3-3: ident
  or a code change), (2) issues a **computer-assigned discrete code** (¶5-2-7 a), and (3) says **"RADAR CONTACT"**
  (¶5-3-7 a), from which point "radar flight following will be provided until radar service is terminated" (P/CG RADAR
  CONTACT a). It is workload-permitting: the controller may refuse or stop it (AIM ¶4-1-15 b.1).
- **Ended** by (a) the controller: **"RADAR SERVICE TERMINATED, SQUAWK VFR / SQUAWK 1200"** (¶5-1-9 a, ¶5-2-7 b,
  ¶7-6-11); (b) automatically when the VFR arrival lands at a towered field in B/C/TRSA/basic-service areas or is told to
  change to tower/advisory frequency elsewhere (¶5-1-9 b.4); (c) the pilot cancelling (AIM ¶4-1-15 b.2). "Leaving the
  TRSA/Bravo" is **not** termination unless the controller says so (AIM ¶4-1-18 b.10).
- **It moves with the aircraft** by ordinary radar handoff and coordination (¶5-2-7 a.1, ¶2-1-16 b).

### What it means for our app

Our app already has everything a flight-following aircraft needs **except a way to start it on a contact that has no
flight plan**: today such a contact can only get a **tag** (a name, not identification in the ATC system) or be bound to
a DEPARTURE/ARRIVAL/OVERFLIGHT Strip someone created for other reasons. The FAA start is three acts in one: identify,
assign a discrete code, "radar contact". The FAA end is one act with three triggers (controller, landing/frequency
change, pilot). Whatever we build should have exactly those acts, and the record they create is V2's question.

---

## V2. What record and track a VFR aircraft gets in STARS/ERAM

### What the orders say

**A code means a flight plan in the computer.**
- ¶5-2-7 a: *"For VFR aircraft receiving radar advisories, issue a computer-assigned beacon code."*
- ¶5-2-1 b: *"… issue beacon codes assigned by the computer. … NOTE- The computer will assign only discrete beacon codes
  unless all the discrete codes allocated to a facility are in use."* b.2 NOTE: an ARTCC-computer code *"will provide the
  adjacent facility advance information on the aircraft and will cause auto-acquisition of the aircraft prior to
  handoff. When an airborne aircraft that has been assigned a beacon code by the ARTCC computer and whose flight plan
  will terminate in another facility's area cancels ATC service, appropriate action should be taken to remove flight
  plan information on that aircraft."*
- ¶2-2-9 b (EN ROUTE, computer message verification): *"Any cancellation of IFR or **EAS generated VFR flight plan**."*
  (EAS = En Route Automation System, P/CG.)
- ¶2-2-3, FORWARDING VFR DATA: *"Forward aircraft departure times to FSSs or military operations offices when they have
  requested them. Forward other VFR flight plan data only if requested by the pilot."* (This is the pilot's **filed** VFR
  flight plan with Flight Service, a search-and-rescue record; it is a different thing from the advisory track.)

**Track/tag and data block.**
- ¶5-14-4 c (TERMINAL, STARS): *"Initiate a track/tag on all aircraft to the maximum extent possible. As a minimum,
  aircraft identification should be entered, and automated handoff functions should be used."*
- ¶5-14-1: *"STARS may be used for identifying aircraft assigned a discrete beacon code, maintaining identity of targets,
  and performing handoffs of these targets between controllers."*
- ¶5-3-3 d (EN ROUTE): *"An aircraft may be considered identified when the full data block is automatically associated
  with the target symbol of an aircraft that is squawking a discrete code assigned by the computer."*
- ¶5-3-8 (EN ROUTE) / ¶5-3-9 a (TERMINAL): *"Retain data blocks that are associated with the appropriate target symbol in
  order to maintain continuous identity of aircraft. … The data block must display flight identification and altitude
  information, as a minimum."* ¶5-3-9 NOTE: *"If a VFR aircraft is clear of Class B and Class C airspace and radar
  services have been terminated then retention of the data block is no longer required."*
- P/CG **ASSOCIATED**: *"A radar target displaying a data block with flight identification and altitude information."*
  **UNASSOCIATED**: *"A radar target that does not display a data block with flight identification and altitude
  information."*
- ¶5-13-8 a (ERAM): *"… "free" coast tracking may be used as a reminder that aircraft without corresponding
  computer-stored flight plan information are under your control."* (en route has the notion of a track without a
  stored flight plan, used only as a reminder.)
- ¶5-2-15 a: Mode C must be validated after *"1. Initial track start."*

**MSAW shows VFR aircraft are tracked.** ¶5-14-7 a: *"Inhibit MSAW processing of VFR aircraft and aircraft that cancel
instrument flight rules (IFR) flight plans unless the pilot specifically requests otherwise."* AIM ¶4-1-16 a.2: MSAW
monitors *"all aircraft with an operating Mode C altitude encoding transponder that are tracked by the system and are:
(a) Operating on an IFR flight plan; or (b) Operating VFR and have requested MSAW monitoring."* ¶5-2-7 c: *"When an
aircraft changes from VFR to IFR, assign a beacon code to Mode C equipped aircraft that will allow MSAW alarms."*

**Flight progress strips.**
- ¶2-3-1: *"Unless otherwise authorized in a facility directive, use flight progress strips to post current data on air
  traffic and clearances required for control and other air traffic control services."* En route: *"Flight progress
  strips must be posted."*
- ¶2-3-4 d: terminal air traffic managers *"may waive the requirement to use flight progress strips provided: 1. Backup
  systems … 2. Local procedures are documented in a facility directive … 3. No misunderstanding will occur as a result of
  no strip usage."*
- ¶2-3-8 c: *"For VFR operations, indicate the aircraft's transponder and navigation capabilities by adding the
  appropriate symbol, preceded by a slant (See TBL 2-3-10)."* (a strip/flight-data entry for a VFR aircraft exists).
- TBL 2-3-3/2-3-4/2-3-5 (terminal arrival/departure/overflight strips): **no VFR-specific block** and no "flight rules"
  field; a VFR aircraft uses the same blocks (Block 5 *"Secondary radar (beacon) code assigned"*).

**Codes for VFR not receiving service.** ¶5-2-7 b NOTE: 1255 (firefighting), 1277 (SAR), 1202 (gliders), 1203 (lead of
a VFR formation not in contact with ATC). ¶5-2-11 a: *"Continuously monitor the codes assigned to aircraft operating
within your area of responsibility. Additionally, monitor Code 1200, Code 1202, Code 1203, Code 1255, and Code 1277 …"*

**Acquisition by the assigned code:** first research Q11 (¶5-3-3 d, ¶5-3-4 a, ¶5-4-6 e NOTE, JO 7210.3EE ¶12-6-6) and
H135 (our beacon rung matches an active Strip's assigned discrete code).

### Answer in plain words

- **Record:** in the FAA system a VFR aircraft on advisories gets a **flight plan in the automation** — en route the order
  calls it an **"EAS generated VFR flight plan"** (¶2-2-9 b) — because the **computer-assigned discrete code** of ¶5-2-7 a
  is assigned to a flight plan (¶5-2-1 b). Terminal, the controller **initiates a track/tag with at least the aircraft
  identification** (¶5-14-4 c). **Inference:** that entry is what we would call a short Strip (callsign, type, code,
  altitude), not a filed flight plan; how the controller keys it in (the entry formats) is in the non-public operator
  manuals — **silent** in the orders.
- **Strip:** posted where the facility uses strips (¶2-3-1; en route always), with the VFR equipment suffix (¶2-3-8 c), on
  the ordinary arrival/departure/overflight forms. A terminal facility may waive strips (¶2-3-4 d). **No order creates a
  separate "VFR" strip type or a flight-rules block.**
- **Track:** yes, the controller starts (or the automation acquires by the discrete code) a **track with a full data
  block**; the target is then **associated** (P/CG) and stays so until radar service is terminated and the aircraft is
  clear of B/C (¶5-3-9 NOTE). MSAW's VFR rules (¶5-14-7 a, AIM ¶4-1-16 a.2) show the automation holds tracks for VFR
  aircraft.
- **What makes a VFR aircraft tracked for CA:** being **associated** — a track with flight identification (and altitude)
  in the automation, which for a VFR aircraft comes from **starting flight following** (discrete code + track/tag). A VFR
  aircraft squawking 1200 with no data block is **unassociated/untracked**. (P/CG CONFLICT ALERT, MODE C INTRUDER ALERT,
  ASSOCIATED; first research Q12.)

### What it means for our app

The FAA-shaped record for a flight-following aircraft is **a flight data record + a Strip with an assigned discrete
code, correlated to the contact** — the same three things an IFR flight has, minus the clearance. Our Strip already is
"associated" in the P/CG sense once it is correlated (identity.js rung 1 gives the label its flight identification).
So the smallest change is **not** a new kind of tracked tag; it is a quick way to **create a Strip from a contact**
(callsign, type, VFR, code), correlated on creation by BindTrack. A tag stays what it is: a name, untracked, like a
STARS scratch-pad note on an unassociated target. Whether we need a **VFR flag** on the record is V2's open point: the
FAA marks VFR only through the equipment suffix and the absence of a clearance, so a flag would be **ours** (LT-VQ2).

---
## V3. Clearing or approving a VFR aircraft into special use airspace, Class B or Class C

### What the orders say

**Restricted areas — permission from the using (or controlling) agency, by regulation.**
- 14 CFR 73.13: *"No person may operate an aircraft within a restricted area between the designated altitudes and during
  the time of designation, unless he has the advance permission of (a) The using agency described in § 73.15; or (b) The
  controlling agency described in § 73.17."*
- 14 CFR 73.15 (c): *"The using agency shall— (1) Schedule activities within the restricted area; (2) Authorize transit
  through, or flight within, the restricted area as feasible; and (3) Contain within the restricted area all activities
  …"*; (b): under a joint-use letter *"the using agency would notify the controlling agency whenever the controlling
  agency may grant permission for transit through the restricted area …"*
- 14 CFR 73.17: *"the controlling agency is the FAA facility that may authorize transit through or flight within a
  restricted area in accordance with a joint-use letter issued under § 73.15."*
- 14 CFR 91.133 (a): *"No person may operate an aircraft within a restricted area … contrary to the restrictions imposed,
  or within a prohibited area, unless that person has the permission of the using or controlling agency, as
  appropriate."*
- JO 7400.2R ¶23-1-5 a: *"The letter of procedure/letter of agreement provides for the operation of nonparticipating IFR
  and/or VFR aircraft within the area. Flight within an active restricted area is controlled by the using agency except
  when the area has been returned to the controlling agency. During such periods, the controlling agency may permit
  nonparticipating aircraft operations in the restricted area."*
- AIM ¶3-4-3 a: *"Penetration of restricted areas without authorization from the using or controlling agency may be
  extremely hazardous …"*

**MOAs and warning areas — VFR aircraft need nothing.**
- JO 7400.2R ¶25-1-6 a: *"In effect, MOAs are always joint use in that **VFR aircraft are not denied access**, and IFR
  aircraft may be routed through the airspace, by agreement between controlling and using agencies, when approved
  separation can be provided from the MOA activity."* ¶25-1-1: a MOA exists *"to separate or segregate certain
  non−hazardous military flight activities from IFR aircraft and to identify for VFR aircraft where these activities are
  conducted."*
- AIM ¶3-4-5 c: *"Pilots operating under VFR should exercise extreme caution while flying within a MOA when military
  activity is being conducted. … Prior to entering an active MOA, pilots should contact the controlling agency for
  traffic advisories."*
- JO 7400.2R ¶24-1-3 d (warning areas): *"Nonparticipating VFR pilots, while not excluded from warning areas, are on
  notice that military activity, which may be hazardous to nonparticipating aircraft, is conducted in those areas."*

**ATCAAs — IFR segregation, not a VFR restriction.** P/CG ATC ASSIGNED AIRSPACE: *"Airspace … assigned by ATC, for the
purpose of providing air traffic segregation between the specified activities being conducted within the assigned
airspace and other IFR air traffic."* (same words, JO 7400.2R ¶21-7-4 a). JO 7400.2R ¶21-1-3 b NOTE 1 (SUA types):
*"Air Traffic Control Assigned Airspace (ATCAAs) below FL 180 … must not be used as a substitute for SUA …"*;
NOTE 2: *"Since ATCAAs and ALTRVs are not depicted on aeronautical charts, they do not inform the flying public of the
location of the activity …"*

**What ATC does for its own traffic near active SUA (JO 7110.65BB §9-3, first research Q8).**
- ¶9-3-1: the SUA rules do not apply when *"a. The pilot informs you that permission has been obtained from the using
  agency to operate in the airspace. b. The using agency informs you they have given permission for the aircraft to
  operate in the airspace. NOTE- Using agency permission may be relayed to the pilot. c. The restricted/warning area,
  MOA, ATCAA, or stationary ALTRV has been released to the controlling agency."*
- ¶9-3-2: *"… separate nonparticipating aircraft from active special use airspace …"* NOTE: *"Nonparticipating aircraft
  refers to those aircraft **for which you have separation responsibility** and which have not been authorized by the
  using agency to operate in/through the special use airspace, ATCAA, or stationary ALTRV. VFR traffic is not prohibited
  from transiting stationary ALTRVs or transitional hazard areas (THA)."*
- ¶9-3-4: *"If a LOA/LOP has been coordinated with the Using Agency and permission has been granted to transit the area:
  a. Comply with the instruction/clearances issued by the Using Agency …"* NOTE: *"The FAA has no jurisdictional
  authority over the use of nonjoint use prohibited/restricted/warning area airspace; therefore, clearance cannot be
  issued for flight therein without the appropriate approval."*
- ¶2-1-16 b (surface areas, the nearest written analogue for a controller giving advisories): *"Coordinate with the
  appropriate control tower for transit authorization when you are providing radar traffic advisory service to an
  aircraft that will enter another facility's airspace. NOTE- The pilot is not expected to obtain his/her own
  authorization through each area when in contact with a radar facility."*

**Class B — an ATC clearance.**
- 14 CFR 91.131 (a)(1): *"The operator must receive an ATC clearance from the ATC facility having jurisdiction for that
  area before operating an aircraft in that area."*
- JO 7110.65BB ¶7-9-2 a: *"VFR aircraft must obtain an ATC clearance to operate in Class B airspace."* Phraseology:
  *"CLEARED THROUGH/TO ENTER/OUT OF BRAVO AIRSPACE, and as appropriate, VIA (route). MAINTAIN (altitude) WHILE IN BRAVO
  AIRSPACE. or CLEARED AS REQUESTED. … REMAIN OUTSIDE BRAVO AIRSPACE."* b: *"Approve/deny requests from VFR aircraft to
  operate in Class B airspace based on workload, operational limitations and traffic conditions."* d: *"Inform VFR
  aircraft when leaving Class B airspace."*

**Class C — two-way radio contact, not a clearance.**
- 14 CFR 91.130 (c)(1): *"Each person must establish two-way radio communications with the ATC facility … providing air
  traffic services prior to entering that airspace and thereafter maintain those communications while within that
  airspace."*
- JO 7110.65BB ¶7-8-4: *"If the controller responds to a radio call with, "(a/c call sign) standby," radio communications
  have been established and the pilot can enter Class C airspace. If workload or traffic conditions prevent immediate
  provision of Class C services, inform the pilot to remain outside Class C airspace until conditions permit …"*
  Phraseology *"(A/c call sign) REMAIN OUTSIDE CHARLIE AIRSPACE AND STANDBY."* ¶7-8-1: *"Class C services are designed to
  keep ATC informed of all aircraft within Class C airspace, not to exclude operations."*

**"VFR … APPROVED".** No such phrase for airspace entry in the paragraphs read. The approval words the orders use are
*"CHANGE TO ADVISORY FREQUENCY APPROVED"* / *"FREQUENCY CHANGE APPROVED"* (¶7-6-11) — **silent** on an "approved into the
area" phrase. The using agency's own words (¶9-3-4 a "instruction/clearances issued by the Using Agency") are not
prescribed by FAA orders.

**The record.** For Class B the clearance is an ATC clearance like any other (recorded where the facility records
clearances: strip, voice recorder; JO 7210.3EE ¶6-1-6 d *"Control instructions or coordination not recorded on a voice
recorder must be documented on the flight progress strip"*). For SUA the using agency's permission is a coordination
(¶9-3-1 a–b) — no FAA form or automation field for it is named in the orders: **silent**. ERAM's SAA status (first
research Q9, ¶5-13-10) records the airspace's state, not an aircraft's permission.

### Answer in plain words

| Airspace (active) | What a VFR aircraft needs | Who gives it | FAA words |
|---|---|---|---|
| **MOA** | **Nothing.** VFR aircraft are not denied access (7400.2R ¶25-1-6 a); the pilot is advised to call for traffic advisories (AIM ¶3-4-5 c) | — | none |
| **Warning area** | Nothing (7400.2R ¶24-1-3 d) | — | none |
| **ATCAA** | Nothing written for VFR: an ATCAA segregates activities **from IFR traffic** (P/CG). **Inference:** most ATCAAs sit in or near Class A where VFR does not fly | — | none |
| **Restricted area** | **Advance permission** (14 CFR 73.13, 91.133) | The **using agency**, or the controlling agency under the joint-use letter (73.15–73.17) | Permission, relayed by ATC (¶9-3-1 NOTE); no FAA phrase |
| **Class B** | An **ATC clearance** (91.131 (a)(1), ¶7-9-2 a) | The ATC facility with jurisdiction | **"CLEARED THROUGH/TO ENTER BRAVO AIRSPACE"** |
| **Class C** | **Two-way radio contact** (91.130 (c)(1), ¶7-8-4) | — (the controller may say "remain outside") | callsign acknowledged; **"REMAIN OUTSIDE CHARLIE AIRSPACE AND STANDBY"** to refuse |

A controller giving flight following does **not** need to approve a VFR aircraft into an active MOA; for a restricted area
the permission is the **using agency's** (Incirlik OPS for an Incirlik range), and the controller working the aircraft
coordinates or relays it (¶9-3-1 a–b; by analogy ¶2-1-16 b — **inference**). Our airspace types carry no Class B/C.

### What it means for our app

- Our `ApproveAirspaceEntry` (Board op, on a Strip) is the **using agency's permission** of ¶9-3-1 a–b / 73.15 (c)(2) —
  the first research already mapped it so (Q9). It needs a Strip; that is consistent with V2 (flight following creates
  one).
- H134's alert on an **uncorrelated contact inside active airspace** is ours for a MOA (FAA: VFR may enter, nothing to
  approve) and FAA-backed only for a restricted/prohibited area (73.13, 91.133). H132 already says build it anyway, so
  the ADR should say which part is ours. Our airspace `type` is **never read for behaviour** (`airspace-schema.js`),
  so "MOA vs restricted" would be a new behaviour (LT-VQ4).
- "Clearing a VFR aircraft into the airspace" in FAA words is: **start flight following (V1/V2) and then record the using
  agency's permission (`ApproveAirspaceEntry`)**. There is no FAA act that approves an untracked, unidentified contact.

---

## V4. Mode C Intruder (MCI): base altitude, the safety alert, and who is "tracked"

### What the orders say

**Definitions (P/CG, 7-9-26).** CONFLICT ALERT: *"… between tracked targets (known IFR or VFR aircraft) that require
his/her immediate attention/action."* MODE C INTRUDER ALERT: *"A function of certain air traffic control automated
systems designed to alert radar controllers to existing or pending situations between a tracked target (known IFR or VFR
aircraft) and an untracked target (unknown IFR or VFR aircraft) that requires immediate attention/action."* (quoted in
first research Q12.)

**Base altitude and adaptation (JO 7210.3EE).**
- **STARS ¶12-6-12:** *"a. Use the nominal value of parameters specified in the appropriate NAS Configuration Management
  Document and Site Program Bulletins for the MCI Alert functions, except for the base altitude parameter … These
  parameters are set by the Operational Support Facility (OSF). b. MCI Alert base altitude must be set at any value
  between ground level and 500 feet AGL at the discretion of the facility air traffic manager. Any instance of base
  altitudes above 500 feet AGL must be documented by the OSF. c. Facility air traffic managers are authorized to
  temporarily adjust the MCI Alert base altitude at a sector(s)/position(s) when excessive MCI Alerts derogate the
  separation of IFR traffic. For the purpose of this section, temporary is considered to be of less than 4 hours
  duration … Log each occurrence on FAA Form 7230−4 … d. Facility air traffic managers are authorized to inhibit the
  display of MCI Alert at specified sectors/position."*
- **ERAM ¶8-2-5:** *"a. Use the approved MCI CA preset values as defined in the ERAM Site Adaptation Manual (SAM) … b. MCI
  Alert base altitude must be set at any value between ground level and 5,000 feet MSL at the discretion of the facility
  air traffic manager. When a facility's or sector's ground level is above 5,000 feet MSL, base altitudes may be set to
  1,500 AGL. … c. … temporarily adjust the Mode C Intruder Alert base altitude at a sector(s) when excessive MCI alerts
  derogate the separation of IFR traffic … 3. Facility air traffic managers are authorized to inhibit the situation
  display of MCI Alert at specified sectors."*
- CA: ERAM ¶8-2-4 (*"approved CA preset values as defined in the ERAM Site Adaptation Manual"*, inhibit at sectors and in
  Aircraft Alert Volumes); STARS ¶12-6-7 b (*"authorized to inhibit CA at specific operating positions"*).
- STARS ¶12-6-3 b: *"Display Mode C on untracked (unassociated) targets within each controller's area of responsibility by
  setting the altitude filters to encompass all altitudes within the controller's jurisdiction. …"*

**The controller's side (JO 7110.65BB).**
- ¶5-14-6 (STARS) / ¶5-13-1 (ERAM) a: *"When a CA or MCI alert is displayed, evaluate the reason for the alert without
  delay and take appropriate action."* b: *"If another controller is involved in the alert, initiate coordination …"* c:
  suppress (one alert) / inhibit (STARS: *"only … for aircraft routinely engaged in operations where approved separation
  criteria do not apply"*); c.3: *"Computer entry of a message suppressing a CA/MCI alert constitutes acknowledgment for
  the alert …"*; c.4: *"CA/MCI alert may not be suppressed or inhibited at or for another control position without being
  coordinated."*
- ¶2-1-6, SAFETY ALERT: *"Issue a safety alert to an aircraft if you are aware the aircraft is in a position/altitude that,
  in your judgment, places it in unsafe proximity to terrain, obstructions, or other aircraft."* NOTE b: *"Recognition of
  situations of unsafe proximity may result from MSAW/E-MSAW, automatic altitude readouts, Conflict/Mode C Intruder Alert,
  observations on a PAR scope, or pilot reports."* b: *"Aircraft Conflict/Mode C Intruder Alert. Immediately
  issue/initiate an alert to an aircraft if you are aware of another aircraft at an altitude that you believe places them
  in unsafe proximity."* Phraseology *"TRAFFIC ALERT (call sign) (position of aircraft) ADVISE YOU TURN LEFT/RIGHT
  (heading), and/or CLIMB/DESCEND (specific altitude if appropriate) IMMEDIATELY."*
- AIM ¶4-1-16 b.1: *"Controllers will immediately issue an alert to the pilot of an aircraft **under their control** if
  they are aware of another aircraft which is **not under their control** …"*
- ¶7-8-2 a.4 / ¶7-9-5 a / ¶7-6-1 a.1: safety alerts are part of the service to VFR aircraft receiving Class C, Class B and
  basic radar service.

### Answer in plain words

- **Base altitude:** a per-facility (and temporarily per-position) adaptation: **STARS ground to 500 ft AGL**, **ERAM ground
  to 5,000 ft MSL** (1,500 AGL where the ground is above 5,000 MSL). Below it, no MCI alert. The alert can be inhibited at
  a position; one alert can be suppressed, which acknowledges it. The other MCI parameters (look-ahead, distances) are
  set nationally in non-public documents: **silent** here.
- **A VFR aircraft on flight following is tracked**: it has a computer-assigned discrete code and an associated track
  (V2), so it is one of the "known IFR or VFR aircraft". Against another tracked aircraft it gets **CA**; against an
  untracked Mode C target it is the **tracked** side of an **MCI** alert.
- **A VFR aircraft squawking 1200 with no service is untracked**: it is the **intruder** in MCI (when it reports Mode C
  altitude — the function's name; a primary-only target with no altitude is not processed, **inference**, first
  research Q12) and never part of a CA pair.
- **The alert goes to the controller working the tracked aircraft**, who issues a safety alert to *their* aircraft about
  the other one (¶2-1-6 b, AIM ¶4-1-16 b.1). Starting flight following on the intruder turns a future MCI into a CA and
  lets the controller issue traffic to both.

### What it means for our app

H134 LT-RQ16 a (CA between correlated tracks, MCI-type between correlated and uncorrelated above a base altitude, nothing
between two uncorrelated) is the FAA model, and **"correlated to a live Strip" is our "tracked"** — so starting flight
following (a Strip, correlated) is exactly how a controller moves a VFR aircraft from MCI-intruder to CA-tracked. The base
altitude should be a **facility setting** (STARS: ground–500 ft AGL; ERAM: ground–5,000 ft MSL), defaulting to the
terminal or en route value by Facility kind, with a per-Position override and inhibit (7210.3EE ¶12-6-12 c–d, ¶8-2-5 c).
A tag does **not** make a contact tracked (a tag is not an association, P/CG ASSOCIATED needs flight identification in
the automation — our tag is closer to a scratch-pad note). The intruder must report altitude (our SSR/Mode C presentation).

---
## Proposed model

The smallest FAA-shaped way, built from what the app already has (flight data, Strips, the code allocator,
`BindTrack`, `ApproveAirspaceEntry`, Strip drop). **Ours** marks every choice no order makes.

### (a) Start flight following on a contact with no Strip → it becomes tracked

| Step | FAA name and paragraph | In our app |
|---|---|---|
| Pilot asks for traffic advisories; controller decides it can give them | "request traffic information" (AIM ¶4-1-18 a.3, a.5(c)); additional services at the controller's discretion (¶2-1-1 c, AIM ¶4-1-15 b.1) | Voice, as today. Nothing recorded |
| Identify the contact | **Radar identification** (¶5-3-1), beacon method **"IDENT" / "SQUAWK (code)"** (¶5-3-3 a–b) | The controller picks the contact on the scope (as for a tag) |
| Enter the aircraft in the automation and give it a code | **Initiate a track/tag**, at least the aircraft identification (¶5-14-4 c); **computer-assigned discrete code** for VFR receiving radar advisories (¶5-2-7 a); en route an **"EAS generated VFR flight plan"** (¶2-2-9 b) | **One action on the contact, "Start flight following"** (ours: the name and the single action): creates **flight data** (callsign, type, VFR — LT-VQ2), allocates a **discrete code** from the existing allocator, creates an **OVERFLIGHT Strip** (FAA TBL 2-3-5 form; AP/CTR may create one today) owned by the acting Position directly in **IN_SECTOR**, and **binds** it to the contact (`BindTrack`, rung 1). DEPARTURE/ARRIVAL Strips stay the path for a VFR flight leaving or landing at our field (LT-VQ3) |
| Tell the pilot | **"RADAR CONTACT (position)"** (¶5-3-7 a, ¶5-3-6); "radar flight following will be provided until radar service is terminated" (P/CG RADAR CONTACT a) | Voice. The data block now shows the Strip's callsign: the contact is **associated** (P/CG) |
| Keep it | Retain the data block (¶5-3-8/5-3-9); acquisition by the assigned code (Q11, H135) | Correlation holds by the binding, and by the beacon rung once the pilot squawks the code |

**Result:** the contact is **tracked**: it takes part in **CA** with other tracked aircraft and is the tracked side of
**MCI** (V4, LT-RQ16 a). A **tag stays untracked** (a name only), as today.

### (b) Approve or clear it into active airspace

| Airspace | FAA act | In our app |
|---|---|---|
| Restricted/prohibited (our `RESTRICTED`, `PROHIBITED`; **inference**: `RANGE`, `DANGER` are restricted-like) | **Using agency permission** (14 CFR 73.13, 73.15 (c)(2), 91.133; ¶9-3-1 a–b; relayed by ATC, ¶9-3-1 NOTE) | **`ApproveAirspaceEntry`** on the flight-following Strip — the op that already exists, with the same rights (LT-RQ13) |
| MOA, warning area | **Nothing**: VFR aircraft are not denied access (7400.2R ¶25-1-6 a, ¶24-1-3 d); pilot told to ask for advisories (AIM ¶3-4-5 c) | Same op, recorded as an **approval** that only tells the alert this flight is known and working there — **ours** for a MOA (H132/H134 build the alert anyway; LT-VQ4) |
| Class B (none in our airspace data) | **ATC clearance**: "CLEARED THROUGH/TO ENTER BRAVO AIRSPACE" (91.131 (a)(1), ¶7-9-2 a) | Not modelled (no Class B airspace) |
| Class C (none in our data) | **Two-way radio contact**; refusal "REMAIN OUTSIDE CHARLIE AIRSPACE AND STANDBY" (91.130 (c)(1), ¶7-8-4) | Not modelled |

An **uncorrelated** contact can be neither approved nor cleared in FAA terms (there is nobody identified to approve), so
the H134 alert on it is answered by step (a) then step (b), not by an approval on the bare contact.

### (c) End the service

| Trigger | FAA act | In our app |
|---|---|---|
| Controller ends it (leaving the area, workload, pilot request) | **"RADAR SERVICE TERMINATED, SQUAWK VFR / SQUAWK 1200"** (¶5-1-9 a, ¶5-2-7 b, ¶7-6-11); remove the flight plan (¶5-2-1 b.2 NOTE) | **"Radar service terminated"** action (ours: one action) = **drop the Strip** (state DROPPED, which already releases the code and ends the correlation) and clear any `airspaceEntry`. The contact is untracked again (MCI intruder if it has Mode C) |
| VFR arrival lands, or is switched to tower/advisory frequency | **Automatic termination**, no advisory (¶5-1-9 b.4) | The existing ARRIVAL/handoff lifecycle; for an OVERFLIGHT Strip the controller drops it (ours: no automatic drop) |
| Passed to the next controller | Radar **handoff** / coordination (¶5-2-7 a.1, ¶2-1-16 b) | The existing HANDOFF/coordination of OVERFLIGHT Strips |
| Contact disappears | **"RADAR CONTACT LOST"** (¶5-3-7 b) — not termination; loss of radar *and* radio is an ALNOT case (¶10-3-1 b) | Strip stays; correlation goes to whatever the existing lost-track rule does. No new behaviour |

### What is ours, in one list

The single "Start flight following" and "Radar service terminated" actions; creating the Strip directly in IN_SECTOR;
OVERFLIGHT as the default type; a VFR mark on the record (if LT-VQ2 A); treating an MOA approval as an alert silencer;
the MCI base-altitude defaults per Facility kind (taken from 7210.3EE, the values are FAA, the per-Facility default is
ours).

---

## Questions for the human

Ids `LT-VQ*` for the Decision Desk. R = recommendation.

| Id | Question | Options | R |
|---|---|---|---|
| LT-VQ1 | How does a controller start flight following on a contact with no Strip (LT-Q6)? | A. One action on the contact, **"Start flight following"**: flight data + discrete code + OVERFLIGHT Strip in IN_SECTOR + `BindTrack`, in one go (FAA: track/tag ¶5-14-4 c, code ¶5-2-7 a, "RADAR CONTACT" ¶5-3-7). B. No new action: the existing CreateStrip then BindTrack, two steps. C. A "tracked tag": a tag counts as tracked for CA (not FAA: a tag is no association). | **A** |
| LT-VQ2 | Mark the flight as VFR on its record? (The FAA strip has no flight-rules block; VFR shows only in the equipment suffix, ¶2-3-8 c, and the absence of a clearance.) | A. A **flight-rules field** (IFR/VFR) on the flight data, set to VFR by "Start flight following", shown on the Strip as `VFR` in the altitude cell and turning off altitude/heading conformance (no assigned values) — ours. B. No field: VFR = a Strip with no clearance and no assigned altitude. C. A separate `VFR` Strip type. | **A** |
| LT-VQ3 | Which Strip type does a flight-following aircraft get? | A. **OVERFLIGHT** for a transit (FAA TBL 2-3-5), DEPARTURE/ARRIVAL when it departs/lands at our field (the ordinary forms). B. Always OVERFLIGHT. | **A** |
| LT-VQ4 | The airspace-entry alert and VFR aircraft in an active **MOA** (FAA: VFR not denied access, 7400.2R ¶25-1-6 a) | A. One rule for every airspace type (H134 as ruled): an uncorrelated contact, or a Strip without `ApproveAirspaceEntry`, inside active airspace alerts; the approval silences it — ours for MOA/warning areas, labelled in the ADR. B. By type, as the FAA: MOA/warning area never alerts for a tracked VFR aircraft; restricted/prohibited/range/danger alert unless approved (makes `type` behavioural for the first time). C. A but with a softer, information-only alert in MOA/warning areas. | **A** (already ruled; B noted for later) |
| LT-VQ5 | Who may approve a VFR aircraft's entry into active airspace? | A. As for any Strip today: the using agency, or the Position working the Strip relaying the using agency's permission (¶9-3-1 a–b NOTE), under LT-RQ13's rights. B. Only the using agency's Position. | **A** |
| LT-VQ6 | Ending flight following | A. One action **"Radar service terminated"** = drop the Strip (code released, correlation ended, airspace entry cleared) (¶5-1-9 a, ¶5-2-7 b). B. Keep the Strip until the aircraft leaves the Facility's airspace, then drop it automatically (ours). C. Both: the action, plus an automatic drop when the contact leaves the Facility's airspace. | **A** |
| LT-VQ7 | MCI base altitude (for LT-MARSA's MCI-type alert, LT-RQ16 a) | A. Facility setting: default **500 ft AGL** for a terminal Facility (STARS, 7210.3EE ¶12-6-12 b) and **5,000 ft MSL** for CENTER (ERAM, ¶8-2-5 b), with a per-Position inhibit (¶12-6-12 d). B. One global value. C. No base altitude. | **A** |
| LT-VQ8 | Does an uncorrelated **primary-only** target (no altitude) raise MCI? (P/CG silent on altitude; the function is "Mode C" intruder) | A. No: only an uncorrelated target with a reported altitude (inference from the name and 7210.3EE ¶12-6-3 b). B. Yes, against any tracked aircraft nearby laterally. | **A** |

## For the supervisor

- **Flight following needs no new kind of record.** It is a short Strip, correlated: the FAA gives a VFR aircraft on
  advisories a computer-assigned discrete code and a track with its identification (¶5-2-7 a, ¶5-14-4 c, ¶2-2-9 b), which
  is our flight data + Strip + correlation. LT-Q6 and the second half of H134 LT-Q5 have the same answer (LT-VQ1).
- **H134 LT-RQ16 a needs no change**: "correlated to a live Strip" = tracked. LT-MARSA (owner of `conflict-alert.js`)
  reads tracked from the correlation; nothing reads tags.
- **The H134 airspace alert on uncorrelated contacts is ours for MOAs** (FAA: VFR may enter); FAA-backed only for
  restricted/prohibited areas. The ADR for LT-AIRSPACE-ALERT (0119) should say so (LT-VQ4).
- **Which lane builds V1's actions** is open: the start action touches the Board (CreateStrip in IN_SECTOR), flight data
  (VFR field), correlation (`BindTrack`) and the client (track panel). It fits LT-CORRELATION or LT-AIRSPACE-ALERT; it
  should not wait on LT-MARSA, whose MCI uses it.
- **Wire:** a new op, or new fields on CreateStrip (`trackId`, initial state for OVERFLIGHT, flight rules), changes the
  wire surface (`npm run wire:record`).
- No source was blocked; the STARS/ERAM operator manuals and the CA/MCI algorithm documents are not public (noted where
  it matters).
