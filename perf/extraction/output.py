"""Outputs: the figure JSON, the committed page image, the review overlay and the manifest.

Everything that goes into perf/data/ is deterministic: sorted keys, fixed rounding, a PNG with
no timestamp, so a re-run with nothing changed is byte-identical."""
import hashlib
import io
import json
import os
import subprocess

import pymupdf
from PIL import Image, ImageDraw

import geom

PX_PER_PT = 2
RED = (230, 0, 0)
BLUE = (0, 120, 255)
GREEN = (0, 170, 0)


def dumps(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def figure_json(spec, panels):
    return {
        'schemaVersion': 1,
        'id': spec['id'],
        'figure': spec['figure'],
        'sheet': spec['sheet'],
        'title': spec['title'],
        'engine': spec['engine'],
        'pageIndex': spec['page_index'],
        'printedPage': spec['printed_page'],
        'image': {'file': f"pages/{spec['id']}.png", 'clipPt': list(spec['image_clip']), 'pxPerPt': PX_PER_PT},
        'corrections': list(spec.get('corrections', [])),
        'panels': panels,
    }


def page_png(page, clip):
    """The image_clip at 2 px/pt, greyscale, quantized to 16 colours, optimized PNG bytes."""
    pm = page.get_pixmap(matrix=pymupdf.Matrix(PX_PER_PT, PX_PER_PT), clip=pymupdf.Rect(*clip),
                         colorspace=pymupdf.csGRAY, alpha=False)
    assert pm.n == 1 and pm.stride == pm.width, "unexpected pixmap layout"
    im = Image.frombytes('L', (pm.width, pm.height), pm.samples).quantize(colors=16)
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def _xy(panel, inp, out, a, b):
    ti, to = panel['axes'][inp], panel['axes'][out]
    xy = {ti['page']: geom.to_page(ti, a), to['page']: geom.to_page(to, b)}
    return (xy['x'] * PX_PER_PT, xy['y'] * PX_PER_PT)


def _polyline(draw, pts, col):
    if len(pts) >= 2:
        draw.line(pts, fill=col, width=2)


DIRECTION_COLOUR = {'rises': RED, 'falls': BLUE, 'any': GREEN}


def overlay_png(page, spec, axes, panels):
    """The whole page with every extracted line drawn over it: curves and limit lines in red,
    guide lines by their family's declared direction (rises red, falls blue, any green), a scale
    pair's measured range as a green bar along its scale line, and every fitted tick position as a
    short red mark across its label band (an unscaled axis has none)."""
    pm = page.get_pixmap(matrix=pymupdf.Matrix(PX_PER_PT, PX_PER_PT), alpha=False)
    im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples)
    draw = ImageDraw.Draw(im)
    for name in sorted(spec['axes']):
        ax_spec = spec['axes'][name]
        if ax_spec.get('unscaled') is True:
            continue
        band = ax_spec['label_band']
        for t in ax_spec['ticks']:
            pos = geom.to_page(axes[name], t) * PX_PER_PT
            if ax_spec['page'] == 'x':
                draw.line([(pos, band[0] * PX_PER_PT - 6), (pos, band[0] * PX_PER_PT - 1)], fill=RED, width=2)
            else:
                draw.line([(band[1] * PX_PER_PT + 1, pos), (band[1] * PX_PER_PT + 6, pos)], fill=RED, width=2)
    specs = {p['id']: p for p in spec['panels']}
    for panel in panels:
        kind = panel['type']
        if kind == 'curve_family':
            inp, out = panel['input']['name'], panel['output']['name']
            for c in panel['curves']:
                _polyline(draw, [_xy(panel, inp, out, a, b) for a, b in c['points']], RED)
        elif kind in ('single_curve', 'limit_line'):
            inp, out = panel['input']['name'], panel['output']['name']
            _polyline(draw, [_xy(panel, inp, out, a, b) for a, b in panel['points']], RED)
        elif kind == 'guideline_panel':
            inp, out = panel['input']['name'], panel['output']['name']
            declared = specs[panel['id']]['families']
            for fam in sorted(panel['families']):
                col = DIRECTION_COLOUR[declared[fam]]
                for ln in panel['families'][fam]:
                    _polyline(draw, [_xy(panel, inp, out, a, b) for a, b in ln], col)
        elif kind == 'scale_pair':
            to = panel['to']['name']
            tr = panel['axes'][to]
            clip = specs[panel['id']]['scale_line']
            lo, hi = (geom.to_page(tr, v) * PX_PER_PT for v in panel['range'])
            if tr['page'] == 'x':
                y = (clip[1] + clip[3]) / 2 * PX_PER_PT
                draw.line([(lo, y), (hi, y)], fill=GREEN, width=3)
            else:
                x = (clip[0] + clip[2]) / 2 * PX_PER_PT
                draw.line([(x, lo), (x, hi)], fill=GREEN, width=3)
        # table panels have no lines.
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def write_bytes(path, data):
    """Write a file, leaving it untouched when it already holds exactly these bytes."""
    if os.path.exists(path):
        with open(path, 'rb') as f:
            if f.read() == data:
                return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def extractor_commit(extraction_dir):
    """`git rev-parse --short HEAD`, with "-dirty" if perf/extraction/ has uncommitted changes
    (tracked or untracked; extraction/out/ excluded)."""
    head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=extraction_dir,
                          capture_output=True, text=True, check=True).stdout.strip()
    status = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=all', '--', '.',
                             ':(exclude)out', ':(exclude)**/__pycache__/**'],
                            cwd=extraction_dir, capture_output=True, text=True, check=True).stdout
    return head + ('-dirty' if status.strip() else '')


def write_manifest(dataset_dir, dataset, pdf_sha, extraction_dir):
    """Hash every .json (not the manifest) and pages/*.png in the dataset dir.

    dataVersion starts at 1 and goes up by one only when a file hash (or the file set, or the
    PDF hash) differs from the previous manifest. The previous manifest is kept byte-identical
    when nothing differs and its extractorCommit is clean; otherwise it is rewritten with the
    current extractorCommit. Returns (manifest, rewritten)."""
    files = {}
    for name in sorted(os.listdir(dataset_dir)):
        if name.endswith('.json') and name != 'manifest.json':
            files[name] = sha256_file(os.path.join(dataset_dir, name))
    pages = os.path.join(dataset_dir, 'pages')
    if os.path.isdir(pages):
        for name in sorted(os.listdir(pages)):
            if name.endswith('.png'):
                files[f'pages/{name}'] = sha256_file(os.path.join(pages, name))
    path = os.path.join(dataset_dir, 'manifest.json')
    prev = None
    if os.path.exists(path):
        with open(path) as f:
            prev = json.load(f)
    same = prev is not None and prev.get('files') == files and prev.get('pdfSha256') == pdf_sha \
        and prev.get('dataset') == dataset
    if same and not prev['extractorCommit'].endswith('-dirty'):
        return prev, False
    version = 1 if prev is None else (prev['dataVersion'] if same else prev['dataVersion'] + 1)
    manifest = {
        'schemaVersion': 1,
        'dataset': dataset,
        'dataVersion': version,
        'pdfSha256': pdf_sha,
        'extractorCommit': extractor_commit(extraction_dir),
        'files': files,
    }
    write_bytes(path, dumps(manifest))
    return manifest, True
