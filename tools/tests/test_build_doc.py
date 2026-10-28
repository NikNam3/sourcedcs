"""Tests for miztoyaml.build_doc — final YAML document assembly."""

import pytest

from tools.miztoyaml.build_doc import (
    build_callsigns_registry,
    build_carriers_registry,
    build_control_agencies,
    build_doc,
    build_flight_comms,
    build_frequencies_registry,
    build_spins_sections,
    build_tankers_list,
)
from tools.miztoyaml.models import Carrier, Flight, FlightUnit, Waypoint


def _make_flight(name, task="CAP", ac_type="F-16C_50", freq=251.0,
                 is_tanker=False, is_awacs=False, waypoints=None, units=None,
                 dtc_cartridge=None):
    fu = FlightUnit(type=ac_type, callsign=name,
                    onboard_num="101", skill="Client", loadout=[],
                    dtc_cartridge=dtc_cartridge)
    return Flight(id="FLT-1", name=name, task=task,
                  aircraft_type=ac_type, freq_mhz=freq,
                  units=units or [fu], waypoints=waypoints or [],
                  is_tanker=is_tanker, is_awacs=is_awacs,
                  dtc_cartridge=dtc_cartridge)


def _make_carrier(cid="CVN-1", ctype="CVN_75", name="TRUMAN", unit_id=42):
    return Carrier(id=cid, type=ctype, name=name, unit_id=unit_id,
                   deploy_coords="N36°00'00\" E037°00'00\"",
                   recovery_coords="N36°10'00\" E037°10'00\"")


class TestBuildCarriersRegistry:
    def test_basic(self):
        c = _make_carrier()
        result = build_carriers_registry([c])
        assert "CVN-1" in result
        assert result["CVN-1"]["name"] == "USS HARRY S. TRUMAN"

    def test_empty(self):
        assert build_carriers_registry([]) == {}


class TestBuildCallsignsRegistry:
    def test_basic(self):
        f = _make_flight("VIPER-1")
        result = build_callsigns_registry([f])
        assert result is not None
        assert "VIPER1" in result   # H60 ATO callsign

    def test_awacs_excluded(self):
        f = _make_flight("MAGIC-1", is_awacs=True)
        result = build_callsigns_registry([f])
        assert result is None

    def test_empty(self):
        assert build_callsigns_registry([]) is None


class TestBuildTankersList:
    def _make_tanker_flight(self, name="SHELL-1"):
        orbit_wp = Waypoint(name="ORBIT", x=0, y=0, lat=36.0, lon=37.0,
                            typ="Turning Point", airdrome_id=None,
                            link_unit_id=None, is_orbit=True,
                            orbit_alt_ft=20000, orbit_speed_kts=300,
                            orbit_leg_nm=15.0, orbit_heading_deg=90,
                            orbit_cw=False)
        return _make_flight(name, task="TANKER", is_tanker=True,
                            waypoints=[orbit_wp])

    def test_basic(self):
        f = self._make_tanker_flight()
        result = build_tankers_list([f])
        assert result is not None
        assert len(result) == 1
        assert result[0]["callsign"] == "SHELL1"
        assert result[0]["orbit_direction"] == "ccw"

    def test_no_tankers(self):
        f = _make_flight("VIPER-1")
        assert build_tankers_list([f]) is None

    def test_clockwise(self):
        wp = Waypoint(name="ORBIT", x=0, y=0, lat=36.0, lon=37.0,
                      typ="Turning Point", airdrome_id=None,
                      link_unit_id=None, is_orbit=True, orbit_cw=True)
        f = _make_flight("SHELL-2", task="TANKER", is_tanker=True,
                         waypoints=[wp])
        result = build_tankers_list([f])
        assert result[0]["orbit_direction"] == "cw"


class TestBuildControlAgencies:
    def test_basic(self):
        f = _make_flight("MAGIC-1", task="AWACS", ac_type="E-3A",
                         is_awacs=True, freq=260.0)
        result = build_control_agencies([f])
        assert result is not None
        assert "MAGIC1" in result
        assert result["MAGIC1"]["type"] == "AWACS"

    def test_no_awacs(self):
        f = _make_flight("VIPER-1")
        assert build_control_agencies([f]) is None


class TestBuildFlightComms:
    def test_with_dtc(self):
        f = _make_flight("VIPER-1", dtc_cartridge="MyDTC")
        dtcs = {"MyDTC": {"COMM1": {1: 300.0, 2: 130.0}}}
        result = build_flight_comms([f], dtcs)
        assert result is not None
        assert result[0]["dtc_cartridge"] == "MyDTC"

    def test_missing_dtc(self):
        f = _make_flight("VIPER-1", dtc_cartridge="Missing")
        result = build_flight_comms([f], {})
        assert result is None

    def test_with_radio_presets(self):
        fu = FlightUnit(type="F-16C_50", callsign="VIPER11",
                        onboard_num="101", skill="Client", loadout=[],
                        radio_channels={1: {1: 300.0, 2: 130.0}})
        f = _make_flight("VIPER-1", units=[fu])
        result = build_flight_comms([f], {})
        assert result is not None
        assert result[0]["uhf_presets"] is not None


class TestBuildFrequenciesRegistry:
    def test_basic(self):
        comms = [{"uhf_presets": {1: 300.0}, "vhf_presets": {1: 130.0}}]
        result = build_frequencies_registry(comms)
        assert result is not None
        assert len(result) == 2

    def test_dedup(self):
        comms = [
            {"uhf_presets": {1: 300.0}, "vhf_presets": None},
            {"uhf_presets": {1: 300.0}, "vhf_presets": None},
        ]
        result = build_frequencies_registry(comms)
        assert len(result) == 1

    def test_empty(self):
        assert build_frequencies_registry([]) is None


class TestBuildDoc:
    def test_basic(self):
        f = _make_flight("VIPER-1")
        doc = build_doc(
            mission_name="TestMission",
            mission_date="2024-06-15",
            theatre="Syria",
            year=2024, month=6,
            targets={},
            ref_pts={},
            acms=[],
            metar="METAR XXXX 150000Z 00000KT 9999 SKC 20/00 Q1013 NOSIG",
            wx_notes="Clear.",
            flights=[f],
            carriers=[],
        )
        assert doc["schema_version"] == "1.0"
        assert doc["header"]["ato_date"] == "2024-06-15"
        assert doc["ato"] is not None
        assert doc["weather"]["metars"] is not None

    def test_syria_offset(self):
        doc = build_doc(
            mission_name="Test",
            mission_date="2024-06-15",
            theatre="Syria",
            year=2024, month=6,
            targets={}, ref_pts={}, acms=[],
            metar="METAR", wx_notes="",
            flights=[], carriers=[],
            ingame_start_local="0900",
        )
        assert doc["ato"]["local_offset_hours"] == 3
        assert doc["ato"]["ingame_start_time"] == "0600"

    def test_unknown_theatre_warns(self, caplog):
        import logging
        with caplog.at_level(logging.WARNING, logger="miztoyaml"):
            doc = build_doc(
                mission_name="Test",
                mission_date="2024-01-01",
                theatre="UnknownMap",
                year=2024, month=1,
                targets={}, ref_pts={}, acms=[],
                metar="METAR", wx_notes="",
                flights=[], carriers=[],
            )
        assert doc["ato"]["local_offset_hours"] is None

    def test_meta_counts(self):
        f1 = _make_flight("VIPER-1", task="CAP")
        f2 = _make_flight("SHELL-1", task="TANKER", is_tanker=True)
        doc = build_doc(
            mission_name="Test",
            mission_date="2024-01-01",
            theatre="Syria",
            year=2024, month=1,
            targets={}, ref_pts={}, acms=[],
            metar="METAR", wx_notes="",
            flights=[f1, f2], carriers=[],
        )
        assert doc["_meta"]["missions"] == 2   # the tanker is a mission (ADR 0089)
        assert doc["_meta"]["tankers"] == 1
        tanker = doc["registry"]["tankers"][0]
        tanker_msn = doc["ato"]["missions"][1]
        assert tanker_msn["mission_type"] == "REFUELING"
        assert tanker["mission_number"] == tanker_msn["mission_number"]


class TestBuildSpinsSections:
    def test_auto_generates_standard_sections(self):
        missions = [
            {"mission_number": "MSN8023", "callsign": "VIPER", "mission_type": "DEAD"},
            {"mission_number": "MSN8024", "callsign": "BOLO",  "mission_type": "ESCORT"},
        ]
        sections = build_spins_sections(missions, {})
        titles = [s["title"] for s in sections]
        assert "C1 — COMMAND & CONTROL" in titles
        assert "C3 — IFF / SIF" in titles
        assert "C4 — RULES OF ENGAGEMENT" in titles
        assert "C5 — EXECUTION" in titles
        assert "C7 — LOST COMMS" in titles
        assert "C8 — ABORT CRITERIA" in titles
        assert "C9 — SEARCH AND RESCUE" in titles
        assert "C10 — AUTHENTICATION" in titles
        assert "C11 — SAFETY" in titles

    def test_text_sections_use_markdown_not_entries(self):
        """All text sections store content as a markdown string, never an entries list."""
        sections = build_spins_sections([], {})
        for sec in sections:
            if sec["title"] == "C3 — IFF / SIF":
                continue  # C3 is table-only
            assert "markdown" in sec, f"{sec['title']} missing markdown field"
            assert "entries" not in sec, f"{sec['title']} still has entries field"

    def test_iff_squawk_codes_random(self):
        """IFF squawk codes are random, unique, valid octal, and avoid emergency codes."""
        missions = [
            {"mission_number": "MSN8023", "callsign": "V", "mission_type": "CAP"},
            {"mission_number": "MSN8024", "callsign": "B", "mission_type": "CAP"},
            {"mission_number": "MSN8025", "callsign": "S", "mission_type": "CAP"},
        ]
        sections = build_spins_sections(missions, {})
        c3 = next(s for s in sections if s["title"] == "C3 — IFF / SIF")
        rows = c3["table"]["rows"]
        assert len(rows) == 3
        codes = [row[2] for row in rows]
        # All unique
        assert len(set(codes)) == 3
        # All 4 digits, valid octal (no 8 or 9)
        for code in codes:
            assert len(code) == 4
            assert all(d in "01234567" for d in code), f"Non-octal digit in squawk {code}"
        # No emergency codes
        forbidden = {"7500", "7600", "7700"}
        assert not forbidden & set(codes)
        # Mission numbers still correct
        assert rows[0][0] == "8023"
        assert rows[1][0] == "8024"
        assert rows[2][0] == "8025"
        # Mode column is always "3"
        assert all(row[1] == "3" for row in rows)

    def test_tactical_control_from_agencies(self):
        agencies = {
            "DARKSTAR": {"type": "AWACS", "callsign": "DARKSTAR", "primary_freq_mhz": "305.0"},
        }
        sections = build_spins_sections([], agencies)
        c1 = next(s for s in sections if s["title"] == "C1 — COMMAND & CONTROL")
        md = c1["markdown"]
        assert "**PRIMARY AWACS**: DARKSTAR / 305.0 MHz" in md
        assert "## C1.1" in md
        assert "## C1.3" in md
        assert "**PACKAGE LEAD**:" in md

    def test_execution_has_objective_and_desired_effects(self):
        missions = [{"mission_number": "MSN8023", "callsign": "VIPER", "mission_type": "DEAD"}]
        sections = build_spins_sections(missions, {})
        c5 = next(s for s in sections if s["title"] == "C5 — EXECUTION")
        md = c5["markdown"]
        assert "OBJECTIVE" in md
        assert "DESIRED EFFECTS" in md
        assert "VIPER" in md

    def test_no_missions_no_iff_table(self):
        sections = build_spins_sections([], {})
        c3 = next(s for s in sections if s["title"] == "C3 — IFF / SIF")
        assert "table" not in c3

    def test_iff_missing_mission_number_uses_empty_string(self):
        """Missions without mission_number produce an empty MSN cell, not an error."""
        missions = [
            {"callsign": "VIPER", "mission_type": "CAP"},          # no mission_number key
            {"mission_number": "",  "callsign": "BOLO", "mission_type": "ESCORT"},  # empty
            {"mission_number": "MSN8025", "callsign": "SHADOW", "mission_type": "DEAD"},
        ]
        sections = build_spins_sections(missions, {})
        c3 = next(s for s in sections if s["title"] == "C3 — IFF / SIF")
        rows = c3["table"]["rows"]
        assert len(rows) == 3
        assert rows[0][0] == ""    # missing key → empty string
        assert rows[1][0] == ""    # explicit empty → empty string
        assert rows[2][0] == "8025"
        # Squawk codes are unique, valid, not emergency
        codes = [row[2] for row in rows]
        assert len(set(codes)) == 3

    def test_spins_sections_empty_by_default_in_build_doc(self):
        """build_doc produces empty spins sections by default.
        Sections are generated on the website via the 'Generate from presets' button."""
        doc = build_doc(
            mission_name="Test",
            mission_date="2024-01-01",
            theatre="Syria",
            year=2024, month=1,
            targets={}, ref_pts={}, acms=[],
            metar="METAR", wx_notes="",
            flights=[], carriers=[],
        )
        assert doc["spins"]["sections"] == []
