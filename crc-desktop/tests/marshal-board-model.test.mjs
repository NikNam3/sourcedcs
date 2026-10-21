import test from 'node:test';
import assert from 'node:assert/strict';

// The recovery board's rules (crc-sync docs/adr/0114): landing order, status from the Strip, low state from typed fuel and bingo,
// past EAT, the clearance marks (amber until passed), the drop slot of a drag, and the picture's placement.

const m = await import('../app/public/js/panels/efsp/marshal-board-model.js');
const pic = await import('../app/public/js/panels/efsp/marshal-picture.js');

const T = Date.UTC(2026, 5, 1, 20, 40);
const MIN = 60_000;
const entry = (id, idx, status = 'HOLDING', o = {}) => ({
  flightDataId: id, stackIndex: idx, status, angels: 6 + idx, marshalDme: 21 + idx, pushTimeUtc: T + idx * MIN, pushWindowUtc: [T + idx * MIN - 10000, T + idx * MIN + 10000],
  pushedAtUtc: status === 'PUSHED' ? T - MIN : null, ...o,
});
const strip = (fd, stripType, state, owner = 'CV_MARSHAL') => ({ stripId: `s-${fd}`, flightDataId: fd, stripType, state, ownerPositionId: owner });
const fds = {
  a: { identity: { callsign: 'AAA', aircraftType: 'F-18C' }, military: { carrier: { sideNumber: '201', lowStateLb: 4800, bingoFuelLb: 3500, approachTurnNm: 4 } } },
  b: { identity: { callsign: 'BBB', aircraftType: 'F-14B' }, military: { carrier: { sideNumber: '102', lowStateLb: 4000, bingoFuelLb: 3500 } } },
  c: { identity: { callsign: 'CCC', aircraftType: 'E-2D' }, military: { carrier: { sideNumber: '600', lowStateLb: 3400, bingoFuelLb: 3500 } } },
  d: { identity: { callsign: 'DDD', aircraftType: 'S-3B' }, military: { carrier: {} } },
  e: { identity: { callsign: 'EEE', aircraftType: 'F-18C' }, military: { carrier: { sideNumber: '105' } } },
};
const view = (entries) => ({ derived: { MAIN: entries }, slots: { MAIN: Array.from({ length: 8 }, (_, i) => ({ stackIndex: i, angels: 6 + i, marshalDme: 21 + i })) } });
const build = (entries, strips, o = {}) => m.buildBoard({
  view: view(entries), strips, flightDataOf: (id) => fds[id], dmeOf: (s) => ({ 's-a': 4.1, 's-e': 19.5 }[s.stripId] ?? null), now: T, marginKlb: 1.0, ...o,
});

test('landing order: approach by DME, then the commenced, then the holding by slot; status from the Strip', () => {
  const b = build(
    [entry('d', 3), entry('c', 2), entry('e', 1, 'PUSHED'), entry('b', 0, 'PUSHED'), entry('a', 4, 'PUSHED')],
    [strip('a', 'FINAL', 'ON_FINAL', 'CV_APP2'), strip('b', 'FINAL', 'BOLTER_WAVEOFF', 'CV_APP1'), strip('c', 'MARSHAL', 'IN_STACK'),
      strip('d', 'MARSHAL', 'IN_STACK'), strip('e', 'MARSHAL', 'COMMENCED', 'CV_APP1')]);
  assert.deepEqual(b.rows.map((r) => [r.seq, r.flightDataId, r.status]), [[1, 'a', 'APP B'], [2, 'b', 'BOLTER'], [3, 'e', 'COMM'], [4, 'c', 'HOLD'], [5, 'd', 'HOLD']]);
  assert.equal(b.toGo, 5);
  assert.equal(b.rows.find((r) => r.flightDataId === 'c').next, true, 'Commence sits on the next holding flight');
  assert.equal(b.rows.find((r) => r.flightDataId === 'd').next, undefined);
});

test('a recovered aircraft (PATTERN at RECOVERED, crc-sync docs/adr/0137) has left the recovery: not on the board', () => {
  const b = build([entry('c', 0)], [strip('a', 'PATTERN', 'RECOVERED', 'CV_PRIFLY'), strip('b', 'PATTERN', 'IN_PATTERN', 'CV_PRIFLY'), strip('c', 'MARSHAL', 'IN_STACK')]);
  assert.deepEqual(b.rows.map((r) => [r.flightDataId, r.status]).sort(), [['b', 'PATTERN'], ['c', 'HOLD']]);
});

test('a side number names the row; without one the callsign is listed, marked', () => {
  const b = build([entry('a', 0), entry('d', 1)], [strip('a', 'MARSHAL', 'IN_STACK'), strip('d', 'MARSHAL', 'IN_STACK')]);
  assert.deepEqual(b.rows.map((r) => [r.side, r.sideMissing, r.callsign]), [['201', false, 'AAA'], ['', true, 'DDD']]);
});

test('low state: amber within the margin of bingo, red at or below it, nothing when a figure is missing', () => {
  assert.equal(m.fuelLevel(4800, 3500, 1.0), '');
  assert.equal(m.fuelLevel(4500, 3500, 1.0), 'attn');
  assert.equal(m.fuelLevel(3500, 3500, 1.0), 'danger');
  assert.equal(m.fuelLevel(3000, 3500, 1.0), 'danger');
  assert.equal(m.fuelLevel(4000, null, 1.0), '');
  assert.equal(m.fuelLevel(null, 3500, 1.0), '');
  assert.equal(m.fuelLevel(4900, 3500, 2.0), 'attn', 'the margin is the controller\'s setting');
  assert.equal(m.fuelText(4800), '4.8');
  assert.equal(m.eatMinuteText(Date.UTC(2026, 5, 1, 20, 5)), '05');
});

test('past EAT, not pushed: only a holding flight past the end of its push window', () => {
  const e = entry('c', 0);
  const early = build([e], [strip('c', 'MARSHAL', 'IN_STACK')], { now: T + 5000 });
  const late = build([e], [strip('c', 'MARSHAL', 'IN_STACK')], { now: T + 11000 });
  assert.equal(early.rows[0].late, false);
  assert.equal(late.rows[0].late, true);
  const pushed = build([entry('c', 0, 'PUSHED')], [strip('c', 'MARSHAL', 'COMMENCED', 'CV_APP1')], { now: T + 60 * MIN });
  assert.equal(pushed.rows[0].late, false);
});

test('a vacancy below the top of the stack is listed so the Marshal can close it up', () => {
  const b = build([entry('c', 0), entry('d', 3)], [strip('c', 'MARSHAL', 'IN_STACK'), strip('d', 'MARSHAL', 'IN_STACK')]);
  assert.deepEqual(b.vacancies.map((v) => v.slot), [1, 2]);
});

test('the marks are the server\'s: a holding row shows its entry\'s `unpassed`, the setting only hides them here (ADR 0115)', () => {
  const b = build([{ ...entry('c', 0), unpassed: ['angels', 'eat'] }, { ...entry('d', 1), unpassed: ['eat'] }, entry('e', 2)],
    [strip('c', 'MARSHAL', 'IN_STACK'), strip('d', 'MARSHAL', 'IN_STACK'), strip('e', 'MARSHAL', 'IN_STACK')]);
  const row = (id) => b.rows.find((r) => r.flightDataId === id);
  assert.deepEqual(m.marksOf(row('c')), { angels: true, eat: true });
  assert.deepEqual(m.marksOf(row('d')), { angels: false, eat: true });
  assert.deepEqual(m.marksOf(row('e')), { angels: false, eat: false });
  assert.deepEqual(m.marksOf(row('c'), { enabled: false }), { angels: false, eat: false }, 'the setting off shows nothing');
  // a row that is not holding never shows one (the server clears it at Commence anyway)
  assert.deepEqual(m.marksOf({ ...row('c'), kind: 'comm' }), { angels: false, eat: false });
  // the click: the op names the values as shown, so the server can refuse a clearance that changed again
  assert.deepEqual(m.passClearanceOp(row('d')), { kind: 'PassClearance', flightDataId: 'd', angels: row('d').angels, eatUtc: row('d').eatUtc });
  assert.equal(m.passClearanceOp(row('e')), null, 'nothing to pass: no op');
  assert.equal(m.passClearanceOp(row('d'), { enabled: false }), null, 'a controller who does not see the mark does not clear it');
});

test('a drag: dropped on another holding row it takes that row\'s slot; anything else is no move', () => {
  const rows = [{ flightDataId: 'a', kind: 'comm', slot: 0 }, { flightDataId: 'c', kind: 'hold', slot: 1 }, { flightDataId: 'd', kind: 'hold', slot: 2 }, { flightDataId: 'e', kind: 'hold', slot: 3 }];
  assert.equal(m.dropSlot(rows, 'e', 'c'), 1);
  assert.equal(m.dropSlot(rows, 'c', 'e'), 3);
  assert.equal(m.dropSlot(rows, 'c', 'c'), null);
  assert.equal(m.dropSlot(rows, 'c', 'a'), null, 'not onto a commenced row');
  assert.equal(m.dropSlot(rows, 'a', 'c'), null, 'a commenced row is not dragged');
  assert.equal(m.dropSlot(rows, 'c', null), 4);
  assert.equal(m.dropSlot(rows, 'e', null), null);
});

test('the picture: aircraft by DME, the fixes from the server, one bolter racetrack per assigned turn-in (6 when none)', () => {
  const b = build(
    [entry('a', 4, 'PUSHED'), entry('b', 0, 'PUSHED'), entry('c', 2), entry('d', 3)],
    [strip('a', 'FINAL', 'ON_FINAL', 'CV_APP1'), strip('b', 'FINAL', 'BOLTER_WAVEOFF', 'CV_APP2'), strip('c', 'MARSHAL', 'IN_STACK'), strip('d', 'MARSHAL', 'IN_STACK')],
    { });
  const model = pic.pictureModel(b.rows, { firstFix: 21, radialText: '157M' });
  assert.deepEqual(model.aircraft.map((x) => x.label), ['201 A'], 'a bolter with no radar contact is not placed');
  assert.deepEqual(model.fixes.map((f) => f.dme), [23, 24]);
  assert.deepEqual(model.turns, [6]);
  const withB = b.rows.map((r) => (r.flightDataId === 'b' ? { ...r, dme: 3.2, turnNm: 8 } : r));
  assert.deepEqual(pic.pictureModel(withB, { firstFix: 21 }).turns, [8]);
  assert.ok(pic.yOfDme(12, 21) < pic.yOfDme(21, 21) && pic.yOfDme(21, 21) < pic.yOfDme(25, 21));
  assert.match(pic.racetrackPath(4, 21), /^M /);
});
