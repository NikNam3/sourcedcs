import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

/* docs/adr/0067 (decisions.md S-Q82). efsp-alerts carries three slices from
 * producers on different cadences — conformance/CA every second,
 * obligations every 15 s and after a Mutation — and WsHub.broadcastEfspAlerts
 * replaces the whole state. So server.js must compose the message in exactly
 * one place, from all three monitors, or one producer erases another's slice.
 * createApp builds a whole service, so this reads src/app/monitors.js.
 */

const SERVER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'monitors.js'), 'utf8');

test('app/monitors.js calls broadcastEfspAlerts on the hub in exactly one place, the compose function', () => {
  assert.equal(SERVER.match(/hubLink\.get\(\)\.broadcastEfspAlerts\(/g).length, 1);
  const fn = SERVER.match(/\n *function broadcastEfspAlerts\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'the compose function exists');
  assert.match(fn[0], /hubLink\.get\(\)\.broadcastEfspAlerts\(/);
  for (const key of ['conformance', 'tofiRegime', 'conflictAlert', 'airspaceEntry', 'airspaceTrafficFor', 'airspaceInsideFor', 'airspaceCoordinateFor', 'obligations', 'surveillance']) assert.match(fn[0], new RegExp(`${key}:`));
});

test('a conformance-only tick does not clear obligations', () => {
  const body = SERVER.match(/\n *function broadcastEfspAlerts\(\) \{[\s\S]*?\n  \}\n/)[0];
  const compose = new Function('hubLink', 'conformanceMonitor', 'conflictAlertMonitor', 'obligationMonitor', 'surveillanceHints', 'tofiRegimeMonitor', 'airspaceEntryAlertMonitor',
    `${body}; return broadcastEfspAlerts;`);

  const wsHub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore() });
  const sent = [];
  wsHub._sessions.set({ readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) }, { coverage: null, lastSent: new Map() });

  let conformance = [];
  const hint = { facilityId: 'INCIRLIK', stripId: 's1', kind: 'AIRBORNE_ADVANCE' };
  const obligation = { facilityId: 'INCIRLIK', stripId: 's1', obligationType: 'VOID_TIME_EXPIRED', severity: 'OVERDUE', dueAt: 1, since: 1 };
  const broadcast = compose({ get: () => wsHub },
    { getAll: () => conformance },
    { getAll: () => [] },
    { getAll: () => [obligation] },
    { getAll: () => [hint] },
    { getAll: () => [] },
    { getAll: () => [], deliverableTo: () => true, trafficFor: () => [], insideFor: () => [], coordinateFor: () => [] });

  broadcast(); // the 15 s sweep raised the obligation
  conformance = [{ flightDataId: 'f1', alerts: [] }];
  broadcast(); // then the 1 s tick saw conformance change

  const last = sent.filter(m => m.type === 'efsp-alerts').pop();
  assert.deepEqual(last.conformance, conformance);
  assert.deepEqual(last.obligations, [obligation]);
  assert.deepEqual(last.surveillance, [hint]);
});
