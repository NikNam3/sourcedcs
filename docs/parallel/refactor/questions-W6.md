# W6 questioner: ESM-2a, ESM-2b, CMSG, BACKCOMPAT

Base `115ff24`. I read the four briefings, ARCH-plan §2.9 and §6, decisions.md (H80, H83, H87, H88, S-ARCH2, S-ESM1a..d,
S-M-ESM, S-PW-ESM, S-M-SYNC, S-M-DATA1) and `docs/wip/ESM-1.md`, then checked them against the code at `115ff24` and
against each worktree as it stood at about 23:30. Three of the lanes were already past step 0 when I got to them:

- CMSG has two commits, `3d95532` and `887a965`, and no wip file.
- ESM-2b has one commit, `33c2b9e`, with all seven clusters in it, and no wip file.
- ESM-2a has the whole split, uncommitted, and no wip file.
- BACKCOMPAT has `ccd0cb5` (step 0, 17 lines), `ae73266` and `95f949c`, and the alias removal is uncommitted.

So a lot of what follows reviews code, not a step-0 plan. Every point is checked against the file and line it cites.
Owner tells you who decides: **lane**, **supervisor** or **human**. Nothing here needs the human.

---

## Cross-lane (the three client lanes, plus BACKCOMPAT where noted)

### Q6-X-1 Merging the shared `module-graph-exports.json` (owner: supervisor)
**Evidence.** `tests/module-graph.test.mjs` writes the WHOLE file under `GOLDEN_RECORD=1`: every module's exports plus the
bridge block. All three lanes have re-recorded it. ESM-2b adds 7 `panel/*` entries (`33c2b9e`), CMSG adds
`efsp-message-registry.js` and `efsp-messages.js`, and ESM-2a adds 15 `bay/**` entries. I checked ESM-2a's working
tree: `bay-view.js`'s export set has nothing added and nothing removed, and the `bridge` block is byte-equal to the base.
ESM-2b's commit message says the same for `efsp-panel.js`.
**Why it matters.** If the JSON is merged by hand, a lane's accidental change to an export set can slip through. The
bridge test only says "may only shrink", and if the bridge does shrink, the Playwright specs that read the dropped
name lose it.
**Recommended answer.** After merging the three branches, run `GOLDEN_RECORD=1` once on the merged tree and diff the
result against `115ff24`. The diff must be: only new keys under `panels/efsp/bay/**`, `panels/efsp/panel/**` and the
two CMSG files; zero changes to the existing keys (`bay-view.js`, `efsp-panel.js`, `app.js`, the four panels CMSG
edited); and an identical `bridge` block. Treat anything else as a merge error.

### Q6-X-2 `bay-descriptor-parity.test.mjs:17`: both split lanes rewrote the same line (owner: supervisor)
**Evidence.** At the base, `CLIENT_FILES` lists only `bay-view.js`, `efsp-panel.js` and three others, and the test
scans them for `bay.X` reads. After a split most of those reads live in the new files. The test still passes because
it only asserts `read.size >= 3`, so it goes **silently** weak. ESM-2a now walks `bay/**` (uncommitted). ESM-2b
appended the `panel/*` files (`33c2b9e`). Each one rewrote the same line, and neither lane owns the test.
**Recommended answer.** Merge both into one directory walk of `panels/efsp/**`. That is a superset, and the next split
cannot repeat this. Record it as a structure-test change in the merge commit.

### Q6-X-3 `overflight-shared-state-names.test.mjs` ALLOWED map: ESM-2a and BACKCOMPAT both have to edit it (owner: supervisor)
**Evidence.**
- ESM-2a: line 42's key moves from `bay-view.js` to `bay/popovers/airspace-entry.js`, because the `HANDED_OFF` guard
  of `_canConvertToArrival` moved there. The edit is uncommitted, and the test is outside ESM-2a's Owns.
- BACKCOMPAT: line 36 lists `crc-sync/src/efsp/overflight-migration.js`. Line 62 asserts that every ALLOWED file
  still names INBOUND or HANDED_OFF. Deleting the migration (queue item 8, H88) therefore **fails a crc-desktop test**.
- BACKCOMPAT is a server-only lane that runs no crc-desktop file, so it would not see the failure.

**Recommended answer.** Let both lanes edit this one map. BACKCOMPAT removes line 36 in its item-5 commit and runs
`node --test crc-desktop/tests/overflight-shared-state-names.test.mjs` (under a second). At merge, ESM-2a's line and
BACKCOMPAT's line are different lines of the same object.

### Q6-X-4 Cross-lane imports go through the entry files only (owner: supervisor; already true, keep it)
**Evidence.**
- ESM-2b's `panel/*.js` import `renderAllOpenEfspBays`, `selectEfspStripById` and `_resolveActingPositionId` from
  `'../bay-view.js'`.
- CMSG's `efsp-messages.js` and `carrier-panel.js` import from `./bay-view.js` and `./efsp-panel.js`.
- ESM-2a's `bay/*` import from `'../bay-view.js'` and `'../efsp-panel.js'`.

None of them imports another lane's new internal paths, which do not exist on its base. The test seams depend on
this too. `_setRenderAllOpenEfspBaysForTest` and `_setRenderBayForTest` reassign bindings inside `bay-view.js`
(ESM-2a `bay-view.js:455-456`), so they reach callers only through live imports of `bay-view.js`. I checked:
no `bay/*` file captures `renderAllOpenEfspBays` or `renderBay` by value.
**Recommended answer.** Make it a rule for the merge check: `grep -rn "from '\.\./bay/\|from '\./bay/\|panel/" `
outside `bay/**`, `panel/**` and the two entry files must be empty. A later lane may import the internal paths, but
not inside this wave.

### Q6-X-5 Which Playwright specs each client lane runs (owner: supervisor, per S-TEST)
At most one Playwright process per lane, on that lane's `E2E_LANE`, run one after another. I mapped specs to lanes by
the DOM ids and features each spec touches:
- **ESM-2a** (`E2E_LANE=2`): `smoke`, `l2-block-editing` (block edit, refusal seeding), `l4-drag`, `l1-popovers`,
  `marsa-popover`, `l3-coordination` (coordination and TOFI popovers), `l4-badges` (chips and annotation history).
- **ESM-2b** (`3`): `smoke`, `l5-arrivals` (arrivals line), `ui-a` (tabs and the with-others Bay), `l3-coordination`
  (create-Strip box and dot command), `l14-ato-import` (refusal banner and ATO picker), `alert-scramble` (scramble.js
  sets `_activeBayId` through the re-exported setters), `l4-density` (connection banner).
- **CMSG** (`4`): `smoke`, `ui-b-resync` (named in the briefing), `l17-carrier` (carrier delta and ack; 03/04 has a
  known isolated flake, S-PW-ESM), `field-state`, `l18-incirlik` (SFA), `l1-marsa`, `l14-ato-import`,
  `obligation-retract` (alerts), `overflight-lifecycle` (airspace ack).

Leave out `l15-metrics:28`: it fails on the classic client too (S-M-SYNC).

### Q6-X-6 Both split lanes put several clusters in one commit, not one per commit (owner: supervisor)
**Evidence.** `33c2b9e` moves all seven `panel/*` clusters in one commit, about 1,600 lines removed. ESM-2a has
2,809 lines in 15 new files, uncommitted. Both briefings' step 1 says "one cluster per commit".
**Why it matters.** Review: ESM-2b's state rewrite (Q6-ESM-2b-1) changes many moved lines, so `--color-moved` cannot
match them, and a non-verbatim edit can hide among 1,600 moved lines.
**Recommended answer.** Do not make them redo the history. Before you merge, each wip file must contain:
- the cluster map (file → the names it exports → the names it imports from the entry file);
- an explicit list of every line that is NOT a verbatim move (setters added, renames, comment pointers changed);
- the output of `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change <base> -- <entry>
  <dir>` summarised as "N non-moved lines, all listed".

ESM-2a should still commit cluster by cluster, since it has not committed yet.

---

## ESM-2a

### Q6-ESM-2a-1 Selection and dispatch moved out, against the briefing's Goal (owner: supervisor; recommend accepting it)
**Evidence.** The Goal says `bay-view.js` "keeps selection, dispatch and Bay/Rack render-and-reconcile". The target
list in the same briefing names `bay/selection.js` ("selection state, refusal seeding, advance swallow"). The lane
built `bay/selection.js` (holding `_selectedStripId`, `_selectStrip` and `selectEfspStripById` with its test seam),
`bay/dispatch.js` and `bay/open-bays.js`. `bay-view.js` drops to 464 lines (the target is under about 700).
Refusal seeding ended up in `bay/block-edit.js:56`, next to `_openBlockEdit`, which it writes. That is correct: the
alternative was a cross-module write needing a setter.
**Recommended answer.** Accept it: the target list wins over the Goal sentence. In the wip file, say that only
render-and-reconcile and `renderAllOpenEfspBays` and its seams stay in `bay-view.js`, and say why seeding is in
`block-edit.js`.

### Q6-ESM-2a-2 `TOFI_ACCEPT_REGIMES` is a 7th hand-copied table, and it should go to `authority-mirror.js` (owner: lane)
**Evidence.** `client-mirror-parity.test.mjs:180` byte-reads `TOFI_ACCEPT_REGIMES` and compares it with the server's
regimes. The briefing lists six tables for `bay/authority-mirror.js`. The lane put this one in
`bay/popovers/tofi.js:61` and pointed the PARITY line at `tofi.js`.
**Why it matters.** ARCH-D7 keeps the hand copies with their PARITY tests, and the point of `authority-mirror.js` is
that every hand copy sits in one file. A 7th copy in a popover file is the one the next reader misses.
**Recommended answer.** Move `TOFI_ACCEPT_REGIMES` into `bay/authority-mirror.js` and point line 180 there. Also
check `efsp-coordination-client.test.mjs:80`: its `bayViewValue()` reads `bay-view.js` source for
`COORDINATION_TARGETS`, `AIRSPACE_ENTRY_POSITIONS` and the others, so it must read `authority-mirror.js`. The lane has
modified it; confirm that every name it reads still resolves (`constLiteral` throws on a miss, so a passing run proves it).

### Q6-ESM-2a-3 `export … from` is invisible to the module-graph walk; and no `export *` (owner: lane; supervisor for the regex)
**Evidence.**
- `module-graph.test.mjs`'s `importsOf()` only matches `^\s*import …` and `import(…)`, so a re-export
  `export { a } from './bay/x.js'` is not an edge. Today every `bay/*` file is also imported by someone, so the
  reachability test passes. But a file that is **only** re-exported (an authority table nobody inside imports, say)
  would be reported "unreachable".
- `export *` from two files that share a name drops that name from the namespace without an error. The bridge
  iterates `Object.keys(ns)` (`classic-globals-bridge.js`), so a dropped name is a lost window global, and a spec
  breaks with nothing pointing at it. The lane uses explicit `export { … } from` lists (`bay-view.js:61-103`), which is right.

**Recommended answer.** Lane: keep explicit lists, and do not use `export *` anywhere in `bay/**`. Supervisor: one
regex fix in `module-graph.test.mjs` (`^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]`) in the merge commit or
in L20. No lane owns that test.

---

## ESM-2b

### Q6-ESM-2b-1 The `els.*` / `createState.*` rewrite is not verbatim, and a verbatim option exists (owner: lane)
**Evidence.** `panel/state.js` replaces the 15 module-level `_xxxEl` lets (`efsp-panel.js:56-72` at base) with one
`els` object. It also replaces `_pendingCreateStripMutationId`, `_pendingDuplicateCallsign` and `_stereoRoutes` with
a `createState` object. Every moved line that read `_bayTabsEl` now reads `els.bayTabs`, and so on.
- At base, `initEfspPanel()` is the ONLY writer of the element refs, apart from the `_setBayContentElForTest` seam
  (`efsp-panel.js:1584-1598, 1626`).
- Imports are live bindings, and only writes need a setter.
- So `export let _bayTabsEl = null; …` in `state.js`, plus one `_cachePanelElements()` that contains the 15 original
  assignment lines, would keep **every moved reader byte-identical**.

A comment changed as well: "every other element above" became "every other element" (`state.js`). The rule is that
comments move verbatim.
**Why it matters.** The README's structural rule is a verbatim move. The goldens cannot see the client, and Playwright
is the supervisor's run, so reviewing the diff is the only check on this code. A rename touching about 150 lines
makes that review a manual one.
**Recommended answer.** Convert `els` back to exported lets plus one cache function, and restore the comment. The
three `createState` fields are written from more than one cluster (create-strip, dot-commands, refusal), so either a
state object or setters is needed. Keep that object, but list it in the wip file as the one non-verbatim change. If
the lane keeps `els`, it must list the rename as a mechanical exception in the wip file (Q6-X-6), with the sed
expression that reproduces it.

---

## CMSG

### Q6-CMSG-1 crc-sync's `wire-payload-contract.test.mjs` now fails, and one of its tests passes vacuously (owner: supervisor grants the edit; lane does it)
**Evidence.** I ran `node --test tests/wire-payload-contract.test.mjs` in the CMSG worktree at `3d95532`:
`not ok 4 - S-12 … 'app.js has no case for efsp-resync-reply'` (line 120).
Lines 80-81 slice `app.js` from `"case 'efsp-mutation-ack'"` to `"case 'efsp-positions-ack'"`. Both `indexOf`s now
return -1, so `slice(-1,-1)` is `''`, `inCase` is empty, and the test still **passes**. The check that the ack fields
the client reads are fields the server sends is now off for the case body.
**Recommended answer.** One edit in that crc-sync test, outside CMSG's Owns:
- read `app.js` + `panels/efsp/efsp-messages.js`;
- slice the handler from `registerEfspMessage('efsp-mutation-ack'` to the next `registerEfspMessage(`, and assert
  `from >= 0` so a future move fails loudly;
- assert `registerEfspMessage('efsp-resync-reply'` at line 120.

CMSG then has to run crc-sync's `npm test` once, which is in its acceptance anyway.

### Q6-CMSG-2 `efsp-scenario-resync.test.mjs` hand-copies the old switch (owner: supervisor, follow-up)
**Evidence.** `crc-sync/tests/efsp-scenario-resync.test.mjs:46-57`, `deliver()`, is "app.js's efsp cases, in the order
it runs them", re-typed as `eval` snippets. After CMSG the real order lives in `efsp-messages.js`. Nothing ties the
copy to it.
**Recommended answer.** No change in this wave, since the test passes and only its comment pointer is stale. Queue a
follow-up: the test imports `efsp-message-registry.js` and `efsp-messages.js` through `freshGraph` and calls
`dispatchEfspMessage`, which removes the copy. L20 changes the pointer comment if the follow-up has not landed.

### Q6-CMSG-3 Where registrations live, and keeping the registry a leaf (owner: lane)
**Evidence.**
- Briefing step 2 says to register "in the module that owns the family's state". The state modules (`carrier-state.js`,
  `sfa-state.js`, `efsp-state.js`) are frozen for CMSG. The lane registered in the four panel files its Owns allows,
  and everything else in `efsp-messages.js`. Good.
- `efsp-message-registry.js` imports nothing on purpose (its header comment). Without that, a top-level
  `registerEfspMessage(...)` in `carrier-panel.js` would hit the registry's `const _handlers` in TDZ when a fresh-graph
  entry evaluates `carrier-panel.js` first (module-graph test 6).
- `carrier-panel.js` now imports `bay-view.js`, and `bay-view.js` imports `carrier-panel.js`, so this is a new cycle.
  Only function bodies read across it, so it is safe.
- There are 23 efsp cases, not 22: snapshot, resync-reply, board-delta, heartbeat, mutation-ack, positions-ack, then
  {correlation, marsa, airspace, carrier, sfa, field-state} × {delta, ack}, alerts, ato-preview-result, ato-ack,
  metrics, metrics-report-ack.

**Recommended answer.** Write down in the wip file that "owns the family's state" was read as "owns the family's
panel", and why. Add one assertion to `ws-message-contract.test.mjs` (CMSG owns it): `efsp-message-registry.js` has
no `import`. That keeps it a leaf when someone later adds a convenience import. Record 23 as the case count.

---

## BACKCOMPAT

### Q6-BC-1 `_restore` swallows every error, so a "loud" shape error would empty the Board and then overwrite the file (owner: lane; high)
**Evidence.** `src/efsp/index.js:472-503`. The whole restore is wrapped in `try { … } catch (e) { log.warn('no prior
Board snapshot to restore (first run, or it failed to load)') }`. Anything thrown inside comes up as an empty Board:
an unknown shape, a missing key, a parse error, a store's `restore` throwing. The first Mutation's `_persist`
(`index.js:505`) then **writes the empty Board over the old file**. H88: "an unknown persisted shape is a loud startup
error".
**Why it matters.** Without this, the approved loud error is a silent wipe: worse than today's quiet acceptance, and
exactly what S3-4's "do nothing stupid" forbids.
**Recommended answer.**
- A missing file (`ENOENT` on `paths.read`, which falls back to `config/efsp-board.json`, never shipped) is a first
  run, and stays a warning.
- Every other failure is rethrown out of `createEfsp`, before `_persist` can run: unparseable JSON, the shape check
  (Q6-BC-2), a store's `restore` throwing, the detectors (Q6-BC-3).
- The message names the file and says "move it aside to start clean". That matches DATA-1's facility-file error
  (S-M-DATA1).
- Test: write a body with a pre-WP4A `board` key, and assert that `createEfsp` throws and the file is byte-unchanged.

### Q6-BC-2 Put the shape check in ONE place, the hook S3-4 already reserved (owner: lane)
**Evidence.** `src/efsp/stores.js:22`: "A future persisted-state `version` key and a per-store upgrade hook would go
here (S3-4: not now)". Today's body keys are `persistedWallAt` plus the eight `REGISTRY` keys. I checked the human's
local `state/efsp-board.json` (written 2026-10-01 19:37Z): it has exactly those keys and five Boards (INCIRLIK,
CENTER, TACTICAL, CARRIER, RANGES); none uses `board`, `correlation`, TRANSITING or old clearance cells. It would pass
a strict check. Prod has no EFSP state at all (H83 R3-2).
**Recommended answer.** Add one `assertKnownBody(saved, facilities)` in `stores.js`, derived from `REGISTRY`:
- every REGISTRY key is present (`sfaRotation` may be `null`);
- no other key except `persistedWallAt`;
- `boards` keys ⊆ the configured Facility ids.

Do not scatter throws through each store's `restore`, and do not add a `version` key now (S3-4). This keeps the
future versioning step a one-place replacement: `version` → upgrade → `assertKnownBody`.
The removed pre-WP4A `saved.board` branch (`stores.js:57-60`) then fails this check by name. Add a line to the error
saying that the last build with the restore migrations is the parent of the deleting commit. That is how the human
recovers old data, if ever.

### Q6-BC-3 Deleting the migrations makes old data silent, not loud; and three more silent shims remain (owner: lane for the migrations; supervisor for the rest)
**Evidence.**
- With `overflight-migration.js` gone, an OVERFLIGHT Strip saved as `TRANSITING` restores into a state its Role does
  not have, and nothing complains.
- With `clearance-migration.js` gone, an old clearance cell restores as a Strip annotation: DEPARTURE 21/20, ARRIVAL
  7/9A-VECTOR, OVERFLIGHT 7A/9A-VECTOR (`clearance-migration.js:9-13`). No current build writes such a cell, because
  `set-block.js:86` routes `kind: 'clearance'` targets to the FDR. So its presence is an unambiguous old shape.
- In `board/persistence.js` `restore()` (outside the lane's Owns, which covers only guards there):
  - `delete strip.correlation` (pre-ADR-0045);
  - a missing `droppedWallAt` defaults to "now" (pre-0082);
  - `data?.cidSeq || 0`;
  - a missing `replay` loads empty.

These are all back-compat for old shapes, and ARCH-D5 / H88 cover them.
**Recommended answer.**
- Lane: replace each deleted migration with a **detector** that runs in the same post-restore spot
  (`index.js:485-494`) and throws (Q6-BC-1): a Strip whose `state` is not valid for its `role`, using the Board's own
  `isValidState` rule, and an annotation cell on a block that `resolveBlockTarget` maps to `clearance`. Deleting a
  migration without a detector does not meet H88.
- Supervisor: grant `board/persistence.js` `restore()` to BACKCOMPAT. Either fold the four persistence shims into the
  shape check (a missing `cidSeq`/`replay`/`droppedWallAt` → error; a `correlation` field on a Strip → error), or rule
  that they stay and have them listed in the report as remaining back-compat. I recommend folding them in, since the
  local state already has all four fields (checked).

### Q6-BC-4 Removing the `blockVisibility` branch makes a legacy key silent (owner: lane)
**Evidence.** `facility-config.js:155-158` warns and deletes a legacy `blockVisibility`. `validateFacilityConfig`
(`facility-schema.js:231-245`) checks required keys only, so it does not reject unknown ones. Removing the branch makes a
legacy list **silently ignored**: quieter than today, the opposite of ARCH-D5.
**Recommended answer.** Replace the warn+delete at the same spot with a throw:
`[efsp-facility-config] <id>: <file> has a legacy blockVisibility list; express any narrowing as hiddenBlocks`. It
stays inside the lane's Owns (`facility-config.js`, blockVisibility only) and matches S-M-DATA1's startup errors.

### Q6-BC-5 The REQUIRED_RULES list-vs-scan check goes away when the freeze suite becomes opt-in (owner: lane)
**Evidence.** `95f949c` makes `src/efsp/required-rules.js` the list. Its header says that freeze guard 1's scan "is the
one source", and the equality assertion and the construction-throws test were added to
`tests/freeze/freeze-guards.test.mjs`. Step 3 moves `tests/freeze/**` out of `npm test`. After that, a rule newly read
in `board/**` but not added to the list is checked by nothing. If `index.js` also forgets to wire it, the result is a
`TypeError` mid-Mutation instead of a startup error, which is the failure this lane exists to remove.
**Recommended answer.** Move the scan-equals-list assertion and the throws test into a normal
`tests/required-rules.test.mjs` (same regex, about 15 lines). Guard 1 can keep its own copy for the parked suite.

### Q6-BC-6 `assertRules` accepts `null` for a function rule (owner: lane)
**Evidence.** `required-rules.js` `assertRules` only checks `name in rules` ("null, false and [] are values"). With the
guards gone, `peerBoard: null` or `isOccupied: null` passes construction and throws at the first Mutation that calls it.
**Recommended answer.** Split the list:
- data rules (`facilityId`, `aitAuthorized`, `standingReleases`, `carrierTransfers`, `sfaTransfers`): any present value;
- every other rule: `typeof === 'function'`.

It costs one line and keeps the error at startup.

### Q6-BC-7 Alias removal: the accessors still carry a hidden INCIRLIK default (owner: lane; supervisor for ws-hub.js)
**Evidence.** The lane changed `ws-hub.js:543` to `boardStoreFor(DEFAULT_FACILITY_ID)`. That is explicit, but
`ws-hub.js` is outside Owns, so you need to approve it. `index.js:267` and `:272` still declare
`boardStoreFor(facilityId = facilityConfig.DEFAULT_FACILITY_ID)` and the same for `positionStoreFor`. I grepped
`src`, `server.js`, `tools` and `tests`: no caller relies on the default.
**Recommended answer.** Drop both default parameters, so an omitted id returns `null` (as an unknown id does). That
is the alias in another form, and removing it costs nothing. The per-Facility heartbeat itself stays WIRE-B's (H88
item 5). Approve the one ws-hub.js line.

### Q6-BC-8 Closing the window: be precise with the scripts (owner: lane)
**Evidence.** `crc-sync/package.json` has `"test": "node --test"`, which finds every `*.test.*` file under the package:
135 in `tests/` and 5 in `tests/freeze/`, and nothing anywhere else (checked). No crc-sync CI job runs `npm test`.
**Recommended answer.**
- `"test": "node --test 'tests/*.test.mjs'"` (quoted, so Node expands the glob; this is also what CLAUDE.md already documents);
- `"freeze": "node --test 'tests/freeze/*.test.mjs'"`;
- keep `freeze:update` and `freeze:selfcheck`.

Check the count before and after: `npm test` should drop by exactly the tests in the 5 `tests/freeze/*.test.mjs` files.
Turn the authority-coverage test's first direction (a configured Position with no family) into the start-up check, in
`createEfsp` after the Facility loop, outside `_restore`'s try. Keep the second direction (a family no Facility lists)
as a test only: it is harmless at runtime.
