# N03 area A: Y = a Position's staffing; N = airspace occupancy (DES-AIRSP F2), runway/pad occupancy, Marshal stack slots
import sys
S = sys.argv[1]
N = {  # (path suffix, line) -> reason
  ('airspace-store.js', None): 'airspace occupancy (DES-AIRSP F2): keeps occupied',
  ('wire/families/airspace.js', None): 'airspace occupancy on the airspace ack (DES-AIRSP F2)',
  ('departure.js', '223'): 'runway occupancy (not implemented), not a Position',
  ('runway-status-store.js', None): 'hot-cargo/alert pad occupied flag (a pad, not a Position)',
  ('marshal-stack.js', None): 'Marshal stack slot occupancy',
  ('nla.js', '32'): 'runway OCCUPANCY (not implemented)',
  ('efsp-alert-scramble.test.mjs', None): 'alert pad occupied flag',
  ('efsp-carrier-stack.test.mjs', None): 'Marshal stack slot',
  ('efsp-ordnance-hung.test.mjs', None): 'pad occupied flag',
  ('efsp-runway-status.test.mjs', '282'): 'pad occupied flag',
  ('efsp-runway-status.test.mjs', '283'): 'pad occupied flag',
}
out = []
for l in open(S + '/raw-N03.tsv'):
    k, _, ctx = l.rstrip('\n').split('\t', 2)
    f, ln = k.split(':')[0], k.split(':')[1]
    why = None
    for (suf, line), r in N.items():
        if f.endswith(suf) and (line is None or line == ln): why = r
    out.append(f"{k}\tN\t{why}" if why else f"{k}\tY\ta Position's staffing (Position sense)")
open('docs/wip/RENAME-A/review-N03.tsv', 'w').write('\n'.join(out) + '\n')
