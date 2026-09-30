'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../public/js/usmtf-ato.js');
const I = U._internal;

const D = (year, month, day, hour, minute) => ({ year, month, day, hour, minute });

test('formatDtg: the three forms, and null', () => {
  const d = D(2026, 7, 4, 2, 20);
  assert.equal(I.formatDtg(d, 'full'), '040220ZJUL2026');
  assert.equal(I.formatDtg(d, 'mon'), '040220ZJUL');
  assert.equal(I.formatDtg(d, 'short'), '040220Z');
  assert.equal(I.formatDtg(null, 'mon'), '-');
});

test('placeTime: same day at or after FROM, next day before it', () => {
  const from = D(2026, 7, 4, 2, 20);
  assert.deepEqual(I.placeTime(3 * 60, from), D(2026, 7, 4, 3, 0));
  assert.deepEqual(I.placeTime(2 * 60 + 20, from), D(2026, 7, 4, 2, 20));
  assert.deepEqual(I.placeTime(1 * 60 + 30, from), D(2026, 7, 5, 1, 30));
});

test('placeTime: rollover across month, year and leap day', () => {
  assert.deepEqual(I.placeTime(60, D(2026, 12, 31, 23, 0)), D(2027, 1, 1, 1, 0));
  assert.equal(I.formatDtg(I.placeTime(60, D(2026, 12, 31, 23, 0)), 'full'), '010100ZJAN2027');
  assert.deepEqual(I.placeTime(10, D(2028, 2, 28, 12, 0)), D(2028, 2, 29, 0, 10));
  assert.equal(I.formatDtg(I.placeTime(10, D(2028, 2, 28, 12, 0)), 'mon'), '290010ZFEB');
  assert.deepEqual(I.placeTime(10, D(2026, 2, 28, 12, 0)), D(2026, 3, 1, 0, 10));
});

test('addMinutes: 24 h - 1 min', () => {
  assert.deepEqual(I.addMinutes(D(2026, 9, 14, 6, 0), 1439), D(2026, 9, 15, 5, 59));
});

test('parseHhmm: accepted and refused inputs', () => {
  assert.deepEqual(I.parseHhmm('0300Z'), { minutes: 180, local: false });
  assert.deepEqual(I.parseHhmm('0300'), { minutes: 180, local: false });
  assert.deepEqual(I.parseHhmm('0300L'), { minutes: 180, local: true });
  assert.deepEqual(I.parseHhmm(300), { minutes: 180, local: false });
  assert.deepEqual(I.parseHhmm(240), { minutes: 160, local: false }); // unquoted 0240
  assert.deepEqual(I.parseHhmm('2359z'), { minutes: 1439, local: false });
  assert.equal(I.parseHhmm('2400'), null);
  assert.equal(I.parseHhmm('12:00'), null);
  assert.equal(I.parseHhmm('0360'), null);
  assert.equal(I.parseHhmm(null), null);
  assert.equal(I.parseHhmm(''), null);
  assert.equal(I.parseHhmm(12.5), null);
});

test('parseIsoDate: string, Date object, invalid', () => {
  assert.deepEqual(I.parseIsoDate('2026-07-04'), { year: 2026, month: 7, day: 4 });
  assert.deepEqual(I.parseIsoDate(new Date(Date.UTC(2026, 6, 4))), { year: 2026, month: 7, day: 4 });
  assert.equal(I.parseIsoDate('2026-02-30'), null);
  assert.equal(I.parseIsoDate('04.07.2026'), null);
  assert.equal(I.parseIsoDate(undefined), null);
});

test('dmsToUsmtf: DMS, DM, 2-digit longitude, hemispheres, carry, malformed', () => {
  assert.equal(I.dmsToUsmtf(`N27°11'30" E056°18'45"`), '271130N0561845E');
  assert.equal(I.dmsToUsmtf(`N33°30.150' E36°16.183'`), '333009N0361611E');
  assert.equal(I.dmsToUsmtf(`N33°21'12" E36°32'52"`), '332112N0363252E');
  assert.equal(I.dmsToUsmtf(`S12°03'04" W077°02'05"`), '120304S0770205W');
  assert.equal(I.dmsToUsmtf(`N10°59'59.99" E020°59'59.6"`), '110000N0210000E');
  assert.equal(I.dmsToUsmtf('somewhere near the river'), null);
  assert.equal(I.dmsToUsmtf(''), null);
  assert.equal(I.formatLatLon({ lat: 33.5025, lon: 36.269717 }), '333009N0361611E');
});

test('iffToken: every mode, malformed and reserved codes', () => {
  const W = new I.Warnings();
  assert.equal(I.iffToken(1, '12', W), '112');
  assert.equal(I.iffToken(2, '0011', W), '20011');
  assert.equal(I.iffToken(3, '4521', W), '34521');
  assert.equal(I.iffToken(3, null, W), '-');
  assert.equal(W.list.length, 0);
  assert.equal(I.iffToken(1, '14', W), '-');          // second Mode 1 digit above 3
  assert.equal(I.iffToken(3, '4581', W), '-');        // non-octal
  assert.equal(I.iffToken(2, '001', W), '-');         // too short
  assert.equal(W.list[0].code, 'IFF_MALFORMED');
  assert.equal(I.iffToken(3, '7700', W), '37700');    // emitted, with a warning
  assert.ok(W.list.some((w) => w.code === 'IFF_RESERVED'));
});

test('frequency, altitude and offload formatting', () => {
  assert.equal(I.formatFreq(251), '251.0');
  assert.equal(I.formatFreq('261.500'), '261.5');
  assert.equal(I.formatFreq('318.425'), '318.425');
  assert.equal(I.formatFreq(305.5), '305.5');
  assert.equal(I.formatFreq('276.10'), '276.1');
  const W = new I.Warnings();
  assert.equal(I.formatFreq('abc', W), '-');
  assert.equal(W.list[0].code, 'BAD_FREQUENCY');
  assert.equal(I.formatAltitude(25000), '250');
  assert.equal(I.formatAltitude(6562), '66');
  assert.equal(I.formatAltitude(null), '-');
  assert.equal(I.formatOffload(12), '12.0');
  assert.equal(I.formatOffload('60'), '60.0');
  assert.equal(I.formatOffload(16.25), '16.3');
});

test('sanitiseField', () => {
  const W = new I.Warnings();
  assert.equal(I.sanitiseField('Ground (SA-2 Guideline / S-75)', W), 'GROUND (SA-2 GUIDELINE S-75)');
  assert.equal(W.list.length, 1);
  assert.equal(W.list[0].code, 'CHARSET_REPLACED');
  const W2 = new I.Warnings();
  assert.equal(I.sanitiseField('shadow_1', W2), 'SHADOW 1');
  assert.equal(I.sanitiseField('  command   bunker ', W2), 'COMMAND BUNKER');
  assert.equal(I.sanitiseField('400+2X88C', W2), '400+2X88C');
  assert.equal(I.sanitiseField('line1\nline2', W2), 'LINE1 LINE2');
  assert.equal(W2.list.length, 0, 'case, _ and whitespace are benign');
  assert.equal(I.sanitiseField('N33°21', W2), 'N33 21');
  assert.equal(W2.list[0].code, 'CHARSET_REPLACED');
  assert.equal(I.sanitiseField('', null), '-');
  assert.equal(I.sanitiseField(null, null), '-');
  assert.equal(I.sanitiseField('°', null), '-');
});

test('callsign normalisation and seedability (L3 §5.6)', () => {
  assert.equal(I.normaliseCallsign('SHADOW-1'), 'SHADOW 1');
  assert.equal(I.normaliseCallsign('Knight_2'), 'KNIGHT 2');
  assert.equal(I.callsignSeedable('VIPER 11'), true);
  assert.equal(I.callsignSeedable('MAGIC 11'), true);
  assert.equal(I.callsignSeedable('LIGHTNING 01'), false);
  assert.equal(I.callsignSeedable('WEASEL 41'), false);
  assert.equal(I.callsignSeedable(''), false);
});

test('usmtfFileName is sanitised', () => {
  assert.equal(U.usmtfFileName({ header: { operation: 'OPERATION JASMINE/WAVE1', ato_date: '2026-07-04' }, ato: {} }),
    'OPERATION_JASMINEWAVE1_2026-07-04.usmtf.txt');
  assert.equal(U.usmtfFileName({ ato: {} }), 'ATO_undated.usmtf.txt');
});
