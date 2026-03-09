"""extract — top-level extract() function and CLI entry point."""

from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

import yaml

from .build_doc import build_doc
from .build_targets import build_acms, build_targets
from .dtc import load_dtc_files, parse_spins_md
from .lua import lua_get_block
from .parse import parse_bullseye, parse_drawings, parse_groups
from .parse_flights import parse_flights_and_carriers, parse_weather


def _parse_weather_txt(text: str) -> tuple[list[str], list[str]]:
    """
    Parse a weather.txt file for additional METAR and TAF strings.

    Lines starting with 'METAR' or 'SPECI' are collected as METARs.
    Lines starting with 'TAF' are collected as TAFs (multi-line TAFs should
    be joined into a single line).
    Other non-empty lines are ignored.
    """
    metars: list[str] = []
    tafs: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        upper = stripped.upper()
        if upper.startswith('METAR ') or upper.startswith('SPECI '):
            metars.append(stripped)
        elif upper.startswith('TAF '):
            tafs.append(stripped)
    return metars, tafs


def extract(miz_path: str, coalition: str = "blue") -> dict:
    opposing = "red" if coalition == "blue" else "blue"

    with zipfile.ZipFile(miz_path) as z:
        mission_text = z.read("mission").decode("utf-8", errors="replace")
        theatre = z.read("theatre").decode().strip() \
                  if "theatre" in z.namelist() else "Syria"
        dtcs = load_dtc_files(z)

    if dtcs:
        print(f"[+] Found DTC files: {', '.join(sorted(dtcs))}")

    print(f"[+] Theatre={theatre}  coalition={coalition}  targets_from={opposing}")

    # Date — extract Year/Day/Month independently (field order varies by miz version)
    year, day, month = 2024, 1, 1
    dm = re.search(r'\["date"\].*?\{([^}]*)\}', mission_text, re.DOTALL)
    if dm:
        date_block = dm.group(1)
        year_m  = re.search(r'\["Year"\]\s*=\s*(\d+)',  date_block)
        day_m   = re.search(r'\["Day"\]\s*=\s*(\d+)',   date_block)
        month_m = re.search(r'\["Month"\]\s*=\s*(\d+)', date_block)
        if year_m:  year  = int(year_m.group(1))
        if day_m:   day   = int(day_m.group(1))
        if month_m: month = int(month_m.group(1))
    mission_date = f"{year}-{month:02d}-{day:02d}"

    # Top-level mission start_time (seconds from midnight local time, 0–86399)
    sm = re.search(r'^\t\["start_time"\]\s*=\s*(\d+)', mission_text, re.MULTILINE)
    ingame_start_local = None
    if sm:
        total_seconds = int(sm.group(1)) % 86400  # clamp to 0–86399
        hh = total_seconds // 3600
        mm = (total_seconds % 3600) // 60
        ingame_start_local = f"{hh:02d}{mm:02d}"
        print(f"[+] Mission start_time={sm.group(1)}s → {ingame_start_local}L")

    # Coalition blocks
    coal_block = lua_get_block(mission_text, 'coalition')
    if not coal_block:
        raise ValueError("No coalition block found")
    opp_block = lua_get_block(coal_block, opposing)
    own_block = lua_get_block(coal_block, coalition)

    # Targets
    print(f"[+] Parsing {opposing} groups…")
    opp_groups = parse_groups(opp_block or '', theatre)
    print(f"    {len(opp_groups)} groups")
    targets = build_targets(opp_groups)
    print(f"[+] {len(targets)} targets")

    # Bullseye
    ref_pts: dict = {}
    if own_block:
        be = parse_bullseye(own_block, theatre)
        if be:
            ref_pts["BULLSEYE"] = {"name": "BULLSEYE", "type": "bullseye", "coords": be}
            print(f"[+] Bullseye: {be}")

    # Flights + carriers (own coalition)
    print(f"[+] Parsing {coalition} flights and carriers…")
    flights, carriers = parse_flights_and_carriers(own_block or '', theatre)
    print(f"    {len(flights)} flights  |  {len(carriers)} carriers")
    for f in flights:
        dtc_label = f"  dtc={f.dtc_cartridge}" if f.dtc_cartridge else ""
        print(f"  {f.id}: {f.name!r}  task={f.task}  ac={f.aircraft_type}  "
              f"x{len(f.units)}  freq={f.freq_mhz}{dtc_label}")
    for c in carriers:
        print(f"  {c.id}: {c.type}  {c.name}  {c.deploy_coords}")

    # Summarise DTC comms coverage
    flights_with_dtc = [f for f in flights if f.dtc_cartridge and f.dtc_cartridge in dtcs]
    if flights_with_dtc:
        print(f"[+] DTC comms available for {len(flights_with_dtc)} flights: "
              + ", ".join(f"'{f.name}'→{f.dtc_cartridge}" for f in flights_with_dtc))
    elif dtcs:
        print(f"[!] No DTC cartridges matched to flights; available: {', '.join(sorted(dtcs))}")

    # ACO drawings
    print("[+] Parsing drawings…")
    drawings = parse_drawings(mission_text)
    acms = build_acms(drawings, theatre)
    print(f"[+] {len(acms)} ACMs")

    # Weather
    metar, wx_notes = parse_weather(mission_text, day)
    print(f"[+] {metar}")

    # Additional weather from weather.txt — look in same directory as .miz file
    extra_metars: list[str] = []
    extra_tafs: list[str] = []
    wx_txt_path = Path(miz_path).parent / 'weather.txt'
    if wx_txt_path.exists():
        wx_text = wx_txt_path.read_text(encoding='utf-8', errors='replace')
        _metars, _tafs = _parse_weather_txt(wx_text)
        extra_metars = _metars
        extra_tafs = _tafs
        print(f"[+] Loaded weather.txt: {len(extra_metars)} METARs, {len(extra_tafs)} TAFs")
    else:
        print(f"[i] No weather.txt found at '{wx_txt_path}' — using DCS weather only")

    # SPINS — look for spins.md in the same directory as the .miz file
    spins_sections = None
    spins_path = Path(miz_path).parent / 'spins.md'
    if spins_path.exists():
        spins_text = spins_path.read_text(encoding='utf-8', errors='replace')
        spins_sections = parse_spins_md(spins_text)
        print(f"[+] Loaded SPINS from '{spins_path.name}': {len(spins_sections or [])} sections")
    else:
        print(f"[i] No spins.md found at '{spins_path}' — spins will be empty")

    return build_doc(
        mission_name=Path(miz_path).stem,
        mission_date=mission_date,
        theatre=theatre,
        year=year, month=month,
        targets=targets,
        ref_pts=ref_pts,
        acms=acms,
        metar=metar,
        wx_notes=wx_notes,
        flights=flights,
        carriers=carriers,
        dtcs=dtcs,
        spins_sections=spins_sections,
        ingame_start_local=ingame_start_local,
        extra_metars=extra_metars,
        extra_tafs=extra_tafs,
    )


def main():
    import logging
    ap = argparse.ArgumentParser(description="DCS .miz → ATO brief YAML")
    ap.add_argument("miz")
    ap.add_argument("--coalition", "-c", default="blue", choices=["blue", "red"])
    ap.add_argument("--output",    "-o", default=None)
    ap.add_argument("--verbose",   "-v", action="store_true",
                    help="Enable debug logging for waypoint extraction and merging")
    args = ap.parse_args()

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=log_level,
                        format="[%(levelname)s] %(name)s: %(message)s")

    out = args.output or (Path(args.miz).stem + ".yaml")
    doc = extract(args.miz, args.coalition)

    with open(out, "w", encoding="utf-8") as f:
        yaml.dump(doc, f, allow_unicode=True, sort_keys=False,
                  default_flow_style=False, width=120)
    print(f"\n[OK] {out}")
