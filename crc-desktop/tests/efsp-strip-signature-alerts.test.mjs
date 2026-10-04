// B7 (docs/wip/ARCH-C.md §3.1): the Bay's per-Strip render signature must cover every input of the alert chips,
// or a chip changes while the Strip is not rebuilt. The signature is derived from _stripAlerts itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const flightData = (flightDataId, callsign, alertStatus = 'NONE') => ({
  flightDataId, rev: 1, identity: { callsign }, filed: {}, assigned: {},
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus },
});
const strip = (stripId, flightDataId, stripType, st) => ({
  stripId, flightDataId, stripType, state: st, facilityId: 'INCIRLIK', ownerPositionId: 'GC', bayId: 'gc-taxi-out',
  rackId: 'main', orderKey: 'V', rev: 1, annotations: {}, flags: {}, coordination: null, tofiCoordination: null,
  airspaceEntry: null, previousLeg: null,
});

async function load(alertStatus) {
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const view = await g.import('panels/efsp/bay/strip-signature.js');
  const stripView = await g.import('panels/efsp/strip-view.js');
  const strips = [strip('s-taxi', 'f-taxi', 'DEPARTURE', 'TAXI'), strip('s-viper', 'f-viper', 'DEPARTURE', 'CLEARED')];
  state.applyEfspSnapshot({
    strips, positions: [], bays: [], boardSeq: 1,
    flightDataList: [flightData('f-taxi', 'HAWK31'), flightData('f-viper', 'VIPER11', alertStatus)],
  });
  return { state, view, stripView, strips };
}

test('SCRAMBLE chip on another Strip\'s ground traffic moves that Strip\'s signature', async () => {
  const quiet = await load('NONE');
  const loud = await load('SCRAMBLE');
  const taxi = (c) => c.state.getEfspStrip('s-taxi');
  assert.notEqual(quiet.view._stripRenderSignature(taxi(quiet)), loud.view._stripRenderSignature(taxi(loud)));
});

test('the TOFI regime alert chip moves the signature', async () => {
  const { state, view } = await load('NONE');
  const s = state.getEfspStrip('s-taxi');
  const before = view._stripRenderSignature(s);
  state.applyEfspAlerts({ tofiRegime: [{ flightDataId: 'f-taxi', kind: 'REGIME_OUTSIDE_AIRSPACE', since: 1 }] });
  assert.notEqual(view._stripRenderSignature(s), before);
});

test('every chip _stripAlerts draws is named in the signature', async () => {
  const { state, view, stripView } = await load('SCRAMBLE');
  state.applyEfspAlerts({ tofiRegime: [{ flightDataId: 'f-taxi', kind: 'AWAITING_ENTRY_UNKNOWN', since: 1 }] });
  const s = state.getEfspStrip('s-taxi');
  const alerts = stripView._stripAlerts(s);
  assert.ok(alerts.some(a => a.key === 'scram') && alerts.some(a => a.key === 'tofiRegime'));
  const sig = view._stripRenderSignature(s);
  for (const a of alerts) assert.ok(sig.includes(a.key) && sig.includes(a.text), `${a.key} missing from ${sig}`);
});
