# N11 area A (RP-5 a): Y = the Strip axis in code (strip.role, op.role, Bay/Block-Map role, locals and params
# carrying it), and a comment's code reference to it (`role`, .role, role:, role=). N = English prose in comments
# and test titles (L20), the Casdoor/sourcedcs-web sense, and 'Strip Role' inside a string (it would read
# 'Strip strip type'; the sentence is reworded later). 'Role'/'Roles' map to the two-word 'strip type', so they are
# Y only inside a string literal (a refusal/validation message) that does not say 'Strip Role'.
import re, sys
S = sys.argv[1]
TOK = re.compile(r'[A-Za-z0-9_$-]+')
NEVER = {('crc-sync/src/efsp/flight-plan-lookup.js', '112'): 'sourcedcs-web admin/controller role (Casdoor)',
         ('crc-sync/src/efsp/position-store.js', '7'): 'Casdoor role selection'}
def pos_of(line, tok, n):
    k = 0
    for m in TOK.finditer(line):
        if m.group(0) == tok:
            k += 1
            if k == n: return m.start()
    raise SystemExit(f'site not found: {tok}#{n} in {line!r}')
def in_comment(line, p):
    s = line.lstrip()
    if s.startswith(('//', '*', '/*')): return True
    i = line.find('//')
    while i != -1 and i < p:
        if line[i - 1:i] != ':' : return True          # not a URL's '://'
        i = line.find('//', i + 2)
    return False
def in_string(line, p):
    q = None
    for i, ch in enumerate(line[:p]):
        if q:
            if ch == '\\': continue
            if ch == q and line[i - 1:i] != '\\': q = None
        elif ch in '\'"`': q = ch
    return q is not None
out = []
for l in open(S + '/raw-N11.tsv'):
    k, _, _ = l.rstrip('\n').split('\t', 2)
    f, ln, rest = k.split(':', 2); tok, n = rest.rsplit('#', 1); n = int(n)
    line = open(f, encoding='utf-8').read().split('\n')[int(ln) - 1]
    p = pos_of(line, tok, n); prev = line[p - 1:p]; nxt = line[p + len(tok):p + len(tok) + 1]
    com = in_comment(line, p); strg = in_string(line, p)
    if (f, ln) in NEVER: y, why = False, NEVER[(f, ln)]
    elif tok == 'role':
        coderef = prev in ('.', '`', '{') or nxt in (':', '=', '`', ',', ')') or (prev == '$' )
        if com and '@param' in line and re.search(r'\}\s*role\b', line): y, why = True, 'JSDoc naming the role parameter'
        elif com: y, why = (True, 'a comment naming the strip.role field') if coderef else (False, 'English prose in a comment: L20')
        elif strg and not coderef and re.match(r"\s*(test|it|describe)\(", line.lstrip()) : y, why = False, 'English prose in a test title: L20'
        else: y, why = True, 'the Strip axis (strip/op/Bay/Block-Map role) in code'
    elif tok == 'roles':
        y, why = ((True, 'local holding Strip types (createRoles values)') if f.endswith('authority/index.js') and ln in ('81', '82')
                  else (False, 'English prose: L20'))
    else:  # Role, Roles -> 'strip type(s)'
        if com: y, why = False, 'English prose in a comment: L20 (Role -> two-word "strip type")'
        elif strg and not re.match(r"\s*(test|it|describe)\(", line.lstrip()):
            y, why = ((False, "'Strip Role' in a message would read 'Strip strip type': sentence left for the reword")
                      if line[max(0, p - 6):p] == 'Strip ' else (True, 'a validation/refusal message naming the strip type'))
        else: y, why = False, 'English prose in a test title: L20'
    out.append(f"{k}\t{'Y' if y else 'N'}\t{why}")
open('docs/wip/RENAME-A/review-N11.tsv', 'w').write('\n'.join(out) + '\n')
