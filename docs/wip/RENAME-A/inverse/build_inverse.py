#!/usr/bin/env python3
"""S-RENA1 proof, step 1: the inverse of rename-map §7 (new token -> old token) as JSON for inverse-lib.mjs.
Usage (repo root): python3 build_inverse.py <old-golden-dir> > inverse.json"""
import json, re, sys, glob, collections
TOK = re.compile(r'[A-Za-z0-9_$-]+')
blk = open('docs/parallel/refactor/rename-map.md', encoding='utf-8').read().split('<!-- MAP:BEGIN -->')[1].split('<!-- MAP:END -->')[0]
rows = [dict(zip(['row', 'op', 'mode', 'cls', 'old', 'new'], l.split('\t')[:6])) for l in blk.splitlines() if re.match(r'N\d\dP?\t', l)]
rows = [r for r in rows if r['op'] in '=?~' and not r['row'].endswith('P') and r['cls'] != 'P']
exact, cand = {}, collections.defaultdict(list)
for r in rows:
    if r['op'] in '=?' and r['mode'] in ('tok', 'lit') and ' ' not in r['old'] and ' ' not in r['new']:
        cand[r['new']].append(r)
for new, rs in cand.items():   # a new token two old ones map to: prefer the W row (the one a golden can hold)
    rs.sort(key=lambda r: (r['cls'] != 'W', r['cls'] == '*'))
    exact[new] = rs[0]['old']
exact['staffed'] = 'manned'          # 'occupied' (Position sense) never reaches a golden; 'manned' does (SFA refusal)
stems = [(r['new'], r['old']) for r in rows if r['op'] == '~']
parts = [(r['new'], r['old']) for r in rows if r['mode'] == 'part']
# The one deliberate wording change in the wire commit (S-RENA0 (4)): declared, so its cascade into the persisted
# snapshot hashes is checked rather than listed line by line.
two = [('unknown strip type', 'unknown Strip Role')] + [(r['new'], r['old']) for r in rows if r['op'] in '=?' and ' ' in r['new'] and r['cls'] != 'U']
old_tokens = sorted({t for f in glob.glob(sys.argv[1] + '/*.json') for t in TOK.findall(open(f, encoding='utf-8').read())})
json.dump({'exact': exact, 'stems': stems, 'parts': parts, 'two': two, 'oldTokens': old_tokens}, sys.stdout)
