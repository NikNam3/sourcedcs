"""build_doc — assemble the final YAML document dict from all parsed data."""

from __future__ import annotations

import re
from pathlib import Path

from .dtc import build_comms_from_dtc
from .models import Carrier, Flight
from .build_missions import (
    AIRDROME_IDS, CVN_NAMES,
    build_airfields_registry, build_missions,
)
from .projection import dms


def build_carriers_registry(carriers: list[Carrier]) -> dict:
    result = {}
    for c in carriers:
        result[c.id] = {
            "name":            CVN_NAMES.get(c.type, c.type),
            "callsign":        c.name,
            "deploy_coords":   c.deploy_coords,
            "recovery_coords": c.recovery_coords,
        }
    return result


def build_carriers_ato(carriers: list[Carrier]) -> list[dict]:
    return [{"id": c.id} for c in carriers]


def build_callsigns_registry(flights: list[Flight]) -> dict | None:
    """Build a callsigns registry from the extracted flights (excluding AWACS)."""
    result: dict = {}
    for f in flights:
        if f.is_awacs:
            continue
        ac_base = f.aircraft_type.split('_')[0]
        ac_type = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        result[f.name] = {
            "type":  ac_type,
            "role":  f.task + " flight lead" if not f.is_tanker else f.task,
        }
    return result or None


def build_tankers_list(flights: list[Flight]) -> list[dict] | None:
    """
    Build a list of tanker entries for registry.tankers.
    Each entry has: callsign, altitude, speed_kts, and orbit parameters
    (anchor_coords, heading_deg, leg_nm, width_nm) extracted from the first
    orbit waypoint.
    """
    result = []
    for f in flights:
        if not f.is_tanker:
            continue
        # Grab orbit params from the first orbit waypoint if available
        alt_ft: int | None = None
        speed_kts: int | None = None
        orbit_anchor_coords: str | None = None
        orbit_heading_deg: int | None = None
        orbit_leg_nm: float | None = None
        orbit_width_nm: float | None = None
        for wp in f.waypoints:
            if wp.is_orbit:
                alt_ft             = wp.orbit_alt_ft
                speed_kts          = wp.orbit_speed_kts
                orbit_leg_nm       = wp.orbit_leg_nm
                orbit_width_nm     = wp.orbit_width_nm
                orbit_heading_deg  = wp.orbit_heading_deg
                orbit_anchor_coords = dms(wp.lat, wp.lon)
                break
        entry: dict = {"callsign": f.name}
        if alt_ft is not None:
            entry["altitude_ft"] = alt_ft
            entry["altitude"]    = f"FL{round(alt_ft / 100):03d}"
        if speed_kts is not None:
            entry["speed_kts"] = speed_kts
        if orbit_anchor_coords is not None:
            entry["orbit_anchor_coords"] = orbit_anchor_coords
        if orbit_heading_deg is not None:
            entry["orbit_heading_deg"] = orbit_heading_deg
        if orbit_leg_nm is not None:
            entry["orbit_leg_nm"] = orbit_leg_nm
        if orbit_width_nm is not None:
            entry["orbit_width_nm"] = orbit_width_nm
        result.append(entry)
    return result or None


def build_control_agencies(flights: list[Flight]) -> dict | None:
    """
    Build registry.control_agencies from AWACS flights.
    Each entry is keyed by the group name (the mission callsign).
    """
    result: dict = {}
    for f in flights:
        if not f.is_awacs:
            continue
        ac_base  = f.aircraft_type.split('_')[0]
        platform = re.sub(r'[^A-Z0-9\-]', '', ac_base.upper())
        result[f.name] = {
            "type":              "AWACS",
            "callsign":          f.name,
            "platform":          platform,
            "primary_freq_mhz":  str(round(f.freq_mhz, 3)),
        }
    return result or None


def build_flight_comms(flights: list[Flight], dtcs: dict[str, dict]) -> list[dict] | None:
    """
    Build per-flight comms list.  Each entry has the flight group name,
    callsign (= group name), DTC cartridge name, and UHF/VHF channel dicts.

    Channel dicts map channel number → freq_mhz (float).  Frequency metadata
    (callsign, role) lives in registry.frequencies and is resolved by the renderer.

    DTC flights use DTC data.  Non-DTC flights with Radio channel presets use
    Radio[1] (UHF) and Radio[2] (VHF) from the first unit (channels 1–20 only).
    """
    entries = []
    for f in flights:
        if f.dtc_cartridge:
            if f.dtc_cartridge not in dtcs:
                print(f"[!] Flight '{f.name}': DTC '{f.dtc_cartridge}' not found in archive — skipping comms")
                continue
            uhf, vhf = build_comms_from_dtc(dtcs[f.dtc_cartridge])
            entries.append({
                "group":         f.name,
                "callsign":      f.name,
                "dtc_cartridge": f.dtc_cartridge,
                "uhf_presets":   uhf,
                "vhf_presets":   vhf,
            })
        else:
            # Non-DTC flight: use Radio channel presets from the first unit
            first_unit = f.units[0] if f.units else None
            if not first_unit or not first_unit.radio_channels:
                continue
            radio = first_unit.radio_channels
            # Radio[1] = UHF (≥225 MHz), Radio[2] = VHF (<225 MHz)
            # Only channels 1–20 are included.
            uhf: dict[int, float] = {}
            vhf: dict[int, float] = {}
            for radio_idx in sorted(radio.keys()):
                ch_map = radio[radio_idx]
                for ch_num in sorted(ch_map.keys()):
                    if ch_num < 1 or ch_num > 20:
                        continue
                    freq = ch_map[ch_num]
                    if freq >= 225.0:
                        if ch_num not in uhf:
                            uhf[ch_num] = freq
                    else:
                        if ch_num not in vhf:
                            vhf[ch_num] = freq
            if not uhf and not vhf:
                continue
            entries.append({
                "group":         f.name,
                "callsign":      f.name,
                "dtc_cartridge": None,
                "uhf_presets":   dict(sorted(uhf.items())) or None,
                "vhf_presets":   dict(sorted(vhf.items())) or None,
            })
    return entries or None


def build_frequencies_registry(flight_comms: list[dict]) -> list[dict] | None:
    """
    Collect all unique frequencies referenced in the flight comms channel assignments
    and return a deduplicated list of frequency stubs for registry.frequencies.
    Each entry has freq_mhz (the canonical value), callsign (null), and role (null).
    Users annotate callsign/role manually in the YAML or via the editor.
    """
    seen: set[float] = set()
    result: list[dict] = []
    for entry in flight_comms:
        for band in ('uhf_presets', 'vhf_presets'):
            presets = entry.get(band) or {}
            for freq in presets.values():
                if isinstance(freq, (int, float)) and freq not in seen:
                    seen.add(freq)
                    result.append({'freq_mhz': float(freq), 'callsign': None, 'role': None})
    result.sort(key=lambda x: x['freq_mhz'])
    return result or None


def build_doc(*, mission_name, mission_date, theatre,
              year, month, targets, ref_pts, acms, metar, wx_notes,
              flights, carriers, dtcs=None, spins_sections=None,
              ingame_start_local=None,
              extra_metars=None, extra_tafs=None) -> dict:

    import hashlib

    # ── Theatre → local UTC offset (hours) ──────────────────────────────────
    # DCS uses fixed offsets regardless of daylight saving time.
    _THEATRE_OFFSET: dict[str, int] = {
        "Syria":          3,   # Damascus / Incirlik: UTC+3
        "PersianGulf":    4,   # UAE / Gulf Standard Time: UTC+4
        "Caucasus":       4,   # Tbilisi / Georgia: UTC+4
        "Nevada":        -8,   # Las Vegas (Pacific Standard Time): UTC-8
        "Normandy":       1,   # Western Europe (UTC+1, no DST applied)
        "MarianaIslands": 10,  # Chamorro Standard Time: UTC+10
        "Falklands":     -3,   # Argentina / Falklands: UTC-3
        "SinaiMap":       2,   # Egypt Standard Time: UTC+2
    }
    local_offset_hours = _THEATRE_OFFSET.get(theatre)
    if local_offset_hours is None and theatre:
        print(f"[!] Unknown theatre '{theatre}' — local_offset_hours will be None")

    # Compute Zulu start time from local start time and theatre offset
    ingame_start_zulu = None
    if ingame_start_local and local_offset_hours is not None:
        local_mins = int(ingame_start_local[:2]) * 60 + int(ingame_start_local[2:])
        zulu_mins  = (local_mins - local_offset_hours * 60) % 1440
        ingame_start_zulu = f"{zulu_mins // 60:02d}{zulu_mins % 60:02d}"
        print(f"[+] ingame_start_local={ingame_start_local}L → ingame_start_time={ingame_start_zulu}Z")

    msn_start = 1000 + int(hashlib.md5(mission_name.encode()).hexdigest()[:4], 16) % 8000

    # Bullseye name references registry.reference_points (first bullseye entry)
    bullseye_key = next(
        (v["name"] for v in ref_pts.values() if v.get("type") == "bullseye"),
        list(ref_pts.keys())[0] if ref_pts else None,
    )

    airfields = build_airfields_registry(flights, carriers, theatre)

    # Build missions — also mutates ref_pts to add marshal points found in routes.
    # AWACS and tanker flights are excluded from missions.
    missions = build_missions(
        flights, msn_start,
        targets, carriers, airfields, ref_pts) or None
    msn_numbers = [m["mission_number"] for m in missions] if missions else []

    ato_airfields = [{"icao": icao, "role": "deploy"} for icao in airfields] or None

    flight_comms = build_flight_comms(flights, dtcs or {})
    frequencies = build_frequencies_registry(flight_comms or [])

    control_agencies = build_control_agencies(flights)
    # If there is exactly one AWACS, set it as the default global_control agency
    awacs_agency_id = next(iter(control_agencies or {}), None)

    return {
        "schema_version": "1.0",

        "header": {
            "operation":      mission_name.upper().replace("_", " "),
            "ato_date":       mission_date,
            "classification": "CLASSIFIED",
        },

        "registry": {
            "callsigns":        build_callsigns_registry(flights),
            "airfields":        airfields or None,
            "carriers":         build_carriers_registry(carriers) or None,
            "tankers":          build_tankers_list(flights),
            "targets":          targets   or None,
            "reference_points": list(ref_pts.values()) or None,
            "control_agencies": control_agencies,
            "frequencies":      frequencies,
        },

        "ato": {
            "irl_date":           None,
            "irl_time_zulu":      None,
            "ingame_start_time":  ingame_start_zulu,
            "ingame_start_local": ingame_start_local,
            "local_offset_hours": local_offset_hours,
            "ae_flags":           ["IRL", "INGAME"],
            "global_control": {
                "agency_id": awacs_agency_id,
                "bullseye":  bullseye_key,
            },
            "airfields": ato_airfields,
            "carriers":  build_carriers_ato(carriers) or None,
            "missions":  missions,
        },

        "aco": {
            "id":                  f"ACO-{year}-{month:02d}",
            "timezone":            "UTC",
            "distributing_agency": "AUTO-EXTRACTED",
            "acms":                acms or None,
        },

        "spins": {
            "version":  "1.0",
            "sections": spins_sections,
        },

        "comms": {
            "wing_lead": None,
            "flights":   flight_comms,
        },

        "weather": {
            "issued":     mission_date,
            "valid_from": "0000Z",
            "valid_to":   "2359Z",
            "metars":     [metar] + (extra_metars or []),
            "tafs":       extra_tafs or None,
            "mission_wx": [{"mission_ref": msn, "notes": "No significant weather impact."}
                           for msn in msn_numbers] or None,
        },

        "_meta": {
            "source":      Path(mission_name).name,
            "theatre":     theatre,
            "targets":     len(targets),
            "acm_zones":   len(acms),
            "missions":    len([f for f in flights if not f.is_tanker and not f.is_awacs]),
            "tankers":     len([f for f in flights if f.is_tanker]),
            "awacs":       len([f for f in flights if f.is_awacs]),
            "airfields":   len(airfields),
        },
    }
