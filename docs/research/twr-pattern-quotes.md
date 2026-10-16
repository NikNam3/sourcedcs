# FAA text behind ADR 0126 (LC works the pattern)

Verbatim quotations for ADR 0126 (`docs/adr/0126-no-rsu-the-tower-works-the-pattern-on-its-ordinary-strips.md`), which
names JO 7110.65 ¶3-10-5 and AIM 4-3-3 / 4-3-22 without quoting them. Collected by lane U-SMALL on 2026-10-16.
ADR 0126 is not edited (P4); where it and the text disagree, the last section says so.

## Source and edition

- **FAA Order JO 7110.65BB, Air Traffic Control**, Change 3, effective 9 July 2026, from the FAA's own ATPUBS HTML:
  `https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap3_section_10.html` (¶3-10-5, ¶3-10-11) and
  `…/atc_html/chap3_section_8.html` (¶3-8-2). The publication index (`…/atc_html/`) reads "Effective: 7/9/2026,
  Change: Change 3".
- **Aeronautical Information Manual (AIM)**, Change 3, effective 9 July 2026, same site:
  `https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_3.html` (4-3-3, 4-3-22, 4-3-23). The index
  (`…/aim_html/`) reads "Effective: 7/9/2026, Change: Change 3".
- faa.gov answered HTTP 200 to a plain `curl` with a browser User-Agent (the 403 the last lane met was the fetch tool's
  User-Agent, not a block on the pages). No third-party copy was needed.
- The HTML draws paragraph letters with CSS (`css/atc-lists.css`: level 1 `a.`, level 2 `1.`, level 3 `(a)`), so the
  letters and numbers below are the ones the page shows, written out. Figures are left out (named where they sit);
  line breaks inside PHRASEOLOGY/EXAMPLE boxes are kept as separate lines. Nothing else is changed: spelling, quotes and
  the odd "FIG" label are as published.

## JO 7110.65BB ¶3-8-2 (already quoted in ADR 0126; checked against Change 3, unchanged)

**3-8-2. TOUCH‐AND‐GO OR STOP‐AND‐GO OR LOW APPROACH**

> Consider an aircraft cleared for touch‐and‐go, stop‐and‐go, or low approach as an arriving aircraft until it touches down (for touch‐and‐go), or makes a complete stop (for stop‐and‐go), or crosses the landing threshold (for low approach), and thereafter as a departing aircraft.
>
> REFERENCE-
>
> FAA Order JO 7110.65, Para 3-1-5, Vehicles/Equipment/Personnel on Runways.
>
> FAA Order JO 7110.65, Para 3-9-7, Wake Turbulence Separation for Intersection Departures.

## JO 7110.65BB ¶3-10-5

**3-10-5. LANDING CLEARANCE**

> a\. When issuing a clearance to land, first state the runway number followed by the landing clearance.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;RUNWAY (number) CLEARED TO LAND.
>
> b\. USA/USAF/USN NOT APPLICABLE. When issuing a clearance to land and hold short in accordance with FAA Order JO 7110.118, Land and Hold Short Operations (LAHSO), exchange traffic information as necessary. Request a read back of hold short instructions when not received.
>
> &emsp;NOTE-
>
> &emsp;1\. Pilots who prefer to use the full length of the runway or a runway different from that specified are expected to advise ATC prior to landing.
>
> &emsp;2\. Pilots may not be able to accept a LAHSO clearance when their aircraft is less than 1,000 feet AGL.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;RUNWAY (number) CLEARED TO LAND, HOLD SHORT OF RUNWAY (number)/TAXIWAY (taxiway)/(approach/departure path)/POINT (predetermined point), (traffic, type aircraft, or other information).
>
> Or
>
> READ BACK HOLD SHORT INSTRUCTIONS.
>
> &emsp;EXAMPLE-
>
> &emsp;1\. “Runway 7 Left, cleared to land, hold short of taxiway Whiskey, traffic crossing downfield.”
>
> Or (if hold short instructions are not read back with the landing clearance)
>
> “Read back hold short instructions.”
>
> &emsp;2\. “Runway one eight cleared to land, hold short of runway one four left, traffic, (type aircraft) landing runway one four left.”
>
> &emsp;3\. “Runway one six cleared to land, hold short of runway seven left, traffic, (type aircraft) departing runway seven left.”
>
> c\. If the landing runway is changed, preface the landing clearance with “change to runway” followed by the runway number. Restate the runway number followed by the landing clearance.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;CHANGE TO RUNWAY (number), RUNWAY (number) CLEARED TO LAND.
>
> &emsp;NOTE-
>
> &emsp;The purpose of the “change to runway” phraseology and restating the runway number is to emphasize to the pilot that they are being cleared to land on a runway other than what they were expecting.
>
> d\. When you become aware that an aircraft is aligned with the wrong surface, inform the pilot and:
>
> &emsp;1\. Issue control instructions/clearances, or
>
> &emsp;EXAMPLE-
>
> &emsp;“United four twenty three, go‐around, you appear to be aligned with the wrong runway.”
>
> “American sixty three, go‐around, you appear to be aligned with a taxiway.”
>
> “Southwest two thirty nine, you appear to be aligned with Runway 27 Left (pertinent information), Runway 27 Left, cleared to land.”
>
> &emsp;2\. If time permits, verify the pilot is aligned with the correct runway. Issue control instructions/clearances as necessary.
>
> &emsp;EXAMPLE-
>
> &emsp;“Twin Cessna four one four lima bravo, verify you are aligned with Runway 27 Left.”
>
> &emsp;REFERENCE-
>
> &emsp;FAA Order JO 7110.65, Para 3-6-4, Safety Logic Alert Responses.
>
> FAA Order JO 7110.65, Para 3-10-8, Withholding Landing Clearance.
>
> FAA Order JO 7110.65, Para 5-14-9, Approach Runway Verification (ARV).
>
> e\. Procedures.
>
> &emsp;1\. Facilities without a safety logic system or facilities with the safety logic system inoperative or in the limited configuration must not clear an aircraft for a full‐stop, touch‐and‐go, stop‐and‐go, low approach, or option on the same runway with an aircraft holding in position or taxiing to LUAW until the aircraft in position has exited the runway or starts takeoff roll.
>
> &emsp;2\. Facilities using safety logic in the full core alert runway configuration may clear an aircraft for a full‐stop, touch‐and‐go, stop‐and‐go, low approach, or option on the same runway with an aircraft holding in position or taxiing to LUAW except when reported weather conditions are less than ceiling 800 feet or visibility less than 2 miles.
>
> f\. Inform the closest aircraft that is requesting a full‐stop, touch‐and‐go, stop‐and‐go, low approach, or option when there is traffic authorized to LUAW on the same runway.
>
> &emsp;EXAMPLE-
>
> &emsp;“Delta One, Runway One‐Eight, continue, traffic holding in position.”
>
> “Delta One, Runway One‐Eight, cleared to land. Traffic holding in position.”
>
> “Twin Cessna Four Four Golf, Runway One‐Niner base approved, traffic holding in position."
>
> “Baron Two Five Foxtrot, Runway One-Niner Right extend downwind, tower will call your base, traffic holding in position."
>
> g\. USA/USN/USAF. Issue runway identifier along with surface wind when clearing an aircraft to land, touch and go, stop and go, low approach, or the option.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;RUNWAY (number), WIND (surface wind direction and velocity), CLEARED TO LAND.
>
> &emsp;NOTE-
>
> &emsp;A clearance to land means that appropriate separation on the landing runway will be ensured. A landing clearance does not relieve the pilot from compliance with any previously issued restriction.
>
> h\. Whenever a runway length has been temporarily or permanently shortened, state the word “shortened” immediately following the runway number as part of the landing clearance. This information must be issued in conjunction with the landing clearance.
>
> &emsp;1\. The addition of “shortened” must be included in the landing clearance for the duration of the construction project when the runway is temporarily shortened.
>
> &emsp;2\. The addition of “shortened” must be included in the landing clearance until the Chart Supplement is updated to include the change(s) when the runway is permanently shortened.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;RUNWAY (number) SHORTENED, CLEARED TO LAND.
>
> &emsp;EXAMPLE-
>
> &emsp;“Runway Two-Seven shortened, cleared to land.”
>
> i\. If landing clearance is temporarily withheld, insert the word “shortened” immediately after the runway number to advise the pilot to continue.
>
> &emsp;PHRASEOLOGY-
>
> &emsp;RUNWAY (number) SHORTENED, CONTINUE.
>
> &emsp;EXAMPLE-
>
> &emsp;“Runway Two-Seven shortened, continue.”
>
> &emsp;REFERENCE-
>
> &emsp;FAA Order JO 7210.3, Para 10-3-12, Airport Construction.
>
> FAA Order JO 7210.3, Para 10-3-13, Change in Runway Length Due to Construction.

## JO 7110.65BB ¶3-10-11 (already quoted in ADR 0126; checked, unchanged)

**3-10-11. CLOSED TRAFFIC**

> Approve/disapprove pilot requests to remain in closed traffic for successive operations subject to local traffic conditions.
>
> PHRASEOLOGY-
>
> LEFT/RIGHT (if required) CLOSED TRAFFIC APPROVED. REPORT (position if required),
>
> &emsp;or
>
> UNABLE CLOSED TRAFFIC, (additional information as required).
>
> NOTE-
>
> Segregated traffic patterns for helicopters and powered‐lift aircraft to runways and other areas may be established by letter of agreement or other local operating procedures.
>
> REFERENCE-
>
> FAA Order JO 7110.65, Para 3-7-4, Runway Proximity.
>
> FAA Order JO 7110.65, Para 3-9-4, Line Up and Wait (LUAW).
>
> FAA Order JO 7110.65, Para 3-10-3, Same Runway Separation.

## AIM 4-3-3

**4-3-3. Traffic Patterns** (the figures FIG 4-3-2, 4-3-3 and the wind component chart are left out; their EXAMPLE keys
are kept. The web copy labels all three "FIG 4-3-3".)

> a\. It is recommended that aircraft enter the airport traffic pattern at one of the following altitudes listed below. These altitudes should be maintained unless another traffic pattern altitude is published in the Chart Supplement or unless otherwise required by the applicable distance from cloud criteria (14 CFR section 91.155). (See
>
> &emsp;1\. Propeller-driven aircraft enter the traffic pattern at 1,000 feet above ground level (AGL).
>
> &emsp;2\. Large and turbine-powered aircraft enter the traffic pattern at an altitude of not less than 1,500 feet AGL or 500 feet above the established pattern altitude.
>
> &emsp;3\. Helicopters operating in the traffic pattern may fly a pattern similar to the fixed-wing aircraft pattern, but at a lower altitude (500 AGL) and closer to the runway. This pattern may be on the opposite side of the runway from fixed-wing traffic when airspeed requires or for practice power-off landings (autorotation) and if local policy permits. Landings not to the runway must avoid the flow of fixed wing traffic.
>
> b\. A pilot may vary the size of the traffic pattern depending on the aircraft's performance characteristics. Pilots of en route aircraft should be constantly alert for aircraft in traffic patterns and avoid these areas whenever possible.
>
> c\. Unless otherwise indicated, all turns in the traffic pattern must be made to the left, except for helicopters, as applicable.
>
> d\. On Sectional, Aeronautical, and VFR Terminal Area Charts, right traffic patterns are indicated at public-use and joint-use airports with the abbreviation “RP” (for Right Pattern), followed by the appropriate runway number(s) at the bottom of the airport data block.
>
> &emsp;EXAMPLE-
>
> &emsp;RP 9, 18, 22R
>
> &emsp;NOTE-
>
> &emsp;1\. Pilots are encouraged to use the standard traffic pattern. However, those pilots who choose to execute a straight-in approach, maneuvering for and execution of the approach should not disrupt the flow of arriving and departing traffic. Likewise, pilots operating in the traffic pattern should be alert at all times for aircraft executing straight-in approaches.
>
> &emsp;REFERENCE-
>
> &emsp;AC 90-66, Non-Towered Airport Flight Operations.
>
> &emsp;NOTE-
>
> &emsp;2. *RP indicates special conditions exist and refers pilots to the Chart Supplement.
>
> &emsp;NOTE-
>
> &emsp;3. Right traffic patterns are not shown at airports with full-time control towers.
>
> e\. Wind conditions affect all airplanes in varying degrees. Figure 4-3-4 is an example of a chart used to determine the headwind, crosswind, and tailwind components based on wind direction and velocity relative to the runway. Pilots should refer to similar information provided by the aircraft manufacturer when determining these wind components.
>
> &emsp;EXAMPLE-
>
> &emsp;Key to traffic pattern operations
>
> &emsp;1\. Enter pattern in level flight, abeam the midpoint of the runway, at pattern altitude.
>
> &emsp;2\. Maintain pattern altitude until abeam approach end of the landing runway on downwind leg.
>
> &emsp;3\. Complete turn to final at least 1/4 mile from the runway.
>
> &emsp;4\. Continue straight ahead until beyond departure end of runway.
>
> &emsp;5\. If remaining in the traffic pattern, commence turn to crosswind leg beyond the departure end of the runway within 300 feet of pattern altitude.
>
> &emsp;6\. If departing the traffic pattern, continue straight out, or exit with a 45 degree turn (to the left when in a left-hand traffic pattern; to the right when in a right-hand traffic pattern) beyond the departure end of the runway, after reaching pattern altitude.
>
> &emsp;EXAMPLE-
>
> &emsp;Key to traffic pattern operations
>
> 1. Enter pattern in level flight, abeam the midpoint of the runway, at pattern altitude.
>
> &emsp;1\. Maintain pattern altitude until abeam approach end of the landing runway on downwind leg.
>
> &emsp;2\. Complete turn to final at least 1/4 mile from the runway.
>
> &emsp;3\. Continue straight ahead until beyond departure end of runway.
>
> &emsp;4\. If remaining in the traffic pattern, commence turn to crosswind leg beyond the departure end of the runway within 300 feet of pattern altitude.
>
> &emsp;5\. If departing the traffic pattern, continue straight out, or exit with a 45 degree turn (to the left when in a left-hand traffic pattern; to the right when in a right-hand traffic pattern) beyond the departure end of the runway, after reaching pattern altitude.
>
> &emsp;6\. Do not overshoot final or continue on a track which will penetrate the final approach of the parallel runway.
>
> &emsp;7\. Do not continue on a track which will penetrate the departure path of the parallel runway.

## AIM 4-3-22

**4-3-22. Practice Instrument Approaches**

> a\. Various air traffic incidents have indicated the necessity for adoption of measures to achieve more organized and controlled operations where practice instrument approaches are conducted. Practice instrument approaches are considered to be instrument approaches made by either a VFR aircraft not on an IFR flight plan or an aircraft on an IFR flight plan. To achieve this and thereby enhance air safety, it is Air Traffic's policy to provide for separation of such operations at locations where approach control facilities are located and, as resources permit, at certain other locations served by ARTCCs or parent approach control facilities. Pilot requests to practice instrument approaches may be approved by ATC subject to traffic and workload conditions. Pilots should anticipate that in some instances the controller may find it necessary to deny approval or withdraw previous approval when traffic conditions warrant. It must be clearly understood, however, that even though the controller may be providing separation, pilots on VFR flight plans are required to comply with basic VFR weather minimums (14 CFR section 91.155). Application of ATC procedures or any action taken by the controller to avoid traffic conflictions does not relieve IFR and VFR pilots of their responsibility to see-and-avoid other traffic while operating in VFR conditions (14 CFR section 91.113). In addition to the normal IFR separation minimums (which includes visual separation) during VFR conditions, 500 feet vertical separation may be applied between VFR aircraft and between a VFR aircraft and the IFR aircraft. Pilots not on IFR flight plans desiring practice instrument approaches should always state `practice' when making requests to ATC. Controllers will instruct VFR aircraft requesting an instrument approach to maintain VFR. This is to preclude misunderstandings between the pilot and controller as to the status of the aircraft. If pilots wish to proceed in accordance with instrument flight rules, they must specifically request and obtain, an IFR clearance.
>
> b\. Before practicing an instrument approach, pilots should inform the approach control facility or the tower of the type of practice approach they desire to make and how they intend to terminate it, i.e., full-stop landing, touch-and-go, or missed or low approach maneuver. This information may be furnished progressively when conducting a series of approaches. Pilots on an IFR flight plan, who have made a series of instrument approaches to full stop landings should inform ATC when they make their final landing. The controller will control flights practicing instrument approaches so as to ensure that they do not disrupt the flow of arriving and departing itinerant IFR or VFR aircraft. The priority afforded itinerant aircraft over practice instrument approaches is not intended to be so rigidly applied that it causes grossly inefficient application of services. A minimum delay to itinerant traffic may be appropriate to allow an aircraft practicing an approach to complete that approach.
>
> &emsp;NOTE-
>
> &emsp;A clearance to land means that appropriate separation on the landing runway will be ensured. A landing clearance does not relieve the pilot from compliance with any previously issued restriction.
>
> c\. At airports without a tower, pilots wishing to make practice instrument approaches should notify the facility having control jurisdiction of the desired approach as indicated on the approach chart. All approach control facilities and ARTCCs are required to publish a Letter to Airmen depicting those airports where they provide standard separation to both VFR and IFR aircraft conducting practice instrument approaches.
>
> d\. The controller will provide approved separation between both VFR and IFR aircraft when authorization is granted to make practice approaches to airports where an approach control facility is located and to certain other airports served by approach control or an ARTCC. Controller responsibility for separation of VFR aircraft begins at the point where the approach clearance becomes effective, or when the aircraft enters Class B or Class C airspace, or a TRSA, whichever comes first.
>
> e\. VFR aircraft practicing instrument approaches are not automatically authorized to execute the missed approach procedure. This authorization must be specifically requested by the pilot and approved by the controller. Where ATC procedures require application of IFR separation to VFR aircraft practicing instrument approaches, separation will be provided throughout the procedure including the missed approach. Where no separation services are provided during the practice approach, no separation services will be provided during the missed approach.
>
> f\. Except in an emergency, aircraft cleared to practice instrument approaches must not deviate from the approved procedure until cleared to do so by the controller.
>
> g\. At radar approach control locations when a full approach procedure (procedure turn, etc.,) cannot be approved, pilots should expect to be vectored to a final approach course for a practice instrument approach which is compatible with the general direction of traffic at that airport.
>
> h\. When granting approval for a practice instrument approach, the controller will usually ask the pilot to report to the tower prior to or over the final approach fix inbound (nonprecision approaches) or over the outer marker or fix used in lieu of the outer marker inbound (precision approaches).
>
> i\. When authorization is granted to conduct practice instrument approaches to an airport with a tower, but where approved standard separation is not provided to aircraft conducting practice instrument approaches, the tower will approve the practice approach, instruct the aircraft to maintain VFR and issue traffic information, as required.
>
> j\. When an aircraft notifies a FSS providing Local Airport Advisory to the airport concerned of the intent to conduct a practice instrument approach and whether or not separation is to be provided, the pilot will be instructed to contact the appropriate facility on a specified frequency prior to initiating the approach. At airports where separation is not provided, the FSS will acknowledge the message and issue known traffic information but will neither approve or disapprove the approach.
>
> k\. Pilots conducting practice instrument approaches should be particularly alert for other aircraft operating in the local traffic pattern or in proximity to the airport.

## AIM 4-3-23 (the option approach; see below for why it is here)

**4-3-23. Option Approach**

> The “Cleared for the Option” procedure will permit an instructor, flight examiner or pilot the option to make a touch-and-go, low approach, missed approach, stop-and-go, or full stop landing. This procedure can be very beneficial in a training situation in that neither the student pilot nor examinee would know what maneuver would be accomplished. The pilot should make a request for this procedure passing the final approach fix inbound on an instrument approach or entering downwind for a VFR traffic pattern. After ATC approval of the option, the pilot should inform ATC as soon as possible of any delay on the runway during their stop-and-go or full stop landing. The advantages of this procedure as a training aid are that it enables an instructor or examiner to obtain the reaction of a trainee or examinee under changing conditions, the pilot would not have to discontinue an approach in the middle of the procedure due to student error or pilot proficiency requirements, and finally it allows more flexibility and economy in training programs. This procedure will only be used at those locations with an operational control tower and will be subject to ATC approval.

## Where ADR 0126 and the text disagree

1. **"AIM 4-3-22 (option approach)" is the wrong paragraph.** In the current AIM, 4-3-22 is *Practice Instrument
   Approaches*; the option approach is **4-3-23**. Read ADR 0126's "4-3-22 (option approach)" as 4-3-23. (4-3-22 b is
   still relevant: a pilot practising approaches says how each ends, "full-stop landing, touch-and-go, or missed or low
   approach", which is what the OPT cell records.)
2. **The option has five outcomes, the OPT cell three.** AIM 4-3-23: "touch-and-go, low approach, missed approach,
   stop-and-go, or full stop landing"; ¶3-10-5 e, f and g name "full‐stop, touch‐and‐go, stop‐and‐go, low approach, or
   option". ADR 0126's cell is T&G / FS / LA. Stop-and-go is left out by decision (H147 RQ7), which the text allows (it is
   the pilot's request, ATC may decline). **Missed approach** (4-3-23; 4-3-22 b, e) has no value and no "option" value
   either: a missed approach from the pattern ends as LA would for the Strip (the aircraft is a departure after the
   threshold, ¶3-8-2), so nothing is lost on the Board, but the cell cannot record "cleared for the option" before the
   pilot says which. Not a design change; noted for the docs pass.
3. **"AIM 4-3-3 (traffic patterns, entry and straight-in)".** 4-3-3 is about pattern altitudes, size, left turns,
   RP marking and the entry/leg geometry (figure key 1–6). It mentions straight-in only once, in NOTE 1 to d ("those
   pilots who choose to execute a straight-in approach … should not disrupt the flow"). So 4-3-3 supports PAT (pattern
   entry) directly and STR only by that note; no paragraph here defines a "straight-in" request to the tower. Not a
   disagreement in substance, a weaker citation than the ADR suggests.
4. **¶3-10-5 is phraseology, as the ADR says.** It does not mention pattern entry; its option content is e (no option /
   touch-and-go / low approach with traffic in LUAW without full safety logic), f (tell the closest such aircraft about
   LUAW traffic) and g (USA/USN/USAF: runway and wind "when clearing an aircraft to land, touch and go, stop and go, low
   approach, or the option"). Nothing in it contradicts the cells. Squadron note: g is the military rule, so an LC
   clearance on a T&G/LA Strip would say runway and wind; the Board issues nothing, so no change.
5. **¶3-8-2 and ¶3-10-11** match the ADR's quotations word for word (the ADR writes the hyphens as ASCII; the source
   uses U+2010).
