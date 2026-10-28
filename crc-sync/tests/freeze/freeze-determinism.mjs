// Pins everything nondeterministic in the process that imports it: crypto.randomUUID (counter),
// Math.random (seeded), Date.now (a fixed virtual instant that moves only when a collapsed
// setTimeout "waits"). Imported by freeze-recorder.mjs and by the table/round-trip tests.
import crypto from 'node:crypto';

export const BASE_WALL = Date.UTC(2026, 5, 21, 2, 40, 0);
let virtualNow = BASE_WALL;
Date.now = () => virtualNow;

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const wait = Number(ms) > 0 ? Number(ms) : 0;
  virtualNow += wait;
  return realSetTimeout(fn, 0, ...args);
};

let uuidCounter = 0;
export function resetDeterminism() { uuidCounter = 0; seed = SEED0; virtualNow = BASE_WALL; }
crypto.randomUUID = () => {
  uuidCounter += 1;
  const hex = uuidCounter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};
const SEED0 = 0x2545F491;
let seed = SEED0;
Math.random = () => { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

