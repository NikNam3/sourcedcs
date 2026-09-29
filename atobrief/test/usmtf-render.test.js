'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../public/js/usmtf-ato.js');
const { normaliseUsmtf, logicalSets } = require('./helpers/usmtf-normalise.js');

const D = (day, hour, minute) => ({ year: 2026, month: 9, day, hour, minute });

function mission(over) {
  return Object.assign({
    missionNumber: '1101A', amcMissionNumber: null, packageId: null, isPackageCommander: false,
    missionType: { primary: 'CAP', secondary: null }, alertStatus: null,
    departure: { location: 'OMAM', time: D(14, 12, 0) },
    recovery: { location: 'OMAM', time: D(14, 15, 30) },
    aircraft: [{ count: 2, aircraftType: 'F16C', callsign: 'VIPER 11',
      config: { primary: '402+', secondary: null },
      datalink: { l16Callsign: null, tacan: null, ju: null },
      iff: { modeOne: null, modeTwo: null, modeThree: null } }],
    location: { kind: 'AMSNLOC', start: null, stop: null, name: null, altitudeFt: null, priority: null },
    control: null, arInfo: [], packageCommander: null, packageData: null,
    refuelTask: null, refuelRows: null, controlRows: null, narrative: [],
  }, over);
}

function doc(missions, over) {
  return Object.assign({
    classification: 'UNCLAS', messageKind: 'EXER', operation: 'IRON FLAG 26-3',
    msgid: { originator: 'SOURCEDCS AOC', serial: null, month: 'SEP' },
    timeframe: { from: D(14, 6, 0), to: D(15, 5, 59), asof: null },
    generalText: [], country: 'US', service: 'F',
    units: missions ? [{ name: 'SOURCE DCS 1', icao: 'OMAM', remarks: null, missions }] : [],
  }, over);
}

function setOf(text, id) {
  return normaliseUsmtf(text).sets.filter((s) => s.set === id);
}

test('header sets: MSGID trims trailing dashes, TIMEFRAM without ASOF, no DECL', () => {
  const { text } = U.renderUsmtf(doc(null));
  assert.equal(text,
    'UNCLAS\nEXER/IRON FLAG 26-3//\nMSGID/ATO/SOURCEDCS AOC/-/SEP//\nAKNLDG/NO//\n' +
    'TIMEFRAM/FROM:140600ZSEP2026/TO:150559ZSEP2026//\n');
  const noMonth = U.renderUsmtf(doc(null, { msgid: { originator: 'X', serial: null, month: null } })).text;
  assert.match(noMonth, /^MSGID\/ATO\/X\/\/$/m);
  assert.doesNotMatch(text, /DECL/);
  assert.doesNotMatch(text, /TSKCNTRY/, 'no units, no tasking hierarchy');
});

test('field counts: AMSNDAT 12, MSNACFT 11, ARINFO 16', () => {
  const m = mission({ arInfo: [{ tankerCallsign: 'SHELL 71', tankerMissionNumber: null, tankerModeThree: null,
    arcp: null, altitudeFt: 22000, arct: D(14, 13, 45), endAr: null, offloadKlb: null, primary: null,
    secondary: null, tankerType: null, system: null, tacan: null }] });
  const { text } = U.renderUsmtf(doc([m]));
  assert.equal(setOf(text, 'AMSNDAT')[0].fields.length, 12);
  assert.equal(setOf(text, 'MSNACFT')[0].fields.length, 11);
  assert.equal(setOf(text, 'ARINFO')[0].fields.length, 16);
});

test('an aircraft with no IFF still has 11 MSNACFT fields ending in /-/-/-//', () => {
  const { text } = U.renderUsmtf(doc([mission()]));
  assert.ok(logicalSets(text).includes('MSNACFT/2/ACTYP:F16C/VIPER 11/402+/-/-/-/-/-/-/-//'));
});

test('a JU of 20011 lands in f8, not in an IFF slot', () => {
  const m = mission({ aircraft: [{ count: 2, aircraftType: 'F16C', callsign: 'VIPER 11',
    config: { primary: null, secondary: null }, datalink: { l16Callsign: 'VP11', tacan: null, ju: '20011' },
    iff: { modeOne: null, modeTwo: null, modeThree: '4521' } }] });
  const f = setOf(U.renderUsmtf(doc([m])).text, 'MSNACFT')[0].fields;
  assert.equal(f[7], '20011');
  assert.deepEqual(f.slice(8), ['-', '-', '34521']);
});

test('AMSNLOC/-// when empty; null DEPLOC gives -', () => {
  const m = mission({ departure: { location: null, time: null } });
  const sets = logicalSets(U.renderUsmtf(doc([m])).text);
  assert.ok(sets.includes('AMSNLOC/-//'));
  const am = sets.find((s) => s.startsWith('AMSNDAT'));
  assert.equal(am, 'AMSNDAT/N/1101A/-/-/-/CAP/-/-/-/-/ARRLOC:OMAM/141530ZSEP//');
});

test('wrapping: lines <= 69, breaks only after "/", un-wrap gives the logical string back', () => {
  const m = mission({ control: { type: 'AWAC', callsign: 'MAGIC 11', primary: { freqMhz: '251' },
    secondary: { freqMhz: '305.5' }, reportInPoint: 'ALPHA' } });
  const { text, warnings } = U.renderUsmtf(doc([m]));
  const lines = text.split('\n').filter(Boolean);
  lines.forEach((l) => assert.ok(l.length <= 69, l));
  const raw = text.split('\n');
  raw.forEach((l, i) => {
    if (/^\s/.test(l)) assert.ok(raw[i - 1].endsWith('/'), 'break after / : ' + raw[i - 1]);
  });
  // Rebuild AMSNDAT logically and compare.
  const am = text.slice(text.indexOf('AMSNDAT'));
  const logical = am.slice(0, am.indexOf('//') + 2).replace(/\n\s*/g, '');
  assert.equal(logical, 'AMSNDAT/N/1101A/-/-/-/CAP/-/-/DEPLOC:OMAM/141200ZSEP/ARRLOC:OMAM/141530ZSEP//');
  assert.ok(text.includes('AMSNDAT/N/1101A/-/-/-/CAP/-/-/DEPLOC:OMAM/141200ZSEP/ARRLOC:OMAM/\n     141530ZSEP//'));
  assert.equal(warnings.filter((w) => w.code === 'LINE_TOO_LONG').length, 0);
});

test('a 90-character NARR wraps after a kept space and round-trips', () => {
  const narr = 'PACKAGE AB PUSH FROM IP WEST AT 141445Z AND EGRESS VIA THE NORTHERN CORRIDOR BELOW FL200 X';
  assert.ok(narr.length >= 90);
  const { text } = U.renderUsmtf(doc([mission({ narrative: [narr] })]));
  const start = text.indexOf('NARR/');
  const block = text.slice(start, text.indexOf('//', start) + 2);
  assert.ok(block.includes('\n'), 'wrapped');
  block.split('\n').forEach((l) => assert.ok(l.length <= 69));
  block.split('\n').slice(0, -1).forEach((l) => assert.ok(l.endsWith(' '), 'break after a space'));
  assert.equal(block.replace(/\n\s*/g, ''), 'NARR/' + narr + '//');
});

test('free text replaces "/" and never contains "//" inside', () => {
  const { text } = U.renderUsmtf(doc([mission()], { generalText: [{ heading: 'CODEWORDS', text: 'A/B AT 1400Z' }] }));
  assert.ok(text.includes('GENTEXT/CODEWORDS/A B AT 1400Z//'));
});

test('LINE_TOO_LONG for a field that cannot fit', () => {
  const long = 'X'.repeat(80);
  const { text, warnings } = U.renderUsmtf(doc([mission({ narrative: [long] })]));
  assert.ok(warnings.some((w) => w.code === 'LINE_TOO_LONG'));
  assert.ok(text.includes(long));
});

test('GTGTLOC: descriptors, NLT short form, DMPIS + WE only with coordinates, elevation', () => {
  const m = mission({ location: { kind: 'GTGTLOC', targets: [
    { tot: null, net: D(14, 14, 58), nlt: D(14, 15, 2), name: 'Command Bunker', id: 'TGT-01', type: null,
      dmpi: { lat: 27.191667, lon: 56.3125 }, elevationFt: 120 },
    { tot: null, net: null, nlt: D(14, 15, 10), name: 'Depot', id: 'TGT-02', type: 'SA-2', dmpi: null, elevationFt: null },
  ] } });
  const sets = logicalSets(U.renderUsmtf(doc([m])).text).filter((s) => s.startsWith('GTGTLOC'));
  assert.deepEqual(sets, [
    'GTGTLOC/P/-/NET:141458ZSEP/NLT:141502Z/COMMAND BUNKER/ID:TGT-01/-/-/DMPIS:271130N0561845E/WE/120FT//',
    'GTGTLOC/P/-/-/NLT:141510Z/DEPOT/ID:TGT-02/SA-2//',
  ]);
});

test('CONTROLA: PFREQ/SFREQ, designators, NAME: for the RIP, trimmed', () => {
  const m = mission({ control: { type: 'AWAC', callsign: 'DARKSTAR', primary: { designator: 'green' },
    secondary: null, reportInPoint: null } });
  assert.ok(logicalSets(U.renderUsmtf(doc([m])).text).includes('CONTROLA/AWAC/DARKSTAR/PDESIG:GREEN//'));
});

test('PKGCMD is fixed 4, REFTSK trims', () => {
  const m = mission({
    packageCommander: { packageId: 'AB', unit: 'SOURCE DCS 2', missionNumber: '1202S', callsign: 'DUDE 21' },
    refuelTask: { system: 'BOM', totalOffloadKlb: 60, alertOffloadKlb: null, primary: null, secondary: null, tacan: null },
  });
  const sets = logicalSets(U.renderUsmtf(doc([m])).text);
  assert.ok(sets.includes('PKGCMD/AB/SOURCE DCS 2/1202S/DUDE 21//'));
  assert.ok(sets.includes('REFTSK/BOM/KLBS:60.0//'));
});

test('unit remarks come after the unit\'s last mission', () => {
  const d = doc([mission(), mission({ missionNumber: '1102A' })]);
  d.units[0].remarks = 'weapons free in box east';
  const text = U.renderUsmtf(d).text;
  const sets = normaliseUsmtf(text).sets.map((s) => s.set);
  assert.equal(sets[sets.length - 1], 'GENTEXT');
  assert.ok(text.endsWith('GENTEXT/UNIT REMARKS/WEAPONS FREE IN BOX EAST//\n'));
});

// ── Columnar sets ────────────────────────────────────────────────────

function columnarDoc() {
  return doc([mission({
    packageData: [
      { packageId: 'AB', unit: 'SOURCE DCS 2', missionNumber: '1202S', missionType: 'STRIKE', count: 2, aircraftType: 'F15E', callsign: 'DUDE 21' },
      { packageId: 'AB', unit: 'SOURCE DCS 2', missionNumber: '1203S', missionType: 'SEAD', count: 2, aircraftType: 'F16C', callsign: 'SNAKE 41' },
    ],
    refuelRows: [
      { missionNumber: '1101A', callsign: 'VIPER 11', count: 2, aircraftType: 'F16C', offloadKlb: 12, arct: D(14, 13, 45), sequence: 1, fuelType: 'JP8', system: 'BOM' },
      { missionNumber: '1202S', callsign: 'DUDE 21', count: 2, aircraftType: 'F15E', offloadKlb: 16, arct: D(14, 14, 20), sequence: 2, fuelType: 'JP8', system: 'BOM' },
    ],
    controlRows: [
      { missionNumber: '1101A', callsign: 'VIPER 11', count: 2, aircraftType: 'F16C', missionType: 'CAP', onStation: D(14, 13, 0), reportInPoint: 'ALPHA' },
    ],
  })]);
}

test('columnar: name alone, header and rows aligned, last row ends in //', () => {
  const text = U.renderUsmtf(columnarDoc()).text;
  const lines = text.split('\n');
  ['9PKGDAT', '5REFUEL', '7CONTROL'].forEach((id) => {
    const at = lines.indexOf(id);
    assert.ok(at > 0, id + ' name line alone, no trailing /');
    const block = [];
    for (let i = at + 1; i < lines.length; i++) { block.push(lines[i]); if (lines[i].endsWith('//')) break; }
    const slashPos = (l) => [...l.replace(/\/\/$/, '')].map((c, i) => (c === '/' ? i : -1)).filter((i) => i >= 0);
    const hdr = slashPos(block[0]);
    block.slice(1).forEach((row) => assert.deepEqual(slashPos(row), hdr, id + ': ' + row));
    assert.ok(block[block.length - 1].endsWith('//'));
    block.slice(0, -1).forEach((row) => assert.ok(!row.endsWith('/')));
  });
  assert.ok(lines.includes('/1101A /VIPER 11 /2  /AC:F16C /KLB:12.0 /141345Z /A:1 /A:JP8 /BOM'));
  assert.ok(lines.includes('/AB    /SOURCE DCS 2 /1203S /SEAD   /2  /AC:F16C /SNAKE 41//'));
});

test('columnar: a row over 69 characters warns and is kept whole', () => {
  const d = columnarDoc();
  d.units[0].missions[0].packageData[0].unit = 'A VERY LONG UNIT DESIGNATOR THAT OVERFLOWS';
  const { text, warnings } = U.renderUsmtf(d);
  assert.ok(warnings.some((w) => w.code === 'LINE_TOO_LONG'));
  assert.ok(text.includes('/A VERY LONG UNIT DESIGNATOR THAT OVERFLOWS /'));
});
