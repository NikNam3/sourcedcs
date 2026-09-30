'use strict';

// The host: crc-sync's real EFSP subsystem, the real WsHub routing and the
// monitors server.js wires, driven one command at a time by the soak driver.
// Transport-agnostic — host.js serves it over IPC in a forked child (the
// default, briefing D1), and run.js --inproc calls it directly.
//
// setupHostEnv() (host-env.js) MUST have run before this file is required:
// it points every state path at the temp dir and installs the virtual clock.
//
// Instrumentation is by wrapping instance methods here, never by editing
// src/ (briefing D6). Nothing is accumulated in the host beyond one command's
// worth (briefing §8 T6): every message a fake socket receives is forwarded in
// that command's reply and forgotten.

const path = require('path');
const fs = require('fs');
const v8 = require('v8');
const { SRC } = require('./host-env');

const req = (rel) => require(path.join(SRC, rel));

const LIGHT_BUCKETS = [[1, 1], [2, 2], [3, 5], [6, 10], [11, 20], [21, 40], [41, 80], [81, 160], [161, Infinity]];
const bucketName = ([lo, hi]) => (lo === hi ? String(lo) : hi === Infinity ? `>${lo - 1}` : `${lo}-${hi}`);

function compactStrip(s) {
  if (!s) return null;
  const c = s.coordination;
  const t = s.tofiCoordination;
  return {
    stripId: s.stripId, rev: s.rev, state: s.state, ownerPositionId: s.ownerPositionId,
    bayId: s.bayId, rackId: s.rackId, orderKey: s.orderKey, role: s.role, fdrId: s.fdrId,
    coord: c ? { primitive: c.primitive, state: c.state, peerStripId: c.peerStripId, peerFacilityId: c.peerFacilityId, peerPositionId: c.peerPositionId } : null,
    tofi: t ? { state: t.state, direction: t.direction, peerStripId: t.peerStripId, peerFacilityId: t.peerFacilityId } : null,
  };
}

/**
 * @param {object} env   setupHostEnv()'s return value
 * @param {object} opts
 * @param {string} opts.stateDir
 */
function createHost(env, { stateDir }) {
  env.wrapOrderKey();
  const { createEfsp, BOARD_SNAPSHOT_PATH } = req('efsp/index.js');
  // T4: refuse to run unless the snapshot the host will write every Mutation
  // is inside the temp dir. A mistake here overwrites the human's live Board.
  if (!path.resolve(BOARD_SNAPSHOT_PATH).startsWith(path.resolve(stateDir) + path.sep)) {
    throw new Error(`soak: BOARD_SNAPSHOT_PATH ${BOARD_SNAPSHOT_PATH} is not inside the temp state dir ${stateDir} — refusing to run`);
  }
  const { MUTATION_LOG_PATH } = req('efsp/mutation-log.js');
  if (!path.resolve(MUTATION_LOG_PATH).startsWith(path.resolve(stateDir) + path.sep)) {
    throw new Error(`soak: MUTATION_LOG_PATH ${MUTATION_LOG_PATH} is not inside the temp state dir — refusing to run`);
  }
  const facilityConfig = req('efsp/facility-config.js');
  const TrackStore = req('tracks.js');
  const CollaborativeStore = req('collab-store.js');
  const WsHub = req('ws-hub.js');
  const { ForwardingObligationMonitor } = req('efsp/forwarding-obligations.js');
  const { CorrelationReconciler } = req('efsp/correlation-reconciler.js');
  const { ConformanceMonitor } = req('efsp/conformance.js');
  const { StcaMonitor } = req('stca.js');
  const { loadAlertingConfig } = req('alerting-config.js');
  const { indicatedAltFt } = req('altimetry.js');

  const clock = { now: () => Date.now(), source: 'SOAK_VIRTUAL' };
  const efsp = createEfsp({ clock });
  const trackStore = new TrackStore();
  const collabStore = new CollaborativeStore();
  const squawks = new Map(); // String(trackId) -> code | null  (TrackStore drops unknown fields, briefing §3.8)
  const hub = new WsHub({ trackStore, collabStore, efsp, clock });
  hub._wss = { clients: new Set() }; // never attach(): no timer, no real server (T3)

  const facilityIds = facilityConfig.getFacilityIds();

  // ── per-command capture ────────────────────────────────────────────────
  let out = [];
  let sender = null;
  const causeStack = [];
  let touched = [];                 // [{fid, id, cause}] this command
  let carried = new Set();          // `${fid}|${id}` carried by a board-delta broadcast this command
  const stats = { rebalances: 0, rebalancedStrips: 0, systemReassigns: 0 };
  const inject = { dropAck: false, dropBroadcast: false, leakFrom: null, leak: [] };

  const origBroadcast = hub._broadcast.bind(hub);
  hub._broadcast = (msg) => {
    if (msg && msg.type === 'efsp-board-delta' && msg.strips) {
      for (const s of msg.strips.updated || []) carried.add(`${msg.facilityId}|${s.stripId}`);
      for (const id of msg.strips.gone || []) carried.add(`${msg.facilityId}|${id}`);
    }
    return origBroadcast(msg);
  };

  for (const fid of facilityIds) {
    const bs = efsp.boardStoreFor(fid);
    const touch = bs._touch.bind(bs);
    bs._touch = (id) => { touch(id); touched.push({ fid, id, cause: causeStack.length ? causeStack[causeStack.length - 1] : null }); };
    const wrapCause = (name, cause, onCall) => {
      const orig = bs[name].bind(bs);
      bs[name] = (...args) => {
        if (onCall) onCall(args);
        causeStack.push(cause);
        try { return orig(...args); } finally { causeStack.pop(); }
      };
    };
    wrapCause('_rebalanceRack', 'REBALANCE_SIDE_EFFECT', ([bayId, rackId, excl]) => {
      stats.rebalances++;
      stats.rebalancedStrips += bs.getRack(bayId, rackId).filter(s => s.stripId !== excl).length;
    });
    wrapCause('reassignPositionStrips', 'SYSTEM_REASSIGN', () => { stats.systemReassigns++; });
    for (const m of ['receiveCoordinationProposal', 'receiveCoordinationResponse', 'receiveTofiProposal', 'receiveTofiExitProposal', 'receiveTofiResponse']) {
      if (typeof bs[m] === 'function') wrapCause(m, 'PEER_REPLICA');
    }
  }

  // ── monitors, as server.js builds them, ticked by the driver (§3.8) ────
  const alerting = loadAlertingConfig();
  let obligationAlerts = 0;
  const obligationMonitor = new ForwardingObligationMonitor({
    clock,
    boardStoreFor: efsp.boardStoreFor,
    fdrStore: efsp.fdrStore,
    facilityConfig,
    airspaceStore: efsp.airspaceStore,
    // T11: L7 reshapes this broadcast. Optional, counted, gates nothing.
    onAlert: (alert) => {
      obligationAlerts++;
      if (typeof hub.broadcastEfspObligationAlert === 'function') hub.broadcastEfspObligationAlert(alert);
    },
  });
  // After L7 (ADR 0067) obligations are state carried inside efsp-alerts and
  // the monitor exposes getAll(); before it they were one-shot alerts. Both
  // shapes are supported so the soak runs on either side of that merge (T11).
  const obligationsAreState = typeof obligationMonitor.getAll === 'function';
  function broadcastAlerts() {
    const alerts = { conformance: conformance.getAll(), stca: stca.getAll() };
    if (obligationsAreState) alerts.obligations = obligationMonitor.getAll();
    hub.broadcastEfspAlerts(alerts);
  }
  if (obligationsAreState && typeof hub.setOnEfspChange === 'function') {
    hub.setOnEfspChange(() => { if (obligationMonitor.tick()) broadcastAlerts(); });
  }
  efsp.nlaStatusMonitor.setOnDelta((payload) => hub.broadcastEfspBoardDelta(payload));
  const reconciler = new CorrelationReconciler({
    clock,
    trackStore,
    beaconOf: (t) => { const c = squawks.get(String(t.id)); return c === undefined ? null : c; },
    fdrStore: efsp.fdrStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig,
    onDelta: (payload) => hub.broadcastEfspCorrelationDelta(payload),
  });
  const conformance = new ConformanceMonitor({
    clock,
    trackStore,
    fdrStore: efsp.fdrStore,
    correlationStore: efsp.correlationStore,
    weather: () => ({}),
    transitionAltFt: () => 18000,
    indicatedAltFt,
    config: alerting.conformance,
  });
  const stca = new StcaMonitor({
    trackStore,
    config: alerting.stca,
    fdrForTrack: (trackId) => efsp.correlationStore.fdrForTrack(trackId),
    activeMarsaFor: (fdrId) => efsp.marsaStore.activeFor(fdrId),
    callsignFor: (track) => track.callsign,
  });

  // ── fake sockets (tests/ws-hub-heartbeat.test.mjs:11-15's precedent) ───
  const sockets = new Map(); // clientId -> { ws, handlers, session }
  function deliver(clientId, payload) {
    if (inject.dropAck && clientId === sender && payload.startsWith('{"version":1,"type":"efsp-mutation-ack"') && payload.includes('"ok":true')) {
      inject.dropAck = false;
      return; // selfcheck: the host swallows one ack
    }
    if (inject.dropBroadcast && clientId !== sender && payload.startsWith('{"version":1,"type":"efsp-board-delta"') && !payload.includes('"updated":[],"gone":[]')) {
      inject.dropBroadcast = false;
      return; // selfcheck: one board-delta withheld from one client
    }
    out.push([clientId, payload]); // forward and forget (T6)
  }

  function connect(clientId, user) {
    if (sockets.has(clientId)) close(clientId);
    const handlers = {};
    const ws = {
      readyState: 1,
      send: (payload) => deliver(clientId, payload),
      on: (ev, fn) => { handlers[ev] = fn; },
      close() {},
    };
    hub._wss.clients.add(ws);
    hub._onConnect(ws, { crcUser: user });
    sockets.set(clientId, { ws, handlers, session: hub._sessions.get(ws) });
  }

  function close(clientId) {
    const s = sockets.get(clientId);
    if (!s) return false;
    s.ws.readyState = 3;
    hub._wss.clients.delete(s.ws);
    sockets.delete(clientId);
    if (s.handlers.close) s.handlers.close();
    return true;
  }

  function liveStrips() {
    const all = [];
    for (const fid of facilityIds) {
      for (const s of efsp.boardStoreFor(fid).getAll()) if (s.state !== 'DROPPED') all.push([fid, s]);
    }
    return all;
  }

  function orderKeyStats() {
    const lens = [];
    let max = 0; let worst = null;
    const histogram = {};
    for (const b of LIGHT_BUCKETS) histogram[bucketName(b)] = 0;
    for (const [fid, s] of liveStrips()) {
      const n = typeof s.orderKey === 'string' ? s.orderKey.length : 0;
      lens.push(n);
      for (const b of LIGHT_BUCKETS) if (n >= b[0] && n <= b[1]) { histogram[bucketName(b)]++; break; }
      if (n > max) { max = n; worst = `${fid}/${s.bayId}/${s.rackId}`; }
    }
    lens.sort((a, b) => a - b);
    const p99 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.99))] : 0;
    return { maxLen: max, p99Len: p99, worstRack: worst, histogram, rebalances: stats.rebalances, rebalancedStrips: stats.rebalancedStrips, exhaustedThrows: env.counters.exhaustedThrows };
  }

  function structureCounts() {
    const c = {};
    let total = 0; let live = 0; let dropped = 0; let log = 0; let applied = 0; let nlaHist = 0; let nlaHistDropped = 0; let maxCid = 0;
    const liveFdrs = new Set();
    for (const fid of facilityIds) {
      const bs = efsp.boardStoreFor(fid);
      let fl = 0; let fd = 0;
      for (const s of bs._strips.values()) {
        if (s.state === 'DROPPED') fd++; else { fl++; liveFdrs.add(s.fdrId); }
      }
      for (const id of bs._nlaHistory.keys()) { const s = bs._strips.get(id); if (s && s.state === 'DROPPED') nlaHistDropped++; }
      c[`strips.live.${fid}`] = fl;
      c[`strips.dropped.${fid}`] = fd;
      c[`log.${fid}`] = bs._log.length;
      c[`appliedMutations.${fid}`] = bs._appliedMutations.size;
      total += bs._strips.size; live += fl; dropped += fd;
      log = Math.max(log, bs._log.length);
      applied = Math.max(applied, bs._appliedMutations.size);
      nlaHist += bs._nlaHistory.size;
      maxCid = Math.max(maxCid, bs._cidSeq);
      c[`positions.sessions.${fid}`] = efsp.positionStoreFor(fid)._sessions.size;
    }
    c['strips.total'] = total; c['strips.live'] = live; c['strips.dropped'] = dropped;
    c['log.max'] = log; c['appliedMutations.max'] = applied;
    c['nlaHistory'] = nlaHist; c['nlaHistory.dropped'] = nlaHistDropped;
    c['cidSeq.max'] = maxCid;
    c['fdrs'] = efsp.fdrStore._fdrs.size;
    c['fdrs.withLiveStrip'] = liveFdrs.size;
    c['codes.allocated'] = efsp.fdrStore.codeAllocator._allocated.size;
    let corrTransitions = 0;
    for (const r of efsp.correlationStore._records.values()) corrTransitions += (r.transitions || []).length;
    c['correlation.records'] = efsp.correlationStore._records.size;
    c['correlation.transitions'] = corrTransitions;
    let asTransitions = 0;
    for (const r of efsp.airspaceStore._records.values()) asTransitions += (r.transitions || []).length;
    c['airspace.transitions'] = asTransitions;
    c['marsa.relations'] = efsp.marsaStore._relations.size;
    c['nlaStatus.last'] = efsp.nlaStatusMonitor._last.size;
    c['conformance.mem'] = conformance._mem.size;
    c['conformance.alerts'] = conformance._alerts.size;
    c['hub.sessions'] = hub._sessions.size;
    c['hub.labels'] = hub._labels.size;
    c['hub.described'] = hub._described ? hub._described.size : 0;
    c['tracks'] = trackStore._tracks.size;
    c['squawks'] = squawks.size;
    return c;
  }

  function sample(heavy) {
    if (heavy && typeof global.gc === 'function') { global.gc(); global.gc(); }
    const mem = process.memoryUsage();
    const res = {
      heavy: !!heavy,
      gc: heavy && typeof global.gc === 'function',
      mem: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, arrayBuffers: mem.arrayBuffers },
      counts: structureCounts(),
      orderKeys: orderKeyStats(),
      correlation: reconciler.getStats(),
      obligationAlerts,
      persistCount: env.counters.persistCount,
      persistBytes: env.counters.persistBytes,
    };
    if (heavy) {
      const hs = v8.getHeapStatistics();
      res.heapStats = { usedHeapSize: hs.used_heap_size, totalHeapSize: hs.total_heap_size, mallocedMemory: hs.malloced_memory, externalMemory: hs.external_memory };
      // Measuring the snapshot must not tell the NLA-status monitor that these
      // stamps went on the wire — they did not.
      const m = efsp.nlaStatusMonitor;
      const note = m.note;
      m.note = () => {};
      try { res.snapshotBytes = Buffer.byteLength(JSON.stringify(efsp.snapshotFor())); } finally { m.note = note; }
      const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
      res.boardFileBytes = size(BOARD_SNAPSHOT_PATH);
      res.mutationLogBytes = size(MUTATION_LOG_PATH);
    }
    return res;
  }

  function truth() {
    const facilities = {};
    for (const fid of facilityIds) {
      const bs = efsp.boardStoreFor(fid);
      const strips = [];
      let dropped = 0;
      for (const s of bs._strips.values()) {
        if (s.state === 'DROPPED') dropped++; else strips.push(compactStrip(s));
      }
      const positions = efsp.positionStoreFor(fid).getAll().map(p => ({ positionId: p.positionId, primary: p.primary ? p.primary.controllerId : null, observers: p.observers.map(o => o.controllerId) }));
      facilities[fid] = { currentSeq: bs.currentSeq, strips, dropped, positions };
    }
    const correlations = efsp.correlationStore.getAll().map(r => ({ fdrId: r.fdrId, rev: r.rev, state: r.state, trackId: r.trackId }));
    const airspaces = efsp.airspaceStore.getAll().map(a => ({ airspaceId: a.airspaceId, rev: a.rev, state: a.state }));
    return { facilities, correlations, airspaces };
  }

  function tickLeak(now) {
    if (inject.leakFrom === null) return;
    const minutes = Math.floor((now - inject.leakFrom) / 60000);
    while (inject.leak.length < minutes) inject.leak.push(new Array(32768).fill(inject.leak.length + 0.5)); // 32768 doubles = 256 KB of heap
  }

  function handle(cmd) {
    env.clock.now = cmd.now;
    out = [];
    touched = [];
    carried = new Set();
    sender = null;
    tickLeak(cmd.now);
    const reply = { id: cmd.id };
    switch (cmd.type) {
      case 'connect':
        connect(cmd.clientId, cmd.user);
        break;
      case 'close':
        reply.closed = close(cmd.clientId);
        break;
      case 'send': {
        const s = sockets.get(cmd.clientId);
        if (!s) { reply.noSocket = true; break; }
        sender = cmd.clientId;
        const t0 = performance.now();
        s.handlers.message(JSON.stringify(cmd.msg));
        reply.serverMs = performance.now() - t0;
        if (cmd.dieAfter) {
          // R2: the Mutation applied and persisted; the process dies before
          // its ack reaches anyone.
          if (process.send) process.kill(process.pid, 'SIGKILL');
          reply.died = true;
        }
        break;
      }
      case 'tick': {
        const what = new Set(cmd.what || []);
        if (what.has('expireTracks')) {
          trackStore.expireStale();
          const active = new Set(trackStore.getAll().map(t => String(t.id)));
          collabStore.evictStale(active);
          if (hub._surv && typeof hub._surv.forget === 'function') hub._surv.forget(active);
          for (const id of [...squawks.keys()]) if (!active.has(id)) squawks.delete(id);
        }
        if (what.has('reconcile')) reply.correlation = reconciler.tick();
        if (what.has('conformanceStca')) {
          const cChanged = conformance.tick();
          const sChanged = stca.tick(Date.now());
          if (cChanged || sChanged) broadcastAlerts();
          reply.alerts = { conformance: conformance._alerts.size, stca: stca.getAll().length };
        }
        if (what.has('obligationsNla')) {
          const oChanged = obligationMonitor.tick();
          if (obligationsAreState && oChanged) broadcastAlerts();
          efsp.nlaStatusMonitor.tick();
          if (obligationsAreState) reply.obligations = obligationMonitor.getAll().length;
          // H36 archiving (docs/adr/0082), as server.js runs it. No traffic
          // count in the soak, so it archives unguarded (warned once). Its
          // wall clock is the virtual Date.now.
          if (efsp.archiver) {
            const { archiveDeltas } = req('efsp/archiver.js');
            const payloads = archiveDeltas(efsp.archiver.sweep(), efsp.boardStoreFor);
            if (payloads.length) {
              efsp.persist();
              for (const p of payloads) hub.broadcastEfspBoardDelta(p);
              reply.archived = payloads.reduce((n, p) => n + p.gone.length, 0);
            }
          }
        }
        if (what.has('heartbeat')) {
          for (const [ws, session] of hub._sessions) hub._tick(ws, session);
        }
        break;
      }
      case 'tracks': {
        for (const id of cmd.remove || []) { trackStore.remove(id); squawks.delete(String(id)); }
        for (const u of cmd.upsert || []) {
          trackStore.update({
            id: u.id, callsign: u.callsign, name: u.callsign, coalition: 2, type: u.type || 'F-16C_50',
            lat: u.lat, lon: u.lon, alt: u.alt, heading: u.course, course: u.course,
            groundSpeed: u.groundSpeed, verticalSpeed: u.verticalSpeed, player: 'Pilot', category: 1,
          });
          squawks.set(String(u.id), u.squawk == null ? null : u.squawk);
        }
        break;
      }
      case 'missionReload':
        trackStore.clear();
        squawks.clear();
        reconciler.resetPicture('MISSION_RELOAD');
        break;
      case 'truth':
        reply.truth = truth();
        break;
      case 'strip': {
        const bs = efsp.boardStoreFor(cmd.facilityId);
        reply.strip = bs ? compactStrip(bs.getStrip(cmd.stripId)) : null;
        break;
      }
      case 'rack': {
        const bs = efsp.boardStoreFor(cmd.facilityId);
        reply.rack = bs ? bs.getRack(cmd.bayId, cmd.rackId).map(s => ({ stripId: s.stripId, orderKey: s.orderKey, ownerPositionId: s.ownerPositionId, rev: s.rev })) : [];
        break;
      }
      case 'sample':
        reply.sample = sample(!!cmd.heavy);
        break;
      case 'inject':
        if (cmd.fault === 'drop-ack') inject.dropAck = true;
        else if (cmd.fault === 'drop-broadcast') inject.dropBroadcast = true;
        else if (cmd.fault === 'leak') inject.leakFrom = cmd.now;
        else if (cmd.fault === 'crash-before-persist') env.counters.crashBeforePersist = true;
        break;
      case 'prune': {
        // DIAGNOSTIC ONLY (--prune-retired): what the heap does without
        // retention. Never a fix — see the report header.
        let strips = 0; let fdrs = 0;
        const liveFdrs = new Set();
        for (const [, s] of liveStrips()) liveFdrs.add(s.fdrId);
        for (const fid of facilityIds) {
          const bs = efsp.boardStoreFor(fid);
          for (const [id, s] of bs._strips) {
            if (s.state !== 'DROPPED') continue;
            bs._strips.delete(id); bs._nlaHistory.delete(id); strips++;
          }
        }
        for (const id of [...efsp.fdrStore._fdrs.keys()]) {
          if (liveFdrs.has(id)) continue;
          efsp.fdrStore._fdrs.delete(id); efsp.correlationStore._records.delete(id); fdrs++;
        }
        reply.pruned = { strips, fdrs };
        break;
      }
      case 'console':
        reply.console = [...env.consoleStats.entries()].map(([prefix, s]) => ({ prefix, count: s.count, first: s.first.slice(0, 3) }));
        break;
      case 'ping':
        break;
      default:
        throw new Error(`soak host: unknown command ${cmd.type}`);
    }
    reply.out = out;
    // Strips whose rev moved this command with no board-delta carrying them
    // to anyone — the driver's cause hint for any staleness that follows.
    const uncarried = [];
    const seen = new Set();
    for (const t of touched) {
      const k = `${t.fid}|${t.id}`;
      if (carried.has(k) || seen.has(k)) continue;
      seen.add(k);
      uncarried.push({ facilityId: t.fid, stripId: t.id, cause: t.cause || 'UNKNOWN' });
    }
    if (uncarried.length) reply.uncarried = uncarried;
    if (env.counters.persistMs.length) { reply.persistMs = env.counters.persistMs; env.counters.persistMs = []; }
    reply.internalErrors = env.counters.internalErrors;
    reply.storeInternalErrors = env.counters.storeInternalErrors;
    reply.systemReassigns = stats.systemReassigns;
    out = [];
    return reply;
  }

  function shutdown() {
    for (const id of [...sockets.keys()]) close(id);
    hub._sessions.clear();
  }

  return { handle, shutdown };
}

module.exports = { createHost, compactStrip };
