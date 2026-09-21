import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// stereo-routes.js resolves and reads its config path once at module load, so
// the override goes in before the first import — same pattern as
// efsp-facility-config.test.mjs. Without it, setStereoRoutes() below would
// write straight into the real, committed config/efsp-stereo-routes.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-stereo-routes-test-'));
const tmpFile = path.join(tmpDir, 'efsp-stereo-routes.json');
const FIXTURE = [
  { name: 'PACK 1', description: 'north departure', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'LTAG DCT ALPHA DCT LTAG', requestedAltitude: '250', remarks: 'squadron standard' },
  { name: 'PACK 2', route: 'LTAG DCT BRAVO', active: false },
];
fs.writeFileSync(tmpFile, JSON.stringify(FIXTURE));
process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH = tmpFile;

const {
  getStereoRoutes, getActiveStereoRoutes, resolveStereoRoute, toFdrFiledSeed,
  setStereoRoutes, validateStereoRoutes, normalizeStereoName, MAX_FREE_TEXT,
} = await import('../src/efsp/stereo-routes.js');

// ── normalisation ────────────────────────────────────────────────────────

test('normalizeStereoName folds case, whitespace and hyphens so one route has one key', () => {
  const key = normalizeStereoName('PACK 1');
  for (const spelling of ['PACK1', 'pack 1', 'pack-1', '  PACK   1  ', 'Pack-1']) {
    assert.equal(normalizeStereoName(spelling), key, `${spelling} should normalise to the same key`);
  }
});

test('normalizeStereoName treats null/undefined/non-strings as an empty name rather than throwing', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.doesNotThrow(() => normalizeStereoName(value));
  }
  assert.equal(normalizeStereoName(null), '');
});

// ── validation ───────────────────────────────────────────────────────────

test('the config must be an array', () => {
  const check = validateStereoRoutes({ 'PACK 1': {} });
  assert.equal(check.ok, false);
  assert.match(check.detail, /must be an array/);
});

test('each entry must be an object, not a bare string', () => {
  const check = validateStereoRoutes(['PACK 1']);
  assert.equal(check.ok, false);
  assert.match(check.detail, /must be an object/);
});

test('a route needs a non-empty name', () => {
  for (const bad of [{ route: 'X' }, { name: '', route: 'X' }, { name: '   ', route: 'X' }]) {
    const check = validateStereoRoutes([bad]);
    assert.equal(check.ok, false, JSON.stringify(bad));
    assert.match(check.detail, /name/);
  }
});

test('a name made entirely of spaces and hyphens is rejected — it normalises to nothing', () => {
  const check = validateStereoRoutes([{ name: ' - - ', route: 'X' }]);
  assert.equal(check.ok, false);
  assert.match(check.detail, /normalises to an empty name/);
});

test('two names that differ only in spacing or case are a collision, not last-one-wins', () => {
  const check = validateStereoRoutes([
    { name: 'PACK 1', route: 'A' },
    { name: 'pack-1', route: 'B' },
  ]);
  assert.equal(check.ok, false);
  // The whole reason the normaliser exists is that these are one route to a
  // controller; silently picking a winner would defeat it.
  assert.match(check.detail, /same route once normalised/);
});

test('a route needs a non-empty route string — the expansion is the point of the record', () => {
  for (const bad of [{ name: 'PACK 1' }, { name: 'PACK 1', route: '' }, { name: 'PACK 1', route: '  ' }]) {
    const check = validateStereoRoutes([bad]);
    assert.equal(check.ok, false, JSON.stringify(bad));
    assert.match(check.detail, /needs a non-empty route/);
  }
});

test('optional fields must be strings when present', () => {
  const check = validateStereoRoutes([{ name: 'PACK 1', route: 'A', requestedAltitude: 250 }]);
  assert.equal(check.ok, false);
  assert.match(check.detail, /requestedAltitude must be a string/);
});

test('free text is capped — a stereo route seeds an FDR, and an FDR is broadcast whole', () => {
  const check = validateStereoRoutes([{ name: 'PACK 1', route: 'x'.repeat(MAX_FREE_TEXT + 1) }]);
  assert.equal(check.ok, false);
  assert.match(check.detail, new RegExp(`limited to ${MAX_FREE_TEXT} characters`));
});

test('active must be a boolean when present', () => {
  const check = validateStereoRoutes([{ name: 'PACK 1', route: 'A', active: 'yes' }]);
  assert.equal(check.ok, false);
  assert.match(check.detail, /active must be a boolean/);
});

test('an unrecognised key is tolerated, not rejected — same latitude airspace-config gives', () => {
  assert.deepEqual(validateStereoRoutes([{ name: 'PACK 1', route: 'A', squadronNote: 'whatever' }]), { ok: true });
});

test('an empty table is valid — that is what ships', () => {
  assert.deepEqual(validateStereoRoutes([]), { ok: true });
});

// ── loading and reading ──────────────────────────────────────────────────

test('the on-disk table loaded at require time, inactive entries included', () => {
  assert.deepEqual(getStereoRoutes().map(r => r.name), ['PACK 1', 'PACK 2']);
});

test('getActiveStereoRoutes hides a retired route — a picker must never offer one', () => {
  assert.deepEqual(getActiveStereoRoutes().map(r => r.name), ['PACK 1']);
});

test('resolveStereoRoute finds one route however the controller spelled it', () => {
  for (const spelling of ['PACK 1', 'PACK1', 'pack1', 'pack-1', '  PACK 1  ']) {
    const found = resolveStereoRoute(spelling);
    assert.ok(found, `${spelling} should resolve`);
    // The CANONICAL spelling comes back, not what was typed — that is what
    // ends up on the Strip.
    assert.equal(found.name, 'PACK 1');
  }
});

test('resolveStereoRoute returns null for an unknown name and for an empty one', () => {
  assert.equal(resolveStereoRoute('PACK 9'), null);
  assert.equal(resolveStereoRoute(''), null);
  assert.equal(resolveStereoRoute(null), null);
});

test('resolveStereoRoute DOES return an inactive route, flag and all — resolution is not filability', () => {
  // "does this name exist" and "may it be filed" are separate questions, so
  // the caller can refuse a retired route specifically rather than report it
  // as a typo.
  const found = resolveStereoRoute('PACK2');
  assert.equal(found.name, 'PACK 2');
  assert.equal(found.active, false);
});

test('reads are clones — mutating a result cannot corrupt the table', () => {
  const found = resolveStereoRoute('PACK1');
  found.route = 'MUTATED';
  assert.equal(resolveStereoRoute('PACK1').route, 'LTAG DCT ALPHA DCT LTAG');

  const all = getStereoRoutes();
  all[0].name = 'MUTATED';
  assert.equal(getStereoRoutes()[0].name, 'PACK 1');
});

// ── the FDR seed ─────────────────────────────────────────────────────────

test('toFdrFiledSeed produces the flat seed createFdr consumes', () => {
  assert.deepEqual(toFdrFiledSeed(resolveStereoRoute('PACK1')), {
    route: 'LTAG DCT ALPHA DCT LTAG',
    requestedAltitude: '250',
    departureAirport: 'LTAG',
    destinationAirport: 'LTAG',
    remarks: 'squadron standard',
  });
});

test('toFdrFiledSeed leaves absent optional fields as empty strings, and carries no aircraft type', () => {
  const seed = toFdrFiledSeed({ name: 'PACK 2', route: 'LTAG DCT BRAVO' });
  assert.deepEqual(seed, { route: 'LTAG DCT BRAVO', requestedAltitude: '', departureAirport: '', destinationAirport: '', remarks: '' });
  // A canned ROUTE says nothing about what airframe is flying it — unlike
  // the DD1801 seed, which legitimately carries aircraftType/wtc.
  assert.equal('aircraftType' in seed, false);
  assert.equal('wakeCategory' in seed, false);
});

test('toFdrFiledSeed on garbage is an empty seed, never a throw', () => {
  for (const bad of [null, undefined, 'PACK 1', 42]) {
    assert.deepEqual(toFdrFiledSeed(bad), {});
  }
});

// ── persistence ──────────────────────────────────────────────────────────

test('setStereoRoutes validates first and leaves the table untouched when it fails', () => {
  const before = getStereoRoutes();
  const result = setStereoRoutes([{ name: 'PACK 3' }]); // no route
  assert.equal(result.ok, false);
  assert.deepEqual(getStereoRoutes(), before);
});

test('setStereoRoutes replaces the table and persists it to the write path', () => {
  const next = [{ name: 'VIPER STANDARD', route: 'LTAG DCT CHARLIE', requestedAltitude: '300' }];
  assert.deepEqual(setStereoRoutes(next), { ok: true });
  assert.deepEqual(getStereoRoutes(), next);
  assert.deepEqual(JSON.parse(fs.readFileSync(tmpFile, 'utf8')), next);
  // Reachable by the spelling a controller would actually type.
  assert.equal(resolveStereoRoute('viperstandard').name, 'VIPER STANDARD');
  // Restore, so this file's later tests don't inherit the edit.
  setStereoRoutes(FIXTURE);
});

// _load()'s recovery path needs a genuinely fresh module instance, and the
// CJS require cache is keyed on the resolved filename — an import() with a
// cache-busting query string still hands back the same instance. So: a child
// process per case. The real failure this guards is crc-sync refusing to boot
// because somebody left a trailing comma in a squadron config file.
function loadInChildProcess(fileContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-stereo-load-'));
  const file = path.join(dir, 'efsp-stereo-routes.json');
  if (fileContents !== null) fs.writeFileSync(file, fileContents);
  const modulePath = path.join(import.meta.dirname, '../src/efsp/stereo-routes.js');
  const out = execFileSync(process.execPath, [
    '-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(modulePath)}).getStereoRoutes()))`,
  ], { env: { ...process.env, CRCSYNC_EFSP_STEREO_ROUTES_PATH: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}

test('a table that is not valid JSON falls back to an empty one rather than throwing at require time', () => {
  assert.deepEqual(loadInChildProcess('{ not json'), []);
});

test('a table that is valid JSON but fails validation falls back to an empty one', () => {
  assert.deepEqual(loadInChildProcess(JSON.stringify([{ name: 'PACK 1' }])), []); // no route
});

test('a missing table file is the shipped state, not an error', () => {
  assert.deepEqual(loadInChildProcess(null), []);
});

test('a valid table loads in a fresh process — the fallback cases above are failing, not just defaulting', () => {
  assert.deepEqual(loadInChildProcess(JSON.stringify(FIXTURE)).map(r => r.name), ['PACK 1', 'PACK 2']);
});
