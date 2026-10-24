'use strict';

// How much CPU and memory crc-sync itself uses (docs/adr/0141, H164 FT-Q6): process CPU, memory, event-loop delay, what
// each named ticker costs, and how many sessions and tracks it is carrying. Shown in the METRICS panel's Server section
// (the `serverResources` block of the `efsp-metrics` answer) and at GET /api/server/resources.
//
// Memory only, a short rolling window, nothing persisted. Sampled on the wall clock: every number here is a pure duration
// or a housekeeping fact about the process, never an EFSP time (ADR 0096). Durations are read from a monotonic clock
// (`hrNow`, performance.now), `sampledAt` from the injected wall clock.
//
// The window is a ring of slots, one per sample: a slot holds that sample's CPU, memory and event-loop reading and the
// ticker runs timed while it was open. A process that is never started (the soak host drives the tickers itself) never
// closes a slot, so its one open slot covers the whole run.

const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { readShipped, readLayer } = require('./tuning-file');
const { WALL_CLOCK } = require('./mission-clock');

const NAME = 'server-resources.json';
const MB = 1024 * 1024;

/** config/server-resources.json, with a state/ copy layered key by key. Read once at startup, never written. */
function loadServerResourcesConfig(override) {
  const shipped = readShipped(NAME);
  const layer = readLayer(NAME, override, shipped) || {};
  const merged = { ...shipped, ...layer, warn: { ...shipped.warn, ...(layer.warn || {}) } };
  const positive = (v) => Number.isFinite(v) && v > 0;
  if (!positive(merged.sampleMs)) throw new Error(`[tuning] ${NAME}: sampleMs must be a number of milliseconds > 0`);
  if (!positive(merged.windowMs) || merged.windowMs < merged.sampleMs) throw new Error(`[tuning] ${NAME}: windowMs must be a number of milliseconds >= sampleMs`);
  for (const k of ['cpuPct', 'eventLoopP99Ms', 'rssMb', 'tickMaxMs']) {
    if (!positive(merged.warn[k])) throw new Error(`[tuning] ${NAME}: warn.${k} must be a number > 0`);
  }
  const { cpuPct, eventLoopP99Ms, rssMb, tickMaxMs } = merged.warn;
  return { sampleMs: merged.sampleMs, windowMs: merged.windowMs, warn: { cpuPct, eventLoopP99Ms, rssMb, tickMaxMs } };
}

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The histogram's sampling timer period. Node records the whole interval between two of its ticks, not the lateness
// (an idle loop reads ~10 ms at resolution 10, ~1 ms at 1), so the period is taken off every reading.
const LOOP_RESOLUTION_MS = 10;
const lateMs = (ns) => (Number.isFinite(ns) ? Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS) : null);

/** The process's own event-loop delay histogram (perf_hooks), read and reset once per sample. */
function defaultEventLoop() {
  const h = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  return {
    enable: () => h.enable(),
    disable: () => h.disable(),
    /** This sample's reading in ms, or null when the loop was not observed; resets the histogram. */
    take() {
      const out = h.count > 0 ? { p50Ms: lateMs(h.percentile(50)), p99Ms: lateMs(h.percentile(99)), maxMs: lateMs(h.max) } : null;
      h.reset();
      return out;
    },
  };
}

/**
 * @param {object} [d]
 * @param {{sampleMs:number, windowMs:number, warn:object}} [d.config] default config/server-resources.json
 * @param {() => {sessions:number, tracks:number}} [d.counts] what the service is carrying right now
 * @param {{now:()=>number}} [d.wallClock] for `sampledAt`
 * @param {() => number} [d.hrNow] monotonic ms, for every duration
 * @param {(prev?:object) => {user:number, system:number}} [d.cpuUsage] process.cpuUsage
 * @param {() => {rss:number, heapUsed:number, heapTotal:number, external:number}} [d.memoryUsage] process.memoryUsage
 * @param {{enable:Function, disable:Function, take:Function}} [d.eventLoop] the event-loop delay reader
 */
function createServerResources({
  config = loadServerResourcesConfig(), counts = () => ({ sessions: 0, tracks: 0 }), wallClock = WALL_CLOCK,
  hrNow = () => performance.now(), cpuUsage = (prev) => process.cpuUsage(prev), memoryUsage = () => process.memoryUsage(),
  eventLoop = defaultEventLoop(),
} = {}) {
  const maxSlots = Math.max(1, Math.round(config.windowMs / config.sampleMs));
  const periods = new Map(); // ticker name -> periodMs
  const slots = [];          // closed slots, oldest first
  let open = { startHr: hrNow(), ticks: new Map() };
  let cpuMark = { hr: open.startHr, usage: cpuUsage() };
  let timer = null;

  /** Times one run of a named ticker into the open slot. Errors pass through unchanged (a throwing tick still throws). */
  function time(name, fn, periodMs) {
    if (Number.isFinite(periodMs)) periods.set(name, periodMs);
    const t0 = hrNow();
    try {
      return fn();
    } finally {
      const ms = hrNow() - t0;
      let s = open.ticks.get(name);
      if (!s) { s = { runs: 0, totalMs: 0, maxMs: 0 }; open.ticks.set(name, s); }
      s.runs += 1;
      s.totalMs += ms;
      if (ms > s.maxMs) s.maxMs = ms;
    }
  }

  /** `{name, periodMs, tick}` → the same ticker, its tick timed. */
  function timed(ticker) {
    return { ...ticker, tick: () => time(ticker.name, ticker.tick, ticker.periodMs) };
  }

  /** Closes the open slot with this sample's process readings and opens the next. */
  function sample() {
    const hr = hrNow();
    const usage = cpuUsage();
    const elapsedUs = (hr - cpuMark.hr) * 1000;
    const cpuUs = (usage.user - cpuMark.usage.user) + (usage.system - cpuMark.usage.system);
    const mem = memoryUsage();
    slots.push({
      ...open,
      endHr: hr,
      cpuPct: elapsedUs > 0 ? (cpuUs / elapsedUs) * 100 : null,
      mem: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
      loop: eventLoop.take(),
    });
    while (slots.length > maxSlots) slots.shift();
    cpuMark = { hr, usage };
    open = { startHr: hr, ticks: new Map() };
  }

  function start() {
    if (timer) return;
    eventLoop.enable();
    timer = setInterval(sample, config.sampleMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    eventLoop.disable();
  }

  /** The window as the wire and the HTTP route carry it. Pure read. */
  function snapshot() {
    const now = hrNow();
    const firstHr = slots.length ? slots[0].startHr : open.startHr;
    const coveredMs = now - firstHr;
    const cpus = slots.map(s => s.cpuPct).filter(Number.isFinite);
    const last = slots.length ? slots[slots.length - 1].mem : null;
    const loops = slots.map(s => s.loop).filter(Boolean);

    const byName = new Map();
    for (const slot of [...slots, open]) {
      for (const [name, s] of slot.ticks) {
        const t = byName.get(name) || { runs: 0, totalMs: 0, maxMs: 0 };
        t.runs += s.runs;
        t.totalMs += s.totalMs;
        t.maxMs = Math.max(t.maxMs, s.maxMs);
        byName.set(name, t);
      }
    }
    const tickers = [...byName].map(([name, t]) => ({
      name,
      periodMs: periods.has(name) ? periods.get(name) : null,
      runs: t.runs,
      meanMs: r1(t.totalMs / t.runs),
      maxMs: r1(t.maxMs),
      busyPct: coveredMs > 0 ? r1((t.totalMs / coveredMs) * 100) : null,
    })).sort((a, b) => (b.busyPct ?? 0) - (a.busyPct ?? 0) || b.maxMs - a.maxMs || (a.name < b.name ? -1 : 1));

    const cpu = cpus.length ? { pct: r1(cpus.reduce((a, b) => a + b, 0) / cpus.length), maxPct: r1(Math.max(...cpus)) } : null;
    const memory = last ? { rssMb: r1(last.rss / MB), heapUsedMb: r1(last.heapUsed / MB), heapTotalMb: r1(last.heapTotal / MB), externalMb: r1(last.external / MB) } : null;
    // p99 is the worst sample's p99 in the window: a bad few seconds is not averaged away.
    const loop = loops.length ? {
      p50Ms: r1(median(loops.map(l => l.p50Ms))),
      p99Ms: r1(Math.max(...loops.map(l => l.p99Ms))),
      maxMs: r1(Math.max(...loops.map(l => l.maxMs))),
    } : null;
    const c = counts() || {};
    const w = config.warn;
    return {
      sampledAt: wallClock.now(),
      windowMs: Math.round(coveredMs),
      samples: slots.length,
      cpu,
      memory,
      eventLoop: loop,
      tickers,
      sessions: Number.isFinite(c.sessions) ? c.sessions : null,
      tracks: Number.isFinite(c.tracks) ? c.tracks : null,
      thresholds: { ...w },
      warn: {
        cpu: !!cpu && cpu.pct > w.cpuPct,
        eventLoop: !!loop && loop.p99Ms > w.eventLoopP99Ms,
        memory: !!memory && memory.rssMb > w.rssMb,
        tickers: tickers.filter(t => t.maxMs > w.tickMaxMs).map(t => t.name),
      },
    };
  }

  return { time, timed, sample, start, stop, snapshot };
}

module.exports = { createServerResources, loadServerResourcesConfig };
