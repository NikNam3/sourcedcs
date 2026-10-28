# DATA-1: facility data has one source, the JSON

> Read `README.md` in this folder first. Rulings: R3-72 ("json should be the source for all data; the code should
> only define rules and interactions"), S3-6 ("no magic values in code, except UI code"), S-desk3 ("the
> `DEFAULT_CONFIG` literals go"). Respect ADR 0048's `config/` / `data/` / `state/` split (`src/state-paths.js`). Plan:
> `docs/wip/ARCH-plan.md` §1.6, §2.6, §6 items 6 and 7.

| | |
|---|---|
| Wave | W3, beside BOARD-2, AUTH, DATA-2, LOG-1, CMSG, ESM-2a, ESM-2b |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-DATA-1` on `lane/DATA-1-facility-json` |
| ADR | none (0095 §5) |
| Size / model | 1 lane / Sonnet 5.5 |

## Goal

`facility-config.js` holds no literals. `config/efsp-facility-{incirlik,center,tactical,carrier}.json` are the shipped
source. A `state/` copy, if present, replaces the shipped file **whole** (no merge). `facility-schema.js` validates
them. Loading happens when `createEfsp` asks, not at require time. The shipped values are identical, so the goldens are
identical.

## Owns

`crc-sync/src/efsp/facility-config.js`, new `src/efsp/facility-schema.js`, `crc-sync/config/efsp-facility-*.json`
(two existing, two new), `src/efsp/index.js` (**only** the line or lines that trigger the facility load),
`tests/freeze/freeze-tables.test.mjs` (only the shipped-defaults reader: read the loaded configs instead of
`DEFAULT_CONFIGS`, with an identical golden), the facility-config unit tests, `docs/wip/DATA-1.md`.

## Frozen for you

Everything else, including AUTH's files, the store files, `airspace-config.js` (DATA-2), and the crc-desktop tests that
`require` `facility-config.js` (keep its accessor API so they pass unchanged).

## Steps

0. Step 0 per README. Prove, with a script you quote in the wip file, that `{...DEFAULT_CONFIG, ...onDisk}` for INCIRLIK
   and CENTER equals the shipped JSON key for key, or list every difference. Note which keys exist only in the literal.
   List every consumer that calls a facility accessor at require time (a module-level `getAllBays()` call, for example).
1. **Structural commit:** write `efsp-facility-tactical.json` and `-carrier.json` from the literals, and complete
   INCIRLIK and CENTER with any literal-only key (so they equal the effective config today). Add a temporary test that
   the JSON equals the old literal, then delete the literals and that test. RANGES stays derived (code). Golden
   identical.
2. **Structural commit:** `facility-schema.js` (`validateConfig` moves here, plus required keys and cross-references:
   Bays point to known Racks, the covering chain names known Positions, `holdsRole` is a known Role). Lazy load: the
   accessors load on first call from `statePaths()`. `createEfsp` calls `facilityConfig.load({ paths })` explicitly.
   Nothing reads a file at require time.
3. **`behaviour(DATA-1)` commit** (plan §6 items 6 and 7, approved by the supervisor): a missing or invalid file throws at
   load with the validation message, instead of falling back to literals. A `state/` copy replaces the shipped file whole.
   Re-record only if a golden changes (none is expected). List every test that asserted the old fallback and how it
   changed.

## Acceptance

Golden identical across commits 1 and 2; both suites green; no `DEFAULT_` literal left in `facility-config.js`
(`grep -n "DEFAULT_" src/efsp/facility-config.js` shows only `DEFAULT_FACILITY_ID`, or that too is in JSON: say which);
`setFacilityConfig` still writes `state/` (ADR 0048).

## Defaults (P2)

- The legacy `blockVisibility` handling stays (BACKCOMPAT removes it).
- `DEFAULT_FACILITY_ID = 'INCIRLIK'` is a server default, not facility data. Keep it in code unless a config file
  already names a default Facility.
