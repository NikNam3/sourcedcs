import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The squawk-map test below really does edit the map, to prove the matcher is
// unmoved by it — so point resolve.js at a temp file BEFORE it is imported.
// Without this the test would rewrite the squadron's own
// config/squawk-map.json, which is hand-edited data.
process.env.CRCSYNC_SQUAWK_MAP_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-corrmatch-')), 'squawk-map.json',
);

/* The correlation key ladder's matching rules (guide §6.6 rule 1).
 *
 * The decision most worth pinning is negative: a squawk-map entry must not
 * change any correlation. resolveCallsign() rewrites display names from that
 * map, so matching on its output would turn the callsign rung into the beacon
 * rung with a config lookup in the middle — and would let any connected
 * client re-correlate flights by editing squadron config.
 */

const {
  normaliseCallsign, splitCallsign, beaconFromTrack, callsignAffinity, buildTrackIndices,
  AFFINITY_EXACT, AFFINITY_FORMATION, AFFINITY_SUFFIXED, AFFINITY_SAME_STEM,
} = await import('../src/efsp/correlation-match.js');

// ── normalisation ──────────────────────────────────────────────────────────

test('normaliseCallsign strips everything that is not a letter or digit, and upper-cases', () => {
  assert.equal(normaliseCallsign('Viper 1-1'), 'VIPER11');
  assert.equal(normaliseCallsign('viper11'), 'VIPER11');
  assert.equal(normaliseCallsign('  VIPER 1 '), 'VIPER1');
  assert.equal(normaliseCallsign(''), '');
  assert.equal(normaliseCallsign(null), '');
  assert.equal(normaliseCallsign(undefined), '');
});

test('splitCallsign separates the stem, the element digits and a trailing letter', () => {
  assert.deepEqual(splitCallsign('VIPER11'), { stem: 'VIPER', digits: '11', suffix: '' });
  assert.deepEqual(splitCallsign('VIPER1A'), { stem: 'VIPER', digits: '1', suffix: 'A' });
  assert.deepEqual(splitCallsign('VIPER'), { stem: 'VIPER', digits: '', suffix: '' });
  assert.deepEqual(splitCallsign('Viper 1-1'), { stem: 'VIPER', digits: '11', suffix: '' });
});

test('splitCallsign does not choke on a callsign that is only digits', () => {
  assert.deepEqual(splitCallsign('1234'), { stem: '', digits: '1234', suffix: '' });
});

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

// ── the callsign rule ──────────────────────────────────────────────────────

test('an exact match after normalisation is exact, however the two sides were written', () => {
  assert.equal(callsignAffinity('VIPER11', 'VIPER11'), AFFINITY_EXACT);
  assert.equal(callsignAffinity('viper 1-1', 'VIPER11'), AFFINITY_EXACT);
});

test('formation numbering matches: a plan filed for the flight against the element DCS named', () => {
  // Guide §3.2 rule 2 makes a formation ONE Identity with flightSize > 1, so
  // VIPER1 is filed while VIPER11 and VIPER12 are flying.
  assert.equal(callsignAffinity('VIPER1', 'VIPER11'), AFFINITY_FORMATION);
  assert.equal(callsignAffinity('VIPER1', 'VIPER12'), AFFINITY_FORMATION);
  assert.equal(callsignAffinity('VIPER11', 'VIPER1'), AFFINITY_FORMATION, 'and the other way round');
});

test('a trailing letter on either side is a suffixed element', () => {
  assert.equal(callsignAffinity('VIPER1', 'VIPER1A'), AFFINITY_SUFFIXED);
  assert.equal(callsignAffinity('VIPER1A', 'VIPER1'), AFFINITY_SUFFIXED);
});

test('no digits on one side is also a suffixed match', () => {
  assert.equal(callsignAffinity('VIPER', 'VIPER1'), AFFINITY_SUFFIXED);
  assert.equal(callsignAffinity('VIPER1', 'VIPER'), AFFINITY_SUFFIXED);
});

test('the same stem with a genuinely different element is the weakest match, not a miss', () => {
  // VIPER1 and VIPER2 are two flights of one squadron. Worth surfacing as
  // provisional; never worth treating as the same aircraft silently.
  assert.equal(callsignAffinity('VIPER1', 'VIPER2'), AFFINITY_SAME_STEM);
  assert.equal(callsignAffinity('VIPER13', 'VIPER24'), AFFINITY_SAME_STEM);
});

test('a different stem is no match at all', () => {
  assert.equal(callsignAffinity('VIPER1', 'HORNET1'), null);
  assert.equal(callsignAffinity('VIPER1', 'VIPE1'), null, 'a truncated stem is a different stem');
});

test('the affinity order is strictly descending, which is what makes it a ladder', () => {
  assert.ok(AFFINITY_EXACT > AFFINITY_FORMATION);
  assert.ok(AFFINITY_FORMATION > AFFINITY_SUFFIXED);
  assert.ok(AFFINITY_SUFFIXED > AFFINITY_SAME_STEM);
});

test('an empty callsign on either side never matches', () => {
  assert.equal(callsignAffinity('', 'VIPER1'), null);
  assert.equal(callsignAffinity('VIPER1', ''), null);
  assert.equal(callsignAffinity(null, null), null);
});

test('edit distance is deliberately not the rule — the two distance-1 cases mean opposite things', () => {
  // VIPER1/VIPER2 (a different flight) and VIPER1/VIPER1A (the same one) are
  // both one edit apart. A threshold cannot tell them apart; the structural
  // rule gives them different answers.
  assert.notEqual(callsignAffinity('VIPER1', 'VIPER2'), callsignAffinity('VIPER1', 'VIPER1A'));
});

// ── the per-tick indices ───────────────────────────────────────────────────

const TRACKS = [
  { id: 1, callsign: 'VIPER11', squawk: 41 },
  { id: 2, callsign: 'VIPER12', squawk: 42 },
  { id: 3, callsign: 'HORNET1', squawk: 41 },   // a duplicate code — structural, not an error
  { id: 4, callsign: 'MAGIC', squawk: null },
  { id: 5, callsign: 'BANDIT', squawk: 8888 },  // not a Mode 3/A code
];

test('buildTrackIndices keys tracks by observed code and by callsign stem', () => {
  const { byBeacon, byStem, byId } = buildTrackIndices(TRACKS);
  assert.deepEqual(byBeacon.get('0042'), ['2']);
  assert.deepEqual(byStem.get('MAGIC'), ['4']);
  assert.equal(byId.get('1').callsign, 'VIPER11');
});

test('a duplicate beacon code lands both tracks under it rather than one winning silently', () => {
  // §3.10.2 rule 7: duplicates are structural and explicitly accepted. Picking
  // a winner here would hide the ambiguity the reconciler has to report.
  const { byBeacon } = buildTrackIndices(TRACKS);
  assert.deepEqual(byBeacon.get('0041').sort(), ['1', '3']);
});

test('two tracks sharing a stem both land under it', () => {
  const { byStem } = buildTrackIndices(TRACKS);
  assert.deepEqual(byStem.get('VIPER').sort(), ['1', '2']);
});

test('a track with no usable code is absent from the beacon index but present by stem', () => {
  const { byBeacon, byStem } = buildTrackIndices(TRACKS);
  for (const ids of byBeacon.values()) {
    assert.ok(!ids.includes('4'), 'MAGIC has no squawk');
    assert.ok(!ids.includes('5'), 'BANDIT squawks something that is not octal');
  }
  assert.deepEqual(byStem.get('BANDIT'), ['5']);
});

test('buildTrackIndices copes with no tracks at all', () => {
  const { byBeacon, byStem, byId } = buildTrackIndices([]);
  assert.equal(byBeacon.size, 0);
  assert.equal(byStem.size, 0);
  assert.equal(byId.size, 0);
  assert.equal(buildTrackIndices(null).byId.size, 0);
});

// ── the load-bearing negative ──────────────────────────────────────────────

test('a squawk-map entry does not change any correlation', async () => {
  // resolveCallsign rewrites display names from config/squawk-map.json, which
  // any connected client can edit live (ws-hub.js's squawkMapSet). If matching
  // read that output, a squadron config edit would silently re-correlate
  // flights — and the callsign rung would stop being independent evidence from
  // the beacon rung. The matcher must not consult it at all.
  const resolve = await import('../src/resolve.js');

  const track = { id: 9, callsign: 'VIPER11', squawk: 41, coalition: 3 };
  const before = resolve.resolveCallsign(track, null, () => 'TN00000');

  assert.equal(resolve.setSquawkMapping('exact', 41, 'SOMETHINGELSE'), true);
  const after = resolve.resolveCallsign(track, null, () => 'TN00000');
  assert.notEqual(after, before, 'the squawk map really did change the display name');
  assert.equal(after, 'SOMETHINGELSE');

  // And the matcher is unmoved: it still matches the raw DCS callsign.
  assert.equal(callsignAffinity('VIPER11', track.callsign), AFFINITY_EXACT);
  assert.equal(callsignAffinity('SOMETHINGELSE', track.callsign), null);
  const { byStem } = buildTrackIndices([track]);
  assert.deepEqual(byStem.get('VIPER'), ['9'], 'indexed by the raw callsign, not the resolved one');

  resolve.deleteSquawkMapping('exact', 41);
});

test('a controller rename does not change any correlation either', () => {
  // Renames come from collab-store.js and also flow through resolveCallsign.
  // Renaming a target on the scope must not re-bind a flight strip.
  const track = { id: 9, callsign: 'VIPER11', squawk: 41 };
  assert.equal(callsignAffinity('VIPER11', track.callsign), AFFINITY_EXACT);
  // The matcher is handed the raw track; there is no path from a rename to it.
  assert.equal(callsignAffinity('SOMEONESRENAME', track.callsign), null);
});
