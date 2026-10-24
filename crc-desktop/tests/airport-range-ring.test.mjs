/* H164 FT-Q1 (c): the radar-sized range ring around the selected airport reads as a coverage overlay, so it draws only
 * while Settings → Map Overlays "Airport range ring" is on, off by default. The reference track's ring is a selection
 * the controller made and draws either way. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './helpers/client-env.mjs';

const { settings } = await import('../app/public/js/settings.js');
const { buildRangeRing } = await import('../app/public/js/geojson.js');
const view = await import('../app/public/js/view-state.js');
const picture = await import('../app/public/js/picture.js');

const APT = { name: 'Incirlik', icao: 'LTAG', lat: 37.0, lon: 35.4 };

test('off by default: no airport ring, whatever radar the airport has', () => {
  assert.equal(settings.airportRangeRing, false);
  view._setSelectedApt(APT);
  picture._setCoverageRadars([{ id: 'app:Incirlik', presentation: 'ATC', rangeM: 80 * 1852 }]);
  assert.deepEqual(buildRangeRing().features, []);
});

test('switched on: the ring is back, sized from the airport\'s radar', () => {
  settings.airportRangeRing = true;
  view._setSelectedApt(APT);
  picture._setCoverageRadars([{ id: 'app:Incirlik', presentation: 'ATC', rangeM: 80 * 1852 }]);
  assert.equal(buildRangeRing().features.length, 1);
  picture._setCoverageRadars([{ id: 'apt:Incirlik', presentation: 'ATC', rangeM: 20 * 1852 }]);
  assert.deepEqual(buildRangeRing().features.map(f => f.properties.ring), ['range', 'ground']);
  settings.airportRangeRing = false;
});

test('the switch is in Settings → Map Overlays and the panel wires it', () => {
  const pub = path.join(import.meta.dirname, '../app/public');
  assert.match(fs.readFileSync(path.join(pub, 'index.html'), 'utf8'), /id="set-airport-range-ring"/);
  assert.match(fs.readFileSync(path.join(pub, 'js/panels/settings-panel.js'), 'utf8'), /persist\('airportRangeRing'/);
});
