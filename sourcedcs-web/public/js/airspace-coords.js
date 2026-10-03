/* Coordinate helpers for the airspace admin page: decimal degrees and DMS
   input, and a read-only SVG outline. Pure functions; also loaded by node
   tests (module.exports guard at the bottom). */
(function (root) {
  'use strict';

  function round6(x) { return Math.round(x * 1e6) / 1e6; }

  /* One component such as 36.5, -36.5, N36 30, 36 30 00 N, N36°12'30.5", 036:45:00E.
     Returns { value (signed degrees), hemi ('N'|'S'|'E'|'W'|null) } or null. */
  function parseComponent(str) {
    var s = String(str == null ? '' : str).toUpperCase().trim();
    if (!s) return null;
    var letters = s.match(/[NSEW]/g) || [];
    if (letters.length > 1) return null;
    var hemi = letters[0] || null;
    var nums = s.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length > 3) return null;
    if (/[^\d.\s°'′"″:+\-NSEW]/.test(s)) return null;
    var deg = parseFloat(nums[0]);
    var neg = nums[0].charAt(0) === '-';
    var min = nums.length > 1 ? parseFloat(nums[1]) : 0;
    var sec = nums.length > 2 ? parseFloat(nums[2]) : 0;
    if (nums.length > 1 && (min < 0 || min >= 60)) return null;
    if (nums.length > 2 && (sec < 0 || sec >= 60)) return null;
    var abs = Math.abs(deg) + min / 60 + sec / 3600;
    var value = neg ? -abs : abs;
    if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
    return { value: round6(value), hemi: hemi };
  }

  /* One cell of the coordinate table; axis is 'lat' or 'lon' */
  function parseCoord(str, axis) {
    var c = parseComponent(str);
    if (!c) return null;
    if (c.hemi && ((axis === 'lat') !== (c.hemi === 'N' || c.hemi === 'S'))) return null;
    var max = axis === 'lat' ? 90 : 180;
    return Math.abs(c.value) <= max ? c.value : null;
  }


  /* MGRS (H102 AP2B-Q2): "36S XC 12345 12345", spaces optional, 1-5 digits per axis; the centre of the cell. A hand copy of
     crc-desktop's coords.js fromMgrs (UTM by the Krueger series, zones 1-60, bands C-X, no polar UPS). */
  var MG_BANDS = 'CDEFGHJKLMNPQRSTUVWX', MG_COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'], MG_ROWS = 'ABCDEFGHJKLMNPQRSTUV';
  var MG_K0 = 0.9996, MG_A = 6378137, MG_F = 1 / 298.257223563, MG_N = MG_F / (2 - MG_F), MG_E2 = MG_F * (2 - MG_F);
  var MG_AA = (MG_A / (1 + MG_N)) * (1 + MG_N * MG_N / 4 + Math.pow(MG_N, 4) / 64);
  var MG_ALPHA = [MG_N / 2 - (2 / 3) * MG_N * MG_N + (5 / 16) * Math.pow(MG_N, 3), (13 / 48) * MG_N * MG_N - (3 / 5) * Math.pow(MG_N, 3), (61 / 240) * Math.pow(MG_N, 3)];
  var MG_BETA = [MG_N / 2 - (2 / 3) * MG_N * MG_N + (37 / 96) * Math.pow(MG_N, 3), MG_N * MG_N / 48 + Math.pow(MG_N, 3) / 15, (17 / 480) * Math.pow(MG_N, 3)];
  var RAD = Math.PI / 180;
  function mgBand(lat) { return MG_BANDS.charAt(Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))); }
  function mgToUtmNorthing(lat, lon, zone) {
    var lon0 = ((zone - 1) * 6 - 180 + 3) * RAD, phi = lat * RAD, dl = lon * RAD - lon0, e = Math.sqrt(MG_E2);
    var t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
    var xi = Math.atan2(t, Math.cos(dl)), y = xi;
    for (var j = 1; j <= 3; j++) y += MG_ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t)));
    return MG_K0 * MG_AA * y + (lat < 0 ? 1e7 : 0);
  }
  function mgFromUtm(zone, south, easting, northing) {
    var x = (easting - 500000) / (MG_K0 * MG_AA), y = (northing - (south ? 1e7 : 0)) / (MG_K0 * MG_AA), xi = y, eta = x, e = Math.sqrt(MG_E2);
    for (var j = 1; j <= 3; j++) {
      xi -= MG_BETA[j - 1] * Math.sin(2 * j * y) * Math.cosh(2 * j * x);
      eta -= MG_BETA[j - 1] * Math.cos(2 * j * y) * Math.sinh(2 * j * x);
    }
    var chi = Math.asin(Math.sin(xi) / Math.cosh(eta)), phi = chi;
    for (var i = 0; i < 8; i++) phi = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + e * Math.atanh(e * Math.sin(phi))));
    return [phi / RAD, ((zone - 1) * 6 - 180 + 3) + Math.atan2(Math.sinh(eta), Math.cos(xi)) / RAD];
  }
  function parseMgrs(text) {
    var m = String(text || '').toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
    if (!m) return null;
    var zone = Number(m[1]);
    if (zone < 1 || zone > 60 || m[5].length % 2 || m[5].length > 10) return null;
    var col = MG_COLS[(zone - 1) % 3].indexOf(m[3]);
    if (col < 0) return null;
    var prec = m[5].length / 2, cell = Math.pow(10, 5 - prec);
    var easting = (col + 1) * 100000 + (prec ? Number(m[5].slice(0, prec)) * cell : 0) + cell / 2;
    var north = MG_BANDS.indexOf(m[2]) >= MG_BANDS.indexOf('N');
    var rowIdx = (MG_ROWS.indexOf(m[4]) - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
    var northing = rowIdx * 100000 + (prec ? Number(m[5].slice(prec)) * cell : 0) + cell / 2;
    var minLat = Math.max(-80 + 8 * MG_BANDS.indexOf(m[2]), -80);
    var floor = mgToUtmNorthing(minLat, (zone - 1) * 6 - 180 + 3, zone) - 100000;
    while (northing < floor) northing += 2000000;
    var out = mgFromUtm(zone, !north, easting, northing);
    if (mgBand(out[0]) !== m[2]) return null;
    return [round6(out[0]), round6(out[1])];
  }

  /* A pasted "lat lon" line, decimal or DMS with hemispheres:
     MGRS "36S XC 12345 12345"  |  "36.2083, 36.75"  |  "N36°12'30\" E036°45'00\""  |  "36 12 30 N 036 45 00 E" */
  function parsePair(line) {
    var s = String(line || '').toUpperCase().replace(/[,;]/g, ' ').trim();
    if (!s) return null;
    var mgrs = parseMgrs(s);
    if (mgrs) return mgrs;
    var lat = null, lon = null;
    if (/[NSEW]/.test(s)) {
      var re = /([NSEW])\s*([\d.\s°'′"″:]+)|([\d.\s°'′"″:]+?)\s*([NSEW])/g, m, comps = [];
      while ((m = re.exec(s))) comps.push(m[1] ? m[1] + ' ' + m[2] : m[3] + ' ' + m[4]);
      if (comps.length !== 2) return null;
      for (var i = 0; i < 2; i++) {
        var c = parseComponent(comps[i]);
        if (!c) return null;
        if (c.hemi === 'N' || c.hemi === 'S') { if (lat !== null) return null; lat = c.value; }
        else { if (lon !== null) return null; lon = c.value; }
      }
    } else {
      var nums = s.match(/-?\d+(?:\.\d+)?/g);
      if (!nums) return null;
      if (nums.length === 2) { lat = round6(parseFloat(nums[0])); lon = round6(parseFloat(nums[1])); }
      else if (nums.length === 6) {
        lat = parseComponent(nums.slice(0, 3).join(' ')); lon = parseComponent(nums.slice(3).join(' '));
        if (!lat || !lon) return null;
        lat = lat.value; lon = lon.value;
      } else return null;
    }
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
  }

  /* text with one point per line -> { points, badLines: [1-based line numbers] } */
  function parsePoints(text) {
    var points = [], bad = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var p = parsePair(line);
      if (p) points.push(p); else bad.push(i + 1);
    });
    return { points: points, badLines: bad };
  }

  /* Read-only outline preview (no map, H100 DA-4). Equirectangular about the mean latitude;
     north is up. Returns an <svg> string, '' for fewer than 2 points. closed = polygon. */
  function outlineSvg(points, closed, size) {
    var n = (points || []).length;
    if (n < 2) return '';
    size = size || 220;
    var pad = 14;
    var meanLat = points.reduce(function (a, p) { return a + p[0]; }, 0) / n;
    var k = Math.cos(meanLat * Math.PI / 180);
    var xs = points.map(function (p) { return p[1] * k; });
    var ys = points.map(function (p) { return -p[0]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var span = Math.max(maxX - minX, maxY - minY) || 1e-6;
    var scale = (size - 2 * pad) / span;
    var coords = xs.map(function (x, i) {
      return (pad + (x - minX) * scale).toFixed(1) + ',' + (pad + (ys[i] - minY) * scale).toFixed(1);
    });
    var shape = closed
      ? '<polygon points="' + coords.join(' ') + '" fill="rgba(80,160,255,0.18)" stroke="currentColor" stroke-width="1.5"/>'
      : '<polyline points="' + coords.join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.5"/>';
    var dots = coords.map(function (c) { var xy = c.split(','); return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2.5" fill="currentColor"/>'; }).join('');
    return '<svg class="aa-outline" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="Outline preview, north up">' +
      shape + dots + '<text x="' + (size - 6) + '" y="12" text-anchor="end" font-size="10" fill="currentColor">N&#8593;</text></svg>';
  }

  var api = { parseComponent: parseComponent, parseCoord: parseCoord, parsePair: parsePair, parsePoints: parsePoints, parseMgrs: parseMgrs, outlineSvg: outlineSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AirspaceCoords = api;
})(typeof window !== 'undefined' ? window : globalThis);
