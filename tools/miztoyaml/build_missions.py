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
# Reverse ICAO lookup set for O(1) token matching in recovery detection
_AIRDROME_ICAO_SET: frozenset[str] = frozenset(
    info["icao"] for info in AIRDROME_IDS.values()
)


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


def _classify_waypoints(flight: Flight,
                        all_flights: list[Flight],
                        targets: dict,
                        carriers: list[Carrier],
                        ref_pts: dict) -> list[dict]:
    """
    Convert a flight's Waypoint list to the steer_points schema list.

    Rules:
    - Index 0  (TakeOff): skip — captured as deploy_location_icao
    - Last wp  (landing/recovery): skip unless it is an orbit (e.g. tanker tracks
      where the only working waypoint is the orbit at index 1 = last)
    - Name starts with "MARSHALL ": → marshal point in ref_pts (name_ref)
    - Within 100ft of another flight's waypoint with same/no name:
        → same logical point; use shared name
    - Within 500m of a SAM aim-point: label as aim-point steer
    - Orbit steer points within _ORBIT_MERGE_NM of an already-emitted orbit are
      suppressed (the earlier entry absorbs the later duplicate)
    """
    MERGE_M   = 100 * _FT_TO_M   # 100 ft proximity for shared waypoints

    wpts = flight.waypoints
    # Need at least 2 waypoints (takeoff + one working waypoint)
    if len(wpts) < 2:
        return []

    # Inner waypoints: skip first (takeoff) and normally skip last (recovery).
    # Exception: if the last waypoint has an Orbit task (tanker track, CAP anchor
    # sitting at the very end of the route), include it.
    if len(wpts) == 2:
        # Only orbit at index 1 is worth including; skip plain recovery waypoints
        inner = [wpts[1]] if wpts[1].is_orbit else []
    else:
        inner = wpts[1:-1]
        if wpts[-1].is_orbit:
            inner = inner + [wpts[-1]]

    # Build index of all OTHER flights' inner waypoints for proximity matching
    others: list[Waypoint] = []
    for other in all_flights:
        if other.id == flight.id:
            continue
        if len(other.waypoints) > 2:
            others.extend(other.waypoints[1:-1])
        elif len(other.waypoints) == 2 and other.waypoints[1].is_orbit:
            others.append(other.waypoints[1])

    # Build flat DMS → aim_point_id index across all targets.
    aim_by_dms: dict[str, str] = {}
    for tgt in targets.values():
        for ap in tgt.get("aim_points", []):
            ap_dms = ap.get("coords", "")
            ap_id  = ap.get("id", "")
            if ap_dms and ap_id:
                aim_by_dms[ap_dms] = ap_id

    # Track already-emitted orbit positions to suppress near-duplicates
    emitted_orbits: list[tuple[float, float]] = []  # (x, y) in DCS world coords

    result = []
    for wp in inner:
        wp_dms = dms(wp.lat, wp.lon)

        # Marshal point: name starts with "MARSHALL "
        if wp.name and wp.name.upper().startswith("MARSHALL "):
            marshal_name = wp.name.strip()
            if marshal_name not in ref_pts:
                ref_pts[marshal_name] = {
                    "name":   marshal_name,
                    "type":   "marshal",
                    "coords": wp_dms,
                }
            result.append({"name_ref": marshal_name, "name": marshal_name})
            continue

        # Orbit deduplication: skip if a very close orbit already exists
        if wp.is_orbit:
            too_close = any(
                _nm_between(wp.x, wp.y, ox, oy) < _ORBIT_MERGE_NM
                for ox, oy in emitted_orbits
            )
            if too_close:
                continue
            emitted_orbits.append((wp.x, wp.y))

        # Proximity check against other flights' waypoints (shared logical point)
        shared_name = None
        for ow in others:
            dist = math.sqrt((wp.x - ow.x)**2 + (wp.y - ow.y)**2)
            if dist <= MERGE_M:
                wp_n = (wp.name or "").strip()
                ow_n = (ow.name or "").strip()
                if wp_n == ow_n or not wp_n or not ow_n:
                    shared_name = wp_n or ow_n or None
                    break

        # Aim-point match — use the specific aim_point id (e.g. "SAM-14-RD1")
        aim_point_id = aim_by_dms.get(wp_dms)

        entry: dict = {"coords": wp_dms}
        if wp.name:
            entry["name"] = wp.name
        if wp.alt_ft is not None:
            entry["alt_ft"] = wp.alt_ft
        if aim_point_id:
            entry["aim_point_id"] = aim_point_id
        if shared_name is not None:
            entry["shared"] = True
        # Orbit/anchor track — include parameters so the map can render a racetrack
        if wp.is_orbit:
            entry["orbit"] = {
                "alt_ft":      wp.orbit_alt_ft,
                "speed_kts":   wp.orbit_speed_kts,
                "width_nm":    wp.orbit_width_nm,
                "leg_nm":      wp.orbit_leg_nm,
                "heading_deg": wp.orbit_heading_deg,
                "cw":          wp.orbit_cw,
            }

        result.append(entry)

    return result


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
    for tgt_id, ap_ids in seen_tgt.items():
        tgt_info = targets.get(tgt_id, {})
        raw_name = tgt_info.get('name') or tgt_id
        location = re.sub(r'\s*\([^)]+\)\s*$', '', raw_name).strip() or tgt_id
        entry: dict = {
            "location":  location,
            "target_id": tgt_id,
        }
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


def build_missions(flights: list[Flight], msn_start: int, tanker_msn_start: int,
                   targets: dict, carriers: list[Carrier],
                   airfields: dict[str, dict], ref_pts: dict) -> list[dict]:
    """
    Produce the ato.missions list. Steer points are extracted and classified.
    Tankers receive a separate mission number from tanker_msn_start.
    """
    missions = []
    strike_i = tanker_i = 0

    for f in flights:
        if f.is_awacs:
            continue  # AWACS go to registry.control_agencies, not missions
        if f.is_tanker:
            msn_num = f"MSN{tanker_msn_start + tanker_i}"
            tanker_i += 1
        else:
            msn_num = f"MSN{msn_start + strike_i}"
            strike_i += 1

        callsign = f.name  # group name is the mission callsign
        ac_base  = f.aircraft_type.split('_')[0]
        ac_type  = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        count    = len(f.units)
        loadout_str = encode_loadout(
            f.units[0].loadout if f.units else [], f.task)

        deploy, recovery = _home_base(f, airfields, carriers)
        if not deploy and f.is_tanker:
            for wp in (f.waypoints or []):
                if wp.airdrome_id is not None:
                    info = AIRDROME_IDS.get(wp.airdrome_id)
                    if info:
                        deploy = info["icao"]
                        break
        if not recovery and deploy:
            recovery = deploy

        # Build steer points — also mutates ref_pts to add any marshal points
        steer_pts = _classify_waypoints(f, flights, targets, carriers, ref_pts)

        msn_targets = None if f.is_tanker else \
            _build_mission_targets(steer_pts, targets, f.task)

        msn: dict = {
            "mission_number":       msn_num,
            "callsign":             callsign,
            "mission_type":         "REFUELING" if f.is_tanker else f.task,
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
            "steer_points":    steer_pts or None,
            "dtc_cartridge":   f.dtc_cartridge,
        }

        missions.append(msn)
    return missions
