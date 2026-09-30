import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// L14 (docs/adr/0071) — the pure half of the ATO import: callsign fitting
// (H60), the mission-date shift (H68), the preview, the bind candidates and the
// plan. The Board half is efsp-ws-ato.test.mjs and efsp-scenario-ato.test.mjs.

const board = await import('../src/efsp/ato/ato-board.js');
const { fitCallsign } = await import('../src/efsp/ato/callsign-fit.js');
const { analyseAto, previewAto, planImport, bindCandidatesFor, atoDateShift, redateAtoTime, redateDeep } = board;

const fixture = (name) => readFileSync(new URL(`./fixtures/ato/${name}`, import.meta.url), 'utf8');
const IRON = fixture('iron-flag-26-3.txt');
const DAY = 24 * 3600 * 1000;
// The mission is flown on 21 JUN 2016 at 1000Z; the ATO says 14 SEP 2026.
const MISSION_NOW = Date.UTC(2016, 5, 21, 10, 0);
const M = (h, m, dayOffset = 0) => Date.UTC(2016, 5, 21 + dayOffset, h, m);

// ── H60 ──────────────────────────────────────────────────────────────────────

test('H60: a callsign over 7 characters loses vowels from the back until it fits', () => {
  assert.equal(fitCallsign('ENFIELD11'), 'ENFLD11');
  assert.equal(fitCallsign('SHADOW11'), 'SHADW11');
  assert.equal(fitCallsign('VIPER11'), 'VIPER11', 'a callsign that fits is untouched');
  assert.equal(fitCallsign('DARKSTAR1'), 'DRKSTR1');
  assert.equal(fitCallsign('BDRKSTRXYZ1'), null, 'no vowels left to cut: waits for a controller');
  assert.equal(fitCallsign(null), null);
  assert.equal(fitCallsign('VIPER-11'), null, 'only ever runs on the normaliser output');
});

test('H60: the same cases as miztoyaml\'s ato_callsign (tools/tests/test_h43_support_missions.py), so the two copies agree', async () => {
  const { normaliseCallsign } = await import('../src/efsp/ato/ato-sets.js');
  const fit = (name) => fitCallsign(normaliseCallsign(name).normalised);
  const SHARED = [
    ['ENFIELD11', 'ENFLD11'], ['SHADOW11', 'SHADW11'], ['VIPER-1', 'VIPER1'], ['Mauler 6', 'MAULER6'],
    ['MAGIC', 'MAGIC'], ['TEXACO11', 'TEXAC11'], ['ARCO11', 'ARCO11'], ['EAGLEEYE1', 'EAGLEY1'], ['AEIOUBCDF', 'AEIBCDF'],
  ];
  for (const [name, expected] of SHARED) assert.equal(fit(name), expected, name);
  // The one deliberate difference: a name that cannot fit with every vowel cut.
  // miztoyaml leaves it uncut for a planner (atobrief then warns
  // CALLSIGN_NOT_SEEDABLE); the import returns null and the line waits for a
  // controller to type a callsign.
  assert.equal(fit('STRAWBERRY11'), null);
  assert.equal(fit(''), null);
  assert.equal(fit('--'), null);
});

// ── H68 ──────────────────────────────────────────────────────────────────────

const docWith = (fromUtc, toUtc) => ({ header: { timeframe: { fromUtc, toUtc } }, missionLines: [] });

test('H68: an ATO already on the mission date is not moved', () => {
  const doc = docWith(Date.UTC(2016, 5, 21, 6, 0), Date.UTC(2016, 5, 22, 5, 59));
  const { shiftMs, warning } = atoDateShift(doc, MISSION_NOW);
  assert.equal(shiftMs, 0);
  assert.equal(warning, null);
  assert.equal(redateAtoTime(Date.UTC(2016, 5, 21, 13, 0), shiftMs), Date.UTC(2016, 5, 21, 13, 0));
});

test('H68: times keep their time of day and their day within the ATO, on the mission calendar (month rollover)', () => {
  // ATO period 30 JUN 0600Z – 01 JUL 0559Z; mission on 21 JUN.
  const doc = docWith(Date.UTC(2016, 5, 30, 6, 0), Date.UTC(2016, 6, 1, 5, 59));
  const { shiftMs, warning } = atoDateShift(doc, MISSION_NOW);
  assert.equal(redateAtoTime(Date.UTC(2016, 5, 30, 13, 0), shiftMs), M(13, 0));
  assert.equal(redateAtoTime(Date.UTC(2016, 6, 1, 2, 0), shiftMs), M(2, 0, 1), 'the ATO\'s second day stays the second day');
  assert.equal(warning.code, 'ATO_DATE_DIFFERS');
  assert.match(warning.message, /30 JUN 2016.*21 JUN 2016/);
});

test('H68: a year rollover', () => {
  const doc = docWith(Date.UTC(2016, 11, 31, 6, 0), Date.UTC(2017, 0, 1, 5, 59));
  const now = Date.UTC(2017, 0, 3, 12, 0);
  const { shiftMs } = atoDateShift(doc, now);
  // 3 JAN 1200Z sits in the period's first day once it starts on 3 JAN 0600Z.
  assert.equal(redateAtoTime(Date.UTC(2016, 11, 31, 23, 30), shiftMs), Date.UTC(2017, 0, 3, 23, 30));
  assert.equal(redateAtoTime(Date.UTC(2017, 0, 1, 1, 0), shiftMs), Date.UTC(2017, 0, 4, 1, 0));
});

test('H68: an ATO dated ten years after the mission lands on the mission date', () => {
  const doc = docWith(Date.UTC(2026, 8, 14, 6, 0), Date.UTC(2026, 8, 15, 5, 59));
  const { shiftMs, warning } = atoDateShift(doc, MISSION_NOW);
  assert.equal(redateAtoTime(Date.UTC(2026, 8, 14, 13, 0), shiftMs), M(13, 0));
  assert.match(warning.message, /14 SEP 2026/);
});

test('H68: a mission flown in the ATO period\'s second calendar day sees the period around it', () => {
  const doc = docWith(Date.UTC(2026, 8, 14, 6, 0), Date.UTC(2026, 8, 15, 5, 59));
  const now = Date.UTC(2016, 5, 22, 3, 0); // 0300Z, inside the period's second day
  const { shiftMs } = atoDateShift(doc, now);
  const from = redateAtoTime(Date.UTC(2026, 8, 14, 6, 0), shiftMs);
  const to = redateAtoTime(Date.UTC(2026, 8, 15, 5, 59), shiftMs);
  assert.ok(from <= now && now <= to, `${new Date(from).toISOString()}..${new Date(to).toISOString()} contains ${new Date(now).toISOString()}`);
});

test('H68: an ATO with no TIMEFRAM is centred on its own times; null stays null; raw DTGs are untouched', () => {
  const doc = { header: { timeframe: null }, missionLines: [{ fdrSeed: { vulWindowStartUtc: Date.UTC(2026, 8, 14, 13, 0), vulWindowEndUtc: Date.UTC(2026, 8, 14, 15, 0) } }] };
  const { shiftMs } = atoDateShift(doc, MISSION_NOW);
  assert.equal(redateAtoTime(Date.UTC(2026, 8, 14, 14, 0), shiftMs), M(14, 0));
  assert.equal(redateAtoTime(null, shiftMs), null);
  const deep = redateDeep({ departure: { timeUtc: Date.UTC(2026, 8, 14, 12, 0), raw: '141200ZSEP' } }, shiftMs);
  assert.deepEqual(deep, { departure: { timeUtc: M(12, 0), raw: '141200ZSEP' } });
});

// ── The preview ──────────────────────────────────────────────────────────────

// Oracle: docs/parallel/research/usmtf-ato.md §3's table, on the mission calendar (H68).
const ORACLE = {
  '1101A#0': { callsign: 'VIPER11', packageId: null, vul: [M(13, 0), M(15, 0)], agency: 'MAGIC11', iff: ['12', '0011', '4521'] },
  '1202S#0': { callsign: 'DUDE21', packageId: 'AB', vul: [M(14, 58), M(15, 2)], agency: 'MAGIC11', iff: ['21', '0021', '4531'] },
  '1203S#0': { callsign: 'SNAKE41', packageId: 'AB', vul: [M(14, 50), M(15, 10)], agency: 'MAGIC11', iff: ['41', '0041', '4541'] },
  '1901T#0': { callsign: 'SHELL71', packageId: null, vul: [M(12, 30), M(16, 30)], agency: null, iff: [null, null, '4571'] },
  '1801W#0': { callsign: 'MAGIC11', packageId: null, vul: [M(12, 0), M(17, 30)], agency: null, iff: [null, null, '4501'] },
};

test('the preview of the research fixture lists its five lines with the oracle\'s values on the mission calendar', () => {
  const p = previewAto({ text: IRON, fdrs: [], liveStrips: [], nowUtc: MISSION_NOW });
  assert.equal(p.ok, true);
  assert.equal(p.lines.length, 5);
  assert.match(p.textSha1, /^[0-9a-f]{40}$/);
  assert.ok(p.warnings.some((w) => w.code === 'ATO_DATE_DIFFERS'));
  for (const l of p.lines) {
    const o = ORACLE[l.lineId];
    assert.ok(o, l.lineId);
    assert.equal(l.callsign, o.callsign);
    assert.equal(l.summary.packageId, o.packageId);
    assert.deepEqual([l.summary.vul.startUtc, l.summary.vul.endUtc], o.vul, l.lineId);
    assert.equal(l.summary.agency, o.agency);
    assert.deepEqual([l.summary.iff.modeOne, l.summary.iff.modeTwo, l.summary.iff.modeThree], o.iff);
    assert.equal(l.action, 'CREATE', 'nothing on the Board: every line creates');
    assert.equal(typeof l.missionNumber, 'string');
  }
  assert.deepEqual(p.lines.find((l) => l.lineId === '1101A#0').missing, ['packageId']);
  assert.equal(p.arLinks.length, 2);
  assert.equal(p.arLinks[0].arctUtc, M(13, 45), 'AR times are re-dated too');
});

test('a line whose callsign is too long is shortened (H60), and one that cannot be shortened waits for a typed callsign', () => {
  const text = IRON.replace('VIPER 11/402+', 'ENFIELD 11/402+').replace(/ACTYP:KC135\/SHELL 71/, 'ACTYP:KC135/BDRKSTRX 71');
  const p = previewAto({ text, fdrs: [], liveStrips: [], nowUtc: MISSION_NOW });
  const enfield = p.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(enfield.callsign, 'ENFLD11');
  assert.equal(enfield.seedable, true);
  assert.ok(enfield.warnings.some((w) => w.code === 'CALLSIGN_SHORTENED'));
  const tanker = p.lines.find((l) => l.lineId === '1901T#0');
  assert.equal(tanker.callsign, null);
  assert.equal(tanker.seedable, false);
  assert.ok(tanker.missing.includes('callsign'));
});

test('a Mode 3 in the AI block is flagged in the preview (S-L3)', () => {
  const text = IRON.replace('     34521//', '     36001//');
  assert.notEqual(text, IRON);
  const p = previewAto({ text, fdrs: [], liveStrips: [], nowUtc: MISSION_NOW });
  const l = p.lines.find((x) => x.lineId === '1101A#0');
  assert.ok(l.warnings.some((w) => w.code === 'MODE3_NOT_ADOPTED' && /6000–6777/.test(w.message)), JSON.stringify(l.warnings));
});

// ── Bind candidates ──────────────────────────────────────────────────────────

const fdr = (fdrId, callsign, beaconAssigned, extra = {}) => ({ fdrId, identity: { callsign, beaconAssigned }, provenance: {}, mission: {}, ...extra });
const strip = (stripId, fdrId, role, facilityId = 'INCIRLIK', ownerPositionId = 'OPS') => ({ stripId, fdrId, role, facilityId, ownerPositionId, state: 'PROPOSED' });

test('bind candidates: the Mode 3/A first', () => {
  const fdrs = [fdr('a', 'VIPER11', '4521'), fdr('b', 'VIPER11', '0101')];
  const liveStrips = [strip('s1', 'a', 'DEPARTURE'), strip('s2', 'b', 'DEPARTURE')];
  const c = bindCandidatesFor({ callsign: 'VIPER11', modeThree: '4521' }, fdrs, liveStrips);
  assert.deepEqual(c.map((x) => [x.fdrId, x.key]), [['a', 'MODE3']], 'a MODE3 match hides the callsign matches');
  assert.equal(c[0].strips[0].stripId, 's1');
});

test('bind candidates: the callsign only when no Mode 3 matches; two matches are both listed', () => {
  const fdrs = [fdr('a', 'VIPER11', '0101'), fdr('b', 'VIPER11', '0102'), fdr('c', 'DUDE21', '0103')];
  const liveStrips = [strip('s1', 'a', 'DEPARTURE'), strip('s2', 'b', 'ARRIVAL'), strip('s3', 'c', 'DEPARTURE')];
  const c = bindCandidatesFor({ callsign: 'VIPER11', modeThree: '4521' }, fdrs, liveStrips);
  assert.deepEqual(c.map((x) => [x.fdrId, x.key]), [['a', 'CALLSIGN'], ['b', 'CALLSIGN']]);
});

test('bind candidates: a flight with a live MISSION Strip on TACTICAL, or with no live Strip, is not offered', () => {
  const fdrs = [fdr('a', 'VIPER11', '4521'), fdr('b', 'VIPER11', '4521')];
  const liveStrips = [strip('s1', 'a', 'DEPARTURE'), strip('m1', 'a', 'MISSION', 'TACTICAL', 'TAC_C2')];
  assert.deepEqual(bindCandidatesFor({ callsign: 'VIPER11', modeThree: '4521' }, fdrs, liveStrips), []);
});

test('bind candidates: a reserved or synthetic ATO Mode 3 never matches on the code', () => {
  const fdrs = [fdr('a', 'OTHER', '7700')];
  assert.deepEqual(bindCandidatesFor({ callsign: 'VIPER11', modeThree: '7700' }, fdrs, [strip('s', 'a', 'DEPARTURE')]), []);
});

test('the preview preselects BIND for exactly one candidate and CREATE for two', () => {
  const one = previewAto({ text: IRON, fdrs: [fdr('a', 'VIPER11', '4521')], liveStrips: [strip('s1', 'a', 'DEPARTURE')], nowUtc: MISSION_NOW });
  const v1 = one.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(v1.action, 'BIND');
  assert.equal(v1.bindCandidates[0].key, 'MODE3');
  const two = previewAto({
    text: IRON,
    fdrs: [fdr('a', 'VIPER11', '0101'), fdr('b', 'VIPER11', '0102')],
    liveStrips: [strip('s1', 'a', 'DEPARTURE'), strip('s2', 'b', 'DEPARTURE')],
    nowUtc: MISSION_NOW,
  });
  const v2 = two.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(v2.action, 'CREATE', 'ambiguity is an answer, not a tiebreak');
  assert.equal(v2.bindCandidates.length, 2);
});

// ── The plan ─────────────────────────────────────────────────────────────────

test('planImport refuses a BIND to a flight that is not a candidate, and a stale text', () => {
  const a = analyseAto({ text: IRON, fdrs: [fdr('a', 'VIPER11', '4521')], liveStrips: [strip('s1', 'a', 'DEPARTURE')], nowUtc: MISSION_NOW });
  const bad = planImport(a, [{ lineId: '1101A#0', action: 'BIND', fdrId: 'nope' }], { textSha1: a.preview.textSha1 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'VALIDATION_ERROR');
  const stale = planImport(a, [], { textSha1: '0'.repeat(40) });
  assert.equal(stale.reason, 'STALE_REV');
  const good = planImport(a, [{ lineId: '1101A#0', action: 'BIND', fdrId: 'a' }], { textSha1: a.preview.textSha1 });
  assert.equal(good.ok, true);
  assert.deepEqual(good.steps.map((s) => s.action), ['BIND', 'CREATE', 'CREATE', 'CREATE', 'CREATE']);
});

test('planImport: an unseedable line cannot be created without a typed callsign; a typed one is used', () => {
  const text = IRON.replace(/ACTYP:KC135\/SHELL 71/, 'ACTYP:KC135/BDRKSTRX 71');
  const a = analyseAto({ text, fdrs: [], liveStrips: [], nowUtc: MISSION_NOW });
  assert.equal(planImport(a, []).ok, false);
  const typed = planImport(a, [{ lineId: '1901T#0', action: 'CREATE', callsignOverride: 'tex71' }]);
  assert.equal(typed.ok, true);
  assert.equal(typed.steps.find((s) => s.lineId === '1901T#0').callsign, 'TEX71');
  assert.equal(planImport(a, [{ lineId: '1901T#0', action: 'SKIP' }]).ok, true);
  assert.equal(planImport(a, [{ lineId: 'X#0', action: 'SKIP' }]).ok, false, 'a line the ATO does not have');
  assert.equal(planImport(a, [{ lineId: '1901T#0', action: 'UPDATE' }]).ok, false, 'no earlier flight to update');
});

test('WP7 b3 (module half): the community-source caveat is in every module under ato/ that L14 added', () => {
  for (const f of ['ato-board.js', 'callsign-fit.js']) {
    const src = readFileSync(new URL(`../src/efsp/ato/${f}`, import.meta.url), 'utf8');
    assert.match(src, /SOURCE CAVEAT \(EFSPImplementationGuide\.md §9\.9/, f);
    assert.match(src, /community wiki|DCS community/, f);
  }
  const boardSrc = readFileSync(new URL('../src/efsp/ato/ato-board.js', import.meta.url), 'utf8');
  assert.doesNotMatch(boardSrc, /Date\.now\(/, 'H11: no wall clock in the ATO import');
});
