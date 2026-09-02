import { test } from 'node:test';
import assert from 'node:assert/strict';

const { CodeAllocator, isReserved, isMonitorSet, isValidCodeFormat, RESERVED_CODES } =
  await import('../src/efsp/code-allocator.js');

test('isValidCodeFormat accepts exactly 4 octal digits, rejects everything else', () => {
  assert.equal(isValidCodeFormat('1234'), true);
  assert.equal(isValidCodeFormat('0000'), true);
  assert.equal(isValidCodeFormat('7777'), true);
  assert.equal(isValidCodeFormat('8000'), false); // 8/9 are not octal
  assert.equal(isValidCodeFormat('9999'), false);
  assert.equal(isValidCodeFormat('123'), false);  // too short
  assert.equal(isValidCodeFormat('12345'), false); // too long
  assert.equal(isValidCodeFormat('abcd'), false);
  assert.equal(isValidCodeFormat(''), false);
  assert.equal(isValidCodeFormat(null), false);
  assert.equal(isValidCodeFormat(undefined), false);
});

test('isReserved matches exactly the guide §3.10.2 rule-4 list', () => {
  for (const c of ['0000', '7500', '7600', '7700', '7400', '7777']) {
    assert.equal(isReserved(c), true, c);
  }
  assert.equal(isReserved('1200'), false);
  assert.equal(isReserved('4000'), false); // 4000 is reserved-from-auto-mint but NOT reserved/unassignable
});

test('isMonitorSet matches the unconditional monitor codes, not 4000 (context-dependent)', () => {
  for (const c of ['1200', '1202', '1203', '1255', '1277']) {
    assert.equal(isMonitorSet(c), true, c);
  }
  assert.equal(isMonitorSet('4000'), false); // caller must OR this in when restricted/warning/VR context applies
  assert.equal(isMonitorSet('1234'), false);
});

test('allocate() returns a valid, non-reserved, non-monitor discrete code', () => {
  const alloc = new CodeAllocator();
  const { code, pool } = alloc.allocate('fdr-1');
  assert.equal(pool, 'DISCRETE');
  assert.equal(isValidCodeFormat(code), true);
  assert.equal(isReserved(code), false);
  assert.notEqual(code, '4000'); // excluded from auto-mint, see module comment
  assert.equal(alloc.isAllocated(code), true);
  assert.equal(alloc.holderOf(code), 'fdr-1');
});

test('allocate() never hands out a reserved code', () => {
  const alloc = new CodeAllocator();
  for (let i = 0; i < 500; i++) {
    const { code } = alloc.allocate(`fdr-${i}`);
    assert.equal(isReserved(code), false, code);
  }
});

test('allocate() never hands out 4000 automatically, but two consecutive allocations never collide', () => {
  const alloc = new CodeAllocator();
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const { code } = alloc.allocate(`fdr-${i}`);
    assert.notEqual(code, '4000');
    assert.equal(seen.has(code), false, `duplicate auto-allocated code ${code}`);
    seen.add(code);
  }
});

test('release() frees a code so it can be auto-allocated again', () => {
  const alloc = new CodeAllocator();
  const { code } = alloc.allocate('fdr-1');
  alloc.release(code);
  assert.equal(alloc.isAllocated(code), false);
  assert.equal(alloc.holderOf(code), null);
});

test('validateAssignment rejects malformed input as VALIDATION_ERROR', () => {
  const alloc = new CodeAllocator();
  assert.deepEqual(alloc.validateAssignment('99AB', 'fdr-1'), { ok: false, reason: 'VALIDATION_ERROR' });
  assert.deepEqual(alloc.validateAssignment('123', 'fdr-1'), { ok: false, reason: 'VALIDATION_ERROR' });
});

test('validateAssignment rejects every reserved code as VALIDATION_ERROR, including 7777', () => {
  const alloc = new CodeAllocator();
  for (const c of RESERVED_CODES) {
    assert.deepEqual(alloc.validateAssignment(c, 'fdr-1'), { ok: false, reason: 'VALIDATION_ERROR' }, c);
  }
});

test('validateAssignment never blocks 7777 differently than other reserved codes — it is never offered as an assignment (§3.10.2 rule 5)', () => {
  const alloc = new CodeAllocator();
  const result = alloc.validateAssignment('7777', 'fdr-1');
  assert.equal(result.ok, false);
});

test('validateAssignment accepts an unallocated, non-reserved code cleanly', () => {
  const alloc = new CodeAllocator();
  assert.deepEqual(alloc.validateAssignment('1234', 'fdr-1'), { ok: true });
});

test('validateAssignment accepts 4000 as a valid manual override target (first-class assignable, §3.10.2 rule 6)', () => {
  const alloc = new CodeAllocator();
  assert.deepEqual(alloc.validateAssignment('4000', 'fdr-1'), { ok: true });
});

test('validateAssignment flags — but does not block — a code already held by a different FDR (duplicate, defect D23)', () => {
  const alloc = new CodeAllocator();
  alloc.reassign('fdr-1', '1234', null);
  const result = alloc.validateAssignment('1234', 'fdr-2');
  assert.equal(result.ok, true);
  assert.equal(result.warning, 'DUPLICATE_IGNORED_WARNING');
});

test('validateAssignment does not flag a duplicate warning when the code is already held by the SAME FDR', () => {
  const alloc = new CodeAllocator();
  alloc.reassign('fdr-1', '1234', null);
  const result = alloc.validateAssignment('1234', 'fdr-1');
  assert.deepEqual(result, { ok: true });
});

test('reassign() releases the FDR\'s previous code and takes the new one', () => {
  const alloc = new CodeAllocator();
  alloc.reassign('fdr-1', '1111', null);
  alloc.reassign('fdr-1', '2222', '1111');
  assert.equal(alloc.isAllocated('1111'), false);
  assert.equal(alloc.holderOf('2222'), 'fdr-1');
});

test('reassign() allows two FDRs to hold a duplicate code simultaneously (never blocked)', () => {
  const alloc = new CodeAllocator();
  alloc.reassign('fdr-1', '1234', null);
  alloc.reassign('fdr-2', '1234', null);
  assert.equal(alloc.holderOf('1234'), 'fdr-2'); // last write wins the map entry, both FDRs conceptually "hold" it
});

test('snapshot()/restore() round-trips allocation state', () => {
  const alloc = new CodeAllocator();
  alloc.reassign('fdr-1', '1111', null);
  alloc.reassign('fdr-2', '2222', null);
  const snap = alloc.snapshot();

  const restored = new CodeAllocator();
  restored.restore(snap);
  assert.equal(restored.holderOf('1111'), 'fdr-1');
  assert.equal(restored.holderOf('2222'), 'fdr-2');
});

test('restore() with no prior data (empty/undefined) yields a clean allocator', () => {
  const alloc = new CodeAllocator();
  alloc.restore(undefined);
  assert.equal(alloc.snapshot().length, 0);
});
