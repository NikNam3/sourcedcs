import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HERE, canonical, digest, checkGolden } from './freeze-lib.mjs';

// The decision tables as DATA (Role x state -> owner/actions, Position x op kind, NLA state sets,
// coordination effects, shipped facility defaults) and the wire message-type set. A refactor that
// moves these between files must leave every value here unchanged. Nothing is hand-copied: the values are
// read from the modules and the message types are read from the source text of the wire files.

const require = createRequire(import.meta.url);
const SRC = path.resolve(HERE, '../../src');
const permission = require('../../src/efsp/permission.js');
const nla = require('../../src/efsp/nla.js');
const coordination = require('../../src/efsp/coordination.js');
const blockMap = require('../../src/efsp/block-map.js');
const facilityConfig = require('../../src/efsp/facility-config.js');

const plain = (v) => {
  if (v instanceof Set) return [...v].map(plain).sort();
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]));
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'function') return '<function>';
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, plain(v[k])]));
  return v;
};
const entries = (o) => Object.entries(o).map(([k, v]) => ({ id: k, v: canonical(plain(v)) }));
const units = (d) => d.rows.map(r => [r.id, r]);

const POSITIONS = ['OPS', 'CD', 'GND', 'TWR', 'APP', 'CTR', 'TAC_C2', 'AIC', 'GCI', 'JTAC', 'CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'];

test('freeze tables: permission tables', () => {
  const rows = [];
  for (const k of ['PERMISSIONS', 'CREATE_ROLE_PERMISSIONS', 'STATE_OWNERS_BY_ROLE', 'OP_KINDS', 'COORDINATION_OP_KINDS', 'APP_CTR_ONLY_OP_KINDS',
    'TOFI_OP_KINDS', 'AIRSPACE_ENTRY_OP_KINDS', 'TOFI_COUNTERPARTS', 'NO_STRIP_OP_CLASSES', 'FIELD_STATE_OP_OWNERS', 'TACTICAL_CAPABILITIES',
    'READ_SCOPES', 'CARRIER_CAPABILITIES', 'MARSHAL_STATE_OWNERS', 'FINAL_STATE_OWNERS', 'PATTERN_STATE_OWNERS']) {
    rows.push({ id: `permission.${k}`, v: canonical(plain(permission[k])) });
  }
  checkGolden(assert, 'tables-permission-data', { rows }, units);
});

test('freeze tables: permission decisions (Position x op kind, Position x role x state, Position x created role)', () => {
  const rows = [];
  for (const p of POSITIONS) {
    rows.push({ id: `canMutate ${p}`, v: Object.fromEntries(permission.OP_KINDS.map(k => [k, permission.canMutate(p, k)])) });
    rows.push({ id: `canCreateStripRole ${p}`, v: Object.fromEntries(Object.keys(nla.STATES_BY_ROLE).map(r => [r, permission.canCreateStripRole(p, r)])) });
    for (const [role, states] of Object.entries(nla.STATES_BY_ROLE)) {
      rows.push({ id: `canActOnState ${p} ${role}`, v: Object.fromEntries(states.map(s => [s, permission.canActOnState(p, role, s)])) });
    }
    rows.push({ id: `handBackTargetsFor ${p}`, v: plain(permission.handBackTargetsFor(p)) });
    rows.push({ id: `tofiCounterparts ${p}`, v: plain(permission.tofiCounterparts(p)) });
    rows.push({ id: `readScopeFor ${p}`, v: plain(permission.readScopeFor(p)) });
  }
  checkGolden(assert, 'tables-permission-decisions', { rows }, units);
});

test('freeze tables: NLA state sets, coordination effects, block maps, facility defaults', () => {
  const rows = [];
  for (const k of ['STATES', 'DEPARTURE_STATES', 'ARRIVAL_STATES', 'OVERFLIGHT_STATES', 'MISSION_STATES', 'STATES_BY_ROLE', 'MARSHAL_STATES', 'FINAL_STATES', 'PATTERN_STATES', 'REQUIRED_FOR_CLEARANCE', 'CLEARANCE_BLOCK_LABELS']) {
    rows.push({ id: `nla.${k}`, v: canonical(plain(nla[k])) });
  }
  for (const k of ['COORDINATION_PRIMITIVES', 'COORDINATION_EFFECTS', 'COORDINATION_ELIGIBLE_STATES', 'TOFI_EFFECTS', 'TOFI_ELIGIBLE_STATES']) {
    rows.push({ id: `coordination.${k}`, v: canonical(plain(coordination[k])) });
  }
  for (const [role, map] of Object.entries(blockMap.BLOCK_MAPS)) {
    rows.push({ id: `blockMap.${role}`, v: { blocks: Object.keys(plain(map)).length, h: digest(canonical(plain(map))), ids: Object.keys(plain(map)) } });
  }
  for (const [name, cfg] of Object.entries(facilityConfig.DEFAULT_CONFIGS)) {
    const c = canonical(plain(cfg));
    rows.push({ id: `facility.${name}`, v: { positions: c.positions, coveringChain: c.coveringChain, positionClasses: c.positionClasses,
      bays: Object.fromEntries(Object.entries(c.bays || {}).map(([p, list]) => [p, (Array.isArray(list) ? list : []).map(b => `${b.bayId || b.id}:${b.impliesState || ''}`)])), h: digest(c) } });
  }
  checkGolden(assert, 'tables-nla-coordination-config', { rows }, units);
});

const grabCases = (text) => [...text.matchAll(/case '((?:efsp)-[a-z-]+)'/g)].map(m => m[1]);
const grabTypes = (text) => [...text.matchAll(/type: '((?:efsp)-[a-z-]+)'/g)].map(m => m[1]);

test('freeze tables: wire message-type set', () => {
  const ws = fs.readFileSync(path.join(SRC, 'efsp/efsp-ws.js'), 'utf8');
  const start = ws.indexOf('function handleMessage(');
  const dispatch = ws.slice(start, ws.indexOf('\n}\n', start));
  const clientToServer = [...new Set(grabCases(dispatch))].sort();
  const outbound = new Set();
  const files = [...fs.readdirSync(path.join(SRC, 'efsp')).filter(f => f.endsWith('.js')).map(f => path.join(SRC, 'efsp', f)), path.join(SRC, 'ws-hub.js')];
  for (const f of files) for (const t of grabTypes(fs.readFileSync(f, 'utf8'))) outbound.add(t);
  const hub = fs.readFileSync(path.join(SRC, 'ws-hub.js'), 'utf8');
  const hubHandles = [...new Set([...hub.matchAll(/'(efsp-[a-z-]+)'/g)].map(m => m[1]))].sort();
  checkGolden(assert, 'tables-wire-message-types', { rows: [
    { id: 'client->server (efsp-ws.js handleMessage dispatch)', v: clientToServer },
    { id: 'every efsp-* type literal sent by src/efsp/*.js and src/ws-hub.js', v: [...outbound].sort() },
    { id: 'every efsp-* literal appearing in src/ws-hub.js', v: hubHandles },
  ] }, units);
});
