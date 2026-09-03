import { test } from 'node:test';
import assert from 'node:assert/strict';

const { matchesStandingRelease } = await import('../src/efsp/release-envelope.js');

function makeFdr(overrides = {}) {
  return { filed: { route: 'DCT', requestedAltitude: '250', ...overrides.filed } };
}

test('matchesStandingRelease is false for an empty/missing envelope list', () => {
  assert.equal(matchesStandingRelease(makeFdr(), []), false);
  assert.equal(matchesStandingRelease(makeFdr(), undefined), false);
  assert.equal(matchesStandingRelease(null, []), false);
});

test('a stereoRoute envelope matches only an exact route string', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'DCT', active: true }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'DCT' } }), envelopes), true);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'J55' } }), envelopes), false);
});

test('an atOrBelowAltitude envelope matches at or under the ceiling, not above it', () => {
  const envelopes = [{ envelopeId: 'e1', atOrBelowAltitude: 250, active: true }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { requestedAltitude: '250' } }), envelopes), true);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { requestedAltitude: '200' } }), envelopes), true);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { requestedAltitude: '300' } }), envelopes), false);
});

test('a non-numeric requestedAltitude never matches an altitude-gated envelope', () => {
  const envelopes = [{ envelopeId: 'e1', atOrBelowAltitude: 250, active: true }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { requestedAltitude: 'BLOCK' } }), envelopes), false);
});

test('an envelope requires ALL of its specified criteria to match (stereoRoute AND atOrBelowAltitude, when both are set)', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'DCT', atOrBelowAltitude: 250, active: true }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'DCT', requestedAltitude: '250' } }), envelopes), true);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'DCT', requestedAltitude: '300' } }), envelopes), false);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'J55', requestedAltitude: '250' } }), envelopes), false);
});

test('an inactive envelope (active:false) never matches, even with otherwise-matching criteria', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'DCT', active: false }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'DCT' } }), envelopes), false);
});

test('a radiusNm-only envelope never matches — no coordinate data exists to check it against yet (WP5 not built)', () => {
  const envelopes = [{ envelopeId: 'e1', radiusNm: 30, active: true }];
  assert.equal(matchesStandingRelease(makeFdr(), envelopes), false);
});

test('an envelope with no criteria at all matches nothing, not everything', () => {
  const envelopes = [{ envelopeId: 'e1', active: true }];
  assert.equal(matchesStandingRelease(makeFdr(), envelopes), false);
});

test('matches if ANY envelope in the list matches, not just the first', () => {
  const envelopes = [
    { envelopeId: 'e1', stereoRoute: 'NOPE', active: true },
    { envelopeId: 'e2', stereoRoute: 'DCT', active: true },
  ];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { route: 'DCT' } }), envelopes), true);
});
