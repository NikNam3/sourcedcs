#!/usr/bin/env python3
"""S-RENA1 proof, step 3: compare the inverse-recorded goldens (new tree, old vocabulary) with the base goldens.
Per file: SAME (byte-identical), KEYORDER (equal once object keys are sorted: the harness sorts keys by their NEW
name before the inverse runs), STRSORT (also equal once string arrays are sorted: lists the harness sorts by the
NEW name), else DIFF with every differing line pair printed."""
import json, sys, os
new_dir, old_dir = sys.argv[1], sys.argv[2]
def norm(v, sort_str):
    if isinstance(v, dict): return {k: norm(v[k], sort_str) for k in sorted(v)}
    if isinstance(v, list):
        v = [norm(e, sort_str) for e in v]
        if sort_str and all(isinstance(e, str) for e in v): v = sorted(v)
        return v
    return v
def ddiff(a, b, p=''):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b: out.append((p + '.' + k, a.get(k, '<absent>'), b.get(k, '<absent>')))
            else: out += ddiff(a[k], b[k], p + '.' + k)
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in ddiff(x, y, f'{p}[{i}]')]
    return [] if a == b else [(p, a, b)]
def lines(p): return open(p, encoding='utf-8').read().split('\n')
for f in sorted(os.listdir(old_dir)):
    a, b = os.path.join(new_dir, f), os.path.join(old_dir, f)
    if open(a, 'rb').read() == open(b, 'rb').read(): print('SAME    ', f); continue
    la, lb = lines(a), lines(b)
    verdict, bad = 'KEYORDER', []
    for i, (x, y) in enumerate(zip(la, lb)):
        if x == y: continue
        try:
            px, py = json.loads(x.strip().rstrip(',')), json.loads(y.strip().rstrip(','))
        except Exception:
            bad.append((i + 1, x, y)); continue
        if norm(px, False) == norm(py, False): continue
        if norm(px, True) == norm(py, True): verdict = 'STRSORT'; continue
        bad.append((i + 1, x, y))
    if len(la) != len(lb): bad.append((0, f'{len(la)} lines', f'{len(lb)} lines'))
    print(('DIFF    ' if bad else verdict.ljust(8)), f, f'({len(bad)} lines)' if bad else '')
    for n, x, y in bad[:int(os.environ.get('SHOW', '3'))]:
        try:
            px, py = norm(json.loads(x.strip().rstrip(',')), True), norm(json.loads(y.strip().rstrip(',')), True)
            for path, u, w in ddiff(px, py)[:4]: print(f'   line {n} {path}\n     new: {str(u)[:300]}\n     old: {str(w)[:300]}')
        except Exception:
            print(f'   line {n}\n     new: {x.strip()[:300]}\n     old: {y.strip()[:300]}')
