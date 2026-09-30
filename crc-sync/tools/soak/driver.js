'use strict';

// The soak driver: a discrete-event loop on virtual time (briefing §5.4).
// Pop the next event, advance virtual `now` to it, send the host a command,
// and process everything the fake sockets received before the next event.
// Nothing here uses setTimeout for pacing except --realtime.
//
// The driver never assumes the server did what it asked: owner, state, rev
// and peer ids always come from the latest ack, broadcast or truth.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Rng } = require('./prng');
const { Shadow } = require('./shadow');
const { Ledger, wireLevel } = require('./ledger');
const { Sky } = require('./sky');
const { Latency } = require('./metrics');
const { PROFILES, CREWS, POSITION_FACILITY, SCRIPT_WEIGHTS, SCRIPTS, NLA_FALLBACK, callsignFor } = require('./traffic');

const FACILITIES = ['INCIRLIK', 'CENTER', 'TACTICAL', 'RANGES'];
const NLA_GUARD_MS = 400 + 10; // NLA_DOUBLE_TAP_MS + 10, briefing §5.2
const EVENTS_CAP = 50;
// Where a CD-owned departure goes back to when a covering Position was handed it.
const RETURN_BAY = {
  PENDING_CLEARANCE: { position: 'CD', bayId: 'cd-pending-clearance' },
  CLEARED: { position: 'CD', bayId: 'cd-cleared' },
  HELD: { position: 'CD', bayId: 'cd-held' },
};
const MIN = 60000;

class Heap {
  constructor() { this.a = []; this.seq = 0; }
  get size() { return this.a.length; }
  push(t, fn, label) {
    const e = { t, s: this.seq++, fn, label };
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
function less(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }

class Driver {
  constructor(opts) {
    this.o = opts;
    this.host = opts.host;
    this.profile = { ...PROFILES[opts.profile] };
    this.crewName = opts.crew || this.profile.crew;
    this.t0 = opts.startNow;
    this.now = this.t0;
    this.tEnd = this.t0 + opts.minutes * MIN;
    this.heap = new Heap();
    this.rng = new Rng(opts.seed, 'traffic');
    this.rngSky = new Rng(opts.seed, 'sky');
    this.rngNet = new Rng(opts.seed, 'network');
    this.sky = new Sky(this.rngSky);
    this.ledger = new Ledger();
    this.latency = new Latency(10 * MIN);
    this.digest = crypto.createHash('sha256');
    this.lifetime = 1;
    this.cmidSeq = 0;
    this.eventsOut = fs.createWriteStream(path.join(opts.outDir, 'events.ndjson'));
    this.timelineOut = fs.createWriteStream(path.join(opts.outDir, 'timeline.ndjson'));
    this.eventCounts = {};

    // Clients: the crew plus one passive shadow (the H4 probe).
    this.clients = new Map();
    for (const m of CREWS[this.crewName]) this._addClient(m.id, m.holds, !!m.observer);
    this._addClient('probe-h4', {}, true, true);

    // Driver-level knowledge ("oracle": the union of the latest ack/broadcast per Strip, briefing §5.5 R1).
    this.oracle = new Map();      // `${fid}|${sid}` -> { ...compact, dropped }
    this.positions = new Map();   // `${fid}|${pos}` -> primary controllerId
    this.airspaces = new Map();   // airspaceId -> { rev, state }
    this.correlations = new Map(); // fdrId -> { rev, state, trackId }
    this.flights = new Map();
    this.stripFlight = new Map(); // sid -> flightId
    this.fdrFlight = new Map();   // fdrId -> flightId
    this.flightSeq = 0;
    this.lastNla = new Map();     // sid -> virtual ms of the last InvokeNla
    this.uncarriedHints = new Map(); // `${fid}|${sid}` -> cause
    this.rangeActivation = null;

    this.stats = {
      flightsStarted: 0, flightsCompleted: 0, flightsAborted: 0, byScript: {},
      doubleTapNoop: 0, doubleTapNotGuarded: 0, undo: 0,
      storms: 0, stormMoves: 0, reconnects: 0, disconnects: 0, restarts: 0, missionReloads: 0,
      conflictsInjected: 0, manningChurn: 0, heartbeats: 0, obligationAlerts: 0, alertsMsgs: 0,
      liveStrips: { min: Infinity, max: 0, end: 0, series: [] },
      orphans: new Map(), janitorFails: new Map(), janitorDrops: 0,
      misbinding: { count: 0, byCause: {}, examples: [], seen: new Set() },
      correlation: { rateMin: null, rateSum: 0, rateN: 0, rebinds: 0, last: null },
      silentStaleness: { count: 0, byCause: {}, seen: new Map(), maxPersistMs: 0, examples: [] },
      resync: { delta: 0, snapshot: 0, resyncDivergence: 0, divergenceExamples: [], acrossRestartDivergence: { count: 0, examples: [], probes: 0, notExercised: 0 } },
      restart: { boardLostOnRestart: 0, lostExamples: [], restartDiffs: [], oracleOlder: 0, oracleNewer: 0, ambiguousReplay: [] },
      shadowRegressions: 0, injectedShadowDrops: 0,
      uncarried: { count: 0, byCause: {} },
      alerts: { conformanceMax: 0, stcaMax: 0, stcaRaised: 0, conformanceRaised: 0 },
      lost: 0,
    };
    this.samples = [];   // light + heavy samples, numbers only
    this.persistTotal = 0;
    this.injectShadowDrop = opts.inject === 'skip-shadow-client';
  }

  _addClient(id, holds, observer, passive = false) {
    this.clients.set(id, {
      id, holds, observer, passive, user: { name: id, sub: id },
      connected: false, continuous: false, declared: false, discard: false,
      shadow: new Shadow(FACILITIES),
    });
  }

  at(t, fn, label) { if (t <= this.tEnd + 60000) this.heap.push(Math.round(t), fn, label); }
  after(ms, fn, label) { this.at(this.now + ms, fn, label); }
  note(action) {
    const line = `${this.now - this.t0}|${action}\n`;
    this.digest.update(line);
    if (this.o.traceDigest) this.o.traceDigest.write(line);
  }
  event(category, data) {
    const n = (this.eventCounts[category] = (this.eventCounts[category] || 0) + 1);
    if (n <= EVENTS_CAP) this.eventsOut.write(JSON.stringify({ t: (this.now - this.t0) / 1000, category, ...data }) + '\n');
  }

  // ── host calls ─────────────────────────────────────────────────────────

  async call(type, body = {}) {
    const reply = await this.host.call({ type, now: this.now, ...body });
    if (reply.persistMs) { this.latency.addPersist(this.t0, this.now, reply.persistMs); this.persistTotal += reply.persistMs.length; }
    if (reply.uncarried) {
      for (const u of reply.uncarried) {
        this.uncarriedHints.set(`${u.facilityId}|${u.stripId}`, u.cause);
        this.stats.uncarried.count++;
        this.stats.uncarried.byCause[u.cause] = (this.stats.uncarried.byCause[u.cause] || 0) + 1;
      }
    }
    if (reply.internalErrors !== undefined) this.hostInternalErrors = Math.max(this.hostInternalErrors || 0, reply.internalErrors);
    if (reply.storeInternalErrors !== undefined) this.hostStoreInternalErrors = Math.max(this.hostStoreInternalErrors || 0, reply.storeInternalErrors);
    return reply;
  }

  /** Delivers one reply's socket output to the clients' shadows. Returns per-command facts for M1/M8. */
  deliver(out, { resyncFor = null, sender = null } = {}) {
    const facts = { acks: new Map(), deltas: new Map(), otherDeltas: new Map(), resyncAnswer: null };
    for (const [clientId, payload] of out) {
      const c = this.clients.get(clientId);
      if (!c) continue;
      if (payload.startsWith('{"version":1,"type":"efsp-heartbeat"')) { this.stats.heartbeats++; continue; }
      if (payload.indexOf('"type":"efsp-') < 0 || payload.indexOf('"type":"efsp-') > 30) continue; // non-EFSP (status, coverage, tracks)
      const msg = JSON.parse(payload);
      if (resyncFor === clientId && (msg.type === 'efsp-board-delta' || msg.type === 'efsp-snapshot') && !facts.resyncAnswer) {
        facts.resyncAnswer = msg;
        continue; // the caller applies it
      }
      switch (msg.type) {
        case 'efsp-snapshot':
          this._learnSnapshot(msg);
          if (!c.discard) { c.shadow.applySnapshot(msg); c.continuous = true; }
          break;
        case 'efsp-board-delta': {
          this._learnDelta(msg);
          if (this.injectShadowDrop && sender && c.id === this._shadowDropTarget(sender) && msg.strips.gone.some(id => { const x = c.shadow._fac(msg.facilityId).get(id); return x && x.state !== 'DROPPED'; }) && this.now > this.t0 + 3 * MIN) {
            this.injectShadowDrop = false; this.stats.injectedShadowDrops++;
            this.event('injectedShadowDrop', { client: c.id, sender, facilityId: msg.facilityId, gone: msg.strips.gone, updated: msg.strips.updated.map(x => x.stripId) });
            break; // selfcheck: the driver drops one delta on its side (a Drop, which nothing later repairs)
          }
          c.shadow.applyDelta(msg);
          let set = facts.deltas.get(clientId);
          if (!set) { set = new Set(); facts.deltas.set(clientId, set); }
          for (const s of msg.strips.updated) set.add(`${msg.facilityId}|${s.stripId}`);
          for (const id of msg.strips.gone) set.add(`${msg.facilityId}|${id}`);
          break;
        }
        case 'efsp-mutation-ack':
          this._learnStrip(msg.facilityId, msg.strip);
          c.shadow.applyAck(msg);
          pushMap(facts.acks, msg.clientMutationId, { clientId, msg });
          break;
        case 'efsp-airspace-ack':
          if (msg.airspace) this.airspaces.set(msg.airspace.airspaceId, { rev: msg.airspace.rev, state: msg.airspace.state });
          pushMap(facts.acks, msg.clientMutationId, { clientId, msg });
          break;
        case 'efsp-correlation-ack':
          if (msg.correlation) this._learnCorrelation(msg.correlation);
          pushMap(facts.acks, msg.clientMutationId, { clientId, msg });
          break;
        case 'efsp-marsa-ack':
          pushMap(facts.acks, msg.clientMutationId, { clientId, msg });
          break;
        case 'efsp-positions-ack':
          pushMap(facts.acks, `positions:${msg.facilityId}`, { clientId, msg });
          break;
        case 'efsp-airspace-delta':
          for (const a of msg.airspaces.updated) this.airspaces.set(a.airspaceId, { rev: a.rev, state: a.state });
          addOther(facts.otherDeltas, clientId, msg.type);
          break;
        case 'efsp-correlation-delta':
          for (const r of msg.correlations.updated) this._learnCorrelation(r);
          if (msg.stats) this._learnCorrelationStats(msg.stats);
          addOther(facts.otherDeltas, clientId, msg.type);
          break;
        case 'efsp-marsa-delta':
          addOther(facts.otherDeltas, clientId, msg.type);
          break;
        case 'efsp-alerts': {
          this.stats.alertsMsgs++;
          const n = (msg.conformance || []).length;
          if (n > this.stats.alerts.conformanceMax) this.stats.alerts.conformanceMax = n;
          break;
        }
        case 'efsp-obligation-alert':
          this.stats.obligationAlerts++;
          break;
        default:
          break;
      }
    }
    return facts;
  }

  /** A connected controller other than the sender (whose own ack would repair the dropped delta). */
  _shadowDropTarget(sender) {
    for (const c of this.clients.values()) if (!c.passive && c.connected && c.continuous && c.id !== sender) return c.id;
    return null;
  }

  _learnStrip(fid, s) {
    if (!s || !fid) return;
    const k = `${fid}|${s.stripId}`;
    const prev = this.oracle.get(k);
    if (prev && prev.rev > s.rev) return;
    this.oracle.set(k, {
      stripId: s.stripId, rev: s.rev, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, rackId: s.rackId,
      orderKey: s.orderKey, role: s.role, fdrId: s.fdrId, facilityId: fid, dropped: s.state === 'DROPPED',
      coordination: s.coordination ? { primitive: s.coordination.primitive, state: s.coordination.state, peerStripId: s.coordination.peerStripId } : (s.coord || null),
      tofiCoordination: s.tofiCoordination ? { state: s.tofiCoordination.state, peerStripId: s.tofiCoordination.peerStripId } : (s.tofi || null),
    });
  }

  _learnDelta(msg) {
    for (const s of msg.strips.updated) this._learnStrip(msg.facilityId, s);
    for (const id of msg.strips.gone) {
      const k = `${msg.facilityId}|${id}`;
      const prev = this.oracle.get(k);
      if (prev) { prev.dropped = true; prev.state = 'DROPPED'; } else this.oracle.set(k, { stripId: id, facilityId: msg.facilityId, dropped: true, state: 'DROPPED', rev: -1 });
    }
    for (const p of (msg.positions && msg.positions.updated) || []) this.positions.set(`${p.facilityId}|${p.positionId}`, p.primary ? p.primary.controllerId : null);
  }

  _learnSnapshot(msg) {
    for (const s of msg.strips || []) this._learnStrip(s.facilityId, s);
    for (const p of msg.positions || []) this.positions.set(`${p.facilityId}|${p.positionId}`, p.primary ? p.primary.controllerId : null);
    for (const a of msg.airspaces || []) this.airspaces.set(a.airspaceId, { rev: a.rev, state: a.state });
    for (const r of msg.correlations || []) this._learnCorrelation(r);
  }

  _learnCorrelation(r) {
    this.correlations.set(r.fdrId, { rev: r.rev, state: r.state, trackId: r.trackId });
    if (r.state === 'CORRELATED' && r.trackId) {
      const owner = this.sky.ownerOfTrack(r.trackId);
      if (owner && owner.fdrId !== r.fdrId) {
        const key = `${r.fdrId}|${r.trackId}`;
        if (!this.stats.misbinding.seen.has(key)) {
          this.stats.misbinding.seen.add(key);
          const cause = owner.done ? 'LINGERING_TRACK' : (owner.faults && owner.faults.length ? `FAULT_${owner.faults.join('+')}` : 'OTHER_LIVE_FLIGHT');
          this.stats.misbinding.count++;
          this.stats.misbinding.byCause[cause] = (this.stats.misbinding.byCause[cause] || 0) + 1;
          const ex = { fdrId: r.fdrId, trackId: r.trackId, matchedBy: r.matchedBy, trackBelongsToFdr: owner.fdrId, cause, squawk: owner.squawk };
          if (this.stats.misbinding.examples.length < 20) this.stats.misbinding.examples.push(ex);
          this.event('misbinding', ex);
        }
      }
    }
  }

  _learnCorrelationStats(stats) {
    if (!stats) return;
    this.stats.correlation.last = stats;
    if (Number.isFinite(stats.rate) && stats.eligible >= 3) {
      this.stats.correlation.rateMin = this.stats.correlation.rateMin === null ? stats.rate : Math.min(this.stats.correlation.rateMin, stats.rate);
      this.stats.correlation.rateSum += stats.rate; this.stats.correlation.rateN++;
    }
    if (Number.isFinite(stats.rebinds)) this.stats.correlation.rebinds = stats.rebinds;
  }

  // ── sending ────────────────────────────────────────────────────────────

  nextCmid() { this.cmidSeq++; return `soak-${this.o.seed}-${this.cmidSeq}`; }

  clientForPosition(positionId) {
    const fid = POSITION_FACILITY[positionId];
    const cid = this.positions.get(`${fid}|${positionId}`);
    if (!cid) return null;
    const c = this.clients.get(cid);
    return c && c.connected && c.declared && !c.observer ? c : null;
  }

  /**
   * Sends one message from a client and settles it: M1 (exactly one ack),
   * M6 (no internal error), M8 (a successful ack's Strip reaches every
   * connected client in the same output). Returns the sender's ack, or null.
   */
  async send(client, msg, { replay = false, label = '' } = {}) {
    if (!replay && ['efsp-mutation', 'efsp-airspace-mutation', 'efsp-correlation-mutation', 'efsp-marsa-mutation'].includes(msg.type)) {
      msg.clientMutationId = this.nextCmid();
    }
    this.ledger.onSent(msg, client.id, this.now, this.lifetime);
    this.note(`${client.id}|${msg.type}|${msg.op ? msg.op.kind : ''}|${msg.actingPositionId || ''}|${label}${replay ? '|replay' : ''}`);
    const reply = await this.call('send', { clientId: client.id, msg });
    if (reply.noSocket) throw new Error(`harness: send on a closed socket for ${client.id}`);
    const kind = msg.type === 'efsp-mutation' ? `mutation:${msg.op.kind}` : msg.type;
    this.latency.add(this.t0, this.now, kind, reply.serverMs);
    const facts = this.deliver(reply.out, { sender: client.id });
    if (!msg.clientMutationId) return { reply, facts };
    const acks = (facts.acks.get(msg.clientMutationId) || []).filter(a => a.clientId === client.id);
    this.ledger.settle([msg.clientMutationId], new Map([[msg.clientMutationId, acks]]), { type: msg.type, op: msg.op && msg.op.kind, client: client.id, t: (this.now - this.t0) / 1000 });
    if (acks.length === 0) { this.event('lost', { cmid: msg.clientMutationId, type: msg.type, op: msg.op && msg.op.kind }); return null; }
    const ack = acks[0].msg;
    this.ledger.onAck(ack, { isReplay: replay });
    if (!replay && !ack.ok && !['STALE_REV', 'NLA_INHIBITED', 'NOT_HOLDING_POSITION'].includes(ack.reason)) {
      this.event(`refusal:${msg.op ? msg.op.kind : msg.type}:${ack.reason}`, { detail: ack.detail, actingPositionId: msg.actingPositionId, strip: ack.strip ? { state: ack.strip.state, owner: ack.strip.ownerPositionId, role: ack.strip.role } : null });
    }
    // M8 holds for a first send. A replay answers from the idempotency cache
    // and broadcasts nothing by design (docs/adr/0081): its broadcast went out
    // the first time.
    if (ack.ok && !replay) this._checkBroadcast(msg, ack, facts);
    if (!replay && !this.o.noReplays && (ack.ok || !wireLevel(ack)) && this.rngNet.chance(0.01)) {
      const life = this.lifetime;
      const copy = JSON.parse(JSON.stringify(msg));
      this.after(this.rngNet.uniform(500, 3000), () => this.replay(client, copy, ack, life), 'replay');
    }
    return ack;
  }

  _checkBroadcast(msg, ack, facts) {
    const connected = [...this.clients.values()].filter(c => c.connected);
    if (msg.type === 'efsp-mutation') {
      const key = `${ack.facilityId}|${ack.strip.stripId}`;
      for (const c of connected) {
        const got = facts.deltas.get(c.id);
        if (!got || !got.has(key)) {
          this.ledger.broadcastMissing++;
          if (this.ledger.broadcastMissingExamples.length < 20) this.ledger.broadcastMissingExamples.push({ cmid: msg.clientMutationId, op: msg.op.kind, client: c.id });
          this.event('broadcastMissing', { cmid: msg.clientMutationId, op: msg.op.kind, client: c.id });
        }
      }
    } else {
      const want = { 'efsp-airspace-mutation': 'efsp-airspace-delta', 'efsp-correlation-mutation': 'efsp-correlation-delta', 'efsp-marsa-mutation': 'efsp-marsa-delta' }[msg.type];
      for (const c of connected) {
        const got = facts.otherDeltas.get(c.id);
        if (!got || !got.has(want)) {
          this.ledger.broadcastMissing++;
          this.event('broadcastMissing', { cmid: msg.clientMutationId, type: msg.type, client: c.id });
        }
      }
    }
  }

  /** M7: re-send an earlier message verbatim, in the same server lifetime. */
  async replay(client, msg, originalAck, life) {
    if (life !== this.lifetime || !client.connected || !client.declared) return;
    // The rev before the replay comes from server truth, not the oracle: H1
    // (a rebalance bumping revs no broadcast carries) leaves the oracle behind.
    let revBefore = null;
    const sid = msg.type === 'efsp-mutation' ? (msg.stripId || (originalAck.strip && originalAck.strip.stripId)) : null;
    if (sid) { const t = await this.call('strip', { facilityId: msg.facilityId, stripId: sid }); revBefore = t.strip ? t.strip.rev : null; }
    const ack = await this.send(client, msg, { replay: true, label: 'M7' });
    if (!ack) return;
    let revAfter = null;
    if (msg.type === 'efsp-mutation' && ack.strip) revAfter = ack.strip.rev;
    this.ledger.recordReplay({
      cmid: msg.clientMutationId, kind: msg.type, op: msg.op && msg.op.kind,
      originalOk: !!originalAck.ok, originalReason: originalAck.reason || null,
      replayOk: !!ack.ok, replayReason: ack.reason || null, revBefore, revAfter, lifetime: life,
    });
  }

  // ── known strips ───────────────────────────────────────────────────────

  async knownStrip(fid, sid) {
    const o = this.oracle.get(`${fid}|${sid}`);
    if (o && o.rev >= 0 && o.ownerPositionId) return o;
    return this.refreshStrip(fid, sid);
  }

  async refreshStrip(fid, sid) {
    const r = await this.call('strip', { facilityId: fid, stripId: sid });
    if (!r.strip) return null;
    this._learnStrip(fid, r.strip);
    const o = this.oracle.get(`${fid}|${sid}`);
    if (o && o.rev < r.strip.rev) Object.assign(o, r.strip);
    // Truth wins over a stale oracle entry (H1 can leave it behind).
    if (o) { o.rev = r.strip.rev; o.state = r.strip.state; o.ownerPositionId = r.strip.ownerPositionId; o.bayId = r.strip.bayId; o.rackId = r.strip.rackId; o.dropped = r.strip.state === 'DROPPED'; }
    return o;
  }

  // ── flights ────────────────────────────────────────────────────────────

  startFlight(script) {
    const id = ++this.flightSeq;
    const f = {
      id, script, callsign: callsignFor(script, id), strips: new Map(), done: false, ok: true,
      queue: [], attempts: 0, fdr: null, storm: null,
    };
    f.own = (sid, fid) => { f.strips.set(sid, fid); this.stripFlight.set(sid, id); };
    if (this.rng.chance(this.profile.stormP)) {
      f.storm = { moves: this.rng.int(this.profile.stormMoves[0], this.profile.stormMoves[1]), pattern: this.rng.pick(this.profile.stormPatterns) };
    }
    const x = { rng: this.rng, sameSlotCreate: this.rng.chance(0.3) };
    f.gen = SCRIPTS[script](f, x);
    this.flights.set(id, f);
    this.stats.flightsStarted++;
    this.stats.byScript[script] = this.stats.byScript[script] || { started: 0, completed: 0, aborted: 0 };
    this.stats.byScript[script].started++;
    this.note(`flight|${id}|${script}`);
    this.after(this.rng.uniform(500, 3000), () => this.stepFlight(f, undefined), 'flight');
  }

  thinkMs(scale = 1) {
    const [lo, hi] = this.profile.thinkS;
    return this.rng.expBetween(lo, hi) * 1000 * scale;
  }

  finishFlight(f, ok) {
    if (f.done) return;
    f.done = true;
    f.ok = ok;
    if (ok) { this.stats.flightsCompleted++; this.stats.byScript[f.script].completed++; }
    else { this.stats.flightsAborted++; this.stats.byScript[f.script].aborted++; }
    this.sky.land(f.id, this.now);
    this.note(`flightDone|${f.id}|${ok}`);
  }

  /** Runs the flight's queued edits, one event each, then continues. */
  drainThen(f, cont) {
    if (f.done) return null;
    if (!f.queue.length) return cont();
    const next = f.queue.shift();
    // A deliberate double-tap lands inside the 400 ms latch; storm moves are a second or two apart.
    const delay = next.doubleTap ? 100 : next.kind === 'storm' && next.started ? this.rng.uniform(500, 2000) : this.thinkMs(0.2);
    this.after(delay, async () => { if (f.done) return; await this.execEdit(f, next); this.drainThen(f, cont); }, 'edit');
    return null;
  }

  async stepFlight(f, input) {
    if (f.done) return;
    let res;
    try { res = f.gen.next(input); } catch (err) { this.event('scriptError', { flight: f.id, err: String(err.stack || err) }); this.finishFlight(f, false); return; }
    if (res.done) { this.finishFlight(f, f.lastOk !== false); return; }
    const intent = res.value;
    if (intent.kind === 'think') { this.after(this.thinkMs(0.5), () => this.stepFlight(f, { ok: true }), 'think'); return; }
    if (intent.kind === 'ensureRangeActive') { await this.ensureRangeActive(); return this.stepFlight(f, { ok: true }); }
    f.intent = intent; f.attempts = 0; f.walkPresses = 0; f.inhibited = 0;
    this.after(this.thinkMs(), () => this.execIntent(f), 'intent');
  }

  /** The intent failed for good: give the generator the refusal and let it end. */
  resume(f, result) {
    f.intent = null;
    f.lastOk = result.ok;
    return this.drainThen(f, () => this.stepFlight(f, result));
  }

  waitActor(f) {
    f.attempts++;
    if (f.attempts > 80) return this.resume(f, { ok: false, reason: 'ACTOR_UNAVAILABLE' });
    this.after(this.rng.uniform(10000, 30000), () => this.execIntent(f), 'wait-actor');
    return null;
  }

  async execIntent(f) {
    if (f.done || !f.intent) return;
    const it = f.intent;
    if (it.kind === 'create') return this.execCreate(f, it);
    if (it.kind === 'op') return this.execOp(f, it);
    if (it.kind === 'walk') return this.execWalk(f, it);
    return this.resume(f, { ok: false, reason: 'UNKNOWN_INTENT' });
  }

  async execCreate(f, it) {
    const client = this.clientForPosition(it.actor);
    if (!client) return this.waitActor(f);
    const op = { ...it.op };
    if (op.afterStripId === '@first') {
      const r = await this.call('rack', { facilityId: it.facilityId, bayId: op.bayId, rackId: op.rackId });
      if (r.rack.length >= 2) { op.afterStripId = r.rack[0].stripId; op.beforeStripId = r.rack[1].stripId; } else delete op.afterStripId;
    }
    const msg = { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: it.actor, op };
    const ack = await this.send(client, msg, { label: `f${f.id}` });
    if (!ack) return this.resume(f, { ok: false, reason: 'LOST' });
    if (!ack.ok) {
      if (ack.reason === 'NOT_HOLDING_POSITION') return this.waitActor(f);
      return this.resume(f, { ok: false, reason: ack.reason, ack });
    }
    f.own(ack.strip.stripId, it.facilityId);
    if (ack.fdr) {
      f.fdr = { fdrId: ack.fdr.fdrId, callsign: ack.fdr.identity && ack.fdr.identity.callsign || f.callsign, code: ack.fdr.identity && ack.fdr.identity.beaconAssigned };
      this.fdrFlight.set(ack.fdr.fdrId, f.id);
    }
    this.onStrip(f, it.facilityId, ack.strip);
    this.queueEdits(f, it.facilityId, ack.strip, null);
    return this.resume(f, { ok: true, strip: ack.strip, ack });
  }

  async execOp(f, it) {
    const s = await this.knownStrip(it.facilityId, it.stripId);
    if (!s || s.dropped) return this.resume(f, { ok: false, reason: 'GONE' });
    const actor = s.ownerPositionId;
    const client = this.clientForPosition(actor);
    if (!client) return this.waitActor(f);
    if (it.op.kind === 'InvokeNla') {
      const last = this.lastNla.get(it.stripId);
      if (last !== undefined && this.now - last < NLA_GUARD_MS) { this.after(NLA_GUARD_MS, () => this.execIntent(f), 'nla-guard'); return; }
    }
    const msg = { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: actor, stripId: it.stripId, baseRev: s.rev, op: it.op };
    const before = { state: s.state, rev: s.rev, owner: s.ownerPositionId };
    if (it.op.kind === 'InvokeNla') this.lastNla.set(it.stripId, this.now);
    const ack = await this.send(client, msg, { label: `f${f.id}${it.edit ? '|edit' : ''}` });
    if (!ack) return this.resume(f, { ok: false, reason: 'LOST' });
    if (ack.ok) {
      this.onStrip(f, it.facilityId, ack.strip);
      if (it.op.kind === 'SetBlock' && it.op.blockId === '21') this.sky.assignAltitude(f.id, it.op.value);
      this.queueEdits(f, it.facilityId, ack.strip, it.op.kind === 'InvokeNla' ? before : null);
      return this.resume(f, { ok: true, strip: ack.strip, ack });
    }
    return this.onRefusal(f, it, ack);
  }

  onRefusal(f, it, ack) {
    if (ack.strip) this._learnStrip(it.facilityId, ack.strip);
    f.attempts++;
    switch (ack.reason) {
      case 'NOT_HOLDING_POSITION':
        return this.waitActor(f);
      case 'STALE_REV':
      case 'NOT_OWNER':
        if (f.attempts <= 5) { this.after(this.rng.uniform(500, 3000), () => this.execIntent(f), 'retry'); return null; }
        break;
      case 'NLA_INHIBITED':
        if (f.attempts <= 3) { this.after(this.rng.uniform(15000, 60000), () => this.execIntent(f), 'inhibited'); return null; }
        break;
      default:
        break;
    }
    return this.resume(f, { ok: false, reason: ack.reason, ack, strip: ack.strip });
  }

  async execWalk(f, it) {
    const s = await this.knownStrip(it.facilityId, it.stripId);
    if (!s) return this.resume(f, { ok: false, reason: 'GONE' });
    if (it.until(s)) return this.resume(f, { ok: true, strip: s });
    if (s.dropped) return this.resume(f, { ok: false, reason: 'GONE', strip: s });
    if (f.walkPresses >= it.max) return this.resume(f, { ok: false, reason: 'WALK_EXHAUSTED', strip: s });
    const actor = s.ownerPositionId;
    const client = this.clientForPosition(actor);
    if (!client) return this.waitActor(f);
    const last = this.lastNla.get(it.stripId);
    if (last !== undefined && this.now - last < NLA_GUARD_MS) { this.after(NLA_GUARD_MS, () => this.execIntent(f), 'nla-guard'); return null; }

    // Pressed NLA inhibited three times in this state: set it by hand.
    const fallback = f.inhibited >= 3 ? (NLA_FALLBACK[s.role] || {})[s.state] : null;
    const op = fallback ? { kind: 'SetState', toState: fallback } : { kind: 'InvokeNla' };
    const before = { state: s.state, rev: s.rev, owner: s.ownerPositionId };
    const msg = { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: actor, stripId: it.stripId, baseRev: s.rev, op };
    if (op.kind === 'InvokeNla') this.lastNla.set(it.stripId, this.now);
    const ack = await this.send(client, msg, { label: `f${f.id}|walk` });
    if (!ack) return this.resume(f, { ok: false, reason: 'LOST' });
    if (ack.ok) {
      f.walkPresses++; f.inhibited = 0; f.attempts = 0;
      this.onStrip(f, it.facilityId, ack.strip);
      this.queueEdits(f, it.facilityId, ack.strip, op.kind === 'InvokeNla' ? before : null);
      // Edits (if any) first, then the next press — execWalk re-checks `until` itself.
      return this.drainThen(f, () => {
        if (it.until(this.oracle.get(`${it.facilityId}|${it.stripId}`) || ack.strip)) return this.resume(f, { ok: true, strip: ack.strip });
        this.after(this.thinkMs(), () => this.execIntent(f), 'walk');
        return null;
      });
    }
    // A covering Position was handed a Strip it may not advance (the vacated
    // Position's work, routed down the covering chain). A controller hands it
    // back once its Position is manned again; until then the flight waits.
    const notMine = ack.reason === 'PERMISSION_DENIED' && /is not (\w+)'s to advance/.exec(ack.detail || '');
    if (notMine && s.role === 'DEPARTURE' && RETURN_BAY[s.state]) {
      this.stats.coveringStranded = (this.stats.coveringStranded || 0) + 1;
      const home = RETURN_BAY[s.state];
      if (this.clientForPosition(home.position)) {
        const cur = ack.strip || s;
        const back = await this.send(client, { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: actor, stripId: it.stripId, baseRev: cur.rev, op: { kind: 'TransferStrip', toPositionId: home.position, bayId: home.bayId, rackId: 'main' } }, { label: `f${f.id}|handback` });
        if (back && back.ok) { this.stats.coveringHandedBack = (this.stats.coveringHandedBack || 0) + 1; this.after(this.thinkMs(), () => this.execIntent(f), 'walk'); return null; }
      }
      f.attempts++;
      if (f.attempts > 40) return this.resume(f, { ok: false, reason: ack.reason, ack });
      this.after(this.rng.uniform(15000, 45000), () => this.execIntent(f), 'stranded');
      return null;
    }
    if (ack.reason === 'NLA_INHIBITED') {
      f.inhibited++;
      if (f.inhibited > 4) return this.resume(f, { ok: false, reason: 'NLA_INHIBITED', ack, strip: ack.strip });
      this.after(this.rng.uniform(15000, 60000), () => this.execIntent(f), 'inhibited');
      return null;
    }
    return this.onRefusal(f, it, ack);
  }

  /** One edit, fire-and-forget: refusals are data, and nothing downstream waits on it. */
  async execEdit(f, it) {
    if (it.kind === 'storm') return this.stormMove(f, it);
    if (it.kind === 'correlation') {
      const s = await this.knownStrip(it.facilityId, it.stripId);
      if (!s || s.dropped) return;
      const client = this.clientForPosition(s.ownerPositionId);
      if (!client || s.ownerPositionId === 'SOUTH_RANGE') return;
      const cur = this.correlations.get(it.fdrId);
      const trackId = this.sky.trackIdOf(f.id);
      if (it.op.kind === 'BindTrack' && !trackId) return;
      const op = it.op.kind === 'BindTrack' ? { kind: 'BindTrack', trackId: String(trackId) } : { kind: 'UnbindTrack' };
      const ack = await this.send(client, { version: 1, type: 'efsp-correlation-mutation', fdrId: it.fdrId, baseRev: cur ? cur.rev : 0, actingPositionId: s.ownerPositionId, op }, { label: `f${f.id}|corr` });
      if (ack && ack.ok) f.bound = op.kind === 'BindTrack';
      return;
    }
    const s = await this.knownStrip(it.facilityId, it.stripId);
    if (!s || s.dropped) return;
    const client = this.clientForPosition(s.ownerPositionId);
    if (!client) return;
    if (it.op.kind === 'InvokeNla' && it.doubleTap) {
      const before = { state: s.state, rev: s.rev };
      const ack = await this.send(client, { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: s.ownerPositionId, stripId: it.stripId, baseRev: s.rev, op: { kind: 'InvokeNla' } }, { label: `f${f.id}|doubletap` });
      if (ack && ack.ok) {
        if (ack.strip.state === before.state && ack.strip.rev === before.rev) this.stats.doubleTapNoop++;
        else { this.stats.doubleTapNotGuarded++; this.event('doubleTapNotGuarded', { before, after: { state: ack.strip.state, rev: ack.strip.rev } }); }
      }
      return;
    }
    const op = it.op.kind === 'MoveStrip' ? await this._sameBayMove(it.facilityId, s) : it.op;
    if (!op) return;
    const ack = await this.send(client, { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: s.ownerPositionId, stripId: it.stripId, baseRev: s.rev, op }, { label: `f${f.id}|edit` });
    if (ack && ack.ok) {
      this.onStrip(f, it.facilityId, ack.strip);
      if (op.kind === 'Undo') this.stats.undo++;
      if (op.kind === 'SetBlock' && op.blockId === '21') this.sky.assignAltitude(f.id, op.value);
    }
  }

  async _sameBayMove(fid, s) {
    const r = await this.call('rack', { facilityId: fid, bayId: s.bayId, rackId: s.rackId });
    const others = r.rack.filter(x => x.stripId !== s.stripId);
    if (!others.length) return null;
    const i = this.rng.int(-1, others.length - 1);
    return { kind: 'MoveStrip', bayId: s.bayId, rackId: s.rackId, afterStripId: i >= 0 ? others[i].stripId : null, beforeStripId: i + 1 < others.length ? others[i + 1].stripId : null };
  }

  /** Intermediate edits on the way through (briefing §5.2), queued after a successful step. */
  queueEdits(f, fid, strip, nlaBefore) {
    if (!strip || strip.state === 'DROPPED') return;
    const r = this.rng;
    const sid = strip.stripId;
    const stateOnlyNla = nlaBefore && strip.ownerPositionId === nlaBefore.owner && strip.state !== nlaBefore.state;
    if (stateOnlyNla && r.chance(0.01)) { f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'InvokeNla' }, doubleTap: true }); return; }
    if (stateOnlyNla && r.chance(0.01)) f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'Undo' } });
    const clearance = strip.role !== 'MISSION';
    if (clearance && r.chance(0.05)) f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'SetBlock', blockId: '21', value: `FL${r.int(12, 36)}0` } });
    if (clearance && r.chance(0.03)) f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'SetBlock', blockId: '20', value: String(r.int(1, 36) * 10).padStart(3, '0') } });
    if (r.chance(0.05)) f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'SetFlag', flag: r.pick(['highlight', 'attention']), value: r.chance(0.5) } });
    if (r.chance(0.03)) f.queue.push({ kind: 'op', edit: true, facilityId: fid, stripId: sid, op: { kind: 'MoveStrip' } });
    if (f.fdr && this.sky.trackIdOf(f.id) && r.chance(0.02)) {
      f.queue.push({ kind: 'correlation', edit: true, facilityId: fid, stripId: sid, fdrId: f.fdr.fdrId, op: { kind: f.bound && r.chance(0.5) ? 'UnbindTrack' : 'BindTrack' } });
    }
    if (f.storm && !f.storm.done && r.chance(0.5)) {
      f.storm.done = true;
      f.queue.push({ kind: 'storm', edit: true, facilityId: fid, stripId: sid, moves: f.storm.moves, pattern: f.storm.pattern });
    }
    // Edits run before the next step; a step whose own intent is pending
    // (not a walk) picks them up in stepFlight().
  }

  /**
   * One move of a reorder storm (briefing §5.2, the WP8 order-key bullet). The
   * storm re-queues itself at the front until its moves are spent, so every
   * move is its own event a second or two apart, like a controller dragging.
   */
  async stormMove(f, it) {
    if (!it.started) { it.started = true; this.stats.storms++; }
    if (it.moves <= 0) return;
    it.moves--;
    const s = await this.knownStrip(it.facilityId, it.stripId);
    if (!s || s.dropped) return;
    const client = this.clientForPosition(s.ownerPositionId);
    if (!client) return;
    const r = await this.call('rack', { facilityId: it.facilityId, bayId: s.bayId, rackId: s.rackId });
    const others = r.rack.filter(x => x.stripId !== s.stripId);
    if (others.length < 1) {
      // Nothing to reorder against yet: re-arm the storm for a later step.
      if (!it.movesDone) { const fl = f; fl.storm.done = false; this.stats.storms--; }
      return;
    }
    it.movesDone = (it.movesDone || 0) + 1;
    let mover = s; let op;
    if (it.pattern === 'ping-pong') {
      if (!it.partner) { const p = others.find(x => x.ownerPositionId === s.ownerPositionId); it.partner = p ? p.stripId : null; }
      if (!it.partner) it.pattern = 'same-slot';
    }
    if (it.pattern === 'top') {
      op = { kind: 'MoveStrip', bayId: s.bayId, rackId: s.rackId, afterStripId: null, beforeStripId: others[0].stripId };
    } else if (it.pattern === 'ping-pong') {
      it.flip = !it.flip;
      const moverId = it.flip ? s.stripId : it.partner;
      const anchorId = it.flip ? it.partner : s.stripId;
      const rest = r.rack.filter(x => x.stripId !== moverId);
      const ai = rest.findIndex(x => x.stripId === anchorId);
      if (ai < 0) return;
      mover = it.flip ? s : await this.knownStrip(it.facilityId, it.partner);
      if (!mover || mover.dropped || mover.ownerPositionId !== s.ownerPositionId) return;
      op = { kind: 'MoveStrip', bayId: s.bayId, rackId: s.rackId, afterStripId: anchorId, beforeStripId: rest[ai + 1] ? rest[ai + 1].stripId : null };
    } else {
      // same-slot: always right after the first Strip, so the gap halves every time.
      op = { kind: 'MoveStrip', bayId: s.bayId, rackId: s.rackId, afterStripId: others[0].stripId, beforeStripId: others[1] ? others[1].stripId : null };
    }
    await this.send(client, { version: 1, type: 'efsp-mutation', facilityId: it.facilityId, actingPositionId: mover.ownerPositionId, stripId: mover.stripId, baseRev: mover.rev, op }, { label: `f${f.id}|storm|${it.pattern}` });
    this.stats.stormMoves++;
    if (it.moves > 0) f.queue.unshift(it);
  }

  onStrip(f, fid, strip) {
    if (!strip) return;
    const airborne =
      (strip.role === 'DEPARTURE' && (strip.state === 'DEPARTED' || strip.state === 'HANDED_OFF')) ||
      (strip.role === 'ARRIVAL' && strip.state === 'INBOUND') ||
      (strip.role === 'OVERFLIGHT' && strip.state === 'TRANSITING') ||
      (strip.role === 'MISSION' && ['AIRBORNE', 'ON_STATION', 'OFF_STATION'].includes(strip.state));
    if (airborne && f.fdr) this.sky.spawn(f.id, f.fdr, this.now);
    if (strip.role === 'ARRIVAL' && (strip.state === 'LANDED' || strip.state === 'TAXI_IN')) this.sky.land(f.id, this.now);
  }

  async ensureRangeActive() {
    const a = this.airspaces.get('RANGE-SOUTH');
    if (a && a.state === 'ACTIVE') return;
    if (this.rangeActivation && this.now - this.rangeActivation < 10 * MIN) return;
    this.rangeActivation = this.now;
    const steps = [
      ['SOUTH_RANGE', { kind: 'ScheduleAirspace', fromUtc: this.now, toUtc: this.now + 6 * 60 * MIN }],
      ['SOUTH_RANGE', { kind: 'RequestActivation' }],
      ['APP', { kind: 'ApproveActivation' }],
    ];
    for (const [pos, op] of steps) {
      const client = this.clientForPosition(pos);
      if (!client) return;
      const cur = this.airspaces.get('RANGE-SOUTH');
      const ack = await this.send(client, { version: 1, type: 'efsp-airspace-mutation', airspaceId: 'RANGE-SOUTH', baseRev: cur ? cur.rev : 0, actingPositionId: pos, op }, { label: 'range' });
      if (!ack || !ack.ok) return;
    }
  }

  // ── janitor + checkpoint ───────────────────────────────────────────────

  async checkpoint() {
    const r = await this.call('truth');
    const truth = r.truth;
    this.lastTruth = truth;
    for (const [fid, t] of Object.entries(truth.facilities)) {
      for (const p of t.positions) this.positions.set(`${fid}|${p.positionId}`, p.primary);
    }
    let live = 0;
    for (const t of Object.values(truth.facilities)) live += t.strips.length;
    const ls = this.stats.liveStrips;
    ls.min = Math.min(ls.min, live); ls.max = Math.max(ls.max, live); ls.end = live;
    ls.series.push([Math.round((this.now - this.t0) / 1000), live]);

    // Convergence: only clients continuously connected since their last snapshot.
    for (const c of this.clients.values()) {
      if (!c.connected || !c.continuous || c.discard) continue;
      this.judgeShadow(c, truth, 'checkpoint');
    }
    await this.janitor(truth);
    await this.maybeProbeReconnect(truth);
  }

  judgeShadow(c, truth, where) {
    const diffs = c.shadow.diff(truth);
    const ss = this.stats.silentStaleness;
    const nowKeys = new Set();
    for (const d of diffs) {
      const k = `${c.id}|${d.facilityId}|${d.stripId}`;
      nowKeys.add(k);
      const sig = `${k}|${d.kind}|${d.truthRev}`;
      if (!ss.seen.has(k)) ss.seen.set(k, { since: this.now, sig });
      const entry = ss.seen.get(k);
      if (entry.counted === sig) continue;
      entry.counted = sig;
      const cause = this.uncarriedHints.get(`${d.facilityId}|${d.stripId}`) || 'UNKNOWN';
      ss.count++;
      ss.byCause[cause] = (ss.byCause[cause] || 0) + 1;
      const ex = { client: c.id, where, ...d, cause };
      if (ss.examples.length < 20) ss.examples.push(ex);
      this.event('silentStaleness', ex);
    }
    for (const [k, e] of ss.seen) {
      if (!k.startsWith(`${c.id}|`) || nowKeys.has(k)) continue;
      ss.maxPersistMs = Math.max(ss.maxPersistMs, this.now - e.since);
      ss.seen.delete(k);
    }
    return diffs;
  }

  async janitor(truth) {
    const fails = this.stats.janitorFails;
    const liveIds = new Set();
    for (const [fid, t] of Object.entries(truth.facilities)) {
      for (const s of t.strips) {
        liveIds.add(s.stripId);
        this._learnStrip(fid, s);
        const fl = this.flights.get(this.stripFlight.get(s.stripId));
        if (fl && !fl.done) continue;
        const client = this.clientForPosition(s.ownerPositionId);
        if (!client) continue;
        let op = { kind: 'DropStrip', reason: 'soak janitor' };
        const prevFail = fails.get(s.stripId);
        if (prevFail && /open coordination proposal/.test(prevFail.detail || '') && s.coord && s.coord.state === 'PROPOSED') op = { kind: s.coord.primitive, action: 'REJECT' };
        else if (prevFail && /open TOFI proposal/.test(prevFail.detail || '')) op = { kind: 'TOFI', action: 'REJECT' };
        const ack = await this.send(client, { version: 1, type: 'efsp-mutation', facilityId: fid, actingPositionId: s.ownerPositionId, stripId: s.stripId, baseRev: s.rev, op }, { label: 'janitor' });
        if (ack && ack.ok && ack.strip && ack.strip.state === 'DROPPED') { this.stats.janitorDrops++; fails.delete(s.stripId); continue; }
        if (ack && ack.ok) continue; // a REJECT that unblocked the next pass
        const n = (prevFail ? prevFail.n : 0) + 1;
        fails.set(s.stripId, { n, reason: ack ? ack.reason : 'LOST', detail: ack ? ack.detail : null, facilityId: fid });
        if (n >= 3 && !this.stats.orphans.has(s.stripId)) {
          this.stats.orphans.set(s.stripId, { facilityId: fid, state: s.state, role: s.role, owner: s.ownerPositionId, reason: ack ? ack.reason : 'LOST', detail: ack ? ack.detail : null, tofi: s.tofi, coord: s.coord });
          this.event('orphan', { stripId: s.stripId, facilityId: fid, state: s.state, role: s.role, reason: ack && ack.reason, detail: ack && ack.detail });
        }
      }
    }
    for (const id of [...fails.keys()]) if (!liveIds.has(id)) fails.delete(id);
    for (const id of [...this.stats.orphans.keys()]) if (!liveIds.has(id)) this.stats.orphans.get(id).resolved = true;
  }

  // ── connections ────────────────────────────────────────────────────────

  async connect(c, { discard = false } = {}) {
    c.discard = discard;
    const r = await this.call('connect', { clientId: c.id, user: c.user });
    c.connected = true; c.declared = false;
    this.note(`connect|${c.id}|${discard}`);
    this.deliver(r.out);
  }

  async declare(c) {
    if (c.passive) { c.declared = true; return; }
    for (const [fid, held] of Object.entries(c.holds)) {
      const { facts } = await this.send(c, { type: 'efsp-set-positions', facilityId: fid, held });
      const acks = facts.acks.get(`positions:${fid}`) || [];
      if (acks.length !== 1) { this.ledger.lost++; this.event('lost', { type: 'efsp-set-positions', client: c.id, facilityId: fid }); }
    }
    c.declared = true;
  }

  /** H41-style Observer auto-promotion (position-store.js:_release abrupt) can leave a returning controller as an Observer. Put the crew back the way it was declared. */
  async restorePrimaries() {
    for (const c of this.clients.values()) {
      if (c.observer || c.passive || !c.connected) continue;
      for (const [fid, held] of Object.entries(c.holds)) {
        const wrong = held.filter(p => this.positions.get(`${fid}|${p}`) !== c.id);
        if (!wrong.length) continue;
        for (const o of this.clients.values()) {
          if (o === c || !o.connected) continue;
          const theirs = (o.holds[fid] || []);
          if (!wrong.some(p => this.positions.get(`${fid}|${p}`) === o.id)) continue;
          await this.send(o, { type: 'efsp-set-positions', facilityId: fid, held: [] });
          await this.send(c, { type: 'efsp-set-positions', facilityId: fid, held: [] });
          await this.send(c, { type: 'efsp-set-positions', facilityId: fid, held });
          await this.send(o, { type: 'efsp-set-positions', facilityId: fid, held: theirs });
        }
      }
    }
  }

  async disconnect(c, waitMs, opts = {}) {
    if (!c.connected) return;
    await this.call('close', { clientId: c.id });
    c.connected = false; c.declared = false; c.continuous = false;
    this.stats.disconnects++;
    this.note(`close|${c.id}`);
    this.event('disconnect', { client: c.id, waitSec: waitMs === null ? null : Math.round(waitMs / 1000) });
    if (waitMs !== null) this.after(waitMs, () => this.reconnect(c, opts), 'reconnect');
  }

  /**
   * Reconnect (briefing §5.6's two paths). Half the reconnects discard the
   * connect-time snapshot and rely on efsp-resync alone.
   */
  async reconnect(c, { discard = this.rngNet.chance(0.5), probe = false } = {}) {
    if (c.connected) return;
    const lastSeqs = new Map(c.shadow.boardSeq);
    const lastEpochs = new Map(c.shadow.boardEpoch);
    await this.connect(c, { discard });
    this.stats.reconnects++;
    const fids = c.passive ? FACILITIES : Object.keys(c.holds);
    const results = [];
    for (const fid of fids) {
      const lastBoardSeq = lastSeqs.get(fid);
      // The epoch echo (docs/adr/0081): without it every resync is a snapshot and the delta path goes untested.
      const r = await this.call('send', { clientId: c.id, msg: { type: 'efsp-resync', facilityId: fid, lastBoardSeq, boardEpoch: lastEpochs.get(fid) } });
      this.ledger.onSent({ type: 'efsp-resync' }, c.id, this.now, this.lifetime);
      this.note(`resync|${c.id}|${fid}`);
      const facts = this.deliver(r.out, { resyncFor: c.id });
      const ans = facts.resyncAnswer;
      if (!ans) { this.ledger.lost++; this.event('lost', { type: 'efsp-resync', client: c.id, facilityId: fid }); continue; }
      const path = ans.type === 'efsp-snapshot' ? 'snapshot' : 'delta';
      this.stats.resync[path]++;
      if (path === 'snapshot') { this._learnSnapshot(ans); c.shadow.applySnapshot(ans, fid); } else { this._learnDelta(ans); c.shadow.applyDelta(ans); }
      results.push({ fid, path, lastBoardSeq });
    }
    // The resync answer alone must leave the Board right.
    const t = (await this.call('truth')).truth;
    const diffs = c.shadow.diff(t, fids);
    if (diffs.length) {
      const byFid = {};
      for (const d of diffs) (byFid[d.facilityId] = byFid[d.facilityId] || []).push(d);
      for (const [fid, ds] of Object.entries(byFid)) {
        const res = results.find(x => x.fid === fid) || {};
        const ex = {
          client: c.id, facilityId: fid, discard, path: res.path, lastSeq: res.lastBoardSeq, currentSeqAtResync: t.facilities[fid].currentSeq,
          missing: ds.filter(d => d.kind === 'missing').length, stale: ds.filter(d => d.kind === 'stale').length, extra: ds.filter(d => d.kind === 'extra').length,
        };
        if (probe) {
          this.stats.resync.acrossRestartDivergence.count++;
          if (this.stats.resync.acrossRestartDivergence.examples.length < 10) this.stats.resync.acrossRestartDivergence.examples.push(ex);
          this.event('resyncAcrossRestartDivergence', ex);
        } else {
          this.stats.resync.resyncDivergence++;
          const causes = {};
          for (const d of ds) { const cz = this.uncarriedHints.get(`${d.facilityId}|${d.stripId}`) || 'UNKNOWN'; causes[cz] = (causes[cz] || 0) + 1; }
          ex.causes = causes;
          const rb = this.stats.resync.divergenceByCause || (this.stats.resync.divergenceByCause = {});
          for (const [cz, n] of Object.entries(causes)) rb[cz] = (rb[cz] || 0) + n;
          if (this.stats.resync.divergenceExamples.length < 10) this.stats.resync.divergenceExamples.push({ ...ex, sample: ds.slice(0, 3) });
          this.event('resyncDivergence', { ...ex, sample: ds.slice(0, 3) });
        }
      }
    }
    // Leave the client correct (a real client would take a snapshot now) and carry on.
    if (diffs.length || discard) {
      const snap = (await this.call('send', { clientId: c.id, msg: { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: -1 } }));
      const facts = this.deliver(snap.out, { resyncFor: c.id });
      if (facts.resyncAnswer) { c.shadow.applySnapshot(facts.resyncAnswer); this._learnSnapshot(facts.resyncAnswer); }
    }
    c.discard = false;
    c.continuous = true;
    if (probe) { this.stats.resync.acrossRestartDivergence.probes++; return; }
    await this.declare(c);
    await this.restorePrimaries();
    this.judgeShadow(c, (await this.call('truth')).truth, 'reconnect');
  }

  // ── H4 probe ───────────────────────────────────────────────────────────

  async maybeProbeReconnect(truth) {
    const p = this.clients.get('probe-h4');
    if (!p || p.connected || !this.probeArmed) return;
    const last = p.shadow.boardSeq.get('INCIRLIK');
    const cur = truth.facilities.INCIRLIK.currentSeq;
    if (this.lifetime > this.probeLifetime && cur > last) {
      this.probeArmed = false;
      await this.reconnect(p, { discard: true, probe: true });
    }
  }

  // ── restarts (R1, R2) ──────────────────────────────────────────────────

  async restart(idx) {
    this.stats.restarts++;
    const pre = (await this.call('truth')).truth;
    const oracleLive = [...this.oracle.values()].filter(o => !o.dropped && o.rev >= 0).map(o => ({ ...o }));

    // R2: one Mutation whose ack never arrives because the process dies.
    const r2 = await this.ambiguousSend(idx);
    if (!r2) await this.host.kill(); else await this.host.waitExit();
    for (const c of this.clients.values()) { c.connected = false; c.declared = false; c.continuous = false; }
    this.lifetime++;
    this.note(`restart|${idx}`);
    await this.host.start(this.now);
    const post = (await this.call('truth')).truth;
    // The server's truth after a restart replaces what the driver knew.
    for (const [fid, t] of Object.entries(post.facilities)) {
      for (const s2 of t.strips) this.oracle.set(`${fid}|${s2.stripId}`, { ...s2, facilityId: fid, dropped: false, coordination: s2.coord, tofiCoordination: s2.tofi });
      for (const p of t.positions) this.positions.set(`${fid}|${p.positionId}`, p.primary);
    }
    for (const [k, o] of this.oracle) if (!o.dropped && !post.facilities[o.facilityId].strips.some(x => x.stripId === o.stripId)) this.oracle.set(k, { ...o, dropped: true });
    this.lastNla.clear();

    // R1: nothing that was on the Board before the kill may be missing or older after it.
    const exclude = new Set(r2 && r2.stripIds ? r2.stripIds : []);
    const postIdx = new Map();
    for (const [fid, t] of Object.entries(post.facilities)) for (const s of t.strips) postIdx.set(`${fid}|${s.stripId}`, s);
    for (const [fid, t] of Object.entries(pre.facilities)) {
      for (const s of t.strips) {
        if (exclude.has(s.stripId)) continue;
        const q = postIdx.get(`${fid}|${s.stripId}`);
        const bad = !q ? 'missing' : q.rev < s.rev ? 'older' : null;
        const diff = q ? ['state', 'ownerPositionId', 'bayId', 'rackId', 'orderKey', 'role', 'fdrId'].filter(k => q[k] !== s[k]) : [];
        if (bad || (q && q.rev === s.rev && diff.length)) {
          this.stats.restart.boardLostOnRestart++;
          const ex = { facilityId: fid, stripId: s.stripId, kind: bad || 'changed', preRev: s.rev, postRev: q ? q.rev : null, fields: diff, cause: this.uncarriedHints.get(`${fid}|${s.stripId}`) || null };
          if (this.stats.restart.lostExamples.length < 20) this.stats.restart.lostExamples.push(ex);
          this.event('boardLostOnRestart', ex);
        }
      }
    }
    for (const o of oracleLive) {
      if (exclude.has(o.stripId)) continue;
      const q = postIdx.get(`${o.facilityId}|${o.stripId}`);
      if (!q) continue; // a Strip dropped before the kill whose drop the oracle missed shows up above if it mattered
      if (q.rev < o.rev) this.stats.restart.oracleOlder++;
      else if (q.rev > o.rev) this.stats.restart.oracleNewer++;
    }
    this.stats.restart.restartDiffs.push({ idx, preLive: countLive(pre), postLive: countLive(post), preSeq: pre.facilities.INCIRLIK.currentSeq, postSeq: post.facilities.INCIRLIK.currentSeq });

    // Everyone reconnects (the probe stays away until the new seq overtakes it).
    for (const c of this.clients.values()) {
      if (c.id === 'probe-h4' && this.probeArmed) continue;
      await this.connect(c);
      await this.declare(c);
    }
    await this.restorePrimaries();
    // The selfcheck leak lives in the host process; a new process starts it again.
    if (this.o.inject === 'leak') await this.call('inject', { fault: 'leak' });
    if (r2) await this.classifyR2(r2);
  }

  /** R2 (briefing §5.5): send one Mutation and let the host die before its ack. Alternates CreateStrip and a Strip op. */
  async ambiguousSend(idx) {
    const createFirst = idx % 2 === 0;
    if (createFirst) {
      const client = this.clientForPosition('OPS');
      if (!client) return null;
      const f = { id: `r2-${idx}`, callsign: `RTWO${idx}` };
      const msg = { version: 1, type: 'efsp-mutation', clientMutationId: this.nextCmid(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: f.callsign, aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' } } };
      this.ledger.r2.add(msg.clientMutationId);
      this.ledger.onSent(msg, client.id, this.now, this.lifetime);
      this.note(`r2|create`);
      // Mode A: applied and persisted, then the process dies before the ack.
      await this.host.call({ type: 'send', now: this.now, clientId: client.id, msg, dieAfter: true }).catch(e => { if (!e.hostExit) throw e; });
      return { mode: 'dieAfterApply', op: 'CreateStrip', msg, client: client.id, callsign: f.callsign };
    }
    // Mode B: a Strip op whose audit line is written but whose snapshot write is lost.
    const live = [...this.oracle.values()].filter(o => !o.dropped && o.rev >= 0 && this.clientForPosition(o.ownerPositionId));
    const target = live.length ? live[this.rng.int(0, live.length - 1)] : null;
    if (!target) return null;
    const s = await this.refreshStrip(target.facilityId, target.stripId);
    if (!s || s.dropped) return null;
    const client = this.clientForPosition(s.ownerPositionId);
    const msg = { version: 1, type: 'efsp-mutation', clientMutationId: this.nextCmid(), facilityId: s.facilityId, actingPositionId: s.ownerPositionId, stripId: s.stripId, baseRev: s.rev, op: { kind: 'SetFlag', flag: 'attention', value: true } };
    this.ledger.r2.add(msg.clientMutationId);
    this.ledger.onSent(msg, client.id, this.now, this.lifetime);
    this.note(`r2|strip-op`);
    await this.call('inject', { fault: 'crash-before-persist' });
    await this.host.call({ type: 'send', now: this.now, clientId: client.id, msg }).catch(e => { if (!e.hostExit) throw e; });
    return { mode: 'crashBeforePersist', op: 'SetFlag', msg, client: client.id, stripIds: [s.stripId], preRev: s.rev };
  }

  async classifyR2(r2) {
    const logPath = path.join(this.o.stateDir, 'mutations.jsonl');
    const before = await logLinesFor(logPath, r2.msg.clientMutationId);
    const linesBefore = before.length;
    const truthBefore = (await this.call('truth')).truth;
    let restoredHasIt = null;
    if (r2.op === 'CreateStrip') {
      const ids = new Set(before.map(l => l.stripId));
      restoredHasIt = truthBefore.facilities.INCIRLIK.strips.some(x => ids.has(x.stripId));
    } else {
      const s = truthBefore.facilities[r2.msg.facilityId].strips.find(x => x.stripId === r2.msg.stripId);
      restoredHasIt = !!(s && s.rev > r2.preRev);
    }
    const client = this.clients.get(r2.client);
    let replayAck = null;
    if (client && client.connected) replayAck = await this.send(client, JSON.parse(JSON.stringify(r2.msg)), { replay: true, label: 'R2' });
    const linesAfter = (await logLinesFor(logPath, r2.msg.clientMutationId)).length;
    let outcome;
    if (r2.op === 'CreateStrip') outcome = linesAfter >= 2 ? 'appliedTwice' : linesAfter === 1 ? 'appliedOnce' : 'lost';
    else outcome = linesBefore >= 1 && !restoredHasIt ? 'lost' : (linesAfter >= 2 ? 'appliedTwice' : 'appliedOnce');
    const res = { op: r2.op, mode: r2.mode, outcome, auditLinesBeforeReplay: linesBefore, auditLinesAfterReplay: linesAfter, restoredHasIt, replay: replayAck ? { ok: replayAck.ok, reason: replayAck.reason || null } : null };
    this.stats.restart.ambiguousReplay.push(res);
    this.event('ambiguousReplay', res);
    // The duplicate CreateStrip (if any) belongs to no flight: the janitor drops it.
  }

  // ── the run ────────────────────────────────────────────────────────────

  schedule() {
    const p = this.profile;
    const runMs = this.tEnd - this.t0;
    // Crew connects and declares at t0.
    this.at(this.t0, async () => {
      for (const c of this.clients.values()) { await this.connect(c); await this.declare(c); }
      await this.restorePrimaries();
    }, 'crew');
    // Flights: keep the live count near the profile's concurrency.
    const spawn = async () => {
      const active = [...this.flights.values()].filter(f => !f.done).length;
      if (active < p.concurrentFlights && this.now < this.tEnd - 2 * MIN) this.startFlight(this.rng.weighted(SCRIPT_WEIGHTS));
      this.after(this.rng.uniform(p.spawnCheckS[0], p.spawnCheckS[1]) * 1000, spawn, 'spawn');
    };
    this.at(this.t0 + 2000, spawn, 'spawn');
    // One tick command per virtual second carries whatever monitors are due (§3.8).
    let tickN = 0;
    const tick = async () => {
      tickN++;
      const what = ['reconcile', 'conformanceStca'];
      if (tickN % 5 === 0) what.push('expireTracks');
      if (tickN % 15 === 0) what.push('obligationsNla');
      if (tickN % 10 === 0) what.push('heartbeat');
      const r = await this.call('tick', { what });
      if (r.correlation) this._learnCorrelationStats(r.correlation);
      if (r.alerts) {
        if (r.alerts.stca > this.stats.alerts.stcaMax) this.stats.alerts.stcaMax = r.alerts.stca;
        if (r.alerts.stca > 0 && !this._stcaUp) this.stats.alerts.stcaRaised++;
        this._stcaUp = r.alerts.stca > 0;
        if (r.alerts.conformance > 0 && !this._confUp) this.stats.alerts.conformanceRaised++;
        this._confUp = r.alerts.conformance > 0;
      }
      this.deliver(r.out);
      this.after(1000, tick, 'tick');
    };
    this.at(this.t0 + 1000, tick, 'tick');
    // Tracks every 2 s.
    const tracks = async () => {
      const body = this.sky.step(this.now, 2000);
      if (body.upsert.length || body.remove.length) this.deliver((await this.call('tracks', body)).out);
      this.after(2000, tracks, 'tracks');
    };
    this.at(this.t0 + 1500, tracks, 'tracks');
    // Checkpoint + janitor every virtual minute.
    const cp = async () => { await this.checkpoint(); this.after(MIN, cp, 'checkpoint'); };
    this.at(this.t0 + MIN, cp, 'checkpoint');
    // Samples.
    const sample = async (heavy) => {
      const r = await this.call('sample', { heavy });
      this.recordSample(r.sample);
    };
    const lightLoop = async () => { await sample(false); this.after(this.o.lightMs, lightLoop, 'sample'); };
    const heavyLoop = async () => { await sample(true); this.after(this.o.heavyMs, heavyLoop, 'sample-heavy'); };
    this.at(this.t0 + 30000, lightLoop, 'sample');
    this.at(this.t0 + this.o.heavyMs, heavyLoop, 'sample-heavy');
    // Log reconciliation every 30 virtual minutes (early failure).
    const recon = async () => {
      const r = await this.ledger.reconcileLog(path.join(this.o.stateDir, 'mutations.jsonl'));
      this.event('logReconcile', { auditMissing: r.auditMissing, auditDuplicate: r.auditDuplicate, auditForRefusal: r.auditForRefusal, auditOrphan: r.auditOrphan, logLines: r.logLines });
      this.after(30 * MIN, recon, 'recon');
    };
    this.at(this.t0 + 30 * MIN, recon, 'recon');

    // Restarts: the profile's count, in the middle third, or pinned.
    const nRestarts = this.o.restarts !== null && this.o.restarts !== undefined ? this.o.restarts : p.restarts;
    const restartTimes = this.o.restartAt
      ? this.o.restartAt.map(m => this.t0 + m * MIN)
      : Array.from({ length: nRestarts }, (_, i) => this.t0 + runMs / 3 + (runMs / 3) * ((i + this.rngNet.uniform(0.1, 0.9)) / Math.max(1, nRestarts)));
    restartTimes.sort((a, b) => a - b).forEach((t, i) => {
      this.at(t, () => this.restart(i), 'restart');
    });
    // The H4 probe disconnects before the first restart and stays away across it.
    if (restartTimes.length) {
      const first = restartTimes[0];
      const at = this.t0 + (first - this.t0) * this.rngNet.uniform(0.2, 0.5);
      this.at(at, async () => {
        const probe = this.clients.get('probe-h4');
        this.probeArmed = true; this.probeLifetime = this.lifetime;
        await this.disconnect(probe, null);
      }, 'probe-away');
    }
    // Disconnects.
    const crew = [...this.clients.values()].filter(c => !c.passive);
    const scheduleDisconnect = (c, t) => this.at(t, async () => {
      if (!c.connected) return;
      const wait = this.rngNet.chance(0.7) ? this.rngNet.uniform(5000, 90000) : this.rngNet.uniform(5 * MIN, 25 * MIN);
      await this.disconnect(c, wait);
      if (p.disconnectMeanMin) scheduleDisconnect(c, this.now + this.rngNet.exp(p.disconnectMeanMin * MIN));
    }, 'disconnect');
    if (p.disconnectMeanMin) for (const c of crew) scheduleDisconnect(c, this.t0 + this.rngNet.exp(p.disconnectMeanMin * MIN));
    else for (let i = 0; i < (p.disconnectsInRun || 0); i++) scheduleDisconnect(this.rngNet.pick(crew), this.t0 + this.rngNet.uniform(0.1, 0.9) * runMs);
    // Mission reloads.
    const reload = async () => {
      this.sky.reloadAll();
      this.stats.missionReloads++;
      this.note('missionReload');
      this.deliver((await this.call('missionReload')).out);
    };
    if (p.reloadEveryMin) {
      const loop = async () => { await reload(); this.after(this.rngNet.exp(p.reloadEveryMin * MIN), loop, 'reload'); };
      this.at(this.t0 + this.rngNet.exp(p.reloadEveryMin * MIN), loop, 'reload');
    } else for (let i = 0; i < (p.reloadsInRun || 0); i++) this.at(this.t0 + this.rngNet.uniform(0.2, 0.8) * runMs, reload, 'reload');
    // Conflicts.
    const conflict = async () => {
      if (this.sky.injectConflict()) { this.stats.conflictsInjected++; this.note('conflict'); }
      this.after(this.rngNet.exp(60 / p.conflictsPerHour * MIN), conflict, 'conflict');
    };
    this.at(this.t0 + this.rngNet.exp(60 / p.conflictsPerHour * MIN), conflict, 'conflict');
    // Manning churn: CD vacated for a few minutes (SystemReassign to its covering Position).
    const churn = async () => {
      const c = [...this.clients.values()].find(x => x.connected && x.declared && (x.holds.INCIRLIK || []).includes('CD'));
      if (c && (c.holds.INCIRLIK || []).length > 1) {
        this.stats.manningChurn++;
        this.note(`churn|${c.id}`);
        await this.send(c, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: c.holds.INCIRLIK.filter(p2 => p2 !== 'CD') });
        this.after(this.rngNet.uniform(2 * MIN, 4 * MIN), async () => {
          if (c.connected && c.declared) await this.send(c, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: c.holds.INCIRLIK });
        }, 'churn-back');
      }
      this.after(this.rngNet.exp(60 / p.manningChurnPerHour * MIN), churn, 'churn');
    };
    this.at(this.t0 + this.rngNet.exp(60 / p.manningChurnPerHour * MIN), churn, 'churn');
    // Injected faults (selfcheck only).
    if (this.o.inject === 'drop-ack') this.at(this.t0 + runMs * 0.4, () => this.call('inject', { fault: 'drop-ack' }), 'inject');
    if (this.o.inject === 'drop-broadcast') this.at(this.t0 + runMs * 0.4, () => this.call('inject', { fault: 'drop-broadcast' }), 'inject');
    if (this.o.inject === 'leak') this.at(this.t0 + 1000, () => this.call('inject', { fault: 'leak' }), 'inject');
    if (this.o.pruneRetired) {
      const prune = async () => { const r = await this.call('prune'); this.event('prune', r.pruned); this.after(10 * MIN, prune, 'prune'); };
      this.at(this.t0 + 10 * MIN, prune, 'prune');
    }
  }

  recordSample(s) {
    const t = (this.now - this.t0) / 60000;
    const row = { tMin: Math.round(t * 1000) / 1000, heavy: s.heavy, gc: s.gc, mem: s.mem, counts: s.counts, orderKeys: s.orderKeys, correlation: { rate: s.correlation.rate, eligible: s.correlation.eligible, rebinds: s.correlation.rebinds }, snapshotBytes: s.snapshotBytes, boardFileBytes: s.boardFileBytes, mutationLogBytes: s.mutationLogBytes, persistBytes: s.persistBytes, lifetime: this.lifetime };
    this.timelineOut.write(JSON.stringify(row) + '\n');
    this.samples.push(row);
  }

  async run() {
    const wall0 = performance.now();
    await this.host.start();
    this.schedule();
    let lastProgress = performance.now();
    while (this.heap.size) {
      const ev = this.heap.pop();
      if (ev.t > this.tEnd) break;
      if (this.o.realtime) {
        const target = wall0 + (ev.t - this.t0);
        const wait = target - performance.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      if (ev.t > this.now) this.now = ev.t;
      await ev.fn();
      if (!this.o.quiet && performance.now() - lastProgress > 10000) {
        lastProgress = performance.now();
        process.stderr.write(`[soak] ${((this.now - this.t0) / 60000).toFixed(1)}/${this.o.minutes} virtual min, ${this.ledger.messagesSent} msgs, ${((performance.now() - wall0) / 1000).toFixed(0)}s wall\n`);
      }
    }
    this.now = this.tEnd;
    // Final: a checkpoint (convergence + janitor), a heavy sample, the log.
    await this.checkpoint();
    const r = await this.call('sample', { heavy: true });
    this.recordSample(r.sample);
    const consoleStats = (await this.call('console')).console;
    this.logRecon = await this.ledger.reconcileLog(path.join(this.o.stateDir, 'mutations.jsonl'));
    await this.host.shutdown();
    await new Promise(res => this.eventsOut.end(res));
    await new Promise(res => this.timelineOut.end(res));
    this.wallSeconds = (performance.now() - wall0) / 1000;
    this.consoleStats = consoleStats;
    this.trafficDigest = this.digest.digest('hex');
  }
}

function pushMap(m, k, v) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
function addOther(m, k, type) { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(type); }
function countLive(t) { let n = 0; for (const f of Object.values(t.facilities)) n += f.strips.length; return n; }

/** The audit lines one clientMutationId produced (streamed; there are at most a handful). */
async function logLinesFor(logPath, cmid) {
  const out = [];
  if (!fs.existsSync(logPath)) return out;
  const rl = readline.createInterface({ input: fs.createReadStream(logPath), crlfDelay: Infinity });
  const needle = `"clientMutationId":"${cmid}"`;
  for await (const line of rl) {
    if (!line.includes(needle)) continue;
    try { const e = JSON.parse(line); out.push({ stripId: e.stripId, op: e.op, afterRev: e.after && e.after.rev }); } catch { out.push({}); }
  }
  return out;
}


module.exports = { Driver, Heap };
