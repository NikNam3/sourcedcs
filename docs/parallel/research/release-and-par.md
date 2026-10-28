# Release, transfer of control and comms; PAR display; MARSA in a MOA (U-RESEARCH, R1–R7)

Research lane for the round-2 findings U5–U9, U11 and U17 (`docs/parallel/live-test-2026-10-13.md`, rulings H138).
Rule H128, "FAA model, always": every answer quotes the paragraph with its number and words and names the edition; where
the orders are silent it says **silent — the human decides**; anything that is our own design is labelled **ours**;
anything inferred from the orders rather than read in them is labelled **inference**. Builds on
`docs/parallel/research/control-release.md` (its errors are listed under "Corrections to control-release.md" at the end).

## Sources and editions (all read on 2026-10-13)

| Short name | Edition read | Where |
|---|---|---|
| JO 7110.65BB | Air Traffic Control, Basic 2-20-25 with Chg 1 (8-7-25), Chg 2 (1-22-26) and **Chg 3 (7-9-26)**, the current edition. Every paragraph quoted in R1–R5 carries the page date 2/20/25 (unchanged by the three changes); ¶5-12-4 carries Chg 3 | consolidated PDF `faa.gov/documentLibrary/media/Order/7110.65BB_Bsc_w_Chg_1_2_and_3_dtd_7-9-26_Final.pdf`, checked against the HTML chapters `atpubs/atc_html/chap2_section_1.html`, `chap5_section_4.html`, `chap5_section_10.html`, `chap5_section_12.html` (the HTML drops the sub-paragraph letters; the letters below are the PDF's) |
| P/CG | Pilot/Controller Glossary, current HTML (Basic with Chg 1–3, 7-9-26) | `atpubs/pcg_html/glossary-{c,h,m,p,r,t}.html` |
| JO 7210.3EE | Facility Operation and Administration, Basic with Chg 1–3 (7-9-26) | `7210.3EE_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| JO 7610.14A | Non-Sensitive Procedures and Requirements for Special Operations, effective 8-7-25, with Chg 1 (1-22-26) and Chg 2 (7-9-26) | `7610.14_Basic_w_Chg1_and_Chg_2_dtd_7-9-26.pdf` |
| JO 7400.2R | Procedures for Handling Airspace Matters, Basic with Chg 1–3 (7-9-26) | `7400.2R_Bsc_w_Chg_1_2_and_3_dtd_7-9-26.pdf` |
| Order 8200.1D | United States Standard Flight Inspection Manual, with CHG 2 (effective 09/20/2024); the PAR pages carry 11/06/2016 and 09/20/2024 | `faa.gov/documentLibrary/media/Order/8200.1D_CHG_1_2_(Final).pdf`, Chapter 14 Section 2 |
| ICAO Doc 4444 | PANS-ATM, 16th edition (2016), the Swiss BAZL consolidated copy (its record of amendments runs to 28/11/24) | `bazl.admin.ch/.../4444_cons_en.pdf` |
| EUROCONTROL | Guidelines for ATC Coordination and Transfer of Control, Edition 2.0, 15-06-2023 | `eurocontrol.int/.../guidelines_for_atc_coordination_and_transfer_of_control_ed-2-0.pdf` |

**Not read** (could not be reached or found as primary text): DAFMAN 13-204 vol 3 and AFMAN 13-204 (e-publishing.af.mil
blocks downloads); NAVAIR 00-80T-114 (NATOPS ATC manual); NAVEDTRA 14342; any technical manual or operator handbook for the
AN/FPN-63, AN/TPN-22, AN/GPN-22 or the STARS PAR display; FAA-STD for PAR displays. The PAR display answer (R6) is
therefore built from the FAA orders, the P/CG and the flight inspection manual, and says where that is not enough.

---

## R1 (U9, U5) — Release, transfer of control, transfer of communications: what each moves, in what order, together?

### What the orders say

**What each term means.**

- **P/CG HANDOFF:** *"An action taken to transfer the radar identification of an aircraft from one controller to another if
  the aircraft will enter the receiving controller's airspace and radio communications with the aircraft will be
  transferred."* (The P/CG has no entry "RADAR HANDOFF"; HANDOFF is the term. JO 7110.65BB ¶5-4-2 a has the same words.)
- **JO 7110.65BB ¶5-4-2 b, Radar Contact:** *"The term used to inform the controller initiating a handoff that the aircraft
  is identified and approval is granted for the aircraft to enter the receiving controller's airspace."*
- **P/CG RADAR POINT OUT** (POINT OUT refers to it): *"An action taken by a controller to transfer the radar
  identification of an aircraft to another controller if the aircraft will or may enter the airspace or protected airspace
  of another controller and radio communications will not be transferred."* ¶5-4-2 c, d say the same; ¶5-4-2 d, Point Out
  Approved: *"... approval is granted for the aircraft to enter the receiving controller's airspace, as coordinated,
  without a communications transfer ..."*
- **P/CG TRANSFER OF CONTROL:** *"That action whereby the responsibility for the separation of an aircraft is transferred
  from one controller to another."* P/CG TRANSFERRING CONTROLLER: *"A controller/facility transferring control of an
  aircraft to another controller/facility."* RECEIVING CONTROLLER: *"A controller/facility receiving control of an
  aircraft from another controller/facility."*
- **P/CG RELEASE TIME:** *"A departure time restriction issued to a pilot by ATC (either directly or through an authorized
  relay) when necessary to separate a departing aircraft from other traffic."* (and CALL FOR RELEASE, also departure).
  **There is no P/CG entry "RELEASE" for a mid-flight release.** The only place JO 7110.65BB uses "release" for an
  airborne aircraft between two controllers is **¶5-4-5 k**: *"Before **releasing control** of the aircraft, issue
  restrictions to the receiving controller that are necessary to maintain separation from other aircraft within your area
  of jurisdiction."* There, "releasing control" is transfer of control.
- **¶5-4-2 e, Traffic:** *"... Traffic is normally issued: 1. In response to a handoff or point out; 2. In anticipation of a
  handoff or point out; or 3. In conjunction with a **request for control** of an aircraft."* This is the FAA's own name for
  what we call "Request release".
- **¶5-4-8, AUTOMATED INFORMATION TRANSFER (AIT):** *"Transfer radar identification, altitude control, and/or en route
  fourth line control information, without verbal coordination under the following conditions: a. During radar handoff;
  and b. Via information displayed in full data blocks; and c. When following procedures specified in your facility AIT
  directive and/or LOA."* — the one place a part of control ("altitude control") travels inside the handoff itself.

**Transfer of control — when.** **¶2-1-15, CONTROL TRANSFER:**
> a. Transfer control of an aircraft in accordance with the following conditions:
> 1. At a prescribed or coordinated location, time, fix, or altitude; or,
> 2. At the time a radar handoff and frequency change to the receiving controller have been completed and when authorized
> by a facility directive or letter of agreement which specifies the type and extent of control that is transferred.
> b. Transfer control of an aircraft only after eliminating any potential conflict with other aircraft for which you have
> separation responsibility.
> c. Assume control of an aircraft only after it is in your area of jurisdiction unless specifically coordinated or as
> specified by letter of agreement or a facility directive.

**Coordination before instructing.** **¶2-1-14 b:** *"Before you issue a control instruction directly to a pilot that will
change the aircraft's heading, route, speed, or altitude, you must ensure that coordination has been completed with all
controllers whose area of jurisdiction is affected by those instructions unless otherwise specified by a letter of
agreement or facility directive."* ¶2-1-14 a: *"Ensure that the necessary coordination has been accomplished before you
allow an aircraft under your control to enter another controller's area of jurisdiction."*

**Transfer of communications.** **¶2-1-17 a:** *"Transfer radio communications before an aircraft enters the receiving
controller's area of jurisdiction unless otherwise coordinated or specified by a letter of agreement or a facility
directive."* ¶2-1-17 b: *"Transfer radio communications by specifying the following: ... 3. Time, fix, altitude, or
specifically when to contact a facility. ..."*, PHRASEOLOGY *"CONTACT (facility name or location name and terminal
function), (frequency)."* NOTE to b.3: pilots *"are expected to maintain a listening watch on the transferring controller's
frequency until the time, fix, or altitude specified."*

**The handoff steps, transferring side.** **¶5-4-5, TRANSFERRING CONTROLLER HANDOFF** — *"Unless otherwise coordinated or
specified in an LOA or facility directive, the transferring controller must:"*
> a. Complete a handoff prior to an aircraft entering the airspace delegated to the receiving controller.
> b. Verbally obtain the receiving controller's approval prior to making any changes to an aircraft's flight path, altitude,
> speed, or data block information while the handoff is being initiated or after acceptance.
> ...
> g. Consider the target being transferred as identified on the receiving controller's display when the receiving
> controller acknowledges receipt verbally or accepts the automated handoff.
> h. Prior to transferring communications: 1. Resolve any potential violations of adjacent airspace and potential
> conflicts with other aircraft in your area of jurisdiction. 2. Coordinate with any controller whose area of jurisdiction
> the aircraft will transit prior to entering the receiving controller's area of jurisdiction. 3. Forward to the receiving
> controller any restrictions issued to ensure separation. 4. Comply with restrictions issued by the receiving controller.
> i. Comply with the provisions of paragraph 2-1-17, Radio Communications. To the extent possible, transfer communications
> when the handoff has been accepted.
> j. After transferring communications, continue to comply with the requirements of subparagraphs h1 and h2.
> k. Before releasing control of the aircraft, issue restrictions to the receiving controller that are necessary to
> maintain separation from other aircraft within your area of jurisdiction.

**Receiving side.** **¶5-4-6, RECEIVING CONTROLLER HANDOFF** — *"The receiving controller must: a. Ensure that the target
position corresponds ... before accepting a handoff. b. Issue restrictions that are needed for the aircraft to enter your
sector safely before accepting the handoff. c. Comply with restrictions issued by the transferring controller unless
otherwise coordinated. ... h. Advise the transferring controller as soon as possible if you will delay the climb or descent
of the aircraft through the vertical limits of that controller's area of jurisdiction, unless otherwise specified in an LOA
or a facility directive."*

**Handoff phraseology carries restrictions.** **¶5-4-3 b, c:** *"HANDOFF/POINT-OUT/TRAFFIC (aircraft position), (aircraft
ID or discrete beacon code), (altitude, restrictions, and other pertinent information, if applicable)."* Reply *"(Aircraft
ID) (restrictions, if applicable) RADAR CONTACT, or ... POINT OUT APPROVED, or TRAFFIC OBSERVED, or UNABLE (appropriate
information, as required)."*

**Point out.** **¶5-4-7 a 4:** the transferring controller must *"Be responsible for subsequent radar handoffs and
communications transfer, including flight data revisions and coordination, unless otherwise agreed to by the receiving
controller or as specified in a LOA."* b 2: the receiving controller must *"Be responsible for separation between point
out aircraft and other aircraft for which he/she has separation responsibility."*

**Prearranged coordination.** **¶5-4-9 NOTE:** *"Under no circumstances may one controller permit an aircraft to enter
another's airspace without proper coordination. Coordination can be accomplished by several means; i.e., radar handoff,
automated information transfer, verbal, point-out, and by prearranged coordination procedures identified in a facility
directive ..."*

**Facility side.** JO 7210.3EE ¶4-3-2 a lists as LOA subjects between ARTCCs *"1. Radar handoff procedures. 2.
Interfacility coordination procedures. 3. Delegation of responsibility for IFR control jurisdiction."*; ¶6-2-2 (en route sector
information binder) d 8: *"Transfer of control points other than airspace boundaries."*; FIG 4-3-2 (ARTCC/Air Division
LOA format) 5 b: *"Transfer of Control. (Specify transfer procedures.)"*

**Offshore (ICAO procedures in the FAA order).** **¶8-2-2, TRANSFER OF CONTROL AND COMMUNICATIONS:** *"a. Only one air
traffic control unit must control an aircraft at any given time. b. The control of an aircraft must be transferred from one
control unit to another at the time the aircraft is estimated to cross the control boundary or at such other point or time
agreed upon by the two units. ... d. The accepting unit must notify the transferring unit if it is unable to accept control
under the terms specified, or it must specify the changes or conditions required so that the aircraft can be accepted. e.
The accepting unit must not alter the clearance of an aircraft that has not yet reached the transfer of control point
without the prior approval of the transferring unit."*

**ICAO and EUROCONTROL (for the word "release", which the FAA does not define):**
- Doc 4444 **10.1.2.2.1:** *"The responsibility for the control of an aircraft shall be transferred from the ATC unit to the
  next unit at the time of crossing the common control area boundary as determined by the unit having control of the
  aircraft or at such other point or time as has been agreed between the two units."* **10.1.2.2.3:** *"If the transfer of
  control time or point is other than forthwith, the accepting ATC unit shall not alter the clearance of the aircraft prior
  to the agreed transfer of control time or point without the approval of the transferring unit."* **10.1.2.2.4:** *"If
  transfer of communication is used to transfer an aircraft to a receiving ATC unit, responsibility for control shall not be
  assumed until the time of crossing the control area boundary or other transfer of control point specified in letters of
  agreement between the ATC units."* **10.1.2.4.3:** *"The accepting ATC unit shall normally not be required to notify the
  transferring unit that radio and/or data communication has been established with the aircraft being transferred and that
  control of the aircraft has been assumed, unless otherwise specified by agreement ..."*
- Doc 4444 **12.3.5.2 TRANSFER OF CONTROL** phraseology: *"a) REQUEST RELEASE OF (aircraft call sign); b) (aircraft call
  sign) RELEASED [AT (time)] [conditions/restrictions]; c) IS (aircraft call sign) RELEASED [FOR CLIMB (or DESCENT)]; d)
  (aircraft call sign) NOT RELEASED [UNTIL (time or significant point)]; e) UNABLE (aircraft call sign) [TRAFFIC IS
  (details)]."*
- EUROCONTROL guideline 2.0 **§3.5 Release:** *"the term release should be understood as an authorization for the accepting
  controller (granted by the transferring controller) to execute a manoeuvre (climb, descent and/or turn) with a specific
  aircraft before the transfer of control has taken place. This release may be granted for an individual aircraft on a
  tactical case by case basis ..., or it can be granted for a specific flow of traffic on a permanent basis and documented
  in the LoA ..."*; a: *"transferring controller is responsible for separation provision between all aircraft within the
  transferring controller's area of responsibility, including an aircraft whose air-ground communications has been
  transferred to the accepting ATC unit before the transfer of control"*. §3.4 recommends *"a. The Transfer of Communication
  takes place before the Transfer of Control, at a point/time/distance as agreed upon ..."*

### Answer in plain words

| Step | What it moves | FAA paragraph | Who does it |
|---|---|---|---|
| Handoff accepted ("RADAR CONTACT") | **radar identification** and **approval for the aircraft to enter** the receiver's airspace. Nothing else | ¶5-4-2 a, b; ¶5-4-5 g | proposed by the transferring controller, accepted by the receiver |
| Transfer of communications ("CONTACT ...") | **who talks to the pilot** | ¶2-1-17; ¶5-4-5 i, j | the **transferring** controller instructs the pilot; the receiver only hears the check-in |
| Release (partial: turns / climb / descent) | **permission for the receiver to instruct** in that sense before control moves | not an FAA term: FAA treats it as coordination (¶2-1-14 b, ¶5-4-2 e 3 "request for control"); ICAO 12.3.5.2; EUROCONTROL §3.5 | granted by the transferring controller, asked for by the receiver |
| Transfer of control ("releasing control", ¶5-4-5 k) | **separation responsibility** (P/CG TRANSFER OF CONTROL) | ¶2-1-15 | happens at a prescribed or coordinated point/time (a 1) or, by LOA/directive, at handoff + frequency change (a 2) |

**Normal order:** handoff → accept → comms (¶5-4-5 i: *"To the extent possible, transfer communications when the handoff has
been accepted"*) → control at the boundary or the coordinated point (¶2-1-15 a 1). Comms must move **before** the aircraft
enters the receiver's airspace (¶2-1-17 a), so in the normal case control is the last step. A release, if any, comes
between accept and transfer of control, in either order with comms.

**Which may happen together:**
- Handoff + comms + control at once: yes, **by LOA or facility directive** (¶2-1-15 a 2; ¶5-4-8 AIT), never by default.
- Control at a coordinated time that is "now": yes, by **coordination** (¶2-1-15 a 1 "coordinated ... time"; c "unless
  specifically coordinated"). This is the FAA basis for "your control" said in the handoff call.
- Comms without control: the normal state between ¶5-4-5 i and the boundary; the transferring controller keeps
  responsibility (¶5-4-5 j).
- Control without comms: the orders do not forbid it but never describe it; in practice it needs comms to follow at once
  (**inference** from ¶2-1-17 a: comms move before the airspace boundary).

**Can a transferring controller hand off "already released"?** Yes. The handoff call carries *"(altitude, restrictions, and
other pertinent information)"* (¶5-4-3 b), and transfer of control may be at any **coordinated** time (¶2-1-15 a 1), so
"handoff ... released for turns / for descent" or "your control" in the handoff itself is coordination the order allows.
The words "control for turns", "released for descent" are **not in JO 7110.65BB**: they are LOA / SOP idiom (and ICAO
12.3.5.2 b). A standing release for a whole flow is an LOA item (¶2-1-15 a 2, JO 7210.3EE ¶4-3-2 a 3, EUROCONTROL §3.5).

**What the receiver then needs to do:** accept the handoff (with its own restrictions, ¶5-4-6 b), comply with the
transferring controller's restrictions (¶5-4-6 c). **Nothing else**: it does not ask for the release it was given. It still
may not assume control (separation responsibility) before the aircraft is in its airspace unless that too was coordinated
(¶2-1-15 c) — a release given in the handoff is exactly that coordination for the scopes it names.

### What it means for our build

ADR 0101's three-records model (comms, control, release on `strip.coordination`) is right. Missing is **U5**: a release
can only be granted after ACCEPT (`handoff-control.js` `applyRelease` → `_requireActiveSteps`). Add an optional release to
the **HANDOFF PROPOSE** (`board/coordination.js` `_applyCoordinationPropose`, same fields as `ControlRelease GRANT`:
scopes, limits, condition, `effectiveAt`), shown to the receiver in the offer and **written as the grant at ACCEPT**
(`_applyCoordinationAccept`). The client's handoff form (the coordination popover) gets the same scope picker as
"Release…".

---

## R2 (U9) — Can an approved release be withdrawn? Can control be taken back after transfer?

### What the orders say

- JO 7110.65BB: **silent**. The order has no "release" of the EUROCONTROL kind, so no withdrawal of one. Searched the
  consolidated order and JO 7210.3EE for withdraw / cancel / rescind near release or control: the only "withdraw" uses are
  practice approaches (¶4-8-11), a failed transponder (¶5-2-14, *"withdraw a previously issued approval to operate with a
  failed transponder"*) and transponder deviations (¶5-2-19), none about control.
- The nearest FAA rules are the **two-way coordination** rules: ¶5-4-5 b (the transferring controller needs the receiver's
  approval for changes *"while the handoff is being initiated or after acceptance"*), ¶5-4-5 h 4 (*"Comply with restrictions
  issued by the receiving controller"*), ¶5-4-6 c (*"Comply with restrictions issued by the transferring controller unless
  otherwise coordinated"*). A release is coordination, and **inference**: what was coordinated can be changed only by further
  coordination, i.e. both controllers agree.
- EUROCONTROL §3.5 d lists for LoA releases *"The criteria, the scenarios, a mechanism, and a procedure to withdraw
  permanently granted release in LoA for a specific traffic flow."* — the only text that names withdrawing a release, and
  only for a standing LoA release, by a procedure written in the LoA. Tactical withdrawal: **silent**.
- ICAO 12.3.5.2 d *"(callsign) NOT RELEASED [UNTIL ...]"* answers a request; it is not a withdrawal.
- **After transfer of control:** ¶8-2-2 a (*"Only one air traffic control unit must control an aircraft at any given
  time"*) and ¶2-1-15 a (control moves *"at a prescribed or coordinated location, time, fix, or altitude"*). Nothing lets
  the former controller take control back on its own. Getting it back is a new transfer of control the other way: a new
  handoff, or coordination (¶2-1-14, ¶2-1-15 a 1). **Silent** on any "recall"; the only recall in the orders is of
  **airspace**: JO 7610.14A ¶8-1-9 NOTE *"ATC retains the authority to recall delegated airspace as specified in a LOA."*

### Answer in plain words

**Withdrawing an approved release before control transfers: silent — the human decides.** The orders read as coordination
both ways, so the transferring controller can say "cancel that, not released" as more coordination, and the receiver must
hear it (it may already be acting on it). **After transfer of control: no unilateral take-back**; the way back is a handoff
the other way.

### What it means for our build

ADR 0101 already has `ControlRelease WITHDRAW` (transferring side, before control moves) and refuses it after (`applyRelease`:
"control was already transferred"). That fits the model. What is **ours** and missing: the receiver is not told in a way it
must notice. Today the chip turns to a dim `RELEASE WITHDRAWN` (`control-release-rules.js` `handoffChips`, tone `dim`).
Since the receiver may have issued an instruction under it, a withdrawal is a problem for the receiver (dark cockpit:
colour it) until it acknowledges (recommended, see U-RQ2). After transfer of control nothing changes: the 10 s undo of the
`TRANSFER_CONTROL` mark (ADR 0101 "Undo", H95) is a correction of a mis-click, not a take-back, and stays.

---

## R3 (U9) — Does an approved (full) release move control and comms by itself?

### What the orders say

- **Comms**: only the controller talking to the pilot can move them: ¶2-1-17 b *"Transfer radio communications by
  specifying ... The facility name ... Frequency ... Time, fix, altitude, or specifically when to contact a facility."* A
  release between two controllers cannot change which frequency the pilot is on. **No**, a release never moves comms.
- **Control**: the FAA's only "release" of an airborne aircraft between controllers is **¶5-4-5 k** *"Before releasing
  control of the aircraft ..."*, which is transfer of control. Transfer of control at a **coordinated time** is ¶2-1-15 a 1.
  So in FAA terms an unqualified "released" / "your control" agreed between the two controllers **is** transfer of control
  at the time agreed (now, or the time said), with no further step. ICAO puts the release phraseology under the heading
  TRANSFER OF CONTROL (12.3.5.2) with *"RELEASED [AT (time)]"*.
- **Partial release** (turns / climb / descent): EUROCONTROL §3.5 *"an authorization ... to execute a manoeuvre ... before
  the transfer of control has taken place"*; §3.5 a: the transferring controller keeps separation responsibility in its
  area. FAA equivalent: the coordination of ¶2-1-14 b for the instructions named. A partial release **does not** move
  control.

### Answer in plain words

- **Partial release** (turns, climb, descent, alone or together): the receiver may instruct within it; control (separation
  responsibility) stays with the transferring controller until the boundary or the agreed point. Two separate steps remain.
- **Full release**: in the FAA model there is no "full release" short of control. Releasing every manoeuvre **is**
  "releasing control" (¶5-4-5 k) at a coordinated time (¶2-1-15 a 1). So a full release should **be** the transfer of
  control, at once or at its `effectiveAt`, with no separate "Take control" step. **Comms are never moved by it**: the
  transferring controller still tells the pilot to contact the receiver (normally already done, ¶5-4-5 i).

ADR 0101 decision 4 a moves control on "FULL release **and** comms transferred", in either order. That is **ours**: the FAA
links control to "handoff and frequency change" only when an LOA/directive says so (¶2-1-15 a 2). Waiting for comms is a
safe design (the holder can talk to the aircraft) but it leaves the window that produced U8: a FULL release granted
before comms, during which the receiver still sees "Request release" and "Control to me". See U-RQ1 for the choice.

### What it means for our build

Recommended (U-RQ1 a): `ControlRelease GRANT` with scope `FULL` **moves control at once** (or at `effectiveAt`, settled by
the existing `settleDueRelease` path), whatever comms show; `FULL` is relabelled **"Control (release control)"** in the
grant form, and the partial scopes keep the name "Release". `handoff-control.js`: in `applyRelease` GRANT, drop the
`link.comms.transferred` condition (line ~313) and in `settleDueRelease` drop `!link.comms.transferred`; trigger becomes
`COORDINATED` (new trigger name, **ours**). The control invariant (I) is unchanged: control still needs a live, staffed
receiving Strip. `TRANSFER_COMMS` stays a separate step.

---

## R4 (U6) — Can the receiver take control and comms without asking?

### What the orders say

- **Control:** ¶2-1-15 c *"Assume control of an aircraft only after it is in your area of jurisdiction unless specifically
  coordinated or as specified by letter of agreement or a facility directive."* With ¶2-1-15 a 1 (*"At a prescribed ...
  location, time, fix, or altitude"*), a receiver **may** take control without asking **at the boundary** (once the
  aircraft is in its airspace), or at an LOA transfer point. **Before** that, it may not, unless coordinated (a release /
  "your control"). ICAO 10.1.2.4.3: the accepting unit *"shall normally not be required to notify the transferring unit
  that ... control of the aircraft has been assumed"* — the boundary transfer is silent, by design.
- **Comms:** ¶2-1-17 a/b — the **transferring** controller transfers comms by telling the pilot whom to contact; ¶5-4-5 i
  *"To the extent possible, transfer communications when the handoff has been accepted."* The receiver cannot take comms;
  it can only **receive** the check-in. ICAO 10.1.2.4.3: the accepting unit need not notify that *"radio ... communication
  has been established"*.
- **Before transfer of control the receiver must not change the clearance** without approval: ¶2-1-14 b, ¶5-4-6 c; ICAO
  10.1.2.2.3; ¶8-2-2 e.

### Answer in plain words

Taking control without asking is **legitimate at the boundary** and **not before** (unless coordinated). Taking comms is
not something a receiver can do; recording the pilot's check-in is legitimate. So U6's worry is half right: a receiver
pressing "Control to me" right after ACCEPT, with the aircraft still in the other sector, is exactly what ¶2-1-15 c
forbids; pressing it when the aircraft has entered its airspace is exactly what ¶2-1-15 a 1 and ICAO 10.1.2.4.3 describe.
We have no sector geometry (ADR 0101 "Alternatives rejected"), so the server cannot tell the two apart. **Inference**: since
comms must move **before** the aircraft enters the receiver's airspace (¶2-1-17 a), an aircraft whose comms are still with
the transferring controller cannot (normally) be in the receiver's airspace yet; "comms with the receiver" is a usable
server-side precondition for the receiver's "Control at the boundary".

### Our receiver actions against the FAA

Code: `crc-sync/src/efsp/board/coordination.js` `applyOp`, `board/handoff-control.js` `applyMark` / `applyRelease` /
`checkControlAxis`; client `crc-desktop/app/public/js/panels/efsp/control-release-rules.js` `handoffSteps`.

| Our action (receiver) | State | FAA ruling | Keep / refuse / change |
|---|---|---|---|
| `HANDOFF ACCEPT` ("RADAR CONTACT") | INITIATED | ¶5-4-2 b, ¶5-4-6 a–b: accept, with restrictions | **keep** |
| `HANDOFF REJECT` ("UNABLE") | INITIATED | ¶5-4-3 c *"UNABLE (appropriate information ...)"* | **keep** |
| `HANDOFF TRANSFER_COMMS` "Comms to <me>" | ACTIVE, comms with transferring | ¶2-1-17 b: only the transferring controller transfers comms; the receiver hears the check-in | **change**: keep the op (it records a fact), relabel the receiver's button **"Checked in"** (title "the pilot called you"); the transferring side keeps "Comms to X" |
| `HANDOFF TRANSFER_CONTROL` "Control to <me>" | ACTIVE, comms with transferring | ¶2-1-15 c: not before the aircraft is in your airspace, unless coordinated; ¶2-1-17 a: comms move before that | **refuse** (`VALIDATION_ERROR`, "communications are still with X: the aircraft is not in your airspace yet; ask for control") — **inference**, see U-RQ3 |
| `HANDOFF TRANSFER_CONTROL` "Control to <me>" | ACTIVE, comms with receiver | ¶2-1-15 a 1 / c: at the boundary, without asking (ICAO 10.1.2.4.3) | **keep**, relabel **"Control at boundary"** (title: "the aircraft is in your airspace") |
| `ControlRelease REQUEST` "Request release…" | ACTIVE, control with transferring, no FULL in effect | ¶5-4-2 e 3 "request for control"; ICAO 12.3.5.2 a, c | **keep** |
| `ControlRelease REQUEST` | a release in effect already covers every requested scope, or FULL is in effect (control moved, under R3's recommendation) | nothing to ask for | **refuse** server-side, and do not offer it (U8) |
| `SetBlock` heading/altitude within the release | ACTIVE, control with transferring | coordination done by the release (¶2-1-14 b; EUROCONTROL §3.5) | **keep** |
| `SetBlock` heading/altitude outside the release, with "coordinated with" | ACTIVE, control with transferring | ¶2-1-14 b, ¶5-4-6 c, ICAO 10.1.2.2.3 | **keep** (H100 DR-1 b attestation) |
| Drop of its replica | any | silent (ADR 0101 returns both holders, `RECEIVING_RETIRED`) | **keep** |
| `TransferStrip` inside its Facility after ACCEPT (control follows owner) | ACTIVE | intrafacility moves under the facility directive (ADR 0101 decision 7, H100 DR-4 a) | **keep** |
| `ControlRelease GRANT/REFUSE/WITHDRAW` | — | transferring side only | already refused for the receiver (`applyRelease` side check) |

Transferring-side actions for completeness: `TRANSFER_COMMS` "Comms to X" (¶2-1-17, ¶5-4-5 i) keep; `TRANSFER_CONTROL`
"Control to X" (¶2-1-15 a 1 coordinated point / ¶5-4-5 k) keep; `GRANT` keep; `WITHDRAW` keep (R2); `CANCEL` of an ACTIVE
handoff refused once comms or control moved (ADR 0101 as built) keep.

### What it means for our build

`handoff-control.js` `applyMark`: for `TRANSFER_CONTROL` from the **receiving** side, refuse while `!link.comms.transferred`
(new refusal detail, existing code `VALIDATION_ERROR`; no new refusal code). Client `handoffSteps`: receiver labels
"Checked in" and "Control at boundary", the latter only offered after comms moved. Authority tables
(`authority/positions/carrier.js` `COORDINATION_ACTIONS`) unchanged.

---

## R5 (U7, U8) — What the receiver's Strip shows, state by state (dark cockpit)

### Rule

H115–H119 dark cockpit: grey unless a problem; show only what the controller needs; never tell them their job. The FAA
gives no display rule for these states (**silent**); the table is **ours**, built on R1–R4. The `COMMS:`/`CTRL:` markers
themselves are U3 (grey, no background), another lane.

| # | State (receiver's Strip) | Problem the receiver must act on? | Show |
|---|---|---|---|
| 1 | Handoff offered (INITIATED) | **yes**: answer it (¶5-4-6) | as today (the offer, attention) |
| 2 | Accepted; comms and control with transferring; no release | no: normal (¶5-4-5 i, the pilot is about to call) | grey `COMMS: X`, `CTRL: X`; no release line |
| 3 | Accepted; comms with receiver; control with transferring; no release | no: normal between comms and boundary (¶5-4-5 j) | grey `CTRL: X` only (so the controller knows to coordinate); an instruction outside it is caught by the attestation prompt |
| 4 | Partial release in effect (turns/climb/descent) | no | grey release line `RELEASE: Turns + Climb ≤ 240` (what the receiver may do; it needs to know the limits) |
| 5 | **Full release** (= control moved, R3 a) or control moved at the boundary | **no**: having control is the normal end state (U7) | **nothing**: no `RELEASE` line, no `CTRL` line (control is the owner's, as on any Strip) |
| 6 | Request open (receiver asked) | no (the other side must answer) | grey `REQUESTED: Turns` |
| 7 | Request refused ("UNABLE") | **yes**, once: the receiver asked and was told no | attention `UNABLE: <reason>` until the next request or a grant |
| 8 | Release withdrawn | **yes**: the receiver may have acted on it (R2) | attention `RELEASE WITHDRAWN` until acknowledged (U-RQ2) |
| 9 | Control repaired / no control holder | **yes** | as today (`CONTROL MOVED`, `NO CONTROL HOLDER`, bad) |

Transferring side, briefly: request open from the receiver → attention (it must answer, ¶5-4-2 e 3); after comms moved and
before control moved → grey `CTRL: me` (it keeps separation, ¶5-4-5 j); once control moved → nothing.

### U8 is a bug against the model

Confirmed: **"Request release…" is still offered after a FULL release** whenever control has not moved yet, which under ADR
0101 4 a is every FULL grant made before comms were transferred (and every FULL grant with a future `effectiveAt`).
Code path:

- client `crc-desktop/app/public/js/panels/efsp/control-release-rules.js` `handoffSteps`: in the `!controlMoved(co)` branch
  the RECEIVING side always pushes `REQUEST` (disabled only while a request is open); it never looks at `co.release`.
- server `crc-sync/src/efsp/board/handoff-control.js` `applyRelease`, `REQUEST` branch: refuses only when a request is
  already open; a `REQUEST` with a FULL release in effect is accepted.
- the same window keeps `TRANSFER_CONTROL` "Control to <me>" on offer, and `handoffChips` shows `RELEASE: Full` (tone `on`,
  the U7 marker).

With R3's recommendation (FULL = control) the window disappears (control has moved, the whole `!controlMoved` branch is
gone). Either way the server should refuse a `REQUEST` whose scopes the release in effect already covers.

---

## R6 (U11) — PAR display conventions

### What the orders say

- **P/CG PRECISION APPROACH RADAR:** *"Radar equipment ... to detect and display azimuth, elevation, and range of aircraft
  on the final approach course to a runway. ... the controller issues guidance instructions to the pilot based on the
  aircraft's position in relation to the final approach course (azimuth), the glidepath (elevation), and the distance
  (range) from the touchdown point on the runway as displayed on the radar scope."* ICAO term: *"Primary radar equipment
  used to determine the position of an aircraft during final approach, in terms of lateral and vertical deviations relative
  to a nominal approach path, and in range relative to touchdown."*
- **JO 7110.65BB ¶5-12-4** (Chg 3 page): *"a. Issue course guidance and inform the aircraft when it is on glidepath and on
  course, and frequently inform the aircraft of any deviation from glidepath or course. Transmissions ... approximately every
  5 seconds."* PHRASEOLOGY *"SLIGHTLY/WELL ABOVE/BELOW GLIDEPATH. SLIGHTLY/WELL LEFT/RIGHT OF COURSE."* *"b. Issue trend
  information as required, to indicate target position with respect to the **azimuth and elevation cursors** ..."* — the
  order names **cursors**, and gives deviations in words, never feet or degrees.
- **¶5-12-5:** *"Inform the aircraft of its distance from touchdown at least once each mile on final approach."*
  **¶5-12-6:** *"Inform the aircraft when it reaches the published decision altitude."* **¶5-12-7 a NOTE:** *"Glidepath and
  course information provided below decision altitude is advisory only."*
- **¶5-10-14:** missed approach *"whenever the completion of a safe approach is questionable because ... a. **Safety
  limits** are exceeded or radical target deviations are observed. ... The conditions in subparagraphs a, b, and c do not
  apply after the aircraft passes decision height on a PAR approach."* P/CG RADAR SERVICE, Radar Monitoring: *"... advice
  and instructions whenever an aircraft nears or exceeds the prescribed PAR safety limit ..."* The orders **never give the
  safety limit's value**; it is the facility's.
- **Order 8200.1D, Ch 14 Sec 2 ¶13:** *"The PAR radiates a narrow pulse and beam width signal, which produces a high
  resolution aircraft target display in terms of range, azimuth and elevation. The pulsed beams radiate along a
  predetermined descent path up to 15° in elevation, extend 10 to 20 miles from the antenna, and cover a 20° azimuth
  sector. **The typical PAR display shows two aircraft target plots. One plot shows aircraft vertical position and relative
  deviation from the planned glidepath (elevation). The second plot shows aircraft ground-track position and relative
  deviation from the planned approach course (azimuth). Aircraft-to-touchdown range may be determined from either plot.**"*
- 8200.1D checklist legend: *"'A' Cursor — The normal, commissioned glidepath angle"*; *"'B' Cursor — The lower safe limit,
  normally 0.5° below the A Cursor"*. ¶17 h: *"the ground controller verifies the glidepath and **decision height cursors**
  are properly aligned"*. ¶17 k: *"the lower safe limit angle, also known as the 'B-Cursor' or '**Elevation Safety Cursor**'
  ... The B-Cursor is typically aligned 0.5° below the primary glidepath. During this inspection, the flight crew will
  verify obstacle clearance from glidepath intercept to runway threshold."* ¶17 h (3): the controller states *"exactly when
  the radar return crosses the **range marks**"* (checked at 6, 5, 4, 3, 2 and 1 mile). ¶17 c, Course Deviation Accuracy:
  *"The check is completed when the controller notices a 'slight' deviation from centerline."*
- 8200.1D ¶19 PAR Tolerances: *"Azimuth Course Alignment (Along-Track): Greater of 30 ft or 0.34° from runway centerline;
  use the runway point of intercept as the azimuth point of origin"*; *"(Threshold): 30 ft, referenced to runway
  centerline"*; *"Lateral Coverage ± 10° from procedural C/L"*; *"Range Accuracy ± 2% of true range"*; glidepath angle
  ±0.1° (commissioning) / ±0.2° (periodic). Note: *"0.34° exceeds 30 ft at an aircraft-to-PAR distance greater than 0.83 nm
  (5,055 ft)"*. ¶13 also names the generic family *"FPN-40, FPN-62/63, MPN-14, TPN-18, TPN-44"* (mechanically scanned,
  *"Displayed targets are not computer enhanced"*) apart from computer-generated displays (TPN-22 class) that *"normally use
  synthetically-generated symbols during approaches"*.

### Answer in plain words

1. **Layout**: two plots, both against **range from touchdown** on the horizontal axis: elevation (height / deviation from
   the glidepath) and azimuth (ground track / deviation from the course). Range read off either. **Range marks** each
   mile. Our panel matches.
2. **Azimuth scale**: the radar measures an **angle** (a ±10° sector from the course, alignment tolerances given in degrees
   *and* feet), and the FAA's own tolerance is "the greater of 30 ft or 0.34°". **No order read says whether the scope's
   lateral axis is drawn in degrees or feet** (the TMs that would say were not readable): **silent — the human decides**.
   The controller's words are "slightly / well left of course", in neither unit.
3. **"B-scope"**: in radar terms a B-display plots **range against azimuth angle** in rectangular axes, so a PAR azimuth plot
   drawn in degrees is a B-display (and the elevation plot, range against elevation angle, an E-display). The term is
   **ours / general radar usage**; no FAA order read calls the PAR azimuth scope a "B-scope". Using it in the UI is
   harmless; "azimuth" is the FAA word.
4. **Cursors and limit lines** (FAA words): the **glidepath cursor** ("A"), the **lower safe limit / elevation safety
   cursor** ("B", normally **0.5° below**), the **decision height cursor**, the **azimuth (course) cursor**. "Safety
   limits" exist for both axes (¶5-10-14 a) but their values are local.
5. **Below DA**: the safety-limit missed approach does not apply (¶5-10-14 last sentence); information is advisory
   (¶5-12-7 a NOTE). H116 ("below DA no tolerance applies") matches the order.

### Compared with our panel

`crc-desktop/app/public/js/panels/efsp/par-model.js`, `par-panel.js`, mockup `docs/mockups/par-panel.html` rev 4 (H115,
H116):

| Item | Ours today | FAA | Change |
|---|---|---|---|
| Two plots against range from TD, mile marks | yes (`_drawScope`, `niceStep` grid, "TD" at 0) | 8200.1D ¶13, ¶17 h (3), ¶5-12-5 | none (grid steps of one mile up to ~10 NM are the "range marks"; keep) |
| Azimuth vertical axis | **feet** left/right (`azDevFt`; ±1° tolerance drawn as converging lines `lateralFt`); readout `120 ft L` | angle-measuring radar; scale unit silent | **U11 (human's ask): degrees.** Vertical axis = `azDeg` (the server already sends it, ADR 0112); the course is the 0° line and the ±tolerance lines become **straight horizontal lines** at ±tolAz°; readout `0.4° L`. See U-RQ4 for keeping feet as a secondary readout |
| Elevation vertical axis | height above TDZE in ft, glidepath line, ±1° fan, DA tick | glidepath cursor, lower safe limit cursor, DH cursor | keep feet (DA and heights are in feet on the approach plate); no change asked |
| Elevation lower limit | **±1°** symmetrical (H116) | the commissioned **lower safe limit is 0.5° below** the glidepath (8200.1D B-cursor), and obstacle clearance is verified only down to it | **finding**: our 1° below the glidepath is **outside** the FAA's lower safe limit; an aircraft 0.7° low is below the obstacle-cleared surface and we show it grey. See U-RQ5 |
| Azimuth tolerance origin | angle seen from touchdown (`severity`, `azDeg`) | "use the runway point of intercept as the azimuth point of origin" | none (RPI ≈ our touchdown point) |
| Below DA | nothing coloured, dashed lines start at DA | ¶5-10-14, ¶5-12-7 a NOTE | none |
| Words | no calls, no cadence (H115) | ¶5-12-4 words | none (H115 stands) |

**Caution on degrees near touchdown (inference):** an angle measured from touchdown grows without bound as range → 0 (30 ft
off at 0.1 NM is 2.8°). Below DA nothing is coloured, so this only affects the plot's position: clamp the drawn point to the
scope edge inside DA rather than letting it leave the box.

### What it means for our build (U-PAR's U11)

`par-panel.js` `_drawScope` for `kind === 'az'`: `lo/hi` in degrees (`view.azMaxDeg`, default ±2°, zoom by Shift+wheel as
today); `yOf(p)` = `p.azDeg`; the `tol-right/left` paths become `() => ±c.tolAz`; axis labels `0.5°L … 0 … 0.5°R`;
`_windowText` "±2.0°". `par-model.js`: `DEFAULT_VIEW.yMax` → `azMaxDeg`, `LIMITS.yMin` in degrees, `autoscaleView`'s
lateral window in degrees, `readoutModel.az` → `0.4° L` (and, per U-RQ4, `(120 ft)`), `lateralFt` kept only if feet stay
as the secondary readout. Mockup: a rev 5 of `docs/mockups/par-panel.html` for the human (H115 approved rev 3/4 with feet).
No server change: ADR 0112's sample already carries `azDeg`.

---

## R7 (U17) — MARSA in a MOA

### (a) What the orders say

- **JO 7110.65BB ¶2-1-11, USE OF MARSA:** *"a. MARSA may only be applied to military operations specified in a letter of
  agreement or other appropriate FAA or military document. NOTE- Application of MARSA is a military command prerogative. It
  will not be invoked indiscriminately by individual units or pilots. It will be used only for IFR operations requiring its
  use. Commands authorizing MARSA will ensure that its implementation and terms of use are documented and coordinated with
  the control agency having jurisdiction over the area in which the operations are conducted. Terms of use will assign
  responsibility and provide for separation among participating aircraft. b. ATC facilities do not invoke or deny MARSA.
  Their sole responsibility concerning the use of MARSA is to provide separation between military aircraft engaged in MARSA
  operations and other nonparticipating IFR aircraft. c. DoD must ensure that military pilots requesting special use
  airspace/ATCAAs have coordinated with the scheduling agency, have obtained approval for entry, and are familiar with the
  appropriate MARSA procedures. ATC is not responsible for determining which military aircraft are authorized to enter
  special use airspace/ATCAAs."*
- **P/CG MARSA:** *"A condition whereby the military services involved assume responsibility for separation between
  participating military aircraft in the ATC system. It is used only for required IFR operations which are specified in
  letters of agreement or other appropriate FAA or military documents."*
- **JO 7610.14A ¶2-1-8:** *"The application of MARSA is a military service prerogative and will not be invoked by individual
  units or pilots except as follows: a. Military service commands authorizing MARSA must be responsible for its
  implementation and terms of use. When military operations warrant an LOA and MARSA will be applied, the authority to
  invoke MARSA must be contained in the LOA. It must be noted that an LOA will not be required in all cases involving MARSA.
  b. ATC facilities do not invoke or deny MARSA. ..."*
- **JO 7610.14A ¶3-3-4, ATC CONTROL WITHIN ATCAAs AND MOAs:** *"ATCAAs and MOAs may be controlled by an ATC facility. Every
  effort should be made to provide instrument flight rules (IFR) service within these areas when requested by the military:
  a. When IFR service is provided by the ATC facility within the area, **the separation within the area is the
  responsibility of the ATC facility unless MARSA is established** in accordance with paragraph 2-1-8 ... b. The pilot, when
  cleared into the area, is responsible for remaining within the area, whether visual flight rules (VFR) or IFR ..."*
- **JO 7610.14A ¶3-3-1 b:** *"Procedures governing operations within ATCAAs and MOAs must be specified in letters of
  agreement ..."*; **¶3-3-2 a:** the using agency must *"Determine priority of use and advise all users of the pertinent
  procedures contained in the letter of agreement."*
- **JO 7610.14A ¶8-1-6 a** (Tactical Monitor): *"Responsibility for the ATC released airspace lies with the military aircraft
  that scheduled and are flying within the SUA/ATCAA. These aircraft must comply with Autonomous Operations for air traffic
  control purposes while in the SUA/ATCAA."*
- **JO 7400.2R ¶25-1-1:** *"A military operations area (MOA) is airspace established outside of Class A airspace to separate
  or segregate certain non-hazardous military flight activities from IFR aircraft and to identify for VFR aircraft where
  these activities are conducted."* ¶25-1-2: *"... air combat maneuvers, air intercepts, low altitude tactics, etc."*
- **JO 7110.65BB ¶9-3-1:** the SUA separation rules do not apply when *"a. The pilot informs you that permission has been
  obtained from the using agency to operate in the airspace. b. The using agency informs you they have given permission
  ..."* (ADR 0119's basis).

**So:** two military flights working one MOA under ATC's IFR service are separated by ATC **unless MARSA is established**
(7610.14A ¶3-3-4 a). MARSA between them is a **military** act: authorised by the command, its terms in an LOA or military
document (¶2-1-11 a, 7610.14A ¶2-1-8 a), declared by the participants under those terms. **Who must agree:** the
participating military (per their command's terms); **ATC does not agree or refuse** (¶2-1-11 b) — it is told, stops
separating the participants from each other, and keeps separating them from every non-participating IFR aircraft. When the
MOA has been **released** to the military (MRU / Tactical Monitor), separation inside it is the military's anyway
(7610.14A ¶8-1-6 a, ¶8-1-10), and MARSA between ATC-served flights does not arise. The orders do **not** define a "start
event" or "rendezvous" for MOA MARSA; the start and end are whatever the LOA says (**silent — the LOA decides**).

### (b) Ours: can two Strips in one MOA declare MARSA today? Yes.

Code: `crc-sync/src/efsp/marsa-store.js` (`_declare`: two or more flight data, `startEvent` in `TANKER_ACCEPTED |
MTR_ENTRY | LOCAL_DECLARATION`, `endCondition` in `VERTICALLY_POSITIONED | MTR_COMPLETE | ATC_SEPARATION_ESTABLISHED`,
a declaring callsign, one active relation per flight); authority `permission.js` `canDeclareMarsa` (any Position that works
Strips and has a scope, so not RANGES using Positions and not JTAC); client `strip-menu.js` "MARSA…",
`bay/popovers/marsa.js`.

Click by click, on either flight's Strip:
1. Open the Strip's menu → **Flight → "MARSA…"**.
2. In the form: pick the other flight (the list holds every live Strip on your Board not already in a relation), start
   event **"local declaration"**, end condition **"until ATC separation is re-established"**, type who declared it (the
   callsign heard on frequency) → **Declare**.
3. Both flights' separation regime (`SREG`) becomes MARSA, a `MARSA` badge shows on both Strips.
4. **Then "MARSA…" → "Mark rendezvous"** (see the gap below), otherwise the first heading or altitude a controller writes on
   either Strip voids it.
5. End: "MARSA…" → **End MARSA** when the flights report separated and ATC re-establishes separation (SREG back to ATC).

What the alerts then do between them:
- **ADR 0118 Conflict Alert / MCI:** an ACTIVE MARSA relation is one **group**: no CA/MCI between its members; alerts
  against everybody outside the group stay (ADR 0118 §3). Formation wingmen of either flight count as members. Ordinary
  heading/altitude conformance stays on for a `LOCAL_DECLARATION` relation (only `TANKER_ACCEPTED` receivers are exempted,
  ADR 0118 §4).
- **ADR 0119 airspace-entry alert:** independent of MARSA. Each flight raises the alert inside an active MOA unless **its
  own** entry is approved ("Airspace…" → approve on its Strip, or the using agency's approval, ADR 0119 §1). Two approved
  users raise no airspace alert, with or without MARSA; MARSA approves nobody into the MOA (correctly: ¶2-1-11 c puts entry
  approval with the scheduling agency, not with MARSA).

### Gaps (what is missing or off-model)

1. **The interlock void before rendezvous applies to every start event** (`marsa-store.js` `voidForAssignment`, reached from `set-block.js` via `ctx.marsaVoidFor`:
   `if (active.rendezvousAt) return null`). The FAA void rule is the **refueling** one (¶9-2-13 d NOTE: *"Altitude or
   course changes issued will automatically void MARSA."*, before rendezvous). A MOA has no rendezvous; a local declaration
   is voided by the first assignment unless the controller knows to press "Mark rendezvous". **Ours**, and wrong for this
   use: the void-before-rendezvous should apply to `TANKER_ACCEPTED` only (U-RQ6).
2. **Labels are refueling/MTR-shaped**: "local declaration", "until ATC separation is re-established" work, but nothing says
   "MOA". Optional: name the airspace in the declaration (a free-text or airspace pick, **ours**), so the badge reads
   "MARSA (BRAVO MOA)".
3. **Nothing ties MARSA to the MOA's activation**: when the MOA is returned to ATC the relation stays. The orders leave the
   end to the LOA; **ours** (optional): end it with "ATC_SEPARATION_ESTABLISHED" by hand, as today. No change recommended.

---

## Corrections to control-release.md

1. *"FAA 5-4-5 h: After transferring comms the transferring controller must still comply"* — the paragraph is **¶5-4-5 j**
   (*"After transferring communications, continue to comply with the requirements of subparagraphs h1 and h2"*); h is
   *"Prior to transferring communications: ..."*.
2. *"Before releasing control A issues B the restrictions needed to maintain separation (5-4-5 i)"* — it is **¶5-4-5 k**;
   ¶5-4-5 i is *"Comply with the provisions of paragraph 2-1-17 ... To the extent possible, transfer communications when the
   handoff has been accepted."*
3. The LOA-defined transfer (handoff + frequency change, "type and extent") is **¶2-1-15 a 2**, not "2-1-15 b" (the briefing
   and ADR 0101 decision 6 say "2-1-15 b"). ¶2-1-15 b is *"Transfer control of an aircraft only after eliminating any
   potential conflict ..."*. ADR 0101 is not edited (P4); the next ADR in this area cites a 2.
4. The ¶2-1-15 c quote is garbled (*"B may not 'assume control of an aircraft only after ...'"*). The words are *"Assume
   control of an aircraft only after it is in your area of jurisdiction unless specifically coordinated or as specified by
   letter of agreement or a facility directive."* — a positive rule (the receiver **may** assume control once the aircraft
   is in its airspace), not only a prohibition.
5. *"In the FAA book 'release' is not a defined control term"* — right for the glossary, but JO 7110.65BB **does** use it:
   ¶5-4-5 k *"Before releasing control of the aircraft"*, where it means **transfer of control**. The FAA's mid-flight
   "release" is therefore control, and the partial release is FAA "coordination" (¶2-1-14 b) / ¶5-4-2 e 3 *"request for
   control"*. This changes R3's answer.
6. Not cited and relevant: ¶5-4-2 e 3 (*"request for control"*), ¶5-4-8 (AIT, *"altitude control"* in the handoff),
   ¶2-1-17 a (comms before the receiver's airspace), ¶8-2-2 (the FAA text of ICAO's transfer of control), ICAO
   10.1.2.4.3 (the accepting unit need not notify that it assumed control).
7. Editions: JO 7110.65BB is now with **Chg 3 (7-9-26)**; every paragraph the old note quotes is unchanged (page date
   2/20/25). ICAO Doc 4444: the 16th edition numbering (10.1.2.2.1–5, 10.1.2.4, 12.3.5.2) is confirmed in the BAZL
   consolidated copy (amendment record to 28/11/24). JO 7610.14 is now **JO 7610.14A**; its Ch 8 numbers (8-1-1, 8-1-7,
   8-1-9 NOTE recall, 8-1-10, 8-1-11) are unchanged.

---

## Questions for the human (for the Decision Desk as U-RQ1…U-RQ6)

**U-RQ1 — Does a full release move control by itself?** (U9)
- a. **Yes, at once** (or at its effective time), comms stay a separate step; "Full" becomes "Control" in the release
  form. FAA: ¶5-4-5 k "releasing control" + ¶2-1-15 a 1 "coordinated ... time". Removes U8's window. **Recommended.**
- b. Keep ADR 0101: FULL + comms moves control, in either order (ours; FAA ties control to the frequency change only by
  LOA, ¶2-1-15 a 2).
- c. FULL release moves control **and** comms. Not FAA: comms move only when the pilot is told to contact (¶2-1-17 b).

**U-RQ2 — Withdrawing a release** (U9; the orders are silent)
- a. Keep `WITHDRAW` (before control moves); the receiver's Strip shows `RELEASE WITHDRAWN` in attention until the receiver
  acknowledges it (ours). **Recommended.**
- b. Keep `WITHDRAW` as today (dim line, no acknowledgement).
- c. Remove `WITHDRAW`; a release stands until control transfers (the transferring controller coordinates by voice).

**U-RQ3 — The receiver's "take control"** (U6)
- a. Allowed only after comms are with the receiver, labelled "Control at boundary"; before that refused with "ask for
  control" (¶2-1-15 c + ¶2-1-17 a, inference). **Recommended.**
- b. Never from the receiver: only the transferring side marks control (stricter than the FAA: ¶2-1-15 a 1 / ICAO
  10.1.2.4.3 let the receiver assume control at the boundary without asking).
- c. Keep as today (either side, any time after accept) and rely on the controller.

**U-RQ4 — PAR azimuth scale** (U11; the orders are silent on the unit)
- a. Degrees on the axis (true B-display, straight ±tolerance lines), readout in degrees **with feet in brackets**
  (`0.4° L (120 ft)`). **Recommended.**
- b. Degrees only, axis and readout.
- c. A Settings-tab switch degrees / feet, default degrees.

**U-RQ5 — PAR elevation lower limit** (finding in R6)
- a. Lower limit **0.5° below** the glidepath (the FAA lower safe limit, 8200.1D "B-cursor"), upper limit stays the
  controller's setting (default 1°). **Recommended.**
- b. Keep one symmetrical ±1° (H116), knowing it is below the FAA's obstacle-cleared limit.
- c. Separate upper and lower settings in the PAR tab, defaults +1° / −0.5°.

**U-RQ6 — MARSA void before rendezvous** (U17)
- a. Only for `TANKER_ACCEPTED` (the refueling rule, ¶9-2-13 d NOTE); a local declaration or MTR entry is not voided by an
  assignment (the controller ends or voids it). **Recommended.**
- b. Keep it for every start event (today; the controller must "Mark rendezvous" for a MOA declaration).
- c. Keep it, but a `LOCAL_DECLARATION` is declared with the rendezvous already marked.

---

## Build sketch: U-RELEASE (U5–U8), assuming the recommended answers

Server (`crc-sync/src/efsp/`):
1. **U5 — handoff released.** `board/coordination.js` `_applyCoordinationPropose`: accept an optional `release` on a
   `HANDOFF` PROPOSE (`{scopes, climbLimitFt?, descentLimitFt?, condition?, effectiveAt?}`), validated by the same
   `_scopesProblem` and limit checks as `applyRelease` GRANT (move them to a shared helper in `handoff-control.js`), carried
   as `coordination.offeredRelease` on both Strips; `_applyCoordinationAccept` writes it as `release` (granted by the
   proposer, at accept time) and clears `offeredRelease`. A FULL offered release moves control at ACCEPT (per U-RQ1 a).
   Not on POINT_OUT / TRAFFIC / OPERATIONAL_REQUEST / AIT. Audit: the PROPOSE entry carries it; the ACCEPT entry carries
   `controlRelease` and, if FULL, `control: { trigger: 'COORDINATED' }`.
2. **U9 / U-RQ1 a — FULL = control.** `handoff-control.js` `applyRelease` GRANT: drop `link.comms.transferred` from the
   control-moving condition; `settleDueRelease`: drop `!link.comms.transferred`; trigger `COORDINATED` (replaces
   `COMMS_AND_FULL_RELEASE` for new records; no backwards compatibility — persisted Boards with the old trigger are history
   only, check `stores.js` `checkPersistedShape` allows the new value).
3. **U8.** `applyRelease` REQUEST: refuse when a release in effect (not withdrawn, due) covers every requested scope
   (`_releaseCovers(link.release, op.scopes, null)`), detail "already released".
4. **U6 / U-RQ3 a.** `applyMark` TRANSFER_CONTROL from the receiving side (`sideOf(strip) === 'RECEIVING'`): refuse while
   `!link.comms.transferred`, detail "communications are still with X: ask for control".
5. **U-RQ2 a.** `WITHDRAW` sets `release.withdrawnAt`; add `release.withdrawAcknowledgedAt` written by a new
   `ControlRelease` action `ACKNOWLEDGE` (receiving side only). New action, so `wire:record` (op kinds are scanned).
6. Wire: `HANDOFF` PROPOSE gains `release`; `ControlRelease` gains `ACKNOWLEDGE`; new trigger value. Run
   `npm run wire:record` (bump if the last tag shipped 2). Freeze goldens touching handoff records: `npm run freeze:update`.
7. ADR: one new ADR ("A handoff may be offered released; a full release is transfer of control; the receiver assumes
   control at the boundary only after comms"), citing ¶2-1-15 **a 1 / a 2 / c**, ¶5-4-5 i–k, ¶2-1-17 a, ¶5-4-2 e 3.
   Supersedes ADR 0101 decisions 4 a and the receiver half of the `TRANSFER_CONTROL` row.

Client (`crc-desktop/app/public/js/panels/efsp/`):
1. `control-release-rules.js` `handoffSteps`: receiver labels "Checked in" (TRANSFER_COMMS) and "Control at boundary"
   (TRANSFER_CONTROL, only when `co.comms.transferred`); no `REQUEST` when the release in effect is FULL or covers all
   scopes; "Release…" form: "Full" relabelled "Control".
2. `handoffChips` per R5: no `RELEASE` line once control moved; partial release line grey; `RELEASE WITHDRAWN` attention
   with an "Acknowledge" step until acknowledged; `UNABLE` attention until the next request or a grant.
3. The handoff PROPOSE form (`bay/popovers/coordination.js`): a "Released" section reusing the release form's scope
   picker; the receiver's offer shows "released: Turns + Descent ≥ 4000".
4. Tests: `tests/efsp-control-release-client.test.mjs` rows for each state of R5; Playwright: `e2e/control-release.spec.js`
   gains "handoff released, receiver never sees Request release" (U5/U8) and "receiver cannot take control before comms"
   (U6).

## Build sketch: U-PAR's U11, assuming U-RQ4 a and U-RQ5 a

1. `par-model.js`: `DEFAULT_VIEW` gains `azMaxDeg: 2` (replaces `yMax`), `LIMITS.azMinDeg: 0.25`; `autoscaleView` sets the
   lateral window in degrees (e.g. `max(2 × tolAz, |azDeg| / PHI)`); `readoutModel.az` → `0.4° L (120 ft)` from `azDeg`
   and `azDevFt`; `severity` unchanged for azimuth; elevation: `tolElLowDeg` (default 0.5) and `tolElHighDeg` (default 1)
   replace `tolElDeg` in `PAR_DEFAULTS` and `severity`.
2. `par-panel.js` `_drawScope('az')`: Y in degrees, course at 0, tolerance lines horizontal at ±`tolAz`, dashed from DA's
   range outward as today; labels `0.5L / 0 / 0.5R` with a `°` unit in `_windowText`; the plot inside DA clamped to the scope
   edge. Elevation: the low tolerance line at −`tolElLow`, high at +`tolElHigh`. Settings tab: "Elevation below ±" and
   "Elevation above ±" (or keep one field if U-RQ5 b).
3. Mockup `docs/mockups/par-panel.html` rev 5 for the human before the build (H115 approved the feet version).
4. No server change (ADR 0112's `par-sample` already has `azDeg`). Tests: `tests/par-panel.test.mjs` for the degree readout,
   the window and the split elevation limits; `e2e/par-panel.spec.js` azimuth assertions (`data-par-line`, readout text).
