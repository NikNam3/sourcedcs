# ESM-GUARDS: remove the always-true `typeof` guards on imported names; fix the latent ReferenceErrors

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: S-M-ESM (the client is native ES modules), S-ESM1d (`typeof
> globalThis[name]` guards resolve only through the bridge), `docs/parallel/l20/README.md` "Not L20" (ESM-GUARDS row),
> `docs/wip/L20-BRIEF.md` (362 guards in 52 files at `7b8f04c`; ESM-1 counted 336), S-TEST. UI code is exempt from "no
> magic values" (S3-6), and none are added here.

| | |
|---|---|
| Wave | A, **in parallel with BRIDGE**, partitioned by file. The decision and its reasons are below |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-ESM-GUARDS` on `lane/ESM-GUARDS-imports` |
| ADR | none (0095) |
| Size / model | 1 lane / Sonnet 5.5 |
| E2E lane | `E2E_LANE=2`: boot smoke, `l22-stars-scope` (geojson/atc-scope), and the panel specs listed at step 0. Never the full suite |
| Merge | after BRIDGE if both are ready (the module-graph fixture is shared), otherwise in either order: the supervisor merges the JSON. Before VERSION's and MAPKEY's client hunks only if it is ready first; see "Frozen" |

## Why parallel with BRIDGE, not after it

The task said "after BRIDGE, or partitioned so they don't collide". The files are disjoint:

- BRIDGE owns `e2e/**`, the bridge file, one import line in `main.js`, two comment lines (`sync.js`, `efsp-ws.js`) and
  the bridge parts of `module-graph.test.mjs` and its fixture.
- ESM-GUARDS owns code bodies in the other client modules.

The only shared files are `tests/module-graph.test.mjs` and `tests/fixtures/module-graph-exports.json`. Here, new tests
go in a **new file**, and the fixture changes only if you add exports, in a different section from BRIDGE's. The specs
do not depend on the guards. Running them in sequence would cost a whole lane-length on the path to every client
feature half (UNDO-C, SJ-C, CR-C, 2P-A, 2P-B, TOFI-REGIME's client).

## Code as found (re-find at step 0)

- Guards of the forms `typeof X === 'function'`, `typeof X !== 'undefined'`, `typeof X === 'object'`, and
  `typeof globalThis[name]`/`window[name]` where `X` is an **imported** binding. Under ES modules an import is always
  bound: an unresolved import fails module linking, never at run time. So these are always true, and the `else`
  branches are dead.
- At `99c9577` a narrow scan (named imports only) finds **333 in 45 files**. The heaviest are `efsp-messages.js` 45,
  `strip-view.js` 35, `bay-view.js` 29, `atc-scope.js` 27, `bay-views.js` 17, `geojson.js` 11, `bay/strip-element.js`
  11, `carrier-panel.js` 10 and `correlation-highlight.js` 10. L20-BRIEF's wider scan said 362 in 52.
- Re-count with your own scan, and save the scan script to `docs/wip/ESM-GUARDS/scan.py` (or `.mjs`). It must cover:
  - namespace imports (`ns.X`);
  - `typeof window.X` for names that are exports today;
  - `typeof globalThis[name]`, as in `efsp-metrics-client.js` `_efspMetrics()` (S-ESM1d).
- Guards that are **not** always true, which you keep:
  - `typeof window !== 'undefined'` and `typeof document` (Node unit tests load some modules without a DOM);
  - `typeof maplibregl`/`dockview` (CDN classic scripts);
  - `window.crcUpdate` (preload, absent outside Electron);
  - `window.getLatestTrack`/`getAllTracks`. These are assigned on `window` by `app.js` (~83-84), not imported, and
    are read guarded in `bay-view.js`, `carrier-panel.js`, `bay/popovers/bind.js` and `track-panel.js`.
- The latent ReferenceErrors:
  - `panels/tools-panel.js` `apiToIndicated` (~33-35) calls `_pressureAtAlt` and reads `ISA_L`, `ISA_INV`,
    `T_REF_ALT`, which nothing declares. The Tools tab's altitude calculator throws on use. The header comment
    (~8-12) says so.
  - `geojson.js` `buildExtendedCenterline` (~677-678 now, quoted as ~651 earlier) reads `trueHeading`, which nothing
    declares. The tick marks of the extended centreline throw whenever there is a tick, so `setData` never runs and
    the centreline is not drawn either. The variable it wants is the runway's true bearing `_aprtRwyTrueDeg`, already
    imported and used at ~654.
  - Both are `test.todo` in `tests/module-graph.test.mjs` (~218-219).
- QAC D-6 left `runway-status-panel.js`'s own `typeof toMagneticDisplay` guard "so tests that load it without
  magnetic.js are unaffected". Under ESM the import always loads `magnetic.js`, so it goes too, once the unit test
  that loads the panel is checked.

## Goal

Every guard on an imported binding is gone, with its dead `else`. Behaviour is identical except the two bug fixes,
which are separate `behaviour(ESM-GUARDS)` commits that a controller can see: the altitude calculator works, and the
extended centreline draws with its ticks.

## Steps

0. Step 0 per the refactor README:
   - the scan, and its per-file counts in `docs/wip/ESM-GUARDS.md`;
   - the keep list with a reason per kind;
   - every unit test that imports a module whose guard you will remove, plus how it stubs, to confirm no test
     depends on an `else` branch;
   - the panel specs that exercise the heaviest files, which become your touched-spec list.
1. **Structural commits by directory**, about 8 files each (`refactor(ESM-GUARDS): …`):
   - `typeof X === 'function' && X(...)` → `X(...)`;
   - `typeof X !== 'undefined' ? X : fallback` → `X`;
   - dead `else`/fallback code deleted;
   - comments that explained the guard are removed or reworded to the present (L20 rule 2).
   - After each commit: crc-desktop `npm test` and a `node --check` of each file.
2. `behaviour(ESM-GUARDS): tools-panel altitude calculator`. New `js/altimetry.js`, a hand copy of crc-sync
   `src/altimetry.js`'s `pressureAtAlt` and its ISA constants (`ISA_L`, `ISA_INV`, `T_REF_ALT`, …), following ARCH-D7's
   hand copies with parity tests.
   - `tools-panel.js` imports it.
   - New `tests/altimetry-parity.test.mjs` reads both files and compares the constants, plus three sample values of
     `apiToIndicated`/`indicatedAltFt`.
   - Fix the header comment.
   - DATA-3 deduplicates the server's two ISA copies (`altimetry.js`, `grpc-client.js`). Your parity test reads
     `altimetry.js`, which stays the owner.
3. `behaviour(ESM-GUARDS): extended-centreline ticks`: `trueHeading` → `_aprtRwyTrueDeg`. Ticks are perpendicular to the
   runway. Add a unit test of `buildExtendedCenterline` with a selected airfield: the features include ticks and
   nothing throws. Take a screenshot (APRT selected, approach radar held) into `docs/wip/ESM-GUARDS/`.
4. Turn both `test.todo` into tests in a **new** `tests/esm-latent-refs.test.mjs`. Delete the two `todo` lines from
   `module-graph.test.mjs`: that is your only edit there.
5. Optional, only if under about 30 minutes: export `getLatestTrack`/`getAllTracks` from `app.js` (ESM-1 finding), and
   switch the four guarded `window.` readers to imports. `window.getLatestTrack` itself stays assigned only if a spec
   still reads it; check BRIDGE's names.txt, and coordinate through "main". The export set fixture changes for
   `app.js` only.
6. Boot smoke, `l22-stars-scope`, and your touched-panel specs on `E2E_LANE=2`, each alone. Both unit suites once.

## Owns

- Guard lines and their dead branches in every `crc-desktop/app/public/js/**` file except `classic-globals-bridge.js`.
- New `js/altimetry.js`, `tools-panel.js`, `geojson.js` (`buildExtendedCenterline`).
- New tests `tests/altimetry-parity.test.mjs` and `tests/esm-latent-refs.test.mjs`.
- The two `test.todo` lines in `tests/module-graph.test.mjs`, and the `app.js` row of `module-graph-exports.json` (only
  with step 5).
- `docs/wip/ESM-GUARDS.md` and `docs/wip/ESM-GUARDS/`.

## Frozen for you

- `classic-globals-bridge.js`, `e2e/**`, and the bridge parts of `module-graph.test.mjs` and its fixture (BRIDGE).
- **Functions other wave-A lanes edit:**
  - `sync.js` `getSyncFeedUrl` and `app.js` `connect()` (VERSION);
  - `map-setup.js` map construction, `elevation.js`'s tile-URL builder, and `sync.js` `getSyncFeedUrl` (MAPKEY).
  - Guards inside those functions stay. List them in the report for a one-line follow-up after those lanes merge.
- All of crc-sync.

## Acceptance

- The scan reports 0 guards on imported bindings, apart from the keep list and the frozen functions (each listed with
  a reason).
- crc-desktop `npm test` green, with the two former todos now passing tests. crc-sync `npm test` green.
- The boot smoke shows zero script errors, and the touched specs have the same pass set as base.
- Line count of the client before → after.

## Defaults (P2)

- When an `else` branch did something real (not just a fallback for a missing import), stop, keep it, and list it
  under "Findings".
- `js/altimetry.js` is a hand copy, not a shared package (ARCH-D7).
