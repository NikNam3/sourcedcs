"""parse_flights — parse DCS Lua text into Flight, Carrier, and weather objects."""

from __future__ import annotations

import math

from .lua import lua_bool, lua_get_block, lua_iter_array, lua_num, lua_num_map, lua_str, lua_xy
from .models import Carrier, Flight, FlightUnit, Waypoint
from .parse import _group_outer_name, _strip_dcs_suffix
from .projection import dcs_to_latlon, dms
from .weapons import CARRIER_TYPES, TASK_LABELS, condense_loadout, resolve_clsid

_M_TO_FT  = 3.28084    # metres → feet
_MPS_TO_KT = 1.94384   # m/s → knots
_M_TO_NM  = 1852.0     # metres per nautical mile


def _parse_callsign(cs_block: str | None) -> str:
    """Extract callsign name from the callsign sub-block."""
    if not cs_block:
        return ""
    return lua_str(cs_block, 'name') or ""


def _project_position(x1: float, y1: float, x2: float, y2: float,
                      speed_ms: float, hours: float) -> tuple[float, float]:
    """Project a position along a track vector N hours ahead at given speed."""
    dx, dy = x2 - x1, y2 - y1
    dist = math.sqrt(dx*dx + dy*dy)
    if dist < 1:
        return x1, y1
    t = hours * 3600
    return x1 + (dx/dist)*speed_ms*t, y1 + (dy/dist)*speed_ms*t


def _parse_waypoints(route_block: str, theatre: str) -> list[Waypoint]:
    """Parse route.points into Waypoint objects."""
    points_block = lua_get_block(route_block, 'points')
    if not points_block:
        return []
    wpts: list[Waypoint] = []
    for _pi, pb in lua_iter_array(points_block):
        xy = lua_xy(pb)
        if not xy:
            continue
        typ        = lua_str(pb, 'type') or ''
        name       = lua_str(pb, 'name')
        airdrome   = lua_num(pb, 'airdromeId')
        link_unit  = lua_num(pb, 'linkUnit')
        alt_m      = lua_num(pb, 'alt')
        wp_alt_ft  = round(alt_m * _M_TO_FT) if alt_m is not None else None
        # Detect orbit task (tanker track anchor) and extract its parameters
        task_blk   = lua_get_block(pb, 'task')
        is_orbit   = bool(task_blk and 'Orbit' in task_blk)
        orbit_alt_ft = orbit_speed_kts = orbit_width_nm = orbit_leg_nm = orbit_heading_deg = None
        orbit_cw: bool | None = None
        if is_orbit and task_blk:
            # Navigate into task.params.tasks[1].params to find the Orbit entry
            # Supports both ComboTask (params.tasks array) and ControlledTask (params.task)
            params_blk = lua_get_block(task_blk, 'params')
            tasks_blk  = lua_get_block(params_blk, 'tasks') if params_blk else None
            orbit_params_blk: str | None = None
            if tasks_blk:
                for _ti, tb in lua_iter_array(tasks_blk):
                    if lua_str(tb, 'id') == 'Orbit':
                        orbit_params_blk = lua_get_block(tb, 'params')
                        break
            if orbit_params_blk is None and params_blk:
                # ControlledTask structure: params.task.params
                task_inner = lua_get_block(params_blk, 'task')
                if task_inner and lua_str(task_inner, 'id') == 'Orbit':
                    orbit_params_blk = lua_get_block(task_inner, 'params')
            if orbit_params_blk:
                op = orbit_params_blk
                alt_m   = lua_num(op, 'altitude')
                spd_ms  = lua_num(op, 'speed')
                w_m     = lua_num(op, 'width')
                leg_m   = lua_num(op, 'legLength')
                hdg_rad = lua_num(op, 'hotLegDir')  # DCS stores in radians
                if alt_m   is not None: orbit_alt_ft      = round(alt_m   * _M_TO_FT)
                if spd_ms  is not None: orbit_speed_kts   = round(spd_ms  * _MPS_TO_KT)
                if w_m     is not None: orbit_width_nm    = round(w_m     / _M_TO_NM, 1)
                if leg_m   is not None: orbit_leg_nm      = round(leg_m   / _M_TO_NM, 1)
                if hdg_rad is not None: orbit_heading_deg = round(math.degrees(hdg_rad))
                orbit_cw = lua_bool(op, 'clockWise')
        lat, lon   = dcs_to_latlon(xy[0], xy[1], theatre)
        wpts.append(Waypoint(
            name=name, x=xy[0], y=xy[1], lat=lat, lon=lon,
            typ=typ,
            airdrome_id=int(airdrome) if airdrome is not None else None,
            link_unit_id=int(link_unit) if link_unit is not None else None,
            is_orbit=is_orbit,
            alt_ft=wp_alt_ft,
            orbit_alt_ft=orbit_alt_ft,
            orbit_speed_kts=orbit_speed_kts,
            orbit_width_nm=orbit_width_nm,
            orbit_leg_nm=orbit_leg_nm,
            orbit_heading_deg=orbit_heading_deg,
            orbit_cw=orbit_cw,
        ))
    return wpts


def parse_flights_and_carriers(
    coalition_block: str, theatre: str
) -> tuple[list[Flight], list[Carrier]]:
    """
    Walk all countries in a coalition block.
    - 'plane' groups  → Flight objects (with parsed waypoints)
    - 'ship' groups   → Carrier objects (with 4-hour projected recovery position)
    """
    flights: list[Flight]   = []
    carriers: list[Carrier] = []
    flt_seq = car_seq = 1

    country_block = lua_get_block(coalition_block, 'country')
    if not country_block:
        return flights, carriers

    for _ci, country in lua_iter_array(country_block):

        # ── Carriers ────────────────────────────────────────────
        ship_block = lua_get_block(country, 'ship')
        if ship_block:
            grp = lua_get_block(ship_block, 'group')
            if grp:
                for _gi, gb in lua_iter_array(grp):
                    gname  = lua_str(gb, 'name')
                    ub_blk = lua_get_block(gb, 'units')
                    if not ub_blk:
                        continue

                    # Collect carrier unit + route for projection
                    route  = lua_get_block(gb, 'route')
                    r_wpts = _parse_waypoints(route, theatre) if route else []

                    for _ui, ub in lua_iter_array(ub_blk):
                        utype   = lua_str(ub, 'type')
                        uname   = lua_str(ub, 'name')
                        unit_id = lua_num(ub, 'unitId')
                        if utype not in CARRIER_TYPES:
                            continue
                        xy = lua_xy(ub)
                        if not xy:
                            continue

                        deploy_lat, deploy_lon = dcs_to_latlon(xy[0], xy[1], theatre)
                        deploy_c = dms(deploy_lat, deploy_lon)

                        # Project 4h ahead from carrier unit position along route heading
                        recovery_c = deploy_c
                        pts_blk = lua_get_block(route, 'points') if route else None
                        if pts_blk and len(r_wpts) >= 2:
                            spd = 0.0
                            for _ri, rp in lua_iter_array(pts_blk):
                                s = lua_num(rp, 'speed')
                                if s and s > 0:
                                    spd = s
                                    break
                            # Project from carrier unit's actual xy toward second route wp
                            rx, ry = _project_position(
                                xy[0], xy[1],
                                r_wpts[1].x, r_wpts[1].y,
                                spd, 4.0)
                            rec_lat, rec_lon = dcs_to_latlon(rx, ry, theatre)
                            recovery_c = dms(rec_lat, rec_lon)

                        c_obj = Carrier(
                            id=f"CVN-{car_seq}",
                            type=utype,
                            name=uname or gname or utype,
                            unit_id=int(unit_id) if unit_id is not None else 0,
                            deploy_coords=deploy_c,
                            recovery_coords=recovery_c,
                        )
                        # Store raw DCS coords for proximity matching in _home_base
                        c_obj._x = xy[0]  # type: ignore[attr-defined]
                        c_obj._y = xy[1]  # type: ignore[attr-defined]
                        carriers.append(c_obj)
                        car_seq += 1

        # ── Flights ─────────────────────────────────────────────
        plane_block = lua_get_block(country, 'plane')
        if not plane_block:
            continue
        grp = lua_get_block(plane_block, 'group')
        if not grp:
            continue

        for _gi, gb in lua_iter_array(grp):
            raw_name = _group_outer_name(gb) or f"FLT-{flt_seq}"
            gname    = _strip_dcs_suffix(raw_name)
            task_raw = lua_str(gb, 'task') or 'Nothing'
            task     = TASK_LABELS.get(task_raw, task_raw.upper())
            freq_raw = lua_num(gb, 'frequency') or 0.0
            freq_mhz = freq_raw / 1e6 if freq_raw > 1e6 else freq_raw
            is_tanker = (task == 'TANKER')
            is_awacs  = (task == 'AWACS')

            ub_blk = lua_get_block(gb, 'units')
            if not ub_blk:
                continue

            flight_units: list[FlightUnit] = []
            aircraft_type = ""
            first_unit_radio: dict[int, dict[int, float]] | None = None

            for _ui, ub in lua_iter_array(ub_blk):
                utype   = lua_str(ub, 'type') or '?'
                skill   = lua_str(ub, 'skill') or ''
                onboard = lua_str(ub, 'onboard_num') or ''
                cs_blk  = lua_get_block(ub, 'callsign')
                cs      = _parse_callsign(cs_blk)
                if not aircraft_type:
                    aircraft_type = utype
                payload_blk = lua_get_block(ub, 'payload')
                pylons_blk  = lua_get_block(payload_blk, 'pylons') if payload_blk else None
                weapons_raw: list[str] = []
                if pylons_blk:
                    for _pi, pb in lua_iter_array(pylons_blk):
                        clsid = lua_str(pb, 'CLSID')
                        if clsid:
                            weapons_raw.append(resolve_clsid(clsid))
                # Extract DTC cartridge name from this unit's DTC block
                unit_dtc: str | None = None
                unit_dtc_blk = lua_get_block(ub, 'DTC')
                if unit_dtc_blk:
                    carts_blk = lua_get_block(unit_dtc_blk, 'Cartridges')
                    if carts_blk:
                        for _ci, cb in lua_iter_array(carts_blk):
                            n = lua_str(cb, 'name')
                            if n:
                                unit_dtc = n
                                break
                # Extract Radio channel presets for non-DTC units (first unit only)
                unit_radio: dict[int, dict[int, float]] | None = None
                if not unit_dtc and first_unit_radio is None:
                    radio_blk = lua_get_block(ub, 'Radio')
                    if radio_blk:
                        unit_radio = {}
                        for radio_idx, rb in lua_iter_array(radio_blk):
                            ch_blk = lua_get_block(rb, 'channels')
                            if ch_blk:
                                ch_map = lua_num_map(ch_blk)
                                if ch_map:
                                    unit_radio[radio_idx] = ch_map
                        if not unit_radio:
                            unit_radio = None
                    first_unit_radio = unit_radio  # capture once (may be None)
                flight_units.append(FlightUnit(
                    type=utype, callsign=cs, onboard_num=onboard,
                    skill=skill, loadout=condense_loadout(weapons_raw),
                    dtc_cartridge=unit_dtc,
                    radio_channels=unit_radio,
                ))

            if not flight_units:
                continue

            # Parse waypoints from route
            route  = lua_get_block(gb, 'route')
            wpts   = _parse_waypoints(route, theatre) if route else []

            # Primary DTC for this flight = first unit that has one
            flight_dtc = next((u.dtc_cartridge for u in flight_units if u.dtc_cartridge), None)

            flights.append(Flight(
                id=f"FLT-{flt_seq}",
                name=gname, task=task,
                aircraft_type=aircraft_type,
                freq_mhz=round(freq_mhz, 3),
                units=flight_units,
                waypoints=wpts,
                is_tanker=is_tanker,
                is_awacs=is_awacs,
                dtc_cartridge=flight_dtc,
            ))
            flt_seq += 1

    return flights, carriers


def parse_weather(mission_text: str, day: int) -> tuple[str, str]:
    wx = lua_get_block(mission_text, 'weather')
    if not wx:
        return f"METAR XXXX {day:02d}0000Z 00000KT 9999 SKC 15/00 Q1013 NOSIG", "No data."

    ground   = lua_get_block(wx, 'atGround')
    clouds   = lua_get_block(wx, 'clouds')
    vis_blk  = lua_get_block(wx, 'visibility')
    fog_blk  = lua_get_block(wx, 'fog')
    season   = lua_get_block(wx, 'season')

    wsp = lua_num(ground, 'speed')  if ground  else 0.0
    wdr = lua_num(ground, 'dir')    if ground  else 0.0
    tmp = lua_num(season, 'temperature') if season else 15.0
    cb  = lua_num(clouds, 'base')   if clouds  else 0.0
    cd  = lua_num(clouds, 'density') if clouds else 0.0
    vis = lua_num(vis_blk, 'distance') if vis_blk else 80000.0
    fog_vis = lua_num(fog_blk, 'visibility') if fog_blk else 0.0
    fog_on  = lua_bool(wx, 'enable_fog')
    dust_on = lua_bool(wx, 'enable_dust')
    qnh_hpa = round((lua_num(wx, 'qnh') or 760.0) * 1.33322)

    wkt   = round((wsp or 0) * 1.944)
    wdr_i = round(wdr or 0)
    t_i   = round(tmp or 15)

    wind_s = f"{wdr_i:03d}{wkt:02d}KT" if wkt else "00000KT"
    vis_s  = str(min(int(fog_vis), 9999)) if (fog_on and fog_vis) \
             else ("9999" if (vis or 0) >= 9999 else str(int(vis or 0)))

    cbfl = round((cb or 0) * 3.28084 / 100)
    if not cd or not cb or cd == 0 or cb == 0:
        cld_s = "SKC"
    elif cd <= 2:   cld_s = f"FEW{cbfl:03d}"
    elif cd <= 4:   cld_s = f"SCT{cbfl:03d}"
    elif cd <= 7:   cld_s = f"BKN{cbfl:03d}"
    else:           cld_s = f"OVC{cbfl:03d}"

    t_s   = f"{t_i:02d}" if t_i >= 0 else f"M{abs(t_i):02d}"
    metar = f"METAR XXXX {day:02d}0000Z {wind_s} {vis_s} {cld_s} {t_s}/00 Q{qnh_hpa} NOSIG"

    notes = []
    if cd and cb and cd > 0 and cb > 0:
        notes.append(f"Cloud base {int((cb or 0)*3.28)}ft {cld_s}.")
    if fog_on and fog_vis:
        notes.append(f"Fog visibility {int(fog_vis)}m.")
    if dust_on:
        notes.append("Dust/haze active.")
    if wkt > 15:
        notes.append(f"Surface winds {wdr_i:03d}/{wkt}kt.")
    if not notes:
        notes.append("Clear and unrestricted.")
    return metar, " ".join(notes)
