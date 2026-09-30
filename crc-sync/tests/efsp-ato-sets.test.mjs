import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tokenize } = await import('../src/efsp/ato/usmtf-tokenize.js');
const { makeResolver } = await import('../src/efsp/ato/usmtf-time.js');
const S = await import('../src/efsp/ato/ato-sets.js');

// The 455 wiki's examples are dated October 1998 (TIMEFRAM 010600ZOCT1998–020559ZOCT1998).
const OCT98 = { resolve: makeResolver({ fromUtc: Date.UTC(1998, 9, 1, 6, 0), toUtc: Date.UTC(1998, 9, 2, 5, 59) }), opts: {} };
const set = (text) => tokenize(text).sets[0];
const run = (fn, text, ctx = OCT98) => fn(set(text), ctx);
const codes = (r) => r.warnings.map((w) => w.code);

test('ato sets: MSGID, and a CHG qualifier is surfaced as info', () => {
  const r = run(S.extractMsgId, 'MSGID/ATO/USCENTCOM/ATO A/OCT/CHG/1//');
  assert.deepEqual(r.value, { formatId: 'ATO', originator: 'USCENTCOM', serial: 'ATO A', month: 'OCT', qualifier: 'CHG', qualifierSerial: '1' });
  assert.deepEqual(codes(r), ['ATO_CHANGE_MESSAGE']);
  assert.deepEqual(codes(run(S.extractMsgId, 'MSGID/ATOCONF/X//')), ['ATOCONF_FORMAT']);
  assert.deepEqual(codes(run(S.extractMsgId, 'MSGID/ATO/SOURCEDCS AOC/ATO C/SEP//')), []);
});

test('ato sets: TIMEFRAM gives the window in epoch ms', () => {
  const r = run(S.extractTimeframe, 'TIMEFRAM/FROM:010600ZOCT1998/TO:020559ZOCT1998/ASOF:302100ZSEP1998//', { resolve: makeResolver({}) });
  assert.equal(r.value.fromUtc, Date.UTC(1998, 9, 1, 6, 0));
  assert.equal(r.value.toUtc, Date.UTC(1998, 9, 2, 5, 59));
  assert.equal(r.value.asOfUtc, Date.UTC(1998, 8, 30, 21, 0));
  assert.equal(r.value.fromRaw, '010600ZOCT1998');
});

test('ato sets: TASKUNIT strips ICAO:', () => {
  const r = run(S.extractTaskUnit, 'TASKUNIT/1FW/ICAO:LLKA//');
  assert.equal(r.value.unit, '1FW');
  assert.equal(r.value.location, 'LLKA');
  assert.equal(r.value.locationKind, 'ICAO');
});

test('ato sets: AMSNDAT variant A (455 field list)', () => {
  const r = run(S.extractAmsndat, 'AMSNDAT/0121C/-/AAF/MC/BARCAP/-/-/DEPLOC:LBNA/ARRLOC:LLKA//');
  assert.equal(r.value.variant, 'A');
  assert.equal(r.value.missionNumber, '0121C');
  assert.equal(r.value.packageId, 'AAF');
  assert.equal(r.value.isPackageCommander, true);
  assert.deepEqual(r.value.missionType, { primary: 'BARCAP', secondary: null });
  assert.equal(r.value.alertStatusRaw, null);
  assert.deepEqual(r.value.departure, { location: 'LBNA', timeUtc: null, raw: null });
  assert.deepEqual(r.value.recovery, { location: 'LLKA', timeUtc: null, raw: null });
  assert.deepEqual(codes(r), ['AMSNDAT_VARIANT_A']);
});

test('ato sets: AMSNDAT variant B ([AFIT], [CO], 455 multi-set example) reads the DTGs after DEPLOC/ARRLOC', () => {
  const r = run(S.extractAmsndat, 'AMSNDAT/N/0121C/-/AAF/-/BRCAP/-/ /DEPLOC:LBNA/010715ZOCT/ARRLOC:LLKA/010815ZOCT//');
  assert.equal(r.value.variant, 'B');
  assert.equal(r.value.residual, 'N');
  assert.equal(r.value.missionNumber, '0121C');
  assert.equal(r.value.isPackageCommander, false);
  assert.equal(r.value.missionType.primary, 'BRCAP');
  assert.deepEqual(r.value.departure, { location: 'LBNA', timeUtc: Date.UTC(1998, 9, 1, 7, 15), raw: '010715ZOCT' });
  assert.equal(r.value.recovery.timeUtc, Date.UTC(1998, 9, 1, 8, 15));
  assert.deepEqual(codes(r), []);
});

test('ato sets: AMSNDAT with no mission number is an error', () => {
  const r = run(S.extractAmsndat, 'AMSNDAT/N/-/-/-/-/CAP//');
  assert.equal(r.value.missionNumber, null);
  assert.deepEqual(codes(r), ['MISSING_MISSION_NUMBER']);
  assert.equal(r.warnings[0].severity, 'error');
});

test('ato sets: MSNACFT, the 455 example → datalink 27, Mode 2 0001, Mode 3 0111, no Mode 1', () => {
  const r = run(S.extractMsnacft, 'MSNACFT/4/ACTYP:F15C/EAGLE 21/2IR6RK/BEST/-/27/-/20001/30111//');
  assert.equal(r.value.count, 4);
  assert.equal(r.value.aircraftType, 'F15C');
  assert.equal(r.value.callsignRaw, 'EAGLE 21');
  assert.equal(r.value.callsign, 'EAGLE21');
  assert.deepEqual(r.value.config, { primary: '2IR6RK', secondary: 'BEST' });
  assert.deepEqual(r.value.iff, { modeOne: null, modeTwo: '0001', modeThree: '0111' });
  assert.equal(r.value.datalink.profile, false);
  assert.equal(r.value.datalink.code, '27');
  assert.ok(!codes(r).includes('DATALINK_AMBIGUOUS'));
  assert.ok(r.heuristics.includes('MSNACFT_IFF_WALKBACK'));
});

test('ato sets: MSNACFT [PROFILE] 11-field shape reads L16 callsign / TACAN / JU', () => {
  const r = run(S.extractMsnacft, 'MSNACFT/2/ACTYP:F16C/VIPER 11/402+/-/VP11/-/00011/112/20011/34521//');
  assert.deepEqual(r.value.iff, { modeOne: '12', modeTwo: '0011', modeThree: '4521' });
  assert.deepEqual(r.value.datalink, { profile: true, l16Callsign: 'VP11', tacan: null, ju: '00011', code: null, raw: ['VP11', null, '00011'] });
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.heuristics, []);
  const t = run(S.extractMsnacft, 'MSNACFT/1/ACTYP:KC135/SHELL 71/-/-/-/38Y/-/-/-/34571//');
  assert.equal(t.value.datalink.tacan, '38Y');
  assert.deepEqual(t.value.iff, { modeOne: null, modeTwo: null, modeThree: '4571' });
});

test('ato sets: IFF token forms (Combined Ops) and their validation', () => {
  const iff = (tail) => run(S.extractMsnacft, `MSNACFT/1/ACTYP:F16C/A 1/-/-/${tail}//`);
  assert.equal(iff('131').value.iff.modeOne, '31');
  assert.equal(iff('35011').value.iff.modeThree, '5011');
  const bad = iff('38888');
  assert.equal(bad.value.iff.modeThree, null);
  assert.deepEqual(codes(bad), ['IFF_MALFORMED']);
  const res = iff('37700');
  assert.equal(res.value.iff.modeThree, '7700', 'a reserved code is kept as the ATO wrote it');
  assert.deepEqual(codes(res), ['MODE3_RESERVED']);
  const syn = iff('36123');
  assert.equal(syn.value.iff.modeThree, '6123');
  assert.deepEqual(codes(syn), ['MODE3_SYNTHETIC']);
  assert.deepEqual(codes(iff('10123')), ['IFF_MALFORMED'], 'a 5-digit Mode 1 token is malformed');
  const dup = iff('34501/34502');
  assert.equal(dup.value.iff.modeThree, '4501');
  assert.deepEqual(codes(dup), ['IFF_DUPLICATE_MODE']);
});

test('ato sets: Mode 1 above 73 warns only when the facility asks for 00–73', () => {
  const text = 'MSNACFT/1/ACTYP:F16C/A 1/-/-/177//';
  assert.equal(run(S.extractMsnacft, text).value.iff.modeOne, '77');
  assert.deepEqual(codes(run(S.extractMsnacft, text)), []);
  const r = run(S.extractMsnacft, text, { ...OCT98, opts: { modeOneMax: '73' } });
  assert.equal(r.value.iff.modeOne, '77');
  assert.deepEqual(codes(r), ['MODE1_OUT_OF_RANGE']);
});

test('ato sets: MSNACFT count, type fallback, ambiguous datalink', () => {
  const r = run(S.extractMsnacft, 'MSNACFT/two/F16C/HAWK 21/-/-/11/22/-/28888/37700//');
  assert.equal(r.value.count, 1);
  assert.equal(r.value.aircraftType, 'F16C');
  assert.ok(r.heuristics.includes('MSNACFT_TYPE_POSITIONAL'));
  assert.deepEqual(codes(r).sort(), ['BAD_AIRCRAFT_COUNT', 'DATALINK_AMBIGUOUS', 'IFF_MALFORMED', 'MODE3_RESERVED']);
  assert.equal(r.value.datalink.code, '22');
});

test('ato sets: AMSNLOC → vul window and altitude in hundreds of feet', () => {
  const r = run(S.extractAmsnloc, 'AMSNLOC/011000ZOCT/011200ZOCT/SEIRAQ/260/1//');
  assert.equal(r.value.start.utc, Date.UTC(1998, 9, 1, 10, 0));
  assert.equal(r.value.stop.utc, Date.UTC(1998, 9, 1, 12, 0));
  assert.equal(r.value.locationName, 'SEIRAQ');
  assert.equal(r.value.altitudeFt, 26000);
  assert.equal(r.value.priority, '1');
  assert.deepEqual(codes(r), []);
  assert.deepEqual(codes(run(S.extractAmsnloc, 'AMSNLOC/011200ZOCT/011000ZOCT/X/2X0/1//')), ['VUL_END_BEFORE_START', 'BAD_ALTITUDE']);
  assert.equal(run(S.extractAmsnloc, 'AMSNLOC/-/-/-/FL260/1//').value.altitudeFt, 26000);
  assert.deepEqual(run(S.extractAmsnloc, 'AMSNLOC/-/-/-/240-260/1//').value.altitudeBlockFt, { low: 24000, high: 26000 });
});

test('ato sets: GTGTLOC reads TOT/NET/NLT/ID by key', () => {
  const r = run(S.extractGtgtloc, 'GTGTLOC/P/-/NET:011458ZOCT/NLT:011502Z/COMMAND BUNKER/ID:TGT-01/-/-/DMPIS:271130N0561845E/WE/120FT//');
  assert.equal(r.value.tot.utc, null);
  assert.equal(r.value.net.utc, Date.UTC(1998, 9, 1, 14, 58));
  assert.equal(r.value.nlt.utc, Date.UTC(1998, 9, 1, 15, 2));
  assert.equal(r.value.name, 'COMMAND BUNKER');
  assert.equal(r.value.targetId, 'TGT-01');
  assert.equal(r.value.dmpis, '271130N0561845E');
});

test('ato sets: CONTROLA — the 455 example reads DR01 as the RIP and NAME:JIM as a comment', () => {
  const r = run(S.extractControla, 'CONTROLA/AWAC/DARKSTAR/PDESIG:GREEN/SDESIG:WHITE/DR01/NAME:JIM//');
  assert.deepEqual(r.value, {
    typeRaw: 'AWAC', type: 'AWACS', callsignRaw: 'DARKSTAR', callsign: 'DARKSTAR',
    primary: { designator: 'GREEN' }, secondary: { designator: 'WHITE' }, reportInPoint: 'DR01', comments: 'JIM',
  });
  const p = run(S.extractControla, 'CONTROLA/AWAC/MAGIC 11/PFREQ:251.0/SFREQ:305.5/NAME:ALPHA//');
  assert.deepEqual([p.value.callsign, p.value.primary, p.value.secondary, p.value.reportInPoint], ['MAGIC11', { freqMhz: 251 }, { freqMhz: 305.5 }, 'ALPHA']);
  const o = run(S.extractControla, 'CONTROLA/OTR/SCREWTOP//');
  assert.equal(o.value.type, 'OTHER', 'H45: OTR + callsign, as L11 exports it');
  assert.deepEqual(codes(o), []);
  const bare = run(S.extractControla, 'CONTROLA/BOT/COBRA/235.6/-/E5/-//');
  assert.deepEqual(bare.value.primary, { freqMhz: 235.6 });
  assert.deepEqual(codes(bare), ['UNKNOWN_AGENCY_TYPE']);
  assert.equal(bare.value.typeRaw, 'BOT');
  assert.deepEqual(codes(run(S.extractControla, 'CONTROLA/ZZZ/NOBODY/PFREQ:abc/-//')), ['UNKNOWN_AGENCY_TYPE', 'BAD_FREQUENCY']);
});

test('ato sets: every CONTROLA agency type sits in one table (H45)', () => {
  assert.deepEqual(Object.keys(S.CONTROL_AGENCY_TYPES), ['AWAC', 'CRC', 'OTR']);
  assert.ok(Object.isFrozen(S.CONTROL_AGENCY_TYPES));
});

test('ato sets: ARINFO, the 455 example', () => {
  const r = run(S.extractArinfo, 'ARINFO/APPLE 20/4010A/B:34010/NAME:BLUE TRACK/200/ARCT:011000Z/NDAR:011015ZOCT/KLBS:30.0/PFREQ:343.3/SFREQ:277.8/AE20/ACTYP:KC10/BOM/2/TNKR:2/18-81/2-2-4//');
  const v = r.value;
  assert.equal(v.tankerCallsign, 'APPLE20');
  assert.equal(v.tankerCallsignRaw, 'APPLE 20');
  assert.equal(v.tankerMissionNumber, '4010A');
  assert.equal(v.tankerModeThree, '4010');
  assert.equal(v.arcp, 'BLUE TRACK');
  assert.equal(v.altitudeFt, 20000);
  assert.equal(v.arctUtc, Date.UTC(1998, 9, 1, 10, 0));
  assert.equal(v.endArUtc, Date.UTC(1998, 9, 1, 10, 15));
  assert.equal(v.offloadKlb, 30);
  assert.deepEqual(v.primary, { freqMhz: 343.3 });
  assert.deepEqual(v.secondary, { freqMhz: 277.8 });
  assert.equal(v.tankerType, 'KC10');
  assert.equal(v.system, 'BOM');
  assert.equal(v.tacan, '18-81');
  assert.deepEqual(codes(r), []);
  assert.equal(run(S.extractArinfo, 'ARINFO/SHELL 71/1901T/34571/NAME:ANCHOR BLUE/220/-/-/-/-/-/-/ACTYP:KC135/BOM/-/-/38Y//').value.tacan, '38Y');
});

test('ato sets: REFTSK — first KLBS total, second alert', () => {
  const r = run(S.extractReftsk, 'REFTSK/CDT/KLBS:50.0/KLBS:20.0/PFREQ:323.3/SFREQ:242.8/29-92/3-3-4//');
  assert.deepEqual(r.value, { system: 'CDT', totalOffloadKlb: 50, alertOffloadKlb: 20, primary: { freqMhz: 323.3 }, secondary: { freqMhz: 242.8 }, tacan: '29-92' });
});

const REFUEL = '5REFUEL\n/MSNNO /RECCS /NO/ACTYPE /OFLD /ARCT /SEQ /TYP /ARS\n/0131D /BEAK 31 /2/AC:F14A /KLB:20.0/010815Z /A:1 /A:JP8 /CDT//';
const EXPECT_ROW = {
  line: 3, receiverMissionNumber: '0131D', receiverCallsignRaw: 'BEAK 31', receiverCallsign: 'BEAK31', count: 2,
  aircraftType: 'F14A', offloadKlb: 20, arctUtc: Date.UTC(1998, 9, 1, 8, 15), arctRaw: '010815Z', sequence: '1', fuelType: 'JP8', system: 'CDT',
};

test('ato sets: 5REFUEL by header name', () => {
  const r = run(S.extract5Refuel, REFUEL);
  assert.deepEqual(r.value.rows, [EXPECT_ROW]);
  assert.deepEqual(r.heuristics, []);
});

test('ato sets: 5REFUEL with its header reordered still maps by name', () => {
  const r = run(S.extract5Refuel, '5REFUEL\n/ARS /RECCS /MSNNO /NO/ACTYPE /OFLD /ARCT /SEQ /TYP\n/CDT /BEAK 31 /0131D /2/AC:F14A /KLB:20.0/010815Z /A:1 /A:JP8//');
  assert.deepEqual(r.value.rows, [EXPECT_ROW]);
});

test('ato sets: 5REFUEL rows without descriptors ([CO]) read the same', () => {
  const r = run(S.extract5Refuel, '5REFUEL/\n/MSNNO/RECCS/NO/ACTYPE/OFLD/ARCT/SEQ/TYP/ARS\n/205/UZI1/2/F-16C_50/-/010454ZOCT/-/-/-//');
  assert.equal(r.value.rows[0].receiverCallsign, 'UZI1');
  assert.equal(r.value.rows[0].offloadKlb, null);
});

test('ato sets: 7CONTROL, 9PKGDAT, PKGCMD', () => {
  const c = run(S.extract7Control, '7CONTROL\n/MSNNO /ACSIGN /NO/ACTYPE /MSNTY /TOSTA /RIP\n/0111I /TALON 11 /3/AC:A6E /INT /010930Z /2840N08040W//');
  assert.deepEqual(c.value.rows[0], {
    line: 3, missionNumber: '0111I', callsignRaw: 'TALON 11', callsign: 'TALON11', count: 3, aircraftType: 'A6E',
    missionType: 'INT', onStationUtc: Date.UTC(1998, 9, 1, 9, 30), onStationRaw: '010930Z', reportInPoint: '2840N08040W',
  });
  const p = run(S.extract9Pkgdat, '9PKGDAT\n/PKGID /UNIT /MSNNO /PMSN /NO/ACTYPE /ACSIGN\n/AAF /4FW /0101E /INT /4/AC:F15E /LIGHTNING 01//');
  assert.equal(p.value.rows[0].callsign, 'LIGHTNING01');
  assert.equal(p.value.rows[0].packageId, 'AAF');
  const k = run(S.extractPkgcmd, 'PKGCMD/AN/CVN68 VA-165/0111I/TALON 11//');
  assert.deepEqual(k.value, { packageId: 'AN', unit: 'CVN68 VA-165', missionNumber: '0111I', callsignRaw: 'TALON 11', callsign: 'TALON11' });
});

test('ato sets: normaliseCallsign never abbreviates', () => {
  assert.deepEqual(S.normaliseCallsign('SHADOW-1'), { raw: 'SHADOW-1', normalised: 'SHADOW1', valid: true });
  assert.deepEqual(S.normaliseCallsign('Knight 2'), { raw: 'Knight 2', normalised: 'KNIGHT2', valid: true });
  assert.deepEqual(S.normaliseCallsign('LIGHTNING 01'), { raw: 'LIGHTNING 01', normalised: 'LIGHTNING01', valid: false });
  assert.deepEqual(S.normaliseCallsign(null), { raw: null, normalised: null, valid: false });
});
