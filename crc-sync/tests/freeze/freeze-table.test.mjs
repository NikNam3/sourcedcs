import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, summarize, summarizeFinalState, digest, checkGolden } from './freeze-lib.mjs';
import { resetDeterminism } from './freeze-determinism.mjs';

// The systematic table: ONE mutation per (Strip role x Strip state x owner variant x acting Position x op kind),
// permitted and refused alike, driven through createEfsp().handleMessage (the real wire path) with an injected
// mission clock. Each cell records the ack (ok/reason/detail/warning/routedTo), what the Strip became, the
// delta kinds sent, and the audit entries written. Everything is data in golden/table-*.json.
//
// Also here: the snapshot()/restore() round trip (a restored Board must equal the one that was persisted).

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-table-'));
const SNAP = path.join(tmp, 'board.json');
Object.assign(process.env, {
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: path.join(tmp, 'incirlik.json'),
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: path.join(tmp, 'center.json'),
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: path.join(tmp, 'tactical.json'),
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: SNAP,
  CRCSYNC_EFSP_MUTATION_LOG_PATH: path.join(tmp, 'mutations.jsonl'),
  CRCSYNC_EFSP_AIRSPACES_PATH: path.join(tmp, 'airspaces.json'),
});
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const { createEfsp } = await import('../../src/efsp/index.js');
const facilityConfig = await import('../../src/efsp/facility-config.js');
const nla = await import('../../src/efsp/nla.js');
const permission = await import('../../src/efsp/permission.js');

function coordBay(p, f) { const b = facilityConfig.coordinationBayFor(p, f); return b ? b.bayId : facilityConfig.getBaysFor(p, f)[0].bayId; }

const MISSION_T0 = Date.UTC(2026, 5, 21, 2, 40, 0);
let cmidN = 0;
const cmid = () => `00000000-0000-4000-8000-${(++cmidN).toString(16).padStart(12, '0')}`;

const FDR = { callsign: 'FREEZE1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' };
const ROLES = [
  { role: 'DEPARTURE', facilityId: 'INCIRLIK', creator: 'OPS', bayId: 'ops-proposed' },
  { role: 'ARRIVAL', facilityId: 'INCIRLIK', creator: 'APP', bayId: 'app-inbound' },
  { role: 'OVERFLIGHT', facilityId: 'CENTER', creator: 'CTR', bayId: 'ctr-overflight' },
  { role: 'MISSION', facilityId: 'TACTICAL', creator: 'TAC_C2', bayId: 'tac-c2-tasked' },
];
const FACILITIES = ['INCIRLIK', 'CENTER', 'TACTICAL'];

function freshEfsp() {
  fs.rmSync(SNAP, { force: true }); fs.rmSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, { force: true });
  const clock = { now: () => MISSION_T0, source: 'MISSION' };
  const efsp = createEfsp({ clock });
  const audit = [];
  const rec = efsp.mutationLog.record.bind(efsp.mutationLog);
  efsp.mutationLog.record = (e) => { audit.push(JSON.parse(JSON.stringify(e))); return rec(e); };
  const sessions = {};
  for (const f of FACILITIES) for (const p of facilityConfig.getPositionSet(f)) {
    const session = { controllerId: `c-${p}`, who: p };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId: f, held: [p] });
    sessions[p] = session;
  }
  sessions.GHOST = { controllerId: 'c-GHOST', who: 'GHOST' };
  return { efsp, audit, sessions };
}

function send(h, facilityId, acting, strip, op, as = acting) {
  h.audit.length = 0;
  const r = h.efsp.handleMessage(h.sessions[as], {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid(), facilityId, actingPositionId: acting,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  });
  return r;
}

/** Seed a Strip of `spec.role` in `state`; returns the Strip or { refused: reason }. */
function seed(h, spec, state, ownerVariant) {
  const bs = h.efsp.boardStoreFor(spec.facilityId);
  let r = send(h, spec.facilityId, spec.creator, null, { kind: 'CreateStrip', bayId: spec.bayId, rackId: 'main', role: spec.role, fdr: { ...FDR, callsign: `FRZ${cmidN}` } });
  if (!r.ack.ok) return { refused: `create:${r.ack.reason}` };
  let strip = bs.getStrip(r.ack.strip.stripId);
  const order = nla.STATES_BY_ROLE[spec.role];
  const target = order.indexOf(state);
  if (state === 'DROPPED') {
    r = send(h, spec.facilityId, strip.ownerPositionId, strip, { kind: 'DropStrip' });
    return r.ack.ok ? bs.getStrip(strip.stripId) : { refused: `drop:${r.ack.reason}` };
  }
  for (let i = order.indexOf(strip.state) + 1; i <= target; i++) {
    r = send(h, spec.facilityId, strip.ownerPositionId, strip, { kind: 'SetState', toState: order[i] });
    if (!r.ack.ok && r.ack.reason === 'PERMISSION_DENIED') {
      // the current owner may not act on the next state: hand the Strip to that state's owner, then retry as them
      const want = ((permission.STATE_OWNERS_BY_ROLE[spec.role] || {})[order[i]] || []).find(p => facilityConfig.getPositionSet(spec.facilityId).includes(p));
      if (want) {
        const t = send(h, spec.facilityId, strip.ownerPositionId, strip, { kind: 'TransferStrip', toPositionId: want, bayId: coordBay(want, spec.facilityId), rackId: 'main' });
        if (t.ack.ok) { strip = bs.getStrip(strip.stripId); r = send(h, spec.facilityId, want, strip, { kind: 'SetState', toState: order[i] }); }
      }
    }
    if (!r.ack.ok) return { refused: `setstate:${order[i]}:${r.ack.reason}` };
    strip = bs.getStrip(strip.stripId);
  }
  if (ownerVariant === 'STATE_OWNER') {
    const owners = (permission.STATE_OWNERS_BY_ROLE[spec.role] || {})[state] || [];
    const want = owners.find(p => facilityConfig.getPositionSet(spec.facilityId).includes(p));
    if (!want) return { refused: 'no-state-owner-in-facility' };
    if (want !== strip.ownerPositionId) {
      const coord = coordBay(want, spec.facilityId);
      r = send(h, spec.facilityId, strip.ownerPositionId, strip, { kind: 'TransferStrip', toPositionId: want, bayId: coord, rackId: 'main' });
      if (!r.ack.ok) return { refused: `transfer:${r.ack.reason}` };
      strip = bs.getStrip(strip.stripId);
    }
  }
  return strip;
}

function opsFor(spec, strip, actor) {
  const order = nla.STATES_BY_ROLE[spec.role];
  const next = order[Math.min(order.indexOf(strip.state) + 1, order.length - 1)];
  const pos = facilityConfig.getPositionSet(spec.facilityId);
  const other = pos.find(p => p !== actor) || actor;
  const peer = spec.facilityId === 'CENTER'
    ? { toFacilityId: 'INCIRLIK', toPositionId: 'APP' } : { toFacilityId: 'CENTER', toPositionId: 'CTR' };
  const block = spec.role === 'MISSION' ? 'M2' : '3A';
  return [
    { kind: 'MoveStrip', bayId: strip.bayId, rackId: 'main' },
    { kind: 'SetBlock', blockId: block, value: 'FRZ' },
    { kind: 'TransferStrip', toPositionId: other, bayId: coordBay(other, spec.facilityId), rackId: 'main' },
    { kind: 'SetFlag', flag: 'highlight', value: 'yellow' },
    { kind: 'SetState', toState: next },
    { kind: 'InvokeNla' },
    { kind: 'Undo' },
    { kind: 'DropStrip' },
    { kind: 'HANDOFF', action: 'PROPOSE', ...peer },
    { kind: 'POINT_OUT', action: 'PROPOSE', ...peer },
    { kind: 'TRAFFIC', action: 'PROPOSE', ...peer },
    { kind: 'OPERATIONAL_REQUEST', action: 'PROPOSE', ...peer },
    { kind: 'AIT', action: 'PROPOSE', ...peer },
    { kind: 'ConvertToArrival' },
    { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' },
    { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' },
    { kind: 'ClearAirspaceEntry' },
  ];
}

const stripView = (s) => s ? `${s.state} @${s.ownerPositionId} r${s.rev} ${s.bayId}` : null;

function runMatrix() {
  resetDeterminism(); cmidN = 0;
  const cells = [];
  const roundTrips = [];
  const nlas = [];
  for (const spec of ROLES) {
    const actors = facilityConfig.getPositionSet(spec.facilityId);
    for (const state of nla.STATES_BY_ROLE[spec.role]) {
      for (const ownerVariant of ['CREATOR', 'STATE_OWNER']) {
        const h = freshEfsp();
        const bs = h.efsp.boardStoreFor(spec.facilityId);
        const tag = `${spec.role}/${state}/owner=${ownerVariant}`;
        let strip = seed(h, spec, state, ownerVariant);
        const sigOf = (s) => `${s.rev}|${s.state}|${s.ownerPositionId}`;
        let sig = strip.refused ? null : sigOf(strip);
        if (strip.refused) { cells.push({ cell: `${tag} SEED`, seeded: false, why: strip.refused }); continue; }
        nlas.push({ cell: tag, nla: canonical(bs.getStrip(strip.stripId).nla === undefined ? null : bs.getStrip(strip.stripId).nla), nlaStatus: canonical(bs.nlaStatusFor ? bs.nlaStatusFor(bs.getStrip(strip.stripId)) : null) });
        const kinds = opsFor(spec, strip, actors[0]).map(o => o.kind);
        for (const actor of [...actors, 'GHOST']) {
          for (let k = 0; k < kinds.length; k++) {
            const live = bs.getStrip(strip.stripId);
            let use = live;
            if (!use || sigOf(use) !== sig) {
              const again = seed(h, spec, state, ownerVariant);
              if (again.refused) { cells.push({ cell: `${tag} actor=${actor} op=${kinds[k]}`, seeded: false, why: again.refused }); continue; }
              strip = use = again; sig = sigOf(again);
            }
            const op = opsFor(spec, use, actor === 'GHOST' ? use.ownerPositionId : actor)[k];
            const actingPositionId = actor === 'GHOST' ? use.ownerPositionId : actor;
            const before = stripView(use);
            const r = send(h, spec.facilityId, actingPositionId, use, op, actor);
            const after = bs.getStrip(use.stripId);
            const a = r.ack;
            cells.push({
              cell: `${tag} actor=${actor} op=${op.kind}`, before,
              ok: a.ok, reason: a.reason || null, detail: a.detail || null, warning: a.warning || null, routedTo: a.routedTo || null,
              after: stripView(after), strips: (after && after.stripId === use.stripId ? summarize(after) : null),
              sent: Object.keys(r).filter(x => x !== 'ack').sort(),
              audit: summarize(h.audit),
            });
          }
        }
        // snapshot()/restore() round trip for the whole group
        h.efsp.persist();
        const snapA = JSON.stringify(canonical(Object.fromEntries(FACILITIES.map(f => [f, h.efsp.boardStoreFor(f).snapshot()]))));
        const fdrA = JSON.stringify(canonical(h.efsp.fdrStore.snapshot()));
        const again = createEfsp({ clock: { now: () => MISSION_T0, source: 'MISSION' } });
        const snapB = JSON.stringify(canonical(Object.fromEntries(FACILITIES.map(f => [f, again.boardStoreFor(f).snapshot()]))));
        const fdrB = JSON.stringify(canonical(again.fdrStore.snapshot()));
        roundTrips.push({ id: tag, boardsEqual: snapA === snapB, fdrEqual: fdrA === fdrB, boardHash: digest(snapA), strips: JSON.parse(snapA).INCIRLIK.strips.length + JSON.parse(snapA).CENTER.strips.length + JSON.parse(snapA).TACTICAL.strips.length });
      }
    }
  }
  return { cells, roundTrips, nlas };
}

function createMatrix() {
  resetDeterminism(); cmidN = 0;
  const out = [];
  const h = freshEfsp();
  for (const spec of ROLES) {
    for (const f of FACILITIES) for (const actor of facilityConfig.getPositionSet(f)) {
      const bay = facilityConfig.getBaysFor(actor, f).map(b => b.bayId)[0];
      const r = send(h, f, actor, null, { kind: 'CreateStrip', bayId: bay, rackId: 'main', role: spec.role, fdr: { ...FDR, callsign: `CRT${cmidN}` } });
      out.push({ cell: `CreateStrip role=${spec.role} at=${f}/${actor} bay=${bay}`, ok: r.ack.ok, reason: r.ack.reason || null, detail: r.ack.detail || null, warning: r.ack.warning || null, strip: r.ack.strip ? summarize(r.ack.strip) : null, audit: summarize(h.audit) });
    }
  }
  const ghost = send(h, 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR }, 'GHOST');
  out.push({ cell: 'CreateStrip as GHOST claiming OPS', ok: ghost.ack.ok, reason: ghost.ack.reason || null, detail: ghost.ack.detail || null });
  return out;
}

const matrix = runMatrix();

test('freeze table: mutation matrix (op kind x role x state x owner x acting Position)', () => {
  assert.ok(matrix.cells.length > 1500, `matrix too small: ${matrix.cells.length}`);
  checkGolden(assert, 'table-mutations', { cells: matrix.cells }, (d) => d.cells.map(c => [c.cell, c]));
});

test('freeze table: CreateStrip (Position x role)', () => {
  checkGolden(assert, 'table-create', { cells: createMatrix() }, (d) => d.cells.map(c => [c.cell, c]));
});

test('freeze table: snapshot()/restore() reproduces the Board and FDRs', () => {
  for (const r of matrix.roundTrips) {
    assert.ok(r.boardsEqual, `${r.id}: a restored Board differs from the persisted one`);
    assert.ok(r.fdrEqual, `${r.id}: restored FDRs differ from the persisted ones`);
  }
  checkGolden(assert, 'table-roundtrip', { cells: matrix.roundTrips.map(r => ({ ...r, cell: r.id })) }, (d) => d.cells.map(c => [c.cell, c]));
});

test('freeze table: what the NLA button offers per Role x state x owner', () => {
  checkGolden(assert, 'table-nla', { cells: matrix.nlas }, (d) => d.cells.map(c => [c.cell, c]));
});

test('freeze table: the matrix is deterministic (second run is byte-identical)', () => {
  const again = runMatrix();
  assert.equal(JSON.stringify(again), JSON.stringify(matrix));
});
