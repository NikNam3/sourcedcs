# RENAME-B report (client identifiers, CSS, HTML, UI labels)

Branch lane/RENAME-B-client, base 8c1347a (RENAME-A commit 1). `git log --oneline 8c1347a..HEAD`:
- 00504e1 docs(RENAME-B): review decisions for RENAME-A
- c982648 refactor(RENAME-B): client-only exact tokens (N03-N07, N10, N11, N17, N18 gnd-pending)
- e048ea2 refactor(RENAME-B): runway status client family (field-state stems)
- 68c2a61 refactor(RENAME-B): UI labels
- ed97831 behaviour(RENAME-B): dock layout key v2 (approved S-RENB0)
- (this report commit)

Tests: crc-desktop 883 (881 pass, 2 todo) -> 883 (881, 2 todo). crc-sync untouched (2111, 2110 pass, 1 todo). Golden not run (no server file).
Playwright (E2E_LANE=6, one at a time): smoke 1/1, runway-status 4/4, l4-chain 4/4, ordnance-hung 2/2. Not run (for the sharded run): l22-stars-scope, l1-nla-clearance-chain, l1-popovers, tactical-positions, l3-coordination (touch only renamed tokens).
Structure fixture: crc-desktop/tests/fixtures/module-graph-exports.json re-recorded (GOLDEN_RECORD=1) twice; only renames in place (classic-globals bridge names, none added or removed): coverageSignedOnPositions, *FlightData* compounds (getEfspFlightData, efspFlightDataList, ...), conflictAlertsForTrack, _createStripTypeEl, COMPACT_BLOCKS_BY_STRIP_TYPE, STRIP_TYPE_ABBR, getEfspRunwayStatus family, runway status panel functions. The specs read these names inside page.evaluate; the tool renamed them in the specs in the same commits, so spec reads and the bridge agree.
Files outside Owns: none kept (the tool edited crc-sync/tests/efsp-metrics.test.mjs `gnd-pending`; reverted, A's file).

## Review decisions for RENAME-A (Y/N totals, docs/wip/RENAME-B/review-*.tsv)
N03 2Y/10N (airspace/pad/runway occupancy N); N04 `held` 397Y/81N (comments and English in strings/test titles N; Position-list locals, params, wire field Y); N11 `role` 529Y/125N (ARIA, prose "Role", test titles, DOM-id regexes N); N13 PROPOSED 59Y/50N (only coordination/tofiCoordination state Y; Strip and runway-change PROPOSED N); N18 part 3Y/10N (test-local ARR_TWR N, comments N).
Decision classes: comment prose N unless it names the identifier; test titles N; string English N (the UI pass rewrites); DOM-id probe regexes `/role|stereo|bind/` N (see "Findings").

## UI strings
ui-strings.txt (inventory), ui-replace.tsv (24 replaced, rest KEEP with reasons), ui-replace-tests.tsv (14 assertions), apply_ui.py (replaces old on the named line only; fails if absent). Labels: field state -> runway status, STCA -> CA (geojson scope tag) / "Conflict Alert" (strip alert, track panel), manned -> staffed, covering -> consolidated, "No Position held" -> "No Position signed on", FDR -> flight data, Position ids in sentences APP/TWR -> AP/LC, SQUAWK -> BEACON (Block 5/M4 label via N17).

## Installed clients
- Dock layout key bumped to crc-desktop-dock-layout-v2 (S-RENB0): every user gets the default dock layout once after updating. Old: an unknown panel id throws in fromJSON, caught, default layout; no dead tab. crc-desktop-settings stores no Position ids. Release-note text for C: "Your dock layout resets once; panels return to the default positions."

## Defaults taken (P2)
- Plural stem compounds came out as `...Statuss`; hand-fixed to `...Statuses` (getAllEfspRunwayStatuses, efspRunwayStatuses), fixture re-recorded.
- "CA" only as the scope tag; strip-view and track-panel alert text spelled out "Conflict Alert".
- Ground radar label ' GND' (radar kind), "On Station", "Hand to Tower", "holds this Strip", pad `occupied` kept.
- WARN runway-status-panel already in file (index.html, dock.js): the CSS link / panel element after A's file move; same meaning.

## Findings for A / others
- Remaining B-owned token for A's files: `gnd-pending` in crc-sync/tests/efsp-metrics.test.mjs (A should rename to gc-pending).
- Test DOM-id probes need a hand fix in A's wire commit or after: tests/efsp-ato-first-filing.test.mjs:49, efsp-metrics-hooks.test.mjs:60 (`/role|stereo|bind/`), efsp-mission-line-panel.test.mjs:63, efsp-stereo-panel.test.mjs:49 (`id.includes('role')`); the id is now efsp-create-strip-type. They still pass (the mock default element works), but the select stub no longer applies to that id.
- `fieldState` locals/params (ordnance-advisory.js, scramble.js, runway-status-rules.js) and dock panel id are W tokens: A renames. `STCA` in goldens means the tool classes it W: A will also touch geojson.js:78 (same edit as mine, trivial conflict: take A's).
- Position-handle lower-case variables in e2e (twr, gnd, ARR_TWR): left, for L20.
- Comments still holding old words (hand-over, manned, SQUAWK, Role): L20.
