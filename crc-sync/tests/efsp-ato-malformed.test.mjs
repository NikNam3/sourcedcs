import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { ingestAtoText, collectWarnings } = await import('../src/efsp/ato/ato-ingest.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');

// The repository normalises line endings (`* text=auto`), so the fixture is
// stored with LF. The briefing asks for this ATO to be read with CRLF, so the
// test builds that form itself — the line numbers below must still come out
// right.
const TEXT = readFileSync(new URL('./fixtures/ato/malformed.txt', import.meta.url), 'utf8').replace(/\r?\n/g, '\r\n');

// [line, code, severity] — the L3 briefing's §7.2 table.
const EXPECTED = [
  [2, 'SET_OUTSIDE_MISSION', 'warning'],
  [4, 'CALLSIGN_INVALID', 'warning'],
  [5, 'TIME_UNRESOLVED', 'warning'],
  [7, 'BAD_AIRCRAFT_COUNT', 'warning'],
  [7, 'IFF_MALFORMED', 'warning'],
  [7, 'MODE3_RESERVED', 'warning'],
  [8, 'TIME_UNPARSEABLE', 'warning'],
  [8, 'BAD_ALTITUDE', 'warning'],
  [9, 'UNKNOWN_AGENCY_TYPE', 'warning'],
  [9, 'BAD_FREQUENCY', 'warning'],
  [10, 'UNKNOWN_SET', 'info'],
  [11, 'MISSING_MSNACFT', 'warning'],
  [13, 'MODE3_SYNTHETIC', 'warning'],
  [15, 'DUPLICATE_MISSION_NUMBER', 'warning'],
  [19, 'AR_RECEIVER_NOT_IN_ATO', 'info'],
  [22, 'UNTERMINATED_SET', 'warning'],
];

// Reported beyond the briefing's table, and defensible (see docs/wip/L3.md):
// year-less DTGs with no TIMEFRAM cannot resolve either; the 9-field AMSNDAT
// layout is flagged as the fallback reading; missions without a location set.
const EXTRA_ALLOWED = new Set(['TIME_UNRESOLVED', 'AMSNDAT_VARIANT_A', 'NO_LOCATION_SET', 'NO_TIMEFRAM']);

const triples = (r) => collectWarnings(r).map((w) => [w.line, w.code, w.severity]);

test('ato malformed: every expected warning appears on its line, and nothing throws', () => {
  const r = ingestAtoText(TEXT);
  assert.equal(r.ok, true, 'some missions survived');
  const got = triples(r);
  for (const want of EXPECTED) {
    assert.ok(got.some((g) => g[0] === want[0] && g[1] === want[1] && g[2] === want[2]), `missing ${want.join(' ')}`);
  }
  for (const g of got) {
    const listed = EXPECTED.some((w) => w[0] === g[0] && w[1] === g[1]);
    assert.ok(listed || EXTRA_ALLOWED.has(g[1]), `unexpected ${g.join(' ')}`);
  }
  assert.equal(got.filter((g) => g[0] === 5 && g[1] === 'TIME_UNRESOLVED').length, 2);
  assert.ok(!got.some((g) => g[1] === 'INTERNAL_ERROR'));
});

test('ato malformed: with a referenceUtc, line 5 resolves and raises VUL_END_BEFORE_START instead', () => {
  const r = ingestAtoText(TEXT, { referenceUtc: Date.UTC(2026, 3, 14) });
  const got = triples(r);
  assert.ok(got.some((g) => g[0] === 5 && g[1] === 'VUL_END_BEFORE_START'));
  assert.ok(!got.some((g) => g[0] === 5 && g[1] === 'TIME_UNRESOLVED'));
  const weasel = r.missionLines.find((l) => l.lineId === '0701A#0');
  assert.equal(weasel.fdrSeed.vulWindowStartUtc, Date.UTC(2026, 3, 14, 6, 0), 'both values kept, not "fixed"');
  assert.equal(weasel.fdrSeed.vulWindowEndUtc, Date.UTC(2026, 3, 14, 5, 0));
});

test('ato malformed: the good missions survive, seedable', () => {
  const r = ingestAtoText(TEXT);
  const by = Object.fromEntries(r.missionLines.map((l) => [l.extras.ato.callsignRaw, l]));
  assert.deepEqual(Object.keys(by), ['WEASEL 31', 'HAWK 21', 'COLT 51', 'COLT 61', 'VIPER 99']);
  assert.ok(!('ORPHAN 1' in by), 'an MSNACFT before any AMSNDAT produces no line');
  for (const cs of ['COLT 51', 'COLT 61', 'VIPER 99', 'HAWK 21']) {
    assert.equal(by[cs].extras.ato.seedable, true, cs);
    assert.equal(new FdrStore().createFdr(by[cs].fdrSeed, { by: 'ato-test' }).ok, true, cs);
  }
  assert.equal(by['WEASEL 31'].extras.ato.seedable, false);
  assert.equal(by['WEASEL 31'].fdrSeed.callsign, null);
  assert.deepEqual(by['WEASEL 31'].extras.ato.missingAcceptanceFields.slice(0, 1), ['callsign']);
  assert.equal(by['HAWK 21'].extras.identityAto.modeThree, '7700');
  assert.equal(by['HAWK 21'].extras.identityAto.modeTwo, null);
  assert.equal(by['HAWK 21'].fdrSeed.flightSize, 1);
  assert.equal(by['COLT 61'].lineId, '0704A~2#0');
  assert.equal(by['COLT 51'].lineId, '0704A#0');
  assert.equal(by['VIPER 99'].extras.identityAto.modeThree, '4705', 'the unterminated set is still read');
  // The AMPN on line 20 is one remark, slash and all (it sits in mission 0704A~2).
  assert.deepEqual(by['COLT 61'].extras.ato.remarks, ['FREE TEXT WITH A / SLASH INSIDE']);
});

test('ato malformed: text that is only garbage is ok:false with a warning', () => {
  const r = ingestAtoText('this is not\nan ATO at all ///\n\u0000\u0001');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missionLines, []);
  assert.ok(r.warnings.length >= 1);
  assert.ok(r.warnings.some((w) => w.code === 'NO_MISSIONS'));
});
