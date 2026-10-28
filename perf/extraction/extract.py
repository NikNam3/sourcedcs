"""Spec-driven chart extractor for the F-16 TOLD calculator (docs/wip/TOLD.md, step 0).

Usage, run in perf/:  python3 -I extraction/extract.py <pdf> [id ...]
No ids: every spec in extraction/specs/. Paths resolve from this script's own directory.

The spec (extraction/specs/<id>.yaml) declares meaning; the extractor only measures. Every
step asserts a check; the first failed assert stops the run with "<id> panel <panel>: <reason>"
(or "<id> axis <axis>: ..." / "<id> spec: ...") and nothing is written."""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import yaml  # noqa: E402

import geom  # noqa: E402
import output  # noqa: E402
import panels  # noqa: E402

PDF_SHA256 = '7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b'
SPECS = os.path.join(HERE, 'specs')
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))
OUT = os.path.join(HERE, 'out')
REQUIRED = ('id', 'figure', 'sheet', 'dataset', 'title', 'engine', 'page_index', 'printed_page',
            'must_contain', 'image_clip', 'axes', 'panels')
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
    missing = [k for k in REQUIRED if k not in spec]
    if missing:
        fail(f'{fid} spec: missing keys {missing}')
    if spec['id'] != fid:
        fail(f"{fid} spec: id is {spec['id']!r}, file is {fid}.yaml")
    return spec


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
    is the axis's title."""
    for name in sorted(spec['axes']):
        ax = spec['axes'][name]
        if 'title' not in ax or ax.get('edge') not in EDGES:
            fail(f'{fid} axis {name}: needs a title and an edge (one of {EDGES})')
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
    text = page.get_text()
    for s in spec['must_contain']:
        if s not in text:
            fail(f'{fid} spec: {s!r} is not on page index {spec["page_index"]}')
    axes = {}
    for name in sorted(spec['axes']):
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
    parts = [f"{n} resid {res['axes'][n]['resid']:.3f}" for n in sorted(res['axes'])]
    print(f"{spec['id']}: axes " + ', '.join(parts))
    for p in res['panels']:
        if p['type'] == 'curve_family':
            info = f"{len(p['curves'])} curves, {sum(len(c['points']) for c in p['curves'])} points"
        elif p['type'] == 'single_curve':
            info = f"1 curve, {len(p['points'])} points"
        elif p['type'] == 'scale_pair':
            info = f"{p['to']['name']} = {p['a']} * {p['from']['name']} + {p['b']}"
        else:
            info = ''
        print(f"  panel {p['id']} ({p['type']}): {info}")


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
    import pymupdf
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
    for ds in sorted(datasets):
        m, rewritten = output.write_manifest(os.path.join(DATA, ds), ds, sha, HERE)
        state = 'rewritten' if rewritten else 'unchanged'
        print(f"manifest {ds}: dataVersion {m['dataVersion']}, extractorCommit {m['extractorCommit']}, "
              f"{len(m['files'])} files ({state})")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
