# L20 wave 1: questioner's points

Questioner (Opus), base `277e65f`. Not committed. Each point is `Q20-<LANE>-n`: evidence, why it matters, recommended
answer, owner. "Blocking" means a lane cannot reach its own acceptance (or the merged tree is red) without a ruling.

**Index (12 points).** Blocking: Q20-CORE-1/CLIENT-1 (= CLIENT-3). Supervisor rulings needed: Q20-ALL-1,
Q20-SYNCTOP-1/DESK-1. Lane fixes: Q20-BOARD-1, Q20-CORE-2 (mostly applied), Q20-CORE-3, Q20-ALL-2, Q20-DOCS-1,
Q20-DOMAINS-1, Q20-SYNCTOP-2, Q20-CLIENT-2. Wave 2: Q20-STR-1. Nothing needs the human.

## Part 1: pre-check (boundaries, scan, gate)

What I checked and found sound, so nobody re-derives it:
- **Ownership is complete for `src/efsp/` top level.** All 46 top-level files are in exactly one of BOARD (1), WIRE (4),
  CORE (30), DOMAINS (11); every sub-directory (`board`, `wire`, `sync`, `authority`, `carrier`, `ato`) has one owner.
- **The `l20-codecheck.mjs` JS stripper is faithful.** I compared its output with acorn's comment ranges on all 648
  tracked JS files: identical except the 8 files with a `#!` line (the gate keeps the shebang as code, which is the safe
  side). Template literals, `${}` nesting and regex literals are not mis-stripped anywhere in the tree. No `@ts-check`,
  jsconfig, `#__PURE__` or coverage pragmas exist, so no JSDoc type or directive comment is read by a tool (the four
  `eslint-disable` comments are inert: no eslint runs).
- **Old identifiers in comments are already renamed.** W7's `=` token rows ran over comments too. Comment hits for old
  `=` tokens are all deliberate history (`stores.js:235`, `tuning-file.js:28`, `efsp-restore-refusal.test.mjs:89`,
  `tuning-layer-keys.test.mjs:9`) or the new `runwayStatus` key. So the remaining work is prose, which the scan
  measures.

### Q20-CORE-1 / Q20-CLIENT-1: `time-chains.js` is byte-identical *including comments*, and both lanes have already edited it differently (blocking)

- Evidence: `crc-sync/tests/efsp-time-chains.test.mjs:47-54` and `crc-desktop/tests/efsp-time-chains.test.mjs:25-30`
  compare `moduleBody(server)` with `moduleBody(client)`. `crc-desktop/tests/helpers/module-body.mjs:7-12` strips only
  `export ` and the `module.exports` block, so every comment counts. README rule 6 ("Drift tests compare their strings
  and tables, not comments") is wrong for this pair. At the lanes' current HEADs:
  - CORE `time-chains.js:42`: `board-store.js` → `board/strip-ops.js`.
  - CLIENT `time-chains.js:42`: `board-store.js` → `crc-sync's board/strip-ops.js`, and `:27-28` →
    "No imports, no clock ... An ES module on both sides."
- Why it matters: (1) each lane's own suite goes red in its worktree, because each test reads the other side's
  unedited copy; (2) after merge the two copies differ in two places, so both suites fail; (3) CLIENT's new sentence is
  **false**: the crc-sync copy is CommonJS (it ends in the `typeof module` / `module.exports` guard, `time-chains.js:103`).
- Recommended: **CORE owns the comment text of both copies for this one file.** CORE writes the exact final lines in a
  wip "Mirror" line, and CLIENT pastes them byte for byte (or the supervisor applies them at merge). The true wording
  for both copies: `:27-28` "No require or import, no clock: nothing here is a time of its own. crc-sync's copy is
  CommonJS and crc-desktop's an ES module; the parity tests compare the bodies without the export syntax." `:42`
  "stamped by crc-sync's `board/strip-ops.js` (`StripOps#_stampTakeoffOnStateChange`, through
  `FlightDataStore#setTakeoffStamp`)". Correct README rule 6 for the wave-2 lanes.
- Owner: supervisor (ruling), then CORE and CLIENT.

### Q20-ALL-1: Tests in the *other* unit suite scan your files. Rule 10's list and each lane's close step miss them

- Evidence (all in `npm test`, all read source text, comments included):
  - Read by crc-sync tests, owned by CLIENT: `wire-payload-contract.test.mjs:36-45` (`msg.<field>` inside
    `applyEfspSnapshot`/`applyEfspDelta`/`_boardSyncOf`/`_adoptBoardSeq`/`applyEfspMutationAck` in `efsp-state.js`,
    plus `efsp-messages.js`), `efsp-ui-b-hooks.test.mjs:107` (`strip-view.js`) and `efsp-time-chains.test.mjs:49`.
  - Read by crc-desktop tests, owned by server lanes: `client-mirror-parity.test.mjs:74` (BOARD, `board/ops/invoke-nla.js`
    regex), `:80` (SYNCTOP, the first `const TICK_MS = N` in `ws-hub.js`), `:177` (CORE, the first `const
    SEPARATION_REGIMES = new Set([...])` in `flight-data-store.js`), and `efsp-time-chains.test.mjs:29` (CORE).
  - In the same suite but missing from rule 10: `efsp-incirlik-l18-config.test.mjs:186-205` (WIRE: a quoted
    `'RSU'|'SFA'|'PAR'` inside a `/* */` comment in `permission.js` or `authority/**` fails it, because it strips only
    `//`), `efsp-ato-board.test.mjs:234-239` (DOMAINS: `SOURCE CAVEAT (EFSPImplementationGuide.md §9.9` and "community
    wiki|DCS community" must stay in every `ato/*` file it lists), `efsp-alerts-compose.test.mjs`, `theater-context.test.mjs:236`
    (SYNCTOP, `app.js`).
- Why it matters: a comment that says `msg.foo` inside one of those client functions, or that writes `const TICK_MS = 250`
  above the real one, turns the other suite red. The owning lane never runs that suite.
- Recommended: no comment may contain `msg.<x>` inside those client functions, a `const NAME =` line that repeats a
  scanned constant, or a quoted `'RSU'`/`'SFA'`/`'PAR'` in a block comment in `authority/**`/`permission.js`. Keep the
  `SOURCE CAVEAT` lines in `ato/*` verbatim. The supervisor's run of both suites on merged wave 1 is the real gate:
  keep it.
- Owner: supervisor (tell the lanes); CLIENT, SYNCTOP, CORE, BOARD, WIRE, DOMAINS.

### Q20-SYNCTOP-1 / Q20-DESK-1: the gate fails on `Dockerfile` and `.sh`, and is blind to new `_comment` keys

- Evidence: `l20-codecheck.mjs` `codeOf()` returns `null` for any extension other than js/mjs/cjs/css/html/json/py, so
  every changed `crc-sync/Dockerfile` (SYNCTOP Owns: "`crc-sync/Dockerfile` comments") and every
  `crc-desktop/scripts/*.sh` (DESK Owns `scripts/**`: three `.sh` files) prints `? unchecked type` and fails the gate.
  Separately, `normJson` drops `_comment*`/`_note*` keys **at every depth**, so a new `_comment` key passes the gate
  wherever it is added. The README's "the tuning loader skips `_` keys" is only half true. `tuning-file.js:14-21`
  `readShipped` returns the raw JSON, and the only skip is in `checkLayerKeys` (`:49`). Files without any `_` key today
  are keyed maps whose consumers iterate them: `config/apt-config.json` (`{}`, keyed by airport, counted against
  `MAX_AIRPORTS` in `apt-config.js:81`) and `data/icao.json` (`grpc-client.js:134`). A `_comment` there becomes an
  airport or an ICAO entry with the gate green.
- Why it matters: in the first case a lane stalls on a false red. In the second the gate passes a behaviour change.
  Nothing has gone wrong yet: SYNCTOP and DESK only edited existing `_comment`/`_note` strings. That was checked at
  their HEADs.
- Recommended: (a) leave `Dockerfile` and `*.sh` comments alone in wave 1, or list a hand diff of them in the report as
  "comment-only, unchecked type". The supervisor may instead extend `codeOf` to strip `#` lines for those types.
  (b) Ruling: **no new `_`-prefixed key in any JSON in wave 1**, only edits inside existing `_comment`/`_note` strings.
  Existing keys: `alerting.json`, `efsp-carriers.json`, `sensor-specs.json`, `theaters.json` (`_comment`);
  `efsp-instrumentation.json`, `efsp-surveillance-hints.json` (`_note`); `crc-desktop/app/data/aircraft-types.json`.
  SYNCTOP's default "split into `_comment` and `_note`" therefore applies only where both keys exist already.
- Owner: supervisor; SYNCTOP, DESK.

### Q20-BOARD-1 (and CLIENT, DESK, SYNCTESTS, WIRE, DOMAINS): stale `_method` pointers the scan cannot see

- Evidence: `l20scan.py` builds `defs` from the full text, comments included, so a comment like `_retireStrip (...)`
  or `_bayForNewOwner (the server rule...)` registers the name as defined and hides every other mention. Rebuilt from
  comment-stripped code, two more names are gone: **`_retireStrip`** (now `StripOps#retire`, `board-store.js:99`), at
  `board/ops/undo.js:10`, `board/persistence.js:44`, `board/tofi.js:343`, `bay/strip-element.js:46`,
  `e2e/l4-badges.spec.js:38`, `e2e/marsa-popover.spec.js:51`, `tests/freeze/freeze-traces.mjs:510`; and
  **`_bayForNewOwner`** at `bay-view.js:309` and `tests/efsp-role-bay-fallback.test.mjs:8`. Two more names are hidden
  because *other* stores still define them: `_dispatch` (`carrier-store.js:273`, `runway-status-store.js:276`,
  `sfa-store.js:117`) and `_touch` (`airspace-store.js:144`). The Board ones are now `StripOps#dispatch`
  (`board/strip-ops.js:68`) and the kernel's `recordTouch`. Board-sense mentions outside BOARD's files:
  `authority/primitives.js:31` (WIRE), `marsa-store.js:267` "board-store.js's _dispatch" (DOMAINS),
  `efsp-board-store-coordination.test.mjs:625`, `efsp-scenario-tactical.test.mjs:363`, `efsp-board-store.test.mjs:1168`
  (SYNCTESTS).
- Why it matters: acceptance is "stale pointers 0" by the scan. These sites pass that check and stay wrong.
- Recommended: each lane greps its Owns for `_retireStrip`, `_bayForNewOwner`, and Board-sense `_dispatch`/`_touch`,
  and repoints them (`board/strip-ops.js`'s `StripOps#retire` / `#dispatch`; for `_bayForNewOwner` the current
  Placement function). The supervisor can fix the scan by computing `defs` from the stripped text.
- Owner: listed lanes; supervisor (scan).

### Q20-CORE-2: the facility notes must not present the shipped consolidation as the guide's default

- Evidence: guide §4.8.6 rule 2 (`EFSPImplementationGuide.md:625`, unchanged in substance since phase 1, "RSU→TWR"
  before RENAME-C) gives the default consolidation as `CD`→`GC`→`LC`→`AP`→`CTR`, ..., `RSU`→`LC`, `SFA`/`PAR`→`AP`.
  INCIRLIK ships `{"CD":"GC","GC":"LC","LC":"AP","SFA":"AP","PAR":"AP"}`: it ends at AP and has no RSU. The comment
  on the literal at `8476c41^` (`facility-config.js:97-107`) said why: "deliberately NOT extended to CTR" (ADR 0013,
  intrafacility only) and "RSU is deliberately absent ... never strand on a supervisory Position" (ADR 0075). Also
  `position-store.js:29` still says "guide §4.8.6's default chain, Phase-1-truncated at TWR since APP doesn't exist"
  (false: AP exists and is in the map), and `position-store.js:64-65` quotes the old guide words "If the covering
  Position is also unstaffed, follow the chain to the end". The guide now reads "If that Position is also unstaffed,
  follow the consolidation to its end".
- Why it matters: a restated note that says "the guide's default chain" makes a SOURCE deviation look like doctrine.
  That is exactly D11.
- Recommended: the `consolidation` note in `facility-schema.js` reads "guide §4.8.6 rule 2 gives the default; the shipped
  maps deviate: `[SOURCE-DEFINED] (docs/adr/0013)` no AP→CTR (consolidation is intrafacility), `[SOURCE-DEFINED]
  (docs/adr/0075)` no RSU→LC (no Strip strands on a supervisory Position)". The old "occupancy-fallback" becomes
  "staffing fallback". Fix `position-store.js:29` and requote `:64-65` from the guide's current text. Put the
  guide/code difference in CORE's wip for L20-GUIDE (the usage guide's "What is ours" section).
- Owner: CORE; GUIDE (wave 2) for the summary.
- **Status after CORE `a5ed997`:** most of this is applied. `facility-schema.js:242-256` names the guide's default,
  marks RSU (0075) and PriFly (0074), and `position-store.js` is requoted. Three claims in the new block are still
  wrong; see Q20-CORE-3.

### Q20-ALL-2: line-number pointers, few but wrong

- Evidence: there are only five in code comments. `ato/ato-sets.js:34` `flight-data-store.js:67` (`CALLSIGN_RE` is at
  `:70`) and `ato/usmtf-tokenize.js:22` `flight-data-store.js:76` (`MAX_FREE_TEXT` is at `:79`): DOMAINS.
  `tools/soak/traffic.js:187` `coordination.js:65`: two files have that name now (`src/efsp/coordination.js`,
  `board/coordination.js`), and neither has the cited rule at `:65`. Also `:185` `coordination :166-180`: SYNCTOP,
  still unchanged at its HEAD. (`overflight.js:8` `EFSPImplementationGuide.md:214` is correct.) Since step 0, WIRE
  (`authority/strip-types/mission.js:6, :16`) and CLIENT (`efsp-nla.js`, two sites, from WIRE's Mirror line) have
  *added* "guide line 215". It is right today, but L20-GUIDE edits the guide in wave 2.
- Recommended: replace each with a `file`'s `symbol` pointer (README rule 2's form). For the guide, write "guide §3.4's
  lifecycle list". Write no new `file:line` in a comment, and use the full path where two files share a basename.
  WIRE changes its Mirror line, and CLIENT matches it.
- Owner: DOMAINS, SYNCTOP, WIRE, CLIENT.

### Q20-STR-1 (note for wave 2): one client string the inventory missed

- `efsp-metrics-client.js:112` logs "... for ${positionId}: not held (logged once)". That is the Position sense, so it
  should read "not signed on". It is a string, so it belongs to L20-STR. CLIENT should record it as a finding and not
  edit it. Do not confuse it with `runway-status-rules.js:229` "Landing ... is not held", which is the gating sense
  and stays.

## Part 2: review of the step-0s and first commits (all nine lanes have reported or committed)

Checked as correct, so no point is raised: BOARD's collaborator names (`StripOps#dispatch`, `retire`,
`BoardPersistence` owns `droppedWallAt`). WIRE's `board/placement.js`'s `validateBayImpliedTransition` and
`authority/index.js`'s `initialStateFor` both exist. The `theaterSettingsSet` message is gone (only a test proves its
absence). SYNCTESTS's repointed names all exist where it says (`stampStrip` in `wire/frames.js`; `nlaPrecheck`,
`isRejectedReplica` in `board/strip-ops.js`; `resolveOrderKey` in `board/placement.js`). SYNCTOP's U5: no literal
18000 is left in code; the value is `config/theaters.json` `defaultTransitionAltFt`. No lane has added a new `_` key
to a JSON file. DESK's local-server fact for DOCS is correct.

### Q20-CORE-3: three wrong claims in the new consolidation note (`facility-schema.js:242-256`, CORE `a5ed997`)

- (a) "CENTER and RANGES have none: a Position that owns no Strips has none to strand." CTR owns Strips: it has the
  `ctr-enroute` Bay, and the soak creates ARRIVALs at CTR (`tools/soak/traffic.js:188`). CENTER has no consolidation
  because it has one Position, so there is nowhere to send its Strips.
- (b) "An unstaffed Position with no successor is the guide's 'warn, do not block' (§4.8.6 rule 5)." This turns the
  guide upside down. Rule 3 (`EFSPImplementationGuide.md:626`) says a Strip "MUST NOT be left owned by an unstaffed
  Position with no consolidation path", which is D19. Rule 5 only says how to warn before a controller signs off. The
  chain ends we ship (AP, CTR, TAC_C2, CV_MARSHAL, OPS) are a deviation that ADR 0013/0075 accept. They are not
  something the guide allows.
- (c) "What ships otherwise is the guide's" leaves out `CV_APP2 → CV_APP1`. The shipped carrier map is
  `{"CV_APP2":"CV_APP1","CV_APP1":"CV_MARSHAL"}`, and the guide has `CV_APP*` → `CV_MARSHAL`. The extra hop is ours.
- Why it matters: this block is the "where is it sourced" note for every facility file, so D11 applies to it directly.
- Recommended: (a) "CENTER has a single Position, so nothing to consolidate at; RANGES' Positions are derived". (b)
  "Where the map ends (AP, CTR, TAC_C2, CV_MARSHAL, and OPS absent), a Strip of an unstaffed Position stays where it is,
  the D19 case of rule 3. `[SOURCE-DEFINED]` (docs/adr/0013, 0075): accepted, and the panel warns before sign-off
  (rule 5)". (c) Name the CV_APP2 → CV_APP1 hop as ours (ADR 0074, if it is the source; otherwise a decision row). Also
  mark the cut at AP → CTR, which `:244` explains but does not tag.
- Owner: CORE.

### Q20-DOCS-1: CLAUDE.md now says invalid JSON in any `state/` file stops start-up. Only some files do that

- Evidence: DOCS `e9d8676`, CLAUDE.md's `state/` paragraph: "an unknown key or an old shape in a file the service
  owns, invalid JSON, or a missing/invalid facility file stops start-up". True for the Board snapshot
  (`efsp/index.js:500-505` throws) and facility files (`facility-config.js:144-147`). False for the tuning layers:
  `tuning-file.js:35-40` "An unreadable layer warns and is ignored; the shipped file still applies". Also false for
  `apt-config.js:36-38`, which warns and starts empty. An unknown *key* in a tuning layer does stop start-up
  (`checkLayerKeys`).
- Why it matters: an operator reads CLAUDE.md as the deploy truth. A broken `state/alerting.json` silently falls back
  to the shipped file.
- Recommended: "an unknown key in any `state/` file, an old Board snapshot shape, invalid JSON in the Board snapshot,
  or a missing/invalid facility file stops start-up; an unparseable tuning layer is ignored with a warning (the
  shipped file applies)".
- Owner: DOCS.

### Q20-DOMAINS-1: two "overclaim" rewordings turned a DCS or published fact into "SOURCE's choice"

- Evidence: DOMAINS diff. `carrier/flight-record.js` "1..20 (the common DCS radio preset range)" became "(SOURCE's
  choice of preset range)". `carrier/ship-state.js` "9° ... the commonly published figure; the guide gives none"
  became "SOURCE's adopted figure".
- Why it matters: the marker rule is about not presenting *our* choice as doctrine. A fact from DCS's own modules
  is neither doctrine nor ours, and SYNCTOP's U16 treats DCS facts that way: "(DCS module facts, not from the guide)".
  Calling a DCS fact "SOURCE's choice" is the opposite error. The original "commonly published" was an uncited claim,
  so a rewording was right, but the claim is now changed rather than sourced.
- Recommended: preset range: "1..20 (DCS's radio preset range, a DCS module fact, not from the guide)". 9°: "SOURCE's
  adopted figure (the angled deck of a Nimitz-class carrier; the guide gives none)", with the marker if it is used as
  a rule input. If the lane cannot confirm the DCS fact, keep "SOURCE's choice" and add `[SOURCE-DEFINED]`, so the
  two senses are not mixed without a tag.
- Owner: DOMAINS.

### Q20-SYNCTOP-2: `config/theaters.json`'s `_comment` puts the marker on the cited values and not on the squadron's

- Evidence (untouched by SYNCTOP, live at base): "Syria +3 is a squadron decision (decisions.md H11); every other
  offset is [SOURCE-DEFINED] from MOOSE's UTILS.GMTToLocalTimeDifference()".
- Why it matters: README rule 5 says a value read from a cited source is not `[SOURCE-DEFINED]`, and a squadron
  decision is. Here the tag is reversed. The transitionAltFt sentence beside it is right: 18000 is ours and is
  marked.
- Recommended: "Syria +3 is [SOURCE-DEFINED] (decisions.md H11); every other offset is MOOSE's
  UTILS.GMTToLocalTimeDifference() (DCS community source, not the guide)". This edits an existing `_comment` string
  only.
- Owner: SYNCTOP.

### Q20-CLIENT-2: `scramble.js:152` explains an always-true guard, which the briefing forbids

- Evidence: CLIENT `f2fdd1a` rewrote the comment above the `typeof` guards to "the Position lookups come from imported
  modules; the guards below let a test sandbox without them simply select". An imported binding always exists, so no
  such sandbox is possible. L20-CLIENT's briefing says "do not add comments explaining them, the lane deletes them".
- Recommended: delete the guard sentence (ESM-GUARDS removes the guards), or keep only "the Position lookups come from
  imported modules".
- Owner: CLIENT.

### Q20-CLIENT-3 (= Q20-CORE-1, still open at both HEADs)

CORE's `time-chains.js:42` and CLIENT's `:27-28, :42` still differ, and CORE's wip has no Mirror line yet. Whichever
lane finishes first, the supervisor must not merge either side's `time-chains.js` alone.
