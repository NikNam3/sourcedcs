import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyParSamples, clearParSamples, parSampleFor, parSamples, parSampleTimes } from '../app/public/js/panels/efsp/par-samples.js';
import { carrierDistanceNm, carrierFinalDistanceText } from '../app/public/js/panels/efsp/carrier-final-distance.js';

// crc-sync docs/adr/0112: the PAR samples this session is sent, and the carrier FINAL Strip's DIST Block, which reads the
// PAR's range to the touchdown point instead of measuring from the ship's centre on a banner that can be minutes old.

const sample = (stripId, rangeNm) => ({ stripId, facilityId: 'CARRIER', positionId: 'CV_APP1', approach: { id: 'CVN-72' }, sensor: {}, plot: rangeNm == null ? null : { rangeNm }, plotAgeMs: 0, trail: [] });

test('a par-sample frame replaces every earlier sample; an empty frame clears them', () => {
  applyParSamples({ type: 'par-sample', at: 100, samples: [sample('a', 3), sample('b', 5)] }, 7);
  assert.equal(parSampleFor('a').plot.rangeNm, 3);
  assert.equal(parSamples().length, 2);
  assert.deepEqual(parSampleTimes(), { at: 100, receivedAt: 7 });
  applyParSamples({ type: 'par-sample', at: 101, samples: [sample('b', 4.9)] }, 8);
  assert.equal(parSampleFor('a'), null, 'a left the final');
  assert.equal(parSampleFor('b').plot.rangeNm, 4.9);
  applyParSamples({ type: 'par-sample', at: 102, samples: [] });
  assert.deepEqual(parSamples(), []);
});

test('the carrier DIST Block is the PAR\'s range to touchdown, blank without a PAR sample', () => {
  clearParSamples();
  const strip = { stripId: 'c1' };
  assert.equal(carrierDistanceNm(strip), null);
  assert.equal(carrierFinalDistanceText(strip), '', 'no stale figure from the ship\'s centre');
  applyParSamples({ type: 'par-sample', at: 1, samples: [sample('c1', 2.46)] });
  assert.equal(carrierDistanceNm(strip), 2.46);
  assert.equal(carrierFinalDistanceText(strip), '2.5 NM');
  applyParSamples({ type: 'par-sample', at: 2, samples: [sample('c1', null)] });
  assert.equal(carrierFinalDistanceText(strip), '', 'no plot yet: blank');
  clearParSamples();
  assert.equal(carrierDistanceNm(null), null);
});
