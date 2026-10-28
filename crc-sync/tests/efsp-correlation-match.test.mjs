import test from 'node:test';
import assert from 'node:assert/strict';

/* The correlation key ladder's matching rules (guide §6.6 rule 1, as
 * docs/adr/0142 cut it: binding, then the beacon code; no callsign rung).
 *
 * The matcher reads only what the aircraft gives: the code its transponder is
 * sending (docs/adr/0059). Nothing a controller is SHOWN — a label, a tag — and
 * not the DCS callsign either (H165).
 */

const matcher = await import('../src/efsp/correlation-match.js');
const { buildTrackIndices } = matcher;
const { octalCode } = await import('../src/surveillance/transponder.js');
// The fixtures' `squawk` stands for the code the transponder is sending.
const beaconFromTrack = (t) => (t ? octalCode(t.squawk) : null);

// ── the observed beacon code ───────────────────────────────────────────────

test('beaconFromTrack turns the SRS number into the 4-digit octal string the EFSP uses', () => {
  assert.equal(beaconFromTrack({ squawk: 7700 }), '7700');
  assert.equal(beaconFromTrack({ squawk: 41 }), '0041');
  assert.equal(beaconFromTrack({ squawk: 1 }), '0001');
  assert.equal(beaconFromTrack({ squawk: 0 }), '0000');
});

test('beaconFromTrack refuses a code that is not Mode 3/A rather than inventing one', () => {
  // An 8 or a 9 cannot appear in an octal code. A plausible-looking wrong
  // answer would sit next to the assigned code in §3.10.2 rule 1's mismatch
  // display and read as a real disagreement.
  assert.equal(beaconFromTrack({ squawk: 89 }), null);
  assert.equal(beaconFromTrack({ squawk: 7800 }), null);
  assert.equal(beaconFromTrack({ squawk: 12345 }), null);
  assert.equal(beaconFromTrack({ squawk: -1 }), null);
  assert.equal(beaconFromTrack({ squawk: 41.5 }), null);
});

test('beaconFromTrack answers null for a track with no transponder data at all', () => {
  assert.equal(beaconFromTrack({}), null);
  assert.equal(beaconFromTrack({ squawk: null }), null);
  assert.equal(beaconFromTrack(null), null);
});

// ── the per-tick indices ───────────────────────────────────────────────────

const TRACKS = [
  { id: 1, callsign: 'VIPER11', squawk: 41 },
  { id: 2, callsign: 'VIPER12', squawk: 42 },
  { id: 3, callsign: 'HORNET1', squawk: 41 },   // a duplicate code — structural, not an error
  { id: 4, callsign: 'MAGIC', squawk: null },
  { id: 5, callsign: 'BANDIT', squawk: 8888 },  // not a Mode 3/A code
];

test('buildTrackIndices keys tracks by observed code, and every track by id', () => {
  const { byBeacon, byId } = buildTrackIndices(TRACKS, beaconFromTrack);
  assert.deepEqual(byBeacon.get('0042'), ['2']);
  assert.equal(byId.get('1').callsign, 'VIPER11');
  assert.equal(byId.size, 5);
});

test('there is no callsign index and no callsign matcher (H165, docs/adr/0142)', () => {
  const indices = buildTrackIndices(TRACKS, beaconFromTrack);
  assert.deepEqual(Object.keys(indices).sort(), ['byBeacon', 'byId']);
  assert.deepEqual(Object.keys(matcher.default).sort(), ['buildTrackIndices']);
});

test('a duplicate beacon code lands both tracks under it rather than one winning silently', () => {
  // §3.10.2 rule 7: duplicates are structural and explicitly accepted. Picking
  // a winner here would hide the ambiguity the reconciler has to report.
  const { byBeacon } = buildTrackIndices(TRACKS, beaconFromTrack);
  assert.deepEqual(byBeacon.get('0041').sort(), ['1', '3']);
});

test('a ground vehicle is not in the beacon index, only by id (docs/adr/0121)', () => {
  const vehicle = { id: 9, callsign: 'VIPER11', squawk: 33, category: 3 };
  const { byBeacon, byId } = buildTrackIndices([...TRACKS, vehicle], beaconFromTrack);
  for (const ids of byBeacon.values()) assert.ok(!ids.includes('9'));
  assert.equal(byId.get('9'), vehicle);
});

test('a track with no usable code is absent from the beacon index', () => {
  const { byBeacon } = buildTrackIndices(TRACKS, beaconFromTrack);
  for (const ids of byBeacon.values()) {
    assert.ok(!ids.includes('4'), 'MAGIC has no squawk');
    assert.ok(!ids.includes('5'), 'BANDIT squawks something that is not octal');
  }
});

test('an AI aircraft\'s synthetic code is indexed like any other (docs/adr/0142)', () => {
  const ai = { id: 7, callsign: 'COLT11', squawk: 6012 };
  const { byBeacon } = buildTrackIndices([ai], beaconFromTrack);
  assert.deepEqual(byBeacon.get('6012'), ['7']);
});

test('buildTrackIndices copes with no tracks at all', () => {
  const { byBeacon, byId } = buildTrackIndices([], beaconFromTrack);
  assert.equal(byBeacon.size, 0);
  assert.equal(byId.size, 0);
  assert.equal(buildTrackIndices(null, beaconFromTrack).byId.size, 0);
});
