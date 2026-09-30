import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* §10.5's fallback chains (docs/adr/0073), crc-sync's copy.
 *
 * The cases live in tests/fixtures/time-chains.json, which crc-desktop's
 * tests/efsp-time-chains.test.js reads too: the two copies of time-chains.js
 * are held to the same answers by the same table (T6). */

const here = path.dirname(fileURLToPath(import.meta.url));
const { TIME_CHAINS, resolveTimeChain, timeChainForBlock } = await import('../src/efsp/time-chains.js');
const { cases } = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/time-chains.json'), 'utf8'));

for (const c of cases) {
  test(`time chains: ${c.name}`, () => {
    for (const [name, want] of Object.entries(c.expect)) {
      const got = resolveTimeChain(name, c.fdr);
      assert.deepEqual({ valueUtc: got.valueUtc, source: got.source, via: got.via, estimated: got.estimated }, want, name);
      assert.equal(got.candidates.length, TIME_CHAINS[name].sources.length, name);
    }
  });
}

test('time chains: the three chains, their Blocks and their order', () => {
  assert.deepEqual(TIME_CHAINS.departure.sources, ['CONTROLLER', 'FLIGHT_PLAN', 'ATO']);
  assert.deepEqual(TIME_CHAINS.offBlock.sources, ['CONTROLLER', 'EST_DEPARTURE']);
  assert.deepEqual(TIME_CHAINS.takeoff.sources, ['CONTROLLER', 'EST_OFF_BLOCK']);
  assert.deepEqual(['6', '17', '18', '16', '9'].map(timeChainForBlock), ['departure', 'offBlock', 'takeoff', null, null]);
  assert.equal(resolveTimeChain('nosuch', {}).source, null);
});

test('time chains: candidates say what would apply next', () => {
  const T = Date.UTC(2016, 5, 21, 14, 30);
  const r = resolveTimeChain('departure', { filed: { proposedDepartureTimeUtc: T }, timeInputs: { flightPlanDepartureUtc: null }, ato: { departure: { timeUtc: T - 3600000 } } });
  assert.deepEqual(r.candidates.map(c => [c.source, c.valueUtc]), [['CONTROLLER', T], ['FLIGHT_PLAN', null], ['ATO', T - 3600000]]);
});

test('time chains: no clock of its own (H11) and no requires', () => {
  const src = fs.readFileSync(path.join(here, '../src/efsp/time-chains.js'), 'utf8');
  assert.equal(/Date\.now|new Date\(|require\(/.test(src), false);
});

test('time chains: crc-desktop\'s copy is byte-identical (docs/adr/0001, T6)', () => {
  const ours = fs.readFileSync(path.join(here, '../src/efsp/time-chains.js'), 'utf8');
  const theirs = fs.readFileSync(path.join(here, '../../crc-desktop/app/public/js/panels/efsp/time-chains.js'), 'utf8');
  assert.equal(theirs, ours);
});
