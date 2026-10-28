#!/usr/bin/env python3
"""RENAME-A commit 1: the file moves of rename-map §6 (+ board/ops/carrier-transfer.js), with every path
specifier, <link>/<script> path, path-in-a-list and file-name pointer rewritten BY PATH (never by token).
Run from the repo root. Idempotent only before the moves (it git-mv's)."""
import re, subprocess, os

MOVES = [
  ('crc-sync/src/efsp/station-coverage.js', 'crc-sync/src/efsp/position-coverage.js'),
  ('crc-sync/tests/efsp-station-coverage.test.mjs', 'crc-sync/tests/efsp-position-coverage.test.mjs'),
  ('crc-sync/src/efsp/fdr-store.js', 'crc-sync/src/efsp/flight-data-store.js'),
  ('crc-sync/tests/efsp-fdr-store.test.mjs', 'crc-sync/tests/efsp-flight-data-store.test.mjs'),
  ('crc-sync/tests/efsp-fdr-ato.test.mjs', 'crc-sync/tests/efsp-flight-data-ato.test.mjs'),
  ('crc-sync/src/efsp/field-state.js', 'crc-sync/src/efsp/runway-status.js'),
  ('crc-sync/src/efsp/field-state-store.js', 'crc-sync/src/efsp/runway-status-store.js'),
  ('crc-sync/src/efsp/wire/families/field-state.js', 'crc-sync/src/efsp/wire/families/runway-status.js'),
  ('crc-sync/tests/efsp-field-state.test.mjs', 'crc-sync/tests/efsp-runway-status.test.mjs'),
  ('crc-sync/tests/efsp-field-state-l1b.test.mjs', 'crc-sync/tests/efsp-runway-status-l1b.test.mjs'),
  ('crc-sync/tests/efsp-scenario-field-state.test.mjs', 'crc-sync/tests/efsp-scenario-runway-status.test.mjs'),
  ('crc-sync/src/stca.js', 'crc-sync/src/conflict-alert.js'),
  ('crc-sync/tests/stca.test.mjs', 'crc-sync/tests/conflict-alert.test.mjs'),
  ('crc-sync/src/efsp/carrier/transfers.js', 'crc-sync/src/efsp/carrier/handoffs.js'),
  ('crc-sync/src/efsp/carrier/transfer-effects.js', 'crc-sync/src/efsp/carrier/handoff-effects.js'),
  ('crc-sync/tests/efsp-carrier-transfers.test.mjs', 'crc-sync/tests/efsp-carrier-handoffs.test.mjs'),
  ('crc-sync/src/efsp/board/ops/carrier-transfer.js', 'crc-sync/src/efsp/board/ops/carrier-handoff.js'),
  ('crc-sync/tests/efsp-carrier-roles.test.mjs', 'crc-sync/tests/efsp-carrier-strip-types.test.mjs'),
  ('crc-sync/src/efsp/authority/roles', 'crc-sync/src/efsp/authority/strip-types'),
  ('crc-desktop/app/public/css/field-state-panel.css', 'crc-desktop/app/public/css/runway-status-panel.css'),
  ('crc-desktop/app/public/js/panels/efsp/field-state-panel.js', 'crc-desktop/app/public/js/panels/efsp/runway-status-panel.js'),
  ('crc-desktop/app/public/js/panels/efsp/field-state-rules.js', 'crc-desktop/app/public/js/panels/efsp/runway-status-rules.js'),
  ('crc-desktop/e2e/field-state.spec.js', 'crc-desktop/e2e/runway-status.spec.js'),
  ('crc-desktop/tests/efsp-field-state-client.test.mjs', 'crc-desktop/tests/efsp-runway-status-client.test.mjs'),
]

Q = r"""['"`]"""
# (regex, replacement): a path reference = a basename with its extension, or a specifier ending in a quote after '/'.
SUBS = [
  (r'(?<![\w-])station-coverage(?=\.js\b|\.test\.mjs\b|' + Q + ')', 'position-coverage', '/'),
  (r'(?<![\w-])efsp-station-coverage(?=\.test\.mjs\b)', 'efsp-position-coverage', None),
  (r'(?<![\w-])fdr-store(?=\.js\b|' + Q + ')', 'flight-data-store', '/'),
  (r'(?<![\w-])efsp-fdr-store(?=\.test\.mjs\b)', 'efsp-flight-data-store', None),
  (r'(?<![\w-])efsp-fdr-ato(?=\.test\.mjs\b)', 'efsp-flight-data-ato', None),
  (r'(?<![\w-])field-state-store(?=\.js\b|' + Q + ')', 'runway-status-store', '/'),
  (r'(?<![\w-])field-state-panel(?=\.js\b|\.css\b)', 'runway-status-panel', None),
  (r'(?<![\w-])field-state-rules(?=\.js\b)', 'runway-status-rules', None),
  (r'(?<![\w-])field-state(?=\.js\b|\.spec\.js\b|' + Q + ')', 'runway-status', '/'),
  (r'(?<![\w-])efsp-field-state(?=\.test\.mjs\b)', 'efsp-runway-status', None),
  (r'(?<![\w-])efsp-field-state-l1b(?=\.test\.mjs\b)', 'efsp-runway-status-l1b', None),
  (r'(?<![\w-])efsp-scenario-field-state(?=\.test\.mjs\b)', 'efsp-scenario-runway-status', None),
  (r'(?<![\w-])efsp-field-state-client(?=\.test\.m?js\b)', 'efsp-runway-status-client', None),
  (r'(?<![\w-])stca(?=\.js\b|\.test\.mjs\b|' + Q + ')', 'conflict-alert', '/'),
  (r'(?<=carrier/)transfers(?=\.js\b|' + Q + ')', 'handoffs', None),
  (r"(?<=require\('\./)transfers(?=')", 'handoffs', None),
  (r'(?<![\w-])transfers\.js\b', 'handoffs.js', 'carrier'),
  (r'(?<![\w-])transfer-effects(?=\.js\b|' + Q + ')', 'handoff-effects', None),
  (r'(?<![\w-])efsp-carrier-transfers(?=\.test\.mjs\b)', 'efsp-carrier-handoffs', None),
  (r"(?<=/)carrier-transfer(?=')", 'carrier-handoff', None),
  (r'(?<![\w-])efsp-carrier-roles(?=\.test\.mjs\b)', 'efsp-carrier-strip-types', None),
  (r'(?<=authority/)roles(?=/|' + Q + ')', 'strip-types', None),
  (r"(?<=require\('\./)roles(?=/)", 'strip-types', 'authority'),
  (r'(?<=`)roles(?=/<role>\.js)', 'strip-types', None),
  (r'(?<=\s)roles(?=/<role>\.js)', 'strip-types', None),
]
# a '/'-guard means: for the quote-terminated (extensionless) form, require a '/' just before the name
def fix(text, path):
    out = text
    for rx, new, guard in SUBS:
        if guard == 'carrier' and '/carrier/' not in path: continue
        if guard == 'authority' and '/authority/' not in path: continue
        def rep(m, new=new, guard=guard):
            s, e = m.span(); nxt = out_[e:e+1]
            if guard == '/' and nxt in '\'"`' and out_[s-1:s] != '/': return m.group(0)
            return new
        out_ = out
        out = re.sub(rx, rep, out)
    return out

if __name__ == '__main__':
    import sys
    for old, new in MOVES:
        subprocess.run(['git', 'mv', old, new], check=True)
    files = subprocess.run(['git', 'ls-files', 'crc-sync', 'crc-desktop'], capture_output=True, text=True).stdout.split('\n')
    for f in files:
        if not f or f.endswith(('.md', 'package-lock.json')) or f.startswith('crc-sync/tests/freeze/golden/') or '/protos/' in f: continue
        if not os.path.isfile(f): continue
        try: t = open(f, encoding='utf-8').read()
        except UnicodeDecodeError: continue
        n = fix(t, f)
        if n != t: open(f, 'w', encoding='utf-8').write(n); print('rewrote', f)
