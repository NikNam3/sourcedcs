'use strict';
// Golden tests (ADR 0078). UPDATE_GOLDEN=1 rewrites the byte goldens; never
// commit a run made with it set without reviewing the diff.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const U = require('../public/js/usmtf-ato.js');
const { normaliseUsmtf, logicalSets } = require('./helpers/usmtf-normalise.js');

const FX = path.join(__dirname, 'fixtures', 'usmtf');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const loadYaml = (f) => yaml.load(read(f));

function golden(file, text) {
  const p = path.join(FX, file);
  if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(p, text);
  assert.equal(text, fs.readFileSync(p, 'utf8'), file + ' differs; review, then UPDATE_GOLDEN=1');
}

function lineSanity(text, label) {
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), label + ': ends with exactly one newline');
  const lines = text.slice(0, -1).split('\n');
  lines.forEach((l) => {
    assert.ok(l.length <= 69, label + ': line over 69: ' + l);
    assert.match(l, /^[A-Z0-9 .,\-():+/]*$/, label + ': charset: ' + l);
  });
  normaliseUsmtf(text).sets.forEach((s) => {
    if (s.fields) {
      assert.ok(!s.fields.some((f) => f === ''), label + ': empty field (a "//" inside a set) in ' + s.set);
      assert.ok(!s.fields.some((f) => /^\s/.test(f)), label + ': leading space in ' + s.set);
    }
  });
  // every linear set ends in // (normaliseUsmtf would have swallowed the rest)
  let open = false;
  lines.slice(1).forEach((l) => {
    if (/^\d[A-Z0-9]+$/.test(l) || l.startsWith('/')) return;
    if (!/^\s/.test(l)) assert.ok(!open, label + ': set not closed before ' + l);
    open = !l.endsWith('//');
  });
  assert.ok(!open, label + ': last set not closed');
}

const researchSample = read('research-sample.txt');
const researchDoc = JSON.parse(read('research-sample.doc.json'));
const ojw = () => loadYaml('ojw1v5-trimmed.yaml');

test('research fixture is the byte-identical §3 block', () => {
  const sha = require('crypto').createHash('sha256').update(researchSample).digest('hex');
  assert.equal(sha, 'd5b2a599eed64455a32cf67ee21aa12c90d801c5aa9a2258993a2a0b6434e992');
});

test('renderer matches the research fixture semantically (the contract with L3)', () => {
  const { text } = U.renderUsmtf(researchDoc);
  assert.deepEqual(normaliseUsmtf(text), normaliseUsmtf(researchSample));
});

test('Appendix A: the sample package maps to the research AtoDoc and exports the fixture', () => {
  const r = U.buildUsmtf(loadYaml('sample-package.yaml'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(JSON.parse(JSON.stringify(r.doc)), researchDoc);
  assert.deepEqual(normaliseUsmtf(r.text), normaliseUsmtf(researchSample));
  const codes = r.warnings.map((w) => w.code);
  ['PACKAGE_DATA_MISSING', 'ALERT_STATUS_MISSING', 'IFF_MODE12_MISSING', 'TIMEFRAME_END_DERIVED'].forEach((c) =>
    assert.ok(codes.includes(c), c));
  ['DATALINK_MISSING', 'AR_DETAIL_MISSING', 'RIP_MISSING', 'VUL_MISSING', 'SUPPORT_MISSIONS_NOT_EXPORTED',
    'IFF_MODE3_MISSING', 'CHARSET_REPLACED', 'LINE_TOO_LONG'].forEach((c) => assert.ok(!codes.includes(c), c));
});

test('byte goldens', () => {
  golden('research-render.txt', U.renderUsmtf(researchDoc).text);
  golden('ojw1v5-export.txt', U.buildUsmtf(ojw()).text);
});

test('line sanity over both goldens', () => {
  lineSanity(U.renderUsmtf(researchDoc).text, 'research-render');
  lineSanity(U.buildUsmtf(ojw()).text, 'ojw1v5-export');
});

test('ojw1v5 oracle (trimmed, anonymised)', () => {
  const r = U.buildUsmtf(ojw());
  assert.deepEqual(r.errors, []);
  const text = r.text;
  const sets = logicalSets(text);
  assert.equal(text.split('\n')[0], 'UNCLAS', 'H44: always UNCLAS although the package says CLASSIFIED');
  assert.equal(sets[0], 'EXER/OPERATION JASMINE WAVE1//');
  assert.equal(sets[1], 'MSGID/ATO/SOURCEDCS AOC/-/JUL//');
  assert.equal(sets[3], 'TIMEFRAM/FROM:040220ZJUL2026/TO:050219ZJUL2026//');
  assert.equal(sets[4], 'GENTEXT/CODEWORDS/COCKTAIL AT 040415Z, WILLIAM AT 040435Z, JUICE AT 040445Z, MILLER TIME AT 040510Z//');
  const tu = sets.indexOf('TASKUNIT/TEST SQN/ICAO:LTAG//');
  assert.ok(tu > 0);
  assert.equal(sets[tu + 1], 'AMSNDAT/N/1896/-/-/-/OCA/-/-/DEPLOC:LTAG/040300ZJUL/ARRLOC:LTAG/040705ZJUL//');
  assert.equal(sets[tu + 2], 'MSNACFT/4/ACTYP:F16C/FALCN31/400+2X88C/-/-/-/-/-/-/34001//');
  assert.equal(sets[tu + 3], 'AMSNLOC/040420ZJUL/040515ZJUL/ORBIT/250//');
  const tex = sets.filter((s) => s.startsWith('ARINFO/TEXACO11/'));
  assert.equal(tex.length, 2);
  assert.match(tex[0], /\/ARCT:040345Z\//);
  assert.match(tex[1], /\/ARCT:040535Z\//);
  assert.ok(sets.indexOf('TASKUNIT/SOURCE DCS//') > tu, 'CVN-1 is not an airfield: no ICAO');
  const a1898 = sets.find((s) => s.startsWith('AMSNDAT/N/1898/'));
  assert.match(a1898, /\/DEPLOC:CVN-1\//);
  const i1898 = sets.indexOf(a1898);
  assert.equal(sets[i1898 + 1], 'MSNACFT/4/ACTYP:FA18C/HORNT11/000/-/-/-/-/-/-/35001//');
  assert.equal(sets[i1898 + 2],
    'GTGTLOC/P/-/NET:040505ZJUL/NLT:040510Z/MINISTRY OF FOREIGN AFFAIRS/ID:MINISTRY/-/-/DMPIS:333009N0361611E/WE//');
  assert.match(sets[i1898 + 3], /^ARINFO\/SHELL11\/.*ARCT:040335Z/);
  assert.match(sets[i1898 + 4], /^ARINFO\/SHELL11\/.*ARCT:040530Z/);
  assert.ok(sets.includes('MSNACFT/4/ACTYP:FA18C/BLADE21/000/-/-/-/-/-/-/36001//'));
  assert.ok(!sets.some((s) => s.startsWith('CONTROLA')), 'every mission has agency_id: null');
  const codes = r.warnings.map((w) => w.code);
  ['CLASSIFICATION_FORCED_UNCLAS', 'DEFAULT_UNIT', 'IFF_MODE12_MISSING', 'PACKAGE_DATA_MISSING',
    'SUPPORT_MISSIONS_NOT_EXPORTED', 'TOS_DROPPED_FOR_GTGTLOC', 'TOFFS_WITHOUT_TOS', 'AR_DETAIL_MISSING',
    'DATALINK_MISSING', 'ALERT_STATUS_MISSING'].forEach((c) => assert.ok(codes.includes(c), c));
  assert.ok(!codes.includes('IFF_MODE3_MISSING'), 'C3 gives every mission a Mode 3');
});

test('the runtime shape and the file shape give the same text', () => {
  const runtime = ojw();
  const file = ojw();
  file.registry.tankers = Object.entries(file.registry.tankers).map(([id, t]) => ({ id, ...t }));
  delete file.ato.targets;
  delete file.ato.operation;
  delete file.ato.classification;
  // _-prefixed runtime keys must not matter either
  runtime.ato.missions.forEach((m) => { m._vul_start = '0000'; m._vul_end = '0001'; m._marshal_time = '0415'; });
  assert.equal(U.buildUsmtf(file).text, U.buildUsmtf(runtime).text);
});

test('determinism', () => {
  assert.equal(U.buildUsmtf(ojw()).text, U.buildUsmtf(ojw()).text);
  assert.equal(U.renderUsmtf(researchDoc).text, U.renderUsmtf(researchDoc).text);
});

const FLASHBANG = process.env.FLASHBANG_YAML || '/home/nklx/dev/personal/sourcedcs/Flashbang 1.6.yaml';
test('Flashbang 1.6 smoke: exports with no errors', { skip: !fs.existsSync(FLASHBANG) && 'Flashbang 1.6.yaml not present' }, () => {
  const r = U.buildUsmtf(yaml.load(fs.readFileSync(FLASHBANG, 'utf8')));
  assert.deepEqual(r.errors, []);
  lineSanity(r.text, 'flashbang');
});
