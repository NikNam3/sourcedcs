import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/* The ATO sorties — WP7 walked end to end (docs/adr/0071, guide §9.8/§9.9).
 *
 * WP7's three acceptance bullets are test names here, verbatim. The rest are
 * the requests a mission night actually makes: a flight filed before its line
 * is imported, a squawk the allocator will not take, a planner amending the
 * ATO after TAC_C2 retyped a vul window, a second ATO replacing the first, a
 * restart.
 *
 * Every test gets its own Board (T7): the snapshot file is removed and a new
 * facade built, so no count here depends on another test. The mission clock is
 * injected and fixed at 21 JUN 2016 1000Z, while the research fixture is dated
 * 14 SEP 2026 — so every expected time below is on the mission's calendar (H68).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ato-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, mustAct, act, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');
const { BLOCK_MAPS, resolveBlockTarget } = await import('../src/efsp/block-map.js');

const IRON = fs.readFileSync(new URL('./fixtures/ato/iron-flag-26-3.txt', import.meta.url), 'utf8');
const OJW = new URL('../../atobrief/test/fixtures/usmtf/ojw1v5-export.txt', import.meta.url);
const clock = { now: () => Date.UTC(2016, 5, 21, 10, 0), source: 'MISSION' };
const M = (h, m) => Date.UTC(2016, 5, 21, h, m);
const CREW = { OPS: 'INCIRLIK', TAC_C2: 'TACTICAL', GCI: 'TACTICAL' };

function fresh() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp({ clock });
  return { efsp, c: crew(efsp, CREW) };
}

function preview(efsp, c, text = IRON) {
  const ack = efsp.handleMessage(c.TAC_C2.session, { version: 1, type: 'efsp-ato-preview', requestId: 'r', actingPositionId: 'TAC_C2', text }).ack;
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return ack.preview;
}

/** Preview, then import with the preview's own defaults unless choices say otherwise. */
function importAto(efsp, c, text = IRON, choices = [], clientMutationId = crypto.randomUUID()) {
  const p = preview(efsp, c, text);
  const res = efsp.handleMessage(c.TAC_C2.session, {
    version: 1, type: 'efsp-ato-mutation', clientMutationId, facilityId: 'TACTICAL', actingPositionId: 'TAC_C2',
    op: { kind: 'ImportAto', text, textSha1: p.textSha1, choices },
  });
  assert.equal(res.ack.ok, true, JSON.stringify(res.ack));
  return { preview: p, ack: res.ack, res };
}

const missionStrips = (efsp) => efsp.boardStoreFor('TACTICAL').getAll().filter((s) => s.role === 'MISSION' && s.state !== 'DROPPED');
const fdrOf = (efsp, callsign) => efsp.fdrStore.getAll().find((f) => f.identity.callsign === callsign);

function fileDeparture(efsp, c, callsign) {
  return mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign } });
}

// ── WP7, verbatim ────────────────────────────────────────────────────────────

const EXPECTED = {
  VIPER11: { missionNumber: '1101A', packageId: null, vul: [M(13, 0), M(15, 0)], agency: 'MAGIC11', iff: ['12', '0011', '4521'] },
  DUDE21: { missionNumber: '1202S', packageId: 'AB', vul: [M(14, 58), M(15, 2)], agency: 'MAGIC11', iff: ['21', '0021', '4531'] },
  SNAKE41: { missionNumber: '1203S', packageId: 'AB', vul: [M(14, 50), M(15, 10)], agency: 'MAGIC11', iff: ['41', '0041', '4541'] },
  SHELL71: { missionNumber: '1901T', packageId: null, vul: [M(12, 30), M(16, 30)], agency: null, iff: [null, null, '4571'] },
  MAGIC11: { missionNumber: '1801W', packageId: null, vul: [M(12, 0), M(17, 30)], agency: null, iff: [null, null, '4501'] },
};

test('WP7: An ATO fixture produces mission Strips with correct mission number, package, vul window, controlling agency and IFF codes.', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c);
  const strips = missionStrips(efsp);
  assert.equal(strips.length, 5);
  for (const [callsign, e] of Object.entries(EXPECTED)) {
    const fdr = fdrOf(efsp, callsign);
    assert.ok(fdr, callsign);
    const strip = strips.find((s) => s.fdrId === fdr.fdrId);
    assert.ok(strip, `${callsign} has a MISSION Strip`);
    assert.equal(strip.bayId, 'tac-c2-tasked');
    assert.equal(strip.ownerPositionId, 'TAC_C2');
    assert.equal(strip.state, 'TASKED');
    assert.equal(fdr.mission.missionNumber, e.missionNumber, callsign);
    assert.equal(fdr.mission.packageId, e.packageId, callsign);
    assert.deepEqual([fdr.mission.vulWindowStartUtc, fdr.mission.vulWindowEndUtc], e.vul, callsign);
    assert.equal(fdr.mission.controllingAgency, e.agency, callsign);
    assert.equal(fdr.identity.modeOne, e.iff[0], callsign);
    assert.equal(fdr.identity.modeTwo, e.iff[1], callsign);
    assert.equal(fdr.ato.iff.modeThree, e.iff[2], callsign);
    assert.equal(fdr.identity.beaconAssigned, e.iff[2], `${callsign}: the ATO's Mode 3 is adopted (H64)`);
  }
  // C1: L16 reads the ATO departure time from here, in-game Zulu on the mission calendar.
  assert.equal(fdrOf(efsp, 'VIPER11').ato.departure.timeUtc, M(12, 0));
});

test('WP7: A tanker\'s AR line and its receivers\' Strips render as a joined group.', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c);
  const shell = fdrOf(efsp, 'SHELL71');
  const viper = fdrOf(efsp, 'VIPER11');
  const dude = fdrOf(efsp, 'DUDE21');
  const tankerLinks = shell.military.arInfo.links;
  assert.deepEqual(tankerLinks.map((l) => [l.role, l.peerFdrId, l.peerCallsign]).sort(),
    [['TANKER', dude.fdrId, 'DUDE21'], ['TANKER', viper.fdrId, 'VIPER11']].sort());
  for (const r of [viper, dude]) {
    assert.deepEqual(r.military.arInfo.links.map((l) => [l.role, l.peerFdrId, l.peerCallsign]), [['RECEIVER', shell.fdrId, 'SHELL71']]);
    assert.ok(r.military.arInfo.links[0].windows[0].arctUtc >= M(13, 45));
  }
  assert.equal(fdrOf(efsp, 'SNAKE41').military.arInfo, null, 'no AR, no join');
  // T2: the join is not MARSA. No relation exists, no separation regime moved.
  assert.deepEqual(efsp.marsaStore.getAll(), []);
  for (const f of efsp.fdrStore.getAll()) assert.equal(f.tofi.separationRegime, null, f.identity.callsign);
});

test('WP7: The community-source caveat (§9.9) appears in the parser\'s module documentation.', () => {
  for (const f of ['ato-ingest.js', 'ato-board.js', 'callsign-fit.js']) {
    const src = fs.readFileSync(new URL(`../src/efsp/ato/${f}`, import.meta.url), 'utf8');
    assert.match(src, /SOURCE CAVEAT \(EFSPImplementationGuide\.md §9\.9/, f);
    assert.match(src, /community wiki/, f);
  }
});

// ── Binding ──────────────────────────────────────────────────────────────────

test('import binds a pre-filed flight on its Mode 3/A', () => {
  const { efsp, c } = fresh();
  let dep = fileDeparture(efsp, c, 'VIPER11');
  dep = mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'SetBlock', blockId: '5', value: '4521' });
  const codesBefore = efsp.fdrStore.codeAllocator.snapshot().length;
  const { preview: p, ack } = importAto(efsp, c);
  const line = p.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(line.action, 'BIND');
  assert.equal(line.bindCandidates.length, 1);
  assert.equal(line.bindCandidates[0].key, 'MODE3');
  const res = ack.results.find((r) => r.lineId === '1101A#0');
  assert.equal(res.action, 'BIND');
  assert.equal(res.fdrId, dep.fdrId, 'the mission line shares the fdrId');
  const fdr = efsp.fdrStore.getFdr(dep.fdrId);
  assert.equal(fdr.identity.beaconAssigned, '4521');
  assert.equal(fdr.mission.missionNumber, '1101A');
  assert.equal(fdr.identity.modeOne, '12');
  assert.equal(efsp.fdrStore.codeAllocator.snapshot().length, codesBefore + 4, 'four new flights, no code minted for the bound one');
});

test('a callsign-only match is offered, and two matches are offered with neither preselected', () => {
  const { efsp, c } = fresh();
  fileDeparture(efsp, c, 'DUDE21');
  fileDeparture(efsp, c, 'VIPER11');
  fileDeparture(efsp, c, 'VIPER11');
  const p = preview(efsp, c);
  const dude = p.lines.find((l) => l.lineId === '1202S#0');
  assert.equal(dude.action, 'BIND');
  assert.equal(dude.bindCandidates[0].key, 'CALLSIGN');
  const viper = p.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(viper.action, 'CREATE');
  assert.equal(viper.bindCandidates.length, 2);
  assert.ok(viper.bindCandidates.every((b) => b.key === 'CALLSIGN'));
});

test('a Mode 3 the allocator refuses keeps the minted code and says so', () => {
  const { efsp, c } = fresh();
  const text = IRON.replace('     34521//', '     37700//').replace('     34531//', '     36001//');
  const { preview: p, ack } = importAto(efsp, c, text);
  for (const [lineId, callsign, code] of [['1101A#0', 'VIPER11', '7700'], ['1202S#0', 'DUDE21', '6001']]) {
    const res = ack.results.find((r) => r.lineId === lineId);
    assert.equal(res.beacon.adopted, false, lineId);
    const fdr = fdrOf(efsp, callsign);
    assert.notEqual(fdr.identity.beaconAssigned, code);
    assert.equal(fdr.provenance['identity.beaconAssigned'], 'COMPUTER_GENERATED');
    assert.equal(fdr.ato.iff.modeThree, code, 'the ATO\'s code is kept beside it');
    assert.ok(p.lines.find((l) => l.lineId === lineId).warnings.some((w) => w.code === 'MODE3_NOT_ADOPTED'));
  }
});

test('Mode 1 and Mode 2 cannot be written by any ATC Position', () => {
  // Statically: no Block of any Role targets them.
  for (const [role, map] of Object.entries(BLOCK_MAPS)) {
    for (const blockId of Object.keys(map)) {
      const t = resolveBlockTarget(blockId, role);
      const path = t && (t.path || t.field);
      assert.ok(!['identity.modeOne', 'identity.modeTwo', 'modeOne', 'modeTwo', 'ato', 'scl', 'arInfo'].includes(path), `${role} ${blockId}`);
    }
  }
  // And by trying: a SetBlock at every Block of a bound flight's two Strips.
  const { efsp, c } = fresh();
  let dep = fileDeparture(efsp, c, 'VIPER11');
  dep = mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'SetBlock', blockId: '5', value: '4521' });
  importAto(efsp, c);
  const mission = missionStrips(efsp).find((s) => s.fdrId === dep.fdrId);
  for (const [strip, positionId, member] of [[dep, 'OPS', c.OPS], [mission, 'TAC_C2', c.TAC_C2]]) {
    for (const blockId of Object.keys(BLOCK_MAPS[strip.role])) {
      const current = efsp.boardStoreFor(member.facilityId).getStrip(strip.stripId);
      act(efsp, member, positionId, current, { kind: 'SetBlock', blockId, value: '77' });
    }
  }
  const fdr = efsp.fdrStore.getFdr(dep.fdrId);
  assert.equal(fdr.identity.modeOne, '12');
  assert.equal(fdr.identity.modeTwo, '0011');
  assert.equal(efsp.fdrStore.setField(dep.fdrId, 'identity.modeOne', '77', { by: 'x' }).ok, false);
});

// ── Re-import and replacement (Q55(a), H65) ──────────────────────────────────

test('re-importing an amended ATO updates what the ATO owns and keeps what a controller typed', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c);
  const viper = fdrOf(efsp, 'VIPER11');
  const strip = missionStrips(efsp).find((s) => s.fdrId === viper.fdrId);
  mustAct(efsp, c.TAC_C2, 'TAC_C2', strip, { kind: 'SetBlock', blockId: 'M6', value: '1330' });
  const typed = efsp.fdrStore.getFdr(viper.fdrId).mission.vulWindowStartUtc;
  assert.equal(efsp.fdrStore.getFdr(viper.fdrId).provenance['mission.vulWindowStartUtc'], 'CONTROLLER_ENTERED');

  // Planning moves VIPER 11's window to 1400–1600Z and changes its Mode 1, and
  // drops SNAKE 41 from the ATO altogether.
  const amended = IRON
    .replace('AMSNLOC/141300ZSEP/141500ZSEP/CAP NORTH', 'AMSNLOC/141400ZSEP/141600ZSEP/CAP NORTH')
    .replace('00011/112/20011/', '00011/113/20011/')
    .replace(/AMSNDAT\/N\/1203S[\s\S]*?(?=TASKUNIT\/909ARS)/, '')
    .replace('/1203S /SNAKE 41 /2 /AC:F16C /SEAD   /141440Z /BRAVO//', '//')
    .replace('/1202S /STRIKE /2 /AC:F15E /DUDE 21\n/AB    /SOURCE DCS 2 /1203S /SEAD   /2 /AC:F16C /SNAKE 41//', '/1202S /STRIKE /2 /AC:F15E /DUDE 21//');
  const p = preview(efsp, c, amended);
  assert.equal(p.lines.length, 4);
  const line = p.lines.find((l) => l.lineId === '1101A#0');
  assert.equal(line.action, 'UPDATE');
  assert.equal(line.existingFdrId, viper.fdrId);
  const byPath = Object.fromEntries(line.changes.map((ch) => [ch.path, ch]));
  assert.equal(byPath['mission.vulWindowStartUtc'].ownedBy, 'CONTROLLER');
  assert.equal(byPath['mission.vulWindowEndUtc'].ownedBy, 'ATO');
  assert.equal(byPath['identity.modeOne'].to, '13');
  assert.deepEqual(p.notInThisAto.map((n) => n.callsign), ['SNAKE41'], 'listed, never dropped');

  const snake = fdrOf(efsp, 'SNAKE41');
  const snakeBefore = JSON.stringify(snake);
  const { ack } = importAto(efsp, c, amended);
  const res = ack.results.find((r) => r.lineId === '1101A#0');
  assert.equal(res.action, 'UPDATE');
  assert.deepEqual(res.kept.map((k) => k.path), ['mission.vulWindowStartUtc']);
  const after = efsp.fdrStore.getFdr(viper.fdrId);
  assert.equal(after.mission.vulWindowStartUtc, typed, 'the controller\'s value stands');
  assert.equal(after.mission.vulWindowEndUtc, M(16, 0), 'the ATO\'s value is replaced');
  assert.equal(after.identity.modeOne, '13');
  assert.equal(missionStrips(efsp).length, 5, 'no second Strip for any line; SNAKE 41 untouched');
  assert.equal(JSON.stringify(efsp.fdrStore.getFdr(snake.fdrId)), snakeBefore);
});

test('H65: a new ATO replaces the previous one — its Strips stay, and the lines it shares are rebound to it', () => {
  const { efsp, c } = fresh();
  const first = importAto(efsp, c);
  const second = IRON.replace('MSGID/ATO/SOURCEDCS AOC/ATO C/SEP//', 'MSGID/ATO/SOURCEDCS AOC/ATO D/SEP//');
  const { ack } = importAto(efsp, c, second);
  assert.ok(ack.results.every((r) => r.action === 'UPDATE'));
  for (const f of efsp.fdrStore.getAll()) {
    assert.equal(f.ato.atoRef.msgId.serial, 'ATO D', f.identity.callsign);
    assert.notEqual(f.ato.atoRef.textSha1, first.preview.textSha1);
  }
  assert.equal(missionStrips(efsp).length, 5);
});

test('a replayed import creates nothing twice', () => {
  const { efsp, c } = fresh();
  const cmid = crypto.randomUUID();
  const { ack } = importAto(efsp, c, IRON, [], cmid);
  const again = efsp.handleMessage(c.TAC_C2.session, {
    version: 1, type: 'efsp-ato-mutation', clientMutationId: cmid, facilityId: 'TACTICAL', actingPositionId: 'TAC_C2',
    op: { kind: 'ImportAto', text: IRON, textSha1: ack.textSha1, choices: [] },
  });
  assert.deepEqual(again.ack, ack);
  assert.equal(missionStrips(efsp).length, 5);
  assert.equal(efsp.fdrStore.getAll().length, 5);
});

test('the real squadron ATO imports', { skip: !fs.existsSync(OJW) && 'atobrief/test/fixtures/usmtf/ojw1v5-export.txt is missing' }, () => {
  const { efsp, c } = fresh();
  const text = fs.readFileSync(OJW, 'utf8');
  const { preview: p, ack } = importAto(efsp, c, text);
  assert.ok(p.lines.length > 0);
  const seedable = p.lines.filter((l) => l.seedable);
  assert.equal(ack.results.filter((r) => r.ok && r.action === 'CREATE').length, seedable.length, JSON.stringify(ack.results));
  assert.ok(p.lines.every((l) => Array.isArray(l.missing)));
  assert.ok(p.lines.some((l) => l.missing.includes('modeOne')), 'missing acceptance fields are listed');
  // BLADE 21's 6001 is in the AI block (S-L3): warned, and not adopted.
  const blade = p.lines.find((l) => l.callsign === 'BLADE21');
  if (blade) {
    assert.ok(blade.warnings.some((w) => w.code === 'MODE3_NOT_ADOPTED'));
    assert.notEqual(fdrOf(efsp, 'BLADE21').identity.beaconAssigned, '6001');
  }
});

test('a restart keeps the ATO tasking and the AR group', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c);
  efsp.persist();
  const reborn = createEfsp({ clock });
  const shell = reborn.fdrStore.getAll().find((f) => f.identity.callsign === 'SHELL71');
  const viper = reborn.fdrStore.getAll().find((f) => f.identity.callsign === 'VIPER11');
  assert.equal(viper.identity.modeOne, '12');
  assert.equal(viper.identity.modeTwo, '0011');
  assert.equal(viper.ato.missionNumber, '1101A');
  assert.equal(viper.military.arInfo.links[0].peerFdrId, shell.fdrId);
  assert.equal(shell.military.arInfo.links.length, 2);
  assert.equal(reborn.boardStoreFor('TACTICAL').getAll().filter((s) => s.role === 'MISSION').length, 5);
});
