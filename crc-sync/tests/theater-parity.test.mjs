import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/* config/theaters.json tmCentralMeridianDeg and tools/miztoyaml/projection.py `lon0` are the same fact
 * kept twice. This lives in crc-sync's suite (it is the side that fails silently: a missing meridian
 * turns every grid heading into "unknown"), reading the .py as text. Sources: docs/wip/THEATERS.md. */
const root = path.join(import.meta.dirname, '../..');
const json = JSON.parse(fs.readFileSync(path.join(root, 'crc-sync/config/theaters.json'), 'utf8')).theaters;
const py = fs.readFileSync(path.join(root, 'tools/miztoyaml/projection.py'), 'utf8');
const pyTable = {};
for (const m of py.matchAll(/^\s*"(\w+)":\s*dict\(lon0=\s*(-?[\d.]+),/gm)) pyTable[m[1]] = Number(m[2]);
const M = await import('../src/magnetic.js');

test('every projection.py theater has the same central meridian in theaters.json, and vice versa', () => {
  assert.ok(Object.keys(pyTable).length >= 11, 'parsed the python table');
  for (const [name, lon0] of Object.entries(pyTable)) {
    assert.equal(json[name]?.tmCentralMeridianDeg, lon0, name);
  }
  for (const [name, t] of Object.entries(json)) {
    if ('tmCentralMeridianDeg' in t) assert.equal(pyTable[name], t.tmCentralMeridianDeg, name);
  }
});

test('convergence spot checks at projection.py points of the added theaters (sign and size)', () => {
  // lat/lon from projection.py's dcs_to_latlon at the map point named
  const cases = [
    ['TheChannel', 50.8751, 1.5875, -1.4125 * Math.sin(50.8751 * Math.PI / 180)], // west of 3E: negative
    ['Kola', 68.0, 22.5, 1.5 * Math.sin(68 * Math.PI / 180)],                     // east of 21E: positive
    ['GermanyCW', 50.4551, 14.1588, -6.8412 * Math.sin(50.4551 * Math.PI / 180)],
  ];
  for (const [name, lat, lon, want] of cases) {
    const g = M.convergenceAt(lat, lon, json[name]);
    assert.ok(Math.abs(g - want) < 1e-9, name);
  }
  assert.ok(M.convergenceAt(50.4551, 14.1588, json.GermanyCW) < -5);
});

test('theaters without a citable projection stay absent rather than guessed', () => {
  for (const n of ['MarianaIslandsWWII', 'Afghanistan', 'Iraq']) {
    assert.equal(json[n].tmCentralMeridianDeg, undefined, n);
  }
});
