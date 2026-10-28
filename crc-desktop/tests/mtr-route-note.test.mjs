/* AIRSP-2P-B: the MTR route note: a Strip whose MTR designator names a ROUTE in the registry says whether it is active. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mtrRouteNote, routeForDesignator } from '../app/public/js/panels/efsp/mtr-route-note.js';

const route = (state) => ({ airspaceId: 'VR1207', state, definition: { kind: 'ROUTE', name: 'VR1207 SEYHAN LOW' } });
const fd = (designator) => ({ military: { mtr: { designator } } });

test('an ACTIVE route reads "route active"; any other state reads "route not active" with the state', () => {
  assert.equal(mtrRouteNote(fd('VR1207'), [route('ACTIVE')]), 'VR1207: route active');
  assert.equal(mtrRouteNote(fd('VR1207'), [route('RETURNED')]), 'VR1207: route not active (RETURNED)');
  assert.equal(mtrRouteNote(fd('VR1207'), [route('SCHEDULED')]), 'VR1207: route not active (SCHEDULED)');
});

test('the designator is normalised as crc-sync does: trimmed, upper case', () => {
  assert.equal(mtrRouteNote(fd(' vr1207 '), [route('ACTIVE')]), 'VR1207: route active');
});

test('an unknown designator, no designator, no flight data, or an AREA with that id: no note', () => {
  assert.equal(mtrRouteNote(fd('VR9999'), [route('ACTIVE')]), null);
  assert.equal(mtrRouteNote(fd(null), [route('ACTIVE')]), null);
  assert.equal(mtrRouteNote(fd(''), [route('ACTIVE')]), null);
  assert.equal(mtrRouteNote(null, [route('ACTIVE')]), null);
  assert.equal(mtrRouteNote({ military: {} }, [route('ACTIVE')]), null);
  assert.equal(routeForDesignator('VR1207', [{ airspaceId: 'VR1207', state: 'ACTIVE', definition: { kind: 'AREA' } }]), null);
  assert.equal(mtrRouteNote(fd('VR1207'), []), null);
});
