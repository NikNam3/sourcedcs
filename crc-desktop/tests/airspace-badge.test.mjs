/* The Strip's airspace badge (crc-sync docs/adr/0134, H155 item 4): amber only while the flight is airborne inside its
 * approved airspace (the server's `airspaceInside` fact) and that airspace is not ACTIVE; grey otherwise. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const cold = { airspaceId: 'MOA-1', state: 'SCHEDULED' };
const hot = { airspaceId: 'MOA-1', state: 'ACTIVE' };

test('the tone: amber only inside and not active; the title names the state', async () => {
  const { airspaceBadgeTone } = await freshGraph().import('panels/efsp/strip-indicators.js');
  assert.deepEqual(airspaceBadgeTone(cold, true, 'Bravo MOA'), { amber: true, title: 'Bravo MOA is SCHEDULED, not active' });
  assert.deepEqual(airspaceBadgeTone(cold, false, 'Bravo MOA'), { amber: false, title: '' }, 'approved early, on the ground or en route');
  assert.deepEqual(airspaceBadgeTone(hot, true, 'Bravo MOA'), { amber: false, title: '' }, 'activated while inside');
  assert.deepEqual(airspaceBadgeTone(null, true, 'MOA-1'), { amber: false, title: '' }, 'no airspace record: unknown, grey');
});

test('the inside fact is per Strip and per approved airspace, and an efsp-alerts frame replaces it whole', async () => {
  const { applyEfspAlerts, airspaceInsideForStrip } = await freshGraph().import('panels/efsp/alerts-state.js');
  const strip = { facilityId: 'INCIRLIK', stripId: 's1', airspaceEntry: { airspaceId: 'MOA-1' } };
  assert.equal(airspaceInsideForStrip(strip), false, 'nothing said: not inside');
  applyEfspAlerts({ airspaceInside: [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }] });
  assert.equal(airspaceInsideForStrip(strip), true);
  assert.equal(airspaceInsideForStrip({ ...strip, facilityId: 'CENTER' }), false, 'another Facility\'s s1');
  assert.equal(airspaceInsideForStrip({ ...strip, airspaceEntry: { airspaceId: 'MOA-2' } }), false, 'another airspace approved since');
  assert.equal(airspaceInsideForStrip({ ...strip, airspaceEntry: null }), false, 'entry cleared: no badge, no fact');
  applyEfspAlerts({});
  assert.equal(airspaceInsideForStrip(strip), false);
});
