'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../public/js/usmtf-ato.js');
const { logicalSets } = require('./helpers/usmtf-normalise.js');

function base(over) {
  const pkg = {
    header: { operation: 'OP TEST', ato_date: '2026-07-04', classification: 'UNCLAS' },
    ato: {
      ingame_start_time: '0220Z',
      missions: [{
        mission_number: 'MSN1896', callsign: 'shadow-1', mission_type: 'Pinpoint Strike', unit: 'TEST SQN',
        deploy: 'LTAG', recovery: 'LTAG', takeoff_time: '0300', recovery_time: '0705',
        aircraft: { count: 2, type: 'F16C', loadout: '400+2X88C' },
      }],
    },
    registry: { airfields: { LTAG: { name: 'Incirlik' } } },
  };
  if (over) over(pkg);
  return pkg;
}
const M = (pkg) => pkg.ato.missions[0];
const build = (pkg) => U.buildUsmtf(pkg);
const sets = (pkg) => logicalSets(build(pkg).text);
const codes = (r) => r.warnings.map((w) => w.code);
const doc = (pkg) => U.atobriefToAtoDoc(pkg).doc;
const msn = (pkg, i = 0) => {
  const all = [];
  doc(pkg).units.forEach((u) => u.missions.forEach((m) => all.push(m)));
  return all[i];
};

test('errors: NOT_A_PACKAGE and NO_ATO_DATE refuse the export', () => {
  assert.equal(build(null).errors[0].code, 'NOT_A_PACKAGE');
  assert.equal(build({ header: {} }).errors[0].code, 'NOT_A_PACKAGE');
  const r = build(base((p) => { delete p.header.ato_date; }));
  assert.equal(r.text, null);
  assert.equal(r.errors[0].code, 'NO_ATO_DATE');
  assert.throws(() => U.packageToUsmtf(base((p) => { p.header.ato_date = 'July'; })), (e) => e.errors[0].code === 'NO_ATO_DATE');
});

test('ato.ato_day (runtime copy) is the date fallback', () => {
  const r = build(base((p) => { delete p.header.ato_date; p.ato.ato_day = '2026-07-04'; }));
  assert.deepEqual(r.errors, []);
});

test('NO_MISSIONS gives a header-only message', () => {
  const r = build(base((p) => { p.ato.missions = []; }));
  assert.ok(codes(r).includes('NO_MISSIONS'));
  assert.doesNotMatch(r.text, /TSKCNTRY|AMSNDAT/);
});

test('classification: always UNCLAS (H44), info when the package says otherwise', () => {
  const r = build(base((p) => { p.header.classification = 'SECRET'; }));
  assert.equal(r.text.split('\n')[0], 'UNCLAS');
  assert.ok(codes(r).includes('CLASSIFICATION_FORCED_UNCLAS'));
  assert.ok(!codes(build(base())).includes('CLASSIFICATION_FORCED_UNCLAS'));
});

test('operation falls back to ato.operation, then UNNAMED OPERATION', () => {
  assert.equal(sets(base((p) => { delete p.header.operation; p.ato.operation = 'OP B'; }))[0], 'EXER/OP B//');
  const r = build(base((p) => { delete p.header.operation; }));
  assert.equal(logicalSets(r.text)[0], 'EXER/UNNAMED OPERATION//');
  assert.ok(codes(r).includes('OPERATION_MISSING'));
});

test('timeframe: default start, derived end', () => {
  const r = build(base((p) => { delete p.ato.ingame_start_time; }));
  assert.ok(logicalSets(r.text).includes('TIMEFRAM/FROM:040000ZJUL2026/TO:042359ZJUL2026//'));
  assert.ok(codes(r).includes('TIMEFRAME_DEFAULTED'));
  assert.ok(codes(r).includes('TIMEFRAME_END_DERIVED'));
});

test('times: rollover past midnight, numbers, L converted, bad time warns', () => {
  const d = msn(base((p) => {
    p.ato.ingame_start_time = '2300Z';
    p.ato.local_offset_hours = 3;
    M(p).takeoff_time = 2330;           // number
    M(p).recovery_time = '0400L';        // local → 0100Z next day
  }));
  assert.deepEqual(d.departure.time, { year: 2026, month: 7, day: 4, hour: 23, minute: 30 });
  assert.deepEqual(d.recovery.time, { year: 2026, month: 7, day: 5, hour: 1, minute: 0 });
  const r = build(base((p) => { M(p).takeoff_time = '25:00'; }));
  assert.ok(codes(r).includes('BAD_TIME'));
  assert.match(logicalSets(r.text).find((s) => s.startsWith('AMSNDAT')), /DEPLOC:LTAG\/-\/ARRLOC/);
});

test('mission number: MSN stripped, missing and duplicate warn', () => {
  assert.equal(msn(base()).missionNumber, '1896');
  let r = build(base((p) => { delete M(p).mission_number; }));
  assert.ok(codes(r).includes('MISSING_MISSION_NUMBER'));
  r = build(base((p) => { p.ato.missions.push(Object.assign({}, M(p))); }));
  assert.ok(codes(r).includes('DUPLICATE_MISSION_NUMBER'));
});

test('mission type verbatim upper-cased; callsign normalised; seedability info', () => {
  const s = sets(base());
  assert.ok(s.some((x) => x.startsWith('AMSNDAT/N/1896/-/-/-/PINPOINT STRIKE/')));
  assert.ok(s.includes('MSNACFT/2/ACTYP:F16C/SHADOW 1/400+2X88C/-/-/-/-/-/-/-//'));
  const r = build(base((p) => { M(p).callsign = 'LIGHTNING 01'; }));
  assert.ok(codes(r).includes('CALLSIGN_NOT_SEEDABLE'));
});

test('aircraft count missing → 1 with BAD_AIRCRAFT_COUNT', () => {
  const r = build(base((p) => { delete M(p).aircraft.count; }));
  assert.ok(codes(r).includes('BAD_AIRCRAFT_COUNT'));
  assert.ok(logicalSets(r.text).some((x) => x.startsWith('MSNACFT/1/')));
});

test('units: grouped in order of first appearance; DEFAULT_UNIT; ICAO only from registry.airfields or units.base', () => {
  const pkg = base((p) => {
    p.ato.missions.push({ mission_number: 'MSN2', callsign: 'A1', mission_type: 'CAP', deploy: 'CVN-1', aircraft: { count: 1, type: 'FA18C' } });
    p.ato.missions.push({ mission_number: 'MSN3', callsign: 'A2', mission_type: 'CAP', unit: 'TEST SQN', aircraft: { count: 1, type: 'F16C' } });
    p.registry.carriers = { 'CVN-1': { name: 'X' } };
  });
  const r = build(pkg);
  const s = logicalSets(r.text);
  const tus = s.filter((x) => x.startsWith('TASKUNIT'));
  assert.deepEqual(tus, ['TASKUNIT/TEST SQN/ICAO:LTAG//', 'TASKUNIT/SOURCE DCS//']);
  assert.ok(s.indexOf('TASKUNIT/SOURCE DCS//') > s.findIndex((x) => x.startsWith('AMSNDAT/N/3/')), 'MSN3 grouped under TEST SQN');
  const w = r.warnings.find((x) => x.code === 'DEFAULT_UNIT');
  assert.match(w.message, /: 2$/);
  pkg.registry.units = { 'SOURCE DCS': { base: 'LTAN', remarks: 'alert pad' } };
  const s2 = sets(pkg);
  assert.ok(s2.includes('TASKUNIT/SOURCE DCS/ICAO:LTAN//'));
  assert.ok(s2.includes('GENTEXT/UNIT REMARKS/ALERT PAD//'));
});

test('header.usmtf overrides the module defaults; opts.defaults too', () => {
  const pkg = base((p) => {
    p.header.usmtf = { message_kind: 'oper', originator: 'CAOC', serial: 'ATO B', asof: '2026-07-03 1800Z',
      country: 'RU', service: 'A', default_unit: 'RED SQN' };
    delete M(p).unit;
  });
  const s = sets(pkg);
  assert.equal(s[0], 'OPER/OP TEST//');
  assert.equal(s[1], 'MSGID/ATO/CAOC/ATO B/JUL//');
  assert.equal(s[3], 'TIMEFRAM/FROM:040220ZJUL2026/TO:050219ZJUL2026/ASOF:031800ZJUL2026//');
  assert.ok(s.includes('TSKCNTRY/RU//') && s.includes('SVCTASK/A//') && s.includes('TASKUNIT/RED SQN/ICAO:LTAG//'));
  const s2 = logicalSets(U.buildUsmtf(base((p) => { delete M(p).unit; }), { defaults: { unit: 'X SQN', country: 'GB' } }).text);
  assert.ok(s2.includes('TSKCNTRY/GB//') && s2.includes('TASKUNIT/X SQN/ICAO:LTAG//'));
  const bad = build(base((p) => { p.header.usmtf = { asof: 'yesterday', message_kind: 'DRILL' }; }));
  assert.ok(codes(bad).includes('BAD_TIME') && codes(bad).includes('BAD_MESSAGE_KIND'));
});

test('codewords: sorted by placed time, then YAML order; omitted when empty', () => {
  const s = sets(base((p) => {
    p.ato.codewords = [{ word: 'B', time: '0435Z' }, { word: 'A', time: '0100Z' }, { word: 'C', time: '0435Z' }, { word: 'D', time: '0300Z' }];
  }));
  assert.ok(s.includes('GENTEXT/CODEWORDS/D AT 040300Z, B AT 040435Z, C AT 040435Z, A AT 050100Z//'));
  assert.ok(!sets(base()).some((x) => x.startsWith('GENTEXT')));
});

test('ato.targets (runtime injection) is ignored; _vul_* is never exported', () => {
  const pkg = base((p) => {
    p.ato.targets = [{ id: 'X', name: 'Should not appear' }];
    M(p).steer_points = [{ id: 'IP-1', time: '0400' }];
    M(p)._vul_start = '0400';
    M(p)._vul_end = '0430';
    p.registry.steerpoints = [{ id: 'IP-1', type: 'ip', coords: `N33°00'00" E36°00'00"` }];
  });
  const s = sets(pkg);
  assert.ok(s.includes('AMSNLOC/-//'), 'IP time is not a vul window');
  assert.ok(!s.join('').includes('SHOULD NOT APPEAR'));
  assert.ok(codes(build(pkg)).includes('VUL_MISSING'));
});

test('AMSNLOC from the first target with TOS; TOFFS_WITHOUT_TOS', () => {
  const r = build(base((p) => {
    M(p).targets = [{ target_id: 'T0', toffs: '0450' }, { target_id: 'T1', tos: '0420', toffs: '0515' }];
  }));
  assert.ok(logicalSets(r.text).includes('AMSNLOC/040420ZJUL/040515ZJUL//'));
  assert.ok(codes(r).includes('TOFFS_WITHOUT_TOS'));
});

test('explicit vul window wins over TOS (H43)', () => {
  const s = sets(base((p) => {
    M(p).targets = [{ tos: '0420', toffs: '0515' }];
    M(p).vul = { start: '0400Z', end: '0600Z' };
    M(p).priority = 2;
  }));
  assert.ok(s.includes('AMSNLOC/040400ZJUL/040600ZJUL/-/-/2//'));
});

test('AMSNLOC name/altitude from the first orbit: inline, registry ref, orbit.alt_ft', () => {
  const orbit = { heading_deg: 90, leg_nm: 10, width_nm: 5, cw: true };
  let s = sets(base((p) => { M(p).steer_points = [{ name: 'X', coords: 'N1°0\'0" E1°0\'0"' }, { name: 'CAP1', altitude_ft: 25000, orbit }]; }));
  assert.ok(s.includes('AMSNLOC/-/-/CAP1/250//'));
  s = sets(base((p) => { M(p).steer_points = [{ name: '', altitude_ft: 25000, orbit: { ...orbit, alt_ft: 31000 } }]; }));
  assert.ok(s.includes('AMSNLOC/-/-/-/310//'));
  s = sets(base((p) => {
    M(p).steer_points = [{ id: 'CAP-A' }];
    p.registry.steerpoints = [{ id: 'CAP-A', name: 'CAP ALPHA', altitude_ft: 22000, orbit }];
  }));
  assert.ok(s.includes('AMSNLOC/-/-/CAP ALPHA/220//'));
});

test('GTGTLOC wins over TOS, one per timed target, registry name/type/coords/elevation', () => {
  const pkg = base((p) => {
    M(p).target = undefined;
    M(p).targets = [
      { target_id: 'SAM-1', tos: '0420', toffs: '0515' },
      { target_id: 'ministry', tot_net: '0505', tot_nlt: '0510', tos: '0425', toffs: '0510' },
      { target_id: 'SAM-9', tot_nlt: '0530' },
    ];
    p.registry.targets = {
      ministry: { name: 'Ministry of Foreign Affairs', coords: `N33°30.150' E36°16.183'` },
      'SAM-1': { name: 'Ground (SA-2 Guideline / S-75)', type: 'SA-2', coords: 'bad', elevation: '2018ft' },
    };
  });
  const r = build(pkg);
  const g = logicalSets(r.text).filter((x) => x.startsWith('GTGTLOC'));
  assert.deepEqual(g, [
    'GTGTLOC/P/-/NET:040505ZJUL/NLT:040510Z/MINISTRY OF FOREIGN AFFAIRS/ID:MINISTRY/-/-/DMPIS:333009N0361611E/WE//',
    'GTGTLOC/P/-/-/NLT:040530Z/-/ID:SAM-9//',
  ]);
  assert.ok(codes(r).includes('TOS_DROPPED_FOR_GTGTLOC'));
  assert.ok(codes(r).includes('UNKNOWN_TARGET'));
  assert.ok(!logicalSets(r.text).some((x) => x.startsWith('AMSNLOC')));
});

test('legacy singular target counts as targets: [target]', () => {
  const s = sets(base((p) => { M(p).target = { tot_nlt: '0510' }; }));
  assert.ok(s.includes('GTGTLOC/P/-/-/NLT:040510Z//'));
});

test('GTGTLOC coords from the registry, elevation digits, name sanitised', () => {
  const r = build(base((p) => {
    M(p).targets = [{ target_id: 'SAM-1', tot_net: '0500' }];
    p.registry.targets = { 'SAM-1': { name: 'Ground (SA-2 Guideline / S-75)', type: 'SA-2', coords: `N33°21'12" E36°32'52"`, elevation: '2018ft' } };
  }));
  assert.ok(logicalSets(r.text).includes(
    'GTGTLOC/P/-/NET:040500ZJUL/-/GROUND (SA-2 GUIDELINE S-75)/ID:SAM-1/SA-2/-/DMPIS:332112N0363252E/WE/2018FT//'));
  assert.ok(codes(r).includes('CHARSET_REPLACED'));
});

test('control: resolved agency, types to AWAC/CRC/OTR, mission freq overrides registry', () => {
  const agencies = {
    DARK: { type: 'AWACS', callsign: 'Darkstar', primary_freq_mhz: '251.000', secondary_freq_mhz: 305.5 },
    TH: { type: 'ABM', callsign: 'THUMPER', primary_freq_mhz: '318.425' },
    MG: { type: 'IC', callsign: 'MAGIC' },
    RD: { type: 'RADAR', callsign: 'LTAG RADAR' },
    CR: { type: 'crc', callsign: 'CROWN' },
  };
  const withAgency = (id, extra) => base((p) => { p.registry.control_agencies = agencies; M(p).control = Object.assign({ agency_id: id }, extra); });
  assert.ok(sets(withAgency('DARK', { report_in_point: 'Alpha' })).includes('CONTROLA/AWAC/DARKSTAR/PFREQ:251.0/SFREQ:305.5/NAME:ALPHA//'));
  assert.ok(sets(withAgency('DARK', { primary_freq_mhz: '260.1' })).includes('CONTROLA/AWAC/DARKSTAR/PFREQ:260.1/SFREQ:305.5//'));
  assert.ok(sets(withAgency('CR')).includes('CONTROLA/CRC/CROWN//'));
  ['TH', 'MG', 'RD'].forEach((id) => {
    const r = build(withAgency(id));
    assert.ok(logicalSets(r.text).some((x) => x.startsWith('CONTROLA/OTR/')), id);
    assert.ok(codes(r).includes('AGENCY_TYPE_OTR'), id);
  });
  const r = build(withAgency('NOPE'));
  assert.ok(codes(r).includes('UNKNOWN_AGENCY'));
  assert.ok(!logicalSets(r.text).some((x) => x.startsWith('CONTROLA')));
  const rip = build(withAgency('DARK'));
  assert.ok(codes(rip).includes('RIP_MISSING'));
  assert.equal(U.AGENCY_TYPE_MAP.AWACS, 'AWAC');
});

test('refuel: list and dict tankers, sorted by time_from, unresolved skipped', () => {
  const tankersDict = { TEXACO11: { callsign: 'TEXACO11', altitude_ft: 12000, freq_mhz: 251, tacan: '39x' }, 'Mauler 6': { callsign: 'Mauler 6' } };
  const refuel = [{ tanker_id: 'TEXACO11', time_from: '0535', time_to: '0605' }, { tanker_id: 'TEXACO11', time_from: '0345', time_to: '0405' },
    { tanker_id: 'Mauler 6', time_from: '0400' }, { tanker_id: 'GHOST', time_from: '0300' }];
  const mk = (tankers) => base((p) => {
    p.registry.tankers = tankers;
    p.registry.callsigns = { TEXACO11: { type: 'KC135' } };
    M(p).refuel = refuel.map((r) => ({ ...r }));
  });
  const dict = build(mk(tankersDict));
  const list = build(mk([{ id: 'TEXACO11', ...tankersDict.TEXACO11 }, { callsign: 'Mauler 6' }]));
  assert.equal(dict.text, list.text);
  const ar = logicalSets(dict.text).filter((x) => x.startsWith('ARINFO'));
  assert.deepEqual(ar, [
    'ARINFO/TEXACO11/-/-/-/120/ARCT:040345Z/NDAR:040405ZJUL/-/PFREQ:251.0/-/-/ACTYP:KC135/-/-/-/39X//',
    'ARINFO/MAULER 6/-/-/-/-/ARCT:040400Z/-/-/-/-/-/-/-/-/-/-//',
    'ARINFO/TEXACO11/-/-/-/120/ARCT:040535Z/NDAR:040605ZJUL/-/PFREQ:251.0/-/-/ACTYP:KC135/-/-/-/39X//',
  ]);
  assert.ok(codes(dict).includes('UNKNOWN_TANKER'));
  assert.ok(codes(dict).includes('AR_DETAIL_MISSING'));
  assert.ok(codes(dict).includes('SUPPORT_MISSIONS_NOT_EXPORTED'));
  const bt = build(base((p) => { p.registry.tankers = { T: { callsign: 'T1', tacan: 'CH39' } }; M(p).refuel = [{ tanker_id: 'T' }]; }));
  assert.ok(codes(bt).includes('BAD_TACAN'));
});

test('refuel tanker_id may match the tanker callsign', () => {
  const s = sets(base((p) => { p.registry.tankers = { T1: { callsign: 'ARCO4' } }; M(p).refuel = [{ tanker_id: 'ARCO4' }]; }));
  assert.ok(s.some((x) => x.startsWith('ARINFO/ARCO4/')));
});

test('IFF from SPINS C3: stripped-number join, number-typed code, unmatched row', () => {
  const pkg = base((p) => {
    p.spins = { sections: [
      { title: 'C1 — COMMAND', markdown: 'x' },
      { title: 'C3 — IFF / SIF', table: { headers: ['MSN', 'MODE', 'CODE'], rows: [['MSN1896', '3', 11], ['1897', '3', '4002']] } },
    ] };
  });
  const r = build(pkg);
  assert.ok(logicalSets(r.text).some((x) => x.startsWith('MSNACFT/') && x.endsWith('/30011//')));
  assert.ok(codes(r).includes('IFF_NOT_STRING'));
  assert.ok(codes(r).includes('IFF_ROW_UNMATCHED'));
  assert.ok(codes(r).includes('IFF_MODE12_MISSING'));
});

test('mission iff (H43) wins over SPINS C3, with IFF_SPINS_MISMATCH', () => {
  const r = build(base((p) => {
    M(p).iff = { mode1: '12', mode2: '0011', mode3: '4521' };
    p.spins = { sections: [{ title: 'C3 — IFF', table: { headers: ['MSN', 'MODE', 'CODE'], rows: [['1896', '3', '4001']] } }] };
  }));
  assert.ok(logicalSets(r.text).some((x) => x.endsWith('/112/20011/34521//')));
  assert.ok(codes(r).includes('IFF_SPINS_MISMATCH'));
  assert.ok(!codes(r).includes('IFF_MODE12_MISSING'));
  const bad = build(base((p) => { M(p).iff = { mode1: '19', mode3: '7700' }; }));
  assert.ok(codes(bad).includes('IFF_MALFORMED') && codes(bad).includes('IFF_RESERVED'));
});

test('datalink (H43): L16 callsign / TACAN / JU in MSNACFT f6–f8', () => {
  const r = build(base((p) => { M(p).datalink = { l16_callsign: 'vp11', tacan: '38y', ju: 11 }; }));
  assert.ok(logicalSets(r.text).includes('MSNACFT/2/ACTYP:F16C/SHADOW 1/400+2X88C/-/VP11/38Y/00011/-/-/-//'));
  assert.ok(codes(r).includes('DATALINK_NOT_STRING'));
  assert.ok(!codes(r).includes('DATALINK_MISSING'));
});

test('alert status and narrative (H43)', () => {
  const s = sets(base((p) => { M(p).alert_status = 'gh15'; M(p).narrative = ['push at 0445z / hold at IP', '']; }));
  assert.ok(s.some((x) => x.startsWith('AMSNDAT/N/1896/-/-/-/PINPOINT STRIKE/-/GH15/')));
  assert.ok(s.includes('NARR/PUSH AT 0445Z HOLD AT IP//'));
});

test('package (H43): MC in AMSNDAT, 9PKGDAT in the commander, PKGCMD in members', () => {
  const pkg = base((p) => {
    M(p).package_id = 'ab';
    M(p).package_commander = true;
    p.ato.missions.push({ mission_number: 'MSN1897', callsign: 'SNAKE 41', mission_type: 'SEAD', unit: 'TEST SQN', package_id: 'AB', aircraft: { count: 2, type: 'F16C' } });
    p.ato.missions.push({ mission_number: 'MSN1899', callsign: 'LONE 1', mission_type: 'CAP', package_id: 'ZZ', aircraft: { count: 1, type: 'F16C' } });
  });
  const r = build(pkg);
  const s = logicalSets(r.text);
  assert.ok(s.some((x) => x.startsWith('AMSNDAT/N/1896/-/AB/MC/')));
  assert.ok(s.some((x) => x.startsWith('AMSNDAT/N/1897/-/AB/-/')));
  assert.ok(s.includes('PKGCMD/AB/TEST SQN/1896/SHADOW 1//'));
  assert.ok(r.text.includes('9PKGDAT\n/PKGID /UNIT     /MSNNO /PMSN            /NO /ACTYPE  /ACSIGN\n'));
  assert.ok(codes(r).includes('PACKAGE_WITHOUT_COMMANDER'));
  const two = build(base((p) => {
    M(p).package_id = 'AB'; M(p).package_commander = true;
    p.ato.missions.push({ mission_number: 'MSN2', callsign: 'X', package_id: 'AB', package_commander: true, aircraft: { count: 1 } });
  }));
  assert.ok(codes(two).includes('PACKAGE_MULTIPLE_COMMANDERS'));
});

test('tanker mission (H43): linked by mission_number → ARINFO detail, REFTSK, 5REFUEL', () => {
  const pkg = base((p) => {
    M(p).refuel = [{ tanker_id: 'SHELL71', time_from: '0345', time_to: '0400', offload_klb: 12 }];
    p.ato.missions.push({ mission_number: 'MSN1901T', callsign: 'SHELL 71', mission_type: 'REFUELING', unit: '909ARS',
      aircraft: { count: 1, type: 'KC135' }, iff: { mode3: '4571' } });
    p.registry.tankers = { SHELL71: { callsign: 'SHELL 71', mission_number: 'MSN1901T', arcp: 'ANCHOR BLUE', altitude_ft: 22000,
      freq_mhz: 276.1, tacan: '38Y', system: 'drogue', offload_klb: 60, alert_offload_klb: 10, fuel: 'jp8' } };
  });
  const r = build(pkg);
  const s = logicalSets(r.text);
  assert.ok(s.includes('ARINFO/SHELL 71/1901T/34571/NAME:ANCHOR BLUE/220/ARCT:040345Z/NDAR:040400ZJUL/KLBS:12.0/PFREQ:276.1/-/-/ACTYP:KC135/DROGUE/-/-/38Y//'));
  assert.ok(s.includes('REFTSK/DROGUE/KLBS:60.0/KLBS:10.0/PFREQ:276.1/-/38Y//'));
  assert.ok(s.includes('AMSNLOC/-/-/ANCHOR BLUE/220//'), 'tanker mission falls back to ARCP + altitude');
  assert.ok(r.text.includes('\n/1896  /SHADOW 1 /2  /AC:F16C /KLB:12.0 /040345Z /A:1 /A:JP8 /DROGUE//\n'));
  assert.ok(!codes(r).includes('AR_DETAIL_MISSING'));
  assert.ok(!codes(r).includes('SUPPORT_MISSIONS_NOT_EXPORTED'));
  const bad = build(base((p) => { p.registry.tankers = { T: { callsign: 'T', mission_number: 'MSN9' } }; }));
  assert.ok(codes(bad).includes('UNKNOWN_SUPPORT_MISSION'));
});

test('control agency mission (H43): 7CONTROL with TOSTA = check-in, else first TOS, never IP', () => {
  const pkg = base((p) => {
    p.registry.control_agencies = { MAGIC: { type: 'AWACS', callsign: 'MAGIC 11', mission_number: 'MSN1801W' } };
    M(p).control = { agency_id: 'MAGIC', report_in_point: 'ALPHA', check_in_time: '0400Z' };
    M(p).steer_points = [{ id: 'IP-1', time: '0350' }];
    p.registry.steerpoints = [{ id: 'IP-1', type: 'ip' }];
    p.ato.missions.push({ mission_number: 'MSN1898', callsign: 'DUDE 21', mission_type: 'CAP', unit: 'TEST SQN',
      aircraft: { count: 2, type: 'F15E' }, control: { agency_id: 'MAGIC' }, targets: [{ tos: '0430', toffs: '0500' }] });
    p.ato.missions.push({ mission_number: 'MSN1899', callsign: 'LATE 1', mission_type: 'CAP', unit: 'TEST SQN',
      aircraft: { count: 1, type: 'F16C' }, control: { agency_id: 'MAGIC' } });
    p.ato.missions.push({ mission_number: 'MSN1801W', callsign: 'MAGIC 11', mission_type: 'AEW', unit: '960AACS', aircraft: { count: 1, type: 'E3' } });
  });
  const text = build(pkg).text;
  assert.match(text, /\n7CONTROL\n\/MSNNO \/ACSIGN   \/NO \/ACTYPE  \/MSNTY\s+\/TOSTA   \/RIP\n/);
  assert.match(text, /\n\/1896  \/SHADOW 1 \/2  \/AC:F16C \/PINPOINT STRIKE \/040400Z \/ALPHA\n/);
  assert.match(text, /\/1898  \/DUDE 21  \/2  \/AC:F15E \/CAP\s+\/040430Z \/-\n/);
  assert.match(text, /\/1899  \/LATE 1   \/1  \/AC:F16C \/CAP\s+\/-\s+\/-\/\/\n/);
  assert.doesNotMatch(text, /040350Z/, 'the IP time never becomes TOSTA');
});
