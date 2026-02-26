"""weapons — CLSID lookup, loadout condensing, and ATO loadout encoding."""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path

# Load the comprehensive CLSID→name mapping from the data directory.
# Path: <repo_root>/data/weaponsdata.json (two levels up from tools/miztoyaml/)
_DATA_FILE = Path(__file__).parent.parent.parent / "data" / "weaponsdata.json"
try:
    with _DATA_FILE.open(encoding="utf-8") as _fh:
        _WEAPONSDATA: dict[str, str] = json.load(_fh)
except (OSError, json.JSONDecodeError) as _e:
    warnings.warn(f"weaponsdata.json could not be loaded ({_e}); CLSID resolution will be limited.", stacklevel=1)
    _WEAPONSDATA = {}


# DCS ship types that are fixed-wing carriers
CARRIER_TYPES: frozenset[str] = frozenset({
    "CVN_71", "CVN_72", "CVN_73", "CVN_74", "CVN_75",
    "CVN_76", "CVN_77", "LHA_Tarawa", "Kuznetsov",
})

# DCS group task → mission type label
TASK_LABELS: dict[str, str] = {
    "CAP":          "CAP",
    "CAS":          "CAS",
    "SEAD":         "SEAD",
    "Strike":       "STRIKE",
    "Antiship Strike": "ANTISHIP",
    "Intercept":    "INTERCEPT",
    "Escort":       "ESCORT",
    "Refueling":    "TANKER",
    "AFAC":         "FAC(A)",
    "Reconnaissance": "RECCE",
    "Transport":    "TRANSPORT",
    "Ground Attack":"STRIKE",
    "Nothing":      "FERRY",
    "AWACS":        "AWACS",
}


def resolve_clsid(clsid: str) -> str:
    """Return a human-readable weapon name for a DCS CLSID string."""
    if clsid in _WEAPONSDATA:
        return _WEAPONSDATA[clsid]
    # Strip braces for unknown CLSIDs so output stays readable
    return clsid.strip("{}")


# ── Loadout helpers ───────────────────────────────────────────────────────────

# Substrings (lower-case) that identify a pylon as a fuel tank, pod, or ECM —
# these stores are excluded from the loadout encoding.
_SKIP_KEYWORDS: tuple[str, ...] = (
    'fuel tank', 'fuel pod', 'refuel',
    'ecm pod', 'decm pod', 'jammer',
    'targeting pod', 'litening', 'atflir', 'lantirn',
    'harm targeting',
)


# Maximum plausible munition count from a single rack station (B-2 can carry 80+,
# but for common fighter/attack racks a practical upper bound is 30).
_MAX_RACK_MUNITIONS = 30


def _is_consumable(name: str) -> bool:
    """Return True if the weapon name describes a tank, pod, or ECM store."""
    nl = name.lower()
    return any(kw in nl for kw in _SKIP_KEYWORDS)


def _rack_count(name: str) -> int:
    """
    Extract the number of munitions carried from a rack/LAU description.
    Handles forms like 'LAU-88 with 3 x AGM-65D', '16 x GBU-38', '3 GBU-38'.
    """
    # "... with N x WEAPON" — most common rack format
    m = re.search(r'\bwith\s+(\d+)\s+x\b', name, re.IGNORECASE)
    if m:
        return int(m.group(1))
    # Leading "N x WEAPON"
    m = re.match(r'^(\d+)\s+x\b', name, re.IGNORECASE)
    if m:
        return int(m.group(1))
    # Short form: "3 GBU-38", "2 Mk-82" — leading digit followed by space
    m = re.match(r'^(\d+)\s+', name)
    if m:
        n = int(m.group(1))
        if 2 <= n <= _MAX_RACK_MUNITIONS:   # sanity: racks don't carry more than this
            return n
    return 1


def _canonical_weapon(name: str) -> str | None:
    """
    Map a full descriptive weapon name (from weaponsdata.json) to the short
    canonical name used in _WEAPON_CAT for loadout encoding.
    Returns None for unknown or non-encodable stores.
    """
    # AIM-120 AMRAAM — check C-7 first so it isn't consumed by the [A-Z] branch
    if re.search(r'\bAIM-120C-7\b', name, re.IGNORECASE):
        return 'AIM-120C-7'
    m = re.search(r'\bAIM-120([A-Z])\b', name, re.IGNORECASE)
    if m:
        return f'AIM-120{m.group(1).upper()}'
    if re.search(r'\bAIM-120\b|\bAMRAAM\b', name, re.IGNORECASE):
        return 'AIM-120C'

    # AIM-9 Sidewinder (exclude captive training rounds).
    # Falls back to 'AIM-9X' for unrecognised suffixes because _WEAPON_CAT treats
    # all modern IR Sidewinders as fox2 under the 'AIM-9X' key.
    if not re.search(r'\bCATM\b|\bCaptive\b', name, re.IGNORECASE):
        m = re.search(r'\bAIM-9(X-2|XX?|[MLJP]P?5?)\b', name, re.IGNORECASE)
        if m:
            s = m.group(1).upper()
            key = f'AIM-9{s}'
            return key if key in _WEAPON_CAT else 'AIM-9X'
        if re.search(r'\bAIM-9\b|\bSidewinder\b', name, re.IGNORECASE):
            return 'AIM-9X'

    # AIM-7 Sparrow
    m = re.search(r'\bAIM-7([A-Z])\b', name, re.IGNORECASE)
    if m:
        return f'AIM-7{m.group(1).upper()}'
    if re.search(r'\bAIM-7\b|\bSparrow\b', name, re.IGNORECASE):
        return 'AIM-7M'

    # AGM-88 HARM
    m = re.search(r'\bAGM-88([A-Z])\b', name, re.IGNORECASE)
    if m:
        s = m.group(1).upper()
        if s == 'C':
            return 'AGM-88C HARM'
        if s == 'B':
            return 'AGM-88B HARM'
        return 'AGM-88 HARM'
    if re.search(r'\bAGM-88\b|\bHARM\b', name, re.IGNORECASE):
        return 'AGM-88 HARM'

    # AGM-65 Maverick
    m = re.search(r'\bAGM-65([A-Z])\b', name, re.IGNORECASE)
    if m:
        return f'AGM-65{m.group(1).upper()}'
    if re.search(r'\bMaverick\b', name, re.IGNORECASE):
        return 'AGM-65D'

    # AGM-154 JSOW
    m = re.search(r'\bAGM-154([AC])\b', name, re.IGNORECASE)
    if m:
        return f'AGM-154{m.group(1).upper()} JSOW'
    if re.search(r'\bAGM-154\b|\bJSOW\b', name, re.IGNORECASE):
        return 'AGM-154A JSOW'

    # AGM-158 JASSM
    if re.search(r'\bAGM-158\b|\bJASSM\b', name, re.IGNORECASE):
        return 'AGM-158 JASSM'

    # GBU guided bombs
    m = re.search(r'\bGBU-(\d+)\b', name, re.IGNORECASE)
    if m:
        return f'GBU-{m.group(1)}'

    # Mk unguided bombs — all variants (Mk-82Y, Mk-82AIR, etc.) normalize to the
    # base type with a hyphen separator regardless of how the name is formatted.
    m = re.search(r'\bMk[-\s]?(82|83|84)', name, re.IGNORECASE)
    if m:
        return f'Mk-{m.group(1)}'

    # CBU cluster bombs
    m = re.search(r'\bCBU-(\d+)\b', name, re.IGNORECASE)
    if m:
        return f'CBU-{m.group(1)}'

    # BLU anti-runway bombs
    m = re.search(r'\bBLU-(\d+)\b', name, re.IGNORECASE)
    if m:
        return f'BLU-{m.group(1)}'

    return None  # unrecognized — excluded from encoding


def condense_loadout(weapons: list[str]) -> list[str]:
    """
    Convert a raw per-pylon weapon name list into a condensed 'N× NAME' list
    using canonical short names suitable for encode_loadout().

    Steps per pylon:
      1. Skip fuel tanks, pods, and ECM stores.
      2. Extract a multiplier from rack-style names (e.g. 'LAU-88 with 3 x …').
      3. Normalize the full descriptive name to a canonical short name.
      4. Accumulate counts by canonical name.
    """
    counts: dict[str, int] = {}
    for w in weapons:
        if _is_consumable(w):
            continue
        n = _rack_count(w)
        canon = _canonical_weapon(w)
        if canon is None:
            continue  # unrecognized store — not encodable
        counts[canon] = counts.get(canon, 0) + n
    result = []
    for name, n in counts.items():
        result.append(f"{n}× {name}" if n > 1 else name)
    return result


# Weapon category table for ATO loadout encoding
_WEAPON_CAT: dict[str, tuple[str, str | None]] = {
    # ── Air-to-Air ───────────────────────────────────────────────────────────
    "AIM-120C": ("fox3", None), "AIM-120C-7": ("fox3", None),
    "AIM-120B": ("fox3", None), "AIM-120D":   ("fox3", None),
    "AIM-120":  ("fox3", None),
    "AIM-7M":   ("fox1", None), "AIM-7F":     ("fox1", None),
    "AIM-9M":   ("fox2", None), "AIM-9X":     ("fox2", None),
    "AIM-9X-2": ("fox2", None), "AIM-9L":     ("fox2", None),
    # ── AGM SEAD ─────────────────────────────────────────────────────────────
    "AGM-88C HARM": ("agm", "88C"), "AGM-88B HARM": ("agm", "88B"),
    "AGM-88 HARM":  ("agm", "88"),
    # ── AGM Maverick ─────────────────────────────────────────────────────────
    "AGM-65D": ("agm", "65D"), "AGM-65E": ("agm", "65E"), "AGM-65F": ("agm", "65F"),
    "AGM-65G": ("agm", "65G"), "AGM-65H": ("agm", "65H"), "AGM-65K": ("agm", "65K"),
    "AGM-65L": ("agm", "65L"), "AGM-65R": ("agm", "65R"),
    # ── AGM Stand-off ────────────────────────────────────────────────────────
    "AGM-154A JSOW": ("agm", "154A"), "AGM-154C JSOW": ("agm", "154C"),
    "AGM-158 JASSM": ("agm", "158"),
    # ── GBU Paveway ──────────────────────────────────────────────────────────
    "GBU-10": ("agm", "10"), "GBU-12": ("agm", "12"),
    "GBU-16": ("agm", "16"), "GBU-24": ("agm", "24"),
    "GBU-27": ("agm", "27"), "GBU-28": ("agm", "28"),
    # ── GBU JDAM ─────────────────────────────────────────────────────────────
    "GBU-31": ("agm", "31"), "GBU-32": ("agm", "32"),
    "GBU-38": ("agm", "38"), "GBU-39": ("agm", "39"),
    "GBU-54": ("agm", "54"),
    # ── Unguided ─────────────────────────────────────────────────────────────
    "Mk-82": ("agm", "82"), "Mk-83": ("agm", "83"), "Mk-84": ("agm", "84"),
    # ── CBU ──────────────────────────────────────────────────────────────────
    "CBU-87": ("agm", "87"), "CBU-97": ("agm", "97"),
    "CBU-103": ("agm", "103"), "CBU-105": ("agm", "105"),
    # ── BLU Anti-Runway ──────────────────────────────────────────────────────
    "BLU-107": ("agm", "B107"),
}

# Tasks that have a gun
_GUN_TASKS = {"CAP", "CAS", "SEAD", "STRIKE", "ESCORT", "INTERCEPT", "FAC(A)"}


def encode_loadout(condensed: list[str], task: str) -> str:
    """Convert condensed weapon list to the compact AAA+NXccc[L] loadout code.

    The weapon code after 'X' is purely numeric for single-variant weapon families
    (e.g. '38' for GBU-38).  For families that have multiple variants sharing the
    same base number, a letter suffix disambiguates them (e.g. '65D' vs '65K' for
    AGM-65D vs AGM-65K, '88C' for AGM-88C HARM, '154A' for AGM-154A JSOW).
    """
    fox3 = fox1 = fox2 = 0
    agm_groups: dict[str, int] = {}

    for entry in condensed:
        m = re.match(r'^(\d+)[×x]\s+(.+)$', entry)
        count, name = (int(m.group(1)), m.group(2)) if m else (1, entry)
        info = _WEAPON_CAT.get(name)
        if not info:
            continue
        cat, code = info
        if   cat == "fox3": fox3 += count
        elif cat == "fox1": fox1 += count
        elif cat == "fox2": fox2 += count
        elif cat == "agm" and code:
            agm_groups[code] = agm_groups.get(code, 0) + count

    aa  = f"{min(fox3,9)}{min(fox1,9)}{min(fox2,9)}"
    gun = "+" if (task in _GUN_TASKS and (fox3 or fox2 or agm_groups)) else ""
    agm = "".join(f"{n}X{c}" for c, n in agm_groups.items())
    return aa + gun + agm
