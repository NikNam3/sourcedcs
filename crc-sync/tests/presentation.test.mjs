import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0059 — what a controller is told about a contact depends on the
// sensors that saw it. One case per combination.
const { presentTrack, WIRE_KEYS } = await import('../src/surveillance/presentation.js');

const TRACK = {
  id: 7, callsign: 'Enfield11', name: 'Aerial-1-1', coalition: 3, type: 'F-16C_50', player: 'Maverick',
  category: 1, lat: 37.1, lon: 35.2, alt: 3048, heading: 90, course: 91, groundSpeed: 200, verticalSpeed: 0,
};
const ENV = { weather: { pressurePa: 101325, tempK: 288.15 }, transitionAltFt: 18000 };
const NOBODY = { fdrId: null, correlation: null, fdrCallsign: null, fdrType: null, tag: null, trackNumber: 'TN00007' };

const APP = { caps: { height: false, ssr: true }, sweepMs: 3000, at: 1000 };
const PSR_ONLY = { caps: { height: false, ssr: false }, sweepMs: 3000, at: 1000 };
const AWACS = { caps: { height: true, ssr: true }, sweepMs: 10000, at: 1000 };
const SQUAWK = { code: '4521', ident: false, emergency: null };

function present(over = {}) {
  return presentTrack(over.track || TRACK, {
    at: 1000, radars: [APP], dl: null, who: NOBODY, iffState: 'friendly', iffOverride: null,
    transponder: SQUAWK, env: ENV, missionData: null, ...over,
  });
}

test('only listed keys, and no DCS truth, ever leave this function', () => {
  const wire = present();
  assert.deepEqual(Object.keys(wire).sort(), [...WIRE_KEYS].sort());
  const text = JSON.stringify(wire);
  for (const leak of ['Enfield11', 'Aerial-1-1', 'F-16C_50', 'Maverick', '3048', 'coalition', 'player']) {
    assert.equal(text.includes(leak), false, `${leak} leaked`);
  }
});

test('2D radar + SSR, squawking: code and Mode C altitude, named by nothing but its code/TN', () => {
  const wire = present();
  assert.deepEqual(wire.ssr, SQUAWK);
  assert.deepEqual(wire.altitude, { ft: 10000, ref: 'QNH', source: 'MODE_C' });
  assert.deepEqual(wire.sources, ['PRIMARY', 'SSR']);
  assert.equal(wire.label.callsign, null);
  assert.equal(wire.label.trackNumber, 'TN00007');
  assert.equal(wire.type, null);
});

test('2D radar + SSR, transponder off: a position and nothing else', () => {
  const wire = present({ transponder: null });
  assert.equal(wire.ssr, null);
  assert.equal(wire.altitude, null);
  assert.deepEqual(wire.sources, ['PRIMARY']);
});

test('a radar that does not interrogate gets no code even from a squawking aircraft', () => {
  const wire = present({ radars: [PSR_ONLY] });
  assert.equal(wire.ssr, null);
  assert.equal(wire.altitude, null);
});

test('a height-finding radar gives an altitude with the transponder off', () => {
  const wire = present({ radars: [AWACS], transponder: null });
  assert.equal(wire.ssr, null);
  assert.equal(wire.altitude.source, 'RADAR');
  assert.deepEqual(wire.sources, ['PRIMARY', 'HEIGHT']);
});

test('Mode C wins over a radar height when both are there', () => {
  assert.equal(present({ radars: [AWACS] }).altitude.source, 'MODE_C');
});

test('above transition the altitude is a flight level on standard pressure', () => {
  const wire = present({ track: { ...TRACK, alt: 7000 } });
  assert.equal(wire.altitude.ref, 'STD');
  assert.ok(wire.altitude.ft >= 22900 && wire.altitude.ft <= 23000);
});

test('a radar whose last return is stale does not lend its capabilities', () => {
  // The AWACS saw it 30 s ago; only the 2D radar is current.
  const wire = present({ at: 40000, radars: [{ ...APP, at: 40000 }, { ...AWACS, at: 10000 }], transponder: null });
  assert.equal(wire.altitude, null);
});

test('correlated: the flight callsign and type; provisional is flagged; the tag loses', () => {
  const who = { ...NOBODY, fdrId: 'f1', correlation: 'CORRELATED', fdrCallsign: 'VIPER11', fdrType: 'F16', tag: 'BANDIT' };
  const wire = present({ who });
  assert.deepEqual(wire.label, { callsign: 'VIPER11', source: 'FDR', tag: 'BANDIT', trackNumber: 'TN00007' });
  assert.equal(wire.type, 'F16');
  assert.equal(present({ who: { ...who, correlation: 'PROVISIONAL' } }).label.source, 'FDR_PROVISIONAL');
  assert.deepEqual(present({ who: { ...NOBODY, tag: 'BANDIT' } }).label.source, 'TAG');
});

test('datalink: the participant names itself, gives its type and altitude, even with no radar', () => {
  const dl = { callsign: 'Enfield11', type: 'F-16C_50', lock: '9' };
  const wire = present({ radars: [], transponder: null, dl });
  assert.equal(wire.label.callsign, 'Enfield11');
  assert.equal(wire.label.source, 'DATALINK');
  assert.equal(wire.type, 'F-16C_50');
  assert.equal(wire.altitude.source, 'DATALINK');
  assert.deepEqual(wire.dl, { lock: '9' });
  assert.deepEqual(wire.sources, ['DATALINK']);
});

test('the flight plan beats the datalink name', () => {
  const who = { ...NOBODY, correlation: 'CORRELATED', fdrCallsign: 'VIPER11', fdrType: 'F16' };
  const wire = present({ who, dl: { callsign: 'Enfield11', type: 'F-16C_50', lock: null } });
  assert.equal(wire.label.callsign, 'VIPER11');
  assert.equal(wire.type, 'F16');
});

test('ships and ground vehicles: a position, never a code or an altitude', () => {
  const ship = present({ track: { ...TRACK, category: 4 } });
  assert.equal(ship.domain, 'SEA');
  assert.equal(ship.ssr, null);
  assert.equal(ship.altitude, null);
  assert.equal(present({ track: { ...TRACK, category: 3 } }).domain, 'GROUND');
});

test('an enemy on the ground is not presented at all', () => {
  assert.equal(present({ iffState: 'invisible' }), null);
});

test('no current sensor at all: not presented', () => {
  assert.equal(present({ radars: [] }), null);
});
