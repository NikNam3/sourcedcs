# AUTH: one authority registry; Position and Role families register into it

> Read `README.md` in this folder first. Rulings: S3-2, "one authority registry that Position families register
> into"; ARCH-D7 (client hand copies + PARITY stay); R3-72/S3-6 (data in JSON, rules in code). Plan:
> `docs/wip/ARCH-plan.md` §2.2, §2.4, §9 points 6 and 8.

| | |
|---|---|
| Wave | W3, beside BOARD-2, DATA-1, DATA-2, LOG-1, CMSG, ESM-2a, ESM-2b |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AUTH` on `lane/AUTH-registry` |
| ADR | none (0095 states the registry) |
| Size / model | 1.5 lanes / Opus 5.5 |

## Goal

Who may do what, and how each Role's lifecycle runs, live in one registry, `src/efsp/authority/`.
`authority/positions/<family>.js` covers civil ATC, Incirlik military ATC (RSU/SFA/PAR), tactical
(TAC_C2/AIC/GCI/JTAC) and carrier (CV Positions): capabilities and read scopes. `authority/roles/<role>.js` covers
departure, arrival, overflight, mission, marshal, final and pattern: states, initial state, NLA compute, state owners,
creators, countable states, replica state on receipt, sender state on accept, and coordination/TOFI eligibility.
`permission.js`, `nla.js` and `coordination.js` become facades that **export exactly what they export today**, so the
client parity tests, the freeze tables golden and every caller stay unchanged.

## Owns

`crc-sync/src/efsp/{permission,nla,coordination,read-scope}.js`, `src/efsp/traffic-count.js` (the countability
constants only), new `src/efsp/authority/**`, `tests/freeze/selfcheck/{M12,M14}.mjs`, the unit tests of those modules
where they reach internals, `docs/wip/AUTH.md`.

## Frozen for you

`board-store.js`, `board/**` (BOARD-2 is in them now; BOARD-3 will read your registry in W4), `facility-config.js`
(DATA-1), the store files (airspace, carrier, SFA keep their own authority checks for now: list them as follow-ups),
the whole client.

## Design

- `authority/index.js`: `registerPositionFamily(def)`, `registerRoleFamily(def)`, plus read accessors
  (`roleFamily(role)`, `capabilitiesFor(positionId)`, `stateOwners(role, state)`, …). Families register by being listed
  in `authority/index.js` (plain requires, in a fixed order). There is no dynamic discovery.
- Capability rows stay keyed by Position id, as today. The facility JSON (DATA-1) lists which Positions a Facility has.
  Add `tests/authority-coverage.test.mjs`: every Position id in every shipped facility config has a registered family,
  and every registered Position id appears in some config (§9 point 8). It is a test, not a start-up check, because
  `index.js` belongs to DATA-1 in this wave. BACKCOMPAT turns it into a loud start-up check in W6.
- `nla.js` keeps `computeNla` and the `STATES_BY_ROLE`-style exports, reading role families. `COMPUTE_BY_ROLE` becomes
  each role file's `computeNla`.
- `board-store.js`'s `DEFAULT_INITIAL_STATE_BY_ROLE`, `REPLICA_STATE_ON_RECEIPT` and `SENDER_STATE_ON_ACCEPT`: add their
  data to the role families and an accessor, but **do not edit board-store.js**. BOARD-3 switches the reads.

## Steps

0. Step 0 per README. Inventory every exported table and function of the four modules, every consumer (`src/`,
   `tools/`, crc-desktop tests that `require` them), and which table becomes which family field. Send this map to the
   questioner before writing code.
1. The registry, with the role families. `nla.js` and `coordination.js` become facades. The `tables-*` goldens are
   identical.
2. The Position families. `permission.js` becomes a facade.
3. `traffic-count.js` countability reads the registry.
4. Retarget M12 (a permission row) and M14 (a `Date.now()` probe in `nla.js`; still `nla.js`).

## Acceptance

Golden identical, `tables-permission-*` and `tables-nla-*` included; both suites green (crc-desktop's parity tests
require these modules); `freeze:selfcheck` all caught; a 10-line "how to add a Role family / a Position family"
note in the wip file.

## Defaults (P2)

- Doctrine tables are rules, so they stay in code in the registry (§9 point 6). Do not move them to JSON.
- When a table is shared by two families, it goes in the family that owns the state, and the other imports it.
