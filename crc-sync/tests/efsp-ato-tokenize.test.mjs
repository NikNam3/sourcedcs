import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tokenize, MAX_INPUT_BYTES } = await import('../src/efsp/ato/usmtf-tokenize.js');

const one = (text) => {
  const r = tokenize(text);
  assert.equal(r.sets.length, 1, JSON.stringify(r));
  return r.sets[0];
};
const codes = (r) => r.warnings.map((w) => w.code);

// Every wiki / research example (docs/parallel/research/usmtf-ato.md §1.5),
// tokenised to the field count the example actually has.
test('ato tokenize: every published example splits to its field count', () => {
  const cases = [
    ['MSGID/ATO/USCENTCOM/ATO A/OCT/CHG/1//', 6],
    ['OPER/505th TRS TRAINING//', 1],
    ['AKNLDG/NO//', 1],
    ['TIMEFRAM/FROM:010600ZOCT1998/TO:020559ZOCT1998/ASOF:302100ZSEP1998//', 3],
    ['TASKUNIT/1FW/ICAO:LLKA//', 2],
    ['AMSNDAT/0121C/-/AAF/MC/BARCAP/-/-/DEPLOC:LBNA/ARRLOC:LLKA//', 9],
    ['AMSNDAT/N/0121C/-/AAF/-/BRCAP/-/ /DEPLOC:LBNA/010715ZOCT/ARRLOC:LLKA/010815ZOCT//', 12],
    ['MSNACFT/4/ACTYP:F15C/EAGLE 21/2IR6RK/BEST/-/27/-/20001/30111//', 10],
    ['AMSNLOC/011000ZOCT/011200ZOCT/SEIRAQ/260/1//', 5],
    ['CONTROLA/AWAC/DARKSTAR/PDESIG:GREEN/SDESIG:WHITE/DR01/NAME:JIM//', 6],
    ['ARINFO/APPLE 20/4010A/B:34010/NAME:BLUE TRACK/200/ARCT:011000Z/NDAR:011015ZOCT/KLBS:30.0/PFREQ:343.3/SFREQ:277.8/AE20/ACTYP:KC10/BOM/2/TNKR:2/18-81/2-2-4//', 17],
    ['REFTSK/CDT/KLBS:50.0/KLBS:20.0/PFREQ:323.3/SFREQ:242.8/29-92/3-3-4//', 7],
    ['PKGCMD/AN/CVN68 VA-165/0111I/TALON 11//', 4],
  ];
  for (const [text, count] of cases) {
    const s = one(text);
    assert.equal(s.kind, 'linear');
    assert.equal(s.fields.length, count, text);
    assert.equal(s.terminated, true);
  }
});

test('ato tokenize: descriptors split; DTGs and coordinates stay bare; - and space are empty', () => {
  const s = one('AMSNDAT/N/0121C/-/AAF/-/BRCAP/-/ /DEPLOC:LBNA/010715ZOCT/ARRLOC:LLKA/010815ZOCT//');
  assert.equal(s.name, 'AMSNDAT');
  assert.deepEqual(s.fields[8], { raw: 'DEPLOC:LBNA', value: 'LBNA', key: 'DEPLOC', empty: false });
  assert.equal(s.fields[9].key, null);
  assert.equal(s.fields[9].value, '010715ZOCT');
  assert.equal(s.fields[2].empty, true);
  assert.equal(s.fields[2].value, null);
  assert.equal(s.fields[7].empty, true, 'a space is empty');
  const c = one('7CONTROL\n/MSNNO /ACSIGN /NO/ACTYPE /MSNTY /TOSTA /RIP\n/0111I /TALON 11 /3/AC:A6E /INT /010930Z /2840N08040W//');
  const row = c.rows[0].fields;
  assert.equal(row[6].value, '2840N08040W');
  assert.equal(row[6].key, null);
  assert.deepEqual([row[3].key, row[3].value], ['AC', 'A6E']);
});

test('ato tokenize: a wrapped linear set is joined inside the field', () => {
  const s = one('TIMEFRAM/FROM:140600ZSEP2026/TO:150559ZSEP2026/\n     ASOF:131800ZSEP2026//');
  assert.equal(s.fields.length, 3);
  assert.equal(s.fields[2].key, 'ASOF');
  const w = one('ARINFO/SHELL 71/1901T/34571/NAME:BLUE \n     TRACK/220//');
  assert.equal(w.fields[3].value, 'BLUE TRACK', 'the space before the break is kept, the indent is dropped');
  assert.equal(w.line, 1);
  assert.equal(w.endLine, 2);
});

test('ato tokenize: a columnar set with a padded header maps rows; the header is upper-cased', () => {
  const s = one('5REFUEL\n/MSNNO /RECCS    /NO/ACTYPE   /OFLD     /ARCT    /SEQ /TYP   /ARS\n/0131D /BEAK 31 /2/AC:F14A /KLB:20.0/010815Z /A:1 /A:JP8 /CDT//');
  assert.equal(s.kind, 'columnar');
  assert.deepEqual(s.header, ['MSNNO', 'RECCS', 'NO', 'ACTYPE', 'OFLD', 'ARCT', 'SEQ', 'TYP', 'ARS']);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].line, 3);
  assert.equal(s.rows[0].fields[1].value, 'BEAK 31');
  assert.equal(s.rows[0].fields[4].value, '20.0');
  // `5REFUEL/` with a trailing slash ([CO]) is the same set.
  const t = one('5REFUEL/\n/MSNNO /RECCS\n/0131D /BEAK 31//');
  assert.deepEqual(t.header, ['MSNNO', 'RECCS']);
});

test('ato tokenize: a columnar row with the wrong cell count warns and is kept', () => {
  const r = tokenize('9PKGDAT\n/PKGID /UNIT /MSNNO\n/AA /4FW//');
  assert.ok(codes(r).includes('COLUMN_COUNT'));
  assert.equal(r.sets[0].rows[0].fields.length, 2);
});

test('ato tokenize: a one-line columnar set has no header', () => {
  const r = tokenize('5REFUEL/0131D/BEAK 31/2//');
  assert.equal(r.sets[0].header, null);
  assert.equal(r.sets[0].rows[0].fields.length, 3);
  assert.ok(codes(r).includes('COLUMNAR_NO_HEADER'));
});

test('ato tokenize: a free-text set keeps its slashes and its case', () => {
  const s = one('AMPN/Free text with a / slash inside//');
  assert.equal(s.kind, 'freetext');
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].value, 'Free text with a / slash inside');
  const g = one('GENTEXT/UNIT REMARKS/SNAKE 41 WEAPONS FREE//');
  assert.equal(g.fields[0].value, 'UNIT REMARKS/SNAKE 41 WEAPONS FREE');
});

test('ato tokenize: over-long free text is cut to MAX_FREE_TEXT', () => {
  const r = tokenize(`NARR/${'X'.repeat(2500)}//`);
  assert.equal(r.sets[0].fields[0].value.length, 2000);
  assert.ok(codes(r).includes('FIELD_TRUNCATED'));
});

test('ato tokenize: a missing final // warns and the set is still returned', () => {
  const r = tokenize('AKNLDG/NO//\nMSNACFT/1/ACTYP:F16C/VIPER 99/-/-/-/-/-/-/34705');
  assert.equal(r.sets.length, 2);
  assert.equal(r.sets[1].terminated, false);
  assert.equal(r.sets[1].fields.length, 10);
  const w = r.warnings.find((x) => x.code === 'UNTERMINATED_SET');
  assert.equal(w.line, 2);
  assert.equal(w.severity, 'warning');
});

test('ato tokenize: a missing // before a known set ends at that set, not at the next //', () => {
  const r = tokenize('AMSNDAT/0701A/-/-/-/STRIKE\nMSNACFT/2/ACTYP:F16C/HAWK 21//');
  assert.deepEqual(r.sets.map((s) => s.name), ['AMSNDAT', 'MSNACFT']);
  assert.equal(r.sets[0].terminated, false);
  assert.equal(r.sets[0].fields.length, 5);
  assert.equal(r.sets[1].line, 2);
});

test('ato tokenize: CRLF and a BOM leave line numbers intact', () => {
  const r = tokenize('﻿OPER/X//\r\nAKNLDG/NO//\r\n\r\nMSGID/ATO/Y//\r\n');
  assert.deepEqual(r.sets.map((s) => [s.name, s.line]), [['OPER', 1], ['AKNLDG', 2], ['MSGID', 4]]);
});

test('ato tokenize: a classification line before the first set is recorded, stray text is info', () => {
  const r = tokenize('UNCLAS\nEXER/IRON FLAG//.\n');
  assert.equal(r.classification, 'UNCLAS');
  assert.equal(r.sets.length, 1);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.severity, w.line]), [['STRAY_TEXT', 'info', 2]]);
});

test('ato tokenize: non-text inputs never throw', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const r = tokenize(bad);
    assert.deepEqual(r.sets, []);
    assert.deepEqual(codes(r), ['NOT_TEXT']);
  }
  assert.deepEqual(tokenize('').sets, []);
});

test('ato tokenize: input over 1 MiB is refused', () => {
  const r = tokenize('A'.repeat(MAX_INPUT_BYTES + 1));
  assert.deepEqual(r.sets, []);
  assert.deepEqual(codes(r), ['INPUT_TOO_LARGE']);
});

test('ato tokenize: pathological inputs finish fast', () => {
  for (const text of ['A/'.repeat(200000), '//'.repeat(200000), '\n'.repeat(500000), 'A\n'.repeat(200000),
    `AMSNDAT/${'1'.repeat(400000)}`, `5REFUEL\n${'/A '.repeat(150000)}`, 'X:'.repeat(300000)]) {
    const t0 = process.hrtime.bigint();
    tokenize(text);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `took ${ms} ms`);
  }
});
