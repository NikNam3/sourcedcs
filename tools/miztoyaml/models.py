"""models — typed dataclasses for parsed DCS mission objects."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Unit:
    type: str
    x: float
    y: float
    lat: float
    lon: float
    role: str | None
    alt_m: float | None = None    # terrain altitude in metres (from DCS ["alt"])


@dataclass
class Group:
    name: str
    x: float
    y: float
    lat: float
    lon: float
    units: list[Unit] = field(default_factory=list)


@dataclass
class FlightUnit:
    type: str           # DCS aircraft type e.g. "F-16C_50"
    callsign: str       # e.g. "Viper11"
    onboard_num: str    # e.g. "101"
    skill: str          # Client / Excellent / High / etc.
    loadout: list[str]  # condensed weapon list
    dtc_cartridge: str | None = None  # DTC cartridge name e.g. "Broomstick_F16"


@dataclass
class Waypoint:
    name: str | None    # DCS waypoint name (may be None)
    x: float            # DCS north
    y: float            # DCS east
    lat: float
    lon: float
    typ: str            # DCS type: TakeOffParking, Turning Point, etc.
    airdrome_id: int | None    # set for TakeOff waypoints from airfields
    link_unit_id: int | None   # set for TakeOff from carriers (unit id)
    is_orbit: bool             # waypoint has an Orbit task (tanker track)
    alt_ft: float | None = None             # waypoint cruising altitude in feet
    orbit_alt_ft: float | None = None       # orbit altitude in feet
    orbit_speed_kts: float | None = None    # orbit speed in knots
    orbit_width_nm: float | None = None     # orbit track width (diameter) in NM
    orbit_leg_nm: float | None = None       # orbit leg length in NM
    orbit_heading_deg: float | None = None  # hot leg heading in degrees
    orbit_cw: bool | None = None            # True = clockwise turns, False = CCW


@dataclass
class Flight:
    id: str             # auto-assigned e.g. "FLT-1"
    name: str           # group name e.g. "SHADOW-1"
    task: str           # human label e.g. "CAP"
    aircraft_type: str  # from first unit
    freq_mhz: float
    units: list[FlightUnit] = field(default_factory=list)
    waypoints: list[Waypoint] = field(default_factory=list)
    is_tanker: bool = False
    is_awacs: bool = False
    dtc_cartridge: str | None = None  # primary DTC cartridge used by this flight


@dataclass
class Carrier:
    id: str             # e.g. "CVN-1"
    type: str           # "CVN_75"
    name: str           # group name
    unit_id: int        # DCS unitId (used to match takeoff linkUnit)
    deploy_coords: str  # DMS at mission start
    recovery_coords: str  # DMS projected 4h ahead


@dataclass
class Drawing:
    name: str
    polygon_mode: str        # 'circle' | 'rect' | 'free'
    origin_x: float          # mapX — absolute DCS coord
    origin_y: float          # mapY — absolute DCS coord
    # circle
    radius_m: float | None = None
    # rect
    width_m: float | None = None
    height_m: float | None = None
    angle_deg: float | None = None
    # free polygon — relative (x, y) offsets from origin, zero-stripped
    rel_points: list[tuple[float, float]] = field(default_factory=list)
