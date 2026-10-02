import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* L18's server half, the static part (docs/adr/0075, 0093): the three Incirlik
 * Positions in facility-config, the SFA pool's validation, the Bay descriptor
 * flags, and the capability table that every grant is derived from. The walks
 * through the wire are efsp-scenario-incirlik-l18.test.mjs. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-l18-config-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
})) process.env[k] = path.join(tmpDir, v);

const fc = await import('../src/efsp/facility-config.js');
const permission = await import('../src/efsp/permission.js');
const nla = await import('../src/efsp/nla.js');
const { CorrelationReconciler, INELIGIBLE_STATES } = await import('../src/efsp/correlation-reconciler.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const valid = (cfg) => fc.validateConfig(cfg);

test('INCIRLIK has RSU, SFA and PAR: MILITARY_ATC (so CA keeps them), unique letters, consolidation chain without RSU', () => {
  const cfg = fc.getFacilityConfig();
  assert.deepEqual(cfg.positions, ['OPS', 'CD', 'GC', 'LC', 'RSU', 'AP', 'SFA', 'PAR']);
  for (const id of ['RSU', 'SFA', 'PAR']) assert.equal(fc.getPositionClass(id), 'MILITARY_ATC', id);
  assert.deepEqual([cfg.positionLetters.RSU, cfg.positionLetters.SFA, cfg.positionLetters.PAR], ['R', 'S', 'P']);
  const letters = Object.values(cfg.positionLetters);
  assert.equal(new Set(letters).size, letters.length, 'a letter is unique inside the Facility');
  assert.equal(cfg.consolidation.SFA, 'AP');
  assert.equal(cfg.consolidation.PAR, 'AP');
  assert.equal('RSU' in cfg.consolidation, false, 'a Strip never strands on a supervisory Position');
});

test('radars: RSU the airport radar, SFA AP\'s picture, PAR the precision approach radar alone', () => {
  assert.deepEqual(fc.getPositionRadars('RSU'), [{ kind: 'airport', airport: 'LTAG' }]);
  assert.deepEqual(fc.getPositionRadars('SFA'), fc.getPositionRadars('AP'));
  assert.deepEqual(fc.getPositionRadars('PAR'), [{ kind: 'approach', airport: 'LTAG' }]);
  assert.ok(fc.radarBearingPositionIds().includes('PAR'));
});

test('Bays: each Position\'s Bay implies a state its Role really has, and the new states are not in INELIGIBLE_STATES (every PATTERN/FINAL state is decided)', () => {
  const stripTypeOfBay = { 'rsu-pattern': 'PATTERN', 'sfa-frequencies': 'ARRIVAL', 'par-final': 'FINAL', 'par-missed': 'FINAL' };
  for (const [bayId, stripType] of Object.entries(stripTypeOfBay)) {
    const bay = fc.getBay(bayId);
    assert.ok(bay, bayId);
    assert.ok(nla.STATES_BY_STRIP_TYPE[stripType].includes(bay.impliesState), `${bayId} implies ${bay.impliesState}, not a ${stripType} state`);
  }
  // The SFA Bay's state is ARRIVAL's own INBOUND (S-L18), not a new one.
  assert.equal(fc.bayImpliesState('sfa-frequencies'), 'INBOUND');
  assert.ok(nla.ARRIVAL_STATES.includes('INBOUND'));
  // Every PATTERN and FINAL state, decided explicitly for these Bays: all eligible for correlation
  // (a pattern or final-approach aircraft is a DCS unit with a track).
  for (const state of [...nla.PATTERN_STATES, ...nla.FINAL_STATES]) {
    const eligible = state !== 'DROPPED';
    assert.equal(INELIGIBLE_STATES.has(state), !eligible, state);
    assert.equal(CorrelationReconciler.isEligible([{ state }]), eligible, state);
  }
});

test('Bay descriptor flags: the RSU, PAR and SFA Bays and the carrier\'s final/pattern Bays carry `view`; only PAR\'s final Bay has `capacity`', () => {
  assert.equal(fc.getBay('rsu-pattern').view, 'pattern');
  assert.equal(fc.getBay('par-final').view, 'final');
  assert.equal(fc.getBay('sfa-frequencies').view, 'sfa-freqs');
  assert.equal(fc.getBay('par-final').capacity, 1);
  assert.equal(fc.getBay('rsu-pattern').replacesRacks, true);
  assert.equal(fc.getBay('par-final').replacesRacks, true);
  assert.equal(fc.getBay('sfa-frequencies').replacesRacks, undefined, 'the SFA racks ARE the frequencies');
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

test('singleFrequencyApproach: AP holds jurisdiction over a pool of at least five, a rotation of three, and the pool IS the SFA Bay\'s Racks', () => {
  const sfa = fc.getSingleFrequencyApproach();
  assert.equal(sfa.jurisdiction, 'AP');
  assert.equal(sfa.rotationSize, 3);
  assert.ok(sfa.pool.length >= 5);
  assert.deepEqual(sfa.pool.map(p => p.rackId), fc.getBay('sfa-frequencies').rackIds);
  for (const p of sfa.pool) assert.ok(p.mhz >= 225 && p.mhz <= 399.975, `${p.rackId} is UHF`);
  assert.equal(fc.getSingleFrequencyApproach('CARRIER'), null, 'no other Facility has an SFA');
});

test('singleFrequencyApproach is rejected when malformed (guide §4.7: at least five discrete UHF frequencies)', () => {
  const mutate = (fn) => { const c = clone(fc.getShippedConfig('INCIRLIK')); fn(c); return valid(c); };
  let r = mutate(c => { c.singleFrequencyApproach.pool.pop(); c.bays.SFA[0].rackIds.pop(); });
  assert.equal(r.ok, false); assert.match(r.detail, /at least 5/, 'a pool of four');
  r = mutate(c => { c.singleFrequencyApproach.jurisdiction = 'NOBODY'; });
  assert.match(r.detail, /jurisdiction/);
  r = mutate(c => { c.singleFrequencyApproach.rotationSize = 5; });
  assert.match(r.detail, /rotationSize/, 'a rotation as large as the pool leaves no spare');
  r = mutate(c => { c.singleFrequencyApproach.rotationSize = 0; });
  assert.match(r.detail, /rotationSize/);
  r = mutate(c => { c.singleFrequencyApproach.pool[1].rackId = 'freq-1'; });
  assert.match(r.detail, /repeats rackId/);
  r = mutate(c => { c.singleFrequencyApproach.pool[1].mhz = 232.1; });
  assert.match(r.detail, /repeats 232.1/);
  r = mutate(c => { c.singleFrequencyApproach.pool[0].mhz = 121.5; });
  assert.match(r.detail, /UHF/, 'VHF guard is not UHF');
  r = mutate(c => { c.bays.SFA[0].rackIds = ['freq-1', 'freq-2', 'freq-3', 'freq-4', 'other']; });
  assert.match(r.detail, /must be exactly the pool/);
  r = mutate(c => { delete c.bays.SFA[0].view; });
  assert.match(r.detail, /exactly one Bay/);
  r = mutate(c => { c.singleFrequencyApproach.initialRotation = { 'freq-1': 'AP', 'freq-2': 'AP' }; });
  assert.match(r.detail, /two frequencies at once/);
  r = mutate(c => { c.singleFrequencyApproach.initialRotation = { 'freq-1': 'AP', 'freq-2': 'SFA', 'freq-3': 'PAR', 'freq-4': 'LC' }; });
  assert.match(r.detail, /at most 3/);
  assert.equal(mutate(() => {}).ok, true);
});

test('permission rows: one capability table; PAR and SFA get ordinary Strip ops and no coordination, TOFI, conversion or airspace op', () => {
  for (const id of ['RSU', 'SFA', 'PAR']) {
    const ops = permission.PERMISSIONS[id];
    for (const k of [...permission.COORDINATION_OP_KINDS, ...permission.TOFI_OP_KINDS, ...permission.AP_CTR_ONLY_OP_KINDS, ...permission.AIRSPACE_ENTRY_OP_KINDS]) {
      assert.equal(ops.has(k), false, `${id} must not hold ${k}`);
    }
    assert.equal(ops.has('MoveStrip') && ops.has('TransferStrip') && ops.has('SetState'), true, id);
  }
  assert.equal(permission.canMutate('RSU', 'CreateStrip'), true);
  assert.equal(permission.canMutate('SFA', 'CreateStrip'), false, 'SFA\'s Strips arrive from APP');
  assert.equal(permission.canMutate('PAR', 'CreateStrip'), false, 'PAR\'s arrive by the rotation');
  assert.equal(permission.canCreateStripType('RSU', 'PATTERN'), true);
  assert.equal(permission.canCreateStripType('RSU', 'ARRIVAL'), false);
  assert.equal(permission.canCreateStripType('PAR', 'FINAL'), false);
});

test('state authority: RSU works PATTERN, SFA works INBOUND, PAR works FINAL; no other row moved', () => {
  assert.equal(permission.canActOnState('RSU', 'PATTERN', 'IN_PATTERN'), true);
  assert.equal(permission.canActOnState('RSU', 'PATTERN', 'RECOVERED'), true);
  assert.equal(permission.canActOnState('CV_PRIFLY', 'PATTERN', 'IN_PATTERN'), true, 'the carrier row survives');
  assert.equal(permission.canActOnState('SFA', 'ARRIVAL', 'INBOUND'), true);
  assert.equal(permission.canActOnState('SFA', 'ARRIVAL', 'HANDED_TO_TOWER'), false);
  for (const s of ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF']) {
    assert.equal(permission.canActOnState('PAR', 'FINAL', s), true, s);
    assert.equal(permission.canActOnState('CV_APP1', 'FINAL', s), true, s);
  }
  assert.deepEqual(permission.STATE_OWNERS_BY_STRIP_TYPE.MARSHAL.COMMENCED, ['CV_APP1', 'CV_APP2'], 'PAR did not leak into the Marshal table through a shared array');
  assert.equal(permission.canActOnState('PAR', 'ARRIVAL', 'INBOUND'), false);
});

test('RSU may ask about a runway and never close or open one (H18)', () => {
  assert.equal(permission.canActOnRunwayStatus('RSU', 'RequestRunwayStatus'), true);
  for (const kind of Object.keys(permission.RUNWAY_STATUS_OP_OWNERS)) {
    if (kind === 'RequestRunwayStatus') continue;
    for (const id of ['RSU', 'SFA', 'PAR']) assert.equal(permission.canActOnRunwayStatus(id, kind), false, `${id} / ${kind}`);
  }
  assert.equal(permission.canActOnRunwayStatus('SFA', 'RequestRunwayStatus'), false);
});

test('SFA predicates read the one table: AP rotates, AP and SFA send the transfer, PAR receives it (one acting Position, D21)', () => {
  assert.equal(permission.canRotateSfa('AP'), true);
  for (const id of ['SFA', 'PAR', 'RSU', 'LC', 'CV_MARSHAL', 'NOBODY', undefined]) assert.equal(permission.canRotateSfa(id), false, String(id));
  assert.equal(permission.canSendSfaRotationTransfer('AP'), true);
  assert.equal(permission.canSendSfaRotationTransfer('SFA'), true);
  assert.equal(permission.canSendSfaRotationTransfer('PAR'), false);
  assert.equal(permission.sfaRotationReceiver(), 'PAR');
  assert.equal(permission.canRotateSfa('toString'), false);
});

test('no Position name of the new three is written in a second table: every RSU/SFA/PAR literal in the authority registry is inside INCIRLIK_CAPABILITIES or a comment', () => {
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
