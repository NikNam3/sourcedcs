// The hub-level corpus. Each export of TRACES runs in its own process (freeze-hub-runner.mjs) and returns a
// recording (see freeze-world.mjs). Traces only DRIVE the server; they assert nothing, so a refusal is data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { World, Recorder, SOAK, START_NOW } from './freeze-world.mjs';
import { summarize, canonical } from './freeze-lib.mjs';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------------------------------------
// T3: seeded random traffic. tools/soak's Driver (traffic.js scripts, prng.js) runs in-process against the real
// hub through a recording host; every mutating host command becomes one step.
// ---------------------------------------------------------------------------------------------------------
const RECORDED = new Set(['connect', 'close', 'send', 'tick', 'tracks', 'missionReload', 'inject']);

async function driverTrace({ seed, minutes, profile = 'smoke', restartAt = null, crew = null, full = false }) {
  const { InprocHost, writeFixtures } = require(path.join(SOAK, 'host-client.js'));
  const { Driver } = require(path.join(SOAK, 'driver.js'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-drv-'));
  const outDir = path.join(stateDir, 'out');
  fs.mkdirSync(outDir);
  writeFixtures(stateDir);
  const rec = new Recorder({ stateDir, startNow: START_NOW, full, checkpointEvery: 100 });

  class RecordingHost extends InprocHost {
    call(cmd) {
      const done = (reply, extra = {}) => {
        if (RECORDED.has(cmd.type)) {
          rec.now = cmd.now;
          const input = { act: cmd.type, as: cmd.clientId, ...(cmd.msg ? { in: summarize(cmd.msg) } : {}), ...(cmd.what ? { what: cmd.what } : {}), ...extra };
          rec._record(input, reply);
        }
        return reply;
      };
      return super.call(cmd).then(done, (err) => {
        if (err && err.hostExit) { rec.now = cmd.now; rec._record({ act: cmd.type, as: cmd.clientId, ...(cmd.msg ? { in: summarize(cmd.msg) } : {}), hostExit: true }, { out: [] }); }
        throw err;
      });
    }
    start(startNow) { const r = super.start(startNow); if (this.lifetime > 1) rec._record({ act: 'restart', lifetime: this.lifetime }, { out: [] }, true); return r; }
  }

  const o = {
    minutes, seed, profile, realtime: false, restarts: null, restartAt, crew, sampleEvery: null, out: outDir, keepState: false,
    inproc: true, pruneRetired: false, inject: null, quiet: true, warmupMin: null,
  };
  const host = new RecordingHost({ stateDir, seed, startNow: START_NOW, logPath: path.join(outDir, 'host.log') });
  const driver = new Driver({ ...o, traceDigest: null, host, startNow: START_NOW, outDir, stateDir, lightMs: 60000, heavyMs: 300000 });
  await driver.run();
  const last = rec.steps[rec.steps.length - 1];
  if (last) last.snap = rec._snap(true);
  return { seed, profile, minutes, trafficDigest: driver.trafficDigest, steps: rec.steps };
}


// ---------------------------------------------------------------------------------------------------------
// Scripted traces on a World. The crew: one client per Position (so every Position is Primary somewhere),
// an observer, a ghost that holds nothing, and a second APP session that is demoted to Observer.
// ---------------------------------------------------------------------------------------------------------
const CREW = {
  ops: { INCIRLIK: ['OPS'] }, cd: { INCIRLIK: ['CD'] }, gnd: { INCIRLIK: ['GND'] }, twr: { INCIRLIK: ['TWR'] }, app: { INCIRLIK: ['APP'] },
  ctr: { CENTER: ['CTR'] },
  tac: { TACTICAL: ['TAC_C2'] }, aic: { TACTICAL: ['AIC'] }, gci: { TACTICAL: ['GCI'] }, jtac: { TACTICAL: ['JTAC'] },
  range: { RANGES: ['SOUTH_RANGE'] },
  marshal: { CARRIER: ['CV_MARSHAL'] }, prifly: { CARRIER: ['CV_PRIFLY'] }, cvapp1: { CARRIER: ['CV_APP1'] }, cvapp2: { CARRIER: ['CV_APP2'] },
  obs: { INCIRLIK: ['APP'] },
  ghost: {},
};
const POS_OF = { ops: ['INCIRLIK', 'OPS'], cd: ['INCIRLIK', 'CD'], gnd: ['INCIRLIK', 'GND'], twr: ['INCIRLIK', 'TWR'], app: ['INCIRLIK', 'APP'], ctr: ['CENTER', 'CTR'],
  tac: ['TACTICAL', 'TAC_C2'], aic: ['TACTICAL', 'AIC'], gci: ['TACTICAL', 'GCI'], jtac: ['TACTICAL', 'JTAC'], range: ['RANGES', 'SOUTH_RANGE'],
  marshal: ['CARRIER', 'CV_MARSHAL'], prifly: ['CARRIER', 'CV_PRIFLY'], cvapp1: ['CARRIER', 'CV_APP1'], cvapp2: ['CARRIER', 'CV_APP2'] };

function crewWorld(seed) {
  const w = new World({ seed, full: true });
  for (const [id, holds] of Object.entries(CREW)) w.connect(id, { holds });
  return w;
}

const FDR = (callsign, extra = {}) => ({ callsign, aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250', ...extra });
const CLIENT_OF = Object.fromEntries(Object.entries(POS_OF).map(([id, [, pos]]) => [pos, id]));
/** Act as whoever owns `strip` right now. */
const byOwner = (w, fid, strip, op, o) => w.mut(CLIENT_OF[strip.ownerPositionId] || 'ghost', fid, strip.ownerPositionId, strip, op, o);
const at = (w, id) => (op, strip, o) => { const [f, p] = POS_OF[id]; return w.mut(id, f, p, strip, op, o); };

/** A DEPARTURE at OPS in PROPOSED; returns its live compact strip. */
function newDeparture(w, callsign) {
  const r = w.mut('ops', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR(callsign) });
  return r.ack && r.ack.strip ? w.strip('INCIRLIK', r.ack.strip.stripId) : null;
}
function setState(w, id, strip, toState) {
  if (!strip) return strip;
  const [f, p] = POS_OF[id];
  w.mut(id, f, p, strip, { kind: 'SetState', toState });
  return w.strip(f, strip.stripId);
}
/** OPS -> HANDED_OFF -> transferred to APP's departures Bay: the usual start of an airborne flight. */
function airborne(w, callsign) {
  let s = newDeparture(w, callsign);
  if (!s) throw new Error(`could not create ${callsign}: ${JSON.stringify(w.last && w.last.frames.slice(0, 1))}`);
  s = setState(w, 'ops', s, 'HANDED_OFF');
  w.mut('ops', 'INCIRLIK', 'OPS', s, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  return w.strip('INCIRLIK', s.stripId);
}
const peerOf = (w, fid, s) => {
  const full = w.last.frames.length ? null : null; void full;
  return null;
};

// ---- T1: the op x outcome matrix --------------------------------------------------------------------------
function opMatrix() {
  const w = crewWorld(11);
  const ops = at(w, 'ops'), cd = at(w, 'cd'), app = at(w, 'app'), ctr = at(w, 'ctr'), tac = at(w, 'tac');
  const live = (f, s) => w.strip(f, s.stripId);

  // CreateStrip: success, every refusal reason reachable at creation, replay.
  let dep = newDeparture(w, 'MTX01');
  ops({ kind: 'CreateStrip', bayId: 'cd-cleared', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-BAYCLASS') });              // wrong Position's Bay
  ops({ kind: 'CreateStrip', bayId: 'nope', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-NOBAY') });                       // unknown Bay
  ops({ kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'NOSUCHROLE', fdr: FDR('MTX-NOROLE') });             // unknown Role
  ops({ kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'ARRIVAL', fdr: FDR('MTX-ARR') });                   // OPS may not originate ARRIVAL
  cd({ kind: 'CreateStrip', bayId: 'cd-pending-clearance', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-CD') });           // CD may not create
  w.mut('ghost', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-GHOST') });
  w.mut('ops', 'NOWHERE', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-NOFAC') });
  w.mut('ops', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: '' } });
  ops({ kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX02'), afterStripId: dep.stripId });
  const dupe = w.nextCmid();
  w.mut('ops', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-REPLAY') }, { cmid: dupe });
  w.mut('ops', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('MTX-REPLAY') }, { cmid: dupe });  // idempotent replay
  at(w, 'app')({ kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL', fdr: FDR('MTX-ARR1') });
  ctr({ kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT', fdr: FDR('MTX-OVF1') });
  tac({ kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: FDR('MTX-MSN1') });

  // Per-op outcomes on one Strip: success, then each refusal.
  dep = live('INCIRLIK', dep);
  ops({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, dep);
  dep = live('INCIRLIK', dep);
  ops({ kind: 'SetFlag', flag: 'bogus', value: true }, dep);
  ops({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, dep, { rev: 1 });                                               // STALE_REV
  ops({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, dep, { stripId: 'does-not-exist' });                            // NOT_FOUND
  cd({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, dep);                                                              // NOT_OWNER
  w.mut('ghost', 'INCIRLIK', 'OPS', dep, { kind: 'SetFlag', flag: 'highlight', value: 'yellow' });                               // NOT_HOLDING_POSITION
  ops({ kind: 'SetBlock', blockId: '3A', value: 'FRZ' }, dep);  dep = live('INCIRLIK', dep);
  ops({ kind: 'SetBlock', blockId: '5', value: '4521' }, dep);  dep = live('INCIRLIK', dep);
  ops({ kind: 'SetBlock', blockId: '5', value: 'not-a-code' }, dep);
  ops({ kind: 'SetBlock', blockId: 'ZZZ', value: 'x' }, dep);
  ops({ kind: 'SetBlock', blockId: '7', value: '260' }, dep);   dep = live('INCIRLIK', dep);
  ops({ kind: 'MoveStrip', bayId: 'ops-proposed', rackId: 'main' }, dep); dep = live('INCIRLIK', dep);
  ops({ kind: 'MoveStrip', bayId: 'nope', rackId: 'main' }, dep);
  ops({ kind: 'MoveStrip', bayId: 'ops-filed', rackId: 'main' }, dep); dep = live('INCIRLIK', dep);
  ops({ kind: 'MoveStrip', bayId: 'ops-proposed', rackId: 'main' }, dep); dep = live('INCIRLIK', dep);

  // InvokeNla: success, the 400 ms double tap (swallowed), after the latch, inhibited, Undo inside and outside its window.
  ops({ kind: 'InvokeNla' }, dep);               dep = live('INCIRLIK', dep);
  cd({ kind: 'InvokeNla' }, dep);                    dep = live('INCIRLIK', dep);                                                // CLEARED, same owner
  cd({ kind: 'InvokeNla' }, dep);                                                                                                // inside the 400 ms latch (same rev: stale or swallowed)
  dep = live('INCIRLIK', dep);
  byOwner(w, 'INCIRLIK', dep, { kind: 'Undo' });     dep = live('INCIRLIK', dep);                                                // Undo inside the window
  byOwner(w, 'INCIRLIK', dep, { kind: 'Undo' });                                                                                 // nothing left to undo
  w.advance(500);
  byOwner(w, 'INCIRLIK', dep, { kind: 'InvokeNla' }); dep = live('INCIRLIK', dep);
  w.advance(500);
  byOwner(w, 'INCIRLIK', dep, { kind: 'InvokeNla' }); dep = live('INCIRLIK', dep);
  w.advance(31000);
  byOwner(w, 'INCIRLIK', dep, { kind: 'Undo' });                                                                                 // outside the Undo window
  dep = live('INCIRLIK', dep);
  ops({ kind: 'InvokeNla' }, dep);                                                                                               // not OPS's to advance
  dep = setState(w, 'cd', dep, 'HANDED_OFF');
  w.mut('ops', 'INCIRLIK', 'OPS', dep, { kind: 'SetState', toState: 'NOSUCHSTATE' });
  w.mut('ops', 'INCIRLIK', 'OPS', dep, { kind: 'SetState', toState: 'PROPOSED' });
  // TransferStrip: unknown Position, own Bay, to a Position at another Facility, success.
  const t = live('INCIRLIK', dep);
  w.mut(POS_OF.ops && 'ops', 'INCIRLIK', 'OPS', t, { kind: 'TransferStrip', toPositionId: 'NOWHERE', bayId: 'app-departures', rackId: 'main' });
  w.mut('ops', 'INCIRLIK', 'OPS', t, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'ops-proposed', rackId: 'main' });
  w.mut('ops', 'INCIRLIK', 'OPS', t, { kind: 'TransferStrip', toPositionId: 'CTR', bayId: 'ctr-departures', rackId: 'main' });
  w.mut('ops', 'INCIRLIK', 'OPS', t, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  dep = live('INCIRLIK', dep);
  byOwner(w, 'INCIRLIK', dep, { kind: 'DropStrip' });
  byOwner(w, 'INCIRLIK', live('INCIRLIK', dep), { kind: 'SetFlag', flag: 'highlight', value: 'red' });                           // op on a DROPPED Strip

  // Coordination: every primitive x action, success and the common refusals.
  const PRIMS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];
  for (const prim of PRIMS) {
    // ACCEPT
    let a = airborne(w, `CO${prim.slice(0, 2)}A`);
    cd({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, a);                                      // CD is not a boundary Position
    app({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'NOWHERE' }, a);
    app({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, a);
    a = live('INCIRLIK', a);
    app({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, a);                                     // already open
    const peerId = a.coord && a.coord.peerStripId;
    const prop = w.truth();
    const peer = (prop.facilities.CENTER.strips.find(x => x.coord && x.coord.peerStripId === a.stripId) || {});
    if (peer.stripId) {
      ctr({ kind: prim, action: 'STAND_BY' }, peer);
      const p1 = live('CENTER', peer);
      app({ kind: prim, action: 'ACCEPT' }, p1);                                                                                // wrong side accepts
      ctr({ kind: prim, action: 'ACCEPT' }, p1);
    }
    void peerId;
    // REJECT
    let b = airborne(w, `CO${prim.slice(0, 2)}B`);
    app({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, b);
    const pb = w.truth().facilities.CENTER.strips.find(x => x.coord && x.coord.peerStripId === b.stripId);
    if (pb) ctr({ kind: prim, action: 'REJECT' }, pb);
    // CANCEL, then ACCEPT with nothing open
    let c = airborne(w, `CO${prim.slice(0, 2)}C`);
    app({ kind: prim, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, c);
    app({ kind: prim, action: 'CANCEL' }, live('INCIRLIK', c));
    app({ kind: prim, action: 'ACCEPT' }, live('INCIRLIK', c));
    app({ kind: prim, action: 'NOSUCHACTION' }, live('INCIRLIK', c));
  }

  // ConvertToArrival: refused (not at HANDED_OFF), then success.
  const conv = airborne(w, 'CONV1');
  app({ kind: 'ConvertToArrival' }, conv);
  const cb = live('INCIRLIK', conv);
  app({ kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, cb);
  const cp = w.truth().facilities.CENTER.strips.find(x => x.coord && x.coord.peerStripId === conv.stripId);
  if (cp) ctr({ kind: 'HANDOFF', action: 'ACCEPT' }, cp);
  w.mut('ops', 'INCIRLIK', 'OPS', live('INCIRLIK', conv), { kind: 'ConvertToArrival' });

  // TOFI: ENTRY propose/accept (with the separation regime), TRANSFER_COMMS, EXIT, REJECT.
  const tofiFlight = (name) => {
    const f = airborne(w, name);
    app({ kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, f);
    const p = w.truth().facilities.CENTER.strips.find(x => x.coord && x.coord.peerStripId === f.stripId);
    ctr({ kind: 'HANDOFF', action: 'ACCEPT' }, p);
    return live('CENTER', p);
  };
  let t1 = tofiFlight('TOFI1');
  ctr({ kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' }, t1);
  at(w, 'aic')({ kind: 'TOFI', action: 'ACCEPT' }, null, { stripId: 'x', rev: 0 });
  t1 = live('CENTER', t1);
  const mission = w.truth().facilities.TACTICAL.strips.find(x => x.tofi && x.tofi.peerStripId === t1.stripId);
  if (mission) {
    tac({ kind: 'TOFI', action: 'ACCEPT' }, mission);                                                                           // regime missing
    tac({ kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' }, live('TACTICAL', mission));
    tac({ kind: 'TOFI', action: 'TRANSFER_COMMS' }, live('TACTICAL', mission));
    ctr({ kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' }, live('CENTER', t1));
    tac({ kind: 'TOFI', action: 'REJECT' }, live('TACTICAL', mission));
    tac({ kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' }, live('TACTICAL', mission));
  }

  // Airspace entry on a live flight, and the airspace ops themselves.
  const ae = airborne(w, 'AIRSP1');
  app({ kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' }, ae);
  app({ kind: 'ClearAirspaceEntry' }, live('INCIRLIK', ae));
  app({ kind: 'ApproveAirspaceEntry', airspaceId: 'NOPE' }, live('INCIRLIK', ae));
  const win = { fromUtc: w.now, toUtc: w.now + 2 * 3600 * 1000 };
  w.airspace('ctr', 'CTR', 'MOA-EAST', { kind: 'ScheduleAirspace', ...win });
  w.airspace('ctr', 'CTR', 'MOA-EAST', { kind: 'ActivateAirspace' });
  w.airspace('ctr', 'CTR', 'MOA-EAST', { kind: 'ApproveActivation' });
  w.airspace('ops', 'OPS', 'MOA-EAST', { kind: 'ApproveActivation' });
  w.airspace('range', 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'ScheduleAirspace', ...win });
  w.airspace('range', 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'RequestActivation' });
  w.airspace('app', 'APP', 'RANGE-SOUTH', { kind: 'ApproveActivation' });
  w.airspace('ctr', 'CTR', 'MOA-EAST', { kind: 'ReleaseAirspace' });
  w.airspace('ctr', 'CTR', 'MOA-EAST', { kind: 'ReturnAirspace' });
  w.airspace('app', 'APP', 'RANGE-SOUTH', { kind: 'ReleaseAirspace' });
  w.airspace('ctr', 'CTR', 'NO-SUCH', { kind: 'ScheduleAirspace', ...win });

  // MARSA: declare (refused: one participant; success), void.
  const m1 = airborne(w, 'MARSAT'), m2 = airborne(w, 'MARSAR');
  const fdrOf = (s) => w.strip('INCIRLIK', s.stripId);
  void fdrOf;
  const tr = w.truth().facilities.INCIRLIK.strips;
  const fd1 = tr.find(x => x.stripId === m1.stripId).fdrId, fd2 = tr.find(x => x.stripId === m2.stripId).fdrId;
  w.family('app', 'efsp-marsa-mutation', { actingPositionId: 'APP', op: { kind: 'DeclareMarsa', participants: [fd1], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1' } });
  const dm = w.family('app', 'efsp-marsa-mutation', { actingPositionId: 'APP', op: { kind: 'DeclareMarsa', participants: [fd1, fd2], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1' } });
  w.family('cd', 'efsp-marsa-mutation', { actingPositionId: 'CD', op: { kind: 'DeclareMarsa', participants: [fd1, fd2], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1' } });
  const marsa = dm.ack && dm.ack.marsa;
  if (marsa) {
    w.family('app', 'efsp-marsa-mutation', { marsaId: marsa.marsaId, baseRev: marsa.rev, actingPositionId: 'APP', op: { kind: 'MarkRendezvous' } });
    const cur = w.truth();
    void cur;
    w.family('app', 'efsp-marsa-mutation', { marsaId: marsa.marsaId, baseRev: 99, actingPositionId: 'APP', op: { kind: 'VoidMarsa', note: 'stale' } });
    w.family('app', 'efsp-marsa-mutation', { marsaId: marsa.marsaId, baseRev: marsa.rev + 1, actingPositionId: 'APP', op: { kind: 'VoidMarsa', note: 'ATC resuming separation' } });
  }

  // Correlation: bind / unbind a track to an FDR (no tracks fed: a refusal is also an outcome).
  w.tracks({ upsert: [{ id: 'T1', callsign: 'MTX01', lat: 37.0, lon: 35.4, alt: 5000, course: 90, groundSpeed: 250, verticalSpeed: 0, squawk: '4521' }] });
  w.family('app', 'efsp-correlation-mutation', { fdrId: fd1, baseRev: 0, actingPositionId: 'APP', op: { kind: 'BindTrack', trackId: 'T1' } });
  w.family('app', 'efsp-correlation-mutation', { fdrId: fd1, baseRev: 1, actingPositionId: 'APP', op: { kind: 'UnbindTrack' } });
  w.family('cd', 'efsp-correlation-mutation', { fdrId: fd1, baseRev: 0, actingPositionId: 'CD', op: { kind: 'BindTrack', trackId: 'T1' } });

  // Field state.
  let fsRev = 0;
  const fsm = (id, acting, op) => {
    const r = w.family(id, 'efsp-field-state-mutation', { facilityId: 'INCIRLIK', baseRev: fsRev, actingPositionId: acting, op });
    const rev = r.ack && r.ack.fieldState && r.ack.fieldState.rev;
    if (Number.isInteger(rev)) fsRev = rev;
    return r;
  };
  fsm('ops', 'OPS', { kind: 'RequestRunwayStatus', runwayId: '05/23', action: 'WORKS' });   // first call learns the real rev (stale on purpose)
  const rwy = '05/23';
  fsm('ops', 'OPS', { kind: 'RequestRunwayStatus', runwayId: rwy, action: 'CLOSE', note: 'FOD' });
  fsm('twr', 'TWR', { kind: 'AcceptRunwayRequest', runwayId: rwy });
  fsm('twr', 'TWR', { kind: 'OpenRunway', runwayId: rwy });
  fsm('twr', 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  fsm('ops', 'OPS', { kind: 'AckRunwayChange' });
  fsm('twr', 'TWR', { kind: 'WithdrawRunwayChange', note: 'wind backed' });
  fsm('gnd', 'GND', { kind: 'BeginRunwayChange' });

  // Carrier.
  const cm = (id, acting, op) => w.family(id, 'efsp-carrier-mutation', { actingPositionId: acting, op });
  cm('marshal', 'CV_MARSHAL', { kind: 'SetCase', to: 'II' });
  cm('prifly', 'CV_PRIFLY', { kind: 'SetCase', to: 'I' });
  cm('marshal', 'CV_MARSHAL', { kind: 'SetShipInput', input: { altimeterInHg: 29.92 } });
  cm('cvapp1', 'CV_APP1', { kind: 'SetShipInput', input: { altimeterInHg: 30.01 } });
  cm('marshal', 'CV_MARSHAL', { kind: 'SetMarshalRadial', marshalRadialDeg: 190 });

  // ATO import over the wire: preview, import, replay, refusal by a non-tactical Position.
  const ojw = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../atobrief/test/fixtures/usmtf/ojw1v5-export.txt');
  if (fs.existsSync(ojw)) {
    const text = fs.readFileSync(ojw, 'utf8');
    const pv = w.send('tac', { version: 1, type: 'efsp-ato-preview', requestId: 'r', actingPositionId: 'TAC_C2', text }, 'ato-preview');
    const sha = pv.ack && pv.ack.preview && pv.ack.preview.textSha1;
    const cmid = w.nextCmid();
    const imp = { version: 1, type: 'efsp-ato-mutation', clientMutationId: cmid, facilityId: 'TACTICAL', actingPositionId: 'TAC_C2', op: { kind: 'ImportAto', text, textSha1: sha, choices: [] } };
    w.send('tac', imp, 'ato-import');
    w.send('tac', imp, 'ato-import-replay');
    w.send('ops', { ...imp, clientMutationId: w.nextCmid(), facilityId: 'INCIRLIK', actingPositionId: 'OPS' }, 'ato-import-ops');
  }

  // Resync paths on the Board: a delta from inside the ring, a stale epoch, nothing known.
  const info = w.truth();
  const epoch = (w.mut('app', 'INCIRLIK', 'APP', null, { kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL', fdr: FDR('RSYNC1') }).ack || {}).boardEpoch;
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: info.facilities.INCIRLIK.currentSeq - 3, boardEpoch: epoch }, 'resync-delta');
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: info.facilities.INCIRLIK.currentSeq - 3, boardEpoch: 'wrong-epoch' }, 'resync-epoch-mismatch');
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: 0, boardEpoch: epoch }, 'resync-from-zero');
  w.send('aic', { version: 1, type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: 1, boardEpoch: epoch }, 'resync-owned-scope');
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'NOWHERE', lastBoardSeq: 1 }, 'resync-unknown-facility');
  return w;
}


/** Press the NLA button as the owner until `state` (or `max` presses), honouring the 400 ms latch. */
function chain(w, fid, strip, state, max = 14) {
  let s = strip;
  for (let i = 0; i < max && s && s.state !== state; i++) {
    w.advance(450);
    byOwner(w, fid, s, { kind: 'InvokeNla' });
    s = w.strip(fid, strip.stripId);
  }
  return s;
}

// ---- T2: sortie walks through the hub (the handleMessage-level walks live in freeze-scenarios) ---------------
function walkCivil() {
  const w = crewWorld(21);
  let s = newDeparture(w, 'CIVIL1');
  s = chain(w, 'INCIRLIK', s, 'HANDED_OFF');
  const app = at(w, 'app'), ctr = at(w, 'ctr');
  app({ kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' }, s);
  const peer = w.truth().facilities.CENTER.strips.find(x => x.coord && x.coord.peerStripId === s.stripId);
  ctr({ kind: 'HANDOFF', action: 'ACCEPT' }, peer);
  // CTR hands it back: the return leg.
  ctr({ kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' }, w.strip('CENTER', peer.stripId));
  const back = w.truth().facilities.INCIRLIK.strips.find(x => x.coord && x.coord.peerStripId === peer.stripId && x.stripId !== s.stripId) || w.strip('INCIRLIK', s.stripId);
  app({ kind: 'HANDOFF', action: 'ACCEPT' }, w.strip('INCIRLIK', back.stripId));
  w.mut('ops', 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: FDR('CIVIL2') });
  let a = newDeparture(w, 'CIVARR1');
  a = chain(w, 'INCIRLIK', a, 'HANDED_OFF');
  byOwner(w, 'INCIRLIK', a, { kind: 'ConvertToArrival' });
  a = w.strip('INCIRLIK', a.stripId);
  a = chain(w, 'INCIRLIK', a, 'DROPPED', 12);
  w.tick(['obligationsNla']);
  const out = w.finish(); w.dispose(); return out;
}

function walkManning() {
  const w = crewWorld(31);
  // Strips at CD and GND, then CD's controller drops: the covering chain reassigns CD's Strips.
  let d1 = newDeparture(w, 'MAN1'); d1 = chain(w, 'INCIRLIK', d1, 'PENDING_CLEARANCE');
  let d2 = newDeparture(w, 'MAN2'); d2 = chain(w, 'INCIRLIK', d2, 'CLEARED');
  w.close('cd');
  w.advance(1000);
  w.tick(['heartbeat']);
  w.connect('cd', { holds: CREW.cd });                                        // retakes CD
  w.send('obs', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['APP'] }, 'observer-selects-APP');
  w.send('gnd', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['GND', 'CD'] }, 'combine-GND+CD');
  w.send('gnd', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: [] }, 'vacate');
  w.send('cd', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['CD', 'GND', 'TWR'] }, 'take-three');
  w.send('ghost', { type: 'efsp-set-positions', facilityId: 'NOWHERE', held: ['X'] }, 'unknown-facility');
  w.send('ghost', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['NOPE'] }, 'unknown-position');
  w.send('app', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['APP', 'CTR'] }, 'wrong-facility-position');
  // Concurrent edits to one Strip from two clients: second is stale.
  byOwner(w, 'INCIRLIK', w.strip('INCIRLIK', d2.stripId), { kind: 'SetFlag', flag: 'highlight', value: 'red' });
  w.mut('cd', 'INCIRLIK', 'CD', d2, { kind: 'SetFlag', flag: 'attention', value: true });
  w.reconnect('twr');
  const out = w.finish(); w.dispose(); return out;
}

function walkTactical() {
  const w = crewWorld(41);
  const tac = at(w, 'tac'), aic = at(w, 'aic'), jtac = at(w, 'jtac'), gci = at(w, 'gci');
  const m = (name) => {
    const r = w.mut('tac', 'TACTICAL', 'TAC_C2', null, { kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: FDR(name) });
    return r.ack && r.ack.strip ? w.strip('TACTICAL', r.ack.strip.stripId) : null;
  };
  let a = m('MSNA1'); a = chain(w, 'TACTICAL', a, 'ON_STATION', 4);
  tac({ kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'aic-on-station', rackId: 'main' }, a);   // read scope OWNED: AIC now sees it
  a = w.strip('TACTICAL', a.stripId);
  aic({ kind: 'MoveStrip', bayId: 'aic-committed', rackId: 'main' }, a);
  aic({ kind: 'InvokeNla' }, w.strip('TACTICAL', a.stripId));
  aic({ kind: 'DropStrip' }, w.strip('TACTICAL', a.stripId));
  aic({ kind: 'SetBlock', blockId: 'M2', value: 'PKG-A' }, w.strip('TACTICAL', a.stripId));
  aic({ kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' }, w.strip('TACTICAL', a.stripId));
  let b = m('MSNB1');
  tac({ kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' }, b);
  jtac({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, w.strip('TACTICAL', b.stripId));
  gci({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, w.strip('TACTICAL', b.stripId));
  // Resyncs from the scoped sessions always answer with a filtered snapshot.
  w.send('jtac', { version: 1, type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: 0 }, 'resync-jtac');
  w.send('tac', { version: 1, type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: 0 }, 'resync-tac');
  w.reconnect('aic');
  const out = w.finish(); w.dispose(); return out;
}

// ---- T4: crash and restart ---------------------------------------------------------------------------------
function crashReplay() {
  const w = crewWorld(51);
  const ops = at(w, 'ops');
  let a = newDeparture(w, 'CRASH1');
  // Mode A: applied and persisted, the ack is lost; after the restart the client retries the same cmid.
  const cmidA = w.nextCmid();
  ops({ kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, a, { cmid: cmidA });
  const revAfterA = w.strip('INCIRLIK', a.stripId);
  w.restart();
  for (const [id, holds] of Object.entries(CREW)) w.connect(id, { holds });
  w.mut('ops', 'INCIRLIK', 'OPS', a, { kind: 'SetFlag', flag: 'highlight', value: 'yellow' }, { cmid: cmidA });   // retry: replayed from the persisted window
  // Mode B: audited but never persisted (the persist throws), then restart: the boot marks the line NotPersisted.
  const cmidB = w.nextCmid();
  w.crashBeforeNextPersist();
  w.mut('ops', 'INCIRLIK', 'OPS', w.strip('INCIRLIK', a.stripId), { kind: 'SetFlag', flag: 'attention', value: true }, { cmid: cmidB });
  w.advance(5000);
  w.restart();
  for (const [id, holds] of Object.entries(CREW)) w.connect(id, { holds });
  // the retry applies for the first time on the restored Board
  w.mut('ops', 'INCIRLIK', 'OPS', w.strip('INCIRLIK', a.stripId), { kind: 'SetFlag', flag: 'attention', value: true }, { cmid: cmidB });
  w.mut('ops', 'INCIRLIK', 'OPS', w.strip('INCIRLIK', a.stripId), { kind: 'SetFlag', flag: 'attention', value: true }, { cmid: cmidB });
  // A crash during a coordination exchange (two Boards change in one Mutation).
  let f = airborne(w, 'CRASH2');
  w.crashBeforeNextPersist();
  w.mut('app', 'INCIRLIK', 'APP', f, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  w.restart();
  for (const [id, holds] of Object.entries(CREW)) w.connect(id, { holds });
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: 3, boardEpoch: 'epoch-from-before-the-restart' }, 'resync-after-restart');
  void revAfterA;
  const out = w.finish(); w.dispose(); return out;
}

// ---- T5: monitors, archiver, correlation -------------------------------------------------------------------
function monitors() {
  const w = crewWorld(61);
  let f = airborne(w, 'MON1');
  w.tracks({ upsert: [{ id: 'K1', callsign: 'MON1', lat: 37.0, lon: 35.4, alt: 8000, course: 90, groundSpeed: 300, verticalSpeed: 0, squawk: '0001' },
    { id: 'K2', callsign: 'UNKNOWN', lat: 37.2, lon: 35.6, alt: 8000, course: 270, groundSpeed: 300, verticalSpeed: 0, squawk: '7000' }] });
  w.tick(['reconcile']);
  w.advance(1000);
  w.tick(['reconcile', 'conformanceStca']);
  w.advance(60000);
  w.tick(['obligationsNla']);
  w.tick(['expireTracks']);
  w.tick(['metrics']);
  w.tick(['heartbeat']);
  // A release time that passes: the NLA status monitor moves.
  const d = newDeparture(w, 'MON2');
  byOwner(w, 'INCIRLIK', d, { kind: 'SetBlock', blockId: '3A', value: 'FRZ' });
  w.advance(10 * 60000);
  w.tick(['obligationsNla']);
  // Archive: drop, then wait out the retention.
  let g = newDeparture(w, 'MON3'); g = chain(w, 'INCIRLIK', g, 'HANDED_OFF');
  byOwner(w, 'INCIRLIK', g, { kind: 'DropStrip' });
  w.tick(['obligationsNla']);
  w.advance(2 * 3600 * 1000 + 1000);
  w.tick(['obligationsNla']);
  w.tick(['obligationsNla']);
  w.send('app', { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: 0 }, 'resync-after-archive');
  w.tracks({ remove: ['K1', 'K2'] });
  w.tick(['expireTracks', 'reconcile']);
  w.send('obs', { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['APP'] });
  void f;
  const out = w.finish(); w.dispose(); return out;
}

export const TRACES = {
  'walk-civil': async () => walkCivil(),
  'walk-manning': async () => walkManning(),
  'walk-tactical': async () => walkTactical(),
  'crash-replay': async () => crashReplay(),
  'monitors': async () => monitors(),
  'op-matrix': async () => { const w = opMatrix(); const out = w.finish(); w.dispose(); return out; },
  'random-seed1': () => driverTrace({ seed: 1, minutes: 6, profile: 'smoke' }),
  'random-seed2': () => driverTrace({ seed: 2, minutes: 6, profile: 'smoke', restartAt: [3] }),
  'random-seed3': () => driverTrace({ seed: 3, minutes: 4, profile: 'stress', crew: 'full', restartAt: [2] }),
};
