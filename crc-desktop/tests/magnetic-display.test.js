'use strict';

/* Headings are magnetic, from crc-sync's model (crc-sync docs/adr/0085,
 * decisions H15). The manual `hdgCorrection` setting and its Airport-panel
 * field are gone, every heading display goes through magnetic.js, and a typed
 * magnetic value is converted by crc-sync rather than here. The maths itself
 * (and its parity with the server) is tested in crc-sync's
 * tests/theater-context.test.mjs, against this same file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../app/public');
const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');

function clientJs() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push([path.relative(PUBLIC, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(path.join(PUBLIC, 'js'));
  return out;
}

test('the Airport panel has no heading-correction or transition-altitude input; the theater facts are read-only', () => {
  const html = read('index.html');
  assert.equal(html.includes('aprt-hdg-correction'), false);
  assert.equal(html.includes('aprt-transition-alt'), false);
  assert.match(html, /<span id="aprt-theater-ta"/);
  assert.match(html, /<span id="aprt-theater-var"/);
});

test('hdgCorrection is not a setting: not in DEFAULTS, read nowhere, only stripped from an old saved object', () => {
  const app = read('js/app.js');
  const defaults = app.slice(app.indexOf('const DEFAULTS = {'), app.indexOf('let settings = { ...DEFAULTS };'));
  assert.ok(defaults.length > 100, 'found the DEFAULTS block');
  assert.equal(defaults.includes('hdgCorrection'), false);
  for (const [file, src] of clientJs()) {
    const uses = src.split('\n').filter(l => l.includes('hdgCorrection'));
    if (file === path.join('js', 'app.js')) assert.deepEqual(uses.map(l => l.trim()), ['delete settings.hdgCorrection;']);
    else assert.deepEqual(uses, [], file);
  }
});

test('nothing sends theaterSettingsSet, and the client listens for `theater`, not `theater-settings`', () => {
  for (const [file, src] of clientJs()) assert.equal(src.includes('theaterSettingsSet'), false, file);
  const app = read('js/app.js');
  assert.match(app, /case 'theater':/);
  assert.equal(app.includes("case 'theater-settings'"), false);
});

test('every bearing display goes through magnetic.js — the grid-plus-fudge chain is gone', () => {
  for (const [file, src] of clientJs()) {
    assert.equal(/\bgridBearingDeg\b/.test(src), false, `${file} still uses gridBearingDeg`);
    assert.equal(/THEATRE_LON0/.test(src), false, `${file} still has its own central-meridian table`);
  }
  assert.match(read('js/panels/topbar.js'), /magneticText\(bearingDeg\(be\.lat, be\.lon, cursor\.lat, cursor\.lng\), be\.lat, be\.lon\)/);
  assert.match(read('js/panels/topbar.js'), /magneticText\(bearingDeg\(lat1, lng1, lat2, lng2\), lat1, lng1\)/);
  assert.match(read('js/panels/track-panel.js'), /magneticText\(heading, t\.lat, t\.lon\)/);
});

test('typed magnetic runway courses are converted by crc-sync, and the map draws only the answer', () => {
  assert.match(read('js/panels/airport-selector.js'), /requestTrueFromMagnetic\(approachRwyCourse, selectedApt\.lat, selectedApt\.lon\)/);
  assert.match(read('js/panels/aprt-panel.js'), /requestTrueFromMagnetic\(_aprtRwyHeading, apt\.lat, apt\.lon\)/);
  const geo = read('js/geojson.js');
  assert.match(geo, /const course {5}= approachRwyCourseTrue;/);
  assert.match(geo, /const reciprocal {2}= \(_aprtRwyTrueDeg \+ 180\) % 360;/);
  assert.equal(require('../app/proxy-routes').resolveProxyPath('/api/magnetic/to-true?mag=90', 'GET'), '/api/magnetic/to-true?mag=90');
});

test('magnetic.js loads after geo.js and before any panel', () => {
  const html = read('index.html');
  const at = (s) => html.indexOf(`<script src="./js/${s}"></script>`);
  assert.ok(at('magnetic.js') > at('geo.js') && at('geo.js') > 0);
  assert.ok(at('magnetic.js') < at('geojson.js'));
  assert.ok(at('magnetic.js') < at('panels/topbar.js'));
});

test('magnetic.js: fixed variation, grid interpolation, unknown → null', () => {
  const M = require(path.join(PUBLIC, 'js/magnetic.js'));
  M.applyTheaterFacts(null);
  assert.equal(M.toMagneticDisplay(90, 35, 36), null);
  M.applyTheaterFacts({ magnetic: { fixedDeg: 5, grid: null }, convergence: { tmCentralMeridianDeg: null } });
  assert.equal(M.toMagneticDisplay(90, 35, 36), 85);
  assert.equal(M.toMagneticDisplay(2), 357);
  assert.equal(M.gridConvergenceDeg(35, 36), null);
  // A 2×2 grid: 4° along the south edge, 6° along the north.
  M.applyTheaterFacts({ magnetic: { fixedDeg: null, grid: { latMin: 30, lonMin: 30, stepDeg: 1, rows: 2, cols: 2, deg: [4, 4, 6, 6] } } });
  assert.equal(M.magneticVariationAt(30.5, 30.5), 5);
  assert.equal(M.magneticVariationAt(10, 10), 4, 'outside: the nearest edge');
  assert.equal(M.magneticVariationAt(), 5, 'no position: the centre');
  assert.equal(M.magneticText(95, 30.5, 30.5), '090');
});

test('wind: tower readout, weather popup and ATIS text show crc-sync\'s MAGNETIC wind, labelled (H76)', () => {
  for (const [file, src] of clientJs()) {
    assert.equal(/\.windFrom\b/.test(src), false, `${file} reads the raw, frame-less windFrom`);
  }
  const aprt = read('js/panels/aprt-panel.js');
  assert.match(aprt, /\$\{windDir\}°M @ \$\{wx\.windKt\} kt/, 'tower readout says M');
  assert.match(aprt, /wx && wx\.windFromMagnetic != null \? String\(wx\.windFromMagnetic\)/, 'ATIS uses magnetic');
  assert.match(aprt, /'Wind not available\.'/, 'unknown variation: no true value read as magnetic');
  assert.match(read('js/panels/airport-selector.js'), /\$\{windDir\}°M @ \$\{d\.windKt\} kt/);
});
