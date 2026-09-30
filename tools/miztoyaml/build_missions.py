"""build_missions — build airfield registry, mission list, and related helpers."""

from __future__ import annotations

import math
import re
from collections import defaultdict

from .models import Carrier, Flight, Waypoint
from .projection import dcs_to_latlon, dms
from .weapons import encode_loadout

# ── Syria / PG / Caucasus airfield ID → ICAO / name lookup ───────────────────
AIRDROME_IDS: dict[int, dict] = {
    2:  {"icao": "OSAP", "name": "Aleppo International"},
    4:  {"icao": "OS78", "name": "Bassel Al-Assad International"},
    8:  {"icao": "OSDZ", "name": "Deir ez-Zor"},
    11: {"icao": "OSDI", "name": "Damascus International"},
    12: {"icao": "OSGH", "name": "Abu ad-Duhur"},
    13: {"icao": "OSLK", "name": "Khalkhalah"},
    14: {"icao": "OLBA", "name": "Beirut-Rafic Hariri International"},
    15: {"icao": "OLLB", "name": "Rayak"},
    16: {"icao": "LTAG", "name": "Incirlik AB"},
    17: {"icao": "LTAS", "name": "Adana Sakirpasa"},
    20: {"icao": "OSPR", "name": "Palmyra"},
    21: {"icao": "OSRK", "name": "Raqqa"},
    22: {"icao": "OSTR", "name": "Tabqa"},
    24: {"icao": "OSHMH","name": "Hama"},
    25: {"icao": "OSHM", "name": "Marj Ruhayyil"},
    27: {"icao": "OSHR", "name": "Jirah"},
    29: {"icao": "OSKL", "name": "Kuweires"},
    34: {"icao": "OSHL", "name": "Hatay"},
    35: {"icao": "LTAF", "name": "Adiyaman"},
    36: {"icao": "LTAT", "name": "Gaziantep"},
    40: {"icao": "OSQM", "name": "Qamishli"},
    # Persian Gulf
    100: {"icao": "OMAM", "name": "Al Dhafra AB"},
    104: {"icao": "OMDM", "name": "Al Minhad AB"},
    105: {"icao": "OMDB", "name": "Dubai International"},
    109: {"icao": "OMFJ", "name": "Fujairah International"},
    113: {"icao": "OIKB", "name": "Bandar Abbas International"},
    # Caucasus
    200: {"icao": "UG24", "name": "Batumi"},
    201: {"icao": "UGKO", "name": "Kutaisi"},
    203: {"icao": "URSS", "name": "Sochi"},
}

CVN_NAMES: dict[str, str] = {
    "CVN_71": "USS THEODORE ROOSEVELT",
    "CVN_72": "USS ABRAHAM LINCOLN",
    "CVN_73": "USS GEORGE WASHINGTON",
    "CVN_74": "USS JOHN C. STENNIS",
    "CVN_75": "USS HARRY S. TRUMAN",
    "CVN_76": "USS RONALD REAGAN",
    "CVN_77": "USS GEORGE H.W. BUSH",
    "LHA_Tarawa": "USS TARAWA",
    "Kuznetsov":  "ADMIRAL KUZNETSOV",
}

_NM_TO_M = 1852.0
_FT_TO_M = 0.3048
# Proximity threshold: orbit/steer points closer than this are considered duplicates
_ORBIT_MERGE_NM = 2.0
# Reverse ICAO lookup set for O(1) token matching in recovery detection
_AIRDROME_ICAO_SET: frozenset[str] = frozenset(
    info["icao"] for info in AIRDROME_IDS.values()
)


# ── ATO callsign (decision H60) ──────────────────────────────────────────────
ATO_CALLSIGN_MAX = 7
_VOWELS = frozenset("AEIOU")


def ato_callsign(name: str | None) -> str | None:
    """
    The callsign a DCS group name becomes in the ATO (decision H60).

    Upper-cased, anything outside A–Z/0–9 dropped (so ``VIPER-1`` → ``VIPER1``,
    ``Mauler 6`` → ``MAULER6``), then — while longer than 7 characters — vowels
    are cut from back to front: ``ENFIELD11`` → ``ENFLD11``,
    ``SHADOW11`` → ``SHADW11``.  The first character is never cut.  If the
    name is still too long with every vowel gone, the letters are cut from the
    back and the trailing digits kept (``STRWBRRY11`` → ``STRWB11``).
    """
    if not name:
        return None
    cs = re.sub(r'[^A-Z0-9]', '', name.upper())
    if not cs:
        return None
    chars = list(cs)
    i = len(chars) - 1
    while len(chars) > ATO_CALLSIGN_MAX and i > 0:
        if chars[i] in _VOWELS:
            del chars[i]
        i -= 1
    cs = "".join(chars)
    if len(cs) > ATO_CALLSIGN_MAX:
        m = re.match(r'^(.*?)(\d*)$', cs)
        letters, digits = m.group(1), m.group(2)
        keep = max(ATO_CALLSIGN_MAX - len(digits), 1)
        cs = (letters[:keep] + digits)[:ATO_CALLSIGN_MAX]
    return cs


# ── Support missions (tankers, AWACS) ────────────────────────────────────────
# DCS flight task → ATO mission type for the flights miztoyaml used to skip.
SUPPORT_MISSION_TYPES: dict[str, str] = {
    "TANKER": "REFUELING",
    "AWACS":  "AEW",
}


def mission_type_of(flight: Flight) -> str:
    if flight.is_tanker:
        return SUPPORT_MISSION_TYPES["TANKER"]
    if flight.is_awacs:
        return SUPPORT_MISSION_TYPES["AWACS"]
    return flight.task


def mission_datalink(flight: Flight) -> dict | None:
    """
    missions[].datalink from what the .miz holds for the flight lead:
    the Link 16 voice callsign (l16_callsign), its STN as the JU, and — for a
    flight that activates one (tankers) — its TACAN.  None when there is
    nothing.  All values are strings, so leading zeros survive YAML.
    """
    lead = flight.units[0] if flight.units else None
    dl: dict = {}
    if lead and lead.voice_callsign:
        dl["l16_callsign"] = lead.voice_callsign
    if flight.tacan:
        dl["tacan"] = flight.tacan
    if lead and lead.stn_l16:
        dl["ju"] = lead.stn_l16
    return dl or None


def _nm_between(x1: float, y1: float, x2: float, y2: float) -> float:
    """Approximate distance in NM between two DCS world-coords points."""
    dx, dy = x2 - x1, y2 - y1
    return math.sqrt(dx*dx + dy*dy) / _NM_TO_M


def build_airfields_registry(flights: list[Flight], carriers: list[Carrier],
                             theatre: str) -> dict[str, dict]:
    """
    Collect unique airfields from flight takeoff waypoints.
    Returns a mapping of ICAO → {name, coords}.
    Takeoffs from carriers are excluded (handled by the carriers block).
    """
    carrier_unit_ids = {c.unit_id for c in carriers}
    seen: dict[str, dict] = {}     # icao → entry

    for f in flights:
        for wp in f.waypoints:
            if wp.typ not in ('TakeOffParking', 'TakeOff', 'TakeOffParkingHot',
                               'TakeOffGround'):
                continue
            # Carrier takeoff — skip
            if wp.link_unit_id and wp.link_unit_id in carrier_unit_ids:
                continue
            if wp.airdrome_id is None:
                continue
            info = AIRDROME_IDS.get(wp.airdrome_id)
            if not info:
                # Unknown ID — generate a placeholder
                icao = f"AF{wp.airdrome_id}"
                info = {"icao": icao, "name": f"Airfield {wp.airdrome_id}"}
            icao = info["icao"]
            if icao not in seen:
                seen[icao] = {
                    "name":   info["name"],
                    "coords": dms(wp.lat, wp.lon),
                }
    return seen



# ── Special waypoint type registry ───────────────────────────────────────────
# Maps a prefix string (upper-case) to a type key used in the schema.
# To add a new special waypoint type, just add an entry here.
SPECIAL_WAYPOINT_TYPES: dict[str, str] = {
    "IP":      "ip",       # Ingress Point
    "EP":      "ep",       # Egress Point
    "MARSHAL": "marshal",  # Marshal Point
}


def _parse_special_waypoint(name: str | None) -> tuple[str | None, str | None]:
    """
    Parse a waypoint name to detect special types.

    Returns (type_key, sub_name) where:
      - type_key is e.g. "ip", "ep", "marshal" or None
      - sub_name is e.g. "WEST" from "IP WEST", or None for bare "IP"
    """
    if not name:
        return None, None
    up = name.strip().upper()
    for pfx, type_key in SPECIAL_WAYPOINT_TYPES.items():
        if up == pfx:
            return type_key, None
        if up.startswith(pfx + " "):
            sub = up[len(pfx):].strip()
            return type_key, sub if sub else None
    return None, None


def _ft_between_2d(x1: float, y1: float, x2: float, y2: float) -> float:
    """2D (horizontal) Euclidean distance in feet between two waypoints. Altitude is ignored."""
    dx_ft = (x2 - x1) / _FT_TO_M
    dy_ft = (y2 - y1) / _FT_TO_M
    return math.sqrt(dx_ft * dx_ft + dy_ft * dy_ft)


_MERGE_THRESHOLD_FT = 1000.0  # 2D (horizontal) proximity threshold for steerpoint merging


def _parse_dms_approx(coord_str: str) -> tuple[float | None, float | None]:
    """
    Parse a DMS coordinate string into approximate decimal degrees.
    Good enough for centroid calculations.
    """
    parts = re.findall(r'([NSEW])(\d+)\D+(\d+)\D+(\d+(?:\.\d+)?)', coord_str)
    if len(parts) < 2:
        return None, None
    lat_dir, lat_d, lat_m, lat_s = parts[0]
    lon_dir, lon_d, lon_m, lon_s = parts[1]
    lat = int(lat_d) + int(lat_m) / 60 + float(lat_s) / 3600
    lon = int(lon_d) + int(lon_m) / 60 + float(lon_s) / 3600
    if lat_dir == 'S': lat = -lat
    if lon_dir == 'W': lon = -lon
    return lat, lon


def _classify_waypoints(flight: Flight,
                        all_flights: list[Flight],
                        targets: dict,
                        carriers: list[Carrier],
                        airfields: dict[str, dict],
                        ref_pts: dict) -> list[dict]:
    """
    Convert a flight's Waypoint list to the steer_points schema list.

    Rules:
    - Index 0  (TakeOff): skip
    - Last wp  (landing/recovery): skip unless it is an orbit
    - Special waypoint names (IP, EP, MARSHAL) are detected via registry
    - All waypoints are included for route accuracy
    - Only named waypoints get a visible label; unnamed ones are route-shaping only
    """
    TAKEOFF_TYPES = ('TakeOffParking', 'TakeOff', 'TakeOffParkingHot',
                     'TakeOffGround')
    LANDING_TYPES = ('Land',)
    MERGE_M = 100 * _FT_TO_M

    wpts = flight.waypoints
    if len(wpts) < 2:
        return []

    inner = []
    for i, wp in enumerate(wpts):
        if wp.typ in TAKEOFF_TYPES:
            continue
        if wp.typ in LANDING_TYPES and not wp.is_orbit:
            continue
        if i == len(wpts) - 1 and not wp.is_orbit:
            if wp.airdrome_id is not None or wp.link_unit_id is not None:
                continue
            if wpts[0].x is not None and wpts[0].y is not None:
                dist = math.sqrt((wp.x - wpts[0].x)**2 + (wp.y - wpts[0].y)**2)
                if dist <= MERGE_M:
                    continue
        inner.append(wp)

    # Build flat DMS -> aim_point_id index across all targets
    aim_by_dms: dict[str, str] = {}
    for tgt in targets.values():
        for ap in tgt.get("aim_points", []):
            ap_dms = ap.get("coords", "")
            ap_id  = ap.get("id", "")
            if ap_dms and ap_id:
                aim_by_dms[ap_dms] = ap_id

    emitted_orbits: list[tuple[float, float]] = []

    result = []
    for wp in inner:
        wp_dms = dms(wp.lat, wp.lon)
        special_type, special_name = _parse_special_waypoint(wp.name)

        # Marshal point handling
        if special_type == "marshal":
            marshal_display = wp.name.strip() if wp.name else "MARSHAL"
            if marshal_display not in ref_pts:
                ref_entry: dict = {
                    "name":   marshal_display,
                    "type":   "marshal",
                    "coords": wp_dms,
                }
                if wp.alt_ft is not None:
                    ref_entry["altitude"] = f"FL{round(wp.alt_ft / 100)}"
                ref_pts[marshal_display] = ref_entry
            sp_entry: dict = {
                "name_ref": marshal_display,
                "name": marshal_display,
                "coords": wp_dms,
                "special_type": "marshal",
            }
            if special_name:
                sp_entry["special_name"] = special_name
            result.append(sp_entry)
            continue

        # Orbit deduplication
        if wp.is_orbit:
            too_close = any(
                _nm_between(wp.x, wp.y, ox, oy) < _ORBIT_MERGE_NM
                for ox, oy in emitted_orbits
            )
            if too_close:
                continue
            emitted_orbits.append((wp.x, wp.y))

        aim_point_id = aim_by_dms.get(wp_dms)

        entry: dict = {"coords": wp_dms}

        # Only named waypoints get a visible label
        if wp.name:
            entry["name"] = wp.name

        if wp.alt_ft is not None:
            entry["altitude_ft"] = wp.alt_ft

        if aim_point_id:
            entry["aim_point_id"] = aim_point_id

        # Tag special types for merge processing
        if special_type:
            entry["special_type"] = special_type
            if special_name:
                entry["special_name"] = special_name

        # Store raw DCS coords for 3D merge calculations
        entry["_x"] = wp.x
        entry["_y"] = wp.y

        # Orbit/anchor track
        if wp.is_orbit:
            direction = "cw" if wp.orbit_cw else "ccw"
            entry["orbit"] = {
                "alt_ft":      wp.orbit_alt_ft,
                "speed_kts":   wp.orbit_speed_kts,
                "width_nm":    wp.orbit_width_nm,
                "leg_nm":      wp.orbit_leg_nm,
                "heading_deg": wp.orbit_heading_deg,
                "direction":   direction,
            }

        result.append(entry)

    return result


def merge_steerpoints(
    flight_steerpoints: dict[str, list[dict]],
) -> tuple[list[dict], dict[str, list[dict]]]:
    """
    Merge functionally-identical special waypoints across flights into shared steerpoints.

    Merge criteria (all three must be true):
    1. Both waypoints are the same special_type (IP, EP, MARSHAL, WP)
    2. Within 1000 ft of each other in 2D (horizontal) space — altitude is ignored
    3. Names are compatible (both unnamed, or same name)

    When merging, the higher altitude of the cluster is used (not average).
    """
    specials: list[tuple[str, int, dict]] = []
    for flight_name, sps in flight_steerpoints.items():
        for i, sp in enumerate(sps):
            if sp.get("special_type"):
                specials.append((flight_name, i, sp))

    groups: dict[tuple[str, str | None], list[tuple[str, int, dict]]] = defaultdict(list)
    for flight_name, idx, sp in specials:
        key = (sp["special_type"], sp.get("special_name"))
        groups[key].append((flight_name, idx, sp))

    steerpoints: list[dict] = []
    ssp_counter = 1
    merged_indices: dict[tuple[str, int], str] = {}

    for (stype, sname), candidates in groups.items():
        if len(candidates) < 2:
            continue

        clusters: list[list[tuple[str, int, dict]]] = []
        used = set()

        for i, (fn1, idx1, sp1) in enumerate(candidates):
            if i in used:
                continue
            cluster = [(fn1, idx1, sp1)]
            used.add(i)

            for j, (fn2, idx2, sp2) in enumerate(candidates):
                if j in used:
                    continue
                for _, _, csp in cluster:
                    dist = _ft_between_2d(
                        csp.get("_x", 0), csp.get("_y", 0),
                        sp2.get("_x", 0), sp2.get("_y", 0),
                    )
                    if dist <= _MERGE_THRESHOLD_FT:
                        cluster.append((fn2, idx2, sp2))
                        used.add(j)
                        break

            if len(cluster) >= 2:
                clusters.append(cluster)

        for cluster in clusters:
            ssp_id = f"SSP-{ssp_counter}"
            ssp_counter += 1

            lats, lons, alts = [], [], []
            flight_names = []
            for fn, idx, sp in cluster:
                merged_indices[(fn, idx)] = ssp_id
                flight_names.append(fn)
                coords = sp.get("coords", "")
                if coords:
                    lat, lon = _parse_dms_approx(coords)
                    if lat is not None:
                        lats.append(lat)
                        lons.append(lon)
                if sp.get("altitude_ft") is not None:
                    alts.append(sp["altitude_ft"])

            avg_lat = sum(lats) / len(lats) if lats else 0
            avg_lon = sum(lons) / len(lons) if lons else 0
            # Use the highest altitude in the cluster (not average)
            max_alt = max(alts) if alts else None

            centroid_coords = dms(avg_lat, avg_lon)

            ssp: dict = {
                "id":       ssp_id,
                "type":     stype,
                "coords":   centroid_coords,
                "flights":  sorted(set(flight_names)),
            }
            if sname:
                ssp["name"] = sname
            if max_alt is not None:
                ssp["altitude_ft"] = max_alt

            steerpoints.append(ssp)

    # Update flight steerpoints: replace merged entries with registry ref {id: ssp_id}
    updated: dict[str, list[dict]] = {}
    for flight_name, sps in flight_steerpoints.items():
        new_sps = []
        for i, sp in enumerate(sps):
            ssp_id = merged_indices.get((flight_name, i))
            if ssp_id:
                new_sps.append({"id": ssp_id})
            else:
                clean = {k: v for k, v in sp.items() if not k.startswith("_")}
                clean.pop("special_type", None)
                clean.pop("special_name", None)
                new_sps.append(clean)
        updated[flight_name] = new_sps

    return steerpoints, updated


def _home_base(flight: Flight, airfields: dict[str, dict],
               carriers: list[Carrier]) -> tuple[str | None, str | None]:
    """
    Return (deploy_id, recovery_id) from first and last waypoints.
    Carrier detection uses two methods:
      1. linkUnit id matching the carrier unit id (DCS native)
      2. Proximity: takeoff within 100ft of carrier deploy position
    Recovery defaults to the same carrier/airfield as deploy.
    """
    carrier_unit_ids = {c.unit_id: c.id for c in carriers}

    def _resolve_carrier_from_wp(wp: Waypoint) -> str | None:
        # Method 1: explicit linkUnit
        if wp.link_unit_id and wp.link_unit_id in carrier_unit_ids:
            return carrier_unit_ids[wp.link_unit_id]
        # Method 2: proximity to carrier position (100ft)
        PROX_M = 100 * _FT_TO_M
        for c in carriers:
            if hasattr(c, '_x'):
                dist = math.sqrt((wp.x - c._x)**2 + (wp.y - c._y)**2)
                if dist <= PROX_M:
                    return c.id
        return None

    deploy = None
    if flight.waypoints:
        first = flight.waypoints[0]
        carrier_id = _resolve_carrier_from_wp(first)
        if carrier_id:
            deploy = carrier_id
        elif first.airdrome_id is not None:
            info = AIRDROME_IDS.get(first.airdrome_id)
            deploy = info["icao"] if info else f"AF{first.airdrome_id}"

    recovery = None
    if flight.waypoints:
        last = flight.waypoints[-1]
        n = (last.name or "").upper()
        carrier_id = _resolve_carrier_from_wp(last)
        if carrier_id:
            recovery = carrier_id
        elif "CVN" in n or "RECOVERY" in n or "CARRIER" in n:
            # Match carrier by DCS type string (CVN_75 → CVN-75 appears in name)
            for c in carriers:
                c_type_norm = c.type.replace("_", "-").upper()
                if c.id in n or c_type_norm in n:
                    recovery = c.id
                    break
            # If no carrier matched, scan name tokens for a known ICAO code
            if not recovery:
                for token in n.split():
                    token = token.strip(".,;:")
                    if token in airfields or token in _AIRDROME_ICAO_SET:
                        recovery = token
                        break
            # Only fall back to carrier if we are already carrier-deployed
            if not recovery and deploy and deploy.startswith("CVN-"):
                recovery = carriers[0].id if carriers else None
        elif last.airdrome_id is not None:
            info = AIRDROME_IDS.get(last.airdrome_id)
            recovery = info["icao"] if info else f"AF{last.airdrome_id}"

    # If deploying from a carrier and no explicit recovery found, recover there too
    if deploy and deploy.startswith("CVN-") and not recovery:
        recovery = deploy

    # Final fallback: return to deploy base
    if not recovery and deploy:
        recovery = deploy

    return deploy, recovery


def _build_mission_targets(steer_pts: list[dict], targets: dict,
                           task: str) -> list[dict] | None:
    """
    Derive the mission targets list from steer_points that have aim_point_id.

    Groups aim points by parent target (SAM-14-RD1 → SAM-14), then emits one
    targets entry per unique target_id with its specific aim_point list.
    Returns None for tankers and missions with no aim-point hits.
    """
    if not steer_pts:
        return None

    seen_tgt: dict[str, list[str]] = {}
    for sp in steer_pts:
        ap_id = sp.get('aim_point_id')
        if not ap_id:
            continue
        tgt_id = ap_id.rsplit('-', 1)[0]
        if tgt_id not in seen_tgt:
            seen_tgt[tgt_id] = []
        if ap_id not in seen_tgt[tgt_id]:
            seen_tgt[tgt_id].append(ap_id)

    if not seen_tgt:
        return None

    is_orbit = task in ('CAP', 'CAS', 'ESCORT', 'TANKER', 'FAC(A)')
    result = []
    for tgt_id, _ in seen_tgt.items():
        entry: dict = {"target_id": tgt_id}
        if is_orbit:
            entry["tos"]   = None
            entry["toffs"] = None
        else:
            entry["tot_net"] = None
            entry["tot_nlt"] = None
        result.append(entry)

    return result or None


def steerpoints_from_dtc_routes(route_groups: list[dict], theatre: str,
                                targets: dict) -> list[dict]:
    """
    Convert a DTC's route groups (from dtc.parse_dtc_routes) into the
    steer_points schema used by build_missions.

    Each output point is tagged with an explicit 'route' number so the map
    only connects points within the same named route — 0 marks a standalone
    point (not part of any named route; never connects to its neighbours).
    A DTC with only one route behaves exactly like a single connected path,
    same as before this was added.

    aim_point_id is resolved the same way _classify_waypoints does (exact
    DMS coordinate match against registry target aim points) so DTC-sourced
    steerpoints get the same target-node rendering as mission-file waypoints.
    """
    aim_by_dms: dict[str, str] = {}
    for tgt in targets.values():
        for ap in tgt.get("aim_points", []):
            ap_dms = ap.get("coords", "")
            ap_id  = ap.get("id", "")
            if ap_dms and ap_id:
                aim_by_dms[ap_dms] = ap_id

    result = []
    for group in route_groups:
        route_num = group.get('route')
        for pt in group.get('points', []):
            x, y = pt['x'], pt['y']
            lat, lon = dcs_to_latlon(x, y, theatre)
            wp_dms = dms(lat, lon)
            entry: dict = {'coords': wp_dms}

            note = (pt.get('note') or '').strip()
            if note:
                entry['name'] = note
            alt_m = pt.get('alt_m')
            if alt_m is not None:
                entry['altitude_ft'] = round(alt_m / _FT_TO_M)
            speed_kts = pt.get('speed_kts')
            if speed_kts is not None:
                entry['speed_kts'] = round(speed_kts)

            entry['route'] = route_num if route_num is not None else 0

            aim_point_id = aim_by_dms.get(wp_dms)
            if aim_point_id:
                entry['aim_point_id'] = aim_point_id

            entry['_x'] = x
            entry['_y'] = y
            result.append(entry)
    return result


def build_lines_registry(flights: list[Flight], dtcs: dict[str, dict],
                         theatre: str) -> list[dict] | None:
    """
    Build registry.lines from each unique DTC cartridge referenced by a flight.

    Lines (GEO_LINES on F-16, R-flagged real waypoints on F-18) are reference/
    planning polylines shared by whichever flights carry that cartridge, so
    each cartridge's lines are only emitted once even if several flights use
    the same DTC.
    """
    seen_cartridges: set[str] = set()
    result: list[dict] = []
    counter = 1
    for f in flights:
        dtc_name = f.dtc_cartridge
        if not dtc_name or dtc_name in seen_cartridges:
            continue
        seen_cartridges.add(dtc_name)
        for group in dtcs.get(dtc_name, {}).get('lines', []):
            points = []
            for pt in group.get('points', []):
                lat, lon = dcs_to_latlon(pt['x'], pt['y'], theatre)
                entry: dict = {'coords': dms(lat, lon)}
                alt_m = pt.get('alt_m')
                if alt_m is not None:
                    entry['altitude_ft'] = round(alt_m / _FT_TO_M)
                note = (pt.get('note') or '').strip()
                if note:
                    entry['name'] = note
                points.append(entry)
            if len(points) < 2:
                continue
            result.append({
                'id':            f'LINE-{counter}',
                'dtc_cartridge': dtc_name,
                'points':        points,
            })
            counter += 1
    return result or None


def build_missions(flights: list[Flight], msn_start: int,
                   targets: dict, carriers: list[Carrier],
                   airfields: dict[str, dict],
                   ref_pts: dict,
                   dtcs: dict | None = None,
                   theatre: str = "Syria") -> tuple[list[dict], list[dict]]:
    """
    Produce the ato.missions list — one mission per flight, tankers as
    REFUELING and AWACS as AEW missions (ADR 0089) — and the steerpoints list
    for merged waypoints.  Mission numbers run in flight order from
    msn_start; the registry links a tanker/agency to its mission through
    mission_number (build_doc).

    When a flight has a DTC cartridge whose DTC data contains 'routes',
    those steerpoints are used instead of the mission-file waypoints.
    If no route data is present the behaviour is unchanged (backwards compatible).

    Returns (missions, steerpoints).
    """
    missions = []
    flight_steerpoints: dict[str, list[dict]] = {}

    for i, f in enumerate(flights):
        msn_num = f"MSN{msn_start + i}"

        callsign = ato_callsign(f.name) or f.name
        ac_base  = f.aircraft_type.split('_')[0]
        ac_type  = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        count    = len(f.units)
        loadout_str = encode_loadout(
            f.units[0].loadout if f.units else [], f.task)

        deploy, recovery = _home_base(f, airfields, carriers)
        if not recovery and deploy:
            recovery = deploy

        steer_pts = _classify_waypoints(f, flights, targets, carriers,
                                         airfields, ref_pts)

        # Override with DTC route data when available (backwards compatible)
        if dtcs and f.dtc_cartridge:
            dtc_data = dtcs.get(f.dtc_cartridge, {})
            dtc_routes = dtc_data.get('routes')
            if dtc_routes:
                steer_pts = steerpoints_from_dtc_routes(dtc_routes, theatre, targets)

        flight_steerpoints[callsign] = steer_pts

        msn_targets = _build_mission_targets(steer_pts, targets, f.task)

        msn: dict = {
            "mission_number": msn_num,
            "callsign":       callsign,
            "mission_type":   mission_type_of(f),
            "unit":           None,
            "deploy":         deploy,
            "recovery":       recovery,
            "takeoff_time":   None,
            "recovery_time":  None,
            "aircraft": {
                "count":   count,
                "type":    ac_type,
                "loadout": loadout_str,
            },
            "targets":       msn_targets,
            "datalink":      mission_datalink(f),
            "control":       {"agency_id": None},
            "refuel":        None,
            "steer_points":  None,  # filled after merge
            "dtc_cartridge": f.dtc_cartridge,
        }

        missions.append(msn)

    # Merge steerpoints across all flights
    steerpoints, updated_sps = merge_steerpoints(flight_steerpoints)

    # Wire merged steer_points back into missions
    for msn in missions:
        cs = msn["callsign"]
        if cs in updated_sps:
            msn["steer_points"] = updated_sps[cs] or None

    return missions, steerpoints
