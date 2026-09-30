import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { ingestAtoText, parseAtoText, collectWarnings } = await import('../src/efsp/ato/ato-ingest.js');
const { CALLSIGN_RE } = await import('../src/efsp/ato/ato-sets.js');
const { MAX_FREE_TEXT: TOKENIZER_MAX_FREE_TEXT } = await import('../src/efsp/ato/usmtf-tokenize.js');
const { FdrStore, MAX_FREE_TEXT } = await import('../src/efsp/fdr-store.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/ato/${name}`, import.meta.url), 'utf8');
const Z = (h, m) => Date.UTC(2026, 8, 14, h, m); // iron-flag-26-3: 14 SEP 2026
const A = (h, m) => Date.UTC(2026, 3, 14, h, m); // incirlik-day1: 14 APR 2026

// Expected values: docs/parallel/research/usmtf-ato.md §3's oracle table and
// the L3 briefing's §8.2 table.
const EXPECTED = {
  'iron-flag-26-3.txt': {
    '1101A#0': { missionNumber: '1101A', packageId: null, vul: [Z(13, 0), Z(15, 0)], agency: 'MAGIC11', iff: ['12', '0011', '4521'] },
    '1202S#0': { missionNumber: '1202S', packageId: 'AB', vul: [Z(14, 58), Z(15, 2)], agency: 'MAGIC11', iff: ['21', '0021', '4531'] },
    '1203S#0': { missionNumber: '1203S', packageId: 'AB', vul: [Z(14, 50), Z(15, 10)], agency: 'MAGIC11', iff: ['41', '0041', '4541'] },
    '1901T#0': { missionNumber: '1901T', packageId: null, vul: [Z(12, 30), Z(16, 30)], agency: null, iff: [null, null, '4571'] },
    '1801W#0': { missionNumber: '1801W', packageId: null, vul: [Z(12, 0), Z(17, 30)], agency: null, iff: [null, null, '4501'] },
  },
  'incirlik-day1.txt': {
    '0101A#0': { missionNumber: '0101A', packageId: 'AA', vul: [A(4, 30), A(5, 30)], agency: 'MAGIC', iff: ['12', '0101', '4101'] },
    '0103A#0': { missionNumber: '0103A', packageId: 'AA', vul: [A(4, 25), A(5, 35)], agency: 'MAGIC', iff: ['13', '0103', '4103'] },
    '0102A#0': { missionNumber: '0102A', packageId: 'AA', vul: [A(4, 20), A(5, 40)], agency: 'MAGIC', iff: [null, '0102', '4102'] },
    '0201C#0': { missionNumber: '0201C', packageId: null, vul: [A(5, 30), A(7, 30)], agency: 'SCREWTOP', iff: ['14', '0201', '4201'] },
    '0501T#0': { missionNumber: '0501T', packageId: null, vul: [A(3, 30), A(6, 30)], agency: 'MAGIC', iff: [null, '0501', '4501'] },
    '0601W#0': { missionNumber: '0601W', packageId: null, vul: [A(3, 0), A(9, 0)], agency: null, iff: [null, '0601', '4601'] },
  },
};

// WP7 bullet 1 (guide line 1396) — the PARSER half. "Mission Strips" are
// L14's: this test proves the seed each Strip would be created from, through
// the real createFdr. IFF is asserted on the LINE (extras.identityAto), not on
// the FDR, because no FDR write path for Mode 1/2 exists (fdr-store.js:
// "ATO-owned, WP7 hook — no setter exists anywhere") and the ATO's Mode 3 is
// deliberately never seeded as the beacon (guide §3.10.3 rule 3, ADR 0054).
test('WP7: An ATO fixture produces mission Strips with correct mission number, package, vul window, controlling agency and IFF codes (parser half: createFdr seeds + IFF on the line)', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const r = ingestAtoText(fixture(file));
    assert.equal(r.ok, true, file);
    assert.deepEqual(r.missionLines.map((l) => l.lineId), Object.keys(expected), file);
    for (const line of r.missionLines) {
      const want = expected[line.lineId];
      assert.equal(line.extras.ato.seedable, true, `${file} ${line.lineId}`);
      const res = new FdrStore().createFdr(line.fdrSeed, { by: 'ato-test' });
      assert.equal(res.ok, true, `${file} ${line.lineId}: ${res.detail}`);
      const fdr = res.fdr;
      assert.equal(fdr.mission.missionNumber, want.missionNumber);
      assert.equal(fdr.mission.packageId, want.packageId);
      assert.equal(fdr.mission.vulWindowStartUtc, want.vul[0]);
      assert.equal(fdr.mission.vulWindowEndUtc, want.vul[1]);
      assert.equal(fdr.mission.controllingAgency, want.agency);
      assert.equal(fdr.identity.callsign, line.extras.ato.callsign);
      const { modeOne, modeTwo, modeThree } = line.extras.identityAto;
      assert.deepEqual([modeOne, modeTwo, modeThree], want.iff, `${file} ${line.lineId}`);
      // The FDR's own IFF hooks stay untouched, and its beacon is minted, not the ATO's.
      assert.equal(fdr.identity.modeOne, null);
      assert.equal(fdr.identity.modeTwo, null);
      assert.notEqual(fdr.identity.beaconAssigned, modeThree);
    }
  }
});

test('WP7 bullet 3: the community-source caveat is in the parser\'s module headers', () => {
  const files = ['ato-ingest.js', 'ato-structure.js', 'ato-sets.js', 'usmtf-tokenize.js'];
  for (const f of files) {
    const src = readFileSync(new URL(`../src/efsp/ato/${f}`, import.meta.url), 'utf8');
    const cut = src.indexOf('require(');
    const header = cut === -1 ? src : src.slice(0, cut);
    assert.match(header, /DCS community wiki/, f);
    assert.match(header, /MIL-STD-6040/, f);
    assert.match(header, /SOURCE CAVEAT/, f);
  }
});

test('ato parity: createFdr accepts every seedable line and refuses the CALLSIGN_INVALID one', () => {
  const r = ingestAtoText(fixture('malformed.txt'));
  const bad = r.missionLines.find((l) => l.warnings.some((w) => w.code === 'CALLSIGN_INVALID'));
  assert.equal(bad.extras.ato.callsign, 'WEASEL31');
  assert.equal(bad.fdrSeed.callsign, null);
  // With the normalised callsign put back, createFdr must refuse it too —
  // proving CALLSIGN_RE here matches fdr-store.js's rule.
  const refused = new FdrStore().createFdr({ ...bad.fdrSeed, callsign: bad.extras.ato.callsign }, { by: 'ato-test' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'VALIDATION_ERROR');
  for (const l of r.missionLines.filter((x) => x.extras.ato.seedable)) {
    assert.equal(new FdrStore().createFdr(l.fdrSeed, { by: 'ato-test' }).ok, true, l.lineId);
  }
  // The rule itself, on both sides.
  for (const cs of ['A', 'VIPER11', 'ABCDEFG', 'ABCDEFGH', '', 'VIPER 1', 'SHELL-1']) {
    assert.equal(CALLSIGN_RE.test(cs), new FdrStore().createFdr({ callsign: cs }, { by: 't' }).ok, cs);
  }
});

test('ato parity: the free-text cap equals fdr-store.js MAX_FREE_TEXT', () => {
  assert.equal(TOKENIZER_MAX_FREE_TEXT, MAX_FREE_TEXT);
});

test('ato purity: the parser loads nothing that reads config at require time', () => {
  const entry = fileURLToPath(new URL('../src/efsp/ato/ato-ingest.js', import.meta.url));
  const out = execFileSync(process.execPath, ['-e',
    `require(${JSON.stringify(entry)}); console.log(JSON.stringify(Object.keys(require.cache)))`], { encoding: 'utf8' });
  const loaded = JSON.parse(out).map((p) => p.replace(/\\/g, '/'));
  const efsp = loaded.filter((p) => p.includes('/src/') && !p.includes('/src/efsp/ato/'));
  assert.deepEqual(efsp.map((p) => p.slice(p.indexOf('/src/'))), ['/src/efsp/code-allocator.js']);
});

test('ato: the fixtures never hit INTERNAL_ERROR, and garbage is ok:false without throwing', () => {
  for (const f of ['iron-flag-26-3.txt', 'incirlik-day1.txt', 'malformed.txt']) {
    assert.ok(!collectWarnings(ingestAtoText(fixture(f))).some((w) => w.code === 'INTERNAL_ERROR'), f);
  }
  for (const junk of ['', 'hello world', '////', null, 42, {}, 'A'.repeat(2 * 1024 * 1024)]) {
    const r = ingestAtoText(junk);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missionLines, []);
    assert.ok(r.warnings.length >= 1);
  }
  assert.equal(parseAtoText(null).fatal, true);
});
