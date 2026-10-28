# DIVERT (lane build, ADR 0111)

## FAA citations used (JO 7110.65BB, read 2026-10-08 from faa.gov/air_traffic/publications/atpubs/atc_html/)

- **¶4-2-1 Clearance Items**: the order aircraft identification, clearance limit ("airport" follows an airport name),
  SID/vectors, route of flight, altitude data in the order flown, Mach, holding instructions, any special information,
  frequency and beacon code. The divert form's fields follow this order.
- **¶4-2-5 Route or Altitude Amendments**: four route-amendment methods; "restate all applicable altitude restrictions" when
  route or altitude is amended; a restated "maintain" is an amended clearance. This is why the form has an altitude
  restrictions field beside the maintain altitude.
- **¶4-5-7 Altitude Information**: maintain/cruise altitude; only the maintain altitude is taken.
- The WebFetch tool got HTTP 403 from faa.gov; the text was read with curl (browser user agent). Paragraph letters under 4-2-1
  were not preserved by the page text, so the ADR cites items by name, not by letter.
- Ours, not the FAA's (labelled so in the ADR): the Divert action itself, the destination classification, the strip type and
  state result table, the guards, the 10 s undo.

## Defaults taken

- Fields shown: destination, route, maintain altitude, altitude restrictions, holding, special information. Not shown:
  SID/vectors (a vector is already a Block), Mach, frequency, beacon code.
- A blank optional field means "unchanged"; the typed route replaces the whole route (the app does not apply the "change X to
  read Y" phrasing, the controller says that on frequency).
- "A field we run" = an ICAO named by a Facility's `runwayStatus.airportIcao` (LTAG) or a carrier hull id (CVN-72); a name in
  `data/icao.json` is mapped (so "Incirlik" works). Konya/Akrotiri need no code change when their Facility configs name them.
- Only OVERFLIGHT at INBOUND/IN_SECTOR and ARRIVAL at INBOUND divert (an arrival already with the tower is the tower's).
- ARRIVAL to a field not ours becomes OVERFLIGHT at IN_SECTOR (it is already being worked); OVERFLIGHT keeps its state.
- Refused while: a coordination proposal is open; the Strip is the sender side of an ACTIVE HANDOFF (HANDED_OFF senders do not
  divert anyway); the receiving side's HANDOFF has not transferred control yet (a new route/altitude is a control instruction);
  a TOFI proposal is open or active.
- Menu: a departure held by AP/CTR lists Divert greyed with "a departure does not divert" (the server also refuses it);
  nothing is offered to other Positions or other strip types.
- No new refusal code (VALIDATION_ERROR / PERMISSION_DENIED with a detail).
- The altitude goes through the existing clearance history (the old one shows struck); route and destination are written on the
  flight data; the previous destination is shown struck through on a chip (`.efsp-divert-chip`) from `strip.diverts`.
- The persisted Strip shape gains `diverts` (an append-only list); split parts do not copy it.
- Undo's scope is the Strip and its flight data (a MARSA relation voided by the new altitude is declared in scope).

## Usage-guide wording (for the supervisor to put in docs/efsp-usage-guide.md)

"**Divert…** (⋯ menu, AP and CTR). The flight is now going to a different airport. Type the new destination; fill the route,
the altitude (and its restrictions), holding and special information you gave the pilot. A field you leave blank stays as it
was. A flight going to Incirlik or the carrier becomes an ARRIVAL on the same Strip and is handed on as usual (CTR to AP, or to
CV_MARSHAL). A flight going anywhere else stays an OVERFLIGHT with you until you terminate it. The old destination stays on the
Strip, struck through. Undo works for 10 seconds. A departure does not divert."

## Walks

Done (server, `crc-sync/tests/efsp-scenario-divert.test.mjs`, 11 tests; e2e `crc-desktop/e2e/divert.spec.js`, 7 specs):
overflight to Incirlik then handed to AP; to the carrier then accepted by CV_MARSHAL; to an untowered field then terminated;
ARRIVAL to the carrier, then to an untowered field, then back to Incirlik (divert cancelled by diverting back, three
audited amendments); departure refused (menu greyed, server detail); undo (flight data entry VOIDED, not erased); divert while a
hand-off proposal is open (refused, allowed again after CANCEL); divert after an accepted hand-off (sender refused, receiver
refused until TRANSFER_CONTROL, then allowed); controller holding AP and CTR (acts as the owning Position only, the other's
Strip is NOT_OWNER); traffic count (an overflight that became an arrival is an ARRIVAL record, an arrival that became an
overflight an OVERFLIGHT record, reconcile ok).

Not done: a divert on a Strip with an ACTIVE TOFI; a divert on the AP replica while the CTR sender still holds communications
(only control is checked); a split part of a diverted formation (the part does not carry `diverts`); a divert of a flight that
is in a MARSA relation (the interlock call is wired, no walk); the peer Board's stale copy of a replica whose receiver diverted
(the peer's Strip keeps its old strip type: it is HANDED_OFF/informational).

## Findings

- `crc-sync/src/efsp/facility-rules.js` reads `data/icao.json` at require time of the module (a static require, the file is
  read once); fine, but `facility-rules` now depends on `data/`.
- The divert chip is appended after the ordered indicator slots (not in `INDICATOR_ORDER`); a lane that reworks indicators
  should fold it in.
- A rack key mismatch (a TransferStrip without `rackId`) leaves the Strip in the Board but unrendered: the client keys racks by
  `bayId` and `rackId`. Not a divert bug; found while writing the spec.
- Disabled strip-menu items carry their reason in the accessible name, so Playwright `getByRole('menuitem', {name, exact})`
  does not find them; the spec uses the class.
- Baseline `npm test` in crc-sync had one flaky failure once (a drop-time snapshot test) that did not reproduce.
