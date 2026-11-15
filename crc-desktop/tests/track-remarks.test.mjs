/* Whose remarks a track's data block carries (docs/adr/0165): the Strip this controller's Position owns, never
 * another Position's, never a DROPPED Strip's. */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { trackRemarks } from '../app/public/js/panels/efsp/track-remarks.js';

const FD = {
  fdA: { flightDataId: 'fdA', filed: { remarks: 'NORDO' } },
  fdB: { flightDataId: 'fdB', filed: { remarks: 'VIP ON BOARD' } },
  fdBlank: { flightDataId: 'fdBlank', filed: { remarks: '   ' } },
  fdNone: { flightDataId: 'fdNone', filed: {} },
};
const of = (id) => FD[id] || null;
const strip = (flightDataId, ownerPositionId, state = 'ACTIVE') => ({ stripId: `s-${flightDataId}-${ownerPositionId}`, flightDataId, ownerPositionId, state });

test('the owned Strip\'s remarks; nothing for a flight another Position works', () => {
  assert.equal(trackRemarks([strip('fdA', 'P1')], ['P1'], of), 'NORDO');
  assert.equal(trackRemarks([strip('fdA', 'P2')], ['P1'], of), '');
  assert.equal(trackRemarks([strip('fdA', 'P1')], [], of), '', 'acting nowhere');
});

test('a DROPPED Strip, blank remarks or no remarks give nothing; the first owned Strip with remarks wins', () => {
  assert.equal(trackRemarks([strip('fdA', 'P1', 'DROPPED')], ['P1'], of), '');
  assert.equal(trackRemarks([strip('fdBlank', 'P1'), strip('fdNone', 'P1')], ['P1'], of), '');
  assert.equal(trackRemarks([strip('fdBlank', 'P1'), strip('fdB', 'P1'), strip('fdA', 'P1')], ['P1'], of), 'VIP ON BOARD');
  assert.equal(trackRemarks([strip('fdA', 'P2'), strip('fdB', 'P1')], ['P1', 'P3'], of), 'VIP ON BOARD');
  assert.equal(trackRemarks([null, strip('fdMissing', 'P1')], ['P1'], of), '', 'no flight data');
  assert.equal(trackRemarks(null, ['P1'], of), '');
});
