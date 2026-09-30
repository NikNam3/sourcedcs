import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { parseStructure } = await import('../src/efsp/ato/ato-structure.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/ato/${name}`, import.meta.url), 'utf8');
const notInfo = (ws) => ws.filter((w) => w.severity !== 'info');
const byKey = (doc) => Object.fromEntries(doc.missions.map((m) => [m.missionKey, m]));

test('ato structure: the research fixture (iron-flag-26-3) — header, five missions, no warnings at all', () => {
  const doc = parseStructure(fixture('iron-flag-26-3.txt'));
  assert.equal(doc.fatal, false);
  assert.equal(doc.header.classification, 'UNCLAS');
  assert.deepEqual(doc.header.operation, { kind: 'EXER', name: 'IRON FLAG 26-3' });
  assert.equal(doc.header.msgId.originator, 'SOURCEDCS AOC');
  assert.equal(doc.header.timeframe.fromUtc, Date.UTC(2026, 8, 14, 6, 0));
  assert.equal(doc.header.timeframe.toUtc, Date.UTC(2026, 8, 15, 5, 59));
  assert.deepEqual(doc.missions.map((m) => m.missionKey), ['1101A', '1202S', '1203S', '1901T', '1801W']);
  assert.deepEqual(doc.missions.map((m) => m.taskUnit.unit), ['SOURCE DCS 1', 'SOURCE DCS 2', 'SOURCE DCS 2', '909ARS', '960AACS']);
  assert.deepEqual(doc.missions.map((m) => [m.taskUnit.country, m.taskUnit.service]), Array(5).fill(['US', 'F']));
  assert.deepEqual(doc.warnings, []);
  for (const m of doc.missions) {
    assert.deepEqual(m.warnings, [], m.missionKey);
    for (const a of m.aircraft) assert.deepEqual(a.warnings, [], m.missionKey);
  }
  assert.deepEqual(doc.unmappedSets, []);
});

test('ato structure: package sets stay inside their missions (research §1.3), not at package level', () => {
  const m = byKey(parseStructure(fixture('iron-flag-26-3.txt')));
  assert.equal(m['1202S'].packageRows.length, 2, '9PKGDAT sits in the commander\'s mission');
  assert.equal(m['1203S'].packageCommand.missionNumber, '1202S', 'PKGCMD sits in the member mission');
  assert.deepEqual(m['1202S'].remarks.map((r) => r.set), ['NARR'], 'a NARR after 9PKGDAT stays in the same mission');
  assert.deepEqual(m['1203S'].remarks.map((r) => r.text), ['UNIT REMARKS/SNAKE 41 WEAPONS FREE IN SEAD BOX EAST ONLY']);
});

test('ato structure: AR and control sets land on the right missions', () => {
  const m = byKey(parseStructure(fixture('iron-flag-26-3.txt')));
  assert.equal(m['1101A'].arReceiving[0].tankerMissionNumber, '1901T');
  assert.equal(m['1202S'].arReceiving[0].tankerMissionNumber, '1901T');
  assert.equal(m['1901T'].tanker.reftsk.totalOffloadKlb, 60);
  assert.deepEqual(m['1901T'].tanker.receivers.map((r) => r.receiverMissionNumber), ['1101A', '1202S']);
  assert.deepEqual(m['1801W'].controlledRows.map((r) => r.missionNumber), ['1101A', '1202S', '1203S']);
  assert.equal(m['1202S'].targets.length, 1);
  assert.equal(m['1202S'].location, null);
});

test('ato structure: the Incirlik fixture — six missions, four task units, package AA, no non-info warnings', () => {
  const doc = parseStructure(fixture('incirlik-day1.txt'));
  const m = byKey(doc);
  assert.deepEqual(Object.keys(m), ['0101A', '0103A', '0102A', '0201C', '0501T', '0601W']);
  assert.equal(new Set(doc.missions.map((x) => x.taskUnit.unit)).size, 4);
  assert.equal(m['0101A'].amsndat.isPackageCommander, true);
  assert.deepEqual(m['0101A'].packageRows.map((r) => r.missionNumber), ['0101A', '0102A', '0103A']);
  assert.equal(m['0102A'].packageCommand.missionNumber, '0101A');
  assert.equal(m['0201C'].amsndat.variant, 'B');
  assert.equal(m['0501T'].tanker.receivers.length, 2);
  assert.equal(m['0601W'].controlledRows.length, 3);
  assert.deepEqual(notInfo(doc.warnings), []);
  for (const x of doc.missions) {
    assert.deepEqual(notInfo(x.warnings), [], x.missionKey);
    for (const a of x.aircraft) assert.deepEqual(notInfo(a.warnings), [], x.missionKey);
  }
});

test('ato structure: grouping sets close the open mission; unknown and unmapped sets are listed', () => {
  const doc = parseStructure([
    'TIMEFRAM/FROM:140000ZAPR2026/TO:142359ZAPR2026//',
    'AMSNDAT/N/0001A/-/-/-/CAP//',
    'MSNACFT/1/ACTYP:F16C/A 1//',
    'MTGTLOC/X//',
    'SVCTASK/F//',
    'AMSNLOC/140430ZAPR/140530ZAPR/X/250/1//',
    'FOOBAR/1//',
    'GENTEXT/UNIT REMARKS/HELLO//',
  ].join('\n'));
  assert.equal(doc.missions.length, 1);
  assert.equal(doc.missions[0].location, null);
  assert.deepEqual(doc.missions[0].locationSets, ['MTGTLOC']);
  assert.deepEqual(doc.unmappedSets, [{ name: 'MTGTLOC', line: 4 }, { name: 'FOOBAR', line: 7 }]);
  assert.deepEqual(doc.warnings.map((w) => [w.code, w.line]), [['SET_OUTSIDE_MISSION', 6], ['UNKNOWN_SET', 7]]);
  assert.deepEqual(doc.header.remarks.map((r) => r.text), ['UNIT REMARKS/HELLO']);
});

test('ato structure: a second AMSNLOC or CONTROLA warns and the first wins; repeated GTGTLOC is legal (S-L3a)', () => {
  const doc = parseStructure([
    'TIMEFRAM/FROM:140000ZAPR2026/TO:142359ZAPR2026//',
    'AMSNDAT/N/0001A/-/-/-/STRIKE//',
    'MSNACFT/1/ACTYP:F16C/A 1//',
    'AMSNLOC/140430ZAPR/140530ZAPR/FIRST/250/1//',
    'AMSNLOC/140630ZAPR/140730ZAPR/SECOND/250/1//',
    'GTGTLOC/P/-/NET:140458ZAPR/NLT:140502Z/T1//',
    'GTGTLOC/P/-/NET:140558ZAPR/NLT:140602Z/T2//',
    'CONTROLA/AWAC/MAGIC//',
    'CONTROLA/CRC/OTHER//',
  ].join('\n'));
  const m = doc.missions[0];
  assert.equal(m.location.locationName, 'FIRST');
  assert.equal(m.control.callsign, 'MAGIC');
  assert.equal(m.targets.length, 2);
  assert.deepEqual(m.warnings.filter((w) => w.code === 'DUPLICATE_SET').map((w) => [w.set, w.line]), [['AMSNLOC', 5], ['CONTROLA', 9]]);
});

test('ato structure: an AMSNDAT with no mission number drops its sets without cascading warnings', () => {
  const doc = parseStructure('AMSNDAT/N/-/-/-/-/CAP//\nMSNACFT/1/ACTYP:F16C/A 1//\nAMSNLOC/-/-/X/250/1//\n');
  assert.equal(doc.missions.length, 0);
  assert.deepEqual(doc.warnings.map((w) => w.code), ['NO_TIMEFRAM', 'MISSING_MISSION_NUMBER']);
});
