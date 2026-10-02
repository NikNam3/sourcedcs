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

  /* A pasted "lat lon" line, decimal or DMS with hemispheres:
     "36.2083, 36.75"  |  "N36°12'30\" E036°45'00\""  |  "36 12 30 N 036 45 00 E" */
  function parsePair(line) {
    var s = String(line || '').toUpperCase().replace(/[,;]/g, ' ').trim();
    if (!s) return null;
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

  var api = { parseComponent: parseComponent, parseCoord: parseCoord, parsePair: parsePair, parsePoints: parsePoints, outlineSvg: outlineSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AirspaceCoords = api;
})(typeof window !== 'undefined' ? window : globalThis);
