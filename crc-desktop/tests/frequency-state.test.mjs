/* The FREQUENCIES panel's model (frequency-state.js, crc-sync docs/adr/0131) and its drift test against crc-sync's
 * frequency-table.js: the client's input check must refuse exactly what the server refuses. */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as fs from '../app/public/js/panels/efsp/frequency-state.js';
import * as state from '../app/public/js/panels/efsp/efsp-state.js';

const require = createRequire(import.meta.url);
const server = require(path.join(import.meta.dirname, '../../crc-sync/src/efsp/frequency-table.js'));
const airspaceSchema = require(path.join(import.meta.dirname, '../../crc-sync/src/efsp/airspace-schema.js'));
const facilitySchema = require(path.join(import.meta.dirname, '../../crc-sync/src/efsp/facility-schema.js'));

const ROWS = [
  { facilityId: 'INCIRLIK', kind: 'POSITION', positionId: 'GC', label: 'GND', mhz: 275.925, defaultMhz: 275.8, setAt: Date.UTC(2026, 9, 17, 14, 32), setBy: 'Viper' },
  { facilityId: 'INCIRLIK', kind: 'POSITION', positionId: 'LC', label: 'TWR', mhz: 251, defaultMhz: 251, setAt: null, setBy: null },
  { facilityId: 'INCIRLIK', kind: 'SFA', rackId: 'freq-1', use: 'INITIAL_CONTACT', mhz: 232.1, defaultMhz: 232.1, setAt: null, setBy: null },
  { facilityId: 'INCIRLIK', kind: 'SFA', rackId: 'freq-2', use: 'ROTATION', mhz: 240.25, defaultMhz: 233.1, setAt: 1, setBy: 'Viper' },
];

test('the limits are crc-sync\'s', () => {
  assert.equal(fs.FREQUENCY_LIMITS.min, airspaceSchema.MIN_FREQUENCY_MHZ);
  assert.equal(fs.FREQUENCY_LIMITS.max, airspaceSchema.MAX_FREQUENCY_MHZ);
  assert.equal(fs.FREQUENCY_LIMITS.sfaMin, facilitySchema.SFA_MIN_MHZ);
  assert.equal(fs.FREQUENCY_LIMITS.sfaMax, facilitySchema.SFA_MAX_MHZ);
});

test('the channel check agrees with crc-sync\'s over a sweep of values', () => {
  const samples = [];
  for (let khz = 117900; khz <= 137100; khz += 5) samples.push(khz / 1000);
  for (let khz = 224900; khz <= 400000; khz += 5) samples.push(khz / 1000);
  samples.push(30, 30.025, 87.975, 251.0001, 275.8, 118.0125);
  for (const mhz of samples) {
    assert.equal(fs.frequencyChannelProblem(mhz) === null, server.channelProblem(mhz) === null, `${mhz}`);
  }
});

test('parseFrequencyInput agrees with the server on what it accepts', () => {
  const position = ROWS[0];
  const sfa = ROWS[3];
  for (const text of ['275.8', '275.800', '275,8', '29.9', '400.025', '275.81', '118.005', '118.02', '251', 'abc', '', '1275.8']) {
    const c = fs.parseFrequencyInput(text, position);
    const mhz = Number(String(text).replace(',', '.'));
    const serverOk = text !== '' && Number.isFinite(mhz) && /^\d{2,3}(\.\d{1,3})?$/.test(String(text).replace(',', '.')) && server.positionFrequencyProblem(mhz) === null;
    assert.equal(!c.error, serverOk, `position ${JSON.stringify(text)}: ${c.error}`);
  }
  for (const text of ['240.250', '226', '224.975', '399.975', '127.5', '240.26']) {
    const c = fs.parseFrequencyInput(text, sfa, []);
    assert.equal(!c.error, server.sfaFrequencyProblem(Number(text)) === null, `sfa ${text}: ${c.error}`);
  }
  assert.match(fs.parseFrequencyInput('232.1', sfa, ROWS.filter(r => r.kind === 'SFA')).error, /already freq-1/);
  assert.deepEqual(fs.parseFrequencyInput(' 276,1 ', position), { mhz: 276.1 });
});

test('the ops are the ones crc-sync takes', () => {
  assert.deepEqual(fs.setFrequencyOp(ROWS[0], 276), { kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 276 });
  assert.deepEqual(fs.setFrequencyOp(ROWS[3], 241), { kind: 'SetFrequency', rackId: 'freq-2', mhz: 241 });
  assert.deepEqual(fs.resetFrequencyOp(ROWS[0]), { kind: 'ResetFrequency', positionId: 'GC', label: 'GND' });
  assert.deepEqual(fs.resetFrequencyOp(ROWS[3]), { kind: 'ResetFrequency', rackId: 'freq-2' });
  for (const op of [fs.setFrequencyOp(ROWS[0], 1), fs.resetFrequencyOp(ROWS[3])]) assert.ok(server.OP_KINDS.includes(op.kind));
});

test('sections group by Facility and Position, the SFA pool last; a set row carries its note', () => {
  const sections = fs.frequencySections(ROWS);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].positions.map(p => [p.positionId, p.rows.map(r => r.label)]), [['GC', ['GND']], ['LC', ['TWR']]]);
  assert.deepEqual(sections[0].sfa.map(r => fs.frequencyRowName(r)), ['freq-1 INITIAL CONTACT', 'freq-2 ROTATION']);
  assert.equal(fs.isFrequencySet(ROWS[0]), true);
  assert.equal(fs.isFrequencySet(ROWS[1]), false);
  assert.equal(fs.frequencySetNote(ROWS[0]), 'default 275.800 · Viper 1432Z');
  assert.equal(fs.frequencySetNote(ROWS[1]), '');
  assert.equal(fs.frequencyRowKey(ROWS[3]), 'INCIRLIK/SFA/freq-2');
});

test('a delta replaces one Facility\'s rows and moves the Positions\' frequencies and the SFA Bay\'s pool', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({
    facilities: ['INCIRLIK'],
    positions: [{ positionId: 'GC', facilityId: 'INCIRLIK', frequencies: [{ label: 'GND', mhz: 275.8 }] }, { positionId: 'CTR', facilityId: 'CENTER', frequencies: [] }],
    bays: [{ bayId: 'ap-sfa', view: 'sfa-freqs', facilityId: 'INCIRLIK', positionId: 'AP', sfaPool: [{ rackId: 'freq-1', mhz: 232.1, use: 'INITIAL_CONTACT' }, { rackId: 'freq-2', mhz: 233.1, use: 'ROTATION' }] }],
    frequencies: [{ ...ROWS[0], mhz: 275.8, setAt: null, setBy: null }, { facilityId: 'CENTER', kind: 'POSITION', positionId: 'CTR', label: 'CTR', mhz: 300, defaultMhz: 300 }],
  });
  assert.equal(fs.getFrequencyRows().length, 2);
  state.applyEfspFrequencyDelta({ type: 'efsp-frequency-delta', facilityId: 'INCIRLIK', frequencies: ROWS });
  assert.equal(fs.getFrequencyRows('INCIRLIK').length, 4);
  assert.equal(fs.getFrequencyRows('CENTER').length, 1, 'another Facility\'s rows stay');
  assert.deepEqual(state.getEfspPosition('GC').frequencies, [{ label: 'GND', mhz: 275.925 }]);
  assert.deepEqual(state.getEfspBays()[0].sfaPool.map(p => p.mhz), [232.1, 240.25]);
  assert.deepEqual(fs.positionFrequenciesOf(ROWS, 'INCIRLIK'), { GC: [{ label: 'GND', mhz: 275.925 }], LC: [{ label: 'TWR', mhz: 251 }] });
  assert.equal(fs.sfaPoolOf(ROWS, 'CENTER'), null);
  state._resetEfspStateForTest();
  assert.deepEqual(fs.getFrequencyRows(), []);
});

// ── run-time rows (crc-sync docs/adr/0138) ──────────────────────────────────────────────────────────────────────────

const ADDED = { facilityId: 'INCIRLIK', kind: 'POSITION', positionId: 'CD', label: 'CLR', mhz: 251.65, defaultMhz: null, added: true, setAt: Date.UTC(2026, 9, 17, 14, 32), setBy: 'Viper' };
const ADDED_SFA = { facilityId: 'INCIRLIK', kind: 'SFA', rackId: 'freq-6', use: 'SPARE', mhz: 237.1, defaultMhz: null, added: true, setAt: 1, setBy: 'Viper' };

test('an added row is SET, its note says added, and its ops are the ones crc-sync takes', () => {
  assert.equal(fs.isFrequencySet(ADDED), true);
  assert.equal(fs.isFrequencyAdded(ADDED), true);
  assert.equal(fs.isFrequencyAdded(ROWS[0]), false);
  assert.equal(fs.frequencySetNote(ADDED), 'added · Viper 1432Z');
  assert.deepEqual(fs.removeFrequencyOp(ADDED), { kind: 'RemoveFrequency', positionId: 'CD', label: 'CLR' });
  assert.deepEqual(fs.removeFrequencyOp(ADDED_SFA), { kind: 'RemoveFrequency', rackId: 'freq-6' });
  assert.deepEqual(fs.addFrequencyOp('CD', 'CLR', 251.65), { kind: 'AddFrequency', positionId: 'CD', label: 'CLR', mhz: 251.65 });
  assert.deepEqual(fs.addFrequencyOp(null, null, 237.1), { kind: 'AddFrequency', sfa: true, mhz: 237.1 });
  for (const op of [fs.removeFrequencyOp(ADDED), fs.addFrequencyOp(null, null, 1)]) assert.ok(server.OP_KINDS.includes(op.kind));
  // crc-sync names the row an SFA add made by its frequency.
  assert.equal(server.rowMatchesOp(ADDED_SFA, fs.addFrequencyOp(null, null, 237.1)), true);
});

test('parseFrequencyLabel agrees with crc-sync\'s label rule', () => {
  for (const text of ['GND', 'clr', ' TWR 2 ', '', '   ', 'ABCDEFGHIJKL', 'ABCDEFGHIJKLM']) {
    const c = fs.parseFrequencyLabel(text);
    assert.equal(!c.error, server.labelProblem(String(text).trim().toUpperCase()) === null, `${JSON.stringify(text)}: ${c.error}`);
  }
  assert.deepEqual(fs.parseFrequencyLabel(' clr '), { label: 'CLR' });
  assert.match(fs.parseFrequencyLabel('gnd', ['GND']).error, /already/);
  assert.equal(fs.FREQUENCY_LABEL_MAX, 12);
});

test('a delta adds and removes the SFA Bay\'s Racks with the pool, and empties a Position whose added row went', () => {
  state._resetEfspStateForTest();
  const pool = ROWS.filter(r => r.kind === 'SFA');
  state.applyEfspSnapshot({
    facilities: ['INCIRLIK'],
    positions: [{ positionId: 'CD', facilityId: 'INCIRLIK', frequencies: [] }],
    bays: [{ bayId: 'ap-sfa', view: 'sfa-freqs', facilityId: 'INCIRLIK', positionId: 'AP', rackIds: ['freq-1', 'freq-2'], sfaPool: pool.map(r => ({ rackId: r.rackId, mhz: r.mhz, use: r.use })) }],
    frequencies: pool,
  });
  state.applyEfspFrequencyDelta({ type: 'efsp-frequency-delta', facilityId: 'INCIRLIK', frequencies: [...pool, ADDED, ADDED_SFA] });
  assert.deepEqual(state.getEfspBays()[0].rackIds, ['freq-1', 'freq-2', 'freq-6']);
  assert.deepEqual(state.getEfspPosition('CD').frequencies, [{ label: 'CLR', mhz: 251.65 }]);
  state.applyEfspFrequencyDelta({ type: 'efsp-frequency-delta', facilityId: 'INCIRLIK', frequencies: pool });
  assert.deepEqual(state.getEfspBays()[0].rackIds, ['freq-1', 'freq-2']);
  assert.deepEqual(state.getEfspPosition('CD').frequencies, []);
  state._resetEfspStateForTest();
});
