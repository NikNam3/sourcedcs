"""Panel extraction: one function per panel type, dispatched on the spec's `type`.

Each function takes (page, spec, panel_spec, axes), where `axes` maps an axis name to its fit
{'a', 'b', 'resid'}, runs the panel's asserts and returns the panel as the Data contract has it
(numbers already rounded). Add a type by writing its function and registering it in TYPES."""
import re

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


# Tables (Task 8, questioner rulings R5 to R7). Words go to the column whose x range holds their
# centre and to lines by clustering their centre y; rows are built from lines by the spec's rules.
LINE_TOL_PT = 3.0       # a word more than this below the previous word's centre starts a new line
GROUP_X_TOL_PT = 2.0    # a row whose key starts this close to its group header's x ends the group
NUMBER_RE = re.compile(r'-?\d+(\.\d+)?')
THOUSANDS_RE = re.compile(r'\d{1,3}(,\d{3})+')
NULL_CELLS = ('-', '–')
COLUMN_KEYS = ({'name', 'unit'}, {'x', 'pattern'})
GROUP_KEYS = ({'column', 'header'}, set())


def cell_value(text, is_key):
    """A cell's text -> number, verbatim string or null (R6). Key cells are identifiers and stay
    strings (station `5`); in other columns a plain or thousands number becomes a number and a
    lone dash null."""
    if text == '':
        return None
    if is_key:
        return text
    if text in NULL_CELLS:
        return None
    t = text.replace('–', '-').replace('−', '-')
    if NUMBER_RE.fullmatch(t):
        return float(t) if '.' in t else int(t)
    if THOUSANDS_RE.fullmatch(t):
        return int(t.replace(',', ''))
    return text


def _table_spec(ps):
    """Checks the table-only keys (columns, group, row rules) and returns the columns, the
    group column (or None), the header column and the columns that carry an x range."""
    cols = ps['columns']
    assert isinstance(cols, list) and cols, "columns must be a non-empty list"
    for n, c in enumerate(cols):
        check_keys(c, *COLUMN_KEYS, prefix=f'columns[{n}].')
    names = [c['name'] for c in cols]
    assert len(set(names)) == len(names), f"duplicate column names {names}"
    group = ps.get('group')
    gcol = hcol = None
    if group is not None:
        check_keys(group, *GROUP_KEYS, prefix='group.')
        gcol, hcol = group['column'], group['header']
        assert gcol in names and hcol in names, f"group columns {gcol!r}, {hcol!r} not among {names}"
    for c in cols:
        if c['name'] == gcol:
            assert 'x' not in c, f"group column {gcol!r} is filled from the group headers and takes no x"
        else:
            x = c.get('x')
            assert isinstance(x, list) and len(x) == 2 and x[0] < x[1], \
                f"column {c['name']!r} needs x: [x0, x1], not {x!r}"
    placed = sorted((c for c in cols if c['name'] != gcol), key=lambda c: c['x'][0])
    for a, b in zip(placed, placed[1:]):
        assert a['x'][1] <= b['x'][0], f"columns {a['name']!r} and {b['name']!r} overlap"
    for k in ps['key']:
        assert k in names, f"key column {k!r} is not a column"
    if 'row_end' in ps:
        assert ps['row_end'] in names and ps['row_end'] != gcol, f"row_end {ps['row_end']!r} is not a placed column"
    assert group is None or hcol != gcol, "group.header must be a placed column, not the group column"
    assert isinstance(ps['rows'], int) and ps['rows'] > 0, f"rows must be a positive count, not {ps['rows']!r}"
    for k in ps.get('fill_down', []):
        assert k in names and k != gcol, f"fill_down {k!r} is not a placed column"
    assert 'fill_down' not in ps or gcol is not None, "fill_down works within a group: declare group"
    return cols, gcol, hcol, placed


def _lines(words):
    """Clusters words into lines by centre y: a word more than LINE_TOL_PT below the previous
    one starts a new line. Asserts no line spans more than LINE_TOL_PT."""
    lines = []
    for w in sorted(words, key=lambda w: (w['cy'], w['x0'])):
        if lines and w['cy'] - lines[-1][-1]['cy'] <= LINE_TOL_PT:
            lines[-1].append(w)
        else:
            lines.append([w])
    for ln in lines:
        span = ln[-1]['cy'] - ln[0]['cy']
        assert span <= LINE_TOL_PT, \
            f"line at y {ln[0]['cy']:.1f} spans {span:.1f} pt (limit {LINE_TOL_PT:g})"
    return lines


def _text(lines, col):
    """One column's words over some lines, top to bottom and left to right, joined by one space."""
    return ' '.join(w['text'] for ln in lines for w in sorted(ln, key=lambda w: w['x0']) if w['col'] == col)


def table(page, spec, ps, axes):
    cols, gcol, hcol, placed = _table_spec(ps)
    names = [c['name'] for c in cols]
    x0, y0, x1, y1 = ps['clip']
    band = ps['row_band']
    assert y0 <= band[0] < band[1] <= y1, f"row_band {band} is not inside the clip's y [{y0}, {y1}]"
    drop = ps.get('drop_words', [])
    dropped = {d: 0 for d in drop}
    words = []
    for w in geom.page_words(page):
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        if not (x0 <= cx <= x1 and y0 <= cy <= y1):
            continue
        if w[4] in dropped:
            dropped[w[4]] += 1
            continue
        col = next((c['name'] for c in placed if c['x'][0] <= cx <= c['x'][1]), None)
        assert col is not None, f"word {w[4]!r} at ({cx:.1f}, {cy:.1f}) lies in no column"
        if band[0] <= cy <= band[1]:
            words.append({'text': w[4], 'x0': w[0], 'cy': cy, 'col': col})
    for d, n in dropped.items():
        assert n > 0, f"drop_words {d!r} matches no word in the clip"
    lines = _lines(words)

    attach = list(ps.get('attach_up', []))
    mean_y = [sum(w['cy'] for w in ln) / len(ln) for ln in lines]
    for y in attach:
        n = sum(abs(ly - y) <= LINE_TOL_PT for ly in mean_y)
        assert n == 1, f"attach_up {y} matches {n} lines (each must match exactly one line's mean y)"
    row_end = ps.get('row_end')
    rows, groups, pending = [], [], []    # groups: (text, header y) per header, in page order
    group = group_x = None                 # the current group's index in groups, its header's x

    def close():
        nonlocal group, group_x
        cells = {c: _text(pending, c) for c in names if c != gcol}
        key_x = min((w['x0'] for ln in pending for w in ln if w['col'] == hcol), default=None)
        if group is not None and key_x is not None and abs(key_x - group_x) <= GROUP_X_TOL_PT:
            group = group_x = None
        if gcol is not None:
            cells[gcol] = '' if group is None else groups[group][0]
        rows.append({'cells': cells, 'y': pending[0][0]['cy'], 'group': group})
        pending.clear()

    for ln in lines:
        ly = sum(w['cy'] for w in ln) / len(ln)
        hit = [y for y in attach if abs(ly - y) <= LINE_TOL_PT]
        if hit:
            assert len(hit) == 1, f"line at y {ly:.1f} matches attach_up {hit}"
            assert not pending and rows, f"attach_up line at y {ly:.1f} has no closed row above it"
            for c in names:
                if c == gcol:
                    continue
                extra = _text([ln], c)
                if extra:
                    rows[-1]['cells'][c] = (rows[-1]['cells'][c] + ' ' + extra).strip()
            continue
        pending.append(ln)
        if row_end is None or _text([ln], row_end):
            close()
        elif gcol is not None and _text(pending, hcol).endswith(':'):
            parts = [_text(pending, hcol)] + [_text(pending, c['name']) for c in placed if c['name'] != hcol]
            groups.append((' '.join(t for t in parts if t), pending[0][0]['cy']))
            starts = [min(w['x0'] for w in p if w['col'] == hcol) for p in pending if _text([p], hcol)]
            assert max(starts) - min(starts) <= GROUP_X_TOL_PT, \
                f"group header {groups[-1][0]!r} at y {groups[-1][1]:.1f}: its lines start at x " \
                f"{[round(x, 1) for x in starts]} (a continuation of the row above? see attach_up)"
            group = len(groups) - 1
            group_x = starts[0]
            pending.clear()
    if pending:
        assert False, f"{len(pending)} line(s) left with no {row_end} cell at the end of the row band, " \
                      f"first at y {pending[0][0]['cy']:.1f}: {_text(pending, hcol or row_end)!r}"
    for i, (text, gy) in enumerate(groups):
        assert any(r['group'] == i for r in rows), \
            f"group header {text!r} at y {gy:.1f} has no rows (its first row starts at the header's x?)"
    for r in rows:
        for c, t in r['cells'].items():
            assert not any(ord(ch) < 32 for ch in t), f"cell {t!r} (row at y {r['y']:.1f}) holds a control character"

    for c in ps.get('fill_down', []):
        for prev, r in zip(rows, rows[1:]):
            if r['cells'][c] == '' and r['group'] is not None and r['group'] == prev['group']:
                r['cells'][c] = prev['cells'][c]

    keys = ps['key']
    out_rows = []
    for r in rows:
        out_rows.append([cell_value(r['cells'][c], c in keys) for c in names])
    for c in cols:
        if 'pattern' not in c:
            continue
        pat = re.compile(c['pattern'])
        for r in rows:
            t = r['cells'][c['name']]
            if t != '' and not (c['name'] not in keys and t in NULL_CELLS):
                assert pat.fullmatch(t), \
                    f"column {c['name']} cell {t!r} (row at y {r['y']:.1f}) does not match {c['pattern']!r}"
    for r, o in zip(rows, out_rows):
        assert len(o) == len(cols), f"row at y {r['y']:.1f} has {len(o)} cells for {len(cols)} columns"
        for c, v in zip(names, o):
            assert not (isinstance(v, (int, float)) and ',' in r['cells'][c]
                        and not THOUSANDS_RE.fullmatch(r['cells'][c])), \
                f"cell {r['cells'][c]!r} has a comma but became a number"
            if c in keys and c != gcol:
                assert v is not None, f"key column {c} is empty in the row at y {r['y']:.1f} ({r['cells']})"
    seen = {}
    for r, o in zip(rows, out_rows):
        k = tuple(o[names.index(c)] for c in keys)
        assert k not in seen, f"key {list(k)} repeats (rows at y {seen.get(k, 0):.1f} and {r['y']:.1f})"
        seen[k] = r['y']
    assert len(out_rows) == ps['rows'], f"{len(out_rows)} rows found, spec says {ps['rows']}"
    return {
        'id': ps['id'], 'type': 'table',
        'columns': [{'name': c['name'], 'unit': c['unit']} for c in cols],
        'rows': out_rows,
    }


TYPES = {
    'curve_family': curve_family,
    'single_curve': single_curve,
    'scale_pair': scale_pair,
    'guideline_panel': guideline_panel,
    'table': table,
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
    'table': ({'id', 'type', 'clip', 'row_band', 'rows', 'key', 'columns'},
              {'row_end', 'group', 'fill_down', 'attach_up', 'drop_words'}),  # columns, group: _table_spec
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
