"""build_doc — assemble the final YAML document dict from all parsed data."""

from __future__ import annotations

import random
import re
import textwrap
from pathlib import Path

from .dtc import build_comms_from_dtc
from .log import log
from .models import Carrier, Flight
from .build_missions import (
    AIRDROME_IDS, CVN_NAMES,
    ato_callsign, build_airfields_registry, build_lines_registry, build_missions,
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


def build_callsigns_registry(flights: list[Flight]) -> dict | None:
    """Build a callsigns registry from the extracted flights (excluding AWACS)."""
    result: dict = {}
    for f in flights:
        if f.is_awacs:
            continue
        ac_base = f.aircraft_type.split('_')[0]
        ac_type = re.sub(r'[^A-Z0-9]', '', ac_base.upper())
        result[ato_callsign(f.name) or f.name] = {
            "type":  ac_type,
            "role":  f.task + " flight lead" if not f.is_tanker else f.task,
        }
    return result or None


# DCS tanker unit type → the AR system it offers (registry.tankers[].system).
# A fact of the airframe, so it is filled from the type; unknown types are left out.
TANKER_AR_SYSTEM: dict[str, str] = {
    "KC-135":           "BOOM",
    "KC_10_Extender":   "BOOM",
    "KC135MPRS":        "DROGUE",
    "KC_10_Extender_D": "DROGUE",
    "KC130":            "DROGUE",
    "KC130J":           "DROGUE",
    "S-3B Tanker":      "DROGUE",
    "IL-78M":           "DROGUE",
}


def build_tankers_list(flights: list[Flight],
                       mission_numbers: dict[str, str] | None = None) -> list[dict] | None:
    """
    Build a list of tanker entries for registry.tankers.
    Each entry has: callsign, the tanker's own REFUELING mission_number
    (mission_numbers maps group name → mission number), altitude, speed_kts,
    frequency, TACAN, AR system, ARCP (the orbit waypoint's name, when it has
    one) and orbit parameters (anchor_coords, heading_deg, leg_nm, width_nm)
    extracted from the first orbit waypoint.  Offload is not in the .miz and
    is never emitted.
    """
    mission_numbers = mission_numbers or {}
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
        orbit_direction: str = "ccw"  # Default counterclockwise
        arcp: str | None = None
        for wp in f.waypoints:
            if wp.is_orbit:
                arcp = wp.name.strip().upper() if wp.name and wp.name.strip() else None
                alt_ft             = wp.orbit_alt_ft
                speed_kts          = wp.orbit_speed_kts
                orbit_leg_nm       = wp.orbit_leg_nm
                orbit_width_nm     = wp.orbit_width_nm
                orbit_heading_deg  = wp.orbit_heading_deg
                orbit_anchor_coords = dms(wp.lat, wp.lon)
                orbit_direction    = "cw" if wp.orbit_cw else "ccw"
                break
        entry: dict = {"callsign": ato_callsign(f.name) or f.name}
        if f.name in mission_numbers:
            entry["mission_number"] = mission_numbers[f.name]
        if f.freq_mhz:
            entry["freq_mhz"] = f.freq_mhz
        if f.tacan:
            entry["tacan"] = f.tacan
        system = TANKER_AR_SYSTEM.get(f.units[0].type if f.units else f.aircraft_type)
        if system:
            entry["system"] = system
        if arcp:
            entry["arcp"] = arcp
        if alt_ft is not None:
            entry["altitude_ft"] = alt_ft
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
        entry["orbit_direction"] = orbit_direction
        # Remove deprecated fields (ar_track, altitude) — not stored in registry
        result.append(entry)
    return result or None


def build_control_agencies(flights: list[Flight],
                           mission_numbers: dict[str, str] | None = None) -> dict | None:
    """
    Build registry.control_agencies from AWACS flights.
    Each entry is keyed by the ATO callsign (the mission callsign) and names
    the agency's own AEW mission through mission_number (mission_numbers maps
    group name → mission number).
    """
    mission_numbers = mission_numbers or {}
    result: dict = {}
    for f in flights:
        if not f.is_awacs:
            continue
        callsign = ato_callsign(f.name) or f.name
        entry: dict = {
            "type":             "AWACS",
            "callsign":         callsign,
            "primary_freq_mhz": str(round(f.freq_mhz, 3)),
        }
        if f.name in mission_numbers:
            entry["mission_number"] = mission_numbers[f.name]
        result[callsign] = entry
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
                log.warning("Flight '%s': DTC '%s' not found in archive — skipping comms", f.name, f.dtc_cartridge)
                continue
            uhf, vhf = build_comms_from_dtc(dtcs[f.dtc_cartridge])
            entries.append({
                "group":         f.name,
                "callsign":      ato_callsign(f.name) or f.name,
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
                "callsign":      ato_callsign(f.name) or f.name,
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


def _random_squawk(exclude: set[str]) -> str:
    """
    Return a random 4-octal-digit Mode-3 squawk avoiding emergency codes,
    duplicates, and the 6xxx block crc-sync hands to AI traffic (S-L3).
    """
    forbidden = {"7500", "7600", "7700"}
    while True:
        code = "".join(str(random.randint(0, 7)) for _ in range(4))
        if code[0] != "6" and code not in forbidden and code not in exclude:
            return code


def build_spins_sections(missions: list[dict] | None,
                          control_agencies: dict | None) -> list[dict]:
    """
    Auto-generate the standard SPINS sections from ATO mission data.

    Produces sections C1 (Command & Control), C3 (IFF/SIF), C4 (ROE),
    C5 (Execution), C7 (Lost Comms), C8 (Abort Criteria), C9 (SAR),
    C10 (Authentication), and C11 (Safety).

    Text content is stored as a ``markdown`` string in each section.
    IFF squawk codes are randomised (valid octal, no emergency codes).
    """
    missions = missions or []
    control_agencies = control_agencies or {}

    sections: list[dict] = []

    # ── C1 — COMMAND & CONTROL ───────────────────────────────────────────────
    c1_lines = ["## C1.1 — Tactical Control"]
    if control_agencies:
        for ag in control_agencies.values():
            callsign = ag.get("callsign", "")
            freq     = ag.get("primary_freq_mhz", "")
            role     = ag.get("type", "AWACS").upper()
            value    = callsign + (f" / {freq} MHz" if freq else "")
            c1_lines.append(f"**PRIMARY {role}**: {value}")
    else:
        c1_lines.append("**PRIMARY AWACS**: ")
    c1_lines += ["", "## C1.3 — Package Lead", "**PACKAGE LEAD**: "]
    sections.append({"title": "C1 — COMMAND & CONTROL",
                     "markdown": "\n".join(c1_lines)})

    # ── C3 — IFF / SIF ───────────────────────────────────────────────────────
    iff_rows = []
    used_codes: set[str] = set()
    for m in missions:
        msn    = str(m.get("mission_number", "")).replace("MSN", "").strip()
        squawk = _random_squawk(used_codes)
        used_codes.add(squawk)
        iff_rows.append([msn, "3", squawk])

    c3: dict = {
        "title": "C3 — IFF / SIF",
        "note":  "Squawk assigned Mode 3 code. Mode 4 mandatory.",
    }
    if iff_rows:
        c3["table"] = {"headers": ["MSN", "MODE", "CODE"], "rows": iff_rows}
    sections.append(c3)

    # ── C4 — RULES OF ENGAGEMENT ─────────────────────────────────────────────
    sections.append({
        "title": "C4 — RULES OF ENGAGEMENT",
        "markdown": textwrap.dedent("""\
            ## C4.1 — PID
            PID required prior to weapons release on air contacts unless hostile act is demonstrated.
            - PID on surface targets not designated by ATO required
            **PID SOURCES**: NCTR / radar profile, Correlated track from CRC/AWACS, Visual ID (VID)

            ## C4.2 — BVR
            - Weapons free against aircraft declared HOSTILE or demonstrating hostile act

            ## C4.3 — SFC ATTACK
            - Weapons release authorized only on assigned ATO targets

            ## C4.4 — Civilian Traffic
            NO FACTOR"""),
    })

    # ── C5 — EXECUTION ───────────────────────────────────────────────────────
    c5_blocks: list[str] = []
    for m in missions:
        msn_raw      = str(m.get("mission_number", "")).replace("MSN", "").strip()
        callsign     = m.get("callsign", "")
        mission_type = m.get("mission_type", "")
        prefix       = f"C5.{msn_raw} — " if msn_raw else ""
        heading_text = prefix + callsign + (f" ({mission_type})" if mission_type else "")
        if heading_text.strip():
            c5_blocks.append(
                f"## {heading_text}\n**OBJECTIVE**: \n**DESIRED EFFECTS**: "
            )
    sections.append({"title": "C5 — EXECUTION",
                     "markdown": "\n\n".join(c5_blocks)})

    # ── C7 — LOST COMMS ──────────────────────────────────────────────────────
    sections.append({
        "title": "C7 — LOST COMMS",
        "markdown": textwrap.dedent("""\
            ## C7.1 — Loss of AWACS
            - Default to package commander control
            - Abort mission if communication cannot be restored within 5 minutes

            ## C7.2 — Loss of Package Comms
            - Continue mission if task and ROE remain clear
            - Abort in case of degraded situation awareness

            ## C7.3 — Loss of Intraflight Comms
            - Continue assigned task
            - Reestablish communication post target if feasible
            - Abort mission if communication cannot be reestablished"""),
    })

    # ── C8 — ABORT CRITERIA ──────────────────────────────────────────────────
    sections.append({
        "title": "C8 — ABORT CRITERIA",
        "markdown": textwrap.dedent("""\
            - Target PID cannot be confirmed
            - Collateral damage risk exceeds authorization
            - Fuel state prevents safe recovery
            - Supporting mission unsuccessful and threat unacceptable
            - Major technical faults"""),
    })

    # ── C9 — SEARCH AND RESCUE ───────────────────────────────────────────────
    sections.append({
        "title": "C9 — SEARCH AND RESCUE",
        "markdown": "NOT SIMULATED",
    })

    # ── C10 — AUTHENTICATION ─────────────────────────────────────────────────
    sections.append({
        "title": "C10 — AUTHENTICATION",
        "markdown": "**AUTHENTICATION**: Daily authentication table per COMSEC",
    })

    # ── C11 — SAFETY ─────────────────────────────────────────────────────────
    sections.append({
        "title": "C11 — SAFETY",
        "markdown": "**MINIMUM SEPARATION**: "
                    "3NM / 1000ft between coalition aircraft outside tactical formation",
    })

    return sections


def build_doc(*, mission_name, mission_date, theatre,
              year, month, targets, ref_pts, acms, metar, wx_notes,
              flights, carriers, dtcs=None,
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
        log.warning("Unknown theatre '%s' — local_offset_hours will be None", theatre)

    # Compute Zulu start time from local start time and theatre offset
    ingame_start_zulu = None
    if ingame_start_local and local_offset_hours is not None:
        local_mins = int(ingame_start_local[:2]) * 60 + int(ingame_start_local[2:])
        zulu_mins  = (local_mins - local_offset_hours * 60) % 1440
        ingame_start_zulu = f"{zulu_mins // 60:02d}{zulu_mins % 60:02d}"
        log.info("ingame_start_local=%sL → ingame_start_time=%sZ", ingame_start_local, ingame_start_zulu)

    msn_start = 1000 + int(hashlib.md5(mission_name.encode()).hexdigest()[:4], 16) % 8000

    airfields = build_airfields_registry(flights, carriers, theatre)

    # Build missions — also mutates ref_pts to add marshal points found in routes.
    # Tankers and AWACS are missions too (REFUELING / AEW, ADR 0089); one per flight.
    missions_result = build_missions(
        flights, msn_start,
        targets, carriers, airfields, ref_pts,
        dtcs=dtcs or {},
        theatre=theatre)
    missions = missions_result[0] or None
    steerpoints = missions_result[1] or None

    # build_missions emits one mission per flight, in flight order.
    mission_numbers = {f.name: m["mission_number"]
                       for f, m in zip(flights, missions or [])}

    flight_comms = build_flight_comms(flights, dtcs or {})
    frequencies = build_frequencies_registry(flight_comms or [])

    control_agencies = build_control_agencies(flights, mission_numbers)

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
            "tankers":          build_tankers_list(flights, mission_numbers),
            "targets":          targets or None,
            "reference_points": list(ref_pts.values()) or None,
            "steerpoints":      steerpoints,
            "lines":            build_lines_registry(flights, dtcs or {}, theatre),
            "control_agencies": control_agencies,
            "frequencies":      frequencies,
        },

        "ato": {
            "irl_date":           None,
            "irl_time_zulu":      None,
            "ingame_start_time":  ingame_start_zulu,
            "ingame_start_local": ingame_start_local,
            "local_offset_hours": local_offset_hours,
            "missions":           missions,
        },

        "aco": {
            "id":       f"ACO-{year}-{month:02d}",
            "timezone": "UTC",
            "acms":     acms or None,
        },

        "spins": {
            "version":  "1.0",
            "sections": [],
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
        },

        "_meta": {
            "source":      Path(mission_name).name,
            "theatre":     theatre,
            "targets":     len(targets),
            "acm_zones":   len(acms),
            "missions":    len(missions or []),
            "tankers":     len([f for f in flights if f.is_tanker]),
            "awacs":       len([f for f in flights if f.is_awacs]),
            "steerpoints": len(steerpoints) if steerpoints else 0,
            "airfields":   len(airfields),
        },
    }
