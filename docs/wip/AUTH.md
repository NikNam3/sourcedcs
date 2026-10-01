# AUTH: the authority registry (W3)

(Report goes here at the end.)

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
