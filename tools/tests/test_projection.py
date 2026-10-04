"""Tests for miztoyaml.projection — DCS coordinate projection."""

import pytest

from tools.miztoyaml.projection import dcs_to_latlon, dms


class TestDcsToLatlon:
    """dcs_to_latlon() should convert DCS (x=north, y=east) to WGS84."""

    def test_syria_origin_approximate(self):
        # Aleppo region — lat ~36.x, lon ~37.x
        lat, lon = dcs_to_latlon(0, 0, "Syria")
        assert 30 < lat < 40
        assert 35 < lon < 45

    def test_persian_gulf(self):
        lat, lon = dcs_to_latlon(0, 0, "PersianGulf")
        assert 20 < lat < 30
        assert 50 < lon < 60

    def test_caucasus(self):
        lat, lon = dcs_to_latlon(0, 0, "Caucasus")
        assert 40 < lat < 50
        assert 30 < lon < 40

    def test_nevada(self):
        lat, lon = dcs_to_latlon(0, 0, "Nevada")
        assert 30 < lat < 45
        assert -120 < lon < -110

    def test_unknown_theatre_defaults_to_syria(self):
        lat1, lon1 = dcs_to_latlon(100, 200, "UnknownMap")
        lat2, lon2 = dcs_to_latlon(100, 200, "Syria")
        assert lat1 == pytest.approx(lat2)
        assert lon1 == pytest.approx(lon2)

    def test_movement_north_increases_lat(self):
        lat1, _ = dcs_to_latlon(0, 0, "Syria")
        lat2, _ = dcs_to_latlon(100000, 0, "Syria")
        assert lat2 > lat1

    def test_movement_east_increases_lon(self):
        _, lon1 = dcs_to_latlon(0, 0, "Syria")
        _, lon2 = dcs_to_latlon(0, 100000, "Syria")
        assert lon2 > lon1


class TestDms:
    """dms() should format (lat, lon) as DMS strings."""

    def test_positive_coords(self):
        result = dms(36.0, 37.0)
        assert "N36" in result
        assert "E37" in result

    def test_negative_lat(self):
        result = dms(-51.7, -59.0)
        assert "S" in result
        assert "W" in result

    def test_zero_seconds(self):
        result = dms(36.0, 37.0)
        # Should produce valid DMS string
        assert "\u00b0" in result  # degree symbol

    def test_roundtrip_format(self):
        result = dms(36.155833, 37.281944)
        assert "N" in result
        assert "E" in result
        # Basic format check: N??°??'??" E???°??'??"
        assert "'" in result
        assert '"' in result


class TestAddedTheaters:
    """TheChannel, Kola, GermanyCW (pydcs 55dc18a): the DCS map origin lands in the right region."""

    def test_the_channel_origin(self):
        lat, lon = dcs_to_latlon(0, 0, "TheChannel")
        assert lat == pytest.approx(50.8751, abs=1e-3)
        assert lon == pytest.approx(1.5875, abs=1e-3)

    def test_kola_origin(self):
        lat, lon = dcs_to_latlon(0, 0, "Kola")
        assert lat == pytest.approx(68.0, abs=1e-3)
        assert lon == pytest.approx(22.5, abs=1e-3)

    def test_germany_cw_centre(self):
        lat, lon = dcs_to_latlon(-450000, -450000, "GermanyCW")
        assert lat == pytest.approx(50.4551, abs=1e-3)
        assert lon == pytest.approx(14.1588, abs=1e-3)
