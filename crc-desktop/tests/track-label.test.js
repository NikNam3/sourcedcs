'use strict';

/* How a contact reads (crc-sync's docs/adr/0059). track-label.js is the only
 * code that turns what crc-sync sends into text, so the data block, the track
 * panel, the bind picker and the correlation badge all agree by construction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

global.settings = { transitionAltFt: 18000 };
const L = require(path.join(__dirname, '../app/public/js/track-label.js'));

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
  const flight = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FDR', trackNumber: 'TN00007' } });
  assert.equal(L.trackName(flight), 'VIPER11');
  assert.equal(L.trackNameSuffix(flight), '');
  assert.equal(L.trackNameSuffix({ ...flight, label: { ...flight.label, source: 'FDR_PROVISIONAL' } }), '?', 'doubt looks like doubt');
});

test('the code line: emergencies always, the code only when a callsign already names it', () => {
  assert.deepEqual(L.trackCodeTag(contact({ ssr: { code: '4521' } })), { text: '', color: null }, 'the code is already the name');
  const named = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FDR', trackNumber: 'TN1' } });
  assert.equal(L.trackCodeTag(named).text, '4521');
  const em = L.trackCodeTag(contact({ ssr: { code: '7700', emergency: 'GENERAL' } }));
  assert.equal(em.text, 'EMR');
  assert.ok(em.color);
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
  const flight = contact({ ssr: { code: '4521' }, label: { callsign: 'VIPER11', source: 'FDR', trackNumber: 'TN00007' } });
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
  assert.equal(L.tagEditable(contact({ label: { callsign: 'VIPER11', source: 'FDR' } })), false);
});

test('an assigned altitude is written the way a controller writes it', () => {
  assert.equal(L.assignedAltText(18000), 'FL180');
  assert.equal(L.assignedAltText(5000), '5,000');
});
