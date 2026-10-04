import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const schema = require('../src/efsp/facility-schema.js');
const CONFIG = path.join(import.meta.dirname, '../config');
const IDS = ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER'];
const shipped = (id) => JSON.parse(fs.readFileSync(path.join(CONFIG, `efsp-facility-${id.toLowerCase()}.json`), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const reject = (candidate, fragment) => {
  const r = schema.validateFacilityConfig(candidate);
  assert.equal(r.ok, false, `expected a rejection containing "${fragment}"`);
  assert.match(r.detail, new RegExp(fragment));
};

test('every shipped facility JSON is a complete, valid facility config', () => {
  for (const id of IDS) assert.deepEqual(schema.validateFacilityConfig(shipped(id), id), { ok: true }, id);
});

test('a missing required key is named', () => {
  for (const key of Object.keys(schema.REQUIRED_KEYS)) {
    const c = shipped('INCIRLIK'); delete c[key];
    reject(c, `missing required key ${key}`);
  }
});

test('a required key of the wrong type is rejected', () => {
  const c = shipped('CENTER'); c.positions = 'CTR';
  reject(c, 'positions must be an array');
  const d = shipped('CENTER'); d.dataOnly = 'no';
  reject(d, 'dataOnly must be a boolean');
});

test('the file must name the Facility it is loaded as', () => {
  assert.equal(schema.validateFacilityConfig(shipped('CENTER'), 'INCIRLIK').ok, false);
});

test('a Bay under an unknown Position is rejected', () => {
  const c = shipped('CENTER'); c.bays.NOPE = c.bays.CTR;
  reject(c, 'unknown Position NOPE');
});

test('a Bay needs Racks: none, a blank one, or a repeat is rejected', () => {
  for (const racks of [[], [''], ['a', 'a'], undefined]) {
    const c = shipped('CENTER'); c.bays.CTR[0].rackIds = racks;
    reject(c, 'rackIds must be a non-empty list of unique Rack ids');
  }
});

test('a bayId used twice is rejected', () => {
  const c = shipped('CENTER'); c.bays.CTR[1].bayId = c.bays.CTR[0].bayId;
  reject(c, 'used twice');
});

test('holdsStripType must be a known strip type', () => {
  const c = shipped('CENTER'); c.bays.CTR.find(b => b.holdsStripType).holdsStripType = 'NOPE';
  reject(c, 'holdsStripType "NOPE" is not a strip type');
});

test('consolidation is a list of offered Positions: known members, not itself, no repeats, non-empty, never a string', () => {
  const a = shipped('INCIRLIK'); a.consolidation.CD = ['GC', 'NOPE'];
  reject(a, 'consolidation.CD names unknown Position NOPE');
  const b = shipped('INCIRLIK'); b.consolidation.NOPE = ['CD'];
  reject(b, 'consolidation names unknown Position NOPE');
  const self = shipped('INCIRLIK'); self.consolidation.CD = ['GC', 'CD'];
  reject(self, 'consolidation.CD names itself');
  const rep = shipped('INCIRLIK'); rep.consolidation.CD = ['GC', 'GC'];
  reject(rep, 'consolidation.CD names GC twice');
  const empty = shipped('INCIRLIK'); empty.consolidation.CD = [];
  reject(empty, 'consolidation.CD must not be empty');
  const str = shipped('INCIRLIK'); str.consolidation.CD = 'GC';
  reject(str, 'must be a list of Positions offered the hat');
  reject(str, 'handBack');
});

test('consolidation lists have no loop check: two lanes may name each other (docs/adr/0110 §1)', () => {
  assert.equal(schema.validateFacilityConfig(shipped('CARRIER'), 'CARRIER').ok, true);
  const c = shipped('INCIRLIK'); c.consolidation.AP = ['LC']; // LC: [AP] and AP: [LC]
  assert.equal(schema.validateFacilityConfig(c, 'INCIRLIK').ok, true);
});

test('handBack is the one-hop shape with a loop check, and a Position is in consolidation or handBack, not both', () => {
  const a = shipped('TACTICAL'); a.handBack.AIC = 'NOPE';
  reject(a, 'handBack.AIC names unknown Position NOPE');
  const b = shipped('TACTICAL'); b.handBack.TAC_C2 = 'AIC';
  reject(b, 'handBack loops');
  const c = shipped('TACTICAL'); c.consolidation.AIC = ['TAC_C2'];
  reject(c, 'AIC is in both consolidation and handBack');
  const d = shipped('TACTICAL'); delete d.handBack;
  reject(d, 'missing required key handBack');
});

test('every Position needs a class', () => {
  const c = shipped('TACTICAL'); delete c.positionClasses.JTAC;
  reject(c, 'no class for Position JTAC');
});

test('hiddenBlocks must name a known strip type', () => {
  const c = shipped('CENTER'); c.hiddenBlocks.NOPE = ['1'];
  reject(c, 'hiddenBlocks names unknown strip type NOPE');
});

test('validateConfig (the shape check) still rejects what it always did', () => {
  const c = clone(shipped('INCIRLIK')); c.bays.LC[0].view = 'nope';
  assert.equal(schema.validateConfig(c).ok, false);
});

test('requiring facility-config.js reads no file: a config dir that does not exist is fine until first use', () => {
  const out = require('child_process').spawnSync(process.execPath, ['-e', "require('./src/efsp/facility-config.js'); console.log('required')"], {
    cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8',
    env: { ...process.env, CRCSYNC_CONFIG_DIR: path.join(os.tmpdir(), 'no-such-config-dir-facility'), CRCSYNC_STATE_DIR: path.join(os.tmpdir(), 'no-such-state-dir-facility') },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /required/);
});
