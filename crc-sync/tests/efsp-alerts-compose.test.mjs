import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

/* docs/adr/0067 (decisions.md S-Q82). efsp-alerts carries three slices from
 * producers on different cadences — conformance/STCA every second,
 * obligations every 15 s and after a Mutation — and WsHub.broadcastEfspAlerts
 * replaces the whole state. So server.js must compose the message in exactly
 * one place, from all three monitors, or one producer erases another's slice.
 * server.js cannot be imported (it listens), so this reads it.
 */

const SERVER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');

test('server.js calls wsHub.broadcastEfspAlerts in exactly one place, the compose function', () => {
  assert.equal(SERVER.match(/wsHub\.broadcastEfspAlerts\(/g).length, 1);
  const fn = SERVER.match(/\nfunction broadcastEfspAlerts\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(fn, 'the compose function exists');
  assert.match(fn[0], /wsHub\.broadcastEfspAlerts\(/);
  for (const key of ['conformance', 'stca', 'obligations']) assert.match(fn[0], new RegExp(`${key}:`));
});

test('a conformance-only tick does not clear obligations', () => {
  const body = SERVER.match(/\nfunction broadcastEfspAlerts\(\) \{[\s\S]*?\n\}\n/)[0];
  const compose = new Function('wsHub', 'conformanceMonitor', 'stcaMonitor', 'obligationMonitor',
    `${body}; return broadcastEfspAlerts;`);

  const wsHub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore() });
  const sent = [];
  wsHub._sessions.set({ readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) }, { coverage: null, lastSent: new Map() });

  let conformance = [];
  const obligation = { facilityId: 'INCIRLIK', stripId: 's1', obligationType: 'VOID_TIME_EXPIRED', severity: 'OVERDUE', dueAt: 1, since: 1 };
  const broadcast = compose(wsHub,
    { getAll: () => conformance },
    { getAll: () => [] },
    { getAll: () => [obligation] });

  broadcast(); // the 15 s sweep raised the obligation
  conformance = [{ fdrId: 'f1', alerts: [] }];
  broadcast(); // then the 1 s tick saw conformance change

  const last = sent.filter(m => m.type === 'efsp-alerts').pop();
  assert.deepEqual(last.conformance, conformance);
  assert.deepEqual(last.obligations, [obligation]);
});
