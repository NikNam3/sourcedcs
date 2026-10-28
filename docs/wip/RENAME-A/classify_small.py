# review classifier for N13 and N18 (area A); every decision class is in the wip file
import re, sys
S = sys.argv[1]
out = []
for l in open(S + '/raw-N13.tsv'):
    k, _, ctx = l.rstrip('\n').split('\t', 2)
    f, ln = k.split(':')[0], k.split(':')[1]
    ctx = open(f, encoding='utf-8').read().split('\n')[int(ln) - 1]
    y = False
    if 'oordination' in ctx or re.search(r'\bcoord\b', ctx): y = True; why = 'coordination/tofiCoordination state'
    elif f.endswith(('board/coordination.js', 'board/tofi.js')): y = True; why = 'coordination record built or compared in the coordination/TOFI module (link/tofi/open are the coordination object)'
    if y and 'strip.state' in ctx: y = False
    if y and re.search(r"state: 'PROPOSED', coordination: null", ctx): y = False; why = ''
    if not y: why = 'Strip state PROPOSED (proposed flight plan) or runway-status change PROPOSED: stays (RP-6 a)'
    out.append(f"{k}\t{'Y' if y else 'N'}\t{why}")
open('docs/wip/RENAME-A/review-N13.tsv', 'w').write('\n'.join(out) + '\n')
YES18 = {'c-TWR', 'c-APP', 'c-GND', 'observer-selects-APP', 'combine-GND'}
out = []
for l in open(S + '/raw-N18.tsv'):
    k, _, ctx = l.rstrip('\n').split('\t', 2)
    tok = k.split(':')[2].rsplit('#', 1)[0]
    if tok in YES18: out.append(f"{k}\tY\tcomposite id built from the Position id (test controller id / freeze trace step name)")
    elif tok == 'CV_APP': out.append(f"{k}\tN\tcarrier Position CV_APP* (kept)")
    elif tok == 'APP_ATC': out.append(f"{k}\tN\ttest approach-radar fixture (like APP_RADAR), not a Position")
    elif tok == 'CLIENT_APP': out.append(f"{k}\tN\tthe client app module text, not a Position")
    else: out.append(f"{k}\tN\tPosition id in comment/test-title prose: L20 (rename-map §2)")
open('docs/wip/RENAME-A/review-N18.tsv', 'w').write('\n'.join(out) + '\n')
