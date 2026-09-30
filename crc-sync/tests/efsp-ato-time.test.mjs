import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseDtg, makeResolver } = await import('../src/efsp/ato/usmtf-time.js');

test('ato time: parseDtg reads every DTG form', () => {
  assert.deepEqual(parseDtg('011000ZOCT'), { day: 1, hour: 10, minute: 0, zone: 'Z', month: 9, year: null });
  assert.deepEqual(parseDtg('011000Z'), { day: 1, hour: 10, minute: 0, zone: 'Z', month: null, year: null });
  assert.deepEqual(parseDtg('010600ZOCT1998'), { day: 1, hour: 6, minute: 0, zone: 'Z', month: 9, year: 1998 });
  assert.deepEqual(parseDtg('230600FEB2007'), { day: 23, hour: 6, minute: 0, zone: null, month: 1, year: 2007 });
});

test('ato time: parseDtg rejects impossible values and junk', () => {
  for (const bad of ['321000Z', '012400Z', '011060Z', '001000Z', 'FOO', '', null, 42, '011000ZXYZ', '99XXXXZAPR']) {
    assert.equal(parseDtg(bad), null, String(bad));
  }
});

test('ato time: a full DTG converts directly, in UTC', () => {
  const r = makeResolver({})('140600ZSEP2026');
  assert.equal(r.utc, Date.UTC(2026, 8, 14, 6, 0));
  assert.deepEqual(r.warnings, []);
});

test('ato time: a year-less or month-less DTG takes them from the TIMEFRAM window', () => {
  const res = makeResolver({ fromUtc: Date.UTC(2026, 3, 14, 0, 0), toUtc: Date.UTC(2026, 3, 14, 23, 59) });
  assert.equal(res('140430ZAPR').utc, Date.UTC(2026, 3, 14, 4, 30));
  assert.equal(res('140400Z').utc, Date.UTC(2026, 3, 14, 4, 0));
});

test('ato time: April 30 → May 1 rollover picks the candidate inside the window', () => {
  const res = makeResolver({ fromUtc: Date.UTC(2026, 3, 30, 6, 0), toUtc: Date.UTC(2026, 4, 1, 5, 59) });
  assert.equal(res('300900Z').utc, Date.UTC(2026, 3, 30, 9, 0));
  assert.equal(res('010300Z').utc, Date.UTC(2026, 4, 1, 3, 0));
});

test('ato time: December → January rollover crosses the year', () => {
  const res = makeResolver({ fromUtc: Date.UTC(2026, 11, 31, 6, 0), toUtc: Date.UTC(2027, 0, 1, 5, 59) });
  assert.equal(res('010200Z').utc, Date.UTC(2027, 0, 1, 2, 0));
  assert.equal(res('010200ZJAN').utc, Date.UTC(2027, 0, 1, 2, 0));
  assert.equal(res('312200ZDEC').utc, Date.UTC(2026, 11, 31, 22, 0));
});

test('ato time: outside the window, the candidate nearest its midpoint wins', () => {
  const res = makeResolver({ fromUtc: Date.UTC(2026, 3, 14, 0, 0), toUtc: Date.UTC(2026, 3, 14, 23, 59) });
  assert.equal(res('160100Z').utc, Date.UTC(2026, 3, 16, 1, 0));
});

test('ato time: an explicit referenceUtc stands in for a missing TIMEFRAM', () => {
  const res = makeResolver({ referenceUtc: Date.UTC(2026, 3, 14) });
  assert.equal(res('140600Z').utc, Date.UTC(2026, 3, 14, 6, 0));
});

test('ato time: with no window and no referenceUtc a partial DTG is null with TIME_UNRESOLVED', () => {
  const res = makeResolver({});
  for (const raw of ['140600Z', '140600ZAPR']) {
    const r = res(raw);
    assert.equal(r.utc, null);
    assert.deepEqual(r.warnings.map((w) => w.code), ['TIME_UNRESOLVED']);
  }
});

test('ato time: a non-Zulu zone is not converted', () => {
  const r = makeResolver({ referenceUtc: Date.UTC(2026, 3, 14) })('140600J');
  assert.equal(r.utc, null);
  assert.deepEqual(r.warnings.map((w) => w.code), ['NON_ZULU_TIME']);
});

test('ato time: junk is TIME_UNPARSEABLE; an empty value is silently null', () => {
  const res = makeResolver({ referenceUtc: Date.UTC(2026, 3, 14) });
  assert.deepEqual(res('99XXXXZAPR').warnings.map((w) => w.code), ['TIME_UNPARSEABLE']);
  assert.deepEqual(res('310600ZAPR2026').warnings.map((w) => w.code), ['TIME_UNPARSEABLE']);
  assert.deepEqual(res(null), { utc: null, raw: null, warnings: [] });
});
