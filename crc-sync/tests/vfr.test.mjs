import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0146: a flight is VFR when it is worked on a live VFR strip, whatever it was assigned (superseding H136 VQ2's
// "no clearance" and S-ARCH-76's reading of an emptied cell).
const { isVfrStrip, isVfrFlight } = await import('../src/efsp/vfr.js');

test('VFR is the strip type: an assigned altitude does not make it IFR, no clearance does not make it VFR', () => {
  assert.equal(isVfrStrip({ stripType: 'VFR', state: 'TRACKED' }), true);
  assert.equal(isVfrStrip({ stripType: 'VFR', state: 'DROPPED' }), false);
  assert.equal(isVfrStrip({ stripType: 'OVERFLIGHT', state: 'IN_SECTOR' }), false);
  assert.equal(isVfrStrip(null), false);
  assert.equal(isVfrFlight([{ stripType: 'DEPARTURE', state: 'DEPARTED' }]), false);
  assert.equal(isVfrFlight([{ stripType: 'DEPARTURE', state: 'DROPPED' }, { stripType: 'VFR', state: 'TRACKED' }]), true);
  assert.equal(isVfrFlight([]), false);
  assert.equal(isVfrFlight(undefined), false);
});
