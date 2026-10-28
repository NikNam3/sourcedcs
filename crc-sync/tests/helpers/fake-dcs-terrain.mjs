// A fake DCS for the terrain commands (docs/adr/0133): answers the Lua tools/terrain/lua.js builds, over a synthetic
// terrain, by reading the parameters back out of the script. No DCS is ever contacted by any test.
//
//   LOtoLL  lat = LAT0 + x / 111320, lon = LON0 + z / (111320 cos LAT0)   (a stand-in projection, invertible)
//   height  heightAt(lat, lon), rounded the way the Lua rounds it
//   isVisible  a straight line over the terrain, sampled every 50 m

const LAT0 = 35, LON0 = 36;
const K = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export function fakeDcs({ theatre = 'Syria', heightAt = () => 0, version = '2.9.fake', ms = 3.5, fail = () => null } = {}) {
  const calls = { probe: 0, heights: [], visibility: 0 };
  async function evalLua(lua) {
    const failure = fail(calls, lua);
    if (failure) throw failure;
    if (lua.includes('coord.LOtoLL')) {
      calls.probe += 1;
      const m = /local X0, X1, Z0, Z1, N = (\S+), (\S+), (\S+), (\S+), (\d+)/.exec(lua);
      const [x0, x1, z0, z1] = m.slice(1, 5).map(Number);
      const pts = [];
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) pts.push(`${(LAT0 + x / 111320).toFixed(9)},${(LON0 + z / K).toFixed(9)}`);
      return { theatre, version, ms, pts: pts.join(';') };
    }
    if (lua.includes('land.isVisible')) {
      calls.visibility += 1;
      const groups = (s) => [...s.matchAll(/\{([^{}]*)\}/g)].map((g) => g[1].split(',').map(Number));
      const P = groups(/local P = \{(.*)\}\n/.exec(lua)[1]);
      const Q = groups(/local Q = \{(.*)\}\n/.exec(lua)[1]);
      const pairs = P.map(([rLat, rLon, rAgl, tLat, tLon, tAgl]) => {
        const rg = heightAt(rLat, rLon), tg = heightAt(tLat, tLon);
        const ra = rg + rAgl, ta = tg + tAgl;
        const n = 400;
        let vis = 1;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          if (heightAt(rLat + (tLat - rLat) * f, rLon + (tLon - rLon) * f) > ra + (ta - ra) * f) { vis = 0; break; }
        }
        return `${rg.toFixed(2)},${tg.toFixed(2)},${vis}`;
      });
      return { theatre, ms, pairs: pairs.join(';'), points: Q.map(([lat, lon]) => heightAt(lat, lon).toFixed(2)).join(',') };
    }
    if (lua.includes('land.getHeight')) {
      const a = /local LAT0, LON0, DLAT, DLON = (\S+), (\S+), (\S+), (\S+)\n/.exec(lua).slice(1).map(Number);
      const [r0, nr, nc] = /local R0, NR, NC = (\d+), (\d+), (\d+)/.exec(lua).slice(1).map(Number);
      calls.heights.push(r0);
      const h = [];
      for (let r = r0; r < r0 + nr; r++) for (let c = 0; c < nc; c++) h.push(Math.floor(heightAt(a[0] + r * a[2], a[1] + c * a[3]) + 0.5));
      return { theatre, r0, rows: nr, cols: nc, ms, h: h.join(',') };
    }
    throw new Error('the fake DCS does not know this Lua');
  }
  return { evalLua, calls };
}
