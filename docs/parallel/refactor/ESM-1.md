# ESM-1: the CRC client becomes native ES modules (no bundler)

> Read `README.md` in this folder first. Rulings: H87 (R3-30 + ARCH-D4: "native ES modules, no bundler;
> `<script type="module">`, node tests import the files directly, no build step in packaging"), ARCH-D7 (hand copies
> + PARITY stay). Plan: `docs/wip/ARCH-plan.md` §1.5, §2.9.

| | |
|---|---|
| Wave | W1, beside R0. Three ESM-1T lanes are cut from your branch at step 3's commit and convert the tests in parallel (`ESM-1T.md`). The four lanes merge as **one unit** |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-ESM-1` on `lane/ESM-1-client-modules` |
| ADR | none (0095 covers it) |
| E2E lane | `E2E_LANE=1` (the full suite for the unit) |
| Size / model | 1 lane / Opus 5.5 |

## Goal

Every script in `crc-desktop/app/public/js/` becomes an ES module with explicit `import`/`export`. Behaviour is
identical, proven by both unit suites and the full Playwright run.

## Owns

- `crc-desktop/app/public/js/**/*.js`: the module syntax only (import lines, `export` keywords, removing the guarded
  `module.exports` blocks), plus fixes forced by module semantics (TDZ order, `this` at top level, implicit globals),
  each listed. Function bodies otherwise stay untouched.
- New `crc-desktop/app/public/js/package.json` (`{"type":"module"}`) and new `js/main.js`.
- `crc-desktop/app/public/index.html`: the script block (`:919–980` and the EFSP load-order comment) only.
- `crc-desktop/app/server.js`: the `MIME` map (`'.js'` → `'text/javascript; charset=utf-8'`) only.
- `crc-desktop/package.json`: the `test` script glob (`tests/*.test.{js,mjs}`) only.
- `crc-desktop/tests/packaging-config.test.js` (one new assertion), `tests/client-global-surface.test.js` (replaced by
  `tests/module-graph.test.mjs` and `tests/fixtures/module-graph-exports.json`), `tests/helpers/**`.
- `crc-desktop/README.md`: a short "Client modules" section (granted).
- crc-sync tests that read client files: `tests/theater-context.test.mjs` (requires `magnetic.js`: use `await import`),
  `tests/wire-payload-contract.test.mjs` (scans `app.js`/`efsp-state.js` text: keep the scan working),
  `tests/efsp-time-chains.test.mjs` (byte comparison with the server's `time-chains.js`: compare the bodies and ignore the
  export trailer, which now differs by syntax).

## Frozen for you

The client test files the ESM-1T lanes convert (`ESM-1T.md` partitions). Everything in `crc-sync/src`. `main.js` and
the Electron packaging config (`package.json` `build`): read `crc-desktop/README.md` and do not change `build`.

## Steps

0. Step 0 per README. Record: every top-level name each script declares and reads from another script (reuse the
   scanner in `tests/client-global-surface.test.js`); every script with top-level statements that are not declarations
   (DOM queries, listener registration, `init()` calls); every `window.X =` / `globalThis.X` write; how `dock.js` and
   `app.js` start the UI; the CDN globals (`maplibregl`, `dockview`) and `config.js`'s four `var`s.
1. **Codemod, not hand edits.** Write a throwaway script in your scratchpad (not committed) that, from the step-0 map,
   adds `export` to every top-level name another file reads, and adds `import { … } from './…'` to every reader. Commit
   its output with the scratchpad script quoted in the wip file. Names read only inside their own file stay unexported.
2. **Infrastructure:** `js/package.json`, `js/main.js` (imports every module once, in today's tag order), `index.html`
   (CDN scripts and `/js/config.js` stay classic and first, then `<script type="module" src="./js/main.js">`), and the
   MIME line. Electron loads `http://localhost:<port>` (`main.js:140`), so modules have an origin. Check that the local
   server serves `js/package.json` harmlessly; nothing requests it.
3. **Commit "sources converted"** as soon as the app boots in Playwright smoke (`E2E_LANE=1 npx playwright test
   e2e/smoke.spec.js`). Tell "main" the commit hash: the three ESM-1T lanes are cut from it.
4. **Evaluation order.** ESM evaluates depth-first in dependency order, not in tag order. For every script in step 0's
   "top-level statements" list, show that its statements do not depend on another module having run first, or move the
   start-up call into `main.js` in today's order. List each case.
5. **Cycles and TDZ.** Import cycles are fine as long as no top-level code reads a cycle partner's `const`/`let`/`class`
   before it is initialised. Find every cycle (the module-graph test prints them) and check each one.
6. **Duplicates** (`_el` in `pattern-board.js`, `final-panel.js` and `metrics-panel.js`; `_callsignOfFdr` in
   `carrier-panel.js` and `efsp-panel.js`). Today the later script wins for **everyone**. Keep that effective behaviour
   (the earlier files import the winning variant), name each case in the wip file, and add it to the report as queue
   item 3 (plan §6). Do not pick a different variant.
7. **`module-graph.test.mjs`** replaces the global-surface guard. It checks that every `.js` under `js/` is reachable
   from `main.js`, that every import resolves to an export, and that the whole graph evaluates in Node under
   `tests/helpers/dom-stub.js` with no throw. The set of exported names per file is frozen in
   `fixtures/module-graph-exports.json` (a structure fixture; `GOLDEN_RECORD=1` rewrites it). It also checks that
   `index.html` holds exactly one module script.
8. **Packaging:** assert in `packaging-config.test.js` that `build.files` packs `app/public/js/package.json` (it is
   under `app/**/*`; `!app/package.json` excludes only the top one). Run `npm run pack:linux` once if your machine
   allows it, launch the AppImage, and confirm the EFSP panel renders. Otherwise say so in the report.
9. Integrate the ESM-1T branches' results when "main" tells you (the supervisor merges; you re-run the unit's gates on
   the merged unit branch the supervisor names).

## Acceptance (for the unit)

- crc-desktop `npm test` green, with the same count as at base minus the replaced global-surface tests plus the
  module-graph tests (explain the arithmetic). crc-sync `npm test` green.
- The full Playwright suite on `E2E_LANE=1`: same pass set as base (known flakes named by spec).
- No `module.exports` and no `typeof module` guard left under `app/public/js/`.
  `grep -rn "<script src=\"./js" app/public/index.html` finds nothing.
- `docs/wip/ESM-1.md` holds the step-0 map summary, the codemod, steps 4, 5 and 6 lists, and the packaging check.

## Defaults (P2)

- Client test files end in `.test.mjs`. The `test` glob keeps both suffixes, because the main-process and
  local-server tests (`lxsrs-setup`, `patch-notes`, `server-proxy-routes`, `packaging-config`) stay CommonJS `.test.js`.
- Where a test injected a stub through `globalThis` for a function that does I/O (sending on the socket), add an
  explicit setter in the module (`setEfspTransport(fn)`, and the like). Name each setter in the wip file.
- `/js/config.js` stays a classic script defining `var` globals. Modules read them as globals. Changing the
  local server's config contract is out of scope.
