# DATA-2: tuning defaults move to their JSON twins; the literal inventory

> Read `README.md` and `DATA-1.md` in this folder first. Rulings: R3-72, S3-6, P5 (tuning files are read once at
> start-up and never written by code). Plan: `docs/wip/ARCH-plan.md` §1.6, §9 point 6.

| | |
|---|---|
| Wave | W3, beside DATA-1 and the rest |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-DATA-2` on `lane/DATA-2-tuning-json` |
| ADR | none (0095 §5) |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

Every code-side default that duplicates a shipped JSON file is removed. The JSON is the source, and the code
validates it. You also hand the human an inventory of every remaining literal in `crc-sync/src`, each with a
proposed class, so S3-6's boundary gets decided once.

## Owns

The defaults (only) in: `src/alerting-config.js` (`DEFAULTS`), `src/efsp/instrumentation-config.js`,
`src/efsp/surveillance-hints-config.js`, `src/efsp/carrier/{hull-config,ship-state}.js` (`DEFAULT_HULL`),
`src/radars.js` (`DEFAULT_CAPS`, `DEFAULT_PRESENTATION`, `SHIP_RADAR_DEFAULT`), `src/theaters.js`
(`DEFAULT_TRANSITION_ALT_FT`), `src/efsp/stereo-routes.js` and `src/efsp/airspace-config.js` (the `[]` defaults); the
matching `crc-sync/config/*.json`; those modules' unit tests; `docs/wip/DATA-2.md`.

## Frozen for you

`facility-config.js` (DATA-1), `surveillance-hints.js` and `conformance.js` (TIME-B, W4), `src/app.js` and
`server.js` (LOG-1 now), AUTH's files, the Board, the wire.

## Steps

0. Step 0 per README. For each module: the literal, the JSON twin, how they merge today, and whether a value exists
   only in code.
1. One structural commit per module: complete the JSON with any value that exists only in code, remove the literal,
   and validate at load. Golden identical.
2. **The inventory** (`docs/wip/DATA-2.md`): every numeric or string literal in `crc-sync/src/**` that is not a
   message, an identifier or a protocol constant. Classify each one as **data** (move to JSON), **tunable** (move to a
   tuning file), **doctrine rule** (stays in code, in the authority registry) or **engineering constant** (stays named in
   code), with your proposal and a one-line reason. Include `APPLIED_MUTATIONS_CAP`, `REPLAY_PERSIST_WINDOW_MS`,
   `RESYNC_RING_WINDOW`, `REBALANCE_KEY_LENGTH`, marshal `maxIndex`, `DEFAULT_CASE`, `DEFAULT_STACK_ID`,
   `LOOKUP_TIMEOUT_MS`, the archiver's retention, and every `[SOURCE-DEFINED]` value. The supervisor puts the table on
   the Decision Desk. **Do not move anything the human has not classified.**

## Acceptance

Golden identical; both suites green; P5 respected (each file is read once at start-up, and no code writes it); the
inventory is complete (state the scan command you used).

## Defaults (P2)

- A missing tuning file is a start-up error with the file name, as in DATA-1, in a separate `behaviour(DATA-2)` commit.
  Tell "main" before you commit it.
