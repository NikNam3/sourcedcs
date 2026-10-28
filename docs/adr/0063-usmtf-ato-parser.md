# 0063 — USMTF ATO parser: text in, mission lines out, and nothing written

## Context

Guide §9.9 (WP7) asks EFSP to *"ingest USMTF-style ATO sets and map them onto FDRs"*, and WP7's first acceptance bullet is *"an ATO fixture produces mission Strips with correct mission number, package, vul window, controlling agency and IFF codes"*. Two lanes split that: this one (L3) parses, and L14 (ADR `0071`) turns the result into mission Strips through `CreateStrip` (ADR `0054`).

Four facts shaped the decision.

1. **The only input is USMTF** (decision H1). atobrief's YAML is atobrief-internal, and atobrief exports USMTF (lane L11). So this parser has no YAML adapter and crc-sync gains no YAML dependency.
2. **The sources are not the standard.** MIL-STD-6040 is Distribution Statement C and was not consulted. §9.9 itself says its set breakdown comes from a DCS community wiki (the 455 vAEW guide), and the guide's companions `EFSP-Research-Annex.md` / `EFSP-Coordination-Annex.md` (which `[Annex §14.3]` points into) **are not in this repository**. `docs/parallel/research/usmtf-ato.md` cross-checks the wiki against an AFIT paper, an NPS thesis and Combined Ops' DCS ATO generator, and fixes one "recommended reading" per set. The wiki contradicts itself on AMSNDAT, MSNACFT, ARINFO and CONTROLA.
3. **Most ATO values have no FDR write path.** `createFdr`'s flat seed carries the mission set of ADR 0026 (`missionNumber`, `packageId`, `controllingAgency`, `vulWindowStartUtc`/`EndUtc`) and the identity basics. It silently ignores unknown keys and always mints a beacon code. `identity.modeOne`/`modeTwo` have "no setter anywhere", and `setMilitary` refuses `arInfo`/`scl` by name. `fdr-store.js` is shared by other lanes, and this lane may not edit it.
4. **The guide's §6.4 M-numbers are not Block ids.** Guide M3/M4/M5/M7 are mission type / IFF Mode 1-2 / datalink / controlling agency; `MISSION_BLOCK_MAP`'s `M3`/`M4`/`M5`/`M7` are callsign / beacon / controlling agency / vul end (ADR 0026, confirmed by ADR 0052).

## Decision

### A pure parser in `crc-sync/src/efsp/ato/`, and nothing else

| File | Does |
|---|---|
| `usmtf-tokenize.js` | text → sets: linear, columnar (name starts with a digit), free text (`AMPN`/`NARR`/`GENTEXT`/`RMKS`), `KEY:value` descriptors, `-` as empty, wrapped fields, a classification line before the first set |
| `usmtf-time.js` | DTG → epoch ms, resolving a missing month/year against `TIMEFRAM` |
| `ato-sets.js` | one extractor per set |
| `ato-structure.js` | sets → header, task units, missions |
| `ato-mapping.js` | missions → mission lines, packages, AR links; `ATO_FIELD_TARGETS` |
| `ato-ingest.js` | `parseAtoText`, `ingestAtoText` (never throws) |

It requires only `code-allocator.js` (pure). It does **not** require `fdr-store.js`, `airspace-config.js`, `stereo-routes.js` or `facility-config.js`, which read config at require time: a test loads the parser in a fresh process and checks `require.cache`. The two constants it needs from `fdr-store.js` (the 1–7 alphanumeric callsign rule and `MAX_FREE_TEXT`) are duplicated, and parity tests run the real `createFdr` against them.

It creates no FDR, no Strip and no beacon code, and touches no Board file. The §9.9 source caveat is in the header of every parser module, and a test asserts it (WP7 bullet 3).

### Output: one line per `MSNACFT`

A formation is one Identity with `flightSize > 1` (§3.2 rule 2), so a line is one `MSNACFT` set, not one aircraft. Two `MSNACFT` sets in a mission give two lines sharing the mission number (`0101A#0`, `0101A#1`). A repeated mission number gets a `~2` key.

Each line has S-Q50's four keys at the top level, plus S-R2-8's metadata:

| Key | Holds |
|---|---|
| `lineId`, `sourceLines`, `provenance` | metadata: the line id, the ATO line of each set, and `{source:'ATO', set, line}` per seeded FDR path |
| `fdrSeed` | **only** `createFdr` seed keys: `callsign`, `flightSize`, `aircraftType`, `unit`, `homeStation`, `missionNumber`, `packageId`, `controllingAgency`, `vulWindowStartUtc`, `vulWindowEndUtc`. `callsign` is `null` when the normalised callsign breaks the 1–7 rule |
| `military` | `{ alertStatus, scl, arInfo }`, shaped as `fdr.military` holds them |
| `extras` | `{ identityAto: { modeOne, modeTwo, modeThree, datalink }, ato: { … } }`. `ato` carries the normalised callsign (always, per H1), `seedable`, `missingAcceptanceFields`, and every ATO value with no FDR home |
| `warnings` | this line's warnings, including its mission's |

The document also returns `packages`, `arLinks` (the AR join table), `unmappedSets`, document-level `warnings` and the `heuristics` the parse used.

`ATO_FIELD_TARGETS` (exported data) names, for every value: the set and field it comes from, where it lands on the line, the FDR path it targets, the guide M-number (comment-level only), today's Block id, and `writePathToday` (`createFdr` / `setMilitary` / `none`). A test pins that every `createFdr` row is an `fdrSeed` key and the reverse.

### The ATO's Mode 3 is reported, never seeded

`extras.identityAto.modeThree` only. It is never `identity.beaconAssigned` and never in `fdrSeed`: guide §3.10.3 rule 3 makes ATO-vs-ATC Mode 3 a reconciliation where *"the ATC code is authoritative by default"*, and ADR 0054 leaves to WP7 whether an ATO-created FDR mints a code at all. It is validated with `code-allocator`: a reserved code warns `MODE3_RESERVED` and a 6000–6777 code warns `MODE3_SYNTHETIC`, and both are **kept**, because the controller must see what the ATO said.

### Readings (all `[SOURCE-DEFINED]` or `[COMMUNITY]`, none doctrine)

Descriptors first, position second. Every positional fallback is recorded in `heuristics`.

- **AMSNDAT**: the 12-field form (variant B: residual indicator first, a DTG after each of `DEPLOC`/`ARRLOC`), which AFIT and Combined Ops agree on. The 9-field wiki list (variant A) is the fallback when field 1 is not a single letter, with info `AMSNDAT_VARIANT_A`. `DEPLOC`/`ARRLOC` are always found by key.
- **MSNACFT**: fields 1–5 by position. If the set has exactly 11 fields and fields 9/10/11 hold Mode 1/2/3 tokens or `-`, it is the research note's `[PROFILE]` shape (`L16 callsign / TACAN / JU / M1 / M2 / M3`), which atobrief's export writes. Otherwise the IFF slots are found by walking back up to three trailing fields that are empty or IFF-shaped, and the last non-empty field in between is the datalink code (`DATALINK_AMBIGUOUS` when there are several). An IFF token is the mode digit and the code: `1dd`, `2dddd` or `3dddd`, octal. A wrong length or a non-octal digit gives `IFF_MALFORMED`.
- **ARINFO**: `NAME`/`ARCT`/`NDAR`/`KLBS`/`PFREQ`/`SFREQ`/`ACTYP` by key; positions 1 (tanker callsign), 2 (tanker mission number), 3 (tanker Mode 3) and 5 (altitude); the first `BOM|CDT|BOOM|DROGUE` as the AR system; the first `18-81`- or `38Y`-shaped field as the TACAN. The wiki's list is one off from its own example from position 11 on, and nothing else is read.
- **CONTROLA**: f1 agency type, f2 callsign, f3/f4 primary/secondary (a descriptor or a bare frequency), f5 the report-in point, f6 comments. Agency types live in **one table** (`CONTROL_AGENCY_TYPES`: `AWAC`→AWACS, `CRC`, `OTR`→OTHER). H45 leaves the real vocabulary (ABM/IC/RADAR) open, so adding a type is a one-line change. An unknown type warns and is kept raw.
- **Scoping**: every set belongs to the mission opened by the latest `AMSNDAT`. `TASKUNIT`, `SVCTASK` and `TSKCNTRY` close it. `PKGCMD` (in member missions) and `9PKGDAT` (in the commander's mission) do **not** close it. Repeated `GTGTLOC` is legal (S-L3a); a second `AMSNLOC`, `CONTROLA`, `REFTSK` or `PKGCMD` warns `DUPLICATE_SET`, and the first wins.
- **Vul window** (guide M6): `AMSNLOC` start/stop; else the earliest `GTGTLOC` NET (or TOT) to the latest NLT (or TOT); else the 7CONTROL time on station as a start with no end. `extras.ato.vulSource` says which one was used.
- **Controlling agency** (guide M7): the `CONTROLA` callsign, normalised (`MAGIC 11` → `MAGIC11`, so it matches the agency's own line); else the callsign of the mission whose `7CONTROL` lists this one (info `AGENCY_FROM_7CONTROL`). Type and frequencies go in `extras.ato.control`. The field is free text, so the 7-character callsign rule does not apply to it.
- **Package** (guide M2): the `AMSNDAT` package id; else `PKGCMD`; else a `9PKGDAT` row naming the mission. The commander is the `MC` mission, then `PKGCMD`, then the mission carrying `9PKGDAT`.
- **Alert status** (guide M16): an empty field gives `NONE` and any value gives `ALERT`, with the raw value kept. The ATO never yields `SCRAMBLE`, which is an event, not a tasking. The field's real vocabulary is not public.
- **Callsigns**: upper-case, then drop spaces, `-` and `_`. The result is never abbreviated (defect D11). A line whose normalised callsign breaks the 1–7 rule is `seedable: false` with `CALLSIGN_INVALID`, and is still returned. Every join (5REFUEL receiver, 7CONTROL row, ARINFO tanker) matches on the mission number first, then on the normalised callsign, and never on raw text.

### Times

Every `*Utc` value is epoch milliseconds, like every other time on the FDR (Q6), and the raw DTG always rides beside it (`vulRaw`, `departure.raw`, `onStationRaw`, `arctRaw`…). A DTG without a month or year is placed inside the ATO's `TIMEFRAM`, or else nearest its midpoint. With no `TIMEFRAM`, the caller's explicit `referenceUtc` stands in: L14 passes in-game Zulu (H11). With neither, the value is `null` with `TIME_UNRESOLVED`. The wall clock is never a default. Non-`Z` zones are not converted.

These epochs are the **ATO's** dates. How the ATO date relates to the DCS mission date is still open (R2-9), so the parser bakes in no policy; L14 applies one to the raw DTGs.

### AR links are joins, not MARSA

An `ArLink` is `{ tankerMissionNumber, tankerCallsign, receiverMissionNumber, receiverCallsign, arctUtc, offloadKlb, arcp, windows[], sources, tankerLineId, receiverLineId, resolved }`, built from the receiver's `ARINFO` and the tanker's `5REFUEL` and deduplicated per tanker/receiver pair. A second `ARINFO` for the same pair is another refuel window. When the two sources disagree, the receiver's `ARINFO` wins (`AR_LINK_CONFLICT`). `resolved` is `BOTH`, `TANKER_ONLY`, `RECEIVER_ONLY` or `TANKER_NOT_A_MISSION`. It carries no MARSA, regime or separation field, and a test asserts that: MARSA is its own store with an interlock (ADR 0051).

### Where this changes earlier ADRs

- **ADR 0026**: `mission.vulWindowStartUtc`/`vulWindowEndUtc` had only ever held `null`. This ADR types them as epoch ms (a number), like every other `*Utc` field. Block `M6`/`M7` (0026) will render a raw number until L14 adds a formatter.
- **ADR 0026/0052**: the guide's M-numbers are cited in comments and in `ATO_FIELD_TARGETS.guideM` only. No Block is added or renamed.

## Alternatives considered

- **Parse atobrief YAML too** (the briefing's original default). Rejected by H1: USMTF is the interface, and a second input format would be a second parser to keep in step with atobrief.
- **Put Mode 1/2 and `arInfo`/`scl` into the seed.** `createFdr` would silently drop them, so a test would "pass" while nothing was written. Instead they sit in `extras.identityAto`/`military`, and `ATO_FIELD_TARGETS` says `none`.
- **Seed the ATO's Mode 3 as the beacon.** Rejected: it breaks §3.10.2 rule 9 / §3.10.3 rule 3 and would pre-empt ADR 0054's open question.
- **Seed `filed.departureAirport`/`destinationAirport`/`requestedAltitude` from `DEPLOC`/`ARRLOC`/`AMSNLOC`.** Rejected under D-4 (guide §14.1): flight plans are filed independently of the ATO, and the tower chain must not come to depend on ATO ingest.
- **Abbreviate long callsigns** (`LIGHTNING 01` → `LTNG01`). That would be an invented convention (D11). A configured abbreviation table is squadron data, which the human can decide on.
- **Close the open mission at `9PKGDAT`/`PKGCMD`** (the briefing's reading). The research note shows they sit inside missions, so that reading would orphan every set after them.
- **A single regex over the whole message.** Replaced by a cursor scan with a 1 MiB cap and no nested quantifiers, and a test runs pathological input in under a second.

## Consequences

- WP7 bullet 1 is met for the **parser half** only. A test runs every seedable line of both fixtures through the real `createFdr` and checks the mission number, package, vul window and controlling agency on the FDR. The IFF codes are checked on the line, because no FDR write path for them exists. "Mission Strips" are L14's. WP7 bullet 3 (the caveat) is met and asserted.
- **Hand-offs to L14**: every `ATO_FIELD_TARGETS` row with `writePathToday: 'none'`:
  - mission type;
  - departure/recovery;
  - package commander;
  - IFF Mode 1 and Mode 2 (`identity.modeOne`/`modeTwo` need a setter);
  - the ATO's Mode 3 (reconciliation);
  - datalink;
  - SCL (`military.scl`, which `setMilitary` refuses);
  - AMSNLOC altitude;
  - time on station;
  - report-in point;
  - control type and frequencies;
  - `arInfo` for receiver and tanker (`military.arInfo`, which `setMilitary` refuses);
  - remarks.

  L14 also owns the `CreateStrip` calls, whether an ATO line mints a beacon, the Mode 3 binding, the AR-join rendering, `CHG` (amendment) messages, the ATO-date-to-mission-date policy (R2-9), and a formatter for epoch-ms `mission.*` values.
- Every guess the parser makes is listed above and in `heuristics`. If MIL-STD-6040 ever becomes available, these are the lines to check first.
- A long DCS-style callsign (`ENFIELD11`, `DARKSTAR1`) is unseedable by design until the human decides on an abbreviation table.
- The L11↔L3 round trip is the integrator's test after both merge (S-R2-7).
