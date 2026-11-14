// T30 (live test 2026-10-11): Settings → RADAR "Show predicted paths" hides a conflict alert's predicted paths and
// closest-point line. "Show closest-point marker" (live test 2026-11-14) hides the orange circle with its countdown:
// STARS draws no such marker, the alert is the data block's CA, which no declutter switch hides (dark cockpit).
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshGraph, CLIENT_JS } from './helpers/fresh-graph.mjs';

const CONFLICT = {
  id: 'ca1', kind: 'CA', a: '1', b: '2', aCallsign: 'VIPER11', bCallsign: 'COLT21', timeToCpaSec: 75, minNm: 1.2, vertFt: 400,
  aAt: { lat: 37.1, lon: 35.1 }, bAt: { lat: 37.11, lon: 35.11 },
};

async function overlay(conflictAlertPaths, conflictAlertMarker) {
  const g = freshGraph();
  const { settings } = await g.import('settings.js');
  const picture = await g.import('picture.js');
  const alerts = await g.import('panels/efsp/alerts-state.js');
  const { buildConflictAlertOverlay } = await g.import('geojson.js');
  if (conflictAlertPaths !== undefined) settings.conflictAlertPaths = conflictAlertPaths;
  if (conflictAlertMarker !== undefined) settings.conflictAlertMarker = conflictAlertMarker;
  picture.tracks.set('1', { id: '1', lat: 37.0, lon: 35.0 });
  picture.tracks.set('2', { id: '2', lat: 37.2, lon: 35.2 });
  alerts.applyEfspAlerts({ conflictAlert: [CONFLICT] });
  return buildConflictAlertOverlay().features.map(f => f.properties.kind);
}

test('by default the paths and the closest-point line are drawn, the marker is not', async () => {
  assert.deepEqual(await overlay(undefined), ['path', 'path', 'cpa-line']);
});

test('the marker switched on adds the circle with its countdown', async () => {
  assert.deepEqual(await overlay(undefined, true), ['path', 'path', 'cpa-line', 'cpa']);
});

test('paths off, marker on: only the closest-point marker is left', async () => {
  assert.deepEqual(await overlay(false, true), ['cpa']);
});

test('both switched off, the scope draws nothing for the alert (the data block still says CA)', async () => {
  assert.deepEqual(await overlay(false, false), []);
});

test('both switches are in the RADAR tab, paths on and the marker off by default', async () => {
  const html = fs.readFileSync(path.join(CLIENT_JS, '../index.html'), 'utf8');
  const radar = html.slice(html.indexOf('id="stab-radar"'), html.indexOf('id="stab-srs"'));
  assert.match(radar, /id="set-ca-paths"/);
  assert.match(radar, /id="set-ca-marker"/);
  const { settings } = await freshGraph().import('settings.js');
  assert.equal(settings.conflictAlertPaths, true);
  assert.equal(settings.conflictAlertMarker, false);
});
