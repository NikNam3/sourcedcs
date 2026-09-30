'use strict';

// Driver-side handle on the host: a forked child over IPC (default) or the
// same host core in-process (--inproc, for debugging). Both expose
// call(cmd) -> Promise<reply>, kill(), restart() and shutdown().

const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { SRC } = require('./host-env');

/**
 * The airspace fixture (briefing §5.2): one MOA Center controls, and one RANGE
 * with its own using Position — copied from tests/efsp-scenarios.test.mjs so a
 * change to the shipped config/ cannot move the soak.
 */
const AIRSPACES = [
  {
    airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA',
    controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    workingFrequencyMhz: 134.25,
  },
  {
    airspaceId: 'RANGE-SOUTH', name: 'South A/G Range', type: 'RANGE',
    controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP',
    usingPositionId: 'SOUTH_RANGE', controlFrequencyMhz: 283.5,
  },
];

function writeFixtures(stateDir) {
  fs.mkdirSync(path.join(stateDir, 'config-empty'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'terrain'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'airspaces.json'), JSON.stringify(AIRSPACES, null, 2));
  fs.writeFileSync(path.join(stateDir, 'stereo-routes.json'), '[]');
  // The three facility overrides are deliberately NOT written: a missing file
  // makes facility-config fall back to its in-code DEFAULT_CONFIG, as the
  // tests rely on (briefing §3.6).
}

class ForkedHost {
  constructor({ stateDir, seed, startNow, logPath }) {
    this._args = [stateDir, String(seed), String(startNow), logPath];
    this._pending = new Map();
    this._nextId = 1;
    this.lifetime = 0;
    this.pid = null;
  }

  start(startNow) {
    if (startNow !== undefined) this._args[2] = String(startNow);
    this.lifetime++;
    return new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, 'host.js'), [...this._args, String(this.lifetime)], {
        execArgv: ['--expose-gc'],
        serialization: 'advanced',
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        cwd: path.join(SRC, '..'),
      });
      this._child = child;
      this.pid = child.pid;
      this._exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
      child.on('message', (m) => {
        if (m.id === 0) {
          if (m.fatal) reject(new Error(`soak host failed to start: ${m.fatal}`));
          else resolve();
          return;
        }
        const p = this._pending.get(m.id);
        if (!p) return;
        this._pending.delete(m.id);
        if (m.hostError) p.reject(new Error(`soak host error: ${m.hostError}`));
        else p.resolve(m);
      });
      child.once('exit', (code, signal) => {
        for (const p of this._pending.values()) p.reject(Object.assign(new Error(`soak host exited (${code ?? signal})`), { hostExit: true, signal }));
        this._pending.clear();
      });
    });
  }

  call(cmd) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._child.send({ ...cmd, id });
    });
  }

  /** SIGKILL now, without waiting on anything in flight. */
  async kill() {
    if (!this._child) return;
    try { this._child.kill('SIGKILL'); } catch { /* already gone */ }
    await this._exited;
  }

  /** Waits for the child to die on its own (after a dieAfter / crash-before-persist command). */
  async waitExit() { return this._exited; }

  async shutdown() {
    if (!this._child || this._child.exitCode !== null) return;
    await this.call({ type: 'shutdown', now: 0 }).catch(() => {});
    await this._exited;
  }
}

/** In-process: same host core, same env setup. Heap numbers then include the driver (T7). */
class InprocHost {
  constructor({ stateDir, seed, startNow, logPath }) {
    this._opts = { stateDir, seed, startNow, logPath };
    this.lifetime = 0;
    this.pid = process.pid;
    this._env = null;
  }

  start(startNow) {
    if (startNow !== undefined) this._opts.startNow = startNow;
    this.lifetime++;
    if (!this._env) {
      const { setupHostEnv } = require('./host-env');
      this._env = setupHostEnv(this._opts);
    } else {
      // A restart: fresh module state, as a new process would have.
      for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
      this._env.counters.crashBeforePersist = false;
      this._env.counters.crashed = false;
      this._env.seedIds(this.lifetime);
    }
    const { createHost } = require('./host-core');
    this._host = createHost(this._env, { stateDir: this._opts.stateDir });
    this._dead = false;
    return Promise.resolve();
  }

  call(cmd) {
    if (this._dead) return Promise.reject(Object.assign(new Error('soak host (inproc) is dead'), { hostExit: true }));
    try {
      const reply = this._host.handle(cmd);
      if (this._env.counters.crashed) { this._dead = true; return Promise.reject(Object.assign(new Error('soak host crashed before persist'), { hostExit: true })); }
      if (reply.died) { this._dead = true; return Promise.reject(Object.assign(new Error('soak host died'), { hostExit: true })); }
      return Promise.resolve(reply);
    } catch (err) {
      if (/simulated crash before persist/.test(String(err))) { this._dead = true; return Promise.reject(Object.assign(err, { hostExit: true })); }
      return Promise.reject(err);
    }
  }

  async kill() { this._dead = true; if (this._host) this._host.shutdown(); }
  async waitExit() { this._dead = true; return { code: null, signal: 'SIGKILL' }; }
  async shutdown() { if (this._host) this._host.shutdown(); if (this._env) this._env.closeLog(); }
}

module.exports = { ForkedHost, InprocHost, writeFixtures, AIRSPACES };
