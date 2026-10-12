import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* L18's server half, the static part (docs/adr/0075, 0093), as docs/adr/0117 left it: Incirlik's RSU and PAR in
 * facility-config (no SFA Position), the SFA pool's validation (AP's Bay, three of at least five frequencies rotating),
 * the Bay descriptor flags, and the capability table that every grant is derived from. The walks through the wire are
 * efsp-scenario-incirlik-l18.test.mjs. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-l18-config-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
})) process.env[k] = path.join(tmpDir, v);

const fc = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const permission = await import('../src/efsp/permission.js');
const classPermission = (await import('./helpers/permission.mjs')).classPermission();
const nla = await import('../src/efsp/nla.js');
const { CorrelationReconciler, INELIGIBLE_STATES } = await import('../src/efsp/correlation-reconciler.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const valid = (cfg) => fc.validateConfig(cfg);

test('INCIRLIK has RSU and PAR, MILITARY_ATC (so CA keeps them), unique letters; no SFA Position (docs/adr/0117)', () => {
  const cfg = fc.getFacilityConfig();
  assert.deepEqual(cfg.positions, ['OPS', 'CD', 'GC', 'LC', 'RSU', 'AP', 'PAR']);
  for (const id of ['RSU', 'PAR']) assert.equal(fc.getPositionClass(id), 'MILITARY_ATC', id);
  assert.deepEqual([cfg.positionLetters.RSU, cfg.positionLetters.PAR], ['R', 'P']);
  for (const key of ['positionClasses', 'positionLetters', 'consolidation', 'positionRadars', 'bays']) assert.equal('SFA' in cfg[key], false, key);
  const letters = Object.values(cfg.positionLetters);
  assert.equal(new Set(letters).size, letters.length, 'a letter is unique inside the Facility');
});

test('radars: RSU the airport radar, PAR the precision approach radar alone', () => {
  assert.deepEqual(fc.getPositionRadars('RSU'), [{ kind: 'airport', airport: 'LTAG' }]);
  assert.deepEqual(fc.getPositionRadars('PAR'), [{ kind: 'approach', airport: 'LTAG' }]);
  assert.ok(fc.radarBearingPositionIds().includes('PAR'));
});

test('Bays: each Position\'s Bay implies a state its Role really has, and the new states are not in INELIGIBLE_STATES (every PATTERN/FINAL state is decided)', () => {
  const stripTypeOfBay = { 'rsu-pattern': 'PATTERN', 'ap-sfa': 'ARRIVAL', 'par-final': 'FINAL', 'par-missed': 'FINAL' };
  for (const [bayId, stripType] of Object.entries(stripTypeOfBay)) {
    const bay = fc.getBay(bayId);
    assert.ok(bay, bayId);
    assert.ok(nla.STATES_BY_STRIP_TYPE[stripType].includes(bay.impliesState), `${bayId} implies ${bay.impliesState}, not a ${stripType} state`);
  }
  // The SFA Bay is AP's, its state ARRIVAL's own INBOUND, and AP's ordinary inbound Bay comes first (the fallback placement).
  assert.equal(fc.getBay('ap-sfa').positionId, 'AP');
  assert.equal(fc.bayImpliesState('ap-sfa'), 'INBOUND');
  assert.equal(fc.bayForImpliedState('AP', 'INBOUND').bayId, 'ap-inbound');
  for (const state of [...nla.PATTERN_STATES, ...nla.FINAL_STATES]) {
    const eligible = state !== 'DROPPED';
    assert.equal(INELIGIBLE_STATES.has(state), !eligible, state);
    assert.equal(CorrelationReconciler.isEligible([{ state }]), eligible, state);
  }
});

test('Bay descriptor flags: the RSU, PAR and SFA Bays and the carrier\'s final/pattern Bays carry `view`; only PAR\'s final Bay has `capacity`; the SFA Bay carries its pool', () => {
  assert.equal(fc.getBay('rsu-pattern').view, 'pattern');
  assert.equal(fc.getBay('par-final').view, 'final');
  assert.equal(fc.getBay('ap-sfa').view, 'sfa-freqs');
  assert.deepEqual(fc.getBay('ap-sfa').sfaPool, fc.getSingleFrequencyApproach().pool);
  assert.equal(fc.getBay('ap-inbound').sfaPool, undefined);
  assert.equal(fc.getBay('par-final').capacity, 1);
  assert.equal(fc.getBay('rsu-pattern').replacesRacks, true);
  assert.equal(fc.getBay('par-final').replacesRacks, true);
  assert.equal(fc.getBay('ap-sfa').replacesRacks, undefined, 'the SFA racks ARE the frequencies');
  assert.equal(fc.getBay('cv-app1-final', 'CARRIER').replacesRacks, undefined, 'the carrier keeps its racks and their buttons');
  assert.deepEqual(fc.getBay('rsu-pattern').rackIds, ['closed', 'initial', 'base', 'final']);
  assert.equal(fc.getBay('cv-prifly-pattern', 'CARRIER').view, 'pattern');
  assert.equal(fc.getBay('cv-app1-final', 'CARRIER').view, 'final');
  assert.equal(fc.getBay('cv-app2-final', 'CARRIER').view, 'final');
  const flagged = fc.getFacilityIds().flatMap(f => fc.getAllBays(f)).filter(b => b.capacity !== undefined).map(b => b.bayId);
  assert.deepEqual(flagged, ['par-final']);
});

test('Bay descriptor flags are validated: an unknown view and a bad capacity are rejected', () => {
  const bad = clone(fc.getShippedConfig('INCIRLIK'));
  bad.bays.RSU[0].view = 'carousel';
  assert.equal(valid(bad).ok, false);
  assert.match(valid(bad).detail, /unknown view/);
  const zero = clone(fc.getShippedConfig('INCIRLIK'));
  zero.bays.PAR[0].capacity = 0;
  assert.equal(valid(zero).ok, false);
  assert.match(valid(zero).detail, /capacity/);
  const noView = clone(fc.getShippedConfig('INCIRLIK'));
  noView.bays.OPS[0].replacesRacks = true;
  assert.match(valid(noView).detail, /replacesRacks/);
  const stray = clone(fc.getShippedConfig('INCIRLIK'));
  stray.bays.OPS[0].colour = 'red';
  assert.match(valid(stray).detail, /unknown Bay descriptor key/);
  assert.equal(valid(clone(fc.getShippedConfig('INCIRLIK'))).ok, true);
});

test('singleFrequencyApproach: AP holds the rotation of three of at least five UHF frequencies (JO 7610.14A ¶7-1-5 b, c); one is AP\'s initial contact, one a spare (H134 LT-RQ5 a); the pool IS AP\'s SFA Bay\'s Racks', () => {
  const sfa = fc.getSingleFrequencyApproach();
  assert.equal(sfa.jurisdiction, 'AP');
  assert.ok(sfa.pool.length >= 5);
  assert.deepEqual(sfa.pool.map(p => p.use), ['INITIAL_CONTACT', 'ROTATION', 'ROTATION', 'ROTATION', 'SPARE']);
  assert.deepEqual(sfa.pool.map(p => p.rackId), fc.getBay('ap-sfa').rackIds);
  for (const p of sfa.pool) assert.ok(p.mhz >= 225 && p.mhz <= 399.975, `${p.rackId} is UHF`);
  assert.equal(fc.getSingleFrequencyApproach('CARRIER'), null, 'no other Facility has an SFA');
});

test('singleFrequencyApproach is rejected when malformed (¶7-1-5: at least five discrete UHF frequencies, three rotating, AP\'s Bay)', () => {
  const mutate = (fn) => { const c = clone(fc.getShippedConfig('INCIRLIK')); fn(c); return valid(c); };
  const sfaBay = (c) => c.bays.AP.find(b => b.view === 'sfa-freqs');
  let r = mutate(c => { c.singleFrequencyApproach.pool.pop(); sfaBay(c).rackIds.pop(); });
  assert.equal(r.ok, false); assert.match(r.detail, /at least 5/, 'a pool of four');
  r = mutate(c => { c.singleFrequencyApproach.jurisdiction = 'NOBODY'; });
  assert.match(r.detail, /jurisdiction/);
  r = mutate(c => { c.singleFrequencyApproach.pool[0].use = 'ROTATION'; });
  assert.match(r.detail, /marks 4 frequencies ROTATION/, 'four rotating');
  r = mutate(c => { c.singleFrequencyApproach.pool[1].use = 'SPARE'; });
  assert.match(r.detail, /marks 2 frequencies ROTATION/);
  r = mutate(c => { delete c.singleFrequencyApproach.pool[1].use; });
  assert.match(r.detail, /use must be one of/);
  r = mutate(c => { c.singleFrequencyApproach.pool[1].use = 'GUARD'; });
  assert.match(r.detail, /use must be one of/);
  r = mutate(c => { c.singleFrequencyApproach.rotationSize = 3; });
  assert.match(r.detail, /unknown key "rotationSize"/, 'the old shape is refused');
  r = mutate(c => { c.singleFrequencyApproach.pool[0].label = 'x'; });
  assert.match(r.detail, /unknown key "label"/);
  r = mutate(c => { c.singleFrequencyApproach.pool[1].rackId = 'freq-1'; });
  assert.match(r.detail, /repeats rackId/);
  r = mutate(c => { c.singleFrequencyApproach.pool[1].mhz = 232.1; });
  assert.match(r.detail, /repeats 232.1/);
  r = mutate(c => { c.singleFrequencyApproach.pool[0].mhz = 121.5; });
  assert.match(r.detail, /UHF/, 'VHF guard is not UHF');
  r = mutate(c => { sfaBay(c).rackIds = ['freq-1', 'freq-2', 'freq-3', 'freq-4', 'other']; });
  assert.match(r.detail, /must be exactly the pool/);
  r = mutate(c => { delete sfaBay(c).view; });
  assert.match(r.detail, /exactly one Bay/);
  r = mutate(c => { const b = sfaBay(c); c.bays.AP = c.bays.AP.filter(x => x !== b); c.bays.PAR.push(b); });
  assert.match(r.detail, /must be a Bay of AP/, 'the rotation is AP\'s');
  assert.equal(mutate(() => {}).ok, true);
});

test('permission rows: one capability table; PAR gets ordinary Strip ops and no coordination, TOFI, conversion or airspace op', () => {
  for (const id of ['RSU', 'PAR']) {
    const ops = classPermission.PERMISSIONS[id];
    for (const k of [...permission.COORDINATION_OP_KINDS, ...permission.TOFI_OP_KINDS, ...permission.AP_CTR_ONLY_OP_KINDS, ...permission.AIRSPACE_ENTRY_OP_KINDS]) {
      assert.equal(ops.has(k), false, `${id} must not hold ${k}`);
    }
    assert.equal(ops.has('MoveStrip') && ops.has('TransferStrip') && ops.has('SetState'), true, id);
  }
  assert.equal(classPermission.canMutate('RSU', 'CreateStrip'), true);
  assert.equal(classPermission.canMutate('PAR', 'CreateStrip'), false, 'PAR\'s arrive by AP\'s handoff');
  assert.equal(permission.canCreateStripType('RSU', 'PATTERN'), true);
  assert.equal(permission.canCreateStripType('RSU', 'ARRIVAL'), false);
  assert.equal(permission.canCreateStripType('PAR', 'FINAL'), false);
});

test('state authority: RSU works PATTERN, PAR works FINAL on final and after a missed approach (never BALL, the carrier\'s); no other row moved', () => {
  assert.equal(permission.canActOnState('RSU', 'PATTERN', 'IN_PATTERN'), true);
  assert.equal(permission.canActOnState('RSU', 'PATTERN', 'RECOVERED'), true);
  assert.equal(permission.canActOnState('CV_PRIFLY', 'PATTERN', 'IN_PATTERN'), true, 'the carrier row survives');
  assert.deepEqual(permission.STATE_OWNERS_BY_STRIP_TYPE.ARRIVAL.INBOUND, ['AP', 'CTR']);
  for (const s of ['ON_FINAL', 'BOLTER_WAVEOFF']) assert.equal(permission.canActOnState('PAR', 'FINAL', s), true, s);
  assert.equal(permission.canActOnState('PAR', 'FINAL', 'BALL'), false);
  for (const s of ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF']) assert.equal(permission.canActOnState('CV_APP1', 'FINAL', s), true, s);
  assert.deepEqual(permission.STATE_OWNERS_BY_STRIP_TYPE.MARSHAL.COMMENCED, ['CV_APP1', 'CV_APP2'], 'PAR did not leak into the Marshal table through a shared array');
  assert.equal(permission.canActOnState('PAR', 'ARRIVAL', 'INBOUND'), false);
});

test('RSU may ask about a runway and never close or open one (H18)', () => {
  assert.equal(permission.canActOnRunwayStatus('RSU', 'RequestRunwayStatus'), true);
  for (const kind of Object.keys(permission.RUNWAY_STATUS_OP_OWNERS)) {
    if (kind === 'RequestRunwayStatus') continue;
    for (const id of ['RSU', 'PAR']) assert.equal(permission.canActOnRunwayStatus(id, kind), false, `${id} / ${kind}`);
  }
  assert.equal(permission.canActOnRunwayStatus('PAR', 'RequestRunwayStatus'), false);
});

test('the final\'s predicates read the one table: AP hands off to the final, PAR receives it and records the calls (one acting Position, D21)', () => {
  assert.equal(permission.canHandOffToFinal('AP'), true);
  for (const id of ['PAR', 'RSU', 'LC', 'CV_MARSHAL', 'NOBODY', undefined, 'toString']) assert.equal(permission.canHandOffToFinal(id), false, String(id));
  assert.equal(permission.canRecordFinalCall('PAR'), true);
  for (const id of ['AP', 'RSU', 'LC', 'CV_APP1', 'toString']) assert.equal(permission.canRecordFinalCall(id), false, String(id));
  assert.equal(permission.finalReceiver(), 'PAR');
  assert.equal(permission.canRotateSfa, undefined, 'no rotation record to change (docs/adr/0117)');
});

test('no Position name of RSU and PAR is written in a second table: every RSU/PAR literal in the authority registry is inside INCIRLIK_CAPABILITIES or a comment', () => {
  // AUTH: the table moved to authority/positions/incirlik-military.js; the
  // other registry files and the permission.js facade must not repeat the names.
  const src = fs.readFileSync(new URL('../src/efsp/authority/positions/incirlik-military.js', import.meta.url), 'utf8');
  const start = src.indexOf('const INCIRLIK_CAPABILITIES = {');
  const end = src.indexOf('\n};\n', start);
  assert.ok(start > 0 && end > start);
  const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const bodyStart = code.indexOf('const INCIRLIK_CAPABILITIES = {');
  const bodyEnd = code.indexOf('\n};\n', bodyStart);
  const outside = code.slice(0, bodyStart) + code.slice(bodyEnd);
  const hits = outside.match(/'(RSU|SFA|PAR)'/g);
  assert.equal(hits, null, `Position literals outside the table: ${hits}`);
  const others = ['permission.js', 'authority/index.js', 'authority/op-kinds.js', 'authority/classes.js',
    ...fs.readdirSync(new URL('../src/efsp/authority/positions/', import.meta.url)).filter(f => f !== 'incirlik-military.js').map(f => `authority/positions/${f}`),
    ...fs.readdirSync(new URL('../src/efsp/authority/strip-types/', import.meta.url)).map(f => `authority/strip-types/${f}`)];
  for (const f of others) {
    const text = fs.readFileSync(new URL(`../src/efsp/${f}`, import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert.equal(text.match(/'(RSU|SFA|PAR)'/g), null, `${f} names RSU/SFA/PAR outside INCIRLIK_CAPABILITIES`);
  }
});

test('the tuning stays read-only (P5): no code path writes singleFrequencyApproach', () => {
  const cfg = fc.getFacilityConfig();
  cfg.singleFrequencyApproach.pool.pop();
  assert.equal(fc.getSingleFrequencyApproach().pool.length, 5, 'getFacilityConfig returns a copy');
});
