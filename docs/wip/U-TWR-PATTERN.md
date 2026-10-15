# U-TWR-PATTERN: no RSU; the tower works the pattern (ADR 0126)

Lane notes, 2026-10-15. Branch `lane/U-TWR-PATTERN` from `78e46d85`. Rulings H149, H150 (TWR-Q1 a, REL-Q1 b), H147 RQ5/RQ7,
H138 U15, H128. ADR: `docs/adr/0126-no-rsu-the-tower-works-the-pattern-on-its-ordinary-strips.md`. Mockup:
`docs/mockups/lc-pattern.html` (linked from `docs/mockups/index.html`; the RSU card there is marked void).

## What was built

- **RSU removed** everywhere (server Position tables, Incirlik facility config, client topology/formation/runway/NLA
  tables, tests, e2e `l18-incirlik` test 03 and the RSU sign-ons in `l18-incirlik` and `par-panel`). `pattern-board.js`
  stays (PriFly mounts it); only `RSU_LEGS` went (fallback legs are PriFly's). Carrier untouched.
- **Cells** `9J-ENTRY` (P/S: PAT/STR) and `9J-OPTION` (OPT: T&G/FS/LA) on DEPARTURE and ARRIVAL, on the flight data
  (`assigned.patternEntry`, `assigned.patternOption`), click-to-cycle on LC's arrivals and departures and AP's arrivals.
- **ARRIVAL state `TRAFFIC_PATTERN`** (LC), Bay `lc-pattern`, tab reads `ARR · IN PATTERN` (grey).
- **NLA steered by the cells**: PAT → In pattern; in pattern → On Final; T&G/LA on final → Closed traffic (back into the
  pattern); FS/empty → Landed → Taxi In to GC. The other outcome is legal by drag (`alsoLegal`).
- **Ops `JoinPattern` / `LeavePattern`** (LC only, ⋯ "Closed traffic" / "Leave pattern"): DEPARTED departure ↔ ARRIVAL in
  the pattern, in place (¶3-8-2). New Board rule `fieldAirport` (required-rules: 61).
- **Frequency audit** fixes (below).

## Usage-guide wording (for the docs pass; the guide is not this lane's)

> **The tower's pattern (ADR 0126).** There is no RSU. LC works pattern traffic on its ordinary Strips. Two cells sit on
> LC's arrivals and departures (and AP's arrivals, so AP can note what the pilot wants before handing over): **P/S** (PAT
> = enter the pattern, STR = straight-in) and **OPT** (T&G, FS = full stop, LA = low approach). Click a cell to step
> through its values; whoever holds the Strip sets them. The next-step button follows them: an arrival with PAT goes
> **In pattern** into the `lc-pattern` Bay (its tab says IN PATTERN); from there **On Final**; on final a T&G or LA
> brings it back with **Closed traffic**, a full stop is **Landed** and then **Taxi In** to GC as always. If the pilot
> changes his mind, change the cell, or drag the Strip to the other Bay. A local departure that wants closed traffic:
> on its airborne Strip, ⋯ **Closed traffic** (it becomes an arrival in the pattern, same Strip and code; it never goes
> to AP). An aircraft departing the pattern: ⋯ **Leave pattern** (it becomes a departure again) and then **Hand Off to
> AP**, or **Drop** a VFR flight that leaves; the pilot calls APP like any VFR aircraft. No stop-and-go.

Briefing / glossary: RSU entries are obsolete (H149); `TRAFFIC_PATTERN` is the airfield's "in the pattern" state, not
the carrier's `IN_PATTERN`. CLAUDE.md needs no change (it never named the RSU).

## Defaults taken

1. **IN PATTERN is a state** (`TRAFFIC_PATTERN`), not a Block; the Pattern Rack is a new Bay `lc-pattern` (LC's Bays
   are one Bay per state, so "a Rack in LC's Bay" maps to a Bay tab beside the others). Why in ADR 0126 §3.
2. **State name `TRAFFIC_PATTERN`**, not `IN_PATTERN` (role-blind state sets; the carrier owns `IN_PATTERN`).
3. **Block names** kept from ADR 0120: `9J-ENTRY`, `9J-OPTION`; labels `P/S`, `OPT`; on the flight data, not the Strip.
4. **Local departure into closed traffic** and **leaving the pattern** are in-place strip-type changes (two LC-only op
   kinds) at ¶3-8-2's boundary, rather than a DEPARTURE pattern state or dropping the Strip.
5. `LeavePattern` is allowed from `TRAFFIC_PATTERN` and from `FINAL` (straight off the option), not from `LANDED`.
6. A cell click cycles through empty (clearing is possible); no picker.
7. The cells are also on AP's ARRIVAL face (the briefing: "AP before the transfer"), not on GC's or CTR's.
8. No circuit count, no time in pattern, no advisory (dark cockpit).

## Frequency audit (H147 RQ5)

Searched `crc-sync/src`, `crc-desktop/app` (server and renderer) and `lxsrs_v2` for MHz-like literals and frequency
assignments.

| Where | What | Action |
|---|---|---|
| `crc-desktop/app/public/js/srs-radio.js` | prompt prefilled `'251.000'` (TWR) for an untuned radio | **fixed**: prefill empty |
| `crc-desktop/app/public/js/panels/efsp/airspace-editor.js` | placeholders `139.250`, `251.500` | **fixed**: placeholder `MHz` |
| `lxsrs_v2/lxsrs_v2/client.py:530` and the committed copy `crc-desktop/python-pkg/lxsrs_v2/client.py:530` | `cycle_modulation` sets `251_000_000.0` when a radio leaves intercom with no real frequency | **not fixed** (Python package, two copies, needs a config path into the bridge): finding for a radio/bridge lane |
| `crc-sync/src/efsp/facility-schema.js` | `225.000`/`399.975` | the UHF band limits, not a station: kept |
| comments and messages (`ato-sets.js`, `strip-util.js`, `flight-data-store.js`, `airspace-draft.js` "for example 139.250", `combination-rules.js`, `sfa-state.js`) | examples in text | kept |
| altimetry / sun / K constants (`288.15`, `273.15`, `280.460`, `357.528`) | not frequencies | — |

Every station frequency lives in JSON: `config/comm-card.json`, `config/efsp-facility-*.json` (`positionFrequencies`,
`singleFrequencyApproach`), `config/efsp-airspaces.json` (working/control frequencies), carrier config; each with a
`state/` override as before.

## `state/` actions for the human (before deploy)

- **`state/efsp-facility-incirlik.json`** that still lists `RSU` (positions, classes, letters, consolidation, radars,
  bays) or the `rsu-pattern` Bay: delete it or remove every RSU entry and add the `lc-pattern` Bay (else start-up stops:
  a configured Position with no Position family). Without `lc-pattern` the pattern NLA reports no Bay for the state.
- **`state/efsp-board.json`** holding RSU-owned PATTERN Strips: delete the Board snapshot (and `efsp-mutations.jsonl`)
  or drop those Strips first. (S-ARCH-67's note still applies: a Board with a HANDOFF Strip from before U-RELEASE stops
  start-up anyway.)
- Nothing to do for flight data: the two new keys read as null when absent.

## Tests and gates (this lane)

- crc-sync unit: 2790 → **2800** (new `tests/efsp-scenario-twr-pattern.test.mjs`, 13 walks: cells, PAT+T&G loop, STR
  and drag switch, go-round, authority, closed runway, JoinPattern, LeavePattern to AP and drop, refusals, Undo).
- crc-desktop unit: 1357 → **1365** (new `tests/efsp-twr-pattern.test.mjs`, 7, mirrors held to the server; plus the module-graph check of the new leaf `pattern-rules.js`).
- walk 24/24; freeze 57/57 after `freeze:update` (separate commit, explained); soak:selfcheck PASS; wire surface
  recorded, protocol stays 2.
- e2e lane 7: new `e2e/u-twr-pattern.spec.js` 3/3; `l18-incirlik` all pass; `par-panel` **06 and 07 fail, identically on
  the base commit `78e46d85`** in a scratch worktree here (06: `#par-empty` not shown after signing everything off; 07
  carrier "Radar contact"), so not this lane's; the sharded run reported 270/270 after U-RELEASE, so it may be
  environment- or order-dependent. Worth a look by the supervisor.

## Findings for other lanes

- `lxsrs_v2` hardcodes 251.000 MHz in `cycle_modulation` (above).
- `par-panel.spec.js` 06/07 fail on this machine at base (above).
- U-CARRIER: `pattern-board.js` and PATTERN are now carrier-only; its `rsu-panel.html` mockup is void.
- The docs pass: usage guide, briefing and glossary RSU sections (wording above).

## Walks not done

- A formation in the pattern (split for individual T&Gs): ARRIVAL's split/join eligibility derives from its states, so
  `TRAFFIC_PATTERN` is eligible, but no test walks it.
- The soak driver does not exercise the pattern ops.
