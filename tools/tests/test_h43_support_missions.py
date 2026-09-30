"""H43 fields from a .miz (ADR 0089): tankers and AWACS as missions, TACAN and
datalink, H60 callsigns — and the output round-tripped through atobrief's
USMTF mapper (atobrief/public/js/usmtf-ato.js)."""

import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
import yaml

from tools.miztoyaml.build_doc import _random_squawk
from tools.miztoyaml.build_missions import ato_callsign
from tools.miztoyaml.extract import extract
from tools.miztoyaml.parse_flights import _parse_datalink, _parse_tacan

REPO = Path(__file__).resolve().parents[2]
ATOBRIEF = REPO / "atobrief"


# ── Fixture .miz: a fighter, a KC-135 with a TACAN beacon, and an E-3 ────────

_FIGHTER = '''
[1] = {
    ["route"] = {
        ["points"] = {
            [1] = { ["x"] = 0, ["y"] = 0, ["type"] = "TakeOffParking",
                    ["airdromeId"] = 16, ["alt"] = 0 },
            [2] = { ["x"] = 100000, ["y"] = 100000, ["type"] = "Turning Point",
                    ["alt"] = 7000, ["name"] = "WP1" },
        },
    },
    ["units"] = {
        [1] = {
            ["type"] = "F-16C_50", ["skill"] = "Client", ["onboard_num"] = "101",
            ["AddPropAircraft"] = {
                ["STN_L16"] = "07103",
                ["VoiceCallsignNumber"] = "11",
                ["VoiceCallsignLabel"] = "EN",
            },
            ["callsign"] = { [1] = 1, [2] = 1, ["name"] = "Enfield11", [3] = 1 },
            ["payload"] = { ["pylons"] = { } },
        },
    },
    ["name"] = "ENFIELD11",
    ["task"] = "CAP",
    ["frequency"] = 305,
},
'''

_TANKER = '''
[2] = {
    ["route"] = {
        ["points"] = {
            [1] = { ["x"] = 0, ["y"] = 0, ["type"] = "TakeOffParking",
                    ["airdromeId"] = 16, ["alt"] = 0,
                    ["task"] = { ["id"] = "ComboTask", ["params"] = { ["tasks"] = {
                        [1] = { ["id"] = "WrappedAction", ["params"] = { ["action"] = {
                            ["id"] = "ActivateBeacon",
                            ["params"] = { ["type"] = 4, ["AA"] = false,
                                ["callsign"] = "TEX", ["modeChannel"] = "Y",
                                ["channel"] = 39, ["system"] = 5,
                                ["frequency"] = 1088000000 },
                        } } },
                    } } } },
            [2] = { ["x"] = 150000, ["y"] = 120000, ["type"] = "Turning Point",
                    ["alt"] = 7000, ["name"] = "ANCHOR BLUE",
                    ["task"] = { ["id"] = "ComboTask", ["params"] = { ["tasks"] = {
                        [1] = { ["id"] = "Orbit", ["params"] = {
                            ["altitude"] = 7315.2, ["speed"] = 164.6,
                            ["pattern"] = "Race-Track" } },
                    } } } },
        },
    },
    ["units"] = {
        [1] = {
            ["type"] = "KC-135", ["skill"] = "High", ["onboard_num"] = "010",
            ["AddPropAircraft"] = {
                ["STN_L16"] = "05244",
                ["VoiceCallsignNumber"] = "11",
                ["VoiceCallsignLabel"] = "TX",
            },
            ["callsign"] = { ["name"] = "Texaco11" },
            ["payload"] = { ["pylons"] = { } },
        },
    },
    ["name"] = "TEXACO11",
    ["task"] = "Refueling",
    ["frequency"] = 253,
},
'''

_AWACS = '''
[3] = {
    ["route"] = {
        ["points"] = {
            [1] = { ["x"] = 0, ["y"] = 0, ["type"] = "TakeOffParking",
                    ["airdromeId"] = 16, ["alt"] = 0 },
            [2] = { ["x"] = 160000, ["y"] = 60000, ["type"] = "Turning Point",
                    ["alt"] = 9000 },
        },
    },
    ["units"] = {
        [1] = {
            ["type"] = "E-3A", ["skill"] = "High", ["onboard_num"] = "020",
            ["AddPropAircraft"] = { ["VoiceCallsignLabel"] = "MC",
                                    ["VoiceCallsignNumber"] = "11" },
            ["callsign"] = { ["name"] = "Magic11" },
            ["payload"] = { ["pylons"] = { } },
        },
    },
    ["name"] = "MAGIC",
    ["task"] = "AWACS",
    ["frequency"] = 251,
},
'''

_MISSION = '''
    ["date"] = { ["Year"] = 2026, ["Day"] = 4, ["Month"] = 7 },
\t["start_time"] = 32400,
    ["coalition"] = {
        ["blue"] = {
            ["country"] = { [1] = { ["plane"] = { ["group"] = {
''' + _FIGHTER + _TANKER + _AWACS + '''
            } } } },
            ["bullseye"] = { ["x"] = 50000, ["y"] = 50000 },
        },
        ["red"] = { ["country"] = { } },
    },
'''


@pytest.fixture
def doc(tmp_path):
    miz = tmp_path / "h43_fixture.miz"
    with zipfile.ZipFile(miz, "w") as z:
        z.writestr("mission", _MISSION)
        z.writestr("theatre", "Syria")
    return extract(str(miz))


def _dumped(doc) -> str:
    """What the CLI writes (extract.main)."""
    return yaml.dump(doc, allow_unicode=True, sort_keys=False,
                     default_flow_style=False, width=120)


def _by_type(doc, mission_type):
    return [m for m in doc["ato"]["missions"] if m["mission_type"] == mission_type]


# ── H60 callsign ─────────────────────────────────────────────────────────────

class TestAtoCallsign:
    @pytest.mark.parametrize("name,expected", [
        ("ENFIELD11", "ENFLD11"),      # H60's own examples
        ("SHADOW11",  "SHADW11"),
        ("VIPER-1",   "VIPER1"),       # separators dropped, fits already
        ("Mauler 6",  "MAULER6"),
        ("MAGIC",     "MAGIC"),
        ("TEXACO11",  "TEXAC11"),
        ("ARCO11",    "ARCO11"),
        ("STRAWBERRY11", "STRWB11"),   # no vowel left to cut: letters cut, digits kept
        ("ABCDEFGHIJKLMNOP", "ABCDFGH"),
    ])
    def test_rule(self, name, expected):
        assert ato_callsign(name) == expected

    def test_first_character_kept(self):
        assert ato_callsign("EAGLEEYE11").startswith("E")

    def test_empty(self):
        assert ato_callsign("") is None
        assert ato_callsign(None) is None
        assert ato_callsign("--") is None


# ── Parsing ──────────────────────────────────────────────────────────────────

class TestParse:
    def test_datalink(self):
        unit = '["AddPropAircraft"] = { ["STN_L16"] = "07077", ' \
               '["VoiceCallsignNumber"] = "11", ["VoiceCallsignLabel"] = "ed" }'
        assert _parse_datalink(unit) == ("07077", "ED11")

    def test_datalink_absent_or_malformed(self):
        assert _parse_datalink('["type"] = "F-16C_50"') == (None, None)
        assert _parse_datalink('["AddPropAircraft"] = { ["STN_L16"] = "0708" }') == (None, None)

    def test_tacan(self):
        assert _parse_tacan(_TANKER) == "39Y"

    def test_tacan_ignores_non_tacan_beacons(self):
        gb = '["id"] = "ActivateBeacon", ["params"] = { ["type"] = 3, ' \
             '["modeChannel"] = "X", ["channel"] = 12 }'
        assert _parse_tacan(gb) is None

    def test_no_tacan(self):
        assert _parse_tacan(_FIGHTER) is None


# ── The document ─────────────────────────────────────────────────────────────

class TestSupportMissions:
    def test_one_mission_per_flight(self, doc):
        types = [m["mission_type"] for m in doc["ato"]["missions"]]
        assert types == ["CAP", "REFUELING", "AEW"]
        assert doc["_meta"]["missions"] == 3

    def test_callsigns_follow_h60(self, doc):
        assert [m["callsign"] for m in doc["ato"]["missions"]] == ["ENFLD11", "TEXAC11", "MAGIC"]

    def test_tanker_registry_links_its_mission(self, doc):
        (tanker,) = doc["registry"]["tankers"]
        (msn,) = _by_type(doc, "REFUELING")
        assert tanker["callsign"] == msn["callsign"] == "TEXAC11"
        assert tanker["mission_number"] == msn["mission_number"]
        assert tanker["tacan"] == "39Y"
        assert tanker["system"] == "BOOM"
        assert tanker["arcp"] == "ANCHOR BLUE"
        assert tanker["freq_mhz"] == 253.0          # the group's, not the beacon's Hz
        assert "offload_klb" not in tanker          # not in the .miz

    def test_agency_links_its_mission(self, doc):
        ag = doc["registry"]["control_agencies"]["MAGIC"]
        (msn,) = _by_type(doc, "AEW")
        assert ag["mission_number"] == msn["mission_number"]

    def test_datalink(self, doc):
        cap, tkr, aew = doc["ato"]["missions"]
        assert cap["datalink"] == {"l16_callsign": "EN11", "ju": "07103"}
        assert tkr["datalink"] == {"l16_callsign": "TX11", "tacan": "39Y", "ju": "05244"}
        assert aew["datalink"] == {"l16_callsign": "MC11"}

    def test_never_iff_or_unsourced_h43_fields(self, doc):
        for m in doc["ato"]["missions"]:
            for key in ("iff", "package_id", "package_commander", "alert_status", "vul"):
                assert key not in m

    def test_codes_stay_strings_through_yaml(self, doc):
        back = yaml.safe_load(_dumped(doc))
        assert back["ato"]["missions"][0]["datalink"]["ju"] == "07103"
        assert back["ato"]["missions"][0]["datalink"]["l16_callsign"] == "EN11"

    def test_ato_date_from_miz(self, doc):
        assert doc["header"]["ato_date"] == "2026-07-04"


class TestSquawk:
    def test_never_6xxx_or_emergency(self):
        used: set[str] = set()
        for _ in range(2000):
            code = _random_squawk(used)
            assert re.fullmatch(r"[0-7]{4}", code)
            assert not code.startswith("6")
            assert code not in {"7500", "7600", "7700"}


# ── Round trip through atobrief's USMTF mapper ───────────────────────────────

_NODE_SCRIPT = r'''
const fs = require('fs');
const yaml = require(process.argv[1] + '/node_modules/js-yaml');
const U = require(process.argv[1] + '/public/js/usmtf-ato.js');
const pkg = yaml.load(fs.readFileSync(0, 'utf8'));
const r = U.buildUsmtf(pkg);
process.stdout.write(JSON.stringify({ errors: r.errors, text: r.text,
  warnings: r.warnings.map(w => w.code) }));
'''


@pytest.fixture
def usmtf(doc):
    node = shutil.which("node")
    if not node or not (ATOBRIEF / "node_modules" / "js-yaml").is_dir():
        pytest.skip("needs node and `npm ci` in atobrief/")
    out = subprocess.run([node, "-e", _NODE_SCRIPT, str(ATOBRIEF)],
                         input=_dumped(doc), capture_output=True, text=True,
                         check=True, timeout=60)
    return json.loads(out.stdout)


class TestUsmtfRoundTrip:
    def test_exports_without_errors(self, usmtf):
        assert usmtf["errors"] == []
        assert usmtf["text"].startswith("UNCLAS\n")

    def test_no_link_or_format_warnings(self, usmtf):
        bad = {"UNKNOWN_SUPPORT_MISSION", "UNKNOWN_TANKER", "UNKNOWN_AGENCY",
               "BAD_TACAN", "BAD_FREQUENCY", "DATALINK_NOT_STRING",
               "IFF_NOT_STRING", "IFF_MALFORMED", "CALLSIGN_NOT_SEEDABLE",
               "DUPLICATE_MISSION_NUMBER", "MISSING_MISSION_NUMBER",
               "MISSION_TYPE_MISSING", "NO_MISSIONS"}
        assert not bad & set(usmtf["warnings"])

    def test_support_missions_exported(self, usmtf):
        text = usmtf["text"]
        assert "/REFUELING/" in text
        assert "/AEW/" in text
        # REFTSK: the tanker's own mission, BOOM, its frequency and TACAN
        assert re.search(r"^REFTSK/BOM/-/-/PFREQ:253\.0/-/39Y//$", text, re.M)

    def test_msnacft_datalink_and_no_mode_1_2(self, usmtf):
        lines = [l for l in usmtf["text"].splitlines() if l.startswith("MSNACFT/")]
        assert "MSNACFT/1/ACTYP:F16C/ENFLD11/000/-/EN11/-/07103/-/-/-//" in lines
        assert "MSNACFT/1/ACTYP:KC135/TEXAC11/000/-/TX11/39Y/05244/-/-/-//" in lines
        assert "MSNACFT/1/ACTYP:E3A/MAGIC/000/-/MC11/-/-/-/-/-//" in lines
