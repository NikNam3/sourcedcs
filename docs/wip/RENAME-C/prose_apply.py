#!/usr/bin/env python3
"""Apply a prose TSV (line<TAB>old fragment<TAB>new fragment, or KEEP<TAB>why) and fail if the fragment is gone.
usage: prose_apply.py DOC TSV   |  rules mode: prose_apply.py DOC --rules (mechanical regex rules below)"""
import re, sys
doc, tsv = sys.argv[1], sys.argv[2]
L = open(doc).read().split('\n')
n = 0
for row in open(tsv):
    row = row.rstrip('\n')
    if not row or row.startswith('#'): continue
    p = row.split('\t')
    if len(p) < 3 or p[1] == 'KEEP' or p[0] == 'KEEP': continue
    ln, old, new = int(p[0]), p[1], p[2]
    if old not in L[ln-1]:
        sys.exit(f'FAIL {doc}:{ln}: fragment not found: {old!r}\n  line: {L[ln-1][:200]}')
    L[ln-1] = L[ln-1].replace(old, new, 1); n += 1
open(doc, 'w').write('\n'.join(L))
print(doc, n, 'edits')
