# L20: the comment and doc-pointer sweep, on the post-refactor layout

> Read this file, then your lane's briefing. **`docs/parallel/decisions.md` wins over every briefing here, and the
> merged code wins over any line number below** (every number was measured at `7b8f04c`, the W7 merge). Lane rules:
> `docs/parallel/lane-rules.md` (all of it applies). Notes and open points from the briefing author:
> `docs/wip/L20-BRIEF.md`.

## What L20 is now

The refactor (W1-W7, `docs/parallel/refactor/README.md`, ADRs 0095-0097) moved code with its comments verbatim
("That is L20's job, on the new layout") and W7 renamed every identifier, wire name and doc word but left code-comment
prose to L20 (rename-map §5.1: "Code comments: L20"). L20 therefore does two jobs at once, file by file:

1. **Pointers and prose.** Every comment that names a file, method, constant or module names the one that exists now,
   and every comment uses the glossary's words (`docs/glossary.md`, rename-map §3/§4). Comments that describe code that
   is gone (the `module.exports` guards, `clearance-migration.js`, `theater-settings.js`, the facade's `_touch`, "Phase 1
   had only ...") are rewritten to the present or deleted.
2. **The `[SOURCE-DEFINED]` audit** (EFSPImplementationGuide.md §13 "no invented doctrine", defect D11, ADR `0077`,
   the original L20 scope): the L9 rows and the prep inventory's U-rows and checklist
   (`docs/wip/L9-source-defined-inventory.md`, `docs/wip/L20-prep-inventory.md`), re-found by symbol on the new layout,
   plus a re-sweep for what landed after the prep (L17, L18 server half, L19, L28, UI-B, TA, the refactor itself).

It is split by directory into lanes with disjoint files. Wave 1 is comments only. The few items routed to L20 that
change a string or a test identifier are one wave-2 lane (L20-STR). Two queued items that change code bodies are not
L20 and get their own lanes (see "Not L20").

## Lanes

Sizes come from `l20scan.py` (below) at `7b8f04c`: comment lines read, stale pointers (a file or `_private` name in a
comment that no longer exists anywhere), comment lines that name `board-store`/`BoardStore` (each to verify against
where the code went), old-vocabulary hits in comments (an upper bound: it counts JWT "claims", Casdoor "roles" and
"holding" too), prep/L9 rows, and `[SOURCE-DEFINED]` markers at base. Model: **Sonnet 5.5** for every lane; one
**Opus** questioner per wave.

| Lane | Wave | Owns (summary; the briefing is exact) | Comment lines | Stale ptrs | board-store lines | Vocab hits | Rows | Markers | Size |
|---|---|---|---|---|---|---|---|---|---|
| [L20-BOARD](L20-BOARD.md) | 1 | `crc-sync/src/efsp/board/**`, `board-store.js` | 1,496 | 7 | 23 | 102 | 8 | 1 | S |
| [L20-WIRE](L20-WIRE.md) | 1 | `src/efsp/{wire,sync,authority}/**`, `efsp-ws.js`, `permission.js`, `nla.js`, `required-rules.js` | 1,515 | 6 | 37 | 184 | 10 | 15 | M |
| [L20-CORE](L20-CORE.md) | 1 | the other top-level `src/efsp/*.js` (flight data, correlation, Block Map, facility, metrics, archiver, ...) | 3,486 | 9 | 40 | 196 | 22 | 17 | L |
| [L20-DOMAINS](L20-DOMAINS.md) | 1 | `src/efsp/{carrier,ato}/**`, carrier/runway-status/airspace/MARSA/SFA/scramble/stereo stores and rules | 2,078 | 1 | 22 | 89 | 9 + re-sweep | 42 | M |
| [L20-SYNCTOP](L20-SYNCTOP.md) | 1 | `crc-sync/src/*.js`, `src/surveillance/**`, `server.js`, `tools/**`, `config/*.json` notes; check-only: `tools/miztoyaml`, atobrief, sourcedcs-web | 2,305 (crc-sync) | 14 | 7 | 51 | 17 | 12 | M |
| [L20-SYNCTESTS](L20-SYNCTESTS.md) | 1 | `crc-sync/tests/**` except `freeze/golden/**` | 3,497 | 22 | 30 | 281 | 6 | 8 | M |
| [L20-CLIENT](L20-CLIENT.md) | 1 | `crc-desktop/app/public/js/panels/efsp/**` | 4,151 | 35 | 27 | 139 | 14 | 26 | L |
| [L20-DESK](L20-DESK.md) | 1 | the rest of `crc-desktop/` code: other `public/**` (js, css, html), `app/*.js`, `main.js`, `tests/**`, `e2e/**` | 5,526 | 50 | 9 | 150 | 9 | 6 | M |
| [L20-DOCS](L20-DOCS.md) | 1 | `CLAUDE.md`, the READMEs, `infra/RUNBOOK.md`, `docs/efsp-briefing.md`, top release-note entry | ~3,200 doc lines | ~70 | 7 | n/a | 11 | n/a | M |
| [L20-GUIDE](L20-GUIDE.md) | 2 | `docs/efsp-usage-guide.md`, `EFSPImplementationGuide.md`, `docs/glossary.md`, new ADR `0077` | ~3,100 doc lines | n/a | n/a | n/a | L9 B1-B18 + 6 | n/a | M |
| [L20-STR](L20-STR.md) | 2 | strings and test identifiers only: server reason/log prose, L9 Group A, test titles and test locals (not e2e) | ~25 strings + ~260 titles + ~24 locals | | | | 6 | | M |

## Slot plan (cap 10 agents)

| Slot use | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|
| Lanes | BOARD, WIRE, CORE, DOMAINS, SYNCTOP, SYNCTESTS, CLIENT, DESK, DOCS (9) | GUIDE, STR, BRIDGE (not L20) | ESM-GUARDS (not L20) |
| Questioner (Opus) | 1 | 1 | the wave-2 one continues |
| Start condition | supervisor names the base (`7b8f04c` or later; nothing else running in these files) | GUIDE: the first free slot (its ADR `0077` step waits for every wave-1 report). STR: all eight wave-1 code lanes merged. BRIDGE: L20-DESK merged | STR and L20-CLIENT merged |
| Merge | any order: the files are disjoint by construction | any order (disjoint) | alone |

Peak is 10 in wave 1 (9 lanes and the questioner). Wave 1 lanes are all about the same length except CORE and CLIENT
(the large ones): start those first. When a wave-1 lane finishes, GUIDE takes its slot.

**Tests in this window (S-TEST):** wave-1 lanes run `node --check`, the source-scanning tests for their files and,
once before the report, both unit suites (`nice`, one suite at a time). No Playwright, no soak, no freeze run: the
comment-only gate below proves the code did not change. The supervisor runs both unit suites once on the merged
wave 1, and the sharded Playwright suite once after STR and BRIDGE are merged, and once after ESM-GUARDS. A full
Playwright run is in progress on this machine at the time of writing; never start another.

## Rules every L20 lane follows

1. **Comments and docs only** (wave 1 and GUIDE). No code token changes: no identifier, string literal, regex,
   number or JSON value changes, no reordering. The gate is `l20-codecheck.mjs <base>` (below), which must print
   `comment-only: no code change` before every commit and in the report. L20-STR is the only lane allowed to change
   string literals and test-local identifiers, and its gate is a listed-diff check instead.
2. **A comment that names a symbol names the current one.** Before keeping or writing any file, method, constant,
   wire type or config key in a comment, `git grep -n "\bNAME\b" -- crc-sync/src crc-desktop/app` must find it. To
   find where something went: `git log -S'NAME' --oneline -- crc-sync/src crc-desktop/app | head`, then
   `git show <sha> --stat`; the Board's map is ADR 0095 §2-3 and `crc-sync/tests/freeze/golden/guard-board-surface.json`
   (read-only). `board-store.js's X` becomes the collaborator that owns X now (`board/coordination.js`,
   `board/ops/invoke-nla.js`, `sync/replay-cache.js`, ...), named as `file`'s `function`. History is allowed only as a
   short "formerly `X` (removed, ADR NNNN)" or "before L7 ..." clause, and only where a reader would otherwise look for
   the old thing; narration of how the code used to be ("Phase 1 had only ...", "WP4A added ...") is rewritten to the
   present or deleted.
3. **Vocabulary: `docs/glossary.md` is the key** (rename-map §3 terms, §4 kept terms, §5 prose rules). A Position is
   **staffed/unstaffed**; a controller **signs on/off**; an unstaffed Position's Strips go to **the Position it is
   consolidated at** (not "covering"); **strip type** (not Strip Role); **flight data** (not FDR, never `fd`);
   **runway status** (not field state); **Conflict Alert (CA)** (not STCA); **handoff** for a radar/strip handoff, but
   a controller replacing another at a Position is **position relief** (S-RENA1), never "handoff"; Position ids
   **LC, GC, AP** (JO 7210.3 TBL 10-1-1), `OPS`, `CD`, `RSU`, `SFA`, `PAR`, `CTR`, tactical and carrier ids unchanged;
   a coordination waiting is **INITIATED**. Never a bare "transfer" or "release" (name its object). **Kept, do not
   change:** airspace occupancy, the runway occupant, Marshal stack slots, `HELD`/holding, "holds a Strip"
   (ownership), JWT "claims", Casdoor/Discord roles, ARIA `role`, `getByRole`, "radar station", `ON_STATION`, the SRS
   `Seat`, "squawk" as the pilot's action (only the Block-5 *label* became BEACON), `peer*` field names, "manned"
   only where it names nothing (the metric fields are `staffedHours`/`perStaffedHour` now). A code name in backticks is
   never "translated": if the identifier still has an old word, it is quoted as it is.
4. **Quotations.** A quote from `EFSPImplementationGuide.md` or the usage guide matches the guide's *current* text
   (RENAME-C changed its words; grep it). A quote from a committed ADR stays verbatim, with the new word once in
   brackets. A test title or a log string quoted in a comment matches the code as it is in your base.
5. **`[SOURCE-DEFINED]` markers** (what they mean and where they are required):
   - Meaning: the value, threshold, state set, label set, or sentence is **SOURCE's own choice** (squadron or project
     policy, our model of something), not read from the guide, its Annex, or a cited FAA/ICAO document. It exists so
     nothing presents our choice as doctrine (guide §13, D11).
   - Required on: every number, threshold, state or label set, rule or sentence that is ours **and** is neither cited
     to a guide/Annex clause (a citation on a parent section covers its untagged sub-clauses, S-L9 E6) nor in a tuning
     file whose `_comment` already says so. Not required on engineering bounds (cache caps, retry counts, ring sizes,
     timeouts that change no meaning): say "engineering bound" in plain words instead.
   - House style: `// [SOURCE-DEFINED] (docs/adr/00NN) — <what is ours>.` with a decision row (`H22`, `S-L1d`) when
     there is no ADR. In a tuning JSON (`crc-sync/config/*.json` read through `tuning-file.js`, which skips `_` keys):
     inside `_comment`/`_note`. **Never add a `_comment` key to `config/efsp-facility-*.json`** (the facility loader is
     not the tuning loader; the note goes in `facility-schema.js`/`facility-config.js`, S-L20PREP).
   - Rendered UI labels are not marked inline: the usage guide's "What is ours and what is sourced" section covers them
     (S-L9 E9). Exception: the metrics panel notes ship the literal prefix on purpose (ADR 0072).
   - "SOURCE practice" inside a rendered string is a convention, not a tag: keep it.
   - Markers are never deleted unless the value they mark is gone (TA removed `BLOCK_FL_FROM_FT`). Your lane's
     `git grep -c SOURCE-DEFINED` over its Owns is at least its step-0 count.
6. **Mirrored pairs.** Client mirrors of server modules: `nla.js`/`authority/**` ↔ `efsp-nla.js`,
   `bay/authority-mirror.js`, `sfa-state.js`; `runway-status.js` ↔ `runway-status-rules.js`, `ordnance-advisory.js`;
   `alert-scramble.js` ↔ `scramble.js`; `block-map.js` ↔ `strip-template.js`; `time-chains.js` (both). Drift tests
   compare their **strings and tables, not comments**, so each side's comments are its own lane's. When you add a marker
   or reword a rule on one side, write a "Mirror" line in your wip naming the other file and the exact wording, so the
   other lane matches it; the supervisor checks both at merge. Mirrored *strings* belong to L20-STR (both sides, one
   commit).
7. **ADRs are never edited (P4).** A stale or wrong statement in a committed ADR becomes one row in your wip's
   "ADR errata" section (`ADR:line`, what it says, what is true, evidence). L20-GUIDE writes them all into the new
   ADR `0077` and points the glossary at it.
8. **Files.** Write only your Owns plus `docs/wip/L20-<area>.md`. Never: `crc-sync/tests/freeze/golden/**`, any ADR,
   `docs/wip/**` other than yours, `docs/parallel/**`, `docs/efsp-parallel-plan.md`, `docs/efsp-wp6-plan.md`, the UI
   catalogues and findings, older release-note entries, `.junie/**`, `node_modules`. Historical docs keep their words
   (rename-map §5.2). A one-line edit outside Owns: ask "main" first.
9. **Findings, not fixes.** Anything that needs a code, string or test change goes to your wip's "Findings" with a
   suggested owner (L20-STR, ESM-GUARDS, BRIDGE, a later lane). Never fix it on the side.
10. **Source-scanning tests read comments too.** After editing files they scan, run them: crc-sync
    `board-seam`, `clock-policy`, `required-rules`, `wire-payload-contract`, `efsp-metrics-contract`; crc-desktop
    `module-graph`, `overflight-shared-state-names`, `client-mirror-parity`, `bay-descriptor-parity`,
    `efsp-block-map-parity`, `ws-message-contract`, `e2e-spec-hygiene` (`node --test tests/<file>`). A failure means a
    comment now contains a pattern a guard looks for (a `require(`, `._private`, `Date.now()`, a global name): reword
    the comment, never the guard.
11. **Commits:** `docs(L20-<area>): <what>` per directory or per row group, at every green step and at least every
    ~15 minutes (lane-rules 4), each ending with the attribution line your session's reminder gives you. Never merge,
    rebase or push.
12. **Report** (final message, at most 40 lines, and the same at the top of your wip): branch and `git log --oneline
    <base>..HEAD`; step-0 and final counts from `l20scan.py --lane` and the marker count; the codecheck result; both
    unit suites before → after; rows applied / kept-because; Mirror lines; ADR errata rows; findings with owners;
    defaults taken (P2).

## Tools (copy to your scratchpad, run from the worktree root; both are read-only)

### `l20scan.py`: step-0 and final counts, and the site list for your lane

```python
#!/usr/bin/env python3
"""L20 sizing scan. Usage: python3 l20scan.py            -> table per lane
                       python3 l20scan.py --sites L20-X [--kind file|priv|bs|vocab] -> sites of one lane"""
import os, re, subprocess, sys, collections
FILES = [f for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split('\n') if f]
EXISTING_BASENAMES = {os.path.basename(f) for f in FILES}
CODE_EXT = ('.js', '.mjs', '.cjs', '.css', '.html', '.py', '.json')
DOMAINS = ('carrier-store.js', 'carrier-tick.js', 'runway-status.js', 'runway-status-store.js', 'alert-scramble.js',
           'airspace-config.js', 'airspace-store.js', 'marsa-store.js', 'sfa.js', 'sfa-store.js', 'stereo-routes.js')
def bucket(f):
    if 'node_modules' in f or f.endswith('package-lock.json') or '/golden/' in f or '/protos/' in f: return None
    if f.startswith('crc-sync/src/efsp/board/') or f == 'crc-sync/src/efsp/board-store.js': return 'L20-BOARD'
    if re.match(r'crc-sync/src/efsp/(wire|sync|authority)/', f) or f in ('crc-sync/src/efsp/efsp-ws.js', 'crc-sync/src/efsp/permission.js', 'crc-sync/src/efsp/nla.js', 'crc-sync/src/efsp/required-rules.js'): return 'L20-WIRE'
    if re.match(r'crc-sync/src/efsp/(carrier|ato)/', f) or (f.startswith('crc-sync/src/efsp/') and f.count('/') == 3 and f.split('/')[-1] in DOMAINS): return 'L20-DOMAINS'
    if f.startswith('crc-sync/src/efsp/'): return 'L20-CORE'
    if f.startswith('crc-sync/tests/'): return 'L20-SYNCTESTS'
    if f.startswith(('crc-sync/', 'tools/', 'atobrief/', 'sourcedcs-web/', 'infra/')) and f.endswith(CODE_EXT) and '/data/' not in f.replace('crc-sync/data/', 'crc-sync/x/'): return 'L20-SYNCTOP'
    if f.startswith('crc-desktop/app/public/js/panels/efsp/'): return 'L20-CLIENT'
    if f.startswith('crc-desktop/') and f.endswith(CODE_EXT) and 'python-pkg' not in f and 'build-assets' not in f: return 'L20-DESK'
    return None
def comments(f, txt):
    out, ext, in_block = [], os.path.splitext(f)[1], False
    for i, line in enumerate(txt.split('\n'), 1):
        s = line.strip()
        if ext == '.json':
            if re.match(r'"_(comment|note)\w*"\s*:', s): out.append((i, s))
            continue
        if ext == '.py':
            if s.startswith('#') or '"""' in s or "'''" in s: out.append((i, s))
            continue
        if ext == '.html' and '<!--' in s or in_block and ext == '.html':
            out.append((i, s)); in_block = ('-->' not in s); continue
        if in_block:
            out.append((i, s)); in_block = '*/' not in s; continue
        if s.startswith('//') or s.startswith('*'): out.append((i, s)); continue
        if s.startswith('/*'): out.append((i, s)); in_block = '*/' not in s; continue
        m = re.search(r'(?<![:\'"\w])//\s', line)
        if m and ext in ('.js', '.mjs', '.cjs'): out.append((i, line[m.start():].strip()))
        elif '/*' in line and ext in ('.css', '.js', '.mjs'):
            out.append((i, line[line.index('/*'):].strip())); in_block = '*/' not in line[line.index('/*'):]
    return out
OLD_FILES = ['clearance-migration.js', 'theater-settings.js', 'theater-settings.json', 'field-state.js', 'field-state-store.js',
             'field-state-panel.js', 'field-state-rules.js', 'fdr-store.js', 'stca.js', 'station-coverage.js',
             'transfers.js', 'transfer-effects.js', 'radar-specs.json']
PRIV = re.compile(r'\b(_[a-z][A-Za-z0-9]+)\b')
FILEREF = re.compile(r'\b([a-z0-9][\w.-]*\.(?:m?js|json|css|html))\b')
VOCAB = [('seat', r'\bseats?\b'), ('station', r'\b(station|stations)\b'), ('occupied/manned', r'\b(un)?(occupied|occupancy|manned)\b'),
         ('held/hold Position', r'\b(held|holds?|holding) (the |a |its |their |every )?(Position|Positions|seat)'),
         ('claim', r'\bclaim(s|ed|ing)?\b'), ('covering', r'\b(covering|covered by)\b'), ('hand-over', r'\bhand-?overs?\b'),
         ('STCA', r'\bSTCA\b|\bstca\b'), ('FDR', r'\bFDRs?\b|\bfdr\b'), ('Role', r'\b(Strip )?Roles?\b'),
         ('field state', r'\b[Ff]ield[ -]state\b|FIELD STATE'), ('TWR/GND/APP', r'\b(TWR|GND|APP)\b'), ('SQUAWK label', r'\bSQUAWK\b'),
         ('PROPOSED coord', r'coordination[^.]{0,40}\bPROPOSED\b|\bPROPOSED\b[^.]{0,40}coordination'),
         ('signedOn prose', r'\bthe signedOn\b|\bsignedOn Positions\b'), ('module.exports (client)', r'module\.exports')]
def main():
    want = sys.argv[sys.argv.index('--sites') + 1] if '--sites' in sys.argv else None
    kind = sys.argv[sys.argv.index('--kind') + 1] if '--kind' in sys.argv else None
    texts = {}
    for f in FILES:
        if f.endswith(CODE_EXT) and os.path.isfile(f) and 'node_modules' not in f:
            try: texts[f] = open(f, encoding='utf-8').read()
            except Exception: pass
    defs = set()
    for f, t in texts.items():
        if f.endswith(('.js', '.mjs', '.cjs')):
            for m in re.finditer(r'(?:^|\s|\.|function\s+|async\s+|get\s+|set\s+|static\s+)(_[a-z]\w*)\s*(?:\(|=[^=]|:)', t, re.M): defs.add(m.group(1))
    agg, sites = collections.defaultdict(collections.Counter), []
    for f, t in texts.items():
        b = bucket(f)
        if not b: continue
        cs = comments(f, t)
        agg[b]['files'] += 1; agg[b]['comment lines'] += len(cs); agg[b]['SOURCE-DEFINED'] += t.count('SOURCE-DEFINED')
        for i, s in cs:
            for fr in FILEREF.findall(s):
                if fr in OLD_FILES or (fr.endswith(('.js', '.mjs')) and fr not in EXISTING_BASENAMES and not fr.startswith(('node', 'index'))):
                    agg[b]['stale file ptr'] += 1; sites.append((b, 'file', f, i, fr, s))
            for p in PRIV.findall(s):
                if p not in defs and len(p) > 3: agg[b]['stale _method ptr'] += 1; sites.append((b, 'priv', f, i, p, s))
            if re.search(r'board-store|BoardStore', s): agg[b]['board-store mention'] += 1; sites.append((b, 'bs', f, i, '', s))
            for name, rx in VOCAB:
                if name.startswith('module.exports') and not f.startswith('crc-desktop/app/public'): continue
                n = len(re.findall(rx, s))
                if n: agg[b]['vocab:' + name] += n; agg[b]['vocab total'] += n; sites.append((b, 'vocab:' + name, f, i, '', s))
    if want:
        for s in sites:
            if s[0] == want and (not kind or s[1].startswith(kind)): print(f"{s[2]}:{s[3]}\t{s[1]}\t{s[4]}\t{s[5][:160]}")
        return
    keys = ['files', 'comment lines', 'stale file ptr', 'stale _method ptr', 'board-store mention', 'vocab total', 'SOURCE-DEFINED'] + ['vocab:' + n for n, _ in VOCAB]
    bs = sorted(agg); print('metric\t' + '\t'.join(bs))
    for k in keys: print(k + '\t' + '\t'.join(str(agg[b][k]) for b in bs))
main()
```

`--sites` output is a work list, not a verdict: a `.test.js` pointer can be a CommonJS test that still exists, "former
`ui.js`" is history on purpose, "claim" may be a JWT. The **acceptance** numbers for every lane are: stale file and
`_method` pointers 0 (or each remaining one listed with "kept because"), every `board-store mention` line verified, and
every vocab hit either reworded or listed as a kept sense (one line per *kind* of kept sense, not per site).

### `l20-codecheck.mjs`: the comment-only gate

```js
#!/usr/bin/env node
// node l20-codecheck.mjs <base>      -> lists every changed file whose code (comments removed, whitespace collapsed)
//                                      differs from <base>; exit 1 if any. JSON: `_comment*`/`_note*` keys ignored.
// node l20-codecheck.mjs --self-test -> strips every tracked JS file and `node --check`s it (648/648 at 7b8f04c).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const REGEX_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
function stripJs(src) {
  let out = '', i = 0; const n = src.length, tmplStack = []; let braceDepth = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '`' || (c === '}' && tmplStack.length && tmplStack[tmplStack.length - 1] === braceDepth)) {
      if (c === '}') tmplStack.pop();
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { j += 2; tmplStack.push(braceDepth); break; }
        j++;
      }
      out += src.slice(i, j); i = j; continue;
    }
    if (c === '/') {
      const before = out.replace(/\s+$/, ''), prev = before.slice(-1);
      if (!before || REGEX_PREV.has(prev) || REGEX_KEYWORDS.test(before)) {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) { j++; break; }
          j++;
        }
        while (j < n && /[a-z]/i.test(src[j])) j++;
        out += src.slice(i, j); i = j; continue;
      }
    }
    if (c === '{') braceDepth++;
    if (c === '}') braceDepth--;
    out += c; i++;
  }
  return out;
}
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripHtml = (s) => stripCss(s.replace(/<!--[\s\S]*?-->/g, ' '));
const stripPy = (s) => s.split('\n').map(l => l.replace(/^\s*#.*$/, '')).join('\n');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
function normJson(s) {
  const drop = (v) => Array.isArray(v) ? v.map(drop) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !/^_(comment|note)/.test(k)).map(([k, x]) => [k, drop(x)])) : v;
  try { return JSON.stringify(drop(JSON.parse(s))); } catch { return squash(s); }
}
function codeOf(path, src) {
  const e = extname(path);
  if (['.js', '.mjs', '.cjs'].includes(e)) return squash(stripJs(src));
  if (e === '.css') return squash(stripCss(src));
  if (e === '.html') return squash(stripHtml(src));
  if (e === '.json') return normJson(src);
  if (e === '.py') return squash(stripPy(src));
  return null;
}
const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const dir = mkdtempSync(join(tmpdir(), 'l20check-')); let bad = 0, total = 0;
  for (const f of git('ls-files', '*.js', '*.mjs', '*.cjs').split('\n').filter(Boolean)) {
    if (f.includes('node_modules') || !existsSync(f)) continue;
    const out = join(dir, 'x' + extname(f)); writeFileSync(out, stripJs(readFileSync(f, 'utf8'))); total++;
    try { execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' }); }
    catch (e) { bad++; console.log('STRIP BROKE', f, String(e.stderr).split('\n').slice(0, 4).join(' | ')); }
  }
  console.log(`self-test: ${total - bad}/${total} files still parse after stripping`); process.exit(bad ? 1 : 0);
}
const base = args[0];
if (!base) { console.error('usage: l20-codecheck.mjs <base> | --self-test'); process.exit(2); }
let changed = 0;
for (const line of git('diff', '--name-status', '-M', base, '--').split('\n').filter(Boolean)) {
  const [status, a, b] = line.split('\t'); const path = b || a;
  if (path.endsWith('.md')) continue;
  if (status === 'A' || status === 'D') { console.log(`${status} ${path} (new or deleted file)`); changed++; continue; }
  let old; try { old = git('show', `${base}:${a}`); } catch { old = ''; }
  const now = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const x = codeOf(path, old), y = codeOf(path, now);
  if (x === null) { if (old !== now) { console.log(`? ${path} (unchecked type)`); changed++; } continue; }
  if (x !== y) {
    let k = 0; while (k < x.length && x[k] === y[k]) k++;
    console.log(`CODE CHANGED ${path} near: ${JSON.stringify(x.slice(Math.max(0, k - 40), k + 60))} -> ${JSON.stringify(y.slice(Math.max(0, k - 40), k + 60))}`);
    changed++;
  }
}
console.log(changed ? `${changed} file(s) with a code change` : 'comment-only: no code change');
process.exit(changed ? 1 : 0);
```

Python docstrings count as code for this gate (only `#` lines are stripped): do not edit a docstring in L20 wave 1.
A whitespace-only change inside code (`f(a) ;`) also fails it: that is intended.

## Where the inherited rows go

Every row id is from `docs/wip/L9-source-defined-inventory.md` (A, B, C, D) or `docs/wip/L20-prep-inventory.md`
(U, C-n); "S-x" rows are `docs/parallel/decisions.md`; lane names in the left column of the wips are the refactor's.
Line numbers in those files are stale: re-find by symbol or quoted text.

| Lane | Rows |
|---|---|
| BOARD | D1, D2 (the two board-store lines, now in `board/**`), D4; BOARD-3 (moved files name `_dispatch`, `_applyX`, `board-store.js`); SYNC (`board/placement.js` header "host-core patches `_touch`"; `board/strip-ops.js` `deps.touch`/`deps.droppedWallAt` JSDoc "the facade's Map"; Coordination/Tofi constructor notes: `touch` is the kernel's `recordTouch`); board-store header ("FDRs", "Phase 1 ... four Positions") ; L27 marker kept |
| WIRE | C13, C16, D10; C-7 (`permission.js` header "no coordination primitives", "Phase 1 had only"); C-4 (`efsp-ws.js` `theater-settings.js`); BOARD-1 (`_validateBayImpliedTransition` in `authority/strip-types/departure.js`); BOARD-2 (`permission.js`, `efsp-ws.js` name `_applyCoordinationPropose`/`_applyTofiPropose`/`receiveTofiProposal` as board-store's); `wire/families/*.js` cite `_handleAirspaceMutation`/`_handleMarsaMutation` (gone); `authority/classes.js` "config.js's positionClasses"; L23 marker kept |
| CORE | C4, C6, C10, C11, D7; U1 (`instrumentation-config.js`), U8, U13, U14 (`order-key.js`), U18 (reword only); C-4 (`facility-config.js`, `mutation-log.js`); BOARD-1 (`facility-config.js` `_bayForNewOwner`); BOARD-2 (`flight-data-store.js`); BACKCOMPAT (`facility-schema.js`, `block-map.js` `blockVisibility`); SYNC (`metrics.js` `APPLIED_MUTATIONS_CAP` "in board-store.js"); **DATA-1: the facility literals' doctrine comments (only at `8476c41^`) restated beside the schema**; L19 thresholds (`surveillance-hints*.js`); `facility-config.js` header (covering chain, "Bay sets below", `permission.js's OP_KINDS`) |
| DOMAINS | C12, D8; U3, U11 (`flight-record.js` 32; `ship-state.js:26-27` "1° re-broadcast step": re-check, L17 has merged), U17 (`marsa-store.js:37-41`), C-10 (`RUNWAY_GATED_STATES`); `ato-board.js` `_handleAtoMutation`; re-sweep L17, L18 server half, L28, UI-B, AIRSP files (unswept by the prep) |
| SYNCTOP | C1, C5, C7 (now `conflict-alert.js`), C8, C9 (`iff.js` header marker, L10 merged), D9; U1 (`config/efsp-instrumentation.json`), U2 (`sensor-specs.json` `presentation`), U5 (fallbacks left after TA in `theater-context.js`, `altimetry.js`, `surveillance/index.js`), U9 (`presentation.js` `SCHEME_HOLD_SWEEPS`), U12, U14 (`tools/soak/report.js` `THRESHOLDS`, its `_pruneLog` pointer), U16 (`tools/miztoyaml/build_doc.py`); `mission-clock.js` `theater-offsets.js`; L19 `config/efsp-surveillance-hints.json` note |
| SYNCTESTS | stale method pointers (`_validateBayImpliedTransition` ×8, `_nlaPrecheck`, `_isRejectedReplica`, `_handleMarsaMutation`, `_resolveOrderKey`, `_stampStrip`, `_buildAllRadars`); `.test.js` pointers; BOARD-2 (two tests name the moved coordination/TOFI methods); every `board-store` mention |
| CLIENT | C14, C15, D2 (`efsp-panel.js` part), D6; U7, U10, U17 (`marsa-badge.js`); C-1 (`HIGHLIGHT_SWATCHES` and `GESTURE_INPUT_COST`, S-L15); C-10 (label set in `runway-status-rules.js`), C-13 (the comment above the owners fallback says "fallback"); ESM-1 (stale headers on the removed `module.exports` guard in `efsp-state.js`, `carrier-state.js`, `runway-status-rules.js`, `sfa-state.js`; `strip-view.js:18` "Loaded after bay-view.js"); 30 `.test.js` → `.test.mjs` pointers |
| DESK | U5 (client fallbacks left after TA), U9 (`atc-scope.js`, `geojson.js`), U15 (`track-label.js`); C-8 (`app/data/aircraft-types.json` `_comment`: `radar-specs.json` → `sensor-specs.json`); RENAME-B ("the signedOn Positions" in CSS/HTML comments; "hand-over, manned, SQUAWK, Role"); ESM-1 (`atc-scope.js` header); BACKCOMPAT (`tests/efsp-ui-reachability.test.mjs` `clearance-migration.js`); 49 `.test.js` pointers |
| DOCS | S-ARCH2 16 (CLAUDE.md "Express" for crc-desktop's local server: it is Node `http`/`https`); CLAUDE.md crc-sync `server.js` bullet (Express app is `src/app.js` `createApp()`), the soak-selfcheck file list (now `board/**`, `wire/**`, `sync/**`, `host-core.js` too, refactor README "Gates"), crc-desktop `npm test` line (`tests/*.test.{js,mjs}`; no "crc-desktop internals" section exists), the ES-module client, `state/collab-overlay.json` and `collab-wiring.js` (S-S13); S-M-merge4 (briefing says `efsp-resync-reply`); S-M-DATA1 (`DEFAULT_CONFIG` prose, briefing ~467, ~973); briefing `theater-settings.js` (~781-801), `clearance-migration.js` (~922), `board-store.js`/`permission.js`/`nla.js` pointers, `.test.js` names; S-M-W7 (release note misses "delete a `state/alerting.json` that uses `stca`"); HYG's seven CLAUDE.md items (verify; most are in) |
| GUIDE | L9 B1-B18 (B12 already true after TA: re-check), B18 "What is ours and what is sourced", F45 (`efsp-usage-guide.md` "guide §4.2" for Rack order); DATA-1 (facility data: what is sourced, what is ours, in the usage guide); S-RENA1 (`EFSPImplementationGuide.md` §4.8 "handoff" → position relief where it means a controller replacing another; section numbers unchanged); glossary note (hand-over → handoff vs position relief; pointer to ADR 0077); ADR `0077` (errata: `0033:21` E5, `0042` `radar-specs.json`, `0048:14` and `0079:80-85` `theater-settings.js`, `0081` `efsp-resync` → `efsp-resync-reply`, plus every lane's "ADR errata" rows; the marker house style; "SOURCE practice"; mirrored pairs) |
| STR | L9 A1 (`code-allocator.js` detail), A2 (radar-panel title); RENAME-A finding 2 (server log/reason prose naming TWR/APP/FDR/field state); the refusal `unknown Strip Role: ${role}`; test titles with old words (~196 crc-sync, ~64 crc-desktop) and test locals (`twr`, `gnd`, `twrBays`, `gndOnly`, `twrOnly`, `gndPushback`: ~21 crc-sync, ~3 crc-desktop); RENAME-A finding 1 (`efsp-block-altitude.test.mjs` uses the real `state/`) |

## Not L20 (own lanes, queued; the supervisor writes or commissions their briefings)

| Lane | Scope | Why not L20 | When |
|---|---|---|---|
| **BRIDGE** (Sonnet) | Migrate the Playwright specs off `classic-globals-bridge.js` (S-M-ESM: 668 names; the 7 setters; `l22-stars-scope.spec.js:84` `history.set`), then delete the bridge and its import in `main.js`, and the module-graph/bridge tests that pin it. Also owns the e2e test titles and locals with old words (`twr`, `gnd`, `ARR_TWR`: RENAME-B finding), so L20-STR never touches `e2e/**` | Code and spec bodies; needs its own `E2E_LANE` and touched-spec runs | Wave 2, after L20-DESK merged |
| **ESM-GUARDS** (Sonnet) | Remove the always-true `typeof X === 'function' / 'undefined'` guards on imported bindings (ESM-1 counted 336; **362 in 52 files** at `7b8f04c`: re-count), and fix the latent `ReferenceError`s at `tools-panel.js:33-34` and `geojson.js:651-652` (`test.todo` in `module-graph.test.mjs`); optionally turn `window.getLatestTrack`/`getAllTracks` into exports (ESM-1 finding) | A body change in 52 client files: boot smoke and touched-panel specs, not a comment edit. In the same files as L20-CLIENT/DESK, so it runs after them | Wave 3, after L20-CLIENT, L20-DESK and L20-STR merged |
| later hygiene | `tools/soak/report.js` reads `RING_MAX`/`APPLIED_MUTATIONS_CAP` instead of copying 2000/5000 (SYNC); strengthen `efsp-correlation-reconciler.test.mjs` so a new silently eligible state is caught (U18); `tools/soak/host-core.js` wraps `bs._rebalanceRack` by name (BOARD-1) | Code | any free slot after wave 1 |
| not done | C-2 (double 6xxx warning, `rev` bump on unchanged re-import) | S-L20PREP D-3: no, behaviour | none |
