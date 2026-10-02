// S-RENA1 proof, step 2: drop-in freeze-lib.mjs for a scratch copy of the renamed crc-sync. It is the BASE
// freeze-lib (copied next to it as freeze-lib-old.mjs) with every input first mapped back to the old
// vocabulary by the inverse of rename-map §7 (inverse.json, from build_inverse.py). Recording the renamed
// tree's traces through it with UPDATE_GOLDEN=1 writes what the BASE harness would have written if the
// rename were pure; compare_inverse.py then compares that with the base goldens.
import fs from 'node:fs';
import * as old from './freeze-lib-old.mjs';
const INV = JSON.parse(fs.readFileSync(process.env.RENAME_INVERSE, 'utf8'));
const OLD = new Set(INV.oldTokens);
const TWO = [...INV.two].sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PARTS = INV.parts.map(([n, o]) => [new RegExp(`(?:(?<=[-_:])${esc(n)}(?=$|[-_:])|^${esc(n)}(?=[-_:]))`, 'g'), o]);
function invToken(t) {
  if (OLD.has(t)) return t;                                  // the base already had this token: never rewrite it
  if (Object.prototype.hasOwnProperty.call(INV.exact, t)) return INV.exact[t];
  for (const [n, o] of INV.stems) if (t.includes(n)) return t.split(n).join(o);
  let out = t;
  for (const [rx, o] of PARTS) out = out.replace(rx, o);
  return out;
}
export function invString(s) {
  for (const [n, o] of TWO) s = s.split(n).join(o);
  return s.replace(/[A-Za-z0-9_$-]+/g, invToken);
}
export function invDeep(v) {
  if (typeof v === 'string') return invString(v);
  if (Array.isArray(v)) return v.map(invDeep);
  if (v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set)) {
    const o = {};
    for (const k of Object.keys(v)) o[invString(k)] = invDeep(v[k]);
    return o;
  }
  return v;
}
export const HERE = old.HERE, GOLDEN_DIR = old.GOLDEN_DIR, UPDATE = old.UPDATE;
export const digest = old.digest, serializeGolden = old.serializeGolden, goldenPath = old.goldenPath, diffPaths = old.diffPaths;
export const canonical = (v) => old.canonical(invDeep(v));
export const summarize = (v, depth = 0) => old.summarize(invDeep(v), depth);
export const summarizeCollection = (v) => old.summarizeCollection(invDeep(v));
export const summarizeFinalState = (fs_) => old.summarizeFinalState(invDeep(fs_));
export const checkGolden = (assert, name, actual, unitsOf) => old.checkGolden(assert, name, invDeep(actual), unitsOf);
// Two raw-text hashes the harness takes outside this library (freeze-world's persisted-snapshot hash and the soak
// driver's trafficDigest) call this hook on the scratch copy (patch_scratch.sh) so they hash the old vocabulary too.
globalThis.__renameInv = invString;
