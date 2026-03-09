"""build_missions — build airfield registry, mission list, and related helpers."""

from __future__ import annotations

import math
import re

from .models import Carrier, Flight, Waypoint
from .projection import dms
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
# Proximity threshold for waypoint merging (shared steerpoints): 750 ft in metres
_MERGE_THRESHOLD_M = 750 * _FT_TO_M
# Reverse ICAO lookup set for O(1) token matching in recovery detection
_AIRDROME_ICAO_SET: frozenset[str] = frozenset(
    info["icao"] for info in AIRDROME_IDS.values()
)

# ── Special waypoint type registry ───────────────────────────────────────────
# Maps an upper-case prefix to the canonical special-type string used in the
# YAML schema.  To add a new special type, add an entry here — no other code
# needs to change.
_SPECIAL_WAYPOINT_TYPES: dict[str, str] = {
    "IP":      "ip",       # Ingress Point
    "EP":      "ep",       # Egress Point
    "MARSHAL": "marshal",  # Marshal Point
}


def _parse_special_waypoint(name: str | None) -> tuple[str, str | None] | None:
    """
    Parse a waypoint name for a special-type prefix.

    Returns ``(type_str, suffix_name)`` if the name matches a registered prefix,
    or ``None`` for generic waypoints.

    Examples::
        "IP"           → ("ip", None)
        "IP WEST"      → ("ip", "WEST")
        "EP"           → ("ep", None)
        "EP NORTH"     → ("ep", "NORTH")
        "MARSHAL"      → ("marshal", None)
        "MARSHAL ALPHA"→ ("marshal", "ALPHA")
        "SP1"          → None  (generic)
    """
    if not name:
        return None
    stripped = name.strip()
    upper = stripped.upper()
    for prefix, wp_type in _SPECIAL_WAYPOINT_TYPES.items():
        if upper == prefix:
            return (wp_type, None)
        if upper.startswith(prefix + " "):
            suffix = stripped[len(prefix):].strip()
            return (wp_type, suffix if suffix else None)
    return None


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


# ── Steerpoint extraction ────────────────────────────────────────────────────

_TAKEOFF_TYPES = ('TakeOffParking', 'TakeOff', 'TakeOffParkingHot',
                  'TakeOffGround')
_LANDING_TYPES = ('Land',)


def _filter_inner_waypoints(wpts: list[Waypoint]) -> list[Waypoint]:
    """
    Filter a flight's waypoint list to remove takeoff and landing waypoints,
    keeping only en-route waypoints.  Orbit waypoints are always kept.
    """
    if len(wpts) < 2:
        return []

    inner: list[Waypoint] = []
    for i, wp in enumerate(wpts):
        if wp.typ in _TAKEOFF_TYPES:
            continue
        if wp.typ in _LANDING_TYPES and not wp.is_orbit:
            continue
        # Skip last waypoint if it looks like a recovery and is NOT an orbit
        if i == len(wpts) - 1 and not wp.is_orbit:
            if wp.airdrome_id is not None or wp.link_unit_id is not None:
                continue
            if wpts[0].x is not None and wpts[0].y is not None:
                dist = math.sqrt((wp.x - wpts[0].x)**2 + (wp.y - wpts[0].y)**2)
                if dist <= 100 * _FT_TO_M:
                    continue
        inner.append(wp)
    return inner


def _build_orbit_block(wp: Waypoint) -> dict:
    """Build an orbit parameter dict for a waypoint, defaulting direction to CCW."""
    return {
        "alt_ft":      wp.orbit_alt_ft,
        "speed_kts":   wp.orbit_speed_kts,
        "width_nm":    wp.orbit_width_nm,
        "leg_nm":      wp.orbit_leg_nm,
        "heading_deg": wp.orbit_heading_deg,
        "cw":          wp.orbit_cw if wp.orbit_cw is not None else False,
    }


def _classify_waypoints(flight: Flight,
                        targets: dict,
                        ref_pts: dict) -> list[dict]:
    """
    Convert a flight's Waypoint list to the steer_points schema list.

    Every en-route waypoint is emitted so the map can accurately represent the
    flight's route.  Special waypoints (IP, EP, MARSHAL) are tagged with their
    type.  Unnamed generic waypoints have no ``name`` key — the frontend should
    not render a label for them.
    """
    inner = _filter_inner_waypoints(flight.waypoints)

    # Build flat DMS → aim_point_id index across all targets.
    aim_by_dms: dict[str, str] = {}
    for tgt in targets.values():
        for ap in tgt.get("aim_points", []):
            ap_dms = ap.get("coords", "")
            ap_id  = ap.get("id", "")
            if ap_dms and ap_id:
                aim_by_dms[ap_dms] = ap_id

    # Track already-emitted orbit positions to suppress near-duplicates
    emitted_orbits: list[tuple[float, float]] = []

    result: list[dict] = []
    for wp in inner:
        wp_dms = dms(wp.lat, wp.lon)

        # Orbit deduplication: skip if a very close orbit already exists
        if wp.is_orbit:
            too_close = any(
                _nm_between(wp.x, wp.y, ox, oy) < _ORBIT_MERGE_NM
                for ox, oy in emitted_orbits
            )
            if too_close:
                continue
            emitted_orbits.append((wp.x, wp.y))

        # Aim-point match
        aim_point_id = aim_by_dms.get(wp_dms)

        entry: dict = {"coords": wp_dms}

        # Parse special waypoint type from name
        special = _parse_special_waypoint(wp.name)
        if special:
            sp_type, sp_name = special
            entry["special_type"] = sp_type
            if sp_name:
                entry["name"] = sp_name
            # Marshal points also go into ref_pts for the registry
            if sp_type == "marshal":
                marshal_key = wp.name.strip()
                if marshal_key not in ref_pts:
                    ref_entry: dict = {
                        "name":   marshal_key,
                        "type":   "marshal",
                        "coords": wp_dms,
                    }
                    if wp.alt_ft is not None:
                        ref_entry["altitude"] = f"FL{round(wp.alt_ft / 100)}"
                    ref_pts[marshal_key] = ref_entry
                entry["name_ref"] = marshal_key
        elif wp.name:
            # Named generic waypoint — gets a label on the map
            entry["name"] = wp.name

        if wp.alt_ft is not None:
            entry["altitude_ft"] = wp.alt_ft
        if aim_point_id:
            entry["aim_point_id"] = aim_point_id

        # Orbit/anchor track
        if wp.is_orbit:
            entry["orbit"] = _build_orbit_block(wp)

        # Attach DCS world coords for merging (stripped before final output)
        entry["_x"] = wp.x
        entry["_y"] = wp.y
        entry["_alt_ft"] = wp.alt_ft

        result.append(entry)

    return result


# ── Waypoint merging (shared steerpoints) ────────────────────────────────────

def _dist_3d_ft(x1: float, y1: float, alt1_ft: float | None,
                x2: float, y2: float, alt2_ft: float | None) -> float:
    """3D Euclidean distance in feet between two points."""
    dx = (x2 - x1) / _FT_TO_M  # metres → feet
    dy = (y2 - y1) / _FT_TO_M
    dz = ((alt2_ft or 0) - (alt1_ft or 0))
    return math.sqrt(dx*dx + dy*dy + dz*dz)


def merge_shared_steerpoints(
    flight_steerpoints: dict[str, list[dict]],
) -> tuple[list[dict], dict[str, list[dict]]]:
    """
    Merge special-type waypoints across flights that are within 750 ft 3D,
    share the same special type, and have compatible names.

    Returns:
        shared_list: list of shared steerpoint dicts (with id, type, name,
                     coords, altitude_ft, flights)
        updated_flights: mapping of flight_name → updated steer_points list
                         where merged points reference shared_steerpoint_id
    """
    # Collect all special-type steerpoints with their flight association
    candidates: list[dict] = []  # {sp_dict, flight_name, sp_index}
    for flight_name, sps in flight_steerpoints.items():
        for idx, sp in enumerate(sps):
            if sp.get("special_type"):
                candidates.append({
                    "sp": sp,
                    "flight": flight_name,
                    "idx": idx,
                })

    # Group candidates into merge clusters
    # A cluster is a set of candidates that should merge into one shared point.
    clusters: list[list[dict]] = []
    used: set[int] = set()

    for i, ci in enumerate(candidates):
        if i in used:
            continue
        cluster = [ci]
        used.add(i)
        for j, cj in enumerate(candidates):
            if j in used:
                continue
            if _should_merge(ci["sp"], cj["sp"]):
                # Also check against all existing cluster members
                if all(_should_merge(ck["sp"], cj["sp"]) for ck in cluster):
                    cluster.append(cj)
                    used.add(j)
        # Only create a shared steerpoint if 2+ flights reference it
        flight_names = set(c["flight"] for c in cluster)
        if len(flight_names) >= 2:
            clusters.append(cluster)

    # Build shared steerpoint list and update flight steerpoints
    shared_list: list[dict] = []
    # Track which (flight_name, sp_index) → shared_steerpoint_id
    merge_map: dict[tuple[str, int], str] = {}

    for seq, cluster in enumerate(clusters, start=1):
        sp_id = f"SSP-{seq}"
        sp_type = cluster[0]["sp"]["special_type"]

        # Compute centroid of all points in the cluster
        lats, lons, alts = [], [], []
        for c in cluster:
            sp = c["sp"]
            # Use the raw DCS coords for position averaging
            lats.append(sp.get("_x", 0))
            lons.append(sp.get("_y", 0))
            alt = sp.get("_alt_ft")
            if alt is not None:
                alts.append(alt)

        from .projection import dcs_to_latlon
        avg_x = sum(lats) / len(lats)
        avg_y = sum(lons) / len(lons)
        avg_alt = round(sum(alts) / len(alts)) if alts else None

        # Determine name — pick the first non-None name from cluster members
        sp_name = None
        for c in cluster:
            sp_name = c["sp"].get("name")
            if sp_name:
                break

        # Get the theatre from the coords (use first point's already-computed DMS
        # as fallback, but recompute from centroid for accuracy)
        # We stored _x/_y in DCS world coords, need theatre for projection
        # Use the centroid DMS from the first point's theatre context
        centroid_dms = cluster[0]["sp"]["coords"]  # fallback
        # The shared steerpoint's coords is the centroid in DMS
        # We'll compute it properly from the averaged DCS coords

        flight_names_list = sorted(set(c["flight"] for c in cluster))

        shared_entry: dict = {
            "id":      sp_id,
            "type":    sp_type,
            "coords":  centroid_dms,  # will be recomputed below
            "flights": flight_names_list,
        }
        if sp_name:
            shared_entry["name"] = sp_name
        if avg_alt is not None:
            shared_entry["altitude_ft"] = avg_alt

        # Store DCS coords for centroid recomputation in build_doc
        shared_entry["_avg_x"] = avg_x
        shared_entry["_avg_y"] = avg_y

        shared_list.append(shared_entry)

        for c in cluster:
            merge_map[(c["flight"], c["idx"])] = sp_id

    # Build updated flight steerpoints: replace merged points with references
    updated_flights: dict[str, list[dict]] = {}
    for flight_name, sps in flight_steerpoints.items():
        new_sps: list[dict] = []
        for idx, sp in enumerate(sps):
            key = (flight_name, idx)
            if key in merge_map:
                new_sps.append({"shared_steerpoint_id": merge_map[key]})
            else:
                new_sps.append(sp)
        updated_flights[flight_name] = new_sps

    return shared_list, updated_flights


def _should_merge(sp1: dict, sp2: dict) -> bool:
    """
    Check if two special steerpoints should merge.

    All three criteria must be true:
    1. Same special type
    2. Within 750 ft of each other in 3D space
    3. Compatible names (both unnamed, or both same name)
    """
    # Criterion 1: same special type
    if sp1.get("special_type") != sp2.get("special_type"):
        return False

    # Criterion 2: within 750 ft in 3D
    dist = _dist_3d_ft(
        sp1.get("_x", 0), sp1.get("_y", 0), sp1.get("_alt_ft"),
        sp2.get("_x", 0), sp2.get("_y", 0), sp2.get("_alt_ft"),
    )
    if dist > 750:
        return False

    # Criterion 3: compatible names
    n1 = sp1.get("name")
    n2 = sp2.get("name")
    if n1 and n2 and n1 != n2:
        return False

    return True


def _strip_internal_keys(sp: dict) -> dict:
    """Remove internal keys (_x, _y, _alt_ft) from a steerpoint dict."""
    return {k: v for k, v in sp.items() if not k.startswith("_")}


# ── Home base detection ──────────────────────────────────────────────────────

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
            for c in carriers:
                c_type_norm = c.type.replace("_", "-").upper()
                if c.id in n or c_type_norm in n:
                    recovery = c.id
                    break
            if not recovery:
                for token in n.split():
                    token = token.strip(".,;:")
                    if token in airfields or token in _AIRDROME_ICAO_SET:
                        recovery = token
                        break
            if not recovery and deploy and deploy.startswith("CVN-"):
                recovery = carriers[0].id if carriers else None
        elif last.airdrome_id is not None:
            info = AIRDROME_IDS.get(last.airdrome_id)
            recovery = info["icao"] if info else f"AF{last.airdrome_id}"

    if deploy and deploy.startswith("CVN-") and not recovery:
        recovery = deploy

    if not recovery and deploy:
        recovery = deploy

    return deploy, recovery


# ── Mission target derivation ────────────────────────────────────────────────

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
    sp_alt_by_apid: dict[str, float] = {
        sp['aim_point_id']: sp['altitude_ft']
        for sp in steer_pts
        if sp.get('aim_point_id') and sp.get('altitude_ft') is not None
    }
    result = []
    for tgt_id, ap_ids in seen_tgt.items():
        tgt_info = targets.get(tgt_id, {})
        raw_name = tgt_info.get('name') or tgt_id
        location = re.sub(r'\s*\([^)]+\)\s*$', '', raw_name).strip() or tgt_id
        entry: dict = {
            "location":  location,
            "target_id": tgt_id,
        }
        attack_alt_ft = next(
            (sp_alt_by_apid[apid] for apid in ap_ids if apid in sp_alt_by_apid),
            None,
        )
        if attack_alt_ft is not None:
            entry["altitude"] = f"{round(attack_alt_ft)}FT"
        if is_orbit:
            entry["tos"]   = None
            entry["toffs"] = None
        else:
            entry["tot_net"] = None
            entry["tot_nlt"] = None
        all_ap_ids = [ap['id'] for ap in tgt_info.get('aim_points', [])]
        if ap_ids and ap_ids != all_ap_ids:
            entry["aim_points"] = [{"aim_point_id": a} for a in ap_ids]
        result.append(entry)

    return result or None


# ── Support flight extraction ────────────────────────────────────────────────

def build_support_flights(flights: list[Flight],
                          carriers: list[Carrier],
                          airfields: dict[str, dict]) -> list[dict] | None:
    """
    Build the ato.support_flights list for tanker and AWACS flights.

    Each support flight includes its full orbit parameters and steerpoints
    so it can be rendered on the briefing map.
    """
    result: list[dict] = []

    for f in flights:
        if not f.is_tanker and not f.is_awacs:
            continue

        ac_base = f.aircraft_type.split('_')[0]
        ac_type = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        deploy, recovery = _home_base(f, airfields, carriers)

        # Build steer points for the route
        inner_wpts = _filter_inner_waypoints(f.waypoints)
        steer_pts: list[dict] = []
        orbit_info: dict | None = None

        for wp in inner_wpts:
            wp_dms = dms(wp.lat, wp.lon)
            sp_entry: dict = {"coords": wp_dms}

            if wp.name:
                sp_entry["name"] = wp.name
            if wp.alt_ft is not None:
                sp_entry["altitude_ft"] = wp.alt_ft

            if wp.is_orbit:
                orbit_block = _build_orbit_block(wp)
                sp_entry["orbit"] = orbit_block
                # Capture first orbit as the primary orbit info
                if orbit_info is None:
                    orbit_info = {
                        "anchor_coords": wp_dms,
                        "altitude_ft":   wp.orbit_alt_ft,
                        "speed_kts":     wp.orbit_speed_kts,
                        "leg_nm":        wp.orbit_leg_nm,
                        "heading_deg":   wp.orbit_heading_deg,
                        "direction":     "cw" if wp.orbit_cw else "ccw",
                    }
                    if wp.orbit_width_nm is not None:
                        orbit_info["width_nm"] = wp.orbit_width_nm

            steer_pts.append(sp_entry)

        entry: dict = {
            "callsign":             f.name,
            "type":                 f.task,
            "aircraft":             {"count": len(f.units), "type": ac_type},
            "deploy_location_icao": deploy,
            "recovery_icao":        recovery or deploy,
            "steer_points":         steer_pts or None,
        }
        if orbit_info:
            entry["orbit"] = orbit_info

        result.append(entry)

    return result or None


# ── Mission list building ────────────────────────────────────────────────────

def build_missions(flights: list[Flight], msn_start: int,
                   targets: dict, carriers: list[Carrier],
                   airfields: dict[str, dict],
                   ref_pts: dict) -> tuple[list[dict], list[dict]]:
    """
    Produce the ato.missions list for player/strike flights (non-tanker,
    non-AWACS) and a top-level shared_steerpoints list.

    Returns (missions, shared_steerpoints).
    """
    missions: list[dict] = []
    strike_i = 0

    # Phase 1: Build per-flight steerpoints
    flight_steerpoints: dict[str, list[dict]] = {}

    for f in flights:
        if f.is_awacs or f.is_tanker:
            continue

        steer_pts = _classify_waypoints(f, targets, ref_pts)
        flight_steerpoints[f.name] = steer_pts

    # Phase 2: Merge shared steerpoints across flights
    shared_list, updated_flights = merge_shared_steerpoints(flight_steerpoints)

    # Recompute shared steerpoint centroid coords (requires theatre context —
    # deferred to build_doc where theatre is available)

    # Phase 3: Build mission entries
    for f in flights:
        if f.is_awacs or f.is_tanker:
            continue

        msn_num = f"MSN{msn_start + strike_i}"
        strike_i += 1

        callsign = f.name
        ac_base  = f.aircraft_type.split('_')[0]
        ac_type  = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        count    = len(f.units)
        loadout_str = encode_loadout(
            f.units[0].loadout if f.units else [], f.task)

        deploy, recovery = _home_base(f, airfields, carriers)
        if not recovery and deploy:
            recovery = deploy

        steer_pts = updated_flights.get(callsign, [])
        # Strip internal keys from steerpoints before output
        clean_pts = [_strip_internal_keys(sp) for sp in steer_pts]

        msn_targets = _build_mission_targets(steer_pts, targets, f.task)

        msn: dict = {
            "mission_number":       msn_num,
            "callsign":             callsign,
            "mission_type":         f.task,
            "unit":                 None,
            "home_base_icao":       deploy,
            "deploy_location_icao": deploy,
            "aar_location_icao":    recovery,
            "takeoff_time":         None,
            "recovery_time":        None,
            "aircraft": {
                "count":   count,
                "type":    ac_type,
                "loadout": loadout_str,
            },
            "targets":         msn_targets,
            "control":         {"agency_id": None},
            "refuel":          None,
            "steer_points":    clean_pts or None,
            "dtc_cartridge":   f.dtc_cartridge,
        }

        missions.append(msn)

    # Strip internal keys from shared steerpoints
    clean_shared = [_strip_internal_keys(sp) for sp in shared_list]

    return missions, clean_shared
