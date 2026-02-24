"""parse — parse DCS Lua text into Group, Drawing, and bullseye objects."""

from __future__ import annotations

import re

from .lua import lua_block_end, lua_get_block, lua_iter_array, lua_num, lua_str, lua_xy
from .models import Drawing, Group, Unit
from .projection import dcs_to_latlon, dms
from .sam import unit_role


def parse_units(units_block: str, theatre: str) -> list[Unit]:
    result = []
    for _i, ub in lua_iter_array(units_block):
        ut = lua_str(ub, 'type')
        xy = lua_xy(ub)
        if ut and xy:
            lat, lon = dcs_to_latlon(xy[0], xy[1], theatre)
            alt_m    = lua_num(ub, 'alt')
            result.append(Unit(type=ut, x=xy[0], y=xy[1],
                               lat=lat, lon=lon, role=unit_role(ut),
                               alt_m=alt_m))
    return result


def _strip_dcs_suffix(name: str) -> str:
    """
    DCS appends '-routeIdx-waypointIdx' to every group name.
    Strip to recover the human-readable name.
    e.g. 'Aleppo SA-3 2-1-1' → 'Aleppo SA-3 2'
         'EFTA07-4-1'         → 'EFTA07'
    """
    return re.sub(r'-\d+-\d+$', '', name)


def _group_outer_name(gb: str) -> str | None:
    """
    Extract the group's own ["name"] field, ignoring nested sub-blocks.

    In DCS Lua, a plane group block contains 'route' (with waypoint names) and
    'units' (with unit names and callsign names) BEFORE the group-level name.
    A flat search picks up the wrong name; this function strips those sub-blocks
    first to ensure we only search the group's outer fields.
    """
    stripped = gb
    for key in ('route', 'units'):
        m = re.search(rf'\["{key}"\]\s*=\s*\{{', stripped)
        if m:
            close = lua_block_end(stripped, m.end() - 1)
            stripped = stripped[:m.start()] + stripped[close + 1:]
    return lua_str(stripped, 'name')


def parse_groups(coalition_block: str, theatre: str) -> list[Group]:
    """
    Parse all ground groups from a coalition block.
    Each raw DCS entry is an independent physical group.
    The '-routeIdx-waypointIdx' suffix is stripped for display only.
    """
    groups: list[Group] = []
    country_block = lua_get_block(coalition_block, 'country')
    if not country_block:
        return groups

    for _ci, country in lua_iter_array(country_block):
        for category in ('vehicle', 'static', 'helicopter', 'ship'):
            cat_block = lua_get_block(country, category)
            if not cat_block:
                continue
            grp_container = lua_get_block(cat_block, 'group')
            if not grp_container:
                continue
            for _gi, gb in lua_iter_array(grp_container):
                raw_name = lua_str(gb, 'name')
                if not raw_name:
                    continue
                name = _strip_dcs_suffix(raw_name)
                xy   = lua_xy(gb)
                if not xy:
                    continue
                lat, lon    = dcs_to_latlon(xy[0], xy[1], theatre)
                units_block = lua_get_block(gb, 'units')
                units       = parse_units(units_block, theatre) if units_block else []
                groups.append(Group(name=name, x=xy[0], y=xy[1],
                                    lat=lat, lon=lon, units=units))
    return groups


def parse_drawings(mission_text: str) -> list[Drawing]:
    drawings_block = lua_get_block(mission_text, 'drawings')
    if not drawings_block:
        return []
    layers_block = lua_get_block(drawings_block, 'layers')
    if not layers_block:
        return []

    # Find the layer named "Common"
    common_block = None
    for _li, layer in lua_iter_array(layers_block):
        if lua_str(layer, 'name') == 'Common':
            common_block = layer
            break
    if not common_block:
        return []

    objects_block = lua_get_block(common_block, 'objects')
    if not objects_block:
        return []

    result: list[Drawing] = []
    for _oi, ob in lua_iter_array(objects_block):
        if lua_str(ob, 'primitiveType') != 'Polygon':
            continue
        name = lua_str(ob, 'name')
        if not name:
            continue

        pmode    = lua_str(ob, 'polygonMode') or 'free'
        origin_x = lua_num(ob, 'mapX') or 0.0
        origin_y = lua_num(ob, 'mapY') or 0.0

        if pmode == 'circle':
            result.append(Drawing(
                name=name, polygon_mode='circle',
                origin_x=origin_x, origin_y=origin_y,
                radius_m=lua_num(ob, 'radius'),
            ))

        elif pmode == 'rect':
            result.append(Drawing(
                name=name, polygon_mode='rect',
                origin_x=origin_x, origin_y=origin_y,
                width_m=lua_num(ob, 'width'),
                height_m=lua_num(ob, 'height'),
                angle_deg=lua_num(ob, 'angle') or 0.0,
            ))

        elif pmode == 'free':
            pts_block = lua_get_block(ob, 'points')
            rel_points: list[tuple[float, float]] = []
            if pts_block:
                # Collect all points sorted by Lua index.
                # In DCS, (0,0) means the mapX/mapY origin IS a real vertex —
                # it is NOT padding.  Multiple (0,0) entries are duplicates
                # of the same origin vertex; keep only one.
                # The last point is a polygon-close back to the first; drop it.
                raw: list[tuple[int, float, float]] = []
                for idx, pb in lua_iter_array(pts_block):
                    xy = lua_xy(pb)
                    if xy:
                        raw.append((idx, xy[0], xy[1]))
                raw.sort()

                seen: set[tuple[float, float]] = set()
                for _idx, rx, ry in raw:
                    pt = (round(rx, 1), round(ry, 1))
                    if pt not in seen:
                        seen.add(pt)
                        rel_points.append((rx, ry))

                # Drop trailing close-vertex if it duplicates the first
                if len(rel_points) >= 2:
                    first = (round(rel_points[0][0], 1), round(rel_points[0][1], 1))
                    last  = (round(rel_points[-1][0], 1), round(rel_points[-1][1], 1))
                    if first == last:
                        rel_points.pop()

            if len(rel_points) >= 3:
                result.append(Drawing(
                    name=name, polygon_mode='free',
                    origin_x=origin_x, origin_y=origin_y,
                    rel_points=rel_points,
                ))

    return result


def parse_bullseye(coalition_block: str, theatre: str) -> str | None:
    be = lua_get_block(coalition_block, 'bullseye')
    if not be:
        return None
    xy = lua_xy(be)
    if not xy:
        return None
    lat, lon = dcs_to_latlon(xy[0], xy[1], theatre)
    return dms(lat, lon)
