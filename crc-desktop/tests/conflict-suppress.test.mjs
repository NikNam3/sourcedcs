/* A controller's suppress of one conflict alert (crc-sync's docs/adr/0145, H173 VQ-A): which of this controller's
   Positions a click suppresses or restores at, when an alert counts as suppressed, and what the ATC block shows then
   (no flash, no forced block, a grey steady CA). Ids here are test data only (ADR 0132). */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { conflictSuppressTargets, conflictRestoreTargets } from '../app/public/js/panels/efsp/conflict-suppress.js';
import { isConflictSuppressed } from '../app/public/js/panels/efsp/alerts-state.js';
import * as A from '../app/public/js/atc-scope.js';

test('suppress targets: the acting Positions the alert is shown at and not yet suppressed at', () => {
  const c = { id: '1|2', shownAt: ['P1', 'P2'], suppressedAt: ['P2'] };
  assert.deepEqual(conflictSuppressTargets(c, ['P1', 'P2', 'P3']), ['P1']);
  assert.deepEqual(conflictSuppressTargets(c, ['P3']), [], 'a Position it is not shown at suppresses nothing');
  assert.deepEqual(conflictSuppressTargets({ id: 'x' }, ['P1']), [], 'no shownAt: nothing to suppress');
  assert.deepEqual(conflictRestoreTargets(c, ['P1', 'P2']), ['P2']);
  assert.deepEqual(conflictRestoreTargets(c, ['P1']), []);
});

test('suppressed: only when every Position of this controller it is shown at suppressed it', () => {
  assert.equal(isConflictSuppressed({ shownAt: ['P1'], suppressedAt: ['P1'] }), true);
  assert.equal(isConflictSuppressed({ shownAt: ['P1', 'P2'], suppressedAt: ['P1'] }), false, 'still live at P2');
  assert.equal(isConflictSuppressed({ shownAt: ['P1'] }), false);
  assert.equal(isConflictSuppressed(null), false);
});

test('ATC block: a suppressed CA is grey and steady and no longer forces the full block', () => {
  A._resetAtcScopeForTest();
  const t = {
    id: '7', domain: 'AIR', onGround: false, scheme: 'ATC', sources: ['PRIMARY', 'SSR'],
    label: { callsign: 'VIPER11', source: 'FLIGHT_DATA', tag: null, trackNumber: 'TN00007' },
    type: 'F16', ssr: { code: '4521', ident: false, emergency: null },
    altitude: { ft: 12000, ref: 'QNH', source: 'MODE_C' }, dl: null, iffOverride: null,
  };
  const other = { stripId: 's1', flightDataId: 'f1', stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'P9', coordination: null };
  const rel = A.atcRelation(t, [other], new Set(['P1']), () => null); // someone else's track: a PDB unless forced
  const env = (over) => ({ palette: A.ATC_PALETTES.MAP, now: 1000, conflicts: ['7|9'], conform: null, coast: false, ...over });
  const live = A.atcView(t, rel, env({}));
  const liveCa = live.line0.find(s => s.text === 'CA');
  assert.ok(liveCa && liveCa.blink, 'a live CA flashes');
  const off = A.atcView(t, rel, env({ conflictsSuppressed: ['7|9'] }));
  const offCa = off.line0.find(s => s.text === 'CA');
  assert.ok(offCa, 'suppressed is not hidden: the CA stays');
  assert.equal(offCa.blink, false);
  assert.notEqual(offCa.color, liveCa.color, 'grey, not the alert colour');
  assert.equal(live.kind, 'FDB', 'a live CA forces the full block');
  assert.equal(off.kind, 'PDB', 'a suppressed alert does not force the full block');
  // A second, live alert on the same track still flashes.
  const mixed = A.atcView(t, rel, env({ conflicts: ['7|9', '7|8'], conflictsSuppressed: ['7|9'] }));
  assert.ok(mixed.line0.find(s => s.text === 'CA').blink);
});
