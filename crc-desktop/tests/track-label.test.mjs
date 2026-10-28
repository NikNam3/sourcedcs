/* How a contact reads (crc-sync's docs/adr/0059). track-label.js is the only
 * code that turns what crc-sync sends into text, so the data block, the track
 * panel, the bind picker and the correlation badge all agree by construction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import * as L from '../app/public/js/track-label.js';
import { settings } from '../app/public/js/settings.js';

settings.transitionAltFt = 18000;

function contact(over = {}) {
  return {
    id: '7', domain: 'AIR', onGround: false,
    label: { callsign: null, source: null, tag: null, trackNumber: 'TN00007' },
    type: null, ssr: null, altitude: null, dl: null, ...over,
  };
}
const MODE_C = { ft: 12000, ref: 'QNH', source: 'MODE_C' };

test('a contact is named by its flight, else its code, else its track number', () => {
  assert.equal(L.trackName(contact()), 'TN00007', 'primary only');
  assert.equal(L.trackName(contact({ ssr: { code: '4521' } })), '4521', 'squawking, uncorrelated');
  const flight = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'TN00007' } });
  assert.equal(L.trackName(flight), 'VIPER11');
  assert.equal('trackNameSuffix' in L, false, 'no `?` suffix: there is no provisional correlation (docs/adr/0142)');
});

test('the code line: emergencies always, the code only when a callsign already names it', () => {
  assert.deepEqual(L.trackCodeTag(contact({ ssr: { code: '4521' } })), { text: '', color: null }, 'the code is already the name');
  const named = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'TN1' } });
  assert.equal(L.trackCodeTag(named).text, '4521');
  const em = L.trackCodeTag(contact({ ssr: { code: '7700', emergency: 'GENERAL' } }));
  assert.equal(em.text, 'EMR');
  assert.ok(em.color);
});

test('¶5-4-6 e NOTE: the received code shows beside a name only while it is not the assigned code', () => {
  const named = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'TN1' } });
  assert.equal(L.trackCodeTag(named, '4521').text, '', 'squawking the assigned code: removed');
  assert.equal(L.trackCodeTag(named, '4522').text, '4521', 'a mismatch shows what it squawks');
  assert.equal(L.trackCodeTag(named, null).text, '4521', 'no assigned code: nothing matches');
  assert.equal(L.trackCodeTag({ ...named, ssr: { code: '4521', emergency: 'GENERAL' } }, '4521').text, 'EMR', 'an emergency always');
  assert.equal(L.receivedCodeText(contact(), '4521'), '', 'squawking nothing');
});

test('¶5-4-6 e NOTE in the ATC full data block: line 3 carries the received code on a mismatch, before the assigned values', () => {
  const t = contact({ ssr: { code: '4521' }, altitude: MODE_C, label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'TN1' } });
  const v = { kind: 'FDB', line0: [], l1Suffix: [] };
  const line3 = (info) => L.atcBlockLines(t, v, { speedKt: 280, ...info }).slice(2).map(l => l.map(s => s.text).join('')).join('\n');
  assert.equal(line3({ assignedCode: '4521', assigned: { altFt: 6000, hdg: 250 } }), 'A060↓ H250');
  assert.equal(line3({ assignedCode: '0041', assigned: { altFt: 6000, hdg: 250 } }), '4521 A060↓ H250');
  assert.equal(line3({ assignedCode: '0041' }), '4521');
  assert.equal(line3({ assignedCode: '4521' }), '');
  assert.equal(line3({}), '', 'no assigned code known: nothing to compare');
});

test('an altitude is shown only when a sensor gave one, and marked when it is not Mode C', () => {
  assert.equal(L.altitudeShort(contact()), '');
  assert.equal(L.altitudeShort(contact({ altitude: MODE_C })), '120');
  assert.equal(L.altitudeShort(contact({ altitude: { ...MODE_C, source: 'RADAR' } })), '120*');
  assert.equal(L.altitudeShort(contact({ altitude: { ...MODE_C, source: 'DATALINK' } })), '120L');
  assert.equal(L.altitudeLong(contact()), '—');
  assert.equal(L.altitudeLong(contact({ altitude: MODE_C })), '12,000 ft');
  assert.equal(L.altitudeLong(contact({ altitude: { ft: 23000, ref: 'STD', source: 'RADAR' } })), 'FL230 (radar height)');
});

test('the info line: altitude and rate only with an altitude, ground speed always', () => {
  assert.equal(L.infoLine(contact(), 420, null), 'G420');
  assert.equal(L.infoLine(contact({ altitude: MODE_C }), 420, 1500), '120↑15 G420');
  assert.equal(L.infoLine(contact({ altitude: MODE_C }), 420, 0), '120 G420');
});

test('the correlation badge names the contact, never the flight it already sits under', () => {
  const flight = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'TN00007' } });
  assert.equal(L.trackRef(flight), '4521');
  assert.equal(L.trackRef({ ...flight, ssr: null }), 'TN00007');
});

test('the picker tells two contacts on one code apart', () => {
  const a = contact({ id: '1', ssr: { code: '0041' }, label: { callsign: null, source: null, trackNumber: 'TN00001' } });
  const b = contact({ id: '2', ssr: { code: '0041' }, label: { callsign: null, source: null, trackNumber: 'TN00002' } });
  assert.notEqual(L.pickerText(a), L.pickerText(b));
  assert.equal(L.pickerText(a), '0041 · TN00001');
});

test('ships and vehicles get a data block only once tagged; a tag is editable only while nothing better names it', () => {
  assert.equal(L.shouldLabel(contact({ domain: 'SEA' })), false);
  assert.equal(L.shouldLabel(contact({ domain: 'SEA', label: { callsign: 'CVN', source: 'TAG', trackNumber: 'TN1' } })), true);
  assert.equal(L.tagEditable(contact()), true);
  assert.equal(L.tagEditable(contact({ label: { callsign: 'X', source: 'TAG' } })), true);
  assert.equal(L.tagEditable(contact({ label: { callsign: 'VIPER11', source: 'FLIGHT_DATA' } })), false);
});

test('an assigned altitude is written the way a controller writes it', () => {
  assert.equal(L.assignedAltText(18000), 'FL180');
  assert.equal(L.assignedAltText(5000), '5,000');
});

test('an assigned altitude block (docs/adr/0091) is written FL220-FL240, and A220B240 in a STARS block', () => {
  const block = { lowFt: 22000, highFt: 24000 };
  assert.equal(L.assignedBlockText(block), 'FL220-FL240');
  assert.equal(L.assignedBlockText({ lowFt: 5000, highFt: 8000 }), '5,000-8,000');
  assert.equal(L.atcAssignedText({ altFt: null, altBlock: block, hdg: 250 }, 23000), 'A220B240 H250', 'inside the block: no arrow');
  assert.equal(L.atcAssignedText({ altFt: null, altBlock: block, hdg: null }, 15000), 'A220B240↑');
  assert.equal(L.atcAssignedText({ altFt: null, altBlock: block, hdg: null }, 26000), 'A220B240↓');
  assert.equal(L.atcAssignedText({ altFt: null, altBlock: block, hdg: null }, 24100), 'A220B240', 'edge tolerance');
});

test('an assigned altitude follows the theater transition altitude (lane TA)', () => {
  const saved = settings.transitionAltFt;
  try {
    settings.transitionAltFt = 10000; // Syria
    assert.equal(L.assignedAltText(10000), 'FL100');
    assert.equal(L.assignedAltText(9000), '9,000');
    assert.equal(L.assignedBlockText({ lowFt: 22000, highFt: 24000 }), 'FL220-FL240');
    assert.equal(L.assignedBlockText({ lowFt: 8000, highFt: 12000 }), '8,000-FL120');
    settings.transitionAltFt = 18000;
    assert.equal(L.assignedAltText(10000), '10,000');
    assert.equal(L.assignedBlockText({ lowFt: 16000, highFt: 20000 }), '16,000-FL200');
  } finally { settings.transitionAltFt = saved; }
});

test('the carrier map label: side number and altitude in hundreds; no side number, the contact\'s usual name', () => {
  const t = { id: 7, domain: 'AIR', label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', trackNumber: 'T07' }, altitude: { ft: 1240, ref: 'QNH', source: 'MODE_C' } };
  assert.equal(L.sideAltText(t, '201'), '201 012');
  assert.equal(L.sideAltText(t, ''), 'VIPER11 012');
  assert.equal(L.sideAltText({ ...t, altitude: null }, '201'), '201');
});
