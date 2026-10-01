# LOG-2: every crc-sync `console.*` call goes to a module logger

> Read `README.md` and `LOG-1.md` in this folder first, then ADR 0097 (LOG-1's). Ruling: R3-33. Plan:
> `docs/wip/ARCH-plan.md` §2.5.

| | |
|---|---|
| Wave | W4, after LOG-1 merged; beside BOARD-3 and TIME-B. Merges after BOARD-3 |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-LOG-2` on `lane/LOG-2-call-sites` |
| ADR | none (0097) |
| Size / model | 0.75 lane / Sonnet 5.5 |

## Goal

About 135 `console.*` calls in about 34 files become `log.<level>(message, context)` on a logger named after the module
(`efsp:archiver`, `grpc`, `ws-hub`, …). The level follows the call's meaning, not its old method (a `console.log` of a
failure is `warn` or `error`), and the context carries the ids the old string interpolated. Tests that patch `console`
use LOG-1's test sink instead.

## Owns

The `console.*` call lines, and one `const log = …` line per file, in `crc-sync/src/**` **except** `board-store.js`,
`src/efsp/board/**` (BOARD-3), `src/efsp/surveillance-hints.js` and `src/efsp/conformance.js` (TIME-B); the same in
`crc-sync/tools/soak/**`; the crc-sync tests that patch or spy on `console`; `docs/wip/LOG-2.md`.

## Frozen for you

Every non-logging line of every file. If a log line sits inside a function you would otherwise want to tidy, leave the
function alone.

## Steps

0. Step 0 per README: the call-site table (file, line, old method, message, proposed logger name and level). Send it to
   the questioner: level choices are the judgement calls here.
1. One commit per directory (`src/`, `src/efsp/`, `src/surveillance/`, `tools/soak/`). Both suites green after each.
2. The tests that spied on `console` move to the sink, asserting the same messages.

## Acceptance

`grep -rnE "console\.(log|warn|error|info|debug)" crc-sync/src crc-sync/server.js` finds nothing outside your
exclusions (list any that remain and why); both suites green; golden identical (logs are not frozen);
`soak:selfcheck` green (the soak reads some log output: check `tools/soak/report.js` and the detectors).

## Defaults (P2)

- Messages keep their wording, minus the interpolated ids, which move into the context. L20 owns wording.
