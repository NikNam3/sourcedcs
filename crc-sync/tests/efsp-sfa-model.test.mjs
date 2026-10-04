import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { frequencyForRack, rackForFrequency, isSfaBay } = createRequire(import.meta.url)('../src/efsp/sfa.js');

// The SFA lookups the Board's rules forward to (facility-rules.js sfaFrequencyFor/sfaRackFor), pure.
const SFA = { pool: [{ rackId: 'R1', mhz: 134.1 }, { rackId: 'R2', mhz: 134.2 }] };
const BAY = { view: 'sfa-freqs' };

test('a Rack maps to its pool frequency and back', () => {
  assert.equal(frequencyForRack(BAY, SFA, 'R2'), 134.2);
  assert.equal(rackForFrequency(BAY, SFA, 134.1), 'R1');
});

test('an unknown Rack or frequency, a non-SFA Bay, or no SFA config answers null', () => {
  assert.equal(frequencyForRack(BAY, SFA, 'R9'), null);
  assert.equal(rackForFrequency(BAY, SFA, 1), null);
  assert.equal(frequencyForRack({ view: 'strips' }, SFA, 'R1'), null);
  assert.equal(rackForFrequency(null, SFA, 134.1), null);
  assert.equal(frequencyForRack(BAY, null, 'R1'), null);
  assert.equal(isSfaBay(BAY, SFA), true);
});
