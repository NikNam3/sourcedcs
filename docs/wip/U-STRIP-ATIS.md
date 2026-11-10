# U-STRIP-ATIS: the ATIS code on every ARRIVAL Strip and on GC's and LC's DEPARTURE Strips

Human, 2026-11-10 ("fix now"): "all Arrival strips and the GC and LC strips for departing aircraft need the ATIS in the
strip".

## What it was

- Block 10 (`assigned.atisCode`, label ATIS) was on the **DEPARTURE** Block Map only. The ARRIVAL Block Map had no
  Block 10 at all (its header comment listed 11/14/16/17/18 as not carried over; 10 was simply missing), so an ARRIVAL
  could not record the code even in the expanded view.
- On a face, Block 10 was on **CD's** DEPARTURE row only (`strip-fields.js` `COMPACT_BLOCKS_BY_POSITION`). GC and LC
  reached it in the expanded view (▼) only.
- No Facility hides it (`hiddenBlocks` is `{}` in every shipped facility file), and no code prefills it.

## What it is now

- **Block Maps** (`crc-sync/src/efsp/block-map.js`, client mirror `strip-template.js`): ARRIVAL gains
  `'10': { required: true, target: flightData assigned.atisCode }`, label ATIS, the same field as DEPARTURE's. Required
  like DEPARTURE's, so no Facility's `hiddenBlocks` can drop it. Its tooltip is the DEPARTURE one, inherited by
  `ARRIVAL_TITLES` ("ATIS code (ours, facility-directive space 10-18)"), which is right for TBL 2-3-3 too.
- **Faces** (`strip-fields.js`): ATIS on every ARRIVAL (the GC, LC, AP and CTR rows and the strip type's fallback, so
  any other Position that holds an ARRIVAL shows it as well), and on the DEPARTURE rows of GC and LC (after the runway
  cell). CD keeps its own. OPS, AP, CTR departures unchanged (expanded view).
- **Editable**: a face cell is a SetBlock; the owner may write any Block its strip type's Block Map has, so nothing in
  authority changed. The ARRIVAL and the DEPARTURE of one flight share one flight data record, so the code is one value
  per flight, whichever Strip it was typed on.

## The layout is keyed by Position id (lane rule 9)

`COMPACT_BLOCKS_BY_POSITION` (ADR 0056, older than ADR 0132) is keyed by literal Position ids (`GC`, `LC`, `AP`, `CTR`).
No role table exists on main yet (U-ROLE-POSITIONS is held). This lane added `'10'` to the existing GC and LC rows and
added **no** new id-keyed row or rule; the ARRIVAL half needs no id at all (every row and the fallback). When
U-ROLE-POSITIONS resumes, these rows become role rows and the ATIS entries move with them unchanged. The comment in
`strip-fields.js` says so.

## FAA basis

- **JO 7110.65BB ¶2-3-4, TBL 2-3-3 (terminal arrival) and TBL 2-3-4 (terminal departure), blocks 10-18**: *"Enter data
  as specified by a facility directive."* (quoted in `docs/parallel/research/live-test-faa.md` Q5). There is **no
  national ATIS block**: the code goes in the facility-directive space, which is where our Block 10 already sits. So 10
  is the right block on both strip types; no other block was invented.
- **¶2-9-2 / ¶2-9-3 (ATIS operating procedures and content)**: the broadcast asks the pilot to advise on initial contact
  that the information was received, by its code letter; the controller asks for the code when the pilot does not state
  it and gives changes after that. **Caveat:** faa.gov answered 403 to this lane, so the ¶2-9-2/2-9-3 wording above is
  from memory, not re-checked against the current text. The supervisor or a research lane should confirm the paragraph
  letter before an ADR quotes it.
- Related, same caveat: ¶3-9-1 (departure information may be omitted when the pilot states the ATIS code) and ¶4-7-10
  (approach information, the same rule for arrivals), which is why the code matters to GC at taxi, LC at the runway and
  to every arrival Position.
- **Difference from the request:** none of substance. The FAA leaves which strips carry the code to the facility
  directive; the human's request is our facility directive.

## Defaults taken

1. **No prefill** from the airport's current ATIS letter (`apt-config.js` `info`). The Strip records what the pilot
   reported ("with information X"); nothing in the code prefilled it before.
2. **Required: true** on ARRIVAL, as on DEPARTURE (a Facility cannot hide it). TBL 2-3-3 lets a facility manager omit
   10-18; ours is the opposite directive.
3. **Face position**: after the runway cell (8A on a departure, 8B on an arrival), the runway and the ATIS being read
   together.
4. **No stale-code mark.** A grey mark when the recorded code is not the airport's current letter is **not built**: the
   client holds the letter per airport key (`settings.aprtAtisInfo`, from the `apt-config` frame) and a Strip names its
   airport by ICAO (`filed.departureAirport`; an ARRIVAL has no destination field of its own, the landing airport is the
   Facility's), so it needs a Facility-to-airport mapping and a new renderer branch. **Suggestion** for a follow-up lane:
   grey ATIS cell text (dark cockpit, no colour) when `atisCode` is set and differs from the Strip's airport's current
   letter, on the face only.

## Tests

- `crc-desktop/tests/efsp-strip-fields.test.mjs`: new test, ATIS on every ARRIVAL face (every row, an unlisted
  Position, none) and on CD/GC/LC departures, not on OPS/AP/CTR departures; same target on both strip types. 24/24.
- `crc-sync/tests/efsp-block-map.test.mjs` and `crc-desktop/tests/efsp-strip-template.test.mjs`:
  `REQUIRED_ARRIVAL_BLOCKS` gains `'10'`. 61/61 and 77/77.
- Not run (supervisor): the block-map parity test (both sides edited identically), `efsp-ui-reachability.test.mjs`
  (the new ARRIVAL Block must be reachable; it is on every ARRIVAL face), freeze, wire, Playwright.

## For the supervisor

- **Freeze**: `tests/freeze/freeze-tables.test.mjs` hashes every Block Map (`blockMap.ARRIVAL`: one more id), so the
  `freeze-tables` golden changes; `npm run freeze:update`, commit it separately.
- **Wire**: `tools/wire-surface.js` does not scan Block Maps, so `wire:record` should show no change. A SetBlock of
  `'10'` on an ARRIVAL is new content: an old crc-sync refuses it as VALIDATION_ERROR (unknown Block). Whether that
  needs `wire:record -- --bump` is the supervisor's call; a crc-desktop release redeploys crc-sync anyway.
- **e2e**: no spec found that pins the GC/LC departure or any ARRIVAL face list exactly (`l4-density`, `mtr-fields`,
  `l2-block-editing` checked); none edited.
