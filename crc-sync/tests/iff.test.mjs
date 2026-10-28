import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIff, IFF_STATES } from '../src/surveillance/iff.js';
import { checkOnGround } from '../src/geo.js';

// docs/adr/0066 — the colour is what the interrogation got back. classifyIff
// takes answers, never a track, so it cannot read the DCS coalition.

test("classifyIff: a controller's declaration beats every answer", () => {
  assert.equal(classifyIff({ declared: 'hostile', datalink: true, mode4: true, mode3: true }), 'hostile');
  assert.equal(classifyIff({ declared: 'friendly' }), 'friendly', 'declared friendly with no answer at all');
});

test('classifyIff: a datalink report is friendly', () => {
  assert.equal(classifyIff({ datalink: true }), 'friendly');
});

test('classifyIff: a valid Mode 4 reply is friendly', () => {
  assert.equal(classifyIff({ mode4: true }), 'friendly');
  assert.equal(classifyIff({ mode4: true, mode3: true }), 'friendly');
});

test('classifyIff: a Mode 3/C reply without Mode 4 is neutral, not friendly', () => {
  assert.equal(classifyIff({ mode3: true }), 'neutral');
});

test('classifyIff: no answer (interrogated and silent, or never asked) is a bogey', () => {
  assert.equal(classifyIff({}), 'bogey');
  assert.equal(classifyIff(), 'bogey');
  assert.equal(classifyIff({ declared: null, datalink: false, mode4: false, mode3: false }), 'bogey');
});

test('classifyIff: automatic IFF never says bandit or hostile; every result is a known state', () => {
  for (const datalink of [false, true]) for (const mode4 of [false, true]) for (const mode3 of [false, true]) {
    const s = classifyIff({ datalink, mode4, mode3 });
    assert.ok(IFF_STATES.includes(s), s);
    assert.ok(s !== 'bandit' && s !== 'hostile', s);
  }
});

test('checkOnGround requires both proximity and low AGL', () => {
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 500 }] };
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 5000 }, missionData), false);
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 520 }, missionData), true);
});
