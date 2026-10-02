// F1 (docs/adr/0098 §4): an exported mission drawing carries its own name and its layer's name, so the panel can offer
// it as a DCS_DRAWING geometry. The Lua runs inside DCS, so this tests the script text and the parsing side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GrpcClient = require('../src/grpc-client');
const { missionFingerprint } = require('../src/mission-session');

function clientWith(evalImpl) {
  const c = new GrpcClient({});
  c._customSvc = { Eval: evalImpl };
  return c;
}

test('the drawing export script reads obj.name and layer.name', async () => {
  let lua = '';
  const c = clientWith((req, cb) => { lua = req.lua; cb(null, { json: JSON.stringify('[]') }); });
  assert.deepEqual(await c._getDrawings(), []);
  assert.match(lua, /name\s*=\s*obj\.name/);
  assert.match(lua, /layerName\s*=\s*layer\.name/);
});

test('names survive the parse, and a drawing without one stays valid', async () => {
  const wire = [
    { primitiveType: 'Polygon', polygonMode: 'free', name: 'MOA ALPHA', layerName: 'Airspace', points: [{ lat: 1, lon: 2 }] },
    { primitiveType: 'Line' },
  ];
  const c = clientWith((_req, cb) => cb(null, { json: JSON.stringify(JSON.stringify(wire)) }));
  const out = await c._getDrawings();
  assert.equal(out[0].name, 'MOA ALPHA');
  assert.equal(out[0].layerName, 'Airspace');
  assert.equal(out[1].name, undefined);
});

test('the mission fingerprint now sees drawing names (session ids change once)', () => {
  const base = { theatre: 'Syria', waypoints: [], drawings: [{ primitiveType: 'Line' }] };
  const named = { ...base, drawings: [{ primitiveType: 'Line', name: 'MOA ALPHA' }] };
  assert.notEqual(missionFingerprint(base), missionFingerprint(named));
});
