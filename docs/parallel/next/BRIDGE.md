# BRIDGE: the Playwright specs leave `classic-globals-bridge.js`, and the bridge is deleted

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: decisions.md **S-ESM1a** (the bridge is transitional, "for the
> Playwright specs only"), S-ESM1c (`history`), S-M-ESM, S-TEST, S-L20-DONE (the next code lanes),
> `docs/parallel/l20/README.md` "Not L20" (BRIDGE row: it also takes the e2e test titles and locals with old words, so
> L20-STR never touched `e2e/**`). Vocabulary: `docs/glossary.md` (rename-map §3/§4/§5). The window is closed: no golden
> work.

| | |
|---|---|
| Wave | A, beside ESM-GUARDS (disjoint files, see "Owns") |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-BRIDGE` on `lane/BRIDGE-specs-off-globals` |
| ADR | none (0095) |
| Size / model | 1 lane / Sonnet 5.5 |
| E2E lane | `E2E_LANE=1`. Run each spec file you change, **one file at a time**. Never the full suite: the supervisor runs it sharded after the merge |
| Merge | before ESM-GUARDS if both are ready (only the module-graph fixture is shared); both before any client feature half |

## Code as found (re-find at step 0; counts are from `99c9577`)

- `crc-desktop/app/public/js/classic-globals-bridge.js` (121 lines):
  - imports 54 modules as namespaces;
  - defines a live getter on `window` for **every** export (the fixture says 674 names, not the ≈668 quoted earlier);
  - provides `SETTERS` for 7 senders (`sendToSync` via `setSendToSync`, and six `sendEfsp*` via `setEfspSender`);
  - `SHADOWED = {history}`: the browser's History object with `app.js`'s `history` Map methods forwarded, for
    `l22-stars-scope.spec.js` `history.set(...)`;
  - exports `BRIDGED`/`SKIPPED`;
  - is imported last by `js/main.js` (`import './classic-globals-bridge.js'`).
- Pinned by `crc-desktop/tests/module-graph.test.mjs`: point 4's `bridge` section of
  `tests/fixtures/module-graph-exports.json` ("it may only shrink"), and test 7 ("only main.js imports
  classic-globals-bridge.js").
- Comments that name it: `sync.js` (above `setSendToSync`), `panels/efsp/efsp-ws.js` (above the sender setter).
- What the specs really use: a scan for whole-word occurrences of the 674 names in `e2e/**` finds **71 names in 32
  files**, an upper bound because `map`, `settings`, `tracks` and `history` also occur as locals. The heaviest are:
  - `getAllEfspStrips` 63, `getEfspFlightData` 62, `efspFlightDataList` 33, `sendEfspMutation` 18, `dock` 16,
    `getEfspRunwayStatus` 13, `map` 11, `getEfspStrip` 9;
  - `_invokeNla`, `applyEfspAlerts`, `carrierDerivedStack`, `getActingPositions`, `renderAllOpenEfspBays`,
    `sendEfspCreateStrip`, `DOUBLE_TAP_MS`, `history`, and roughly 50 more used once or twice.
  - `e2e/helpers/app.js` (14 names) and `e2e/helpers/test.js` (3) are the shared entry points.
  - The page reads them bare (`getEfspRunwayStatus('INCIRLIK')`) or as `window.X` inside `page.evaluate`, and
    `page.waitForFunction(() => typeof window.sendEfspSetPositions === 'function')` waits for boot.
- Sender replacement in specs:
  - `l15-metrics.spec.js` ~122 assigns `window.sendToSync`;
  - `l2-block-editing.spec.js` ~175/~195 assigns `window.sendEfspMutation`;
  - `e2e/helpers/app.js` ~144 wraps six `sendEfsp*` senders in a loop (`__e2eSent`).

## Goal

No spec reads an application global. The specs reach the app's modules through **one test-side helper**. The bridge
file, its import, its fixture section and its tests are gone. App behaviour is unchanged: the bridge was test plumbing.

## Design (default; step 0 may change the mechanism only with the supervisor's OK)

- **The page imports the modules itself.** Inside `page.evaluate`, `await import('/js/panels/efsp/efsp-state.js')`
  resolves to the same module record `main.js` loaded, because the URL is the same (`./js/main.js` from `/`). Live
  bindings come along. No production code changes.
  - Step 0 proves this once: `efspStrips` read through a dynamic import is the very Map the panel renders, and a
    sender set through `setEfspSender` is the one the panel calls.
  - It also checks `index.html`/`main.js` for any query string or base URL that would make the URL differ.
- **One helper, `e2e/helpers/modules.js`.** `installAppModules(page)` runs after boot, in the place
  `helpers/app.js` waits today. It does:

  ```js
  window.crc = { state: await import('/js/panels/efsp/efsp-state.js'), ws: …, nla: …, app: …, dock: …, … }
  ```

  - The keys are short module names, and one table maps each key to its path. The spec then writes
    `crc.state.getAllEfspStrips()`.
  - Only the modules the specs use go in. Step 0's scan gives about 15 to 20.
  - This is a test-side namespace, qualified by module, with no getters on `window` and no production import. It is
    not a second bridge.
  - The boot wait becomes `window.crc?.ws?.sendEfspSetPositions`. Keep `waitForFunction` where boot order matters.
- **Senders** go through the owning module's setter, never through assignment:
  - `crc.ws.setEfspSender('sendEfspMutation', fn)`, and `crc.sync.setSendToSync(fn)`;
  - the original is captured first as `crc.ws.sendEfspMutation`;
  - `helpers/app.js`'s wrap loop does the same per name.
  - If a setter is missing for a name a spec replaces, stop and SendMessage "main": adding one is a client file
    outside your Owns.
- **`history`** becomes `crc.app.history.set(...)`. It is `app.js`'s exported Map, and the browser's History is
  untouched.
- Private-looking exports (`_invokeNla`, `_moveStrip`, `_onStripKeydown`, `_buildBlockCell`, `_mountPopover`,
  `_openMarsaPopover`, `_stripElNeedsRebuild`, `_metricsPollTick`, `_ws`) are reached the same way. Do **not** rename
  or un-export anything. ESM-1 exported them as test seams, and R3-64's trim waits for a lane that checks planned use.

## Also in this lane: e2e vocabulary and stale strings

- **Test titles and locals in `e2e/**`** follow the glossary, as L20-STR did for unit tests (its rules in
  `docs/wip/L20-STR.md`: flight data, runway status, LC/GC/AP, signed on, consolidated at, staffed, INITIATED).
  Known hits:
  - `ordnance-hung.spec.js:133` "pilot walks with field state"; `:73` "APP records it, TWR sees it";
  - `runway-status.spec.js:210` (TWR), `:410` "one controller holding TWR, OPS and APP";
  - `l22-stars-scope.spec.js:177` (TWR/APP);
  - `tactical-positions.spec.js:141` "the TAC_C2 seat";
  - `l1-popovers.spec.js:160` "uncovered", which is probably the layout sense, so check before changing it.
  - Locals: `twr`, `gnd`, `app` (as the AP controller), `ARR_TWR` in `ordnance-hung`, `l5-arrivals`,
    `runway-status`, `l3-coordination`, `overflight-lifecycle` and `mtr-pilot-walk`.
  - Keep the kept senses (glossary §4): occupied pads and slots, `HELD`, "holds a Strip", ARIA `role`/`getByRole`,
    `peer*`.
  - Freeze trace names and spec *file* names stay. Renaming a file breaks `spec-timings.json` and the sharding.
- **Strings L20-STR changed.** `5b9f3a4` (L20-STR's string commit) reworded server refusal and log strings and a few
  client labels. They are listed in `docs/wip/L20-STR/strings.txt`, and include "referenced FDR not found" → flight
  data, "no field state at" → runway status, and "not held" → "not signed on".
  - Diff that commit's string literals, `git grep` each old string in `e2e/**`, and fix any spec that asserts one.
  - S-REFACTOR-DONE's two consistent failures (`l3-coordination:211`, `runway-status:283`) were already fixed in
    `4fbf057`; confirm them and do not redo them.

## Owns

- `crc-desktop/e2e/**`: the specs, helpers and new `helpers/modules.js`. Not `e2e/tools/**` beyond what the
  spec-hygiene test needs.
- `crc-desktop/app/public/js/classic-globals-bridge.js` (deleted), and the one bridge import line in
  `crc-desktop/app/public/js/main.js`.
- The two bridge comments in `sync.js` and `panels/efsp/efsp-ws.js`, comment lines only. Repoint them to "the e2e
  specs use the setter (e2e/helpers/modules.js)".
- `crc-desktop/tests/module-graph.test.mjs`: remove the bridge part of point 4 and test 7, and update the file's
  header list. Also the `bridge` section of `tests/fixtures/module-graph-exports.json`, deleted. The supervisor
  merges this JSON with ESM-GUARDS's.
- `crc-desktop/tests/e2e-spec-hygiene.test.mjs`: add one rule, "no `window.<name> =` assignment of an app sender in
  `e2e/**`", if that test's structure makes it a few lines. Otherwise skip it and say so.
- `docs/wip/BRIDGE.md`.

## Frozen for you

Every other `crc-desktop/app/public/js/**` file (ESM-GUARDS owns the guards; no production change is needed here), all
of crc-sync, `e2e/tools/run-sharded.js` and `spec-timings.json`.

## Steps

0. Step 0 per the refactor README:
   - re-find every symbol above;
   - write `docs/wip/BRIDGE/names.txt`: each bridged name a spec uses, with its file:line and the module that exports
     it (the import map's source);
   - the dynamic-import identity proof (one throwaway spec run on `E2E_LANE=1`);
   - the list of e2e titles and locals with old words;
   - L20-STR's changed strings matched against `e2e/**`.
   - Record the base pass set of the specs you will touch. Use S-REFACTOR-DONE's and S-L20-DONE's sharded results;
     do not re-run the full suite. Run a spec yourself only if no result exists for it.
1. `helpers/modules.js` and the two helper files (`app.js`, `test.js`) moved to it. Run the boot smoke and two specs.
2. Migrate spec files in batches of about 5, running each changed file alone after its edit. Commit per batch.
3. Delete the bridge, the main.js line, the fixture section and the bridge tests. Run crc-desktop `npm test`, the boot
   smoke, and a grep that no spec reads a bare app name (the names.txt list as whole words outside `crc.`).
4. Titles and locals in the new vocabulary (one commit), then the stale-string fixes (one commit). Re-run only the
   specs whose assertions changed.
5. Both unit suites once. Write the report.

## Acceptance

- `git grep classic-globals-bridge` finds nothing outside `docs/` history.
- `module-graph.test.mjs` passes without a bridge section.
- Every spec file you changed passes alone on `E2E_LANE=1` with the same pass set as base. Report a spec that was
  already failing at base as found, not fixed.
- The boot smoke shows zero script errors.
- No e2e title or local uses a replaced word (list the grep).
- The supervisor's sharded run after the merge is the full check.

## Defaults (P2)

- If one spec cannot work through a dynamic import (a name the page needs synchronously before boot), use
  `page.addInitScript` to install a promise `window.crcReady` that `helpers/modules.js` awaits. Never a getter on
  `window` from production code.
- A spec assertion that encodes an old *behaviour*, not an old word, is not this lane's: write it under "Findings".
