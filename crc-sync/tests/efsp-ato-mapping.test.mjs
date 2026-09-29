import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { parseStructure } = await import('../src/efsp/ato/ato-structure.js');
const { mapAtoDocument, collectWarnings, ATO_FIELD_TARGETS, SEED_KEYS } = await import('../src/efsp/ato/ato-mapping.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/ato/${name}`, import.meta.url), 'utf8');
const ingest = (name) => mapAtoDocument(parseStructure(fixture(name)));
const iffOf = (l) => ({ modeOne: l.extras.identityAto.modeOne, modeTwo: l.extras.identityAto.modeTwo, modeThree: l.extras.identityAto.modeThree });
const lines = (r) => Object.fromEntries(r.missionLines.map((l) => [l.lineId, l]));

// Every flat key fdr-store.js createFdr() reads from its seed (createFdr's
// body, the `seed.<key>` reads from `callsign` down to the mission set). A
// literal on purpose: if createFdr grows a key, this list is where L14 looks.
const CREATE_FDR_SEED_KEYS = ['callsign', 'flightSize', 'aircraftType', 'wakeCategory', 'equipmentCodes',
  'tailNumber', 'unit', 'homeStation', 'route', 'requestedAltitude', 'departureAirport', 'departureRunway',
  'destinationAirport', 'stereoRouteName', 'proposedDepartureTimeUtc', 'fullRouteClearance', 'remarks',
  'originAirport', 'arrivalFix', 'estimatedArrivalTimeUtc', 'missionNumber', 'packageId', 'controllingAgency',
  'vulWindowStartUtc', 'vulWindowEndUtc'];

const Z = (d, h, m) => Date.UTC(2026, 8, d, h, m); // research fixture: 14 SEP 2026
const A = (h, m) => Date.UTC(2026, 3, 14, h, m);  // Incirlik fixture: 14 APR 2026

// docs/parallel/research/usmtf-ato.md §3's oracle table, line by line.
test('ato mapping: the research fixture matches the research note\'s oracle', () => {
  const r = ingest('iron-flag-26-3.txt');
  assert.equal(r.ok, true);
  const L = lines(r);
  const rows = [
    // lineId, callsign, size, type, pkg, vul start, vul end, vulSource, agency, M1, M2, M3, L16, TACAN, JU, RIP
    ['1101A#0', 'VIPER11', 2, 'F16C', null, Z(14, 13, 0), Z(14, 15, 0), 'AMSNLOC', 'MAGIC11', '12', '0011', '4521', 'VP11', null, '00011', 'ALPHA'],
    ['1202S#0', 'DUDE21', 2, 'F15E', 'AB', Z(14, 14, 58), Z(14, 15, 2), 'GTGTLOC', 'MAGIC11', '21', '0021', '4531', 'DU21', null, '00021', 'BRAVO'],
    ['1203S#0', 'SNAKE41', 2, 'F16C', 'AB', Z(14, 14, 50), Z(14, 15, 10), 'AMSNLOC', 'MAGIC11', '41', '0041', '4541', 'SN41', null, '00041', 'BRAVO'],
    ['1901T#0', 'SHELL71', 1, 'KC135', null, Z(14, 12, 30), Z(14, 16, 30), 'AMSNLOC', null, null, null, '4571', null, '38Y', null, null],
    ['1801W#0', 'MAGIC11', 1, 'E3', null, Z(14, 12, 0), Z(14, 17, 30), 'AMSNLOC', null, null, null, '4501', 'MG11', null, '00001', null],
  ];
  assert.deepEqual(Object.keys(L), rows.map((x) => x[0]));
  for (const [id, cs, size, type, pkg, vs, ve, vsrc, agency, m1, m2, m3, l16, tacan, ju, rip] of rows) {
    const l = L[id];
    assert.equal(l.extras.ato.seedable, true, id);
    assert.equal(l.extras.ato.callsign, cs, id);
    assert.deepEqual(
      [l.fdrSeed.callsign, l.fdrSeed.flightSize, l.fdrSeed.aircraftType, l.fdrSeed.packageId, l.fdrSeed.vulWindowStartUtc, l.fdrSeed.vulWindowEndUtc, l.fdrSeed.controllingAgency],
      [cs, size, type, pkg, vs, ve, agency], id);
    assert.equal(l.extras.ato.vulSource, vsrc, id);
    assert.deepEqual(iffOf(l), { modeOne: m1, modeTwo: m2, modeThree: m3 }, id);
    assert.deepEqual([l.extras.identityAto.datalink.l16Callsign, l.extras.identityAto.datalink.tacan, l.extras.identityAto.datalink.ju], [l16, tacan, ju], id);
    assert.equal(l.extras.ato.reportInPoint, rip, id);
    assert.equal(l.fdrSeed.homeStation, 'OMAM', id);
    assert.equal(l.military.alertStatus, 'NONE', id);
    assert.deepEqual(l.warnings, [], id);
  }
  assert.deepEqual(r.warnings, []);
  assert.equal(L['1202S#0'].extras.ato.isPackageCommander, true);
  assert.deepEqual(L['1203S#0'].extras.ato.packageCommander, { unit: 'SOURCE DCS 2', missionNumber: '1202S', callsign: 'DUDE21', callsignRaw: 'DUDE 21', source: 'AMSNDAT' });
  assert.deepEqual(r.packages, [{ packageId: 'AB', commander: { unit: 'SOURCE DCS 2', missionNumber: '1202S', callsign: 'DUDE21', callsignRaw: 'DUDE 21', source: 'AMSNDAT' }, memberMissionNumbers: ['1202S', '1203S'] }]);
  assert.deepEqual(L['1202S#0'].extras.ato.control, {
    type: 'AWACS', typeRaw: 'AWAC', callsign: 'MAGIC11', callsignRaw: 'MAGIC 11',
    primary: { freqMhz: 251 }, secondary: { freqMhz: 305.5 }, reportInPoint: 'BRAVO', comments: null,
  });
  assert.equal(L['1202S#0'].extras.ato.onStationUtc, Z(14, 14, 45));
  assert.equal(L['1101A#0'].extras.ato.departure.timeUtc, Z(14, 12, 0));
  assert.equal(L['1101A#0'].extras.ato.recovery.timeUtc, Z(14, 15, 30));
  assert.deepEqual(L['1202S#0'].extras.ato.remarks, ['PACKAGE AB PUSH FROM IP WEST AT 141445Z']);
  assert.deepEqual(L['1901T#0'].extras.ato.missingAcceptanceFields, ['packageId', 'controllingAgency', 'modeOne', 'modeTwo']);
  assert.deepEqual(L['1202S#0'].extras.ato.missingAcceptanceFields, []);
});

test('ato mapping: research fixture AR joins', () => {
  const r = ingest('iron-flag-26-3.txt');
  assert.deepEqual(r.arLinks, [
    { tankerMissionNumber: '1901T', tankerCallsign: 'SHELL71', receiverMissionNumber: '1101A', receiverCallsign: 'VIPER11', arctUtc: Z(14, 13, 45), offloadKlb: 12, arcp: 'ANCHOR BLUE', sources: ['ARINFO', '5REFUEL'], tankerLineId: '1901T#0', receiverLineId: '1101A#0', resolved: 'BOTH' },
    { tankerMissionNumber: '1901T', tankerCallsign: 'SHELL71', receiverMissionNumber: '1202S', receiverCallsign: 'DUDE21', arctUtc: Z(14, 14, 20), offloadKlb: 16, arcp: 'ANCHOR BLUE', sources: ['ARINFO', '5REFUEL'], tankerLineId: '1901T#0', receiverLineId: '1202S#0', resolved: 'BOTH' },
  ]);
  const L = lines(r);
  assert.equal(L['1901T#0'].military.arInfo.asTanker.totalOffloadKlb, 60);
  assert.equal(L['1901T#0'].military.arInfo.asTanker.tacan, '38Y');
  assert.equal(L['1101A#0'].military.arInfo.asReceiver[0].tankerModeThree, '4571');
  assert.equal(L['1101A#0'].military.arInfo.asReceiver[0].tankerModeThree, L['1901T#0'].extras.identityAto.modeThree);
});

// The briefing's §8.2 table, against the Incirlik fixture.
test('ato mapping: the Incirlik fixture matches the briefing\'s expected lines', () => {
  const r = ingest('incirlik-day1.txt');
  const L = lines(r);
  const rows = [
    ['0101A#0', 'VIPER11', 4, 'F16C', '0101A', 'AA', A(4, 30), A(5, 30), 'MAGIC', '12', '0101', '4101', '11', 'NONE'],
    ['0103A#0', 'SNAKE31', 2, 'F16C', '0103A', 'AA', A(4, 25), A(5, 35), 'MAGIC', '13', '0103', '4103', '13', 'NONE'],
    ['0102A#0', 'EAGLE21', 2, 'F15C', '0102A', 'AA', A(4, 20), A(5, 40), 'MAGIC', null, '0102', '4102', '12', 'NONE'],
    ['0201C#0', 'COLT41', 2, 'F15C', '0201C', null, A(5, 30), A(7, 30), 'SCREWTOP', '14', '0201', '4201', '14', 'ALERT'],
    ['0501T#0', 'SHELL51', 1, 'KC135', '0501T', null, A(3, 30), A(6, 30), 'MAGIC', null, '0501', '4501', null, 'NONE'],
    ['0601W#0', 'MAGIC11', 1, 'E3A', '0601W', null, A(3, 0), A(9, 0), null, null, '0601', '4601', null, 'NONE'],
  ];
  assert.deepEqual(Object.keys(L), rows.map((x) => x[0]));
  for (const [id, cs, size, type, msn, pkg, vs, ve, agency, m1, m2, m3, dl, alert] of rows) {
    const l = L[id];
    assert.deepEqual(
      [l.fdrSeed.callsign, l.fdrSeed.flightSize, l.fdrSeed.aircraftType, l.fdrSeed.missionNumber, l.fdrSeed.packageId, l.fdrSeed.vulWindowStartUtc, l.fdrSeed.vulWindowEndUtc, l.fdrSeed.controllingAgency],
      [cs, size, type, msn, pkg, vs, ve, agency], id);
    assert.deepEqual(iffOf(l), { modeOne: m1, modeTwo: m2, modeThree: m3 }, id);
    assert.equal(l.extras.identityAto.datalink.code, dl, id);
    assert.equal(l.military.alertStatus, alert, id);
  }
  assert.equal(L['0201C#0'].extras.ato.alertStatusRaw, 'GA15');
  const units = Object.fromEntries(Object.entries(L).map(([k, l]) => [k, [l.fdrSeed.unit, l.fdrSeed.homeStation]]));
  assert.deepEqual(units, {
    '0101A#0': ['480FS', 'LTAG'], '0103A#0': ['480FS', 'LTAG'], '0102A#0': ['493FS', 'LTAG'],
    '0201C#0': ['493FS', 'LTAG'], '0501T#0': ['351ARS', 'LTAG'], '0601W#0': ['552ACW', 'LTAG'],
  });
  assert.equal(L['0101A#0'].extras.ato.onStationUtc, A(4, 25));
  assert.equal(L['0102A#0'].extras.ato.onStationUtc, A(4, 15));
  assert.equal(L['0201C#0'].extras.ato.onStationUtc, A(5, 25));
  assert.equal(L['0201C#0'].extras.ato.departure.timeUtc, A(5, 0));
  assert.equal(L['0201C#0'].extras.ato.recovery.timeUtc, A(8, 0));
  assert.deepEqual(L['0101A#0'].military.scl, { primary: '4MK82', secondary: '2AIM120' });
  assert.equal(L['0101A#0'].extras.ato.isPackageCommander, true);
  assert.equal(L['0102A#0'].extras.ato.packageCommander.missionNumber, '0101A');
  assert.equal(L['0101A#0'].extras.ato.missionAltitudeFt, 25000);
  assert.deepEqual(L['0101A#0'].extras.ato.vulRaw, { start: '140430ZAPR', stop: '140530ZAPR' });
  assert.deepEqual(L['0101A#0'].extras.ato.remarks, ['PACKAGE AA STRIKE ON OBJ ANVIL']);
  assert.equal(L['0601W#0'].fdrSeed.controllingAgency, null, 'the agency\'s own line has no agency, and no warning');
  assert.deepEqual(collectWarnings(r).filter((w) => w.severity !== 'info'), []);
});

test('ato mapping: Incirlik AR links and the tanker\'s arInfo', () => {
  const r = ingest('incirlik-day1.txt');
  assert.deepEqual(r.arLinks.map((l) => [l.tankerMissionNumber, l.tankerCallsign, l.receiverMissionNumber, l.receiverCallsign, l.arctUtc, l.offloadKlb, l.sources, l.resolved]), [
    ['0501T', 'SHELL51', '0101A', 'VIPER11', A(4, 0), 24, ['ARINFO', '5REFUEL'], 'BOTH'],
    ['0501T', 'SHELL51', '0102A', 'EAGLE21', A(4, 10), 16, ['ARINFO', '5REFUEL'], 'BOTH'],
  ]);
  const L = lines(r);
  const t = L['0501T#0'].military.arInfo.asTanker;
  assert.deepEqual([t.system, t.totalOffloadKlb, t.alertOffloadKlb, t.tacan, t.receivers.length], ['BOM', 80, 20, '22-85', 2]);
  assert.equal(L['0101A#0'].military.arInfo.asReceiver[0].tankerModeThree, '4501');
  assert.equal(L['0501T#0'].extras.identityAto.modeThree, '4501', 'so L14 can join on it too');
});

test('ato mapping: an ArLink declares nothing (not MARSA)', () => {
  for (const f of ['iron-flag-26-3.txt', 'incirlik-day1.txt']) {
    for (const l of ingest(f).arLinks) {
      for (const k of Object.keys(l)) assert.doesNotMatch(k, /marsa|regime|separation/i);
    }
  }
});

test('ato mapping: fdrSeed holds only createFdr\'s own keys — never a beacon, never Mode 1/2', () => {
  assert.ok(SEED_KEYS.every((k) => CREATE_FDR_SEED_KEYS.includes(k)));
  for (const f of ['iron-flag-26-3.txt', 'incirlik-day1.txt', 'malformed.txt']) {
    for (const l of ingest(f).missionLines) {
      for (const k of Object.keys(l.fdrSeed)) assert.ok(CREATE_FDR_SEED_KEYS.includes(k), `${f} ${l.lineId}: ${k}`);
      assert.deepEqual(Object.keys(l.fdrSeed), [...SEED_KEYS]);
      for (const bad of ['beaconAssigned', 'modeOne', 'modeTwo', 'modeThree', 'beacon']) assert.ok(!(bad in l.fdrSeed));
    }
  }
});

test('ato mapping: ATO_FIELD_TARGETS — createFdr rows are exactly the fdrSeed rows', () => {
  for (const row of ATO_FIELD_TARGETS) {
    for (const k of ['set', 'field', 'out', 'fdrPath', 'guideM', 'blockId', 'writePathToday']) assert.ok(k in row, k);
    assert.ok(['createFdr', 'setMilitary', 'none'].includes(row.writePathToday));
    assert.equal(row.writePathToday === 'createFdr', row.out.startsWith('fdrSeed.'), row.out);
    if (row.writePathToday === 'createFdr') assert.ok(SEED_KEYS.includes(row.out.slice('fdrSeed.'.length)));
  }
  // Every fdrSeed key has a row.
  for (const k of SEED_KEYS) assert.ok(ATO_FIELD_TARGETS.some((r) => r.out === `fdrSeed.${k}`), k);
  // The ATO's Mode 3 never targets the beacon.
  const m3 = ATO_FIELD_TARGETS.find((r) => r.field === 'iffModeThree');
  assert.notEqual(m3.fdrPath, 'identity.beaconAssigned');
  // Every `out` path resolves on a real line.
  const l = lines(ingest('iron-flag-26-3.txt'))['1901T#0'];
  for (const row of ATO_FIELD_TARGETS) {
    const parts = row.out.split('.');
    let o = l;
    for (const p of parts.slice(0, -1)) { o = o?.[p]; }
    if (row.out.startsWith('military.arInfo.')) continue; // arInfo is null on a line with no AR
    assert.ok(o && parts[parts.length - 1] in o, row.out);
  }
});

test('ato mapping: provenance names the set and line of every seeded value', () => {
  const L = lines(ingest('incirlik-day1.txt'));
  assert.deepEqual(L['0101A#0'].provenance['mission.vulWindowStartUtc'], { source: 'ATO', set: 'AMSNLOC', line: 8 });
  assert.deepEqual(L['0101A#0'].provenance['mission.controllingAgency'], { source: 'ATO', set: 'CONTROLA', line: 9 });
  assert.deepEqual(L['0101A#0'].provenance['mission.packageId'], { source: 'ATO', set: 'AMSNDAT', line: 6 });
  assert.deepEqual(L['0101A#0'].provenance['identity.unit'], { source: 'ATO', set: 'TASKUNIT', line: 5 });
  assert.ok(!('mission.controllingAgency' in L['0601W#0'].provenance));
});

test('ato mapping: fall-backs — agency and vul start from 7CONTROL, package id from 9PKGDAT', () => {
  const r = mapAtoDocument(parseStructure([
    'TIMEFRAM/FROM:140000ZAPR2026/TO:142359ZAPR2026//',
    'AMSNDAT/N/0001A/-/-/-/CAP//',
    'MSNACFT/2/ACTYP:F16C/VIPER 11//',
    'AMSNDAT/N/0002A/-/ZZ/MC/STRIKE//',
    'MSNACFT/2/ACTYP:F16C/HORNET 1//',
    'AMSNLOC/140400ZAPR/140500ZAPR/X/250/1//',
    '9PKGDAT',
    '/PKGID /UNIT /MSNNO /PMSN /NO/ACTYPE /ACSIGN',
    '/ZZ /U /0001A /CAP /2 /AC:F16C /VIPER 11//',
    'AMSNDAT/N/0009W/-/-/-/AEW//',
    'MSNACFT/1/ACTYP:E3/DARKSTAR 1//',
    '7CONTROL',
    '/MSNNO /ACSIGN /NO/ACTYPE /MSNTY /TOSTA /RIP',
    '/0001A /VIPER 11 /2 /AC:F16C /CAP /140330Z /EAST//',
  ].join('\n')));
  const l = lines(r)['0001A#0'];
  assert.equal(l.fdrSeed.controllingAgency, 'DARKSTAR1', 'the controller\'s normalised callsign (free text: no 7-char rule)');
  assert.equal(l.fdrSeed.vulWindowStartUtc, A(3, 30));
  assert.equal(l.fdrSeed.vulWindowEndUtc, null);
  assert.equal(l.extras.ato.vulSource, '7CONTROL');
  assert.equal(l.extras.ato.reportInPoint, 'EAST');
  assert.equal(l.fdrSeed.packageId, 'ZZ');
  assert.deepEqual(l.provenance['mission.packageId'], { source: 'ATO', set: '9PKGDAT', line: 9 });
  assert.deepEqual(l.warnings.map((w) => w.code).filter((c) => c !== 'NO_LOCATION_SET'), ['VUL_FROM_7CONTROL', 'AGENCY_FROM_7CONTROL']);
  assert.equal(lines(r)['0009W#0'].extras.ato.seedable, false, 'DARKSTAR1 is 9 characters');
});

test('ato mapping: two MSNACFT in one mission give two lines sharing the mission number', () => {
  const r = mapAtoDocument(parseStructure([
    'TIMEFRAM/FROM:140000ZAPR2026/TO:142359ZAPR2026//',
    'AMSNDAT/N/0001A/-/-/-/CAP//',
    'MSNACFT/2/ACTYP:F16C/VIPER 11/-/-/31111//',
    'MSNACFT/2/ACTYP:F15C/EAGLE 21/-/-/31112//',
    'AMSNLOC/140400ZAPR/140500ZAPR/X/250/1//',
  ].join('\n')));
  assert.deepEqual(r.missionLines.map((l) => [l.lineId, l.extras.ato.callsign, l.extras.identityAto.modeThree, l.fdrSeed.vulWindowStartUtc]), [
    ['0001A#0', 'VIPER11', '1111', A(4, 0)], ['0001A#1', 'EAGLE21', '1112', A(4, 0)],
  ]);
  assert.ok(r.missionLines.every((l) => l.warnings.some((w) => w.code === 'MULTIPLE_FLIGHTS_IN_MISSION')));
});

test('ato mapping: ARINFO and 5REFUEL that disagree warn, and the receiver\'s ARINFO wins', () => {
  const r = mapAtoDocument(parseStructure([
    'TIMEFRAM/FROM:140000ZAPR2026/TO:142359ZAPR2026//',
    'AMSNDAT/N/0001A/-/-/-/CAP//',
    'MSNACFT/2/ACTYP:F16C/VIPER 11//',
    'ARINFO/SHELL 51/0501T/34501/NAME:BLUE/200/ARCT:140400ZAPR/-/KLBS:24.0//',
    'AMSNDAT/N/0501T/-/-/-/AR//',
    'MSNACFT/1/ACTYP:KC135/SHELL 51/-/-/34502//',
    '5REFUEL',
    '/MSNNO /RECCS /NO/ACTYPE /OFLD /ARCT /SEQ /TYP /ARS',
    '/0001A /VIPER 11 /2 /AC:F16C /KLB:20.0 /140400Z /A:1 /A:JP8 /BOM',
    '/0999X /GHOST 1 /2 /AC:F16C /KLB:20.0 /140500Z /A:2 /A:JP8 /BOM//',
  ].join('\n')));
  assert.equal(r.arLinks[0].offloadKlb, 24);
  assert.equal(r.arLinks[1].resolved, 'TANKER_ONLY');
  const all = collectWarnings(r).map((w) => [w.code, w.line]);
  assert.ok(all.some(([c, l]) => c === 'AR_LINK_CONFLICT' && l === 9));
  assert.ok(all.some(([c, l]) => c === 'AR_RECEIVER_NOT_IN_ATO' && l === 10));
  assert.ok(all.some(([c, l]) => c === 'AR_TANKER_IFF_MISMATCH' && l === 4));
});

test('ato mapping: a line has S-Q50\'s four keys plus the S-R2-8 metadata, and nothing else', () => {
  for (const f of ['iron-flag-26-3.txt', 'incirlik-day1.txt', 'malformed.txt']) {
    for (const l of ingest(f).missionLines) {
      assert.deepEqual(Object.keys(l).sort(), ['extras', 'fdrSeed', 'lineId', 'military', 'provenance', 'sourceLines', 'warnings']);
      assert.deepEqual(Object.keys(l.extras).sort(), ['ato', 'identityAto']);
      assert.deepEqual(Object.keys(l.military).sort(), ['alertStatus', 'arInfo', 'scl']);
      assert.equal(typeof l.sourceLines.MSNACFT, 'number');
    }
  }
});
