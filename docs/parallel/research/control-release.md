# Control, release and handoff between sectors: fact-check

Sources read: FAA JO 7110.65BB (Ch 2-1, 5-4, glossary C/R/T, fetched via curl), ICAO Doc 4444 (Swiss BAZL consolidated copy, para 10.1.2.2, 12.3.5.2), EUROCONTROL "Guidelines for ATC Coordination and Transfer of Control" ed 2.0. Not verified: JO 7210.3 / real LOA text (no primary text read), VATSIM forum page (403, snippet only).

## Verdict

Substantially correct, with four corrections.
1. "Release" is a real concept: the transferring controller authorises the accepting controller to maneuver an aircraft that is still in the transferring controller's airspace. EUROCONTROL: release is "an authorization for the accepting controller (granted by the transferring controller) to execute a manoeuvre (climb, descent and/or turn) with a specific aircraft before the transfer of control has taken place."
2. It is usually PARTIAL (turns / climb / descent, with conditions), not blanket "authority to direct". A full release is rare; a partial one is the norm.
3. The "must ask for each instruction" rule is right in substance. FAA 2-1-14 and 5-4-5 / ICAO 10.1.2.2.3 say it in terms of coordination and approval, not "asking for each instruction".
4. Do NOT equate release with comms. Three separate things: radar identification (handoff), communications (frequency), control (authority/separation responsibility). FAA and ICAO both let comms move before control. FAA 5-4-5: after transferring comms the transferring controller must still comply with restrictions and keep potential conflicts resolved in its area.
Also: in the FAA book "release" is not a defined control term (glossary has only RELEASE TIME and CALL FOR RELEASE, both departure-related). The FAA term for the same idea is "control transferred ... type and extent specified by LOA" (2-1-15). ICAO also does not define "release" (EUROCONTROL 3.5), but uses it in phraseology 12.3.5.2.

## States between sector A (transferring) and B (receiving)

| # | State | Who talks to the pilot | Who has control (separation responsibility) | Notes |
|---|---|---|---|---|
| 0 | Handoff initiated | A | A | B may not use the aircraft; A must not change flight path/alt/speed without B's verbal approval (5-4-5) |
| 1 | Handoff accepted ("radar contact") | A | A | Radar ID treated as transferred; B approves entry into its airspace. Not a comms or control transfer |
| 2 | Partial release (turns / climb / descent, with limits) | A or B | A holds control, B may maneuver within the release | A keeps responsibility for its own traffic; conditions stated by A |
| 3 | Transfer of communications (frequency change) | B | Still A until control point, unless LOA/release says otherwise | FAA: "to the extent possible, transfer communications when the handoff has been accepted"; ICAO 10.1.2.2.4 comms transfer does not move control |
| 4 | Transfer of control | B | B | At the boundary/fix/altitude/time, or at handoff + freq change if an LOA specifies type and extent (2-1-15); full release = control now |
| (alt) | Point out | A | A | Radar ID only, no comms transfer; A stays responsible for later handoff and comms (5-4-7) |

States 2 and 3 can occur in either order; typical APP/CTR practice is 1, 3, then 2 in the same call, then 4 at the boundary.

## What each controller may do

Receiving B before control or release:
- Accept the handoff and issue restrictions needed to enter safely (5-4-6).
- Talk to the aircraft once comms are transferred, but only issue instructions that stay within what A has released; anything that changes heading/route/speed/altitude needs coordination with A (2-1-14). ICAO 10.1.2.2.3: B "shall not alter the clearance ... prior to the agreed transfer of control time or point without the approval of the transferring unit".
- B may not "assume control of an aircraft only after it is in your area of jurisdiction unless specifically coordinated or ... LOA" (2-1-15 c).

Transferring A after the frequency change:
- Still holds separation responsibility for its own airspace. FAA 5-4-5 h: "After transferring communications, continue to comply with the requirements" (resolve conflicts, coordinate with others, forward and comply with restrictions). EUROCONTROL 3.5 a: A "is responsible for separation provision between all aircraft within the transferring controller's area of responsibility, including an aircraft whose air-ground communications has been transferred".
- Cannot talk to the pilot (no comms) so acts through B (asks B to issue instructions) or recalls the aircraft; B may need to approve A's changes (5-4-5 b: approval before changing flight path/altitude/speed "while the handoff is being initiated or after acceptance").
- A may grant a release only if the maneuver does not hurt separation in A's airspace, or B agrees to separate it, with conditions stated (EUROCONTROL 3.5 b).
- Before releasing control A issues B the restrictions needed to maintain separation (5-4-5 i).

## Departure release (different concept)

Permission for a departure to take off/enter another unit's airspace, e.g. tower asks approach/center. FAA glossary: "CALL FOR RELEASE - ... the overlying ARTCC requires a terminal facility to initiate verbal coordination to secure ARTCC approval for release of a departure into the en route environment." and "RELEASE TIME - A departure time restriction issued to a pilot by ATC ...". ICAO 10.1.3.1.2: "An ACC may, after coordination with the unit providing approach control service, release aircraft ..." / 10.1.4.1.2 APP may authorize TWR "to release an aircraft for take-off". Phraseology 12.3.5.5 INBOUND RELEASE. This is not the mid-flight sector release above.

## Phraseology

ICAO Doc 4444 12.3.5.2 TRANSFER OF CONTROL:
- "REQUEST RELEASE OF (callsign)"
- "(callsign) RELEASED [AT (time)] [conditions/restrictions]"
- "IS (callsign) RELEASED [FOR CLIMB (or DESCENT)]"
- "(callsign) NOT RELEASED [UNTIL (time or significant point)]"
- "UNABLE (callsign) [TRAFFIC IS (details)]"
12.3.5.3 change of clearance: "MAY WE CHANGE CLEARANCE OF (callsign) TO (details)", "AGREED TO ...", "UNABLE (callsign)".
FAA 5-4-3 handoff: "HANDOFF (position), (aircraft ID), (altitude, restrictions)"; reply "(ID) RADAR CONTACT", "POINT OUT APPROVED", "TRAFFIC OBSERVED", "UNABLE". The FAA book has no mandatory release phrase; "control for turns / descent / climb" and "released for turns" are LOA / ARTCC SOP / VATSIM idiom (VATSIM forum snippet: with control for turns, B "may make a series of turns provided none ... takes the aircraft back into the first controller's sector"; control for descent allows altitudes "provided that the direction is not changed"). That reading (turn-away only, one-way altitude) is common practice, not a 7110.65 rule.
ICAO OLDI/AIDC (11.4.2.5.15): the Transfer Communication message "may optionally include any 'release conditions' for the transfer of control ... climb, descent or turn restrictions, or a combination thereof".

## Evidence (quotes and URLs)

- FAA 7110.65 2-1-14: "Before you issue a control instruction directly to a pilot that will change the aircraft's heading, route, speed, or altitude, you must ensure that coordination has been completed with all controllers whose area of jurisdiction is affected ... unless otherwise specified by a letter of agreement or facility directive." https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap2_section_1.html
- 2-1-15: "Transfer control ... At a prescribed or coordinated location, time, fix, or altitude; or, At the time a radar handoff and frequency change ... have been completed and when authorized by a facility directive or letter of agreement which specifies the type and extent of control that is transferred." (same page)
- 5-4-2/5-4-5/5-4-6/5-4-7: https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap5_section_4.html . "Handoff. ... transfer the radar identification ... if the aircraft will enter the receiving controller's airspace and radio communications ... will be transferred." "Point Out. ... radio communications will not be transferred." "Consider the target ... identified on the receiving controller's display when the receiving controller acknowledges". "Before releasing control of the aircraft, issue restrictions to the receiving controller that are necessary to maintain separation".
- Glossary TRANSFER OF CONTROL: "That action whereby the responsibility for the separation of an aircraft is transferred from one controller to another." https://www.faa.gov/air_traffic/publications/atpubs/pcg_html/glossary-t.html (CALL FOR RELEASE / RELEASE TIME: glossary-c.html, glossary-r.html)
- ICAO Doc 4444 10.1.2.2.1-4, 12.3.5.2 (quotes above): https://www.bazl.admin.ch/dam/it/sd-web/jMIWMg9YgaoW/4444_cons_en.pdf (older consolidated amendment level; check current edition for numbering).
- EUROCONTROL guidelines 3.4 ("Transfer of communications needs to be established with transfer of control"; recommends comms before control) and 3.5 Release: https://www.eurocontrol.int/sites/default/files/2023-06/guidelines_for_atc_coordination_and_transfer_of_control_ed-2-0.pdf
- VATSIM (secondary, search snippet only): https://forums.vatsim.net/topic/12702-understanding-handoffs-and-coordination/
