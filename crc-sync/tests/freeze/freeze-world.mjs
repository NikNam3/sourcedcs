// A real createEfsp() behind the real WsHub with fake sockets, driven one command at a time and
// recorded step by step. Built on tools/soak/host-env.js + host-core.js (read only: required, never edited),
// which already do the hard parts: every state path into a temp dir, a virtual Date.now, seeded
// Math.random and crypto.randomUUID, the metrics tap, the monitors server.js wires, fake sockets.
//
// One world per PROCESS: setupHostEnv patches process globals and every src/ module reads its paths at
// require time, so freeze-hub.test.mjs runs each trace in its own child (freeze-hub-runner.mjs).
//
// A step records: the input, every efsp-* frame every socket received IN ORDER (summarised), the Mutation-log
// lines appended during the step, and the persisted Board file (sha1 of the raw body = key order included;
// the whole summarised state at checkpoints).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canonical, summarize, summarizeCollection, summarizeFinalState, digest } from './freeze-lib.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SOAK = path.resolve(HERE, '../../tools/soak');
export const SRC = path.resolve(HERE, '../../src');
export const START_NOW = Date.UTC(2026, 5, 21, 2, 40, 0);
const CHECKPOINT_EVERY = 25;

export class Recorder {
  constructor({ stateDir, startNow, full = true, checkpointEvery = CHECKPOINT_EVERY }) {
    this.stateDir = stateDir; this.startNow = startNow; this.now = startNow; this.full = full;
    this.checkpointEvery = checkpointEvery;
    this.boardPath = path.join(stateDir, 'board.json');
    this.logPath = path.join(stateDir, 'mutations.jsonl');
    this.logOffset = 0;
    this.steps = [];
    this.last = null;
  }
  _readLogTail() {
    let text = '';
    try { text = fs.readFileSync(this.logPath, 'utf8'); } catch { return []; }
    const fresh = text.slice(this.logOffset);
    this.logOffset = text.length;
    return fresh.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { unparsable: l.slice(0, 80) }; } });
  }

  _snap(checkpoint) {
    let st = null;
    try { st = fs.statSync(this.boardPath, { bigint: true }); } catch { return { file: null }; }
    // Every persist is write-tmp + rename, so the inode (and mtime) changes whenever the file does.
    const key = `${st.ino}:${st.mtimeNs}:${st.size}`;
    if (!checkpoint && this._snapKey === key) return this._snapOut;
    const raw = fs.readFileSync(this.boardPath, 'utf8');
    const out = { hash: digest(raw.replace(/"persistedWallAt":\d+/, '"persistedWallAt":0')), bytes: raw.length };
    this._snapKey = key; this._snapOut = out;
    if (checkpoint) {
      const body = JSON.parse(raw);
      return { ...out, keys: Object.keys(body), persistedWallAt: body.persistedWallAt - this.startNow, state: summarizeFinalState(canonical(body)) };
    }
    return out;
  }

  /**
   * efsp-* frames in socket order. A broadcast goes to every client one after another, so consecutive
   * identical frames are folded into { to: [clients], m: frame } with the order of the whole list kept.
   */
  _frames(out) {
    const groups = [];
    for (const [cid, payload] of out) {
      if (payload.indexOf('"type":"efsp-') < 0 || payload.indexOf('"type":"efsp-') > 30) continue;
      if (payload.startsWith('{"version":1,"type":"efsp-heartbeat"')) continue;
      const msg = JSON.parse(payload);
      let m;
      if (!this.full) m = `${msg.type}#${msg.boardSeq === undefined ? '' : msg.boardSeq} h=${digest(canonical(msg))}`;
      else if (msg.type === 'efsp-snapshot') m = this._snapshotView(msg);
      else m = summarize(msg);
      const prev = groups[groups.length - 1];
      if (prev && JSON.stringify(prev.m) === JSON.stringify(m)) prev.to.push(cid);
      else groups.push({ to: [cid], m });
    }
    return groups;
  }

  /** A connect-time snapshot: scalars verbatim, every collection as { n, h, rows }. */
  _snapshotView(msg) {
    const out = {};
    for (const k of Object.keys(msg).sort()) {
      const v = msg[k];
      if (Array.isArray(v)) out[k] = summarizeCollection(v);
      else if (v && typeof v === 'object') out[k] = { h: digest(canonical(v)), keys: Object.keys(v).sort().slice(0, 12) };
      else out[k] = canonical(v);
    }
    return out;
  }

  _record(input, reply, forceCheckpoint = false) {
    const i = this.steps.length;
    const checkpoint = forceCheckpoint || (i + 1) % this.checkpointEvery === 0;
    const log = this._readLogTail();
    const step = { i, t: this.now - this.startNow, ...input };
    step.frames = this._frames(reply.out || []);
    if (reply.uncarried) step.uncarried = canonical(reply.uncarried);
    if (log.length) step.log = this.full ? summarize(log) : log.map(e => `${e.op || '?'} ${e.stripId || ''} h=${digest(canonical(e))}`);
    step.snap = this._snap(checkpoint);
    this.steps.push(step);
    this.last = { reply, frames: reply.out || [] };
    return step;
  }

}

export class World extends Recorder {
  constructor({ seed = 1, startNow = START_NOW, full = true, checkpointEvery } = {}) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-hub-'));
    super({ stateDir, startNow, full, ...(checkpointEvery ? { checkpointEvery } : {}) });
    const { writeFixtures } = require(path.join(SOAK, 'host-client.js'));
    writeFixtures(this.stateDir);
    const { setupHostEnv } = require(path.join(SOAK, 'host-env.js'));
    this.seed = seed;
    this.env = setupHostEnv({ stateDir: this.stateDir, seed, startNow, lifetime: 1 });
    this.lifetime = 1;
    this.cmid = 0;
    this.clients = new Map(); // id -> { user, holds }
    this._boot();
  }

  _boot() {
    const { createHost } = require(path.join(SOAK, 'host-core.js'));
    this.host = createHost(this.env, { stateDir: this.stateDir });
  }

  /** Recreate everything as a new process would: purge src/, re-seed ids, build a fresh host that restores from disk. */
  restart() {
    this.host.shutdown();
    for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
    this.env.counters.crashBeforePersist = false;
    this.env.counters.crashed = false;
    this.lifetime += 1;
    this.env.seedIds(this.lifetime);
    this._boot();
    for (const c of this.clients.values()) c.connected = false;
    this._record({ act: 'restart', lifetime: this.lifetime }, { out: [] }, true);
  }

  // ---- primitives --------------------------------------------------------

  _call(cmd) { return this.host.handle({ ...cmd, now: this.now }); }

  advance(ms) { this.now += ms; }

  connect(id, { holds = {}, observer = false } = {}) {
    const user = { name: id, sub: id };
    this.clients.set(id, { user, holds, connected: true });
    const reply = this._call({ type: 'connect', clientId: id, user });
    this._record({ act: 'connect', as: id }, reply);
    for (const [facilityId, held] of Object.entries(holds)) {
      this.send(id, { type: 'efsp-set-positions', facilityId, held });
    }
  }

  close(id) {
    const reply = this._call({ type: 'close', clientId: id });
    this._record({ act: 'close', as: id }, reply);
  }

  reconnect(id) {
    const c = this.clients.get(id);
    this.close(id);
    this.connect(id, { holds: c.holds });
  }

  /** Send one wire message as client `id`; returns { acks: [parsed frames addressed to the sender], frames: [[cid, parsed]] }. */
  send(id, msg, label) {
    const reply = this._call({ type: 'send', clientId: id, msg });
    const input = { act: 'send', as: id, in: summarize(msg) };
    if (label) input.label = label;
    this._record(input, reply);
    const frames = (reply.out || []).filter(([, p]) => p.indexOf('"type":"efsp-') >= 0 && p.indexOf('"type":"efsp-') <= 30).map(([cid, p]) => [cid, JSON.parse(p)]);
    const acks = frames.filter(([cid, m]) => cid === id && /-(ack|result)$/.test(m.type)).map(([, m]) => m);
    return { acks, ack: acks[0] || null, frames };
  }

  tick(what) {
    const reply = this._call({ type: 'tick', what });
    this._record({ act: 'tick', what }, reply);
    return reply;
  }

  tracks(spec) {
    const reply = this._call({ type: 'tracks', ...spec });
    this._record({ act: 'tracks', n: (spec.upsert || []).length }, reply);
  }

  truth() { return this._call({ type: 'truth' }).truth; }

  strip(facilityId, stripId) { return this._call({ type: 'strip', facilityId, stripId }).strip; }

  /** The next fault: the next persist throws, as a crash between audit and persist would leave the Board. */
  crashBeforeNextPersist() { this.env.counters.crashBeforePersist = true; }

  nextCmid() { this.cmid += 1; return `freeze-cmid-${String(this.cmid).padStart(5, '0')}`; }

  // ---- wire builders -----------------------------------------------------

  /** efsp-mutation. `strip` is a live strip ({stripId, rev}) or null; `rev` overrides baseRev (stale probes). */
  mut(id, facilityId, acting, strip, op, { rev, cmid, stripId } = {}) {
    return this.send(id, {
      version: 1, type: 'efsp-mutation', clientMutationId: cmid || this.nextCmid(), facilityId, actingPositionId: acting,
      stripId: stripId !== undefined ? stripId : (strip ? strip.stripId : undefined),
      baseRev: rev !== undefined ? rev : (strip ? strip.rev : undefined), op,
    }, op.kind + (op.action ? `/${op.action}` : ''));
  }

  family(id, type, extra) {
    return this.send(id, { version: 1, type, clientMutationId: this.nextCmid(), ...extra }, extra.op ? extra.op.kind : type);
  }

  airspace(id, acting, airspaceId, op) {
    const cur = this.truth().airspaces.find(a => a.airspaceId === airspaceId);
    return this.family(id, 'efsp-airspace-mutation', { airspaceId, baseRev: cur ? cur.rev : 0, actingPositionId: acting, op });
  }

  /** Live (compact) strip after an ack: refresh rev from the server so the next op is not stale. */
  live(facilityId, stripId) { return this.strip(facilityId, stripId); }

  finish() {
    // Final checkpoint: the last step's snapshot, in full.
    const last = this.steps[this.steps.length - 1];
    if (last) last.snap = this._snap(true);
    const out = { seed: this.seed, steps: this.steps, consoleCounters: { internalErrors: this.env.counters.internalErrors, storeInternalErrors: this.env.counters.storeInternalErrors } };
    return out;
  }

  dispose() { this.host.shutdown(); this.env.closeLog(); }
}

export const uid = (n) => crypto.createHash('sha1').update(String(n)).digest('hex').slice(0, 8);
