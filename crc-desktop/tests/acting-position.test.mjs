// Which Position a controller acts as on a Strip it does not hold (bay/dispatch.js, rule 9): only one the rules let act
// beside the Owner for that op (crc-sync permission.js mayActBesideOwner, sent as the snapshot's `nonOwnerBlockWrites`).
// Never "the first Position this controller holds": no match is null, nothing is sent, the cell stays read-only.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { besideOwnerActingPosition } from '../app/public/js/panels/efsp/bay/dispatch.js';
import { permission } from './helpers/server-config.mjs';

const RULES = permission.NON_OWNER_BLOCK_WRITES;
const gcDeparture = { stripId: 's1', stripType: 'DEPARTURE', state: 'TAXI', ownerPositionId: 'GC' };
const setBlock = (blockId) => ({ kind: 'SetBlock', blockId });

test('a Block the rules let a held Position write beside the Owner: that Position, and the server agrees', () => {
  for (const blockId of ['14E', '3G']) {
    assert.equal(besideOwnerActingPosition(gcDeparture, setBlock(blockId), ['CD', 'OPS'], RULES), 'OPS', blockId);
    assert.equal(permission.mayActBesideOwner('OPS', gcDeparture, setBlock(blockId)), true, blockId);
  }
});

test('anything else on a Strip this controller does not hold: null, never the first held Position', () => {
  assert.equal(besideOwnerActingPosition(gcDeparture, setBlock('9E'), ['OPS', 'CD'], RULES), null, 'remarks are the Owner\'s');
  assert.equal(besideOwnerActingPosition(gcDeparture, setBlock('14E'), ['CD', 'LC'], RULES), null, 'no held Position the rule names');
  assert.equal(besideOwnerActingPosition(gcDeparture, { kind: 'InvokeNla' }, ['OPS'], RULES), null, 'not a Block write');
  assert.equal(besideOwnerActingPosition(gcDeparture, null, ['OPS'], RULES), null, 'no op named');
  assert.equal(besideOwnerActingPosition({ ...gcDeparture, state: 'DROPPED' }, setBlock('14E'), ['OPS'], RULES), null, 'dropped');
  assert.equal(besideOwnerActingPosition({ ...gcDeparture, stripType: 'ARRIVAL' }, setBlock('14E'), ['OPS'], RULES), null, 'other strip type');
  assert.equal(besideOwnerActingPosition(gcDeparture, setBlock('14E'), ['OPS'], []), null, 'no snapshot yet');
});
