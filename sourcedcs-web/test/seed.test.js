const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { seedDataDir } = require('../seed');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-')); }

test('copies missing files, never overwrites an existing one', () => {
  const data = tmp(), seed = tmp();
  fs.writeFileSync(path.join(seed, 'skill-tree.json'), '{"seed":true}');
  fs.writeFileSync(path.join(seed, 'events.json'), '[]');
  fs.writeFileSync(path.join(data, 'skill-tree.json'), '{"prod":"keep me"}');
  const copied = seedDataDir(data, seed);
  assert.deepStrictEqual(copied, ['events.json']);
  assert.strictEqual(fs.readFileSync(path.join(data, 'skill-tree.json'), 'utf8'), '{"prod":"keep me"}');
  assert.strictEqual(fs.readFileSync(path.join(data, 'events.json'), 'utf8'), '[]');
});

test('missing seed dir is a no-op; second run copies nothing', () => {
  const data = tmp();
  assert.deepStrictEqual(seedDataDir(data, path.join(data, 'nope')), []);
  const seed = tmp();
  fs.writeFileSync(path.join(seed, 'a.json'), '1');
  assert.deepStrictEqual(seedDataDir(data, seed), ['a.json']);
  assert.deepStrictEqual(seedDataDir(data, seed), []);
});

test('does not delete data files absent from the seed', () => {
  const data = tmp(), seed = tmp();
  fs.writeFileSync(path.join(data, 'members.json'), '[1]');
  seedDataDir(data, seed);
  assert.strictEqual(fs.readFileSync(path.join(data, 'members.json'), 'utf8'), '[1]');
});
