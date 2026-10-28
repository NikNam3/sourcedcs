// F-16 (F110-GE-129) takeoff engine. Pure functions over extracted chart data.
// Every function returns {value, warn[], path} where path holds chart-space points for overlay.
(function (root) {
  function interp1(c, x) { // c: [[x,y],...] sorted by x
    const n = c.length; let out = false, y;
    if (x < c[0][0]) { out = true; y = c[0][1] + (c[1][1] - c[0][1]) / (c[1][0] - c[0][0]) * (x - c[0][0]); }
    else if (x > c[n - 1][0]) { out = true; y = c[n - 1][1] + (c[n - 1][1] - c[n - 2][1]) / (c[n - 1][0] - c[n - 2][0]) * (x - c[n - 1][0]); }
    else {
      for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = c[i], [x1, y1] = c[i + 1];
        if (x >= x0 && x <= x1) { y = x1 === x0 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); break; }
      }
    }
    return { y, out };
  }
  // family of curves, each y(x), indexed by param. Linear in param between neighbours.
  function family(curves, params, p, x, label, warn) {
    const ys = curves.map(c => interp1(c, x));
    if (ys.some(v => v.out)) warn.push(`${label}: input outside chart range`);
    if (p < params[0] || p > params[params.length - 1]) warn.push(`${label}: ${p} outside ${params[0]}…${params[params.length - 1]} (extrapolated)`);
    let i = 0; while (i < params.length - 2 && p > params[i + 1]) i++;
    const f = (p - params[i]) / (params[i + 1] - params[i]);
    return ys[i].y + f * (ys[i + 1].y - ys[i].y);
  }
  // guideline panel: lines are [[param, dist],...] sorted by param. Move x0 from base to target.
  function guide(lines, base, x0, target, label, warn) {
    const g = [];
    for (const ln of lines) {
      const lo = ln[0][0], hi = ln[ln.length - 1][0], eps = 0.02 * Math.max(Math.abs(hi - lo), 1);
      if (target < lo - eps || target > hi + eps || base < lo - eps || base > hi + eps) continue;
      g.push([interp1(ln, base).y, interp1(ln, target).y]);
    }
    if (g.length < 2) { warn.push(`${label}: ${target} beyond chart`); return x0; }
    g.sort((a, b) => a[0] - b[0]);
    let i = 0; while (i < g.length - 2 && x0 > g[i + 1][0]) i++;
    if (x0 < g[0][0] || x0 > g[g.length - 1][0]) warn.push(`${label}: entry outside guideline range (extrapolated)`);
    const [a, b] = [g[i], g[i + 1]], f = (x0 - a[0]) / (b[0] - a[0]);
    return a[1] + f * (b[1] - a[1]);
  }

  function takeoffFactor(D, tempC, paFt) {
    const c = D.charts['B2-1'], warn = [];
    const mil = family(c.curves, c.params, paFt, tempC, 'Takeoff factor', warn);
    const ab = c.mil_to_ab.a * mil + c.mil_to_ab.b;
    return { mil, ab, warn, path: { tempC, mil } };
  }
  function takeoffSpeed(D, gwLb, cg, pitch8) {
    const c = D.charts['B2-2'], warn = [];
    const r = interp1(c.curve, gwLb / 1000);
    if (r.out) warn.push('Takeoff speed: GW outside chart (17–48k lb)');
    const v35 = r.y;
    let v = v35 - 0.8 * (cg - 35);
    if (pitch8) v *= 1.08;
    return { v35, vto: v, vrMil: v - 10, vrAb: v - 15, warn, path: { gw: gwLb / 1000, v35 } };
  }
  function takeoffDistance(D, tof, gwLb, cg, di, slopePct, headwindKt, pitch8) {
    const P = D.charts['B2-3'].panels, warn = [], gw = gwLb / 1000;
    if (tof < 1 || tof > 7) warn.push('Takeoff distance: takeoff factor outside 1–7');
    const steps = [];
    let x = family(P.gw.curves, P.gw.params, gw, tof, 'Takeoff distance GW', warn);
    steps.push({ panel: 'gw', x, v: tof });
    steps.push({ panel: 'cg', x, v: 35, base: true });
    x = guide(P.cg.lines, 35, x, cg, 'CG', warn); steps.push({ panel: 'cg', x, v: cg });
    steps.push({ panel: 'di', x, v: 0, base: true });
    x = guide(P.di.lines, 0, x, di, 'Drag index', warn); steps.push({ panel: 'di', x, v: di });
    steps.push({ panel: 'slope', x, v: 0, base: true });
    if (slopePct !== 0) x = guide(slopePct > 0 ? P.slope.up : P.slope.down, 0, x, Math.abs(slopePct), 'Slope', warn);
    steps.push({ panel: 'slope', x, v: Math.abs(slopePct) });
    steps.push({ panel: 'wind', x, v: 0, base: true });
    if (headwindKt !== 0) x = guide(headwindKt > 0 ? P.wind.head : P.wind.tail, 0, x, Math.abs(headwindKt), 'Wind', warn);
    steps.push({ panel: 'wind', x, v: Math.abs(headwindKt) });
    if (x > 12) warn.push('Takeoff distance beyond chart (12,000 ft)');
    const ft10 = x * 1000;
    return { ft: pitch8 ? ft10 * 1.18 : ft10, ft10, warn, steps };
  }
  const api = { interp1, family, guide, takeoffFactor, takeoffSpeed, takeoffDistance };
  if (typeof module !== 'undefined') module.exports = api; else root.TOLD = api;
})(this);
