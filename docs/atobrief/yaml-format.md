# ATO BRIEF — Package File Format

A **package file** is a single YAML file that contains a `schema_version`,
shared metadata blocks, and one or more of the five data sections below.
Any subset of data sections is valid; the viewer will enable only the tabs
for which data is present.

```yaml
schema_version: "1.0"        # required format version

header:   { ... }   # shared operation metadata (propagated to all tabs)
registry: { ... }   # canonical reference definitions (callsigns, freqs, airfields)

ato:     { ... }   # Air Tasking Order (drives ATO, Timeline, and Map tabs)
aco:     { ... }   # Airspace Control Order (ACO tab)
spins:   { ... }   # Special Instructions (SPINS tab)
comms:   { ... }   # Frequency Preset Table (COMMS tab)
weather: { ... }   # Mission weather forecast (WX tab)
```

---

## `schema_version:`

Top-level string that identifies the file format version.  Currently the only
accepted value is `"1.0"`.

```yaml
schema_version: "1.0"
```

---

## `header:` — Shared Operation Metadata

The `header` block holds fields that apply to the entire package.  The viewer
propagates `operation`, `ato_date`, and `classification` to every tab
(ACO, SPINS, COMMS, Weather), so individual sections no longer need their own
`operation` / `ato_day` / `classification` fields.

`ato_date` is the **in-game mission date** (taken from `["date"]` in the DCS
`.miz` file when using the miztoyaml converter).  `ato.irl_date` is a separate
field for the real-world date when the briefing takes place.

```yaml
header:
  operation: CLEAR SKY
  ato_date: '2026-01-11'   # in-game date — propagated to all tabs as ATO DAY
  classification: UNCLAS
```

| Field | Type | Description |
|-------|------|-------------|
| `operation` | string | Operation name (displayed on every tab header) |
| `ato_date` | string | **In-game** ATO date in `YYYY-MM-DD` format; auto-populated from the `.miz` `["date"]` block |
| `classification` | string | Classification marking (e.g. `UNCLAS`, `SECRET`) |

---

## `registry:` — Canonical Reference Definitions

The `registry` block defines entities once so they can be referenced by key
throughout the rest of the file.  It contains: `callsigns`,
`airfields`, `carriers`, `tankers`, `targets` (with nested aim points),
`bullseye` (single reference point),
`reference_points` (named positions),
`steerpoints` (merged IP/EP/MARSHAL/WP waypoints shared across flights),
`lines` (reference/planning polylines, e.g. FLOT or coordination lines),
`control_agencies` (AWACS, CRC), and `frequencies` (net/callsign metadata
for each frequency used in the COMMS channel assignments).

### `callsigns:` (map)

A mapping of callsign name → metadata.  The callsign is the group / flight
name used throughout the file.  AWACS flights are excluded here and appear
in `control_agencies` instead.

```yaml
registry:
  callsigns:
    SHADOW-1:    { type: F16C, role: CAP flight lead }
    TEXACO:      { type: KC135, role: TANKER }
    ROUGH RIDER: { type: CVN, role: Carrier }
```

| Field | Type | Description |
|-------|------|-------------|
| `unit` | string | Operating unit (optional) |
| `type` | string | Platform / aircraft type |
| `role` | string | Role description |

### `airfields:` (map)

A mapping of ICAO code → full airfield data.  Airfields are read directly
from the registry by the map and ATO views — there is no separate `ato.airfields` list.

```yaml
registry:
  airfields:
    OMAM:
      name: Al Dhafra AB
      coords: N24°14'36" E054°27'07"
      elevation_ft: 77
    OMSJ:
      name: Sharjah Intl
      coords: N25°19'42" E055°31'06"
      elevation_ft: 111
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable name |
| `coords` | coord string | Position (DMS format — see [Coordinate strings](#coordinate-strings)) |
| `elevation_ft` | number | Field elevation in feet |
| `runways` | string or list | Runway designators (e.g. `"12L/30R"` or `["12L", "30R"]`).  Displayed in the map popup when present; not required |

### `carriers:` (map)

A mapping of carrier id → carrier data.  Carriers are plotted on the map
directly from this registry — no separate `ato.carriers` list is needed.

```yaml
registry:
  carriers:
    CVN-71:
      name: USS ROOSEVELT
      callsign: ROUGH RIDER
      brc: 045
      deploy_coords: N24°30'00" E059°15'00"
      recovery_coords: N24°45'00" E059°30'00"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Ship name |
| `callsign` | string | Callsign (also used as an ICAO-like key for route resolution) |
| `brc` | integer | Base Recovery Course — ship's heading during recovery operations, in degrees |
| `deploy_coords` | coord string | Estimated position at start of ATO window |
| `recovery_coords` | coord string | Estimated position at end / recovery window |

### `tankers:` (list)

A **list** of tanker entries.  Missions reference tankers by callsign via
`refuel.tanker_id`.  The `miz-to-yaml` tool populates this automatically
from tanker flights (including orbit altitude and speed extracted from the
DCS route).

```yaml
registry:
  tankers:
  - callsign: TEXACO
    altitude_ft: 19000
    speed_kts: 370
    orbit_direction: ccw
  - callsign: SHELL
    altitude_ft: 24000
    tacan: 39X
    speed_kts: 400
    orbit_direction: ccw
```

The altitude display (e.g. `FL240`) is derived at render time from `altitude_ft` — no separate string field is needed.

| Field | Type | Description |
|-------|------|-------------|
| `callsign` | string | Tanker group / callsign — matches `refuel.tanker_id` |
| `altitude_ft` | integer | Refueling altitude in feet (from DCS orbit params); displayed as `FL{alt/100}` |
| `speed_kts` | integer | Refueling speed in knots (from DCS orbit params) |
| `freq_mhz` | number | Primary frequency in MHz — displayed on the tanker strip |
| `tacan` | string | TACAN channel (e.g. `39X`) — displayed as a badge on the tanker card |
| `orbit_anchor_coords` | coord string | Orbit anchor point DMS coordinates |
| `orbit_heading_deg` | integer | Hot-leg heading in degrees true |
| `orbit_leg_nm` | number | Hot-leg length in NM |
| `orbit_width_nm` | number | Track width (turn diameter) in NM |
| `orbit_direction` | string | Orbit direction: `cw` (clockwise) or `ccw` (counterclockwise).  Default is `ccw` |

### `targets:` (map)

A mapping of target id → target data with optional nested `aim_points`.
Targets are shared reference entities — multiple missions can reference the
same target.  Missions reference targets via `target.target_id`.

```yaml
registry:
  targets:
    SAM-1:
      name: SA-2 Guideline
      type: SA-2          # short NATO designation — keys into sam_database.json
      coords: N26°30'00" E056°20'00"
      elevation: 150ft
      aim_points:
        - id: TGT-A
          name: TGT-A
          coords: N26°30'00" E056°20'00"
        - id: TGT-B
          name: TGT-B
          coords: N26°33'00" E056°22'00"
```

`engagement_range_nm` and `max_alt_ft` are **not stored in YAML** — they are
resolved at load time from `atobrief/data/sam_database.json` using `type` as
the lookup key, and stored as `_engagement_range_nm` / `_max_alt_ft` (runtime
prefix `_` = not persisted).  The database maps short NATO designations such as
`SA-2`, `SA-10`, `PATRIOT`, `HAWK` etc. to their range and altitude envelope.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `type` | string | Short NATO SAM designation (e.g. `SA-2`, `SA-10`, `PATRIOT`) — resolves threat data from `sam_database.json` |
| `coords` | coord string | Position |
| `elevation` | string | Target elevation (e.g. `E350FT`) |
| `aim_points` | list | Optional nested aim points (see below) |

**Nested aim points** are sub-points of a target for precision weapon delivery.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique aim point identifier |
| `name` | string | Display name |
| `coords` | coord string | Position |

### `bullseye:` (object)

A single object defining the bullseye reference point for the package.
Displayed in the intel strip on the ATO tab.

```yaml
registry:
  bullseye:
    name: COYOTE
    coords: N26°51'19" E056°21'37"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in the intel strip |
| `coords` | coord string | Position |

### `reference_points:` (list)

A list of named positional references for non-bullseye geographic points
that multiple flights might reference (e.g. marshal holds, IP names).

Marshal points are managed as shared steerpoints (see `steerpoints`
in the `registry` block) and no longer appear in `reference_points`.

Mission-specific steer points (SP1, SP2, SP3 chains) do **not** belong here —
they stay in the mission's `steer_points` block.

```yaml
registry:
  reference_points:
    - name: MARSHAL NORTH
      type: marshal
      coords: N27°05'00" E056°10'00"
      altitude: FL200
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `type` | string | Descriptive type string (e.g. `marshal`, `ip`) |
| `coords` | coord string | Position |
| `altitude` | string | Altitude reference (e.g. `FL200`) — optional |

### `steerpoints:` (list)

Registry steerpoints shared across multiple flights.  When two or more
flights have a **special waypoint** (IP, EP, MARSHAL, or generic WP) of the
**same type** within **1000 ft in 2D (horizontal) distance** and with
**compatible names** (both unnamed, or both carrying the same name), they
are collapsed into a single steerpoint.

Each steerpoint is defined once here with a unique ID.  Individual flights
reference it via `{ id: SSP-1, time?: '2046Z' }` in their `steer_points`
list instead of duplicating coordinate data.

When multiple waypoints are merged, the centroid position is the average
lat/lon, and the **maximum altitude** of the cluster is kept (i.e. the
highest-altitude flight's value wins — altitude differences are not averaged).

```yaml
registry:
  steerpoints:
    - id: SSP-1
      type: ip
      name: WEST
      coords: N35°24'25" E038°07'30"
      altitude_ft: 15000
    - id: SSP-2
      type: ep
      coords: N35°30'00" E038°15'00"
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique steerpoint identifier (e.g. `SSP-1`) |
| `type` | string | Waypoint type: `ip` (Ingress Point), `ep` (Egress Point), `marshal` (Marshal Point), `wp` (generic waypoint) |
| `name` | string | Optional sub-name (e.g. `WEST` from a waypoint named `IP WEST`) |
| `coords` | coord string | Centroid position (average lat/lon of all merged points) |
| `altitude_ft` | number | Maximum altitude across all merged points |

### `lines:` (list)

Reference / planning polylines — e.g. a FLOT, a coordination line, a border —
drawn on the map as plain dashed lines with **no** route semantics (no speed,
no time-on-station).  These are distinct from a mission's `steer_points`,
which describe the flown path.

The `miz-to-yaml` tool populates this automatically from each unique DTC
cartridge referenced by a flight (F-16: the DTC's `GEO_LINES` planning
points, grouped by the DTC's L1-L4 line flags; F-18: the DTC's real
steerpoints, grouped by its R1-R3 line flags — F-18 has no separate
line-drawing points, so it reuses the aircraft's own waypoints instead). A
cartridge shared by multiple flights only contributes its lines once.

```yaml
registry:
  lines:
    - id: LINE-1
      dtc_cartridge: jasmine_w1_f16
      points:
        - coords: N34°43'46" E36°26'58"
          altitude_ft: 1936
        - coords: N34°12'57" E36°35'01"
          altitude_ft: 5728
          name: CHECKPOINT 2   # optional — set when the DTC point has a note
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique line identifier (auto-generated) |
| `dtc_cartridge` | string | Name of the DCS DTC file this line came from — informational |
| `points` | list | Ordered list of `{coords, altitude_ft?, name?}` — drawn as a single connected polyline |

### `control_agencies:` (map)

A mapping of agency id → control agency data.  Both AWACS and CRC agencies
are defined here.  Each mission's `control.agency_id` references these by key;
callsign and primary frequency are resolved from the registry at load time.
All agencies are listed in the Intel Strip on the ATO tab.

The `miz-to-yaml` tool automatically extracts AWACS groups from the DCS
mission (task=AWACS) and populates this section.  The key is the DCS group
name (which also becomes the `callsign`).

```yaml
registry:
  control_agencies:
    AWACS DARKSTAR:
      type: AWACS
      callsign: AWACS DARKSTAR
      primary_freq_mhz: '251.0'
    SCREWTOP:
      type: CRC
      callsign: SCREWTOP
      primary_freq_mhz: '265.0'
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Agency type: `AWACS` or `CRC` |
| `callsign` | string | Agency callsign / group name |
| `primary_freq_mhz` | string | Primary frequency in MHz |

### `frequencies:` (list)

A deduplicated list of every frequency used in the COMMS channel assignments.
Each entry holds the canonical frequency value plus optional net/callsign
metadata.  Because a frequency can only belong to one net and one purpose,
the metadata is defined once here rather than repeated inside every flight's
channel preset table.

The `miz-to-yaml` tool automatically populates this list from DTC files and
non-DTC Radio channel presets.  `callsign` and `role` are `null` by default;
fill them in manually (or via the Registry editor) to annotate each net.

```yaml
registry:
  frequencies:
  - freq_mhz: 243.0
    callsign: GUARD
    role: Emergency
  - freq_mhz: 260.0
    callsign: PACKAGE
    role: Package primary
  - freq_mhz: 360.1
    callsign: INTRAFLIGHT
    role: Intraflight
  - freq_mhz: 133.3
    callsign: null
    role: null
```

| Field | Type | Description |
|-------|------|-------------|
| `freq_mhz` | number | Frequency in MHz — the unique identifier for this entry |
| `callsign` | string or null | Net / station callsign |
| `role` | string or null | Free-text role description |

---

## Coordinate strings

All `coords` / `anchor_point` / `center` / `boundary` values are strings in
**DMS (degrees-minutes-seconds) format** using the `°` symbol (Unicode U+00B0):

```
N26°30'00" E056°20'00"
```

| Rule | Detail |
|------|--------|
| Hemisphere | `N`/`S` and `E`/`W` prefix, required, before the degrees |
| Degrees | Whole number followed by `°` (U+00B0 — not `\xb0` or `&deg;`) |
| Minutes | Whole number followed by `'` |
| Seconds | Whole number (no decimals) followed by `"` |

YAML files must be **UTF-8 encoded** so the `°` character is stored as bytes
`0xC2 0xB0`.  The `miztoyaml.py` tool always writes UTF-8.  If you author YAML
by hand, ensure your editor is set to UTF-8.

The viewer reformats every stored coordinate on the fly when you switch the
`DM / DMS / MGRS` toggle, so no re-authoring of the YAML is needed when
changing display modes.

## Time strings

All event times are four-digit **Zulu** strings in `HHMMz` format:

```
'2040Z'
```

- Always include the `Z` suffix.
- Always quote times in YAML to avoid the value being parsed as an integer:
  `not_earlier_than: '2040Z'`
- No local times are stored in the data.  The renderer uses
  `ato.local_offset_hours` to convert Zulu to local for display.
- Dates use `YYYY-MM-DD` format.  `header.ato_date` is the **in-game** mission date; `ato.irl_date` is the real-world date of the briefing (may differ).

---

## Mission IDs

All mission cross-references use a consistent ID format (e.g. `MSN3266`).
The same IDs are used in:

- `ato.missions[].mission_number`
- `aco.acms[].missions` lists
- `spins` IFF tables and section headings

---

## `ato:` — Air Tasking Order

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `irl_date` | string | Real-world date of the briefing session (`YYYY-MM-DD`) |
| `irl_time_zulu` | string | Real-world start time in Zulu (`HHMMz`) |
| `ingame_start_time` | string | In-game mission start in Zulu (`HHMMz`) |
| `local_offset_hours` | number | UTC offset for the theater (e.g. `4` for UTC+4). Used by the renderer to convert Zulu times to local for display. |
| `codewords` | list | Optional list of time-tagged codewords shown as labeled markers on the timeline (see below) |

### `codewords:` (list)

A list of codewords tied to specific times in the ATO window.  Each codeword
is displayed as a labeled vertical marker on the timeline.  `miztoyaml` leaves
this list absent (blank by default); fill it in manually or via the editor.

```yaml
ato:
  codewords:
    - word: BRAVE SWORD
      time: '2040Z'
    - word: ANVIL
      time: '2115Z'
```

| Field | Type | Description |
|-------|------|-------------|
| `word` | string | Codeword (displayed on the timeline marker) |
| `time` | time string | Time the codeword is executed (`HHMMz` Zulu) |

> **Note:** Airfields, carriers, tankers, and control agencies are all read directly from
> `registry.*` — there are no separate `ato.airfields`, `ato.carriers`, or `ato.support_flights`
> lists.  The bullseye is defined in `registry.bullseye`.

### `support_flights:` (removed)

This section no longer exists.  Tanker orbit data comes from `registry.tankers`
(fields: `orbit_anchor_coords`, `orbit_heading_deg`, `orbit_leg_nm`, `orbit_width_nm`,
`orbit_direction`).  Control agencies are listed in `registry.control_agencies`.

### `missions:` (list)

One entry per tasked mission.  Missions drive the ATO card list, timeline bars,
and map routes.  `mission_number` is the primary identifying field and should
be listed first in each mission entry.

#### Mission identification

| Field | Type | Description |
|-------|------|-------------|
| `mission_number` | string | ATO mission number (e.g. `MSN3266`) — **primary key**, listed first.  Used as the cross-reference ID throughout the file |
| `callsign` | string | Flight callsign |
| `mission_type` | string | `CAP` / `BAI` / `CAS` / `SEAD` / `STRIKE` / `REFUELING` / `OCA` / `DCA` / `DEAD` / `AI` / `ESCORT` / `FAC(A)` / `RECCE` / `ANTISHIP` / `INTERCEPT` / `FERRY` / `TRANSPORT` (drives color coding; unknown types display as `OTHER`) |
| `unit` | string | Operating unit |
| `deploy` | string | Start of route on map — accepts an airfield ICAO, a carrier registry ID (e.g. `CVN-71`), or a carrier callsign |
| `recovery` | string | End of route on map — same resolution as `deploy` |
| `divert` | string | Divert / alternate airfield — display only |
| `dtc_cartridge` | string | Name of the DCS DTC file assigned to this flight (auto-generated by `miztoyaml.py`) |

#### `aircraft:`

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Number of aircraft in the flight |
| `type` | string | Aircraft designation (e.g. `F16C`) |
| `loadout` | string | Loadout code — see [Loadout format](#loadout-format) |

#### `targets:` (list)

A list of one or more target timing entries for this mission.  Each entry links a
registry target to this mission and records TOT/TOS timing.  Full target data
(coords, threat info, aim points) is resolved from `registry.targets` at load time.

| Field | Type | Description |
|-------|------|-------------|
| `target_id` | string | Reference to a target in `registry.targets` |
| `tot_net` | time string | Time on Target — NET (strike/BAI missions: when weapons should be on target) |
| `tot_nlt` | time string | Time on Target — NLT |
| `tos` | time string | Time on Station (CAP/CAS missions: when aircraft should be on station) |
| `toffs` | time string | Time OFF Station (when aircraft departs station) |

**Timing guidance:**
- For **strike/BAI/SEAD** missions, use `tot_net` / `tot_nlt` (Time on Target).
- For **CAP/CAS/orbit** missions, use `tos` / `toffs` (Time on Station / Time OFF Station).
- Both can be specified (e.g. a SEAD flight that must be on station before a strike TOT).

#### Mission-level timing fields

| Field | Type | Description |
|-------|------|-------------|
| `takeoff_time` | time string | Planned takeoff time |
| `recovery_time` | time string | Planned recovery / landing time |

`marshal_time`, `vul_start`, and `vul_end` are **not stored in YAML** — they are
derived at load time from the mission's `steer_points` list by scanning for
registry steerpoint refs whose type is `marshal`, `ip`, or `ep` and that have a
`time` field set.  The derived values are stored as `_marshal_time`, `_vul_start`,
and `_vul_end` (runtime prefix `_` = not persisted).

The **vulnerability window** (`_vul_start` / `_vul_end`) is shown as a red
hatched overlay on the timeline and as a time pair in the detail panel.

#### `steer_points:` (list)

En-route waypoints plotted as hollow circles connected by dashed lines.
Each steer point is either an **inline** coordinate entry or a **registry ref**
pointing to an entry in `registry.steerpoints`.

**Inline entry:** `{coords, name?, altitude_ft?, speed_kts?, route?, time?, orbit?}`

**Registry ref:** `{id: SSP-1, time?: '2046Z'}` — position is resolved from the
steerpoint, coordinates are not duplicated.  A `time` field on a registry ref
is used to derive `_vul_start` (ip type), `_vul_end` (ep type), and
`_marshal_time` (marshal type) at load time.

```yaml
steer_points:
  - coords: N24°30'00" E056°00'00"
    name: SP1
  - coords: N25°15'00" E056°05'00"    # unnamed — route-shaping only, no map label
  - id: SSP-1                          # registry steerpoint ref (ip — sets _vul_start)
    time: '2046Z'                      # time optional; required for ip/ep/marshal
  - coords: N35°24'25" E038°07'30"
    name: ANCHOR                       # orbit/racetrack anchor point
    orbit:
      alt_ft:      25000   # orbit altitude in feet
      speed_kts:   270     # orbit airspeed in knots
      width_nm:    20.0    # track width (turn diameter) in NM
      leg_nm:      49.9    # hot-leg length in NM
      heading_deg: 5       # hot-leg heading in degrees true
      direction:   ccw     # orbit direction: 'cw' or 'ccw' (default: ccw)
```

| Field | Type | Description |
|-------|------|-------------|
| `coords` | coord string | Waypoint position (inline entry) |
| `id` | string | Registry steerpoint ID from `registry.steerpoints` (registry ref entry) |
| `time` | time string | Time at this waypoint; on registry refs of type `ip`/`ep`/`marshal` this derives the VUL window / marshal time |
| `name_ref` | string | Name of an airfield (ICAO) or carrier callsign/ID to use as the waypoint position |
| `name` | string | Waypoint label shown on map; omit for route-shaping points with no label |
| `altitude_ft` | number | Waypoint altitude in feet (optional) |
| `speed_kts` | number | Planned leg airspeed in knots (optional) — set by `miztoyaml.py` from DTC route data |
| `route` | number | Named-route tag (optional, default behaves as one connected path). See **Multiple routes** below |
| `aim_point_id` | string | Informational — set by `miztoyaml.py` when a waypoint overlaps an aim point; ignored by the viewer |
| `orbit` | object | Optional — racetrack orbit at this waypoint (CAP station, tanker track) |
| `orbit.alt_ft` | number | Orbit altitude in feet |
| `orbit.speed_kts` | number | Orbit airspeed in knots |
| `orbit.width_nm` | number | Track width (turn diameter) in NM |
| `orbit.leg_nm` | number | Hot-leg length in NM |
| `orbit.heading_deg` | number | Hot-leg heading in degrees true |
| `orbit.direction` | string | Orbit direction: `cw` (clockwise) or `ccw` (counterclockwise).  Default is `ccw` |

#### Multiple routes

A DTC cartridge can define more than one named route for a flight (e.g. a
separate ingress and egress leg, or alternate corridors) — `miztoyaml.py`
tags each point it pulls from a DTC with `route`, an integer matching the
DTC's own route/line-flag numbering (F-16: `R1`-`R3`; F-18: `NAV_ROUTE`
`route_num`).  Points that aren't part of any named route (e.g. individual
target-cue steerpoints) are tagged `route: 0`.

The map only draws a connecting line between two **consecutive** points in
the list when they're compatible:

- Omitting `route` on both points always connects them (the pre-existing
  behaviour — every hand-written package with no `route` field renders
  exactly as before).
- `route: 0` never connects to its neighbours — the point still shows as a
  marker, just with no line into or out of it.
- Two explicit, differing route numbers (e.g. `1` and `2`) break the line —
  each route is drawn as its own separate leg.
- Deploy and recovery always connect to the first/last steer point in the
  list, regardless of its `route` tag.

```yaml
steer_points:
  - coords: N36°51'46" E35°12'03"
    name: JAKUP
    route: 1        # ingress leg
  - coords: N35°30'04" E36°18'30"
    name: SALIM
    route: 1
  - coords: N37°09'57" E35°41'50"
    name: TOSIE
    route: 2        # separate egress leg — no line drawn from SALIM to TOSIE
  - coords: N33°21'12" E36°32'52"
    name: TS1
    route: 0        # standalone target-cue point — not connected to anything
```

#### `control:`

Mission-level C2 block.  References a control agency from
`registry.control_agencies` by `agency_id`.

```yaml
control:
  agency_id: SCREWTOP      # resolves callsign + primary_freq_mhz from registry
```

| Field | Type | Description |
|-------|------|-------------|
| `agency_id` | string | Control agency id (must match a key in `registry.control_agencies`).  Resolves `callsign` and `primary_freq_mhz` from the registry. |
| `primary_freq_mhz` | string | Override — only needed if the frequency differs from the registry value |

#### `refuel:` (list)

Mission-level refueling list.  Each entry references a tanker in `registry.tankers`
by `tanker_id`.  Only mission-specific timing is stored here; tanker track and
altitude come from the registry tanker definition.  Multiple AAR events per mission
are supported.

```yaml
refuel:
  - tanker_id: ARCO4
    time_from: '2143Z'
    time_to: '2150Z'
  - tanker_id: TEXACO
    time_from: '2220Z'
    time_to: '2230Z'
```

| Field | Type | Description |
|-------|------|-------------|
| `tanker_id` | string | ID of a tanker in `registry.tankers` |
| `time_from` | time string | AAR window open (NET) — shown as a hatched bar on the timeline |
| `time_to` | time string | AAR window close (NLT) |


---

## `aco:` — Airspace Control Order

The ACO no longer needs its own `operation`, `ato_day`, or `classification`
fields — these are propagated from `header`.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | ACO identifier |
| `timezone` | string | Timezone reference (display only) |

### `acms:` (list)

Each ACM (Airspace Control Measure) appears as one row in the ACO table and as
one shape on the map.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ACM identifier |
| `name` | string | ACM display name |
| `type` | string | `ROZ` / `ORBIT` / `MEZ` / `NFZ` / `TRA` / `ANCHOR` (drives color on map) |
| `missions` | list of strings | Mission numbers this ACM supports (e.g. `[MSN3266, MSN3267]`) |
| `alt_lower` | string | Lower altitude bound — defaults to `SFC` when absent |
| `alt_upper` | string | Upper altitude bound — defaults to `UNL` when absent |
| `time_from` | time string | Activation time |
| `time_to` | time string | Deactivation time |
| `control_agency` | string | Agency id from `registry.control_agencies` — callsign and frequency are resolved from the registry at render time |
| `notes` | string | Free-text notes |

#### `geometry:`

The `geometry` sub-key defines the shape drawn on the map.  Use **exactly one**
of the three shape definitions:

**Circle**
```yaml
geometry:
  center: N26°51'00" E056°22'00"
  radius_nm: 20
```

**Polygon** (≥ 3 points)
```yaml
geometry:
  boundary:
    - N26°20'00" E056°05'00"
    - N26°40'00" E056°05'00"
    - N26°40'00" E056°30'00"
    - N26°20'00" E056°30'00"
```

**Anchor / Racetrack** (orbit pattern)
```yaml
geometry:
  anchor_point: N25°30'00" E055°30'00"
  heading_deg: 45       # hot-leg heading in degrees true
  leg_length_nm: 15     # length of each straight leg
  direction: cw         # cw (clockwise) or ccw
```

---

## `spins:` — Special Instructions

SPINS use a flexible `sections` list.  Sections can be added, removed, or
reordered freely without any code changes.

The SPINS section no longer needs its own `operation`, `ato_day`, or
`classification` fields — these are propagated from `header`.

**All standard SPINS sections are auto-generated** by `miztoyaml` from the
ATO data — no separate `spins.md` markdown file is required or supported.
In the web editor, the **GENERATE STANDARD SECTIONS FROM ATO** button
rebuilds all sections from the currently loaded package at any time.

### Standard auto-generated sections

| Section | Source |
|---------|--------|
| **C1 — Command & Control** | C1.1 Tactical Control populated from `registry.control_agencies`; C1.3 Package Lead left empty for manual assignment |
| **C3 — IFF / SIF** | Table auto-built from `ato.missions`: always Mode 3, squawk codes sequential from 4701 (+10 per mission) |
| **C4 — Rules of Engagement** | Populated from the Standard preset; changeable via preset picker or individual entry editing |
| **C5 — Execution** | One block per mission in `ato.missions` with empty OBJECTIVE and DESIRED EFFECTS fields |
| **C7 — Lost Comms** | Standard preset (AWACS / Package / Intraflight loss procedures) |
| **C8 — Abort Criteria** | Standard preset |
| **C9 — Search and Rescue** | "NOT SIMULATED" preset by default |
| **C10 — Authentication** | Daily table preset by default |
| **C11 — Safety** | Standard minimum separation preset |

### Editor workflow

1. Load or create a package YAML.
2. Switch to the **SPINS** tab and enter edit mode (✎ EDIT SPINS).
3. Click **↺ GENERATE STANDARD SECTIONS FROM ATO** to populate all sections
   from the loaded ATO data.  Any existing sections are replaced.
4. Open individual sections to edit them:
   - **C1.1 Tactical Control** — click *↺ REFRESH FROM REGISTRY* to re-pull
     agency data; entries can also be edited manually.
   - **C1.3 Package Lead** — use the callsign dropdown to assign the lead
     from the active ATO missions.
   - **C3 IFF / SIF** — table is pre-filled; edit squawk codes as needed.
   - **C4 ROE / C7–C11** — select a built-in preset from the dropdown
     and click *APPLY PRESET*, or edit entries individually.
   - **C5 Execution** — mission headings are auto-added; fill in OBJECTIVE
     and DESIRED EFFECTS for each mission.  Use *+ HEADING* to add custom
     sub-sections.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | SPINS version |

### `sections:` (list)

Each section has a `title` and then any combination of `note`, `entries`,
and `table`.  All three are optional.

```yaml
sections:
  - title: C1 — COMMAND & CONTROL
    note: Optional single line shown at the top of the section.
    entries:
      - { label: PRIMARY AWACS, value: "MAGIC / 265.1 MHz", style: green }
      - { bullet: "Free-text bullet point" }
      - { heading: "MSN 6011" }
      - { value: Objective text shown in amber }
    table:
      headers: [COL A, COL B, COL C]
      cell_classes: [~, ~, css-class-name]
      rows:
        - [row1a, row1b, row1c]
        - [row2a, row2b, row2c]
```

#### Entry types

| Entry shape | Rendered as |
|-------------|-------------|
| `{label, value, style?}` | Key-value row.  `style` tints the value: `amber` / `red` / `green` / `blue` |
| `{bullet, style?}` | Bulleted line.  `style` tints the text: same color names as above |
| `{heading}` | Mission block header — subsequent entries are indented under it until the next `{heading}` |
| `{value}` (no `label`) | Plain objective text, shown in amber |
| `{type: orbit_reference, ...}` | Structured orbit / positional data — see below |

Coordinate strings embedded anywhere in `label`, `value`, or `bullet` text are
automatically reformatted when the coord display mode changes.

#### `orbit_reference` entry type

A structured entry that replaces embedding positional data in bullet text.

```yaml
- type: orbit_reference
  coords: N25°30'00" E055°30'00"
  anchor: TRACK-1
  bearing_deg: 45
  distance_nm: 15
  style: blue
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Must be `orbit_reference` |
| `coords` | coord string | Reference position |
| `anchor` | string | Name of the associated ACM / anchor point |
| `bearing_deg` | number | Bearing in degrees true |
| `distance_nm` | number | Distance in nautical miles |
| `style` | string | Optional color tint: `amber` / `red` / `green` / `blue` |

#### `table:` sub-key

| Field | Type | Description |
|-------|------|-------------|
| `headers` | list of strings | Column header labels |
| `rows` | list of lists | Table data rows |
| `cell_classes` | list | Optional CSS class per column.  Use `~` (YAML null) for columns with no class |

---

## `comms:` — Frequency Preset Table

The COMMS section no longer needs its own `operation`, `ato_day`, or
`classification` fields — these are propagated from `header`.

Comms are **per-flight**: each flight in the package has its own preset table
derived from its assigned DTC (Data Transfer Cartridge) or from the Radio
channel presets set in the DCS mission editor (for aircraft without a DTC).
This reflects the real-world configuration where different aircraft types
carry different cartridges.

### `flights:` (list) — per-flight channel assignment tables

Each entry corresponds to one flight group.  Both DTC-equipped flights and
non-DTC flights that have Radio channel presets are included.

Channel assignments (`uhf_presets` / `vhf_presets`) map channel number to
the frequency in MHz.  The net callsign and role for that frequency are
looked up from `registry.frequencies` at render time.

```yaml
comms:
  flights:
    - group: SHADOW-1
      callsign: SHADOW-1
      dtc_cartridge: Broomstick_F16   # DTC-equipped flight
      uhf_presets:
        1: 243.0    # freq_mhz — metadata resolved from registry.frequencies
        2: 260.0
        9: 360.1
      vhf_presets:
        1: 121.5
        6: 133.3
    - group: BOLO1
      callsign: BOLO1
      dtc_cartridge: null             # non-DTC flight — Radio presets from mission
      uhf_presets:
        1: 305.0
        2: 264.0
        9: 360.1
      vhf_presets:
        1: 133.0
        5: 133.3
```

| Field | Type | Description |
|-------|------|-------------|
| `group` | string | Flight group name (from ATO) |
| `callsign` | string | Flight lead callsign |
| `dtc_cartridge` | string or null | Name of the DTC file providing these presets; `null` for non-DTC flights |
| `uhf_presets` | map | Channel number → freq_mhz (see below) |
| `vhf_presets` | map | Channel number → freq_mhz (see below) |

### Channel assignment format

Both `uhf_presets` and `vhf_presets` use a mapping from channel number
(integer) to the frequency value in MHz (number).  Only list channels with
assigned frequencies — the viewer automatically fills channels 1–20 with
SPARE entries for unassigned channels.

The net callsign and role for each frequency are resolved from
`registry.frequencies` by matching `freq_mhz`.  To annotate a frequency,
edit the `registry.frequencies` entry with the matching `freq_mhz` value.

```yaml
uhf_presets:
  1: 243.0    # freq_mhz — look up callsign/role in registry.frequencies
  2: 260.0
  9: 360.1
```

### Legacy flat format (backward compatible)

If no `flights` list is present, the viewer falls back to a single shared
preset table using the top-level `uhf_presets` / `vhf_presets` keys.
Inline preset objects `{ callsign, freq_mhz, role }` are also still
supported for backward compatibility.

```yaml
comms:
  uhf_presets:
    1: 243.0
    2: 260.0
  vhf_presets:
    1: 121.5
```

---

## Loadout format

The `aircraft.loadout` field uses a compact code:

```
AAA+NXcccNXccc...
│││ │ └─────── weapon groups (repeating)
│││ └───────── gun ammo present (omit if no gun)
└┴┴─────────── 3-digit air-to-air prefix
```

### Air-to-air prefix (3 digits, required)

Each digit is a **count**:

| Position | Missile type | Typical weapon |
|----------|-------------|----------------|
| Digit 1 | Fox 3 (active radar) | AIM-120 AMRAAM |
| Digit 2 | Fox 1 (semi-active radar) | AIM-7 Sparrow |
| Digit 3 | Fox 2 (IR) | AIM-9 Sidewinder |

### Weapon groups (`NXccc`)

- `N` — quantity (single digit)
- `X` — literal separator character
- `ccc` — weapon code (1–3 digits, see table below)

Groups are concatenated with no delimiter: `3X381X114` = `3×GBU-38` and
`1×AGM-114`.

### Examples

| Code | Meaning |
|------|---------|
| `501+` | 5×Fox3, 0×Fox1, 1×Fox2, gun |
| `301+3X381X114` | 3×Fox3, 0×Fox1, 1×Fox2, gun + 3×GBU-38 + 1×AGM-114 |
| `0004X114` | No AA missiles, no gun, 4×AGM-114 Hellfire |

### Weapon codes

| Code | Name | Category |
|------|------|----------|
| `62` | AGM-62 Walleye | AGM |
| `65` | AGM-65 Maverick | AGM |
| `88` | AGM-88 HARM | AGM |
| `114` | AGM-114 Hellfire | AGM |
| `122` | AGM-122 Sidearm | AGM |
| `130` | AGM-130 | AGM |
| `141` | ADM-141 TALD (decoy) | AGM |
| `154` | AGM-154 JSOW | AGM |
| `158` | AGM-158 JASSM | AGM |
| `179` | AGM-179 JAGM | AGM |
| `10` | GBU-10 Paveway II (2000 lb) | GBU |
| `12` | GBU-12 Paveway II (500 lb) | GBU |
| `16` | GBU-16 Paveway II (1000 lb) | GBU |
| `24` | GBU-24 Paveway III | GBU |
| `27` | GBU-27 Paveway III | GBU |
| `28` | GBU-28 Bunker Buster | GBU |
| `31` | GBU-31 JDAM (2000 lb) | GBU |
| `32` | GBU-32 JDAM (1000 lb) | GBU |
| `38` | GBU-38 JDAM (500 lb) | GBU |
| `39` | GBU-39 SDB | GBU |
| `54` | GBU-54 Laser JDAM | GBU |
| `87` | CBU-87 CEM Cluster | CBU |
| `97` | CBU-97 SFW Cluster | CBU |
| `99` | CBU-99 Rockeye | CBU |
| `103` | CBU-103 WCMD CEM | CBU |
| `105` | CBU-105 WCMD SFW | CBU |
| `82` | Mk 82 (500 lb) | Unguided |
| `83` | Mk 83 (1000 lb) | Unguided |
| `84` | Mk 84 (2000 lb) | Unguided |
| `20` | Mk 20 Rockeye | Unguided |
| `3` | LAU-3 (19× Hydra 70 mm) | Rockets |
| `61` | LAU-61 (19× Hydra 70 mm) | Rockets |
| `68` | LAU-68 (7× Hydra 70 mm) | Rockets |
| `131` | LAU-131 (7× Hydra 70 mm) | Rockets |

---

---

## `weather:` — Mission Weather Forecast

The weather section accepts **raw METAR and TAF strings** exactly as they
appear in a real aerodrome weather briefing.  The viewer decodes and displays
them in human-readable form on the WX tab.

The operation name is propagated from `header` — no separate `operation` field
is needed here.

```yaml
weather:
  issued: '2026-01-11'
  valid_from: '1800Z'
  valid_to: '0600Z'
  metars:
    - 'METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG'
    - 'METAR OMSJ 011850Z 28008KT 9000 SCT035 30/12 Q1012 NOSIG'
  tafs:
    - 'TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040
           BECMG 0122/0124 27008KT
           TEMPO 0200/0202 TS BKN020 4000
           PROB30 0203/0205 TSRA BKN010CB'
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `issued` | string | When this weather package was issued (display only) |
| `valid_from` | string | Start of the valid period (display only) |
| `valid_to` | string | End of the valid period (display only) |
| `metars` | list of strings | Raw METAR / SPECI strings — one per station |
| `tafs` | list of strings | Raw TAF strings — one per station |

### `metars:` — Raw METAR strings

Paste standard ICAO or US-format METAR strings verbatim.  The viewer decodes:

- **Station** — 4-letter ICAO identifier
- **Wind** — direction, speed, gusts (KT, MPS, KMH accepted)
- **Visibility** — metres (`9999`) or US statute miles (`10SM`, `1/4SM`, `M1/4SM`)
- **`CAVOK`** — Ceiling and Visibility OK
- **Present weather** — decoded from ICAO codes (see table below)
- **Sky condition / cloud layers** — `FEW`, `SCT`, `BKN`, `OVC`, `VV`, `SKC`, `CLR`, `NSC`, with altitude in hundreds of feet; `CB`/`TCU` suffixes recognised
- **Temperature / dewpoint** — `T/T` or `M01/M02` (M prefix = below zero)
- **QNH** — `Q1013` (hPa) or `A2992` (altimeter × 100, inHg)
- **NOSIG** — No significant change expected

A **flight category** badge (VFR / MVFR / IFR / LIFR) is automatically computed
from the ceiling and visibility and shown on each station header.

Examples:
```
METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG
KJFK 122151Z 25014G25KT 10SM FEW060 SCT250 22/10 A2997
EDDM 011850Z 18005KT 3000 BR FEW003 OVC005 08/07 Q1016
EGLL 232320Z VRB03KT CAVOK 15/08 Q1022 NOSIG
```

### `tafs:` — Raw TAF strings

Paste standard ICAO TAF strings verbatim.  Multi-line TAF strings work if
quoted as a YAML block scalar or a plain quoted string with spaces.  The viewer
decodes:

- **Station**, issued time, validity period
- **Prevailing (base) conditions** — same elements as METAR
- **Change groups** — decoded type label + time period + changed conditions:

| TAF keyword | Displayed as |
|-------------|-------------|
| `BECMG DDHH/DDHH` | Becoming · Day DD HH:00Z – Day DD HH:00Z |
| `TEMPO DDHH/DDHH` | Temporary · time range |
| `FM DDHHmm` | From · Day DD HH:mmZ |
| `PROBnn DDHH/DDHH` | nn% Probability · time range |
| `PROBnn TEMPO DDHH/DDHH` | nn% Probability — Temporary · time range |
| `PROBnn BECMG DDHH/DDHH` | nn% Probability — Becoming · time range |

Any `PROBnn` value is handled dynamically (PROB20, PROB30, PROB40…).

Example:
```
TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040
    BECMG 0122/0124 27008KT
    TEMPO 0200/0202 TS BKN020 4000
    PROB30 0203/0205 TSRA BKN010CB
```

### Present weather codes

The viewer decodes ICAO present weather codes to plain English.  Common codes:

| Code | Decoded |
|------|---------|
| `RA` | Rain |
| `-RA` | Light Rain |
| `+RA` | Heavy Rain |
| `SN` | Snow |
| `DZ` | Drizzle |
| `TS` | Thunderstorm |
| `TSRA` | Thunderstorm with Rain |
| `+TSRA` | Heavy Thunderstorm with Rain |
| `TSGR` | Thunderstorm with Hail |
| `FZRA` | Freezing Rain |
| `FZDZ` | Freezing Drizzle |
| `FZFG` | Freezing Fog |
| `SHRA` | Rain Showers |
| `SHSN` | Snow Showers |
| `BR` | Mist |
| `FG` | Fog |
| `BCFG` | Patchy Fog |
| `MIFG` | Shallow Fog |
| `HZ` | Haze |
| `DU` | Dust |
| `BLSN` | Blowing Snow |
| `BLDU` | Blowing Dust |
| `VCSH` | Showers in Vicinity |
| `VCTS` | Thunderstorm in Vicinity |
| `VCFG` | Fog in Vicinity |
| `SS` | Sandstorm |
| `DS` | Duststorm |
| `FC` | Funnel Cloud |

Intensity prefixes (`-` light, `+` heavy) and vicinity indicator (`VC`) are
decoded automatically for any code combination.

### Additional weather from `weather.txt`

When extracting a package from a `.miz` file with `miztoyaml.py`, the tool
looks for a `weather.txt` file in the same directory as the `.miz` file.  If
found, any lines starting with `METAR` or `SPECI` are added to `weather.metars`
and any lines starting with `TAF` are added to `weather.tafs`, alongside the
automatically generated METAR from the DCS mission weather settings.

This allows you to provide real-world or customised METAR/TAF strings that
supplement the DCS-generated weather data.

Example `weather.txt`:
```
METAR OMAM 011850Z 31012G18KT 9999 FEW040 SCT080 28/08 Q1013 NOSIG
TAF OMAM 011700Z 0120/0206 30010KT 9999 FEW040 BECMG 0122/0124 27008KT
METAR LTAG 011900Z 22008KT 9999 SCT030 22/12 Q1015 NOSIG
```

---

## USMTF export

atobrief exports the ATO as a USMTF Air Tasking Order (**EXPORT → USMTF**, or
`GET /api/rooms/:id/ato.usmtf` / `POST /api/usmtf`). The design and every choice behind it are in
[ADR 0078](../adr/0078-atobrief-exports-usmtf-ato.md). Every DTG is in-game UTC built from
`header.ato_date`, and the first line is always `UNCLAS`.

| atobrief | USMTF |
|---|---|
| `header.operation` | `EXER`/`OPER` f1 |
| `header.ato_date` + `ato.ingame_start_time` | `TIMEFRAM` (TO = FROM + 24 h − 1 min), `MSGID` month |
| `ato.codewords` | `GENTEXT/CODEWORDS` |
| `missions[].unit` | `TASKUNIT` (missions grouped by unit) |
| `mission_number` (`MSN` stripped), `mission_type`, `deploy`/`takeoff_time`, `recovery`/`recovery_time` | `AMSNDAT` |
| `aircraft.count`/`type`/`loadout`, `callsign`, SPINS C3 Mode 3 | `MSNACFT` |
| targets with `tot_net`/`tot_nlt` | one `GTGTLOC` each (registry name, id, type, coords, elevation) |
| otherwise `vul`, else the first target `tos`/`toffs`; the first orbit steerpoint's name and altitude | `AMSNLOC` |
| `control.agency_id` → `registry.control_agencies` | `CONTROLA` (`AWACS`→`AWAC`, `CRC`, anything else `OTR`) |
| `refuel[]` → `registry.tankers` | `ARINFO`, in `time_from` order |

The derived `_vul_start`/`_vul_end` (IP/EP times) are never exported. Anything missing is written
as `-` and reported as a warning in the export dialog.

**Optional fields that exist for the export** (all optional; codes are quoted strings, so that
leading zeros survive):

```yaml
header:
  usmtf: { message_kind: EXER, originator: SOURCEDCS AOC, serial: ATO C,
           asof: '2026-09-13 1800Z', country: US, service: F, default_unit: SOURCE DCS }
ato:
  missions:
    - package_id: AB
      package_commander: true          # AMSNDAT MC, 9PKGDAT; members get PKGCMD
      iff: { mode1: '12', mode2: '0011', mode3: '4521' }   # mode3 wins over SPINS C3
      datalink: { l16_callsign: VP11, tacan: 38Y, ju: '00011' }
      alert_status: GH15
      priority: 1
      vul: { start: 1300Z, end: 1500Z }
      narrative: PACKAGE AB PUSH FROM IP WEST AT 141445Z
      control: { agency_id: MAGIC, report_in_point: ALPHA, check_in_time: 1300Z, secondary_freq_mhz: '305.5' }
      refuel: [ { tanker_id: SHELL71, time_from: 1345Z, time_to: 1400Z, offload_klb: 12 } ]
registry:
  units: { SOURCE DCS 1: { base: OMAM, remarks: free text } }
  tankers:   # + mission_number links the tanker to its own REFUELING mission
    SHELL71: { mission_number: 1901T, arcp: ANCHOR BLUE, system: BOOM, offload_klb: 60,
               alert_offload_klb: 10, fuel: JP8 }
  control_agencies:   # + mission_number links the agency to its own AEW mission (7CONTROL)
    MAGIC: { secondary_freq_mhz: '305.5', mission_number: 1801W }
```

Tankers and AWACS are ordinary missions (`REFUELING` / `AEW`). The registry entry names its
mission through `mission_number`, and that gives `REFTSK`, `5REFUEL` and `7CONTROL`.

What each export field means (every one is optional, and the mission editor has an input for all of
them except `secondary_freq_mhz` on a tanker, which is YAML-only):

| Field | Meaning |
|---|---|
| `missions[].package_id` | Package the mission belongs to. Missions sharing one form a package |
| `missions[].package_commander` | `true` on the one mission that commands its package. None or several give a warning |
| `missions[].iff.mode1` / `mode2` / `mode3` | IFF codes, quoted. `mode3` wins over the SPINS C3 table |
| `missions[].datalink` | `l16_callsign`, `tacan` (e.g. `38Y`), `ju` (five digits, quoted) |
| `missions[].alert_status` | Air alert status, free text upper-cased (e.g. `GH15`). Empty means not on alert |
| `missions[].priority` | Mission priority, a number |
| `missions[].vul` | `{start, end}` as `HHMMZ`. Fills `AMSNLOC` and wins over the first target's TOS/TOFFS; with timed targets, `GTGTLOC` wins |
| `missions[].narrative` | Free text (one string or a list), exported as `NARR` |
| `missions[].control.report_in_point`, `check_in_time`, `secondary_freq_mhz` | Where and when the flight checks in with its agency, and the agency's secondary frequency for this mission |
| `missions[].refuel[].offload_klb` | Planned offload for that refuelling window, thousands of pounds |
| `registry.tankers.*.mission_number`, `arcp`, `system`, `offload_klb`, `alert_offload_klb`, `fuel` | The tanker's own mission, its air refuelling control point, `BOOM` or `DROGUE`, total and alert offload (klb), fuel type |
| `registry.control_agencies.*.mission_number`, `secondary_freq_mhz` | The agency's own AEW mission, and its secondary frequency |
| `registry.units` | `{ <unit name>: { base, remarks } }`, for `TASKUNIT` |
| `header.usmtf` | Message defaults: `message_kind` (`EXER`/`OPER`), `originator`, `serial`, `asof` (`YYYY-MM-DD HHMMZ`, in-game), `country`, `service`, `default_unit` |

Mission numbers are exported without their `MSN` prefix, because crc-sync joins on the bare
number. Do not give a mission a Mode 3 code in the `6xxx` block: crc-sync reserves it for AI
aircraft.

**Reading the export from another system.** `GET /api/rooms/:id/ato.usmtf` returns the live room's
package as `text/plain` (`?report=1` returns `{text, warnings}` as JSON; `ETag`/`If-None-Match`
work). `POST /api/usmtf` with the package YAML as a `text/yaml` body (1 MB at most) converts
without a room. Both need `Authorization: Bearer <token>`: either the shared service secret
`ATOBRIEF_USMTF_TOKEN`, or a signed-in user's token that carries a role. Rooms live in memory, so a
room's export is gone once the room closes or atobrief restarts.

---

## IFF Squawk Code Generation

> **Stale:** the formula below is outdated. The editor and miztoyaml randomise Mode 3 codes today.
> The USMTF export reads whatever the C3 table holds (or `missions[].iff.mode3`).

When `miztoyaml` builds the SPINS sections, Mode 3 squawk codes are assigned
automatically to each mission in ATO order using the following formula:

```
squawk = 4701 + (mission_index × 10)
```

This produces codes **4701, 4711, 4721, …** for the first, second, and third
missions respectively.  Codes can be changed by editing the IFF table in the
web editor (SPINS → section C3 → edit → adjust CODE column values).

---

## SPINS Presets

The following built-in presets are available in the section editor for
sections C4 and C7–C11.  Select a preset from the dropdown and click
**APPLY PRESET** to replace the current entries, then edit as needed.

| Section | Preset name |
|---------|-------------|
| C4 — Rules of Engagement | Standard (PID / BVR / SFC / CIV) |
| C4 — Rules of Engagement | Weapons Free |
| C4 — Rules of Engagement | Defensive Only |
| C7 — Lost Comms | Standard (AWACS / Package / Intraflight) |
| C7 — Lost Comms | Abort on Any Loss |
| C8 — Abort Criteria | Standard |
| C8 — Abort Criteria | Extended |
| C9 — Search and Rescue | Not Simulated |
| C9 — Search and Rescue | Standard CSAR |
| C10 — Authentication | Daily Table |
| C10 — Authentication | Not Required |
| C10 — Authentication | Challenge / Reply |
| C11 — Safety | Standard |
| C11 — Safety | Extended |
