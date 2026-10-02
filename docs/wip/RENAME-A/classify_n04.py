# N04 `held` area A. Y = the Position list a controller is signed on to: the efsp-set-positions/efsp-positions-ack
# field, the coverage held list, setHeldPositions' {held} result, and locals/params that carry that list.
# N = English prose in comments/test titles (L20), held Strips/codes/tracks/contacts/frequencies, the HELD sense.
import re, sys
S = sys.argv[1]
YLINES = {  # code lines whose `held` locals carry the signed-on Position list (not caught by the field pattern)
  'crc-sync/src/efsp/efsp-ws.js': {'259', '261', '328', '332', '334'},
  'crc-sync/src/efsp/position-coverage.js': {'109', '114', '117', '135', '142', '166', '169'},
  'crc-sync/src/efsp/position-store.js': {'109', '133', '203', '204'},
  'crc-sync/src/efsp/read-scope.js': {'20', '25', '26', '27', '29'},
  'crc-sync/tests/efsp-position-coverage.test.mjs': {'61', '62'},
  'crc-sync/tests/efsp-ws-coordination.test.mjs': {'85', '86'},
  'crc-sync/tests/efsp-ws.test.mjs': {'95', '96'},
  'crc-sync/tests/freeze/freeze-world.mjs': {'155', '156'},
  'crc-sync/tests/helpers/efsp-scenario.mjs': {'28', '29'},
  'crc-sync/tests/ws-hub-read-scope.test.mjs': {'51', '56'},
  'crc-sync/tests/ws-hub-coverage.test.mjs': {'40', '231', '237'},
  'crc-sync/tools/soak/driver.js': {'885', '886', '897', '898', '904', '905', '906', '907', '1240', '1242'},
}
out = []
for l in open(S + '/raw-N04.tsv'):
    k, _, ctx = l.rstrip('\n').split('\t', 2)
    f, ln, rest = k.split(':', 2); n = int(rest.rsplit('#', 1)[1])
    ctx = open(f, encoding='utf-8').read().split('\n')[int(ln) - 1]   # the full line, not the 140-char preview
    y = ln in YLINES.get(f, ())
    if 'efsp-set-positions' in ctx and re.search(r'\bheld\s*[:}]', ctx): y = True
    if re.search(r'\b(result|ack)\.held\b|\.ack\.held\b', ctx): y = True
    if f.endswith('efsp-ws.js') and ln in ('257', '303'): y = True
    if f.endswith('efsp-ws.test.mjs') and ln == '280' and n == 2: y = False   # "// GND held" comment
    if f.endswith('ws-hub-coverage.test.mjs') and ln == '229': y = False
    why = ('the signed-on Position list (efsp-set-positions/efsp-positions-ack field, coverage list, or a local carrying it)'
           if y else 'not the signed-on list: prose in a comment/test title (L20), or held Strips/codes/tracks/frequencies')
    out.append(f"{k}\t{'Y' if y else 'N'}\t{why}")
open('docs/wip/RENAME-A/review-N04.tsv', 'w').write('\n'.join(out) + '\n')
