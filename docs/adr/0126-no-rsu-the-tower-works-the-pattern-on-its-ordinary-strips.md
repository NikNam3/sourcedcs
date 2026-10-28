# 0126: No RSU; the tower works the pattern on its ordinary Strips

**Status.** Accepted (lane U-TWR-PATTERN, 2026-10-15). Rulings: decisions.md **H149** (no RSU in the CRC suite; the
tower gets the pattern features), **H150** (TWR-Q1 **a**: on LC's ordinary Strips, cells, a grey IN PATTERN mark and a
Pattern Rack in LC's Bay, no separate board; REL-Q1 **b**: transfers inside a Facility stay plain), **H147** RQ5 (no
station frequency hardcoded anywhere) and RQ7 (no stop-and-go), **H138** U15 (traffic leaving the pattern calls APP like
any VFR aircraft), **H128** (FAA model, always), dark cockpit (H115–H119).

**Supersedes** ADR 0120 in full (its RSU Position, `HANDED_TO_RSU`, `CancelIfr`, `IFR_NOT_CANCELLED`,
`NOT_HOME_BASED`, `NOT_WITH_RSU`, the `rsu-list` Bay and `LeavePattern { reason }`; ADR 0120 is not edited) and ADR 0075's
RSU half (the RSU Position, its `rsu-pattern` Bay and PATTERN Strips). The carrier keeps `PATTERN` / `IN_PATTERN`,
PriFly's pattern board and everything it mounts (U-CARRIER's).

## Context

A real RSU is manned by pilots with only a landline to the tower; it is not an ATC unit (H149). Pattern traffic at a
towered field is the local controller's: the FAA has no separate pattern position. Live test T25 and round 2 (U14, U15)
had built toward an RSU list; H149 removed the RSU and gave the pattern features to LC, and H150 chose the form: LC's
ordinary Strips, not a board.

What the FAA says (JO 7110.65BB with Chg 1–3; the ¶3-8-2 and ¶3-10-11 quotations were read on faa.gov on 2026-10-14
for ADR 0120, ¶5-10-13 for `docs/parallel/research/live-test-faa.md`; faa.gov refused a fetch on 2026-10-15, HTTP 403,
so nothing was re-read for this ADR):

- **¶3-8-2**, TOUCH-AND-GO OR STOP-AND-GO OR LOW APPROACH: *"Consider an aircraft cleared for touch-and-go, stop-and-go,
  or low approach as an arriving aircraft until it touches down (for touch-and-go), or makes a complete stop (for
  stop-and-go), or crosses the landing threshold (for low approach), and thereafter as a departing aircraft."*
- **¶3-10-11**, CLOSED TRAFFIC: *"Approve/disapprove pilot requests to remain in closed traffic for successive
  operations subject to local traffic conditions."*
- **¶5-10-13 a**, TOWER CLEARANCE: *"When an aircraft is on final approach to an airport served by a tower, obtain a
  clearance to land, touch-and-go, or make low approach."* The three outcomes the tower clears on final are the three
  options of the OPT cell.
- **¶3-10-5** (landing clearance, including the option) and **AIM 4-3-3** (traffic patterns, entry and straight-in) /
  **AIM 4-3-22** (option approach) are the pilot-side and phraseology references for the two cells. Not quoted here
  (not re-read this lane, see above); the cells record what the pilot asked for and LC cleared, they issue nothing.

## Decision

### 1. No RSU

The RSU Position goes from everything: `config/efsp-facility-incirlik.json` (roster, class, letter, consolidation row
`"RSU": ["LC"]`, radar selector, the `rsu-pattern` Bay), `authority/positions/incirlik-military.js` (its capability
row: `CreateStrip` of PATTERN, `IN_PATTERN`/`RECOVERED` ownership, `requestsRunwayStatus`), the client topology,
formation, runway-status and NLA owner tables, and every spec and test. INCIRLIK has six Positions. `handoff-guards.js`
stays as an empty seam (nothing uses it now). PATTERN's owners are `CV_PRIFLY` only.

### 2. The pattern cells: Blocks `9J-ENTRY` and `9J-OPTION` (ADR 0120's names, kept)

| Cell | Block | Values (flight data) | Shown |
|---|---|---|---|
| **P/S** | `9J-ENTRY` → `assigned.patternEntry` | `PATTERN` (PAT), `STRAIGHT_IN` (STR), null | PAT / STR / empty |
| **OPT** | `9J-OPTION` → `assigned.patternOption` | `TOUCH_AND_GO` (T&G), `FULL_STOP` (FS), `LOW_APPROACH` (LA), null | T&G / FS / LA / empty |

- On the **DEPARTURE and ARRIVAL** Block Maps, `flightData`-routed: they live on the flight data, so they survive the
  in-place strip-type changes of §4 and need no new target kind. `flight-data-store.js` validates the enums
  (`PATTERN_ENTRIES`, `PATTERN_OPTIONS`; `''` clears); no stop-and-go (H147 RQ7).
- Set by an ordinary **`SetBlock`** (audited, ordinary ownership): whoever holds the Strip, so AP before the transfer and
  LC after. On the face of LC's arrivals and departures and AP's arrivals (`strip-fields.js`); a click steps PAT → STR →
  empty, T&G → FS → LA → empty (`CYCLE_BLOCKS`, `strip-template.js`).
- **Ours**: the two cells. The FAA has no strip block for pattern intent; the tower writes it in free space.

### 3. IN PATTERN is an ARRIVAL state, `TRAFFIC_PATTERN`, and LC's Bay `lc-pattern` implies it

ARRIVAL gains **`TRAFFIC_PATTERN`**, owned by **LC**. `lc-pattern` (rack `main`, `impliesState: TRAFFIC_PATTERN`) sits
between `lc-arrivals` and `lc-final`: that Bay is the Pattern Rack (H150), and a drag into it is the mark's other gesture.
The Strip's tab reads **`ARR · IN PATTERN`** in the tab's ordinary grey (no colour, no extra chip; dark cockpit).

Why a state and not a Block: the mark has to move the Strip between Bays and steer the NLA, and per-state authority,
Bay placement, the runway gate and the RWY chip already hang off the state (one mechanism, not a second). The name is
not `IN_PATTERN` because Bay `impliesState` and correlation eligibility are role-blind string sets and the carrier's
PATTERN already owns `IN_PATTERN` (the strip-type naming rule in `strip-types/marshal.js`).

The NLA, steered by the cells (`strip-types/arrival.js`):

| From | Cells | NLA | Also legal by drag |
|---|---|---|---|
| `HANDED_TO_TOWER` | P/S = PAT | → `TRAFFIC_PATTERN` "In pattern" (no runway gate: joining the pattern is not landing) | `FINAL` (unless the runway is suspended or closed) |
| `HANDED_TO_TOWER` | STR or empty | → `FINAL` "On Final" (runway gate, as before) | `TRAFFIC_PATTERN` |
| `TRAFFIC_PATTERN` | any | → `FINAL` "On Final" (runway gate) | — |
| `FINAL` | OPT = T&G or LA | → `TRAFFIC_PATTERN` "Closed traffic" (¶3-8-2, ¶3-10-11) | `LANDED` |
| `FINAL` | FS or empty | → `LANDED` "Landed", then Taxi In to GC unchanged | `TRAFFIC_PATTERN` |

Neither step out of `FINAL` is ever runway-gated: what the aircraft did is an observation (the rule `FINAL → LANDED`
already followed). `TRAFFIC_PATTERN` joins the client's RWY-chip and gear-check states and the surveillance hints
(`AIRBORNE`); it is correlation-eligible.

### 4. Joining from a departure and leaving the pattern: `JoinPattern` and `LeavePattern` (¶3-8-2)

¶3-8-2 makes an aircraft in the option an arrival until touchdown or the threshold, and a departure after. Two Board op
kinds change the Strip's type in place at that boundary (same Strip, flight data, code and correlation; the leg's
annotations and flags archived on `previousLeg`, as ADR 0023's `ConvertToArrival` does), `board/ops/pattern.js`:

- **`JoinPattern`**: a DEPARTURE LC holds at `DEPARTED` becomes an ARRIVAL at `TRAFFIC_PATTERN` in `lc-pattern`. A local
  departure stays in closed traffic with LC and never goes to AP (the need behind ADR 0120's RQ10, now LC's). Block 8 of
  the arrival (`filed.originAirport`) is set from the departure airport.
- **`LeavePattern`**: an ARRIVAL LC holds at `TRAFFIC_PATTERN` or `FINAL` becomes a DEPARTURE at `DEPARTED` in
  `lc-airborne`. Then the ordinary LC departure flow applies: Hand Off to AP, or Drop when a VFR flight leaves (the pilot
  calls APP like any VFR aircraft, H138 U15). `filed.departureAirport` is set to the field (`runwayStatus.airportIcao`,
  through the new Board rule `fieldAirport`).
- A full stop needs neither: it is the ordinary Landed → Taxi In to GC.
- Both refuse an open coordination or TOFI proposal and active tactical control, and anyone without the state's
  authority. They are held by **LC alone** (`PATTERN_OP_KINDS`, a literal grant like `FORMATION_OP_KINDS`, never in
  `OP_KINDS`); undoable (ADR 0100 strip scope). The client offers them in the ⋯ menu as **Closed traffic** and **Leave
  pattern** (`pattern-rules.js`).

Why two op kinds and not an extended `ConvertToArrival`: that op is AP/CTR's boundary op (`AP_CTR_ONLY_OP_KINDS`), and
the pattern ones are the tower's; one grant each keeps both tables literal.

### 5. Transfers inside the Facility stay plain (REL-Q1 b)

AP → LC and AP → PAR remain ordinary TransferStrips (no Released switch, no check-in); ADR 0122's release model is
Facility to Facility only. Nothing changes here.

### 6. Frequencies (H147 RQ5)

Every station frequency comes from JSON (`config/comm-card.json`, the facility files' `positionFrequencies` and
`singleFrequencyApproach`, airspace definitions; a `state/` copy overrides). The two client literals this lane found are
gone (the SRS prompt's `251.000` prefill, the airspace editor's example placeholders). The audit, and one literal left in
the `lxsrs_v2` Python package, are in `docs/wip/U-TWR-PATTERN.md`.

## Wire, freeze, `state/`

- **Wire**: op kinds `JoinPattern` and `LeavePattern` are on the scanned surface (`npm run wire:record`: protocol stays
  2, the last release speaks 1). The new state, Blocks, Bay and flight data keys ride with it.
- **Freeze**: goldens re-recorded in their own commit (six Positions, the new state, Blocks and ops; a new scenario
  golden for `tests/efsp-scenario-twr-pattern.test.mjs`).
- **`state/`** (strict, ADR 0095): a `state/efsp-board.json` holding any RSU-owned Strip, or a
  `state/efsp-facility-incirlik.json` naming RSU, stops start-up or leaves Strips with a Position nobody can sign on to;
  delete or correct them before deploying. A saved flight data without the two new keys reads them as null.

## Consequences

- The tower's pattern is on the Strips it already works; no second board, no extra handoff, and the FAA's arrival /
  departure boundary is the strip type.
- A pattern flight's Strip changes type at each Join/Leave; its remarks, code, cells and correlation stay, its
  annotations go to `previousLeg` (one leg deep, as `ConvertToArrival`).
- No count of circuits or time in the pattern is kept (dark cockpit; nothing asked for it).
- The carrier's PATTERN strip type, its `IN_PATTERN` state and PriFly's pattern board are unchanged.

## Alternatives considered

- **The mark as a Block (flag), state untouched.** Rejected: a touch-and-go would need `FINAL → HANDED_TO_TOWER`
  backwards, and the Pattern Rack would be a Bay with no state, outside the per-state authority and runway gates.
- **A DEPARTURE `TRAFFIC_PATTERN` state too.** Rejected: a full stop would then need ARRIVAL's landed/taxi-in states on
  DEPARTURE; ¶3-8-2's boundary is cleaner as the strip type.
- **Leaving the pattern always ends the Strip** (ADR 0120's `LeavePattern`, H147 RQ8). Rejected for the IFR or
  radar-handed case: the briefing asks for the ordinary departure flow (to AP, or drop); a VFR flight still ends with a
  Drop and calls APP (U15).
