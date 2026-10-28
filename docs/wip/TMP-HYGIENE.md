# Lane TMP-HYGIENE (phase 2, S): test runs no longer leave anything in /tmp

## What changed
- `crc-sync/tests/helpers/isolate-state.mjs` (preload): per-process `mkdtemp` root, `TMPDIR` set to it, `rmSync` on `exit`
  (children inherit `TMPDIR` plus `CRCSYNC_TMP_ROOT_OWNER`, so only the outermost process owns the root). New guard: the real
  `crc-sync/state/` file mtimes/sizes are snapshotted at start and compared on exit; a change sets exit code 1 and names the
  files. Opt-out: `CRCSYNC_ALLOW_STATE_WRITES=1` (a live dev server in the same checkout would trip it).
- `package.json` (crc-sync): `freeze:selfcheck` and `soak:selfcheck` now start with `--import` of the preload (their child
  processes inherit `TMPDIR`, so `freeze-hub-*`/`freeze-drv-*` land in the root and are removed). `test`/`freeze`/`freeze:update` already had it. Nothing under `tests/freeze/` edited.
- crc-desktop: `tests/helpers/isolate-tmp.mjs`, `--import`ed by `npm test` (works for the CommonJS and ESM files).
- sourcedcs-web: `scripts/isolate-test-env.mjs`, `--import`ed by `npm test`; also deletes the env keys the server reads
  (service tokens, `SOURCEDCS_CRCSYNC_URL`, Casdoor, Discord, public URLs, `PORT`, `LOG_LEVEL`). Put in `scripts/` not `test/`
  because `node --test` would run a file in `test/` as a test.
- I11 walk: depth from `CRCSYNC_WALK_DEPTH` (default 3). `npm run walk` = depth 4.

## Numbers (TMPDIR pointed at an empty scratch dir outside /tmp; only node's own `node-compile-cache` remained)
| suite | before: new entries | after | wall before -> after |
|---|---|---|---|
| crc-sync `npm test` | 146 dirs, 24 MB (ARCH-S/W) | 0 | 27.9 s -> 19.1 s (box busy with other lanes; I11 depth 4 -> 3, 408 -> 156 sequences) |
| `npm run walk` (depth 4) | - | 0 | 40.5 s under load (only that file) |
| crc-sync `npm run freeze` (48) | 624 dirs accumulated | 0 | 44.9 s |
| `soak:selfcheck` | | 0 | 2m25 |
| `freeze:selfcheck` | | 0 when it finishes (my `timeout 100` SIGTERM left 1 dir; a killed run cannot clean up) | |
| crc-desktop `npm test` 1137 | 12 | 0 | 1m42 |
| sourcedcs-web `npm test` 146 (with leaked AIRSPACE_SERVICE_TOKEN etc. in the shell) | 6 | 0 | - |
Results: crc-sync 2423/2423, crc-desktop 1137/1137, sourcedcs-web 146/146.
Guard verified on a scratch copy (write to state -> exit 1 naming the file; with the opt-out -> 0).

## For CLAUDE.md
Under crc-sync Commands: `npm run walk   # I11 control-release exhaustive walk at depth 4 (npm test runs depth 3, CRCSYNC_WALK_DEPTH=n overrides)`.
Also: test processes get a private TMPDIR removed on exit; a test that writes the checkout's `crc-sync/state/` fails the run.

## Walk in the freeze job?
Recommend yes: add `npm run walk` to the pre-merge/freeze job (it is the only place depth 4 runs now). Not wired into CI here.

## Defaults taken / findings
- Killed processes (SIGKILL/SIGTERM) skip `exit` handlers and leave their root; accepted.
- Playwright tmp dir untouched (E2E-STAB).
- crc-desktop's own `app/` tests (if any run separately) are not preloaded.
