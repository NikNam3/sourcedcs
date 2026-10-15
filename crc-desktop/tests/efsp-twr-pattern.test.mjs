// crc-sync docs/adr/0126 (H149, H150 TWR-Q1 a): no RSU; the tower works the pattern on its ordinary Strips. The client
// half: the two cycle cells (PAT/STR, T&G/FS/LA), the NLA labels the cells steer, the grey IN PATTERN mark and the ⋯ items
// Closed traffic / Leave pattern, each held to crc-sync's own tables.

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as serverConfig from './helpers/server-config.mjs';

import { CYCLE_BLOCKS, isCycleBlock, cycleBlockLabel, nextCycleValue, BLOCK_MAPS } from '../app/public/js/panels/efsp/strip-template.js';
import { ARRIVAL_PATTERN_NLA_LABELS, nlaButtonLabel } from '../app/public/js/panels/efsp/efsp-nla.js';
import { compactBlocksFor } from '../app/public/js/panels/efsp/strip-fields.js';
import {
  PATTERN_POSITION, PATTERN_STATE, PATTERN_CONVERSIONS, patternConversionsFor, patternConversionBlockedBy, stateDisplayLabel,
} from '../app/public/js/panels/efsp/pattern-rules.js';

const require = createRequire(import.meta.url);
const serverOps = require('../../crc-sync/src/efsp/board/ops/pattern.js');
const opKinds = require('../../crc-sync/src/efsp/authority/op-kinds.js');
const arrival = require('../../crc-sync/src/efsp/authority/strip-types/arrival.js');
const permission = serverConfig.permission;

test('the cycle cells offer exactly the values crc-sync accepts, and nothing on any other Block', () => {
  assert.deepEqual(Object.keys(CYCLE_BLOCKS).sort(), ['9J-ENTRY', '9J-OPTION']);
  assert.deepEqual(CYCLE_BLOCKS['9J-ENTRY'].map(([v]) => v), ['PATTERN', 'STRAIGHT_IN']);
  assert.deepEqual(CYCLE_BLOCKS['9J-OPTION'].map(([v]) => v), ['TOUCH_AND_GO', 'FULL_STOP', 'LOW_APPROACH'], 'no stop-and-go (H147 RQ7)');
  assert.deepEqual(arrival.STAYS_AIRBORNE_OPTIONS, ['TOUCH_AND_GO', 'LOW_APPROACH']);
  for (const t of ['DEPARTURE', 'ARRIVAL']) for (const b of ['9J-ENTRY', '9J-OPTION']) assert.ok(BLOCK_MAPS[t][b], `${t} ${b}`);
  assert.equal(isCycleBlock('9E'), false);
});

test('a click steps through the values and back to empty; the cell shows the short form', () => {
  assert.equal(nextCycleValue('9J-ENTRY', null), 'PATTERN');
  assert.equal(nextCycleValue('9J-ENTRY', 'PATTERN'), 'STRAIGHT_IN');
  assert.equal(nextCycleValue('9J-ENTRY', 'STRAIGHT_IN'), '');
  assert.deepEqual(['', 'TOUCH_AND_GO', 'FULL_STOP', 'LOW_APPROACH'].map(v => nextCycleValue('9J-OPTION', v || null)), ['TOUCH_AND_GO', 'FULL_STOP', 'LOW_APPROACH', '']);
  assert.deepEqual(['PATTERN', 'STRAIGHT_IN', null].map(v => cycleBlockLabel('9J-ENTRY', v)), ['PAT', 'STR', '']);
  assert.deepEqual(['TOUCH_AND_GO', 'FULL_STOP', 'LOW_APPROACH'].map(v => cycleBlockLabel('9J-OPTION', v)), ['T&G', 'FS', 'LA']);
});

test('the cells are on LC\'s arrivals and departures and AP\'s arrivals, nowhere else', () => {
  for (const [t, p] of [['ARRIVAL', 'LC'], ['DEPARTURE', 'LC'], ['ARRIVAL', 'AP']]) {
    const list = compactBlocksFor(t, p, null);
    assert.ok(list.includes('9J-ENTRY') && list.includes('9J-OPTION'), `${t} ${p}`);
  }
  for (const [t, p] of [['ARRIVAL', 'GC'], ['DEPARTURE', 'GC'], ['DEPARTURE', 'AP'], ['ARRIVAL', 'CTR'], ['OVERFLIGHT', 'AP']]) {
    assert.equal(compactBlocksFor(t, p, null).includes('9J-ENTRY'), false, `${t} ${p}`);
  }
});

test('the NLA button says what the cells made it: In pattern, On Final, Closed traffic, Landed', () => {
  const s = (state, toState) => ({ stripType: 'ARRIVAL', state, nla: { toState } });
  assert.equal(nlaButtonLabel(s('HANDED_TO_TOWER', 'TRAFFIC_PATTERN')), 'In pattern');
  assert.equal(nlaButtonLabel(s('HANDED_TO_TOWER', 'FINAL')), 'On Final');
  assert.equal(nlaButtonLabel(s('TRAFFIC_PATTERN', 'FINAL')), 'On Final');
  assert.equal(nlaButtonLabel(s('FINAL', 'TRAFFIC_PATTERN')), 'Closed traffic');
  assert.equal(nlaButtonLabel(s('FINAL', 'LANDED')), 'Landed');
  for (const key of Object.keys(ARRIVAL_PATTERN_NLA_LABELS)) {
    const [from, to] = key.split('>');
    assert.ok(arrival.family.states.includes(from) && arrival.family.states.includes(to), key);
  }
});

test('the IN PATTERN mark is the tab\'s state words for TRAFFIC_PATTERN, and only for it', () => {
  assert.equal(PATTERN_STATE, 'TRAFFIC_PATTERN');
  assert.equal(stateDisplayLabel('TRAFFIC_PATTERN'), 'IN PATTERN');
  assert.equal(stateDisplayLabel('HANDED_TO_TOWER'), 'HANDED TO TOWER');
  assert.equal(serverConfig.facilityConfig.getBay('lc-pattern').impliesState, PATTERN_STATE, 'LC\'s Pattern Bay implies it');
});

test('Closed traffic and Leave pattern mirror crc-sync\'s conversions, and only the tower holds them', () => {
  for (const [kind, c] of Object.entries(serverOps.CONVERSIONS)) {
    assert.equal(PATTERN_CONVERSIONS[kind].from, c.from, kind);
    assert.deepEqual(PATTERN_CONVERSIONS[kind].fromStates, c.fromStates, kind);
  }
  assert.deepEqual(Object.keys(PATTERN_CONVERSIONS).sort(), Object.keys(serverOps.CONVERSIONS).sort());
  assert.deepEqual(Object.keys(PATTERN_CONVERSIONS).sort(), [...opKinds.PATTERN_OP_KINDS].sort());
  const holders = Object.keys(permission.PERMISSIONS).filter(p => opKinds.PATTERN_OP_KINDS.some(k => permission.canMutate(p, k)));
  assert.deepEqual(holders, [PATTERN_POSITION]);
});

test('the ⋯ items: offered to LC holding the Strip, in the right state only; an open exchange blocks them', () => {
  const dep = { stripType: 'DEPARTURE', state: 'DEPARTED', ownerPositionId: 'LC' };
  assert.deepEqual(patternConversionsFor(dep, 'LC').map(x => x.label), ['Closed traffic']);
  assert.deepEqual(patternConversionsFor(dep, 'AP'), [], 'acting as another Position');
  assert.deepEqual(patternConversionsFor({ ...dep, state: 'LUAW' }, 'LC'), []);
  assert.deepEqual(patternConversionsFor({ ...dep, state: 'HANDED_OFF', ownerPositionId: 'AP' }, 'AP'), []);
  for (const state of ['TRAFFIC_PATTERN', 'FINAL']) {
    assert.deepEqual(patternConversionsFor({ stripType: 'ARRIVAL', state, ownerPositionId: 'LC' }, 'LC').map(x => x.label), ['Leave pattern'], state);
  }
  assert.deepEqual(patternConversionsFor({ stripType: 'ARRIVAL', state: 'LANDED', ownerPositionId: 'LC' }, 'LC'), []);
  assert.equal(patternConversionBlockedBy({}), '');
  assert.equal(patternConversionBlockedBy({ tofiCoordination: { state: 'ACTIVE' } }), 'active tactical control');
});
