import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runwayEndKey, facilityRunwayTrueDeg } from '../app/public/js/panels/aprt-runway.js';

// crc-sync docs/adr/0139 (S-ARCH-93): the APRT extended centreline is drawn on the runway end's TRUE heading from the
// Facility's runway-status record, not on the runway number read as magnetic (3 degrees off at Incirlik).

const INCIRLIK = JSON.parse(fs.readFileSync(new URL('../../crc-sync/config/efsp-facility-incirlik.json', import.meta.url), 'utf8'));
const record = (icao, runways) => ({ facilityId: `F-${icao}`, airportIcao: icao, runways });

test('runway designators: one or two digits and an optional side', () => {
  assert.equal(runwayEndKey('5'), '05');
  assert.equal(runwayEndKey(' 05 '), '05');
  assert.equal(runwayEndKey('23l'), '23L');
  assert.equal(runwayEndKey('ABC'), null);
  assert.equal(runwayEndKey(''), null);
  assert.equal(runwayEndKey(null), null);
});

test('Incirlik 05 and 23: the ends\' true headings from the shipped facility file, not 050/230 magnetic', () => {
  const rs = INCIRLIK.runwayStatus;
  const statuses = [record(rs.airportIcao, rs.runways)];
  const apt = { icao: 'LTAG', lat: 37.0, lon: 35.42 };
  assert.equal(facilityRunwayTrueDeg(apt, '05', statuses), 52.7);
  assert.equal(facilityRunwayTrueDeg(apt, '5', statuses), 52.7);
  assert.equal(facilityRunwayTrueDeg(apt, '23', statuses), 232.7);
  assert.equal(facilityRunwayTrueDeg(apt, '17', statuses), null, 'an end the field does not have: the fallback');
});

test('N airfields: whichever record names the airfield; none names it, no answer (the magnetic fallback applies)', () => {
  const statuses = Array.from({ length: 12 }, (_, i) => record(`ZZ${String(i).padStart(2, '0')}`, [{ runwayId: '09/27', ends: ['09', '27'], endHeadingsTrue: { '09': 90 + i, '27': 270 + i } }]));
  assert.equal(facilityRunwayTrueDeg({ icao: 'ZZ07' }, '27', statuses), 277);
  assert.equal(facilityRunwayTrueDeg({ icao: 'ZZ11' }, '09', statuses), 101);
  assert.equal(facilityRunwayTrueDeg({ icao: 'UGTB' }, '13', statuses), null);
  assert.equal(facilityRunwayTrueDeg({ name: 'no icao' }, '09', statuses), null);
  assert.equal(facilityRunwayTrueDeg(null, '09', statuses), null);
});

test('the server sends what this reads: the runway-status record carries airportIcao (crc-sync runway-status-store.js)', () => {
  const src = fs.readFileSync(new URL('../../crc-sync/src/efsp/runway-status-store.js', import.meta.url), 'utf8');
  assert.match(src, /out\.airportIcao = inventory\.airportIcao/);
});
