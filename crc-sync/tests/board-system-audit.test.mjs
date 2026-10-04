// BoardAudit#recordSystem: the three families of system entry (SystemCoordinationEnd, SystemReassign, Archive)
// write the same JSONL line, key order included, as the inline `record` calls they replaced (AUDIT-GAPS item 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BoardAudit } = require('../src/efsp/board/audit.js');

const strip = { stripId: 's1', flightDataId: 'fd1', state: 'DROPPED' };
const before = { stripId: 's1', rev: 1 };
const after = { stripId: 's1', rev: 2 };

function build(facilityId) {
  const lines = [];
  const audit = new BoardAudit({ rules: { facilityId }, clock: { now: () => 1234 }, mutationLog: { record: (e) => lines.push(JSON.stringify(e)) } });
  return { audit, lines };
}

test('SystemReassign and SystemCoordinationEnd keep facilityId before flightDataId', () => {
  const { audit, lines } = build('INCIRLIK');
  audit.recordSystem('SystemReassign', strip, { before, after, reason: 'position-vacated' });
  audit.recordSystem('SystemCoordinationEnd', strip, { before, after, reason: 'peer-dropped', causedBy: 'c9' });
  assert.equal(lines[0], JSON.stringify({
    clientMutationId: null, op: 'SystemReassign', stripId: 's1',
    facilityId: 'INCIRLIK', flightDataId: 'fd1',
    actingPositionId: null, actorId: 'system', at: 1234,
    before, after, reason: 'position-vacated',
  }));
  assert.equal(lines[1], JSON.stringify({
    clientMutationId: null, op: 'SystemCoordinationEnd', stripId: 's1',
    facilityId: 'INCIRLIK', flightDataId: 'fd1',
    actingPositionId: null, actorId: 'system', at: 1234,
    before, after, reason: 'peer-dropped', causedBy: 'c9',
  }));
});

test('Archive keeps flightDataId before facilityId, and the extra fields after reason', () => {
  const { audit, lines } = build('INCIRLIK');
  audit.recordSystem('Archive', strip, { reason: 'AGE', session: 'x' }, { flightDataFirst: true });
  assert.equal(lines[0], JSON.stringify({
    clientMutationId: null, op: 'Archive', stripId: 's1', flightDataId: 'fd1',
    facilityId: 'INCIRLIK',
    actingPositionId: null, actorId: 'system', at: 1234, reason: 'AGE', session: 'x',
  }));
});

test('a Strip without flight data, and a Board without a facility id, write null', () => {
  const { audit, lines } = build(undefined);
  audit.recordSystem('SystemReassign', { stripId: 's2' }, { reason: 'position-retaken' });
  const e = JSON.parse(lines[0]);
  assert.equal(e.facilityId, null);
  assert.equal(e.flightDataId, null);
});

test('no Mutation log, no entry and no throw', () => {
  const audit = new BoardAudit({ rules: {}, clock: { now: () => 1 }, mutationLog: null });
  assert.doesNotThrow(() => audit.recordSystem('Archive', strip, {}));
});
