/* Two reads of names no module declared (ESM-1 findings, fixed by ESM-GUARDS). Both threw a ReferenceError when
 * they ran, and neither runs at module top level, so the module-graph test could not see them.
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { initToolsTab } from '../app/public/js/panels/tools-panel.js';
import { buildExtendedCenterline } from '../app/public/js/geojson.js';
import { _setAprtRunwayForTest } from '../app/public/js/panels/aprt-panel.js';
import { _setCoverageRadars } from '../app/public/js/app.js';

test('the Tools tab altitude calculator runs: 10,000 ft indicated at QNH 29.92 and 15 C is about 10,000 ft true', () => {
  const values = { 'tool-alt-temp': '15', 'tool-alt-qnh': '29.92', 'tool-alt-ind': '10000' };
  const handlers = {};
  const els = {};
  for (const id of ['set-conn-settings', 'tool-alt-calc', 'tool-alt-result', ...Object.keys(values)]) {
    els[id] = { value: values[id] ?? '', textContent: '', addEventListener: (type, fn) => { handlers[`${id}:${type}`] = fn; } };
  }
  const real = document.getElementById;
  document.getElementById = (id) => els[id] || null;
  try {
    initToolsTab();
    handlers['tool-alt-calc:click']();
  } finally { document.getElementById = real; }
  assert.match(els['tool-alt-result'].textContent, /^[\d,.   ]+ ft$/, `result was ${els['tool-alt-result'].textContent}`);
  const ft = Number(els['tool-alt-result'].textContent.replace(/[^\d]/g, ''));
  assert.ok(ft > 9500 && ft < 10600, `${ft} ft is not near 10,000`);
});

test('the extended centreline draws with its ticks, and each tick is perpendicular to the runway', () => {
  const apt = { name: 'Incirlik', lat: 37.0, lon: 35.42 };
  const RWY_TRUE = 50;
  _setAprtRunwayForTest(apt, RWY_TRUE);
  _setCoverageRadars([{ id: 'app:Incirlik', type: 'approach', airport: 'Incirlik' }]);
  try {
    const fc = buildExtendedCenterline();
    const line = fc.features.filter(f => f.properties.kind === 'centerline');
    const ticks = fc.features.filter(f => f.properties.kind === 'tick');
    assert.equal(line.length, 1, 'the centreline itself is drawn');
    assert.ok(ticks.length >= 3, `ticks: ${ticks.length}`);
    // local metres east/north of the airfield
    const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(apt.lat * Math.PI / 180);
    const vec = ([lon1, lat1], [lon2, lat2]) => [(lon2 - lon1) * mPerDegLon, (lat2 - lat1) * mPerDegLat];
    const [cx, cy] = vec(...line[0].geometry.coordinates);
    for (const t of ticks) {
      const [tx, ty] = vec(...t.geometry.coordinates);
      const cos = (cx * tx + cy * ty) / (Math.hypot(cx, cy) * Math.hypot(tx, ty));
      assert.ok(Math.abs(cos) < 0.01, `tick is not perpendicular to the runway (cos ${cos})`);
    }
  } finally {
    _setAprtRunwayForTest(null, null);
    _setCoverageRadars([]);
  }
});
