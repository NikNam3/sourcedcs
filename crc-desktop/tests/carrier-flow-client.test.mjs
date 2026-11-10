import test from 'node:test';
import assert from 'node:assert/strict';

// crc-sync docs/adr/0156 on the client: the carrier items of a Strip's menu and the carrier create form's seed (two leaves).
const { carrierMenuItems } = await import('../app/public/js/panels/efsp/carrier-menu-rules.js');
const { carrierCreateSeed, isCarrierOrigin } = await import('../app/public/js/panels/efsp/panel/carrier-create.js');

const rec = (state, owner = 'CV_MARSHAL') => ({ stripType: 'CV_RECOVERY', state, ownerPositionId: owner });
const keys = (items) => items.map(i => `${i.key}${i.enabled ? '' : '!'}`);

test('Set callsign: the owner of any carrier Strip; nobody else', () => {
  assert.deepEqual(keys(carrierMenuItems({ stripType: 'CV_LAUNCH', state: 'ON_DECK', ownerPositionId: 'CV_PRIFLY' }, { acting: ['CV_PRIFLY'] })), ['carrier-callsign']);
  assert.deepEqual(carrierMenuItems({ stripType: 'CV_LAUNCH', state: 'ON_DECK', ownerPositionId: 'CV_PRIFLY' }, { acting: ['CV_MARSHAL'] }), []);
  assert.deepEqual(carrierMenuItems({ stripType: 'DEPARTURE', state: 'CLEARED', ownerPositionId: 'CD' }, { acting: ['CD'] }), []);
});

test('Back to stack: the Marshal from COMMENCED on (the lane\'s Strip too), the lane on its own approach; never at BULLSEYE or in Case I', () => {
  const m = { acting: ['CV_MARSHAL'], shipCase: 'III', flightCase: 'III' };
  assert.ok(keys(carrierMenuItems(rec('COMMENCED'), m)).includes('carrier-back-to-stack'));
  const atLane = carrierMenuItems(rec('DIRTY', 'CV_APP1'), m).find(i => i.key === 'carrier-back-to-stack');
  assert.deepEqual([atLane.as, atLane.op], ['CV_MARSHAL', { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' }]);
  const lane = carrierMenuItems(rec('FINAL_APPROACH', 'CV_APP1'), { acting: ['CV_APP1'], flightCase: 'III' }).find(i => i.key === 'carrier-back-to-stack');
  assert.equal(lane.as, 'CV_APP1');
  assert.equal(carrierMenuItems(rec('BULLSEYE', 'CV_APP1'), m).some(i => i.key === 'carrier-back-to-stack'), false);
  assert.equal(carrierMenuItems(rec('STACK'), m).some(i => i.key === 'carrier-back-to-stack'), false);
  assert.equal(carrierMenuItems(rec('COMMENCED', 'CV_APP2'), { acting: ['CV_APP1'], flightCase: 'III' }).some(i => i.key === 'carrier-back-to-stack'), false);
});

test('the other lane: the Marshal at COMMENCED names APP 1 or APP 2', () => {
  const items = carrierMenuItems(rec('COMMENCED'), { acting: ['CV_MARSHAL'], flightCase: 'II' });
  assert.deepEqual(items.filter(i => i.key.startsWith('carrier-to-')).map(i => [i.label, i.op.toPositionId]), [['To APP 1', 'CV_APP1'], ['To APP 2', 'CV_APP2']]);
});

test('Abort to the Case II/III stack: a Case I flight, listed disabled while the ship is in Case I', () => {
  const off = carrierMenuItems(rec('STACK'), { acting: ['CV_MARSHAL'], shipCase: 'I', flightCase: 'I' }).find(i => i.key === 'carrier-abort');
  assert.deepEqual([off.enabled, off.reason], [false, 'Case I is active']);
  const on = carrierMenuItems(rec('SIGNAL_CHARLIE', 'CV_PRIFLY'), { acting: ['CV_MARSHAL'], shipCase: 'II', flightCase: 'I' }).find(i => i.key === 'carrier-abort');
  assert.deepEqual([on.enabled, on.as, on.op.transfer], [true, 'CV_MARSHAL', 'ABORT_TO_STACK']);
  assert.equal(carrierMenuItems(rec('CV_PATTERN', 'CV_PRIFLY'), { acting: ['CV_MARSHAL'], shipCase: 'II', flightCase: 'I' }).some(i => i.key === 'carrier-abort'), false,
    'Case I has no pattern (crc-sync docs/adr/0157)');
  assert.equal(carrierMenuItems(rec('STACK'), { acting: ['CV_MARSHAL'], shipCase: 'III', flightCase: 'III' }).some(i => i.key === 'carrier-abort'), false);
});

test('the create seed: the side number alone (1-8 letters or digits); type, radial and fuel are typed on the Strip', () => {
  assert.deepEqual(carrierCreateSeed({ side: ' 140 ' }), { ok: true, flightData: { sideNumber: '140' } });
  assert.match(carrierCreateSeed({ side: '' }).msg, /side number/);
  assert.equal(carrierCreateSeed({ side: 'TOOLONG99' }).ok, false);
  assert.equal(isCarrierOrigin({ stripType: 'CV_LAUNCH' }), true);
  assert.equal(isCarrierOrigin({ stripType: 'ARRIVAL' }), false);
});
