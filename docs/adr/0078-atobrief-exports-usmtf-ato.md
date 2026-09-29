# 0078 — atobrief exports its ATO as USMTF: a pure two-layer exporter, the missing ATO fields in the YAML, and an authenticated HTTP read

## Context

Decision **H1** made USMTF the interface between systems. The atobrief YAML is atobrief-internal. Anything
that exchanges ATO data talks USMTF, and atobrief has to provide a USMTF export. crc-sync (lane L3) parses
USMTF only, and has no YAML adapter. EFSP's ATO binding (L14) fetches the ATO text from atobrief.

Nothing in the standard is public. MIL-STD-6040 is Distribution Statement C and was not consulted. The set
layouts come from `docs/parallel/research/usmtf-ato.md`, which fixes one reading per set from public academic
and community sources. Where the sources disagree (MSNACFT's datalink/IFF positions, ARINFO's 16 vs 17
positions), the note defines a **[PROFILE]** shape, so that our exporter and our parser agree by construction.

Before this change, atobrief held no package id, IFF Mode 1/2, datalink, alert status, explicit vul window,
report-in point, secondary frequency, or tanker/AWACS mission detail. The only Mode 3 codes were in the SPINS C3
table, which the editor fills randomly. **H43** added every one of these to atobrief (YAML, editor and mapper)
in this lane. The briefing's default had been to ship with the existing fields only.

Other decisions this ADR implements:

- **H13:** nothing is theater-specific. Bases, carriers and coordinates come from the package.
- **H14, reversed by H42:** a package is per coalition. `TSKCNTRY` is a per-document value and is never read
  from a global.
- **H16:** the squadron's `ojw1v5.yaml` is the real-world reference. A trimmed copy with callsigns anonymised
  is committed as a fixture.
- **H44:** the classification line is always `UNCLAS`.
- **H45:** agency types other than AWACS/CRC export as `OTR` until the human decides.

## Decision

### One pure module, two layers: `atobrief/public/js/usmtf-ato.js`

- **Renderer:** `renderUsmtf(doc)`. It turns an ATO *document model* (`AtoDoc`, plain JSON with semantic
  values) into USMTF text.
  - It knows every set the research note profiles: `EXER`/`OPER`, `MSGID`, `AKNLDG`, `TIMEFRAM`, `GENTEXT`,
    `TSKCNTRY`/`SVCTASK`/`TASKUNIT`, `AMSNDAT`, `MSNACFT`, `AMSNLOC`, `GTGTLOC`, `CONTROLA`, `ARINFO`,
    `PKGCMD`, `9PKGDAT`, `REFTSK`, `5REFUEL`, `7CONTROL` and `NARR`.
  - It does all formatting: DTG forms, IFF tokens, frequencies, coordinates, the character set, line
    wrapping and columns.
  - It knows nothing about atobrief.
- **Mapper:** `atobriefToAtoDoc(pkg)`. It knows the atobrief YAML, in both the file shape and the editor's
  runtime shape (tankers as a dict, the injected `ato.targets`, header values copied into sections). It knows
  nothing about USMTF layout.
- `buildUsmtf(pkg) = renderUsmtf(atobriefToAtoDoc(pkg))`. Warnings from both layers are merged and aggregated
  per code and mission. A gap ("no Mode 1/2") becomes one info per export that lists the missions.
- It is a UMD file. The browser loads it as `window.UsmtfAto`, and the server `require`s the same file. It
  touches no DOM, no `STATE`, no `jsyaml`, no `Date.now()` and no `Math.random()`.

The split means a future YAML field touches only the mapper, and a future USMTF reading touches only the
renderer. The renderer is golden-tested against the research fixture on its own terms.

### Shapes ([PROFILE], from the research note)

- **`MSNACFT`** has a fixed 11 fields: `count/ACTYP:type/callsign/cfg1/cfg2/L16cs/TACAN/JU/M1/M2/M3`. The IFF
  slots are fixed because a JU address such as `20011` has the same shape as a Mode 2 token.
- **`ARINFO`** has a fixed 16 positions, after the 455 vAEW example: `-` in 11, 14 and 15, and the TACAN in 16.
- **`AMSNDAT`** has a fixed 12 fields (the research note's variant B).
- The other linear sets drop trailing `-` fields, but never below their mandatory count.
- Columnar sets pad each column except the last to its longest value plus 1.
- Lines are at most 69 characters.
  - Linear sets wrap only directly after a `/`, with a 5-space indent.
  - Free text wraps after a space, which stays at the end of the line.
  - So deleting "newline plus leading whitespace" gives back the logical set exactly. That is L3's un-wrap rule.
- The character set is `A–Z 0–9 space . , - ( ) : +`. Anything else, including `/` inside a value, becomes a
  space and raises a warning. `+` in loadout codes is emitted, since both ends are ours.

### Mapping choices

- **Time.** Every DTG is in-game UTC. The date is `header.ato_date` (or the runtime `ato.ato_day`).
  - A time earlier than `ato.ingame_start_time` goes on the next day, with month and year rolling.
  - `TIMEFRAM TO` is FROM + 24 h − 1 min.
  - There is **no wall-clock `ASOF`**. The research note suggested an export-time ASOF. It is left out because
    it has no in-game meaning and would make the output non-deterministic. `header.usmtf.asof` sets one
    explicitly. Freshness is carried by the HTTP `Last-Modified` header instead.
- **Mission number.** A leading `MSN` is stripped (`MSN1896` → `1896`), as in SPINS C3 and miztoyaml. It is the
  join key downstream.
- **Classification (H44).** The first line is always `UNCLAS`. There is never a `DECL`. A package that says
  otherwise raises the info `CLASSIFICATION_FORCED_UNCLAS`.
- **Control agency (H45).**
  - `AWACS` maps to `AWAC`, and `CRC` stays `CRC`.
  - Anything else (`ABM`, `IC`, `RADAR` in real packages) maps to `OTR`, with the info `AGENCY_TYPE_OTR`. The
    agency's callsign still names it.
  - The mapping is one table, `AGENCY_TYPE_MAP`, so the human's answer is a one-line change.
- **Location.**
  - A mission with NET/NLT targets gets one `GTGTLOC` per timed target, with the DMPI taken from the target's
    coordinates.
  - Otherwise it gets `AMSNLOC`. The window is the explicit `vul` if present, else the first target's
    TOS/TOFFS. The name and altitude come from the first orbit steerpoint.
  - The derived `_vul_start`/`_vul_end`/`_marshal_time` are IP/EP/marshal times and are **never** exported.
- **Unit.** A missing `unit` falls back to `header.usmtf.default_unit`, else `SOURCE DCS`. `TASKUNIT ICAO:`
  comes from `registry.units.<unit>.base`, else from the first mission's `deploy` if that is a key of
  `registry.airfields`. A carrier id is never taken for an ICAO.
- **Defaults.** `EXER`, `SOURCEDCS AOC`, `US` and `F` are module constants. `header.usmtf` overrides them per
  package.

### New optional YAML fields (H43)

All of them are optional. Their absence gives `-` and a gap info, never an invented value.

| Path | Fills |
|---|---|
| `header.usmtf.{message_kind, originator, serial, asof, country, service, default_unit}` | `EXER`/`OPER`, `MSGID`, `TIMEFRAM ASOF`, `TSKCNTRY`/`SVCTASK`, default unit |
| `registry.units.<unit>.{base, remarks}` | `TASKUNIT ICAO:`, `GENTEXT/UNIT REMARKS` |
| `missions[].package_id`, `package_commander` | `AMSNDAT` f4/f5, `PKGCMD` (members), `9PKGDAT` (commander) |
| `missions[].iff.{mode1, mode2, mode3}` | `MSNACFT` IFF slots. `mode3` wins over SPINS C3 (`IFF_SPINS_MISMATCH` when they differ) |
| `missions[].datalink.{l16_callsign, tacan, ju}` | `MSNACFT` f6–f8 |
| `missions[].alert_status`, `priority`, `narrative`, `vul.{start, end}` | `AMSNDAT` f8, `AMSNLOC` f5, `NARR`, `AMSNLOC` f1/f2 |
| `missions[].control.{report_in_point, check_in_time, secondary_freq_mhz}` | `CONTROLA` f4/f5; `7CONTROL` RIP and TOSTA (TOSTA = check-in, else the first TOS, never an IP time) |
| `missions[].refuel[].offload_klb` | `ARINFO KLBS:`, `5REFUEL OFLD` |
| `registry.tankers.<id>.{mission_number, arcp, system, offload_klb, alert_offload_klb, fuel}` | `ARINFO` f2/f3/f4/f13, `REFTSK`, `5REFUEL` |
| `registry.control_agencies.<id>.{secondary_freq_mhz, mission_number}` | `CONTROLA SFREQ:`, `7CONTROL` in the agency's own mission |

**Tankers and AWACS are ordinary missions** (`REFUELING`/`AEW`). The registry entry names its mission through
`mission_number`, which gives:

- the ARINFO tanker mission number and Mode 3, taken from that mission;
- `REFTSK`, plus one `5REFUEL` row per receiver `refuel[]` entry, in ARCT order;
- `7CONTROL`, with one row per mission controlled by that agency.

This reuses the mission editor for the support missions' IFF, times and units, and they show in the ATO views.
The rejected alternative was a nested mission block on the registry entry. A referenced tanker or agency with no
linked mission raises the info `SUPPORT_MISSIONS_NOT_EXPORTED`.

The editor gained these inputs:

- **Mission form:** PACKAGE, IFF / DATALINK, ATO (alert status, priority, vul, narrative), the CONTROL extras,
  and a per-refuel offload.
- **Registry:** the tanker and agency fields, and a UNITS category.
- **Times editor:** a USMTF header block.

Codes are text inputs, so that leading zeros survive. Refuel entries now merge onto the original entry, so
YAML-only keys survive an edit.

### HTTP: `atobrief/usmtf-api.js`

- **`GET /api/rooms/:id/ato.usmtf`** returns the briefing room's current package.
  - Success is `text/plain`, with `ETag` (the sha1 of the text), `Last-Modified` (the room's `packageUpdatedAt`,
    stamped in `package-loaded`), `X-Usmtf-Warnings` and `Cache-Control: no-store`.
  - `?report=1` returns JSON `{text, warnings}`, and `If-None-Match` returns `304`.
  - Errors are `404` (no room or no package) and `422` (a YAML error, or exporter errors such as
    `NO_ATO_DATE`).
- **`POST /api/usmtf`** is stateless: `text/yaml` in (route-scoped `express.text`, 1 MB), with the same
  responses.
- Both routes sit behind a limiter (60/min) and **`requireUsmtfReader`**, which accepts a bearer that is either:
  1. `ATOBRIEF_USMTF_TOKEN`, compared in constant time (copied from sourcedcs-web's `checkReleaseUploadToken`)
     and read once at startup. An unset token disables this path, and it never matches an empty bearer. This is
     crc-sync's machine path.
  2. a JWT with a non-empty `roles` array and an unexpired `exp`. **This is an unsigned decode, so it is
     forgeable.** It is the same bar as atobrief's own page gate. It adds protection and removes none, because
     presentees already receive the whole package YAML over the socket without authenticating.

  The alternative, verifying the signature against Casdoor's certificate, needs new configuration and was left
  for later.

### In-app export

The EXPORT dialog gains a third format, **USMTF**. It opens a preview with the warnings, COPY and DOWNLOAD
(`<operation>_<ato_date>.usmtf.txt`). Presentees can export too.

## Consequences

- **The contract with L3 is semantic equality with the research note's §3 fixture.** Exact bytes are not the
  contract, because the fixture was laid out by hand: no single greedy line limit reproduces its wrap points,
  and two columns carry one space less than the uniform padding rule.
- The tests check:
  - the renderer's output against the fixture after un-wrapping;
  - `sample-package.yaml` (every H43 field set): its export is semantically equal to the fixture, and it maps to
    exactly `research-sample.doc.json`;
  - byte goldens of our own output: `research-render.txt` and `ojw1v5-export.txt`.
- An export of a package that predates H43 is valid but thin. M2/M4/M5/M16 are empty, and the gap infos say so.
  L3 flags the same per mission (H1), so L14 falls back to callsign binding.
- The room API holds only what a presenter has loaded. Rooms are in memory and die on close or restart. The
  stateless POST covers files that are not in a room. A persisted "published ATO" slot is left for when L14
  needs one.
- `ATOBRIEF_USMTF_TOKEN` has to be wired into `infra/docker-compose.yml` and `.env.example` by the integrator.
  Until then the service path is disabled in production, and the JWT path still works.
- miztoyaml does not emit the H43 fields yet. That is lane L25 (S-R2-10).

## Defaults taken (briefing §10)

- **Q1:** strip `MSN`.
- **Q3:** emit loadout codes verbatim.
- **Q5:** the service token or a role-bearing JWT.
- **Q6:** `EXER`, overridable per package.
- **Q7:** `SOURCE DCS`/`US`/`F`, overridable per package.
- **Q9:** one `GTGTLOC` per timed target. L3 exempts repeats from `DUPLICATE_SET` (S-L3a).
- **Q10:** no SPINS C1.3 mapping. The package fields replace it.
- **Q11:** the DMPI is the target's coordinates.
- **Q12:** the room API plus the stateless POST.
- **Q2 → H44** (always `UNCLAS`), **Q4 → H43** (the datalink slots are filled when set), **Q8 → H45** (`OTR`,
  still open).

## Alternatives considered

- **Ship with existing fields only (the briefing's A1 default).** This was superseded by H43. The two-layer
  split was designed for it, so the H43 work touched only the mapper and the editor.
- **Refuse any non-`UNCLAS` package (the research note).** Every real package is marked `CLASSIFIED` as role
  play, so refusing would have made the feature useless. H44 forces `UNCLAS` instead.
- **Map `ABM`/`IC`/`RADAR` to `CRC`.** That is a squadron-semantics call, left to H45.
- **A YAML adapter in crc-sync.** Ruled out by H1.
