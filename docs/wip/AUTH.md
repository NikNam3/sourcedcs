# AUTH: the authority registry (W3)

## Report

Branch `lane/AUTH-registry`, base `363aec9`. `git log --oneline 363aec9..HEAD`:
```
(top) docs(AUTH): report, how-to, defaults and findings
12e2400 test(AUTH): retarget freeze:selfcheck M12 to authority/roles/departure.js
5c5e6ad test(AUTH): overflight-shared-state-names ALLOWED follows the authority registry (S-AUTH0, approved by main)
1f76b82 test(AUTH): authority coverage (plan §9 point 8) and registry tests
c34d1a5 refactor(AUTH): traffic-count countability reads the Role families
b5e44f9 refactor(AUTH): Position families; permission.js becomes a facade
ccea67c refactor(AUTH): authority registry with the seven Role families; nla.js and coordination.js become facades
```
- **Suites:** crc-sync 2098 tests / 2096 pass / 1 load-timing fail / 1 todo -> 2106 / 2105 pass / 0 fail / 1 todo
  (+8: authority-coverage 2, authority-registry 6). crc-desktop 866 / 865 + 1 todo -> unchanged.
- **Golden:** identical after every structural commit (freeze 47/47; `tables-permission-*`, `tables-nla-*` included).
  No behaviour commits.
- **Selfcheck:** `freeze:selfcheck` 18/18 caught; M12 retargeted to `authority/roles/departure.js`, M14 unchanged
  (still `nla.js`). Soak selfcheck not run: no Gates file touched.
- **Structure fixtures:** `crc-desktop/tests/overflight-shared-state-names.test.js` ALLOWED (S-AUTH0, approved):
  added authority/index.js, op-kinds.js, roles/departure.js, arrival.js, overflight.js, positions/incirlik-military.js;
  dropped permission.js, coordination.js, traffic-count.js. Clock allow-list and board surface unchanged.
- **Outside Owns:** only that approved test. board-store.js, board/**, facility-config.js, client untouched.
  PARITY tests' require paths unchanged (facades).
- **Registry:** `src/efsp/authority/` = index.js (register*, accessors, composed tables, sealed after load),
  op-kinds.js, classes.js, primitives.js, positions/ (civil-atc, tactical, carrier, incirlik-military),
  roles/ (departure, arrival, overflight, mission, marshal, final, pattern, nla-common). Facades export exactly as before.
- **Unit tests retargeted (owned):** efsp-incirlik-l18-config (RSU/SFA/PAR literals only in INCIRLIK_CAPABILITIES,
  checked across the registry), efsp-alert-scramble (no alertStatus in nla.js or any Role family).
- **Defaults taken, findings:** below. For BOARD-3: switch board-store's three state tables to the registry accessors,
  then drop the pins in tests/authority-registry.test.mjs. For merge: DATA-1 also edited the ALLOWED list
  (trivial conflict). Store-local authority checks (airspace, field-state, SFA) are follow-ups.
- **Supervisor decides:** nothing open.


## Step 0: code as found (base `363aec9`)

Suites at base: crc-sync 2098 tests, 2096 pass, 1 fail (load timing, as S-M-BOARD1), 1 todo; crc-desktop 866, 865 pass,
1 todo; freeze goldens 47/47.

The briefing cites no line numbers. Found by symbol on the base:

- `src/efsp/permission.js` (736 lines). Exports: `canMutate, canCorrelate, canDeclareMarsa, canCreateStripRole,
  canActOnState, tofiCounterparts, PERMISSIONS, CREATE_ROLE_PERMISSIONS, STATE_OWNERS_BY_ROLE, DEPARTURE_/ARRIVAL_/
  OVERFLIGHT_/MISSION_STATE_OWNERS, OP_KINDS, COORDINATION_OP_KINDS, APP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS,
  AIRSPACE_ENTRY_OP_KINDS, TOFI_COUNTERPARTS, NO_STRIP_OP_CLASSES, canActOnFieldState, FIELD_STATE_OP_OWNERS,
  TACTICAL_CAPABILITIES, READ_SCOPES, handBackTargetsFor, tofiAnswererFor, readScopeFor, mayActBesideOwner,
  CARRIER_CAPABILITIES, canSetRecoveryCase, canSequenceMarshalStack, canEditShipStateInput, canRecordCarrierTransfer,
  MARSHAL_/FINAL_/PATTERN_STATE_OWNERS, INCIRLIK_CAPABILITIES, canRotateSfa, canSendSfaRotationTransfer,
  sfaRotationReceiver, sfaControllerPositions, incirlikPositionsWith`. Load-time side effects, in this order: MRU
  strip-back loop over PERMISSIONS; INCIRLIK rows written into PERMISSIONS/CREATE_ROLE_PERMISSIONS (appended keys RSU,
  SFA, PAR); `FIELD_STATE_OP_OWNERS.RequestRunwayStatus` extended with APP, RSU; INCIRLIK `ownsStates` merged into the
  role owner tables with fresh arrays (ARRIVAL.INBOUND +SFA, FINAL.* +PAR, PATTERN.* +RSU).
- `src/efsp/nla.js` (554). Exports: `STATES, DEPARTURE_/ARRIVAL_/OVERFLIGHT_/MISSION_STATES, STATES_BY_ROLE,
  MARSHAL_/FINAL_/PATTERN_STATES, isValidState, isFlightPlanValid, isVoidExpired, computeNla,
  REQUIRED_FOR_CLEARANCE, missingForClearance, CLEARANCE_BLOCK_LABELS`. Internal `COMPUTE_BY_ROLE`, `STATE_SETS_BY_ROLE`,
  `_requireNow`, `_normalizeCtx`, `_runwayInhibit`, seven `compute<Role>Nla`.
- `src/efsp/coordination.js` (118). Exports: `COORDINATION_PRIMITIVES, COORDINATION_EFFECTS,
  COORDINATION_ELIGIBLE_STATES, TOFI_EFFECTS, TOFI_ELIGIBLE_STATES, isCoordinationPrimitive, coordinationEffect,
  coordinationEligibleState, tofiEligibleState`.
- `src/efsp/read-scope.js` (144): pure filter functions, no table, no Position id. The read-scope column is
  `TACTICAL_CAPABILITIES.readScope` in permission.js. Nothing to move; stays as is.
- `src/efsp/traffic-count.js`: `COUNTABLE_PRE_DROP_STATES` (exported), `EXCLUDED_WHEN_NOT_COUNTABLE` (internal),
  both keyed by Role.
- `src/efsp/board-store.js` (frozen): `REPLICA_STATE_ON_RECEIPT` (l.60), `SENDER_STATE_ON_ACCEPT` (l.63),
  `DEFAULT_INITIAL_STATE_BY_ROLE` (l.65); read at l.494, 2062, 2118, 2596.

Consumers (all keep their import path): src `index.js` (rules injection), `efsp-ws.js`, `carrier-store.js`,
`field-state-store.js`, `sfa-store.js`, `forwarding-obligations.js`, `wire/families/{correlation,marsa}.js`; crc-sync
tests (~25 files, plus `freeze-tables`, `freeze-table`, selfcheck M12/M14); crc-desktop tests `client-mirror-parity`,
`bay-descriptor-parity`, `efsp-*-client`, `efsp-bay-views`, `efsp-ui-reachability`, `overflight-shared-state-names`.
No `tools/` consumer. Two tests read source text: `efsp-alert-scramble` (nla.js has no `alertStatus`) and
`efsp-incirlik-l18-config` (RSU/SFA/PAR literals only inside `INCIRLIK_CAPABILITIES`): both retargeted to the new files.

### Table → family map

| Today | Goes to |
|---|---|
| `OP_KINDS`, `COORDINATION_/APP_CTR_ONLY_/TOFI_/AIRSPACE_ENTRY_OP_KINDS`, `NON_CREATE_OPS` | `authority/op-kinds.js` (shared vocabulary) |
| `MRU_OR_NON_ATC_CLASSES`, `NO_STRIP_OP_CLASSES`, `NO_SCOPE_CLASSES` + predicates | `authority/classes.js` |
| PERMISSIONS/CREATE_ROLE rows OPS CD GND TWR APP CTR, `FIELD_STATE_OP_OWNERS`, `NON_OWNER_BLOCK_WRITES`, TOFI_COUNTERPARTS.CTR | `positions/civil-atc.js` |
| `INCIRLIK_CAPABILITIES` + SFA predicates (RSU, SFA, PAR, APP's L18 columns) | `positions/incirlik-military.js` |
| rows TAC_C2 GCI AIC JTAC, `TACTICAL_CAPABILITIES`, `READ_SCOPES`, `TOFI_ANSWER_ACTIONS`, TOFI_COUNTERPARTS.TAC_C2/GCI | `positions/tactical.js` |
| rows CV_*, `CARRIER_CAPABILITIES` + predicates, `canRecordCarrierTransfer` | `positions/carrier.js` |
| `<ROLE>_STATES`, `<ROLE>_STATE_OWNERS`, `compute<Role>Nla`, `DEFAULT_INITIAL_STATE_BY_ROLE[role]`, `COUNTABLE_PRE_DROP_STATES[role]`, `EXCLUDED_WHEN_NOT_COUNTABLE[role]`, `REPLICA_STATE_ON_RECEIPT[role]`, `SENDER_STATE_ON_ACCEPT[*][role]`, `COORDINATION_/TOFI_ELIGIBLE_STATES[role]` | `roles/<role>.js` |
| clearance helpers (`REQUIRED_FOR_CLEARANCE`, labels, `isFlightPlanValid`, `missingForClearance`, `isVoidExpired`, `WINDOWED_RELEASE_STATES`) | `roles/departure.js` (only DEPARTURE reads them) |
| `_requireNow`, `_runwayInhibit` | `roles/nla-common.js` (DEPARTURE + ARRIVAL) |
| `CV_LANES` | `roles/marshal.js` (COMMENCED is its first row); `final.js` imports it |
| `COORDINATION_PRIMITIVES/EFFECTS`, `TOFI_EFFECTS` | `authority/primitives.js` (per primitive, neither Role nor Position) |
| merges (MRU strip-back, INCIRLIK rows, RequestRunwayStatus, ownsStates) | `authority/index.js`, same order as today |

Position families register in the order civil-atc, tactical, carrier, incirlik-military, which reproduces every key
and array order of today's tables (incirlik-military extends civil-atc's APP and the role owner tables, so it is last).

## How to add a Role family / a Position family

- **Role family:** write `src/efsp/authority/roles/<role>.js` exporting `family = { role, states (DROPPED included),
  initialState, stateOwners, computeNla(strip, fdr, now, ctx), countablePreDropStates, excludedWhenNotCountable,
  replicaStateOnReceipt, senderStateOnAccept, coordinationEligibleState?, tofiEligibleState? }`, and add one
  `registerRoleFamily(require('./roles/<role>').family)` line in `authority/index.js`. `registerRoleFamily` refuses a
  missing field or a state that is not the Role's. Then the client's hand copies (`efsp-nla.js` NLA_LABELS and owner
  tables) fail `client-mirror-parity` until updated (ARCH-D7).
- **Position family:** write `authority/positions/<family>.js` exporting `family = { family, positions, extends?,
  permissions: {id: Set}, createRoles?, ownsStates?, fieldStateOwners?, fieldStateGrants?, nonOwnerBlockWrites?,
  tofiCounterparts?, capabilities? }`, and add one `registerPositionFamily(...)` line (after any family it extends).
  Then list the Positions in a facility JSON: `tests/authority-coverage.test.mjs` fails until both sides agree.
- The registry seals after the listed requires; a later `register*` call throws.

## Defaults taken (P2)

- Family names follow plan §2.2 (`civil-atc` holds OPS CD GND TWR APP CTR, although facility-config classes the
  Incirlik five as BASOPS/MILITARY_ATC: the name is the plan's, the rows are as before).
- Position families register civil-atc, tactical, carrier, incirlik-military (not the briefing's listing order):
  incirlik-military extends APP and the Role owner tables, and this order reproduces every composed table's key order.
- `CV_LANES` lives in `roles/marshal.js` (COMMENCED is its first use); `final.js` imports it (briefing default:
  the family owning the state).
- The primitive effect tables (`COORDINATION_EFFECTS`, `TOFI_EFFECTS`) are neither a Role's nor a Position's; they go
  to `authority/primitives.js`.
- `read-scope.js` has no table or Position id; unchanged. The read-scope column is in `positions/tactical.js`.
- The D21 one-Position predicates (`canMutate`, `canActOnState`, ...) stay in `permission.js`; family-specific
  predicates (SFA, carrier, tactical) live with their family and are re-exported.
- Validation-failure paths of `register*` are not unit-tested (the registry is sealed at load); only the seal is.

## Findings / follow-ups

- Store files keep their own authority checks, not in the registry yet: `airspace-store.js` (`_isControlling`,
  `_isUsing`, per-airspace controlling/using Position), `field-state-store.js` (inspection authority narrowing,
  acknowledger set), `sfa-store.js` (jurisdiction narrowing), `carrier-store.js` (calls permission predicates: fine).
- `coordination.js`'s `tofiEffect` was never exported (as found); kept, still unexported.
- `COORDINATION_ELIGIBLE_STATES` key order is now DEPARTURE, ARRIVAL, OVERFLIGHT (was ARRIVAL first). Same values;
  golden, deepEqual and every lookup unaffected.
- BOARD-3: read `authority.DEFAULT_INITIAL_STATE_BY_ROLE` / `initialStateFor`, `replicaStateOnReceipt(role, state)`,
  `senderStateOnAccept(primitive, role, state)`; then delete the three board-store literals and their pins in
  `tests/authority-registry.test.mjs` (the test says so when they disappear).
- DATA-1 (merged upstream) removed `facility-config.js` from `overflight-shared-state-names` ALLOWED; my edit of the
  same list will need a trivial merge.

## Questioner

No questioner points received during the lane.
