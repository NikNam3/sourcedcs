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
    unknown = set(flt) - {'min_points', 'min_span_pt', 'stroke_width'}
    assert not unknown, f"unknown filter keys {sorted(unknown)}"
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


def to_points(spec, axes, inp, out, chain):
    return sorted(chart_point(spec, axes, inp, out, x, y) for x, y in chain)


def round_points(pts):
    return [[rv(a), rv(b)] for a, b in pts]


def curve_family(page, spec, panel_spec, axes):
    inp, out = panel_spec['input'], panel_spec['output']
    param = panel_spec['param']
    values = param['values']
    assert values == sorted(values) and len(set(values)) == len(values), \
        f"param values must be strictly ascending: {values}"
    cs = filtered_chains(page, spec, panel_spec, inp)
    assert len(cs) == len(values), \
        f"{len(cs)} curves found, {len(values)} param values (unlabelled or missing curves)"
    curves = [to_points(spec, axes, inp, out, c) for c in cs]
    order = panel_spec['order']
    direction = order['output']
    assert direction in ('rises', 'falls'), f"order.output must be rises or falls, not {direction!r}"
    check_at = order['check_at']
    ref = check_at[len(check_at) // 2]
    curves.sort(key=lambda c: geom.interp1(c, ref), reverse=(direction == 'falls'))
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
    pts = to_points(spec, axes, inp, out, cs[0])
    mono = panel_spec['monotonic']
    assert mono in ('rises', 'falls'), f"monotonic must be rises or falls, not {mono!r}"
    for a, b in zip(pts, pts[1:]):
        ok = b[1] >= a[1] if mono == 'rises' else b[1] <= a[1]
        assert ok, f"not monotonic ({mono}) between {inp}={a[0]:.3f} and {b[0]:.3f}"
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


def panel_axes(panel_spec):
    """Axis names a panel uses (its input/output or from/to keys; none for a table)."""
    return [panel_spec[k] for k in ('input', 'output', 'from', 'to') if k in panel_spec]


def extract_panel(page, spec, panel_spec, axes):
    kind = panel_spec.get('type')
    assert kind in TYPES, f"unknown panel type {kind!r} (known: {sorted(TYPES)})"
    return TYPES[kind](page, spec, panel_spec, axes)
