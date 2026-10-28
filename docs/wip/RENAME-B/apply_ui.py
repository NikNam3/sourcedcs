#!/usr/bin/env python3
"""Apply docs/wip/RENAME-B/ui-replace.tsv: replace OLD by NEW on the named line only; fail if OLD is not on that line."""
import sys
bad = 0
for row in open(sys.argv[1] if len(sys.argv)>1 else 'docs/wip/RENAME-B/ui-replace.tsv', encoding='utf-8'):
    key, old, new = row.rstrip('\n').split('\t')
    if new.startswith('KEEP'): continue
    path, ln = key.rsplit(':', 1); ln = int(ln)
    lines = open(path, encoding='utf-8').read().split('\n')
    if old not in lines[ln - 1]:
        print('MISSING', key, old); bad += 1; continue
    lines[ln - 1] = lines[ln - 1].replace(old, new)
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
sys.exit(1 if bad else 0)
