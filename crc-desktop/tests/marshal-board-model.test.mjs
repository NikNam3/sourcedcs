import test from 'node:test';
import assert from 'node:assert/strict';

// The recovery board's rules (crc-sync docs/adr/0114, 0156): every CV_RECOVERY from STACK to the drop, in its own Case's table, in
// landing order; past EAT; the clearance marks (amber until passed); the drop slot of a drag; the two pictures. No fuel rule.

const m = await import('../app/public/js/panels/efsp/marshal-board-model.js');
const pic = await import('../app/public/js/panels/efsp/marshal-picture.js');
const circ = await import('../app/public/js/panels/efsp/marshal-circle.js');

const T = Date.UTC(2026, 5, 1, 20, 40);
const MIN = 60_000;
const entry = (id, idx, status = 'HOLDING', o = {}) => ({
  flightDataId: id, stackIndex: idx, status, angels: 6 + idx, marshalDme: 21 + idx, pushTimeUtc: T + idx * MIN, pushWindowUtc: [T + idx * MIN - 10000, T + idx * MIN + 10000],
  pushedAtUtc: status === 'PUSHED' ? T - MIN : null, ...o,
});
const strip = (fd, state, owner = 'CV_MARSHAL', stripType = 'CV_RECOVERY') => ({ stripId: `s-${fd}`, flightDataId: fd, stripType, state, ownerPositionId: owner });
const fds = {
  a: { identity: { callsign: 'AAA', aircraftType: 'F-18C' }, military: { carrier: { sideNumber: '201', lowStateLb: 4800, bingoFuelLb: 3500, approachTurnNm: 4 } } },
  b: { identity: { callsign: 'BBB', aircraftType: 'F-14B' }, military: { carrier: { sideNumber: '102', lowStateLb: 4000, bingoFuelLb: 3500 } } },
  c: { identity: { callsign: 'CCC', aircraftType: 'E-2D' }, military: { carrier: { sideNumber: '600', lowStateLb: 3400, bingoFuelLb: 3500 } } },
  d: { identity: { callsign: 'DDD', aircraftType: 'S-3B' }, military: { carrier: {} } },
  e: { identity: { callsign: 'EEE', aircraftType: 'F-18C' }, military: { carrier: { sideNumber: '105' } } },
};
const view = (entries, caseI = []) => ({ derived: { MAIN: entries.map((e) => ({ caseValue: 'III', ...e })), CASE_I: caseI.map((e) => ({ caseValue: 'I', ...e })) }, slots: { MAIN: Array.from({ length: 8 }, (_, i) => ({ stackIndex: i, angels: 6 + i, marshalDme: 21 + i })) } });
const POS = { 's-a': { bearingDeg: 10, rangeNm: 4.1 }, 's-e': { bearingDeg: 200, rangeNm: 19.5 } };
const build = (entries, strips, o = {}) => m.buildBoard({
  view: view(entries, o.caseI || []), strips, flightDataOf: (id) => fds[id], posOf: (s) => POS[s.stripId] || null, now: T, ...o,
});

test('landing order: in the pattern and on the approach by range, then the commenced, then the holding by slot; the state from the Strip', () => {
  const b = build(
    [entry('d', 3), entry('c', 2), entry('e', 1, 'PUSHED'), entry('b', 0, 'PUSHED'), entry('a', 4, 'PUSHED')],
    [strip('a', 'DIRTY', 'CV_APP2'), strip('b', 'CV_PATTERN', 'CV_APP1'), strip('c', 'STACK'), strip('d', 'STACK'), strip('e', 'COMMENCED')]);
  assert.deepEqual(b.sequenced.map((r) => [r.seq, r.flightDataId, r.kind, r.state]),
    [[1, 'a', 'approach', 'DIRTY'], [2, 'b', 'pattern', 'CV_PATTERN'], [3, 'e', 'comm', 'COMMENCED'], [4, 'c', 'hold', 'STACK'], [5, 'd', 'hold', 'STACK']]);
  assert.equal(b.toGo, 5);
  assert.equal(b.sequenced.find((r) => r.flightDataId === 'c').next, true);
  assert.deepEqual(b.caseI, []);
});

test('every live CV_RECOVERY is on the board, in its own Case\'s table; launches and other Strips are not', () => {
  const b = build([entry('c', 0)], [strip('c', 'STACK'), strip('a', 'STACK'), strip('b', 'ON_DECK', 'CV_PRIFLY', 'CV_LAUNCH'),
    strip('d', 'DROPPED'), strip('e', 'ON_FINAL', 'PAR', 'FINAL')], { caseI: [{ flightDataId: 'a', stackIndex: 0, status: 'HOLDING', angels: 3 }] });
  assert.deepEqual(b.sequenced.map((r) => r.flightDataId), ['c']);
  assert.deepEqual(b.caseI.map((r) => [r.flightDataId, r.caseValue, r.angels, r.seq]), [['a', 'I', 3, 1]]);
  assert.equal(b.toGo, 2);
});

test('a side number names the row; without one, the callsign', () => {
  const b = build([entry('a', 0), entry('d', 1)], [strip('a', 'STACK'), strip('d', 'STACK')]);
  assert.deepEqual(b.sequenced.map((r) => r.side), ['201', 'DDD']);
});

test('no fuel rule (docs/adr/0156): the fuel is a figure only', () => {
  assert.equal(m.fuelLevel, undefined);
  assert.equal(m.fuelText(4800), '4.8');
  assert.equal(m.eatMinuteText(Date.UTC(2026, 5, 1, 20, 5)), '05');
  const b = build([entry('c', 0)], [strip('c', 'STACK')]);
  assert.equal('fuelLevel' in b.sequenced[0], false);
});

test('past EAT, not pushed: only a holding flight past the end of its push window', () => {
  const e = entry('c', 0);
  assert.equal(build([e], [strip('c', 'STACK')], { now: T + 5000 }).sequenced[0].late, false);
  assert.equal(build([e], [strip('c', 'STACK')], { now: T + 11000 }).sequenced[0].late, true);
  assert.equal(build([entry('c', 0, 'PUSHED')], [strip('c', 'COMMENCED')], { now: T + 60 * MIN }).sequenced[0].late, false);
});

test('a vacancy below the top of the stack is listed so the Marshal can close it up', () => {
  const b = build([entry('c', 0), entry('d', 3)], [strip('c', 'STACK'), strip('d', 'STACK')]);
  assert.deepEqual(b.vacancies.map((v) => v.slot), [1, 2]);
});

test('the marks are the server\'s: a holding row shows its entry\'s `unpassed`, the setting only hides them here (ADR 0115)', () => {
  const b = build([{ ...entry('c', 0), unpassed: ['angels', 'eat'] }, { ...entry('d', 1), unpassed: ['eat'] }, entry('e', 2)],
    [strip('c', 'STACK'), strip('d', 'STACK'), strip('e', 'STACK')]);
  const row = (id) => b.sequenced.find((r) => r.flightDataId === id);
  assert.deepEqual(m.marksOf(row('c')), { angels: true, eat: true });
  assert.deepEqual(m.marksOf(row('d')), { angels: false, eat: true });
  assert.deepEqual(m.marksOf(row('c'), { enabled: false }), { angels: false, eat: false });
  assert.deepEqual(m.marksOf({ ...row('c'), kind: 'comm' }), { angels: false, eat: false });
  assert.deepEqual(m.passClearanceOp(row('d')), { kind: 'PassClearance', flightDataId: 'd', angels: row('d').angels, eatUtc: row('d').eatUtc });
  assert.equal(m.passClearanceOp(row('e')), null);
});

test('a drag: dropped on another holding row it takes that row\'s slot; anything else is no move', () => {
  const rows = [{ flightDataId: 'a', kind: 'comm', slot: 0 }, { flightDataId: 'c', kind: 'hold', slot: 1 }, { flightDataId: 'd', kind: 'hold', slot: 2 }, { flightDataId: 'e', kind: 'hold', slot: 3 }];
  assert.equal(m.dropSlot(rows, 'e', 'c'), 1);
  assert.equal(m.dropSlot(rows, 'c', 'e'), 3);
  assert.equal(m.dropSlot(rows, 'c', 'c'), null);
  assert.equal(m.dropSlot(rows, 'c', 'a'), null);
  assert.equal(m.dropSlot(rows, 'c', null), 4);
});

test('the Case II/III picture: aircraft by range, labelled with their lane; the fixes from the server', () => {
  const b = build([entry('a', 4, 'PUSHED'), entry('c', 2), entry('d', 3)], [strip('a', 'FINAL_APPROACH', 'CV_APP2'), strip('c', 'STACK'), strip('d', 'STACK')]);
  const model = pic.pictureModel(b.sequenced, { firstFix: 21, radialText: '157M' });
  assert.deepEqual(model.aircraft.map((x) => x.label), ['201 B']);
  assert.deepEqual(model.fixes.map((f) => f.dme), [23, 24]);
  assert.ok(pic.yOfDme(12, 21) < pic.yOfDme(21, 21));
});

test('the Case I circle: ship-up, each flight at its bearing and range, side and angels; no track, not drawn', () => {
  const rows = [{ flightDataId: 'a', side: '201', angels: 3, bearingDeg: 100, dme: 2.5 }, { flightDataId: 'b', side: '202', angels: 4, bearingDeg: null, dme: null }];
  const model = circ.circleModel(rows, { brcDeg: 100 });
  assert.equal(model.aircraft.length, 1);
  const [a] = model.aircraft;
  assert.equal(a.label, '201 A3');
  assert.ok(Math.abs(a.x - model.center) < 1e-9 && a.y < model.center, 'on the BRC: straight up');
  assert.ok(Math.abs(model.center - a.y - model.ringR) < 1e-9, 'at 2.5 nm: on the ring');
});

test('typed in the panel: fuel, EAT, angels, DME (crc-sync docs/adr/0156); empty clears an override', () => {
  assert.deepEqual(m.fuelBlockOp('4.8'), { kind: 'SetBlock', blockId: 'C12', value: '4800' });
  assert.deepEqual(m.fuelBlockOp(''), { kind: 'SetBlock', blockId: 'C12', value: '' });
  assert.equal(m.fuelBlockOp('lots'), null);
  assert.deepEqual(m.setEatOp({ flightDataId: 'b' }, '2047'), { kind: 'SetEat', flightDataId: 'b', eat: '2047' });
  assert.equal(m.setEatOp({ flightDataId: 'b' }, '47'), null);
  assert.deepEqual(m.setAngelsOp({ flightDataId: 'b' }, '12'), { kind: 'SetAngels', flightDataId: 'b', angels: 12 });
  assert.deepEqual(m.setAngelsOp({ flightDataId: 'b' }, ''), { kind: 'SetAngels', flightDataId: 'b', angels: null });
  assert.deepEqual(m.setDmeOp({ flightDataId: 'b' }, '30'), { kind: 'SetDme', flightDataId: 'b', dme: 30 });
  assert.equal(m.setDmeOp({ flightDataId: 'b' }, 'x'), null);
  const b = build([entry('c', 0, 'HOLDING', { eatSet: true, angelsSet: true, dmeSet: true })], [strip('c', 'STACK')]);
  assert.deepEqual([b.sequenced[0].eatSet, b.sequenced[0].angelsSet, b.sequenced[0].dmeSet], [true, true, true]);
});

test('the header: CVN-72 CASE III CV-1 BRC 082M FB 073M ALTIMETER 30.06 MARSHAL 270 21NM ANG 6 EAT 04 APPR 15, single spaces', () => {
  const slots = [{ stackIndex: 0, angels: 6, marshalDme: 21, pushTimeUtc: Date.UTC(2026, 5, 1, 21, 4) }];
  const emptyIII = { recoveryCase: { value: 'III' }, derived: { MAIN: [], CASE_I: [] }, slots: { MAIN: slots }, lanes: { MAIN: [] } };
  const next = m.nextAvailable(emptyIII, [], () => true);
  assert.deepEqual(next, { angels: 6, dme: 21, eatUtc: slots[0].pushTimeUtc, lane: 'CV_APP1' });
  const text = m.headerParts({ hullId: 'CVN-72', caseValue: 'III', lanesText: 'CV-1', brcText: '082M', fbText: '073M', altimeterInHg: 30.06, radialText: '270M', next })
    .map(p => (p.k ? `${p.k} ${p.v}` : p.v)).join(' ');
  assert.equal(text, 'CVN-72 CASE III CV-1 BRC 082M FB 073M ALTIMETER 30.06 MARSHAL 270 21NM ANG 6 EAT 04 APPR 15');
  // the next free slot above the stack; the next lane is the first flight's not yet handed to an approach
  const two = { ...emptyIII, derived: { MAIN: [{ flightDataId: 'a', stackIndex: 0 }, { flightDataId: 'b', stackIndex: 1 }], CASE_I: [] },
    slots: { MAIN: [...slots, { stackIndex: 1, angels: 7, marshalDme: 22 }, { stackIndex: 2, angels: 8, marshalDme: 23, pushTimeUtc: null }] },
    lanes: { MAIN: [{ flightDataId: 'a', lane: 'CV_APP1' }, { flightDataId: 'b', lane: 'CV_APP2' }] } };
  const strips = [strip('a', 'FINAL_APPROACH', 'CV_APP1'), strip('b', 'COMMENCED')];
  assert.deepEqual(m.nextAvailable(two, strips), { angels: 8, dme: 23, eatUtc: null, lane: 'CV_APP2' });
  assert.equal(m.headerParts({ caseValue: 'III', next: m.nextAvailable(two, strips) }).find(p => p.id === 'next-appr').v, '17');
  // nobody waiting, APP 1 unstaffed: the next check-in goes to APP 2
  assert.equal(m.nextAvailable(emptyIII, [], (p) => p === 'CV_APP2').lane, 'CV_APP2');
});

test('the header in Case I: the next altitude from 2, one above the highest assigned; no marshal fix, EAT or approach', () => {
  const v = (angels) => ({ recoveryCase: { value: 'I' }, derived: { MAIN: [], CASE_I: angels.map((a, i) => ({ flightDataId: `f${i}`, angels: a })) } });
  assert.equal(m.nextAvailable(v([]), []).angels, 2);
  assert.equal(m.nextAvailable(v([2, 3, null]), []).angels, 4);
  const text = m.headerParts({ hullId: 'CVN-72', caseValue: 'I', lanesText: 'CV-1', brcText: '082M', fbText: '073M', altimeterInHg: 30.06, next: m.nextAvailable(v([]), []) })
    .map(p => (p.k ? `${p.k} ${p.v}` : p.v)).join(' ');
  assert.equal(text, 'CVN-72 CASE I CV-1 BRC 082M FB 073M ALTIMETER 30.06 ANG 2');
});
