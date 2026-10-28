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


def scale_pair(page, spec, panel_spec, axes):
    """Two scales printed against each other: to = a * from + b, from the two axis fits."""
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
        'axes': {frm: transform(spec, axes, frm), to: transform(spec, axes, to)},
    }


TYPES = {
    'curve_family': curve_family,
    'single_curve': single_curve,
    'scale_pair': scale_pair,
}

# Spec keys per panel type: (required, optional). A new type registers its keys here too.
KEYS = {
    'curve_family': ({'id', 'type', 'clip', 'frame', 'input', 'output', 'param', 'labels', 'order'},
                     {'monotonic', 'filter'}),
    'single_curve': ({'id', 'type', 'clip', 'frame', 'input', 'output', 'monotonic'}, {'filter'}),
    'scale_pair': ({'id', 'type', 'from', 'to'}, {'frame'}),  # frame only for the axis-title check
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
