"""Panel extraction: one function per panel type, dispatched on the spec's `type`.

Each function takes (page, spec, panel_spec, axes), where `axes` maps an axis name to its fit
{'a', 'b', 'resid'}, runs the panel's asserts and returns the panel as the Data contract has it
(numbers already rounded). Add a type by writing its function and registering it in TYPES."""
import geom

DEFAULT_WIDTH = (0.5, 1.0)


def rv(v):
    """A chart value: 4 decimals, never -0.0."""
    v = round(v, 4)
    return 0.0 if v == 0 else v


def rt(v):
    """A page transform coefficient: 6 decimals, never -0.0."""
    v = round(v, 6)
    return 0.0 if v == 0 else v


def quantity(spec, name):
    assert name in spec['axes'], f"unknown axis {name!r}"
    return {'name': name, 'unit': spec['axes'][name]['unit']}


def transform(spec, axes, name):
    ax = axes[name]
    return {'page': spec['axes'][name]['page'], 'a': rt(ax['a']), 'b': rt(ax['b'])}


def chart_point(spec, axes, inp, out, x, y):
    """Page point -> (input value, output value)."""
    pin = spec['axes'][inp]['page']
    pout = spec['axes'][out]['page']
    assert pin != pout, f"input {inp} and output {out} both on page {pin}"
    xy = {'x': x, 'y': y}
    return (geom.to_val(axes[inp], xy[pin]), geom.to_val(axes[out], xy[pout]))


def filtered_chains(page, spec, panel_spec, inp):
    """Chains of the panel's segments that pass its filter (min_points, min_span_pt, stroke_width).
    min_span_pt is the chain's extent along the input axis's page coordinate."""
    flt = panel_spec.get('filter', {})
    width = tuple(flt.get('stroke_width', DEFAULT_WIDTH))
    segs = geom.panel_segments(page, panel_spec['clip'], panel_spec['frame'], width)
    k = 0 if spec['axes'][inp]['page'] == 'x' else 1
    out = []
    for c in geom.chains(segs):
        if len(c) < flt.get('min_points', 2):
            continue
        span = max(p[k] for p in c) - min(p[k] for p in c)
        if span < flt.get('min_span_pt', 0):
            continue
        out.append(c)
    return out


def to_points(spec, axes, inp, out, chain, what):
    """Chart points of one chain, sorted by input. The chain must run one way along the input axis:
    a chain that doubles back (a zigzag, or a stray segment chained on) fails."""
    k = 0 if spec['axes'][inp]['page'] == 'x' else 1
    steps = [b[k] - a[k] for a, b in zip(chain, chain[1:])]
    one_way = all(d > 0 for d in steps) or all(d < 0 for d in steps)
    if not one_way:
        i = next(i for i, d in enumerate(steps) if (d > 0) != (steps[0] > 0) or d == 0)
        x, y = chain[i + 1]
        assert False, f"{what} doubles back along {inp} at page ({x:.1f}, {y:.1f})"
    pts = sorted(chart_point(spec, axes, inp, out, x, y) for x, y in chain)
    assert all(b[0] > a[0] for a, b in zip(pts, pts[1:])), f"{what}: inputs not strictly ascending"
    return pts


def check_monotonic(pts, mono, inp, what):
    """Output along input, non-strict: rises (never falls) or falls (never rises)."""
    assert mono in ('rises', 'falls'), f"monotonic must be rises or falls, not {mono!r}"
    for a, b in zip(pts, pts[1:]):
        ok = b[1] >= a[1] if mono == 'rises' else b[1] <= a[1]
        assert ok, f"{what} not monotonic ({mono}) between {inp}={a[0]:.3f} and {b[0]:.3f}"


LABEL_TOL_PT = 3.0


def assign_labels(panel_spec, chains):
    """Param value per chain, from the spec's label anchors (one page point per value, in values
    order). Each anchor's nearest chain must be within 3 pt, no second chain within 3 pt, and no
    chain may get two anchors (else a leftover label); every chain must get one (else unlabelled)."""
    param = panel_spec['param']
    name, values, labels = param['name'], param['values'], panel_spec['labels']
    assert len(labels) == len(values), f"{len(labels)} labels for {len(values)} param values"
    owner = {}
    for v, lab in zip(values, labels):
        assert len(lab) == 2, f"label for {name}={v} is not a page point [x, y]: {lab}"
        dist = sorted((geom.dist_to_polyline(lab, c), i) for i, c in enumerate(chains))
        assert dist and dist[0][0] <= LABEL_TOL_PT, \
            f"leftover label {name}={v} at {lab}: nearest curve is " \
            f"{dist[0][0] if dist else float('inf'):.1f} pt away (limit {LABEL_TOL_PT:g} pt)"
        assert len(dist) < 2 or dist[1][0] > LABEL_TOL_PT, \
            f"leftover label {name}={v} at {lab}: two curves within {LABEL_TOL_PT:g} pt " \
            f"({dist[0][0]:.1f} and {dist[1][0]:.1f} pt)"
        i = dist[0][1]
        assert i not in owner, f"leftover label {name}={v} at {lab}: its curve is already labelled {name}={owner[i]}"
        owner[i] = v
    unlabelled = [c for i, c in enumerate(chains) if i not in owner]
    assert not unlabelled, \
        f"{len(unlabelled)} unlabelled curve(s), first starting at page " \
        f"({unlabelled[0][0][0]:.1f}, {unlabelled[0][0][1]:.1f})"
    return owner


def round_points(pts):
    return [[rv(a), rv(b)] for a, b in pts]


def curve_family(page, spec, panel_spec, axes):
    inp, out = panel_spec['input'], panel_spec['output']
    param = panel_spec['param']
    values = param['values']
    assert values == sorted(values) and len(set(values)) == len(values), \
        f"param values must be strictly ascending: {values}"
    cs = filtered_chains(page, spec, panel_spec, inp)
    owner = assign_labels(panel_spec, cs)
    by_value = {v: to_points(spec, axes, inp, out, cs[i], f"curve {param['name']}={v}") for i, v in owner.items()}
    curves = [by_value[v] for v in values]
    if 'monotonic' in panel_spec:
        for v, c in zip(values, curves):
            check_monotonic(c, panel_spec['monotonic'], inp, f"curve {param['name']}={v}")
    order = panel_spec['order']
    direction = order['output']
    assert direction in ('rises', 'falls'), f"order.output must be rises or falls, not {direction!r}"
    check_at = order['check_at']
    tick_span = abs(spec['axes'][inp]['ticks'][-1] - spec['axes'][inp]['ticks'][0])
    tol = 0.005 * tick_span
    for v, c in zip(values, curves):
        lo, hi = c[0][0], c[-1][0]
        for t in check_at:
            assert lo - tol <= t <= hi + tol, \
                f"curve {param['name']}={v} drawn over {inp} [{lo:.3f}, {hi:.3f}], not at check_at {t}"
    for t in check_at:
        vals = [geom.interp1(c, t) for c in curves]
        ok = all(a < b for a, b in zip(vals, vals[1:])) if direction == 'rises' \
            else all(a > b for a, b in zip(vals, vals[1:]))
        assert ok, f"order broken at {inp}={t}: {[round(x, 3) for x in vals]} should {direction[:-1]} with {param['name']}"
    return {
        'id': panel_spec['id'], 'type': 'curve_family',
        'input': quantity(spec, inp), 'output': quantity(spec, out),
        'param': {'name': param['name'], 'unit': param['unit']},
        'curves': [{'param': v, 'points': round_points(c)} for v, c in zip(values, curves)],
        'axes': {inp: transform(spec, axes, inp), out: transform(spec, axes, out)},
    }


def single_curve(page, spec, panel_spec, axes):
    inp, out = panel_spec['input'], panel_spec['output']
    cs = filtered_chains(page, spec, panel_spec, inp)
    assert len(cs) == 1, f"{len(cs)} curves found, expected 1"
    pts = to_points(spec, axes, inp, out, cs[0], 'curve')
    check_monotonic(pts, panel_spec['monotonic'], inp, 'curve')
    return {
        'id': panel_spec['id'], 'type': 'single_curve',
        'input': quantity(spec, inp), 'output': quantity(spec, out),
        'points': round_points(pts),
        'axes': {inp: transform(spec, axes, inp), out: transform(spec, axes, out)},
    }


def scale_line_range(page, spec, panel_spec, axes, to):
    """The drawn `to` scale's ends, in `to` units: the one straight line in the panel's
    `scale_line` clip that runs along the `to` axis's page direction (its tick marks cross it and
    are ignored), with a curve's stroke width."""
    clip = panel_spec['scale_line']
    assert isinstance(clip, list) and len(clip) == 4, f"scale_line must be a clip [x0, y0, x1, y1], not {clip!r}"
    k = 0 if spec['axes'][to]['page'] == 'x' else 1
    along = [s for s in geom.segments(page, geom.rect(clip), DEFAULT_WIDTH)
             if abs(s[0][1 - k] - s[1][1 - k]) < 0.05 and abs(s[0][k] - s[1][k]) > 0.05]
    lines = geom.chains(along)
    assert len(lines) == 1, \
        f"{len(lines)} straight lines along page {'xy'[k]} in scale_line {clip}, expected 1"
    ends = sorted(geom.to_val(axes[to], p[k]) for p in lines[0])
    lo, hi = ends[0], ends[-1]
    tol = EDGE_TOLERANCE * (hi - lo)
    for t in spec['axes'][to]['ticks']:
        assert lo - tol <= t <= hi + tol, \
            f"tick {to}={t} lies off the drawn scale line [{lo:.4f}, {hi:.4f}]"
    return [rv(lo), rv(hi)]


def scale_pair(page, spec, panel_spec, axes):
    """Two scales printed against each other: to = a * from + b, from the two axis fits, and the
    drawn `to` scale's range, measured from its scale line (ruling R2)."""
    frm, to = panel_spec['from'], panel_spec['to']
    pf, pt = spec['axes'][frm]['page'], spec['axes'][to]['page']
    assert pf == pt, f"scales {frm} ({pf}) and {to} ({pt}) are not along the same page direction"
    fa, ta = axes[frm], axes[to]
    a = fa['a'] / ta['a']
    b = (fa['b'] - ta['b']) / ta['a']
    return {
        'id': panel_spec['id'], 'type': 'scale_pair',
        'from': quantity(spec, frm), 'to': quantity(spec, to),
        'a': rt(a), 'b': rt(b),
        'range': scale_line_range(page, spec, panel_spec, axes, to),
        'axes': {frm: transform(spec, axes, frm), to: transform(spec, axes, to)},
    }


# The reader's edge tolerance (src/core/read/interp.ts, ruling R1): a fraction of the drawn span.
EDGE_TOLERANCE = 0.002
GUIDE_DIRECTIONS = ('rises', 'falls', 'any')
GUIDE_MIN_SPAN_PT = 5.0


def mono_pieces(chain, k):
    """Split a polyline into pieces monotonic in page coordinate k (0 = x, 1 = y), each oriented
    ascending in k. From the planning prototype."""
    pieces, cur, sgn = [], [chain[0]], 0
    for p in chain[1:]:
        d = p[k] - cur[-1][k]
        s = (d > 1e-6) - (d < -1e-6)
        if s and sgn and s != sgn:
            pieces.append(cur)
            cur = [cur[-1]]
            sgn = 0
        cur.append(p)
        if s:
            sgn = s
    pieces.append(cur)
    return [pc[::-1] if pc[0][k] > pc[-1][k] else pc for pc in pieces]


def join_dashes(pieces, k, max_gap=9.0, tol=1.6):
    """Join pieces monotonic in page coordinate k (see mono_pieces) whose ends line up across a
    gap of at most max_gap pt along k: a dashed line drawn as separate segments becomes one line.
    The next piece must start within tol pt of the line's direction extended across the gap.
    From the planning prototype, generalised to either page direction."""
    o = 1 - k
    pieces = sorted(pieces, key=lambda p: (p[0][k], p[0][o]))
    used = [False] * len(pieces)
    lines = []
    for i, p in enumerate(pieces):
        if used[i]:
            continue
        used[i] = True
        line = list(p)
        while True:
            end = line[-1]
            first = line[max(0, len(line) - 4)]
            dk, do = end[k] - first[k], end[o] - first[o]
            best = None
            for j, q in enumerate(pieces):
                if used[j]:
                    continue
                gap = q[0][k] - end[k]
                if not (-0.3 <= gap <= max_gap):
                    continue
                pred = end[o] + (do / dk * gap if dk > 1e-6 else 0)
                err = abs(q[0][o] - pred)
                if err < tol and (best is None or err < best[0]):
                    best = (err, j)
            if best is None:
                break
            used[best[1]] = True
            q = pieces[best[1]]
            close = ((q[0][0] - end[0]) ** 2 + (q[0][1] - end[1]) ** 2) ** 0.5 < 0.2
            line += q[1:] if close else q
        lines.append(line)
    return lines


def guide_lines(page, spec, panel_spec, axes):
    """The panel's guide lines as page polylines: segments inside the clip (frame lines and the
    baseline's own line dropped), chained, split into pieces monotonic along the input axis,
    dashes joined, lines shorter than the filter's min_span_pt (default 5 pt) along it dropped."""
    inp = panel_spec['input']
    flt = panel_spec.get('filter', {})
    width = tuple(flt.get('stroke_width', DEFAULT_WIDTH))
    page_dir = spec['axes'][inp]['page']
    k = 0 if page_dir == 'x' else 1
    frame = {a: list(v) for a, v in panel_spec['frame'].items()}
    frame[page_dir] = frame[page_dir] + [geom.to_page(axes[inp], panel_spec['baseline'])]
    segs = geom.panel_segments(page, panel_spec['clip'], frame, width)
    pieces = []
    for c in geom.chains(segs):
        pieces += [pc for pc in mono_pieces(c, k) if pc[-1][k] - pc[0][k] > 0.5]
    min_span = flt.get('min_span_pt', GUIDE_MIN_SPAN_PT)
    lines = [ln for ln in join_dashes(pieces, k) if ln[-1][k] - ln[0][k] >= min_span]
    return [ln for ln in lines if len(ln) >= flt.get('min_points', 2)]


def guideline_panel(page, spec, panel_spec, axes):
    """Guide lines that carry an output value from the baseline to a target param value.

    Each line kept must cross the baseline within the reader's edge tolerance (so the reader can
    use every line), run one way in output, and match a declared family by its direction (rises:
    output rises with the param, falls: it falls; any: either, only as the sole family). Each
    family must hold exactly its `count` lines, at distinct baseline outputs."""
    inp, out = panel_spec['input'], panel_spec['output']
    base = panel_spec['baseline']
    fams, count = panel_spec['families'], panel_spec['count']
    assert isinstance(fams, dict) and fams, "families must be a non-empty mapping"
    for f, d in sorted(fams.items()):
        assert d in GUIDE_DIRECTIONS, f"family {f}: direction {d!r} is not one of {GUIDE_DIRECTIONS}"
    dirs = list(fams.values())
    assert 'any' not in dirs or len(dirs) == 1, "a family with direction any must be the only family"
    assert len(set(dirs)) == len(dirs), f"two families share a direction: {fams}"
    assert isinstance(count, dict) and set(count) == set(fams), \
        f"count keys {sorted(count) if isinstance(count, dict) else count} must be the families {sorted(fams)}"
    for f, n in sorted(count.items()):
        assert isinstance(n, int) and not isinstance(n, bool) and n >= 1, f"count.{f} must be a positive integer, not {n!r}"
    by_dir = {d: f for f, d in fams.items()}

    lines = []
    for ln in guide_lines(page, spec, panel_spec, axes):
        x, y = ln[0]
        what = f"line starting at page ({x:.1f}, {y:.1f})"
        lines.append((what, to_points(spec, axes, inp, out, ln, what)))
    assert lines, "no guide lines found"
    lo = min(p[0][0] for _, p in lines)
    hi = max(p[-1][0] for _, p in lines)
    tol = EDGE_TOLERANCE * (hi - lo)
    found = {f: [] for f in fams}
    for what, pts in lines:
        a, b = pts[0][0], pts[-1][0]
        assert a - tol <= base <= b + tol, \
            f"{what} spans {inp} [{a:.4f}, {b:.4f}] and does not reach the baseline {base}"
        rise = pts[-1][1] - pts[0][1]
        assert rise != 0, f"{what} is flat in {out}"
        d = 'rises' if rise > 0 else 'falls'
        fam = by_dir.get('any', by_dir.get(d))
        assert fam is not None, f"{what} {d[:-1]}s with {inp}, which matches no family {fams}"
        check_monotonic(pts, d, inp, f"{what} (family {fam})")
        at_base = geom.interp1(pts, min(max(base, a), b))
        found[fam].append((at_base, pts))
    families = {}
    for f in sorted(fams):
        assert len(found[f]) == count[f], \
            f"family {f} ({fams[f]}): {len(found[f])} lines, expected count {count[f]}"
        ls = sorted(found[f], key=lambda e: e[0])
        for (b0, _), (b1, _) in zip(ls, ls[1:]):
            assert b1 > b0, f"family {f}: two lines meet the baseline at {out}={b0:.4f}"
        families[f] = [round_points(p) for _, p in ls]
    return {
        'id': panel_spec['id'], 'type': 'guideline_panel',
        'input': quantity(spec, inp), 'output': quantity(spec, out),
        'baseline': base,
        'families': families,
        'axes': {inp: transform(spec, axes, inp), out: transform(spec, axes, out)},
    }


TYPES = {
    'curve_family': curve_family,
    'single_curve': single_curve,
    'scale_pair': scale_pair,
    'guideline_panel': guideline_panel,
}

# Spec keys per panel type: (required, optional). A new type registers its keys here too.
KEYS = {
    'curve_family': ({'id', 'type', 'clip', 'frame', 'input', 'output', 'param', 'labels', 'order'},
                     {'monotonic', 'filter'}),
    'single_curve': ({'id', 'type', 'clip', 'frame', 'input', 'output', 'monotonic'}, {'filter'}),
    # frame only for the axis-title check; scale_line: a clip holding the drawn `to` scale line
    'scale_pair': ({'id', 'type', 'from', 'to', 'scale_line'}, {'frame'}),
    # families: {name: rises | falls | any}; count: {name: exact line count}
    'guideline_panel': ({'id', 'type', 'clip', 'frame', 'input', 'output', 'baseline', 'families', 'count'},
                        {'filter'}),
}

# Keys of the mapping-valued panel keys, wherever they appear: (required, optional).
NESTED = {
    'param': ({'name', 'unit', 'values'}, set()),
    'order': ({'output', 'check_at'}, set()),
    'frame': ({'x', 'y'}, set()),
    'filter': (set(), {'min_points', 'min_span_pt', 'stroke_width'}),
}


def check_keys(d, required, optional, prefix=''):
    """Fails on a missing required key or a key that is neither required nor optional."""
    assert isinstance(d, dict), f"{prefix or 'spec'} is not a mapping"
    for k in sorted(set(d) - required - optional, key=str):
        assert False, f"unknown key {prefix}{k}"
    for k in sorted(required - set(d)):
        assert False, f"missing key {prefix}{k}"


def check_panel_keys(panel_spec):
    kind = panel_spec.get('type') if isinstance(panel_spec, dict) else None
    assert kind in KEYS, f"unknown panel type {kind!r} (known: {sorted(KEYS)})"
    required, optional = KEYS[kind]
    check_keys(panel_spec, required, optional)
    for k in sorted(set(panel_spec) & set(NESTED)):
        check_keys(panel_spec[k], *NESTED[k], prefix=f'{k}.')
    if 'frame' in panel_spec:
        for k in ('x', 'y'):
            v = panel_spec['frame'][k]
            assert isinstance(v, list) and len(v) >= 2, f"frame.{k} needs at least two page coordinates, not {v!r}"


def panel_axes(panel_spec):
    """Axis names a panel uses (its input/output or from/to keys; none for a table)."""
    return [panel_spec[k] for k in ('input', 'output', 'from', 'to') if k in panel_spec]


def extract_panel(page, spec, panel_spec, axes):
    check_panel_keys(panel_spec)
    return TYPES[panel_spec['type']](page, spec, panel_spec, axes)
