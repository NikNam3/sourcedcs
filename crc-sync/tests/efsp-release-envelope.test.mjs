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

test('with no stereo name filed, a stereoRoute envelope matches only an exact route string', () => {
  // docs/adr/0017's original behaviour, and the fallback docs/adr/0050
  // deliberately keeps: this criterion shipped before a route table existed,
  // so an envelope a squadron configured back then still matches the flight
  // it was written for, and a hand-filed flight is still eligible.
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

// ── §9.10 stereo routes (docs/adr/0050) ──────────────────────────────────

test('once a stereo name is filed, the envelope matches the NAME whatever the expanded route says', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'PACK 1', active: true }];
  const fdr = makeFdr({ filed: { stereoRouteName: 'PACK 1', route: 'LTAG DCT ALPHA DCT LTAG' } });
  assert.equal(matchesStandingRelease(fdr, envelopes), true);
});

test('a filed name that is not the envelope\'s does not match, even when the route would have', () => {
  // The name wins OUTRIGHT — filed.route is not consulted as a second
  // chance. "Match either" would let one flight satisfy two envelopes, and
  // two answers to one question is the defect class, not the fix.
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'DCT', active: true }];
  const fdr = makeFdr({ filed: { stereoRouteName: 'PACK 1', route: 'DCT' } });
  assert.equal(matchesStandingRelease(fdr, envelopes), false);
});

test('an empty stereo name is "no name", not "a name matching nothing" — it falls back to the route', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'DCT', active: true }];
  for (const stereoRouteName of ['', '   ', null, undefined]) {
    assert.equal(matchesStandingRelease(makeFdr({ filed: { stereoRouteName, route: 'DCT' } }), envelopes), true,
      `stereoRouteName ${JSON.stringify(stereoRouteName)} should fall back to the route`);
  }
});

test('name matching still ANDs with the altitude ceiling', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'PACK 1', atOrBelowAltitude: 250, active: true }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { stereoRouteName: 'PACK 1', requestedAltitude: '250' } }), envelopes), true);
  assert.equal(matchesStandingRelease(makeFdr({ filed: { stereoRouteName: 'PACK 1', requestedAltitude: '300' } }), envelopes), false);
});

test('an inactive envelope never matches, name or no name', () => {
  const envelopes = [{ envelopeId: 'e1', stereoRoute: 'PACK 1', active: false }];
  assert.equal(matchesStandingRelease(makeFdr({ filed: { stereoRouteName: 'PACK 1' } }), envelopes), false);
});
