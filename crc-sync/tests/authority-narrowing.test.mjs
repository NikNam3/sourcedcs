// authority/narrowing.js: the rules that narrow a grant on facility data, moved out of the runway-status and SFA
// stores (AUDIT-GAPS item 2). Refusal texts are the stores' old ones, byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authority = require('../src/efsp/authority');

test('runwayInspectionRefusal: no named authority allows anyone; a named one allows only that Position', () => {
  assert.equal(authority.runwayInspectionRefusal('GC', {}), null);
  assert.equal(authority.runwayInspectionRefusal('GC', { inspectionAuthorityPositionId: null }), null);
  assert.equal(authority.runwayInspectionRefusal('OPS', { inspectionAuthorityPositionId: 'OPS' }), null);
  assert.deepEqual(authority.runwayInspectionRefusal('GC', { inspectionAuthorityPositionId: 'OPS' }),
    { ok: false, reason: 'PERMISSION_DENIED', detail: 'only OPS may sign off a runway inspection here' });
});

test('selfCoordinationRefusal: Primary on every required acknowledger, else names the ones that are not', () => {
  const primary = { LC: 'u1', GC: 'u2', AP: 'u1' };
  const primaryOf = (p) => primary[p] || null;
  assert.equal(authority.selfCoordinationRefusal([], primaryOf, 'u1'), null);
  assert.equal(authority.selfCoordinationRefusal(['LC', 'AP'], primaryOf, 'u1'), null);
  assert.deepEqual(authority.selfCoordinationRefusal(['LC', 'GC', 'AP'], primaryOf, 'u1'),
    { ok: false, reason: 'PERMISSION_DENIED', detail: 'a self-coordinated runway change needs you Primary at GC — ask for the acknowledgement instead' });
  assert.match(authority.selfCoordinationRefusal(['GC', 'AP'], primaryOf, 'u3').detail, /Primary at GC and AP —/);
});

test('sfaJurisdictionRefusal: the capability ceiling and the configured jurisdiction must both hold', () => {
  const config = { jurisdiction: 'AP' };
  const rotators = ['AP', 'GC', 'LC', 'CD', 'OPS', 'TAC'].filter(p => authority.sfaJurisdictionRefusal(p, { jurisdiction: p }) === null);
  assert.ok(rotators.length > 0, 'some Position can rotate the SFA');
  const refusal = authority.sfaJurisdictionRefusal('NOBODY', config);
  assert.deepEqual(refusal, { ok: false, reason: 'PERMISSION_DENIED', detail: 'AP holds jurisdiction over the SFA rotation (guide §4.7), not NOBODY' });
  // a capable Position that is not the jurisdiction is refused too
  const capable = rotators[0];
  assert.equal(authority.sfaJurisdictionRefusal(capable, { jurisdiction: capable }), null);
  assert.equal(authority.sfaJurisdictionRefusal(capable, { jurisdiction: 'ELSEWHERE' }).reason, 'PERMISSION_DENIED');
});
