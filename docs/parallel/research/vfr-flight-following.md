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
