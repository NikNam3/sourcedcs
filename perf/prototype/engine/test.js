// Sample problems from Appendix B Part 2 text (pages B2-2..B2-4).
const E = require('./engine.js');
const D = require(process.argv[2]);
let fails = 0;
function chk(name, got, want, tolPct) {
  const err = 100 * (got - want) / want, ok = Math.abs(err) <= tolPct;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} got ${got.toFixed(3).padStart(9)}  manual ${String(want).padStart(6)}  (${err >= 0 ? '+' : ''}${err.toFixed(2)}%)`);
}
const t = E.takeoffFactor(D, 40, 2000);
chk('TOF MIL (40C, 2000 ft)', t.mil, 3.16, 1);
chk('TOF AB  (40C, 2000 ft)', t.ab, 1.85, 1.5);
const s = E.takeoffSpeed(D, 33000, 37, false);
chk('Vto @35% (33k lb)', s.v35, 170, 1);
chk('Vto @37%', s.vto, 168, 1);
chk('Vr non-AB', s.vrMil, 158, 1);
chk('Vr AB', s.vrAb, 153, 1);
chk('Vto 8 deg', E.takeoffSpeed(D, 33000, 37, true).vto, 181, 1);
const d1 = E.takeoffDistance(D, 3.16, 33000, 37, 150, 1, 10, false);
chk('TO dist MIL (manual inputs)', d1.ft, 4243, 2);
const d2 = E.takeoffDistance(D, 1.85, 33000, 37, 150, 1, 10, false);
chk('TO dist AB (manual inputs)', d2.ft, 2384, 2);
chk('TO dist MIL 8 deg', E.takeoffDistance(D, 3.16, 33000, 37, 150, 1, 10, true).ft, 5007, 2);
// full chain from raw conditions (errors compound)
const d3 = E.takeoffDistance(D, t.mil, 33000, 37, 150, 1, 10, false);
chk('TO dist MIL full chain', d3.ft, 4243, 3);
for (const r of [t, s, d1, d2]) if (r.warn.length) console.log('warn:', r.warn);
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
