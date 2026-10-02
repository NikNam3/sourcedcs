#!/usr/bin/env python3
"""RENAME tool (W7). Copy it to your scratchpad; run from the repo root.

  python3 rename_tool.py count  [--tokens] [--sites ROW]       # step 0: counts per row and area, derived classes
  python3 rename_tool.py review ROW --area A|B|C|D > file.tsv   # site list for a '?' row, to mark Y/N
  python3 rename_tool.py apply  --lane A|B|C --kind structural|wire [--rows N04,N05] [--dry]

The table is read from docs/parallel/refactor/rename-map.md (between MAP:BEGIN and MAP:END). Review decisions are read
from docs/wip/RENAME-*/review-*.tsv (path:line:text#n<TAB>Y|N<TAB>why). Lines never move under a rename, so a review file stays valid across the
other rows' commits; make it after the file moves (a moved file's sites carry the new path)."""
import collections, glob, os, re, subprocess, sys

MAP = 'docs/parallel/refactor/rename-map.md'
D_DOCS = {'CLAUDE.md', 'README.md', 'EFSPImplementationGuide.md', 'crc-desktop/README.md', 'crc-sync/README.md',
          'infra/RUNBOOK.md', 'docs/efsp-usage-guide.md', 'docs/efsp-briefing.md', 'docs/glossary.md'}
NEVER = ('docs/adr/', 'docs/wip/', 'docs/parallel/', 'docs/ui-findings/', 'docs/atobrief/', '.junie/', 'lxsrs_v2/',
         'crc-desktop/python-pkg/', 'atobrief/', 'tools/', 'infra/tests/fixtures/')
TOK = re.compile(r'[A-Za-z0-9_$-]+')
OWNER = {'W': 'A', 'S': 'A', 'A': 'A', 'B': 'B', 'U': 'B', 'E': 'C', 'K': 'C', 'C': 'C', 'P': None}

def area(f):
    if not f or f.endswith('package-lock.json') or '/protos/' in f or f.startswith(NEVER): return None
    if f.endswith('.md'): return 'D' if f in D_DOCS else None
    if f.startswith('crc-sync/tests/freeze/golden/'): return 'G'
    if f.startswith(('crc-sync/config/', 'crc-sync/data/')): return 'C'
    if f.startswith('crc-sync/'): return 'A'
    if f.startswith(('crc-desktop/app/', 'crc-desktop/e2e/', 'crc-desktop/tests/')) or f == 'crc-desktop/playwright.config.js':
        return 'B'
    if f.startswith('sourcedcs-web/'): return 'Cweb'          # env rows (E) only: Discord/Casdoor roles live here
    if f.startswith(('infra/', '.github/')) or f in ('.env.example', 'crc-desktop/main.js'): return 'C'
    return None

def load_rows():
    block = open(MAP, encoding='utf-8').read().split('<!-- MAP:BEGIN -->')[1].split('<!-- MAP:END -->')[0]
    rows = []
    for line in block.splitlines():
        p = line.split('\t')
        if len(p) >= 6 and re.match(r'N\d\dP?$', p[0]):
            rows.append(dict(row=p[0], op=p[1], mode=p[2], cls=p[3], old=p[4], new=p[5], note=p[6] if len(p) > 6 else ''))
    return rows

def lit_re(t):
    e = re.escape(t)
    # a whole quoted value, an object key, or a property after an identifier/`)`/`]` (never a spread `...X`)
    return re.compile(r"""(['"`])%s\1|(?<![\w$.-])%s(?=\s*:)|(?<=[\w$)\]]\.)%s(?![\w$-])""" % (e, e, e))

def part_re(t):
    # the token as one '-', '_' or ':' delimited part of a longer token ('c-TWR', 'TWR-occupancy', 'ctl:TWR')
    return re.compile(r'(?:(?<=[-_:])%s(?=$|[-_:])|^%s(?=[-_:]))' % (re.escape(t), re.escape(t)))

def site_key(f, txt, start, text):
    # path:line:text#n, n = which occurrence of `text` on that line (1-based). Renames never add or remove lines and
    # a '?' token belongs to one row only, so the key survives other rows' edits on the same line (not a file move).
    ls = txt.rfind('\n', 0, start) + 1; seg = txt[ls:start]
    n = sum(1 for t in TOK.findall(seg) if t == text) if TOK.fullmatch(text) else seg.count(text)
    return f"{f}:{txt.count(chr(10), 0, start) + 1}:{text}#{n + 1}"

def tree():
    out = []
    for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split('\n'):
        a = area(f)
        if not a or not os.path.isfile(f): continue
        try: out.append((f, a, open(f, encoding='utf-8').read()))
        except UnicodeDecodeError: pass
    return out

class Table:
    def __init__(self, rows):
        self.rows = rows
        olds = {r['old'] for r in rows if r['op'] != '!' and not r['row'].endswith('P')}
        chains = [r for r in rows if r['op'] != '!' and r['new'] in olds and r['new'] != r['old']]
        if chains:   # a row whose result another row would rename again: apply would not be idempotent
            sys.exit('CHAIN in the table: ' + ', '.join(f"{r['row']} {r['old']}->{r['new']}" for r in chains))
        self.exact = {r['old']: r for r in rows if r['mode'] == 'tok' and r['op'] in '=?!' and ' ' not in r['old']}
        self.stems = [r for r in rows if r['op'] == '~']
        self.lits = [r for r in rows if r['mode'] == 'lit' or ' ' in r['old']]
        self.parts = [(r, part_re(r['old'])) for r in rows if r['mode'] == 'part']
    def match(self, t):
        r = self.exact.get(t)
        if r: return r
        for s in self.stems:
            if s['old'] in t: return s
        for p, rx in self.parts:
            if rx.search(t): return p
        return None
    def new_token(self, r, t):
        if r['mode'] == 'part':
            return part_re(r['old']).sub(r['new'], t)
        return r['new'] if r['op'] in '=?' else t.replace(r['old'], r['new'])

def presence(files, table):
    pres = collections.defaultdict(set)           # token -> areas it occurs in
    for f, a, txt in files:
        for t in set(TOK.findall(txt)):
            if table.match(t): pres[t].add('C' if a == 'Cweb' else a)
    return pres

def derive(r, t, pres):
    if r['cls'] != '*': return r['cls']
    p = pres.get(t, set())
    return 'W' if 'G' in p else 'S' if {'A', 'B'} <= p else 'A' if 'A' in p else 'B' if 'B' in p else 'C'

def cmd_count(args):
    table = Table(load_rows()); files = tree(); pres = presence(files, table)
    cnt = collections.defaultdict(collections.Counter); comp = collections.defaultdict(collections.Counter)
    for f, a, txt in files:
        web = a == 'Cweb'; a = 'C' if web else a
        for t in TOK.findall(txt):
            r = table.match(t)
            if not r or (web and r['cls'] != 'E'): continue
            cnt[id(r)][a] += 1
            if r['op'] == '~': comp[r['old']][(t, derive(r, t, pres))] += 1
        for r in table.lits:
            if web and r['cls'] != 'E': continue
            n = len(lit_re(r['old']).findall(txt)) if r['mode'] == 'lit' else txt.count(r['old'])
            cnt[id(r)][a] += n
    lanes = collections.Counter()
    print('row op old -> new | cls | A B C D G')
    for r in table.rows:
        if r['op'] == '!': continue
        c = cnt[id(r)]; cls = derive(r, r['old'], pres) if r['op'] != '~' else '~'
        print(f"{r['row']} {r['op']} {r['old']} -> {r['new']} | {cls} | {c['A']} {c['B']} {c['C']} {c['D']} {c['G']}")
        if r['op'] == '?' and r['cls'] == 'P': lanes['prose sites (L20 comments; C docs)'] += sum(c.values()) - c['G']; continue
        if r['op'] == '?':
            for k in 'ABC': lanes[f'review sites in area {k}'] += c[k]
            lanes['C docs'] += c['D']; continue
        if r['op'] == '~': lanes['C docs'] += c['D']; continue      # stems: lanes split per compound below
        lanes['C docs'] += c['D']
        o = OWNER.get(cls)
        if cls == 'W': lanes['A wire commit'] += c['A'] + c['B'] + c['C']; lanes['G re-recorded'] += c['G']
        elif o == 'A': lanes['A structural'] += c['A'] + c['B'] + c['C']
        elif o == 'B': lanes['B'] += c['B']
        elif o == 'C': lanes['C code'] += c['A'] + c['B'] + c['C']
    for s, c in comp.items():                       # stems: split by the derived class of each compound
        for (t, k), n in c.items():
            if k == 'W': lanes['A wire commit (stems)'] += n
            elif OWNER.get(k) == 'A': lanes['A structural (stems)'] += n
            elif OWNER.get(k) == 'B': lanes['B (stems)'] += n
    print('\nLANE TOTALS (occurrences; stems listed separately):')
    for k, v in sorted(lanes.items()): print(f'  {k}: {v}')
    if '--tokens' in args:
        for s, c in comp.items():
            print(f'\nstem {s}: {len(c)} compounds')
            for (t, k), n in c.most_common(): print(f'  {k} {t} {n}')

def cmd_review(args):
    row = args[0]; want = args[args.index('--area') + 1] if '--area' in args else None
    table = Table(load_rows())
    for f, a, txt in tree():
        a = 'C' if a == 'Cweb' else a
        if a == 'G' or (want and a != want): continue
        lines = txt.splitlines()
        for m in TOK.finditer(txt):
            r = table.match(m.group(0))
            if r and r['row'] == row and r['op'] == '?' and r['mode'] != 'lit':
                k = site_key(f, txt, m.start(), m.group(0))
                print(f"{k}\t?\t{lines[int(k.split(':')[1]) - 1].strip()[:140]}")
        for r in table.lits:
            if r['row'] == row and r['op'] == '?':
                rx = lit_re(r['old']) if r['mode'] == 'lit' else re.compile(re.escape(r['old']))
                for m in rx.finditer(txt):
                    k = site_key(f, txt, m.start(), m.group(0))
                    print(f"{k}\t?\t{lines[int(k.split(':')[1]) - 1].strip()[:140]}")

def load_reviews():
    yes = set()
    for p in glob.glob('docs/wip/RENAME-*/review-*.tsv'):
        for line in open(p, encoding='utf-8'):
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 2 and parts[1] == 'Y': yes.add(parts[0])
    return yes

def cmd_apply(args):
    lane = args[args.index('--lane') + 1]; kind = args[args.index('--kind') + 1]
    only = set(args[args.index('--rows') + 1].split(',')) if '--rows' in args else None
    dry = '--dry' in args
    table = Table(load_rows()); files = tree(); pres = presence(files, table); yes = load_reviews()
    def wanted(r, t):
        if only and r['row'] not in only: return False
        if r['row'].endswith('P') and not only: return False     # pre-renames run once, named explicitly
        if r['op'] == '!' or r['cls'] == 'P': return False
        cls = derive(r, t, pres)
        if lane == 'C' and kind == 'docs': return True
        if OWNER.get(cls) != lane: return False
        return (cls == 'W') == (kind == 'wire')
    errors = 0; warns = 0; changed = 0
    for f, a, txt in files:
        if a == 'G': continue
        if a == 'D' and not (lane == 'C' and kind == 'docs'): continue
        if a != 'D' and lane == 'C' and kind == 'docs': continue
        web = a == 'Cweb'
        merges = collections.defaultdict(set); before = set(TOK.findall(txt))
        def sub_tok(m):
            t = m.group(0); r = table.match(t)
            if not r or (web and r['cls'] != 'E') or not wanted(r, t): return t
            if r['op'] == '?' and site_key(f, txt, m.start(), t) not in yes: return t
            n = table.new_token(r, t); merges[n].add(t); return n
        out = TOK.sub(sub_tok, txt)
        for r in table.lits:
            if web and r['cls'] != 'E': continue
            if not wanted(r, r['old']): continue
            prev = out
            if r['mode'] == 'lit':
                src = out          # '?' lit rows: keys are computed on the text this row starts from
                def rep(m, r=r, src=src):
                    if r['op'] == '?' and site_key(f, src, m.start(), m.group(0)) not in yes: return m.group(0)
                    return m.group(0).replace(r['old'], r['new'])
                out = lit_re(r['old']).sub(rep, src)
            else:
                out = out.replace(r['old'], r['new'])
            if out != prev: merges[r['new']].add(r['old'])
        for n, olds in merges.items():
            if len(olds) > 1 and not f.endswith('.md'):
                print(f'MERGE {f}: {sorted(olds)} -> {n}'); errors += 1
            elif n in before and n not in olds:
                print(f'WARN {f}: {n} already in the file (from {sorted(olds)}): check it is the same meaning'); warns += 1
        if out != txt:
            changed += 1
            if not dry: open(f, 'w', encoding='utf-8').write(out)
    print(f'{changed} files {"would change" if dry else "changed"}; {errors} merges (fatal); {warns} warnings')
    sys.exit(1 if errors else 0)

if __name__ == '__main__':
    cmd = sys.argv[1]; rest = sys.argv[2:]
    {'count': cmd_count, 'review': cmd_review, 'apply': cmd_apply}[cmd](rest)
