// T30 (live test 2026-10-11): Settings → RADAR "Show predicted paths" hides a conflict alert's predicted paths and
// closest-point line only. The closest-point marker with its countdown and the data block's CA are the alert, which no
// declutter switch hides (dark cockpit, H115-H119).
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

async function overlay(conflictAlertPaths) {
  const g = freshGraph();
  const { settings } = await g.import('settings.js');
  const picture = await g.import('picture.js');
  const alerts = await g.import('panels/efsp/alerts-state.js');
  const { buildConflictAlertOverlay } = await g.import('geojson.js');
  if (conflictAlertPaths !== undefined) settings.conflictAlertPaths = conflictAlertPaths;
  picture.tracks.set('1', { id: '1', lat: 37.0, lon: 35.0 });
  picture.tracks.set('2', { id: '2', lat: 37.2, lon: 35.2 });
  alerts.applyEfspAlerts({ conflictAlert: [CONFLICT] });
  return buildConflictAlertOverlay().features.map(f => f.properties.kind);
}

test('by default the paths, the closest-point line and the marker are all drawn', async () => {
  assert.deepEqual(await overlay(undefined), ['path', 'path', 'cpa-line', 'cpa']);
});

test('switched off, only the closest-point marker with its countdown is left', async () => {
  assert.deepEqual(await overlay(false), ['cpa']);
});

test('the switch is in the RADAR tab, on by default', async () => {
  const html = fs.readFileSync(path.join(CLIENT_JS, '../index.html'), 'utf8');
  const radar = html.slice(html.indexOf('id="stab-radar"'), html.indexOf('id="stab-srs"'));
  assert.match(radar, /id="set-ca-paths"/);
  const { settings } = await freshGraph().import('settings.js');
  assert.equal(settings.conflictAlertPaths, true);
});
