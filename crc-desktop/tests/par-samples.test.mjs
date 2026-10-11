import './helpers/client-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyParSamples, clearParSamples, parSampleFor, parSamples, parSampleTimes } from '../app/public/js/panels/efsp/par-samples.js';
import { carrierDistanceNm, carrierFinalDistanceText } from '../app/public/js/panels/efsp/carrier-final-distance.js';
import { applyEfspCarrierSnapshot } from '../app/public/js/panels/efsp/carrier-state.js';
import { applyEfspCorrelationDelta } from '../app/public/js/panels/efsp/efsp-state.js';
import { latestFromServer } from '../app/public/js/picture.js';

// crc-sync docs/adr/0112: the PAR samples this session is sent. The DIST Block (C17): at an airfield the PAR's range to the
// threshold; on the carrier the range from the ship, for every carrier Position (H125, crc-sync docs/adr/0116).

const sample = (stripId, rangeNm) => ({ stripId, facilityId: 'INCIRLIK', positionId: 'PAR', approach: { id: 'LTAG-05' }, sensor: {}, plot: rangeNm == null ? null : { rangeNm }, plotAgeMs: 0, trail: [] });

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

test('the airfield DIST Block is the PAR\'s range to the threshold, blank without a PAR sample', () => {
  clearParSamples();
  const strip = { stripId: 'c1', ownerPositionId: 'PAR' };
  assert.equal(carrierDistanceNm(strip), null);
  assert.equal(carrierFinalDistanceText(strip), '', 'not this controller\'s final');
  applyParSamples({ type: 'par-sample', at: 1, samples: [sample('c1', 2.46)] });
  assert.equal(carrierDistanceNm(strip), 2.46);
  assert.equal(carrierFinalDistanceText(strip), '2.5 NM');
  applyParSamples({ type: 'par-sample', at: 2, samples: [sample('c1', null)] });
  assert.equal(carrierFinalDistanceText(strip), '', 'no plot yet: blank');
  clearParSamples();
  assert.equal(carrierDistanceNm(null), null);
});

test('the carrier DIST Block is the range from the ship to the contact, for every carrier Position, PAR sample or not (H125)', () => {
  clearParSamples();
  applyEfspCarrierSnapshot({ carriers: [{ hullId: 'CVN-72', shipState: { found: true, lat: 35, lon: 33.5 } }] });
  applyEfspCorrelationDelta({ correlations: { updated: [{ flightDataId: 'fc', trackId: '77' }] } });
  latestFromServer.set('77', { id: '77', lat: 35 - 3 / 60, lon: 33.5 });
  for (const owner of ['CV_APP1', 'CV_PRIFLY', 'CV_MARSHAL']) {
    const strip = { stripId: 'cv1', flightDataId: 'fc', ownerPositionId: owner, stripType: 'FINAL' };
    assert.equal(carrierFinalDistanceText(strip), '3.0 NM', owner);
  }
  // A PAR sample for the Strip (there is none on the carrier now) would not change it: the ship is the reference.
  applyParSamples({ type: 'par-sample', at: 3, samples: [sample('cv1', 9.9)] });
  assert.equal(carrierFinalDistanceText({ stripId: 'cv1', flightDataId: 'fc', ownerPositionId: 'CV_APP1' }), '3.0 NM');
  // The ship moved (the server republishes after 0.05 NM): the figure follows it.
  applyEfspCarrierSnapshot({ carriers: [{ hullId: 'CVN-72', shipState: { found: true, lat: 35 - 1 / 60, lon: 33.5 } }] });
  assert.equal(carrierFinalDistanceText({ stripId: 'cv1', flightDataId: 'fc', ownerPositionId: 'CV_APP1' }), '2.0 NM');
  // No contact: blank.
  latestFromServer.delete('77');
  assert.equal(carrierFinalDistanceText({ stripId: 'cv1', flightDataId: 'fc', ownerPositionId: 'CV_APP1' }), '');
  clearParSamples();
  applyEfspCarrierSnapshot({ carriers: [] });
});
