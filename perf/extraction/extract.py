"""Spec-driven chart extractor for the F-16 TOLD calculator (docs/wip/TOLD.md, step 0).

Usage, run in perf/:  python3 -I extraction/extract.py <pdf> [id ...]
No ids: every spec in extraction/specs/. Paths resolve from this script's own directory.

The spec (extraction/specs/<id>.yaml) declares meaning; the extractor only measures. Every
step asserts a check; the first failed assert stops the run with "<id> panel <panel>: <reason>"
(or "<id> axis <axis>: ..." / "<id> spec: ...") and nothing is written.

Outputs: perf/data/<dataset>/<id>.json, pages/<id>.png and manifest.json; extraction/out/
overlay-<id>.png; and, for a figure with table panels, extraction/out/<figure>-tables.txt, every
table of this run as aligned text for the human comparison with the pages."""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pymupdf  # noqa: E402
import yaml  # noqa: E402

import geom  # noqa: E402
import output  # noqa: E402
import panels  # noqa: E402

PDF_SHA256 = '7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b'
SPECS = os.path.join(HERE, 'specs')
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
OUT = os.path.join(HERE, 'out')
REQUIRED = {'id', 'figure', 'sheet', 'dataset', 'title', 'engine', 'page_index', 'printed_page',
            'must_contain', 'image_clip', 'axes', 'panels'}
OPTIONAL = {'corrections', 'sample_problems'}
AXIS_REQUIRED = {'unit', 'page', 'label_band', 'range', 'ticks', 'title', 'edge'}
AXIS_OPTIONAL = {'snap'}
# An unscaled axis (the line carried from one panel into the next) has no labels to fit: values
# are page points. It takes only these keys, unit pt and unscaled true.
AXIS_UNSCALED = {'unit', 'page', 'unscaled'}
UNSCALED_FIT = {'a': 1.0, 'b': 0.0, 'resid': 0.0}
SAMPLE_KEYS = {'inputs', 'expected'}
EDGES = ('left', 'right', 'top', 'bottom')


class Failed(Exception):
    pass


def fail(msg):
    raise Failed(msg)


def load_spec(fid):
    path = os.path.join(SPECS, f'{fid}.yaml')
    if not os.path.exists(path):
        fail(f'{fid} spec: no file {path}')
    with open(path) as f:
        spec = yaml.safe_load(f)
    keys(f'{fid} spec', panels.check_keys, spec, REQUIRED, OPTIONAL)
    if spec['id'] != fid:
        fail(f"{fid} spec: id is {spec['id']!r}, file is {fid}.yaml")
    if not isinstance(spec['axes'], dict) or not isinstance(spec['panels'], list):
        fail(f'{fid} spec: axes must be a mapping and panels a list')
    for name in sorted(spec['axes']):
        ax = spec['axes'][name]
        if isinstance(ax, dict) and 'unscaled' in ax:
            keys(f'{fid} axis {name}', panels.check_keys, ax, AXIS_UNSCALED, set())
            if ax['unscaled'] is not True or ax['unit'] != 'pt' or ax['page'] not in ('x', 'y'):
                fail(f"{fid} axis {name}: an unscaled axis has unscaled: true, unit: pt and page x or y, "
                     f"not {ax['unscaled']!r}, {ax['unit']!r}, {ax['page']!r}")
        else:
            keys(f'{fid} axis {name}', panels.check_keys, ax, AXIS_REQUIRED, AXIS_OPTIONAL)
    for n, p in enumerate(spec['panels']):
        pid = p.get('id', f'#{n}') if isinstance(p, dict) else f'#{n}'
        keys(f'{fid} panel {pid}', panels.check_panel_keys, p)
    for n, s in enumerate(spec.get('sample_problems', [])):
        keys(f'{fid} spec', panels.check_keys, s, SAMPLE_KEYS, set(), f'sample_problems[{n}].')
    return spec


def keys(where, check, *args):
    try:
        check(*args)
    except AssertionError as e:
        fail(f'{where}: {e}')


def title_beyond(frame, edge, cx, cy):
    """True when (cx, cy) lies past the frame on `edge` and within the frame's span along it."""
    x0, x1 = min(frame['x']), max(frame['x'])
    y0, y1 = min(frame['y']), max(frame['y'])
    if edge == 'left':
        return cx < x0 and y0 <= cy <= y1
    if edge == 'right':
        return cx > x1 and y0 <= cy <= y1
    if edge == 'top':
        return cy < y0 and x0 <= cx <= x1
    return cy > y1 and x0 <= cx <= x1


def check_titles(page, spec, fid):
    """Each axis's title words must lie beyond the frame of every panel using that axis, on the
    axis's `edge`. With several occurrences of the title, the one nearest the axis's label band
    is the axis's title. An unscaled axis has no title and is skipped."""
    for name in sorted(spec['axes']):
        ax = spec['axes'][name]
        if panels.unscaled(ax):
            continue
        if ax['edge'] not in EDGES:
            fail(f"{fid} axis {name}: edge {ax['edge']!r} is not one of {EDGES}")
        found = geom.find_title(page, ax['title'])
        if not found:
            fail(f"{fid} axis {name}: title {ax['title']!r} not on the page")
        mid = sum(ax['label_band']) / 2
        k = 1 if ax['page'] == 'x' else 0
        cx, cy = min(found, key=lambda c: (abs(c[k] - mid), c))
        users = [p for p in spec['panels'] if name in panels.panel_axes(p) and 'frame' in p]
        if not users:
            fail(f'{fid} axis {name}: no panel with a frame uses it, so its title cannot be checked')
        for p in users:
            if not title_beyond(p['frame'], ax['edge'], cx, cy):
                fail(f"{fid} panel {p['id']}: axis {name} title {ax['title']!r} at "
                     f"({cx:.1f}, {cy:.1f}) is not beyond the frame's {ax['edge']} edge")


def extract_figure(doc, spec):
    fid = spec['id']
    page = doc[spec['page_index']]
    text = geom.page_text(page)
    for s in spec['must_contain']:
        if s not in text:
            fail(f'{fid} spec: {s!r} is not on page index {spec["page_index"]}')
    axes = {}
    for name in sorted(spec['axes']):
        if panels.unscaled(spec['axes'][name]):
            axes[name] = dict(UNSCALED_FIT)
            continue
        try:
            axes[name] = geom.fit_axis(page, spec['axes'][name])
        except AssertionError as e:
            fail(f'{fid} axis {name}: {e}')
    used = {a for p in spec['panels'] for a in panels.panel_axes(p)}
    unused = sorted(set(spec['axes']) - used)
    if unused:
        fail(f'{fid} spec: axes {unused} are used by no panel')
    check_titles(page, spec, fid)
    ids = [p['id'] for p in spec['panels']]
    if len(set(ids)) != len(ids):
        fail(f'{fid} spec: duplicate panel ids {ids}')
    out_panels = []
    for p in spec['panels']:
        try:
            out_panels.append(panels.extract_panel(page, spec, p, axes))
        except AssertionError as e:
            fail(f"{fid} panel {p['id']}: {e}")
    return {
        'spec': spec,
        'axes': axes,
        'json': output.dumps(output.figure_json(spec, out_panels)),
        'png': output.page_png(page, spec['image_clip']),
        'overlay': output.overlay_png(page, spec, axes, out_panels),
        'panels': out_panels,
    }


def summary(res):
    spec = res['spec']
    parts = [f"{n} unscaled" if panels.unscaled(spec['axes'][n]) else f"{n} resid {res['axes'][n]['resid']:.3f}"
             for n in sorted(res['axes'])]
    print(f"{spec['id']}: axes " + (', '.join(parts) or 'none'))
    for p in res['panels']:
        if p['type'] == 'curve_family':
            info = f"{len(p['curves'])} curves, {sum(len(c['points']) for c in p['curves'])} points"
        elif p['type'] == 'single_curve':
            info = f"1 curve, {len(p['points'])} points"
        elif p['type'] == 'scale_pair':
            info = f"{p['to']['name']} = {p['a']} * {p['from']['name']} + {p['b']}, drawn {p['to']['name']} {p['range']}"
        elif p['type'] == 'guideline_panel':
            info = ', '.join(f"{f} {len(ls)} lines" for f, ls in sorted(p['families'].items()))
        elif p['type'] == 'table':
            info = f"{len(p['rows'])} rows x {len(p['columns'])} columns"
        elif p['type'] == 'limit_line':
            pts = p['points']
            info = (f"{p['label']!r}, beyond {p['beyond']}, {len(pts)} points, "
                    f"{p['input']['name']} [{pts[0][0]}, {pts[-1][0]}]")
        else:
            info = ''
        print(f"  panel {p['id']} ({p['type']}): {info}")


def cell_text(v):
    return '-' if v is None else str(v)


def table_text(res, p):
    """One table as aligned text under a heading naming the sheet and its page, for the human
    comparison with the printed page (null cells print as '-')."""
    spec = res['spec']
    sheet = '' if spec['sheet'] is None else f" sheet {spec['sheet']}"
    head = [f"{c['name']}" + (f" ({c['unit']})" if c['unit'] else '') for c in p['columns']]
    body = [[cell_text(v) for v in r] for r in p['rows']]
    widths = [max(len(x) for x in col) for col in zip(head, *body)]
    fmt = lambda cells: '  '.join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()  # noqa: E731
    out = [f"## {spec['figure']}{sheet}, page index {spec['page_index']} (printed {spec['printed_page']}): "
           f"{spec['id']} table {p['id']}, {len(p['rows'])} rows x {len(p['columns'])} columns", '',
           fmt(head), fmt(['-' * w for w in widths])]
    out += [fmt(r) for r in body]
    return '\n'.join(out) + '\n'


def tables_text(results):
    """Every table of the run, per figure: {figure: text}."""
    by_fig = {}
    for res in results:
        for p in res['panels']:
            if p['type'] == 'table':
                by_fig.setdefault(res['spec']['figure'], []).append(table_text(res, p))
    head = (f"# Figure {{}} tables, one section per table, from extraction/extract.py. Null cells print as '-'.\n"
            "# Compare each section with the page index named in its heading.\n\n")
    return {f: head.format(f) + '\n'.join(ts) for f, ts in by_fig.items()}


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    pdf, ids = argv[1], argv[2:]
    if not ids:
        ids = sorted(n[:-5] for n in os.listdir(SPECS) if n.endswith('.yaml'))
    sha = output.sha256_file(pdf)
    if sha != PDF_SHA256:
        print(f'refused: PDF SHA-256 mismatch: {pdf} is {sha}, pinned {PDF_SHA256}', file=sys.stderr)
        return 2
    doc = pymupdf.open(pdf)
    try:
        results = [extract_figure(doc, load_spec(fid)) for fid in ids]
    except Failed as e:
        print(f'FAILED {e}', file=sys.stderr)
        print('nothing written', file=sys.stderr)
        return 1
    datasets = set()
    for res in results:
        spec = res['spec']
        ddir = os.path.join(DATA, spec['dataset'])
        output.write_bytes(os.path.join(ddir, f"{spec['id']}.json"), res['json'])
        output.write_bytes(os.path.join(ddir, 'pages', f"{spec['id']}.png"), res['png'])
        output.write_bytes(os.path.join(OUT, f"overlay-{spec['id']}.png"), res['overlay'])
        datasets.add(spec['dataset'])
        summary(res)
    for fig, text in sorted(tables_text(results).items()):
        print()
        print(text, end='')
        path = os.path.join(OUT, f'{fig}-tables.txt')
        output.write_bytes(path, text.encode())
        print(f'tables written to {os.path.relpath(path)}')
    for ds in sorted(datasets):
        m, rewritten = output.write_manifest(os.path.join(DATA, ds), ds, sha, HERE)
        state = 'rewritten' if rewritten else 'unchanged'
        print(f"manifest {ds}: dataVersion {m['dataVersion']}, extractorCommit {m['extractorCommit']}, "
              f"{len(m['files'])} files ({state})")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
