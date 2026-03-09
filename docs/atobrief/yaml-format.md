# ATO BRIEF — Package File Format

A **package file** is a single YAML file that contains a `schema_version`,
shared metadata blocks, and one or more of the five data sections below.
Any subset of data sections is valid; the viewer will enable only the tabs
for which data is present.

```yaml
schema_version: "1.0"        # required format version

header:   { ... }   # shared operation metadata (propagated to all tabs)
shared_steerpoints: [ ... ]  # merged waypoints shared across multiple flights
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

## `shared_steerpoints:` — Merged Waypoints Shared Across Flights

When multiple flights use functionally identical special waypoints (IP, EP,
MARSHAL) placed within 750 ft of each other in 3D space, the `miztoyaml` tool
merges them into a single canonical shared steerpoint.  Each shared steerpoint
is defined once at the top level, and individual flights reference it by ID.

### Merge criteria

All three conditions must be true for two waypoints to merge:

1. **Same special type** — e.g. an IP can only merge with another IP.  Generic
   route waypoints are never merged.
2. **Within 750 ft** — Euclidean distance in 3D space (horizontal + vertical).
3. **Compatible names** — both unnamed, or both carrying the **same** name.
   Conflicting names (e.g. `"IP WEST"` vs `"IP EAST"`) are never merged.

The merged steerpoint's position is the **centroid** (average lat/lon/alt) of
all contributing points.

```yaml
shared_steerpoints:
  - id: SSP-1
    type: ip                        # special type: ip | ep | marshal
    name: WEST                      # optional — present if the contributing
                                    # waypoints had a name suffix
    coords: N26°30'00" E056°20'00"  # centroid position
    altitude_ft: 20000              # average altitude (optional)
    flights:                        # flights that pass through this point
      - SHADOW-1
      - VIPER-2
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g. `SSP-1`) — referenced by flights via `shared_steerpoint_id` |
| `type` | string | Special waypoint type: `ip` (Ingress Point), `ep` (Egress Point), `marshal` (Marshal Point) |
| `name` | string | Optional — the shared name suffix when contributing waypoints had a name (e.g. `WEST` from `"IP WEST"`) |
| `coords` | coord string | Centroid position of all merged waypoints |
| `altitude_ft` | number | Average altitude in feet (optional) |
| `flights` | list of strings | Callsigns of all flights that pass through this point — used by the map to annotate the steerpoint label |

### Flight steerpoint references

When a flight's steerpoint has been merged into a shared steerpoint, the
flight's `steer_points` list contains a reference instead of inline data:

```yaml
steer_points:
  - coords: N24°30'00" E056°00'00"
    name: SP1
  - shared_steerpoint_id: SSP-1          # ← references shared steerpoint
  - coords: N26°40'00" E056°25'00"
    aim_point_id: SAM-1-LN1
```

Flight-unique steerpoints remain inline as before.  The viewer resolves
`shared_steerpoint_id` at load time to get the position and label data
from the corresponding `shared_steerpoints` entry.

---

## `registry:` — Canonical Reference Definitions

The `registry` block defines entities once so they can be referenced by key
throughout the rest of the file.  It contains: `callsigns`,
`airfields`, `carriers`, `tankers`, `targets` (with nested aim points),
`reference_points` (bullseye, marshal points, named positions),
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

A mapping of ICAO code → full airfield data.  The `ato.airfields` list
references these by ICAO key; only `icao` and `role` are stored at the ATO
level.

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

### `carriers:` (map)

A mapping of carrier id → carrier data.  Carriers are shared reference
entities (like airfields) — multiple missions can use the same carrier.
The `ato.carriers` list references these by id.

```yaml
registry:
  carriers:
    CVN-71:
      name: USS ROOSEVELT
      callsign: ROUGH RIDER
      deploy_coords: N24°30'00" E059°15'00"
      recovery_coords: N24°45'00" E059°30'00"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Ship name |
| `callsign` | string | Callsign (also used as an ICAO-like key for route resolution) |
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
  - callsign: SHELL
    altitude_ft: 24000
    speed_kts: 400
    ar_track: AR394      # optional — not extracted from .miz
    altitude: FL240      # optional human-readable altitude string
```

| Field | Type | Description |
|-------|------|-------------|
| `callsign` | string | Tanker group / callsign — matches `refuel.tanker_id` |
| `altitude_ft` | integer | Refueling altitude in feet (from DCS orbit params) |
| `speed_kts` | integer | Refueling speed in knots (from DCS orbit params) |
| `ar_track` | string | AR track identifier (optional, manual) |
| `altitude` | string | Human-readable altitude string e.g. `FL240` (optional, manual) |
| `orbit_anchor_coords` | coord string | Orbit anchor point position |
| `orbit_heading_deg` | integer | Orbit hot-leg heading in degrees true |
| `orbit_leg_nm` | number | Orbit leg length in NM |
| `orbit_width_nm` | number | Orbit track width in NM |
| `orbit_direction` | string | Orbit turn direction: `cw` (clockwise) or `ccw` (counterclockwise).  **Default is `ccw`** unless explicitly specified otherwise in the DCS mission |

### `targets:` (map)

A mapping of target id → target data with optional nested `aim_points`.
Targets are shared reference entities — multiple missions can reference the
same target.  Missions reference targets via `target.target_id`.

```yaml
registry:
  targets:
    SAM-1:
      name: SA-2 Guideline
      type: SAM
      coords: N26°30'00" E056°20'00"
      engagement_range_nm: 28
      max_alt_ft: 60000
      elevation: 150ft
      aim_points:
        - id: TGT-A
          name: TGT-A
          coords: N26°30'00" E056°20'00"
        - id: TGT-B
          name: TGT-B
          coords: N26°33'00" E056°22'00"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `type` | string | Target category (e.g. `SAM`, `EWR`, `BUILDING`) |
| `coords` | coord string | Position |
| `elevation` | string | Target elevation (e.g. `E350FT`) |
| `engagement_range_nm` | number | SAM/AAA engagement range in NM (draws a dashed ring on the map) |
| `max_alt_ft` | number | Maximum engagement altitude in feet (shown in popup) |
| `aim_points` | list | Optional nested aim points (see below) |

**Nested aim points** are sub-points of a target.  When a mission references
a target via `target_id`, the target's nested aim points are automatically
pulled into the mission.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique aim point identifier |
| `name` | string | Display name |
| `coords` | coord string | Position |

### `reference_points:` (list)

A list of named positional references: bullseye, marshal points, IP/CP
designations, and any other named geographic positions that multiple flights
might reference.

Mission-specific steer points (SP1, SP2, SP3 chains) do **not** belong here —
they stay in the mission's `steer_points` block.

```yaml
registry:
  reference_points:
    - name: COYOTE
      type: bullseye
      coords: N26°51'19" E056°21'37"
    - name: ALPHA
      type: marshal
      coords: N24°45'00" E056°00'00"
      altitude: FL250
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name (used as the bullseye reference key in `global_control.bullseye`) |
| `type` | string | `bullseye` / `marshal` / `ip` / `cp` / `geographic` |
| `coords` | coord string | Position |
| `altitude` | string | Holding altitude (optional, mainly for marshal points) |

### `control_agencies:` (map)

A mapping of agency id → control agency data.  Both AWACS and CRC agencies
are defined here.  The `global_control.agency_id` and each mission's
`control.agency_id` reference these by key; frequencies, callsign, and
platform are resolved from the registry at load time.

The `miz-to-yaml` tool automatically extracts AWACS groups from the DCS
mission (task=AWACS) and populates this section.  The key is the DCS group
name (which also becomes the `callsign`).  If exactly one AWACS is found,
it is automatically set as the `global_control.agency_id`.

```yaml
registry:
  control_agencies:
    AWACS DARKSTAR:
      type: AWACS
      callsign: AWACS DARKSTAR
      platform: E-3A
      primary_freq_mhz: '251.0'
    DARKSTAR:            # manually added CRC example
      type: CRC
      callsign: DARKSTAR
      primary_freq_mhz: '265.0'
      secondary_freq_mhz: '135.0'
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Agency type: `AWACS` or `CRC` |
| `callsign` | string | Agency callsign / group name |
| `platform` | string | Platform / aircraft type (optional — mainly for AWACS) |
| `primary_freq_mhz` | string | Primary frequency in MHz |
| `secondary_freq_mhz` | string | Secondary frequency in MHz (optional) |

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
- `weather.mission_wx[].mission_ref`

---

## `ato:` — Air Tasking Order

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `irl_date` | string | Real-world date of the briefing session (`YYYY-MM-DD`) |
| `irl_time_zulu` | string | Real-world start time in Zulu (`HHMMz`) |
| `ingame_start_time` | string | In-game mission start in Zulu (`HHMMz`) |
| `local_offset_hours` | number | UTC offset for the theater (e.g. `4` for UTC+4). Used by the renderer to convert Zulu times to local for display. |
| `ae_flags` | list of strings | Informational tags shown in the header (e.g. `[IRL, INGAME]`) |

### `global_control:`

Package-wide command and control data.  References a control agency from
`registry.control_agencies` by `agency_id`.  Frequencies, callsign, and
platform are resolved from the agency definition.

| Field | Type | Description |
|-------|------|-------------|
| `agency_id` | string | Control agency id (must match a key in `registry.control_agencies`).  Resolves `controlling_unit`, `aircraft_type`, and `primary_freq_mhz` from the registry. |
| `primary_freq_mhz` | string | Package primary frequency — auto-resolved from agency if `agency_id` is set |
| `controlling_unit` | string | Agency callsign — auto-resolved from agency if `agency_id` is set |
| `aircraft_type` | string | Platform / aircraft type — auto-resolved from agency if `agency_id` is set |
| `bullseye` | string | Reference point id in `registry.reference_points` (resolved at load time to `{name, coords}`) |

### `airfields:` (list)

Each entry references an airfield defined in `registry.airfields` by ICAO code.
Full data (name, coords, elevation) comes from the registry.  Plotted on the
map with a runway-cross symbol.

```yaml
airfields:
  - icao: OMAM
    role: deploy
  - icao: OMSJ
    role: recovery
  - icao: OTBH
    role: alternate
```

| Field | Type | Description |
|-------|------|-------------|
| `icao` | string | ICAO code (must match a key in `registry.airfields`) |
| `role` | string | `deploy` / `recovery` / `alternate` / `divert` (or any string) |

### `carriers:` (list)

Each entry references a carrier defined in `registry.carriers` by id.
Full data (name, callsign, coords) comes from the registry.  Plotted on the
map with an anchor symbol.

```yaml
carriers:
  - id: CVN-71
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Carrier id (must match a key in `registry.carriers`) |

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
| `home_base_icao` | string | Home base ICAO (display only) |
| `deploy_location_icao` | string | Start of route on map — accepts an airfield ICAO, a carrier registry ID (e.g. `CVN-71`), a carrier callsign, a marshal point name, or a raw DMS coordinate string |
| `aar_location_icao` | string | Recovery / end of route on map — same resolution as `deploy_location_icao` |
| `dtc_cartridge` | string | Name of the DCS DTC file assigned to this flight (auto-generated by `miztoyaml.py`) |

#### `aircraft:`

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Number of aircraft in the flight |
| `type` | string | Aircraft designation (e.g. `F16C`) |
| `loadout` | string | Loadout code — see [Loadout format](#loadout-format) |
| `weapons` | list of strings | Human-readable weapon list (e.g. `['5× AIM-120C', 'AIM-9M', '2× GBU-38']`) — auto-generated by `miztoyaml.py`; companion to the compact `loadout` code |

#### `targets:` (list)

A list of one or more target objects for this mission.  Each item has the same fields.
The legacy singular `target:` key is still accepted for backward compatibility and is
treated as a list containing a single item.

| Field | Type | Description |
|-------|------|-------------|
| `location` | string | Target area name |
| `target_id` | string | Reference to a target in `registry.targets` — pulls aim points from the target's nested `aim_points` list |
| `mission_type_override` | string | Optional sub-type shown alongside `mission_type` |
| `altitude` | string | Target altitude reference (e.g. `E73FT`, `FL200`) |
| `not_earlier_than` | time string | Legacy mission window open (NET) — used when neither `tot_*` nor `tos`/`toffs` is set |
| `not_later_than` | time string | Legacy mission window close (NLT) |
| `tot_net` | time string | Time on Target — NET (strike/BAI missions: when weapons should be on target) |
| `tot_nlt` | time string | Time on Target — NLT |
| `tos` | time string | Time on Station (CAP/CAS missions: when aircraft should be on station) |
| `toffs` | time string | Time OFF Station (when aircraft departs station) |

**Timing guidance:**
- For **strike/BAI/SEAD** missions, use `tot_net` / `tot_nlt` (Time on Target — when weapons should impact).
- For **CAP/CAS/orbit** missions, use `tos` / `toffs` (Time on Station / Time OFF Station).
- Both can be specified for a single mission (e.g. a SEAD flight that must be on station before a strike TOT).
- The legacy `not_earlier_than` / `not_later_than` fields are still accepted for backward compatibility.

#### Mission-level timing fields

| Field | Type | Description |
|-------|------|-------------|
| `takeoff_time` | time string | Planned takeoff time |
| `recovery_time` | time string | Planned recovery / landing time |
| `vul_start` | time string | Vulnerability window start — period when the flight is exposed to threats |
| `vul_end` | time string | Vulnerability window end |

The **vulnerability window** is shown as a red hatched overlay on the timeline and
as a time pair in the detail panel.  It marks the period when the flight is
inside the threat envelope or otherwise exposed.

#### `targets[].aim_points:` (list)

Aim points are typically resolved automatically from the registry target
referenced by `target_id`.  The target's nested `aim_points` list is pulled
into the mission at load time.

You can also specify aim points explicitly to select specific aim points from
a target, add standalone coordinates, or use legacy `target_ref` references:

```yaml
# Preferred: reference a registry target — all aim points come from the target
targets:
  - location: KHASAB AFB
    target_id: SAM-1       # pulls SAM-1's nested aim_points automatically

# Select specific aim points from a target by aim_point_id
targets:
  - location: KHASAB AFB
    target_id: SAM-1
    aim_points:
      - aim_point_id: TGT-A  # only TGT-A from SAM-1, not TGT-B

# Mix: specific aim_point from target + standalone coordinate
targets:
  - target_id: SAM-1
    aim_points:
      - aim_point_id: TGT-A
      - coords: N26°28'00" E056°18'00"
        name: MANUAL-POINT

# Multiple targets for one mission
targets:
  - location: SAM SITE ALPHA
    target_id: SAM-1
  - location: SAM SITE BRAVO
    target_id: SAM-2

# Legacy: explicit aim_points list with target_ref
aim_points:
  - target_ref: SA6-NORTH        # inherits coords, elevation, name from target
  - coords: N26°28'00" E056°18'00"
    name: MANUAL-POINT           # standalone aim point, no reference
```

| Field | Type | Description |
|-------|------|-------------|
| `aim_point_id` | string | `id` of a specific aim point within the target referenced by `target_id` |
| `target_ref` | string | `id` of a target in `registry.targets` (legacy) |
| `coords` | coord string | Position (overrides resolved coords) |
| `name` | string | Display name (overrides resolved name) |
| `elevation` | string | Elevation override |

#### `steer_points:` (list)

En-route waypoints plotted as hollow circles connected by dashed lines.
All waypoints are extracted so the map accurately represents the flight's
route.  Each steer point can be:

- **Inline** — with coordinates and optional name
- **Named reference** — referencing a named marker (airfield, carrier, marshal
  point) via `name_ref`
- **Shared reference** — referencing a merged steerpoint via
  `shared_steerpoint_id` (see [`shared_steerpoints`](#shared_steerpoints--merged-waypoints-shared-across-flights))

**Unnamed waypoints** (no `name` key) are route-shaping points only — they
appear on the route line but **no label is rendered** on the map.

**Special waypoint types** (`special_type`) identify significant tactical
waypoints detected by parsing the DCS waypoint name:

| Prefix | `special_type` | Meaning |
|--------|---------------|---------|
| `IP` | `ip` | Ingress Point |
| `EP` | `ep` | Egress Point |
| `MARSHAL` | `marshal` | Marshal Point |

A waypoint named `"IP WEST"` produces `special_type: ip` and `name: WEST`.
A waypoint named `"IP"` alone produces `special_type: ip` with no name.

```yaml
steer_points:
  - coords: N24°30'00" E056°00'00"
    name: SP1
  - coords: N25°15'00" E056°05'00"  # unnamed — route-shaping only, no label
  - coords: N25°30'00" E056°10'00"
    special_type: ip                  # ingress point detected from DCS name "IP WEST"
    name: WEST
  - shared_steerpoint_id: SSP-1      # reference to merged shared steerpoint
  - name_ref: ALPHA                   # reference a marshal point by name
    name: MARSHAL ALPHA
  - coords: N26°30'00" E056°20'00"
    name: SAM-1 TR
    aim_point_id: TGT-A
  - coords: N35°24'25" E038°07'30"
    name: ANCHOR
    orbit:
      alt_ft:      25000
      speed_kts:   270
      width_nm:    20.0
      leg_nm:      49.9
      heading_deg: 5
      cw:          false              # default is counterclockwise (false)
```

| Field | Type | Description |
|-------|------|-------------|
| `coords` | coord string | Waypoint position (used when `name_ref` and `shared_steerpoint_id` are not set) |
| `shared_steerpoint_id` | string | Reference to a `shared_steerpoints` entry by id — position and label come from the shared steerpoint definition |
| `name_ref` | string | Name of an airfield (ICAO), carrier callsign or ID, or marshal point to use as the waypoint position.  A small unlabelled circle is drawn at the referenced location so the flight path's passage through it is visible; the named location's own marker provides the label |
| `name` | string | Waypoint label shown on map.  Omit for unnamed route-shaping waypoints — no label will be rendered |
| `special_type` | string | Special waypoint type: `ip`, `ep`, or `marshal`.  Set by `miztoyaml.py` based on DCS waypoint name prefix parsing |
| `aim_point_id` | string | Optional — informational link to a registry aim point id.  Set by `miztoyaml.py` when a flight waypoint lies on an aim point; ignored by the viewer |
| `orbit` | object | Optional — present when the waypoint has a DCS Orbit task (CAP station, tanker track).  The map renders a racetrack pattern using these parameters |
| `orbit.alt_ft` | number | Orbit altitude in feet |
| `orbit.speed_kts` | number | Orbit airspeed in knots |
| `orbit.width_nm` | number | Track width (total, i.e. turn diameter) in NM; the map uses half this value as the turn radius |
| `orbit.leg_nm` | number | Hot-leg length in NM |
| `orbit.heading_deg` | number | Hot-leg heading in degrees true |
| `orbit.cw` | boolean | Orbit turn direction: `true` = clockwise, `false` = counterclockwise.  **Default is `false` (CCW)** |

#### `control:`

Mission-level C2 block.  References a control agency from
`registry.control_agencies` by `agency_id`.  Frequencies and net callsign
are resolved from the agency definition.

```yaml
control:
  agency_id: SCREWTOP      # resolves freq + callsign from registry
```

| Field | Type | Description |
|-------|------|-------------|
| `agency_id` | string | Control agency id (must match a key in `registry.control_agencies`).  Resolves `primary_freq_mhz`, `secondary_freq_mhz`, and `net_name` from the registry. |
| `primary_freq_mhz` | string | Mission primary frequency — auto-resolved from agency if `agency_id` is set |
| `secondary_freq_mhz` | string | Mission secondary frequency — auto-resolved from agency |
| `net_name` | string | Net callsign — auto-resolved from agency |

#### `refuel:`

Mission-level refueling block.  References a tanker defined in `registry.tankers`
by `tanker_id`.  Only mission-specific timing is stored here; tanker track and
altitude come from the registry tanker definition.

```yaml
refuel:
  tanker_id: ARCO4
  not_earlier_than: '2143Z'
  not_later_than: '2150Z'
```

| Field | Type | Description |
|-------|------|-------------|
| `tanker_id` | string | ID of a tanker in `registry.tankers` |
| `not_earlier_than` | time string | AAR window open (NET) |
| `not_later_than` | time string | AAR window close (NLT) — shown as a hatched bar on the timeline |

#### `coordination:` (list)

Optional list of related missions and deconfliction details.

```yaml
coordination:
  - mission: MSN3268
    type: altitude_stack
    notes: MSN3267 above FL200, MSN3268 below FL180 during VUL overlap 2055Z-2115Z
```

| Field | Type | Description |
|-------|------|-------------|
| `mission` | string | Mission number of the related mission |
| `type` | string | Deconfliction method (e.g. `altitude_stack`, `time_separation`) |
| `notes` | string | Free-text deconfliction details |

### `support_flights:` (list)

A dedicated section for support flights (AWACS, tankers) that is completely
separate from player/strike missions.  Support flights are displayed on the
map with their orbits and routes, but do not appear in the ATO mission list.

The `miztoyaml` tool populates this from DCS flights whose task is `AWACS` or
`TANKER` (`Refueling`).  Full orbit parameters are extracted from the DCS
route, with orbit direction defaulting to counterclockwise.

```yaml
ato:
  support_flights:
    - callsign: TEXACO
      type: TANKER
      aircraft: { count: 1, type: KC135 }
      deploy_location_icao: OMAM
      recovery_icao: OMAM
      orbit:
        anchor_coords: N25°30'00" E055°30'00"
        altitude_ft: 19000
        speed_kts: 370
        leg_nm: 50
        heading_deg: 45
        direction: ccw
        width_nm: 10.0
      steer_points:
        - coords: N25°00'00" E055°00'00"
          name: WP1
        - coords: N25°30'00" E055°30'00"
          name: ANCHOR
          altitude_ft: 19000
          orbit:
            alt_ft: 19000
            speed_kts: 370
            leg_nm: 50
            heading_deg: 45
            cw: false
            width_nm: 10.0
    - callsign: DARKSTAR
      type: AWACS
      aircraft: { count: 1, type: E3A }
      deploy_location_icao: OMAM
      recovery_icao: OMAM
      orbit:
        anchor_coords: N24°00'00" E054°00'00"
        altitude_ft: 30000
        speed_kts: 300
        leg_nm: 40
        heading_deg: 90
        direction: ccw
```

| Field | Type | Description |
|-------|------|-------------|
| `callsign` | string | Flight callsign / group name |
| `type` | string | Support flight type: `TANKER` or `AWACS` |
| `aircraft` | object | Aircraft details — `count` (number) and `type` (string) |
| `deploy_location_icao` | string | Departure airfield ICAO or carrier ID |
| `recovery_icao` | string | Recovery airfield ICAO or carrier ID |
| `orbit` | object | Primary orbit parameters (see below) |
| `steer_points` | list | En-route waypoints for map rendering (same schema as mission steer points) |

#### `orbit:` (support flight)

| Field | Type | Description |
|-------|------|-------------|
| `anchor_coords` | coord string | Orbit anchor point position |
| `altitude_ft` | integer | Orbit altitude in feet |
| `speed_kts` | integer | Orbit airspeed in knots |
| `leg_nm` | number | Hot-leg length in NM |
| `heading_deg` | integer | Hot-leg heading in degrees true |
| `direction` | string | Turn direction: `cw` or `ccw` — **default is `ccw`** |
| `width_nm` | number | Track width (turn diameter) in NM |

---

## `aco:` — Airspace Control Order

The ACO no longer needs its own `operation`, `ato_day`, or `classification`
fields — these are propagated from `header`.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | ACO identifier |
| `timezone` | string | Timezone reference (display only) |
| `distributing_agency` | string | Agency responsible for distributing this ACO |

### `acms:` (list)

Each ACM (Airspace Control Measure) appears as one row in the ACO table and as
one shape on the map.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ACM identifier |
| `name` | string | ACM display name |
| `type` | string | `ROZ` / `ORBIT` / `MEZ` / `NFZ` / `TRA` / `ANCHOR` (drives color on map) |
| `missions` | list of strings | Mission numbers this ACM supports (e.g. `[MSN3266, MSN3267]`) |
| `alt_lower` | string | Lower altitude bound (e.g. `SFC`, `FL200`) |
| `alt_upper` | string | Upper altitude bound |
| `time_from` | time string | Activation time |
| `time_to` | time string | Deactivation time |
| `control_agency` | string | Controlling agency callsign |
| `control_freq_mhz` | number | Controlling agency frequency |
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

SPINS content can also be loaded from a `spins.md` file placed in the same
directory as the `.miz` file — see [Authoring SPINS in Markdown](#authoring-spins-in-markdown).

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

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `wing_lead` | string | Wing lead callsign (display only) |

### `flights:` (list) — per-flight channel assignment tables

Each entry corresponds to one flight group.  Both DTC-equipped flights and
non-DTC flights that have Radio channel presets are included.

Channel assignments (`uhf_presets` / `vhf_presets`) map channel number to
the frequency in MHz.  The net callsign and role for that frequency are
looked up from `registry.frequencies` at render time.

```yaml
comms:
  wing_lead: FALCON5
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
  wing_lead: FALCON5
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
  mission_wx:
    - { mission_ref: MSN3266, notes: Clear at CAP. No impact. }
    - { mission_ref: AA7511,  notes: Watch for dust below 1000 ft., style: amber }
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `issued` | string | When this weather package was issued (display only) |
| `valid_from` | string | Start of the valid period (display only) |
| `valid_to` | string | End of the valid period (display only) |
| `metars` | list of strings | Raw METAR / SPECI strings — one per station |
| `tafs` | list of strings | Raw TAF strings — one per station |
| `mission_wx` | list | Mission-specific weather notes — see below |

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

### `mission_wx:` — Mission-specific notes

Plain-English notes linked to missions by mission number.

| Field | Type | Description |
|-------|------|-------------|
| `mission_ref` | string | Mission number (cross-reference to ATO) |
| `notes` | string | Free-text weather note |
| `style` | string | Optional color tint: `amber` / `red` / `green` / `blue` |

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

## Authoring SPINS in Markdown

When extracting a package from a `.miz` file with `miztoyaml.py`, the tool
looks for a `spins.md` file in the same directory as the `.miz` file.  If
found, the Markdown content is parsed and placed in `spins.sections`.

### Markdown format for `spins.md`

```markdown
## C1 — COMMAND & CONTROL

### C1.1 — Tactical Control

NOTE: All C2 passes through package commander.

PRIMARY AWACS: MAGIC / 265.1 MHz
SECONDARY: DARKSTAR / 265.0 MHz
- Bullet point text
- Another bullet

### C1.2 — Airspace Control

SCT, via LTAG MTMA and CVN-75

## C3 — IFF / SIF

NOTE: Squawk assigned code. Mode 4 mandatory.

| MSN | MODE | CODE |
|-----|------|------|
| MSN001 | 3 | 4821 |
```

| Markdown element | Produces |
|-----------------|----------|
| `## Section Title` | New section with `title: Section Title` |
| `### Sub-heading` | `{heading: Sub-heading}` entry within the current section |
| `NOTE: text` | `note:` field at the top of the current section |
| `KEY: value` (UPPERCASE key) | `{label: KEY, value: value}` entry |
| `- bullet text` | `{bullet: bullet text}` entry |
| Markdown table | `table: {headers, rows}` sub-block |
| Other lines | `{value: line}` (plain objective text) |

Sections without any `entries` (only a `table`) are fully supported.
The NOTE line must come before any key-value, bullet, or table rows.

`###` sub-headings create `{heading}` entries within the current `##` section.
Entries after a `###` heading are grouped inside that heading block in the
rendered output, allowing for nested mission-specific sections (e.g.
`### C5.6011 — SHADOW (SEAD)`).
