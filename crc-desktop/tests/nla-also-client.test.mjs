import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// crc-sync docs/adr/0157: the buttons beside the NLA, from the server's `strip.nla.also`, on the client.
const require = createRequire(import.meta.url);
const { nlaAlsoActions, nlaAlsoSignature } = await import('../app/public/js/panels/efsp/nla-also.js');

const at = (nla) => ({ stripType: 'CV_RECOVERY', state: 'CV_PATTERN', ownerPositionId: 'CV_APP1', nla });

test('a handoff sibling is the CarrierHandoff op, labelled by its row; the drop is DropStrip', () => {
  assert.deepEqual(nlaAlsoActions(at({ toState: 'ON_DECK', carrierHandoff: 'TRAPPED', also: [{ carrierHandoff: 'BOLTER', toState: 'CV_PATTERN' }] })),
    [{ key: 'BOLTER', label: 'BOLTER', op: { kind: 'CarrierHandoff', transfer: 'BOLTER' }, inhibited: null, handoff: 'BOLTER' }]);
  const [drop] = nlaAlsoActions(at({ toState: 'CV_AIRBORNE', also: [{ toState: 'DROPPED' }] }));
  assert.deepEqual([drop.key, drop.label, drop.op.kind], ['DROP', 'DROP', 'DropStrip']);
});

test('siblings stand beside an inhibited NLA, each with its own reason; nothing without `also`; unknown handoffs are left out', () => {
  const a = nlaAlsoActions(at({ inhibited: 'no receiving Position present', also: [{ carrierHandoff: 'BOLTER', toState: 'CV_PATTERN' }] }));
  assert.equal(a[0].inhibited, null);
  const b = nlaAlsoActions(at({ toState: 'DROPPED', also: [{ carrierHandoff: 'LAUNCH_TO_MARSHAL', toState: 'STACK', inhibited: 'no receiving Position present' }] }));
  assert.equal(b[0].inhibited, 'no receiving Position present');
  assert.deepEqual(nlaAlsoActions(at({ toState: 'DIRTY' })), []);
  assert.deepEqual(nlaAlsoActions(null), []);
  assert.deepEqual(nlaAlsoActions(at({ toState: 'X', also: [{ carrierHandoff: 'NOPE', toState: 'Y' }] })), []);
  assert.equal(nlaAlsoSignature(at({ also: [{ carrierHandoff: 'BOLTER', toState: 'CV_PATTERN', inhibited: 'x' }] })), 'BOLTER!');
});

test('every sibling the server can offer is one the client can draw', () => {
  const nla = require('../../crc-sync/src/efsp/nla.js');
  const ctx = (ship, flight, staffed) => ({ carrierCase: () => ship, carrierCaseOf: () => flight, carrierLaneFor: () => 'CV_APP1',
    isStaffed: () => staffed, consolidatedAt: () => null, carrierInStack: () => true });
  for (const stripType of ['CV_LAUNCH', 'CV_RECOVERY']) {
    for (const state of nla.STATES_BY_STRIP_TYPE[stripType]) {
      for (const [ship, flight] of [['I', 'I'], ['III', 'III']]) {
        for (const staffed of [true, false]) {
          const r = nla.computeNla({ stripType, state, stripId: 's', flightDataId: 'f' }, null, 0, ctx(ship, flight, staffed));
          const also = (r && r.also) || [];
          assert.equal(nlaAlsoActions({ nla: { also } }).length, also.length, `${stripType}/${state} Case ${ship}`);
        }
      }
    }
  }
});
