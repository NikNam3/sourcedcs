"""build_targets — build aim-point, target, and ACM data from parsed objects."""

from __future__ import annotations

import math

from .models import Drawing, Group
from .projection import dcs_to_latlon, dms
from .sam import identify_system


def build_aim_points(group: Group, key: str) -> list[dict]:
    aim_pts: list[dict] = []
    seen: set[tuple[int, int]] = set()
    ln_n = rd_n = 1

    for u in group.units:
        if u.role not in ('launcher', 'radar'):
            continue
        pos = (round(u.x), round(u.y))
        if pos in seen:
            continue
        seen.add(pos)

        if u.role == 'launcher':
            aim_pts.append({"id": f"{key}-LN{ln_n}",
                            "name": f"Launcher {ln_n}",
                            "coords": dms(u.lat, u.lon)})
            ln_n += 1
        else:
            aim_pts.append({"id": f"{key}-RD{rd_n}",
                            "name": f"Radar {rd_n}",
                            "coords": dms(u.lat, u.lon)})
            rd_n += 1

    if not aim_pts:
        aim_pts.append({"id": f"{key}-1", "name": key,
                        "coords": dms(group.lat, group.lon)})
    return aim_pts


def build_targets(groups: list[Group]) -> dict:
    import re
    targets: dict = {}
    seq = 1

    for g in groups:
        # TGT-prefixed override
        m = re.match(r'TGT\s+(\S+)', g.name, re.IGNORECASE)
        if m:
            key = f"TGT-{seq}"; seq += 1
            targets[key] = {
                "name":       g.name,
                "type":       m.group(1).upper(),
                "coords":     dms(g.lat, g.lon),
                "aim_points": build_aim_points(g, key),
            }
            if g.alt_ft is not None:
                targets[key]["elevation"] = f"{g.alt_ft}ft"
            print(f"  TGT  {key}: {g.name}")
            continue

        sys = identify_system([u.type for u in g.units])
        if not sys:
            continue

        key = f"SAM-{seq}"; seq += 1
        aim_pts = build_aim_points(g, key)
        targets[key] = {
            "name":                f"{g.name} ({sys.name})",
            "type":                "SAM",
            "coords":              dms(g.lat, g.lon),
            "engagement_range_nm": sys.range_nm,
            "max_alt_ft":          sys.max_alt_ft,
            "aim_points":          aim_pts,
        }
        if g.alt_ft is not None:
            targets[key]["elevation"] = f"{g.alt_ft}ft"
        print(f"  {key}: {g.name} → {sys.name}  "
              f"[{len(aim_pts)} aim pts]  {dms(g.lat, g.lon)}")

    return targets


def _rect_boundary(cx: float, cy: float,
                   width_m: float, height_m: float,
                   angle_deg: float, theatre: str) -> list[str]:
    """
    Return 4 corner DMS strings for a DCS rect drawing.

    DCS rect axes:
      width  → local x-axis (east in unrotated map space)
      height → local y-axis (north in unrotated map space)
      angle  → CCW rotation in degrees

    DCS world axes:  x = north (metres),  y = east (metres)
    After rotation, local-x maps to DCS y (east), local-y maps to DCS x (north).
    """
    a = math.radians(-angle_deg)
    cos_a, sin_a = math.cos(a), math.sin(a)
    hw, hh = width_m / 2, height_m / 2

    # Corners in local (unrotated) space: (local_x, local_y)
    corners = [(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)]
    result = []
    for lx, ly in corners:
        rx = lx * cos_a - ly * sin_a   # rotated local-x → DCS east
        ry = lx * sin_a + ly * cos_a   # rotated local-y → DCS north
        lat, lon = dcs_to_latlon(cx + ry, cy + rx, theatre)
        result.append(dms(lat, lon))
    return result


def _handle_circle(d: Drawing, theatre: str) -> dict | None:
    """Handle circle polygon mode → ROZ ACM."""
    if d.radius_m is None:
        return None
    olat, olon = dcs_to_latlon(d.origin_x, d.origin_y, theatre)
    return {
        "type":     "ROZ",
        "geometry": {
            "center":    dms(olat, olon),
            "radius_nm": round(d.radius_m / 1852.0, 1),
        },
    }


def _handle_rect(d: Drawing, theatre: str) -> dict | None:
    """Handle rect polygon mode → ORBIT ACM."""
    if d.width_m is None or d.height_m is None:
        return None
    boundary = _rect_boundary(
        d.origin_x, d.origin_y,
        d.width_m, d.height_m,
        d.angle_deg or 0.0,
        theatre,
    )
    return {
        "type":     "ORBIT",
        "geometry": {"boundary": boundary},
    }


def _handle_free(d: Drawing, theatre: str) -> dict | None:
    """Handle free polygon mode → ROZ ACM."""
    boundary = []
    for rel_x, rel_y in d.rel_points:
        lat, lon = dcs_to_latlon(d.origin_x + rel_x,
                                 d.origin_y + rel_y, theatre)
        boundary.append(dms(lat, lon))
    return {
        "type":     "ROZ",
        "geometry": {"boundary": boundary},
    }


# Handler registry: polygon_mode → handler function.
# Add new airspace types by registering a handler here.
_AIRSPACE_HANDLERS: dict[str, callable] = {
    'circle': _handle_circle,
    'rect':   _handle_rect,
    'free':   _handle_free,
}


def build_acms(drawings: list[Drawing], theatre: str) -> list[dict]:
    acms: list[dict] = []
    n = 1

    for d in drawings:
        handler = _AIRSPACE_HANDLERS.get(d.polygon_mode)
        if not handler:
            continue
        result = handler(d, theatre)
        if result is None:
            continue

        acm: dict = {
            "id":        f"ACM-{n:03d}",
            "name":      d.name,
            "alt_lower": "SFC",
            "alt_upper": "FL999",
        }
        acm.update(result)
        acms.append(acm)
        print(f"  ACM-{n:03d}: {d.name}  ({d.polygon_mode})")
        n += 1

    return acms
