"""Extract F110 takeoff charts (B2-1, B2-2, B2-3) from the HAF F-16 supplement vector data.
Usage: python3 -I extract.py <pdf> <out.json>
Only geometry is automatic; meaning (axes, parameter values, panel order) comes from SPEC.
Every step asserts a check and the script fails loudly instead of guessing."""
import sys, os, json, re, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pymupdf, vec

def nums(page):
    out = []
    for w in page.get_text("words"):
        t = w[4].replace('–', '-').replace('−', '-')
        if re.fullmatch(r'-?\d+(\.\d+)?', t):
            out.append((float(t), (w[0]+w[2])/2, (w[1]+w[3])/2))
    return out

def gridlines(page):
    """Positions of straight horizontal / vertical lines (any width) for label snapping."""
    hs, vs = [], []
    for x in page.get_drawings():
        for it in x['items']:
            if it[0] != 'l': continue
            a, b = it[1], it[2]
            if abs(a.y-b.y) < 0.05 and abs(a.x-b.x) > 3: hs.append(a.y)
            if abs(a.x-b.x) < 0.05 and abs(a.y-b.y) > 3: vs.append(a.x)
    return sorted(set(round(h, 2) for h in hs)), sorted(set(round(v, 2) for v in vs))

def axis(page, which, band, rng, expect, snap=True):
    """which='x': labels whose y in band, value->x. which='y': labels whose x in band, value->y.
    rng limits the other coordinate. expect = list of label values that must be found."""
    hs, vs = gridlines(page)
    pts = []
    for v, cx, cy in nums(page):
        c_other, c_pos = (cy, cx) if which == 'x' else (cx, cy)
        if band[0] <= c_other <= band[1] and rng[0] <= c_pos <= rng[1]:
            if snap:
                lines = vs if which == 'x' else hs
                near = [l for l in lines if abs(l - c_pos) < 2.5]
                if near: c_pos = min(near, key=lambda l: abs(l-c_pos))
            pts.append((v, c_pos))
    vals = sorted(p[0] for p in pts)
    assert vals == sorted(expect), f"axis {which} band {band}: found {vals}, expected {sorted(expect)}"
    # least squares pos = a*v + b
    n = len(pts); sv = sum(p[0] for p in pts); sp = sum(p[1] for p in pts)
    svv = sum(p[0]**2 for p in pts); svp = sum(p[0]*p[1] for p in pts)
    a = (n*svp - sv*sp)/(n*svv - sv*sv); b = (sp - a*sv)/n
    resid = max(abs(a*v+b-p) for v, p in pts)
    assert resid < 0.6, f"axis {which} {band}: tick residual {resid:.2f} pt (label misassigned?)"
    return {'a': a, 'b': b, 'resid': resid}

def to_val(ax, pos): return (pos - ax['b'])/ax['a']

def mono_pieces(chain, key):
    """split a polyline into pieces monotonic in coordinate key (0=x,1=y)."""
    pieces, cur, sgn = [], [chain[0]], 0
    for p in chain[1:]:
        d = p[key] - cur[-1][key]
        s = (d > 1e-6) - (d < -1e-6)
        if s and sgn and s != sgn:
            pieces.append(cur); cur = [cur[-1]]; sgn = 0
        cur.append(p)
        if s: sgn = s
    pieces.append(cur)
    out = []
    for pc in pieces:
        if pc[0][key] > pc[-1][key]: pc = pc[::-1]
        out.append(pc)
    return out

def join_dashes(pieces, max_gap=9.0, tol=1.6):
    """join y-monotonic pieces (sorted top->bottom) whose ends line up across a small gap."""
    pieces = sorted(pieces, key=lambda p: p[0][1])
    lines = []
    used = [False]*len(pieces)
    for i, p in enumerate(pieces):
        if used[i]: continue
        used[i] = True; line = list(p)
        while True:
            end = line[-1]; prev = line[-2] if len(line) > 1 else line[-1]
            # direction from last few points
            k = max(0, len(line)-4); dy = end[1]-line[k][1]; dx = end[0]-line[k][0]
            best = None
            for j, q in enumerate(pieces):
                if used[j]: continue
                gap = q[0][1] - end[1]
                if not (-0.3 <= gap <= max_gap): continue
                xpred = end[0] + (dx/dy*gap if dy > 1e-6 else 0)
                err = abs(q[0][0] - xpred)
                if err < tol and (best is None or err < best[0]): best = (err, j)
            if best is None: break
            used[best[1]] = True
            line += pieces[best[1]][1:] if math.dist(pieces[best[1]][0], line[-1]) < 0.2 else pieces[best[1]]
        lines.append(line)
    return lines

def panel_segments(page, clip, frame_ys, frame_xs):
    segs = []
    for a, b in vec.segments(page, 0.5, 1.0, clip):
        horiz = abs(a[1]-b[1]) < 0.05; vert = abs(a[0]-b[0]) < 0.05
        if horiz and any(abs(a[1]-fy) < 0.4 for fy in frame_ys): continue
        if vert and any(abs(a[0]-fx) < 0.4 for fx in frame_xs): continue
        segs.append((a, b))
    return segs

R = pymupdf.Rect

def extract(pdf):
    d = pymupdf.open(pdf)
    out = {'source': 'T.O. GR1F-16CJ-1-1 (HAF supplement), Appendix B, F110-GE-129', 'charts': {}}

    # ---------- B2-1 Takeoff factor (page index 283) ----------
    p = d[283]
    assert 'Takeoff Factor' in p.get_text() and 'F110' in p.get_text()
    xm = axis(p, 'x', (645, 652), (160, 520), [1, 2, 3, 4, 5, 6, 7])
    xab = axis(p, 'x', (681, 688), (140, 470), [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5], snap=False)
    yc = axis(p, 'y', (148, 160), (120, 640), [50, 40, 30, 20, 10, 0, -10, -20, -30, -40])
    clip = R(170, 120, 508, 640)
    cs = [c for c in vec.chains(panel_segments(p, clip, [125.5, 636.0], [167.9, 508.3]))
          if abs(c[0][1]-c[-1][1]) > 300]
    pa = [-2000, 0, 2000, 4000, 6000, 8000, 10000]
    assert len(cs) == len(pa), f"B2-1: {len(cs)} curves, expected {len(pa)}"
    curves = []
    for c in cs:
        pts = sorted(((to_val(yc, y), to_val(xm, x)) for x, y in c))  # (temp C, MIL TOF)
        curves.append(pts)
    curves.sort(key=lambda c: c[len(c)//2][1])
    # physics/order check: at every temperature, TOF increases with altitude
    for t in range(-40, 51, 10):
        vals = [interp1(c, t) for c in curves]
        assert all(a < b for a, b in zip(vals, vals[1:])), f"B2-1 order broken at {t}C: {vals}"
    out['charts']['B2-1'] = {
        'title': 'Takeoff Factor', 'page': 284, 'x': 'TOF (MIL)', 'y': 'runway temp C',
        'param': 'pressure altitude ft', 'params': pa,
        'curves': [[[round(a, 3), round(b, 4)] for a, b in c] for c in curves],
        'axes': {'x': xm, 'y': yc},
        'mil_to_ab': {'a': xm['a']/xab['a'], 'b': (xm['b']-xab['b'])/xab['a']},  # AB = a*MIL + b
    }

    # ---------- B2-2 Takeoff speed (page 284) ----------
    p = d[284]
    assert 'Takeoff Speed' in p.get_text()
    xg = axis(p, 'x', (561, 568), (140, 520), [20, 25, 30, 35, 40, 45])
    yk = axis(p, 'y', (70, 90), (260, 560), [120, 140, 160, 180, 200, 220])
    cs = [c for c in vec.chains(panel_segments(p, R(95, 270, 549, 557), [555.8, 272.2], [94.3, 548.1]))
          if len(c) > 20]
    assert len(cs) == 1, f"B2-2: {len(cs)} curves"
    c = sorted((to_val(xg, x), to_val(yk, y)) for x, y in cs[0])
    assert all(b[1] >= a[1] for a, b in zip(c, c[1:])), "B2-2 not monotonic"
    out['charts']['B2-2'] = {'title': 'Takeoff Speed (35% MAC, 10 deg pitch)', 'page': 285,
                             'curve': [[round(a, 3), round(b, 2)] for a, b in c], 'axes': {'x': xg, 'y': yk}}

    # ---------- B2-3 Takeoff distance (page 285) ----------
    p = d[285]
    assert 'Takeoff Distance' in p.get_text() and 'F110' in p.get_text()
    xd = axis(p, 'x', (690, 697), (95, 545), [0, 2, 4, 6, 8, 10, 12])
    X0, X1 = 104.0, 536.2
    panels = {}
    panel_axes = {'x': xd}
    # top: TOF vs distance, GW family
    ytof = axis(p, 'y', (90, 100), (130, 360), [1, 2, 3, 4, 5, 6, 7])
    cs = [c for c in vec.chains(panel_segments(p, R(X0+0.5, 135, X1+0.5, 353), [136.3, 352.4], [X0, X1]))
          if len(c) >= 5]
    gw = list(range(20, 49, 2))
    assert len(cs) == len(gw), f"B2-3 top: {len(cs)} curves vs {len(gw)}"
    curves = [sorted((to_val(ytof, y), to_val(xd, x)) for x, y in c) for c in cs]  # (TOF, dist)
    curves.sort(key=lambda c: interp1(c, 1.5))
    for t in (1.2, 1.5, 2, 2.5):
        vals = [interp1(c, t) for c in curves]
        assert all(a < b for a, b in zip(vals, vals[1:])), f"B2-3 GW order broken at TOF {t}"
    panel_axes['gw'] = ytof
    panels['gw'] = {'params': gw, 'curves': [[[round(a, 4), round(b, 4)] for a, b in c] for c in curves]}

    def guide_panel(name, ytop, ybot, labels, base_val, clip_x=(X0, X1), expect_min=None):
        ya = axis(p, 'y', (88, 100), (ytop-3, ybot+3), labels)
        yb = ya['a']*base_val + ya['b']
        fys = [ytop, ybot, yb]
        segs = panel_segments(p, R(X0+0.3, ytop-0.5, X1+0.5, ybot+0.5), fys, [X0, X1])
        pieces = []
        for c in vec.chains(segs):
            pieces += [pc for pc in mono_pieces(c, 1) if abs(pc[-1][1]-pc[0][1]) > 0.5]
        lines = join_dashes(pieces)
        res = []
        for ln in lines:
            if abs(ln[-1][1]-ln[0][1]) < 5: continue
            pts = [(round(to_val(ya, y), 3), round(to_val(xd, x), 4)) for x, y in ln]
            pts.sort()
            lo, hi = pts[0][0], pts[-1][0]
            if not (lo - 0.02*abs(labels[0]-labels[-1]) <= base_val <= hi + 0.02*abs(labels[0]-labels[-1])):
                continue  # must cross the baseline to be usable
            res.append(pts)
        if expect_min: assert len(res) >= expect_min, f"{name}: only {len(res)} guidelines"
        panel_axes[name] = ya
        return res, ya

    cg, _ = guide_panel('cg', 363.3, 435.4, [30, 35, 40], 35, expect_min=12)
    di, _ = guide_panel('di', 446.4, 518.5, [0, 200, 400], 0, expect_min=11)
    sl, _ = guide_panel('slope', 529.4, 601.5, [0, 1, 2], 0, expect_min=20)
    wd, _ = guide_panel('wind', 612.4, 684.5, [0, 20, 40], 0, expect_min=20)

    def split_dir(lines, name):
        inc, dec = [], []
        for ln in lines:
            dd = ln[-1][1] - ln[0][1]  # distance change as param increases from baseline
            (inc if dd > 0 else dec).append(ln)
        print(f"  {name}: {len(inc)} increasing, {len(dec)} decreasing", file=sys.stderr)
        return inc, dec
    # physics: uphill and tailwind increase distance; downhill and headwind decrease it.
    up, down = split_dir(sl, 'slope')
    tail, head = split_dir(wd, 'wind')
    cg_inc, cg_dec = split_dir(cg, 'cg')
    di_inc, di_dec = split_dir(di, 'di')
    assert len(di_dec) == 0, "drag index must never shorten takeoff"
    panels['cg'] = {'base': 35, 'lines': cg}
    panels['di'] = {'base': 0, 'lines': di_inc}
    panels['slope'] = {'base': 0, 'up': up, 'down': down}
    panels['wind'] = {'base': 0, 'head': head, 'tail': tail}
    out['charts']['B2-3'] = {'title': 'Takeoff Distance (10 deg pitch)', 'page': 286, 'panels': panels, 'axes': panel_axes}
    return out

def interp1(c, x):
    """c sorted list of (x,y); linear interpolation, clamped extrapolation flagged by caller."""
    if x <= c[0][0]: return c[0][1] + (c[1][1]-c[0][1])/(c[1][0]-c[0][0])*(x-c[0][0])
    for (x0, y0), (x1, y1) in zip(c, c[1:]):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1-y0)*(x-x0)/(x1-x0)
    return c[-1][1] + (c[-1][1]-c[-2][1])/(c[-1][0]-c[-2][0])*(x-c[-1][0])

if __name__ == '__main__':
    o = extract(sys.argv[1])
    json.dump(o, open(sys.argv[2], 'w'), separators=(',', ':'))
    print("ok", os.path.getsize(sys.argv[2]), "bytes")
