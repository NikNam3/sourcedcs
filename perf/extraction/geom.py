"""Page geometry: line segments, chaining, grid lines, tick-label axis fits, title words.

Generalised from the planning prototype (removed in b3fb1202; `git show b3fb1202^:perf/prototype/extraction/vec.py`
and `extract.py`).
Only geometry lives here; meaning comes from the chart spec."""
import re

import pymupdf

_GRID_CACHE = {}
_TEXT_CACHE = {}

# The manual encodes hyphens as \x06, spaces as \x05 and en-spaces as \x03 (questioner ruling R4).
CHAR_MAP = {'\x06': '-', '\x05': ' ', '\x03': ' ', '\t': ' '}


def _page_lines(page):
    """Text lines of the page from get_text("rawdict") spans (the "dict" spans plus each
    character's box), characters mapped by CHAR_MAP: a list of (block, line, [(char, bbox)])."""
    key = (id(page.parent), page.number)
    if key not in _TEXT_CACHE:
        lines = []
        for block in page.get_text("rawdict")['blocks']:
            for ln, line in enumerate(block.get('lines', [])):
                chars = []
                for span in line['spans']:
                    for ch in span['chars']:
                        chars.append((CHAR_MAP.get(ch['c'], ch['c']), tuple(ch['bbox'])))
                lines.append((block['number'], ln, chars))
        _TEXT_CACHE[key] = lines
    return _TEXT_CACHE[key]


def page_text(page):
    """The page's text, one line per text line, with the manual's hyphen and space codes mapped."""
    return '\n'.join(''.join(c for c, _ in chars) for _, _, chars in _page_lines(page)) + '\n'


def page_words(page):
    """Words as get_text("words") gives them, (x0, y0, x1, y1, text, block, line, word), but built
    from the mapped characters, so a hyphen stays inside its word."""
    out = []
    for bno, lno, chars in _page_lines(page):
        words, cur = [], []
        for c, bbox in chars + [(' ', None)]:
            if c.isspace():
                if cur:
                    words.append(cur)
                cur = []
            else:
                cur.append((c, bbox))
        for wno, w in enumerate(words):
            out.append((min(b[0] for _, b in w), min(b[1] for _, b in w),
                        max(b[2] for _, b in w), max(b[3] for _, b in w),
                        ''.join(c for c, _ in w), bno, lno, wno))
    return out


def rect(r):
    return pymupdf.Rect(*r)


def segments(page, clip=None, width=(0.5, 1.0)):
    """Straight line segments of the page drawings with a stroke width in `width`,
    both ends inside `clip` when given. Each segment is ((x0, y0), (x1, y1))."""
    lo, hi = width
    segs = []
    for drawing in page.get_drawings():
        w = drawing.get('width') or 0
        if not (lo <= w <= hi):
            continue
        for it in drawing['items']:
            if it[0] != 'l':
                continue
            a, b = it[1], it[2]
            if clip is not None and not (clip.contains(a) and clip.contains(b)):
                continue
            segs.append(((a.x, a.y), (b.x, b.y)))
    return segs


def panel_segments(page, clip, frame, width=(0.5, 1.0)):
    """Segments inside a panel's clip, with the panel's frame lines dropped:
    horizontal segments on a frame y and vertical segments on a frame x."""
    fys = frame.get('y', [])
    fxs = frame.get('x', [])
    out = []
    for a, b in segments(page, rect(clip), width):
        horiz = abs(a[1] - b[1]) < 0.05
        vert = abs(a[0] - b[0]) < 0.05
        if horiz and any(abs(a[1] - fy) < 0.4 for fy in fys):
            continue
        if vert and any(abs(a[0] - fx) < 0.4 for fx in fxs):
            continue
        out.append((a, b))
    return out


def chains(segs, tol=0.15):
    """Greedy chaining of segments into polylines by endpoint proximity."""
    segs = [s for s in segs if s[0] != s[1]]
    used = [False] * len(segs)
    out = []

    def key(p):
        return (round(p[0] / tol), round(p[1] / tol))

    idx = {}
    for i, (a, b) in enumerate(segs):
        for p in (a, b):
            k = key(p)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    idx.setdefault((k[0] + dx, k[1] + dy), []).append(i)

    def near(p, q):
        return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol

    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        pts = [segs[i][0], segs[i][1]]
        for end in (1, 0):
            while True:
                p = pts[-1] if end else pts[0]
                found = None
                for j in idx.get(key(p), []):
                    if used[j]:
                        continue
                    a, b = segs[j]
                    if near(a, p):
                        found = (j, b)
                        break
                    if near(b, p):
                        found = (j, a)
                        break
                if not found:
                    break
                used[found[0]] = True
                if end:
                    pts.append(found[1])
                else:
                    pts.insert(0, found[1])
        out.append(pts)
    return out


def numbers(page):
    """Every word on the page that is a number: (value, centre x, centre y)."""
    out = []
    for w in page_words(page):
        t = w[4].replace('–', '-').replace('−', '-')
        if re.fullmatch(r'-?\d+(\.\d+)?', t):
            out.append((float(t), (w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
    return out


def gridlines(page):
    """Positions of straight horizontal and vertical lines (any width), for label snapping."""
    key = (id(page.parent), page.number)
    if key in _GRID_CACHE:
        return _GRID_CACHE[key]
    hs, vs = [], []
    for drawing in page.get_drawings():
        for it in drawing['items']:
            if it[0] != 'l':
                continue
            a, b = it[1], it[2]
            if abs(a.y - b.y) < 0.05 and abs(a.x - b.x) > 3:
                hs.append(a.y)
            if abs(a.x - b.x) < 0.05 and abs(a.y - b.y) > 3:
                vs.append(a.x)
    res = (sorted(set(round(h, 2) for h in hs)), sorted(set(round(v, 2) for v in vs)))
    _GRID_CACHE[key] = res
    return res


def fit_axis(page, axis_spec):
    """Calibrate one axis from its tick labels: pagePt = a * value + b.

    axis_spec: page ('x' | 'y'), label_band (the other coordinate's band the labels sit in),
    range (limits on the axis coordinate), ticks (the label values that must be found),
    snap (default true: snap each label to the nearest grid line within 2.5 pt).
    Returns {'a', 'b', 'resid'}."""
    which = axis_spec['page']
    assert which in ('x', 'y'), f"page must be x or y, not {which!r}"
    band = axis_spec['label_band']
    rng = axis_spec['range']
    expect = axis_spec['ticks']
    snap = axis_spec.get('snap', True)
    hs, vs = gridlines(page)
    lines = vs if which == 'x' else hs
    pts = []
    for v, cx, cy in numbers(page):
        c_other, c_pos = (cy, cx) if which == 'x' else (cx, cy)
        if band[0] <= c_other <= band[1] and rng[0] <= c_pos <= rng[1]:
            if snap:
                near = [g for g in lines if abs(g - c_pos) < 2.5]
                if near:
                    c_pos = min(near, key=lambda g: abs(g - c_pos))
            pts.append((v, c_pos))
    vals = sorted(p[0] for p in pts)
    assert vals == sorted(float(t) for t in expect), \
        f"labels found {vals}, expected {sorted(expect)} (band {band}, range {rng})"
    n = len(pts)
    sv = sum(p[0] for p in pts)
    sp = sum(p[1] for p in pts)
    svv = sum(p[0] ** 2 for p in pts)
    svp = sum(p[0] * p[1] for p in pts)
    a = (n * svp - sv * sp) / (n * svv - sv * sv)
    b = (sp - a * sv) / n
    resid = max(abs(a * v + b - p) for v, p in pts)
    assert resid < 0.6, f"tick residual {resid:.2f} pt (label misassigned?)"
    return {'a': a, 'b': b, 'resid': resid}


def to_val(ax, pos):
    return (pos - ax['b']) / ax['a']


def to_page(ax, val):
    return ax['a'] * val + ax['b']


def _norm(word):
    return re.sub(r'[^0-9A-Za-z%]', '', word).upper()


def find_title(page, title):
    """Centres (x, y) of every occurrence of the title's words, consecutive in one text line.
    Punctuation and dashes are ignored, case too."""
    want = [w for w in (_norm(t) for t in title.split()) if w]
    assert want, f"empty title {title!r}"
    lines = {}
    for w in page_words(page):
        nw = _norm(w[4])
        if nw:
            lines.setdefault((w[5], w[6]), []).append((w[7], nw, w[:4]))
    out = []
    for key in sorted(lines):
        ws = sorted(lines[key])
        for i in range(len(ws) - len(want) + 1):
            if [x[1] for x in ws[i:i + len(want)]] == want:
                boxes = [x[2] for x in ws[i:i + len(want)]]
                x0 = min(bx[0] for bx in boxes)
                y0 = min(bx[1] for bx in boxes)
                x1 = max(bx[2] for bx in boxes)
                y1 = max(bx[3] for bx in boxes)
                out.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return out


def interp1(c, x):
    """Linear interpolation in a list of (x, y) sorted by x, extended linearly past the ends.
    Used only by the extractor's checks."""
    if x <= c[0][0]:
        return c[0][1] + (c[1][1] - c[0][1]) / (c[1][0] - c[0][0]) * (x - c[0][0])
    for (x0, y0), (x1, y1) in zip(c, c[1:]):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return c[-1][1] + (c[-1][1] - c[-2][1]) / (c[-1][0] - c[-2][0]) * (x - c[-1][0])


def dist_to_polyline(p, pts):
    """Shortest distance in page points from p to the polyline through pts."""
    px, py = p
    best = float('inf')
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
        qx, qy = x0 + t * dx, y0 + t * dy
        best = min(best, ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5)
    return best
