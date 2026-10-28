# PARITY: client mirrors of server tables

Lane PARITY (branch `lane/PARITY-mirror-tests`). Tests only; no production code changed.
Source concerns: D-9, S-6, S-12, D-10 (feature map). "L17" = the lane changing nla.js / block-map.js / permission.js.

## Inventory

Test paths are under `crc-desktop/tests/` unless noted. NEW = added by this lane.

| Mirror (client) | Server truth | Parity test |
|---|---|---|
| `strip-template.js` BLOCK_MAPS (required, fdr path, provenance, interlock, military field) | `block-map.js` | efsp-block-map-parity.test.js (existing). **L17 re-run** |
| `efsp-nla.js` STATE_OWNERS_BY_ROLE + 4 per-role owner tables | `permission.js` | efsp-nla-client.test.js (existing). **L17 re-run** |
| `efsp-nla.js` NLA_LABELS (keys = live states per Role) | `nla.js` STATES_BY_ROLE | NEW client-mirror-parity.test.js. **L17 re-run** (it will fail if L17 adds/renames a state without a label) |
| owner tables name exactly the states nla.js has per Role | `nla.js` | NEW client-mirror-parity.test.js. **L17 re-run** |
| `efsp-nla.js` COORDINATION_OP_KINDS, TOFI_OP_KINDS, COORDINATION_/TOFI_ELIGIBLE_STATES | `permission.js`, `coordination.js` | efsp-coordination-client.test.js (existing). **L17 re-run** |
| `bay-view.js` HAND_BACK_TO, TOFI_ANSWERED_BY | `permission.js` TACTICAL_CAPABILITIES | efsp-ui-reachability.test.js (existing). **L17 re-run** |
| `bay-view.js` AIRSPACE_ENTRY_POSITIONS, CONVERT_TO_ARRIVAL_POSITIONS | `permission.js` | efsp-coordination-client.test.js (existing). **L17 re-run** |
| every Position named in any client authority table / COMPACT_BLOCKS_BY_POSITION exists | `facility-config.js` Position sets | NEW client-mirror-parity.test.js |
| `field-state-rules.js` FIELD_STATE_ACTION_OWNERS (incl. runway-change owners) | `permission.js` FIELD_STATE_OP_OWNERS | efsp-field-state-client.test.js (existing) |
| `field-state-rules.js` runwayForStrip / normalizeRunwayEnd / inhibit wording / button offers | `field-state.js`, `field-state-store.js` | efsp-field-state-client.test.js (existing) |
| `field-state-rules.js` FIELD_STATE_RUNWAY_STRIP_STATES, FIELD_STATE_GEAR_CHECK_STATES | `field-state.js` RUNWAY_GATED_STATES, `nla.js` | NEW client-mirror-parity.test.js |
| `field-state-rules.js` FIELD_STATE_SUSPENSION_LABELS, FIELD_STATE_GEAR_TYPE_LABELS | `field-state.js` SUSPENSION_LABELS, GEAR_TYPES | NEW client-mirror-parity.test.js |
| `ordnance-advisory.js` | `field-state.js` hungOrdnanceAdvisoryFor | efsp-ordnance-client.test.js (existing) |
| `scramble.js` pure half | `alert-scramble.js` | efsp-scramble-client.test.js (existing) |
| `time-chains.js` | `time-chains.js` (byte copy) | `crc-sync/tests/efsp-time-chains.test.mjs` (existing) |
| `magnetic.js` / theater facts the client reads | `theater-context.js` wireBody, `magnetic.js` | `crc-sync/tests/theater-context.test.mjs` (existing, ADR 0085) |
| `los.js` terrain math | `terrain.js` | `crc-sync/tests/terrain.test.mjs` (existing) |
| `iff.js` IFF_STATES (S-6) + IFF_COLOR_DEFAULTS keys | `surveillance/iff.js` IFF_STATES | NEW client-mirror-parity.test.js |
| `efsp-nla.js` DOUBLE_TAP_MS (400), UNDO_WINDOW_MS (30000) | literals in `board-store.js` | NEW client-mirror-parity.test.js (source scan). **L17 re-run** if board-store.js `_applyInvokeNla` is touched |
| `efsp-nla.js` DEFAULT_STALE_THRESHOLD_SECONDS vs heartbeat | `ws-hub.js` TICK_MS | NEW client-mirror-parity.test.js |
| `radar-panel.js` EFSP_FACILITY_POSITIONS (Position lists) | `facility-config.js` getPositionSet | NEW client-mirror-parity.test.js |
| `efsp-ws.js` per-Facility held map keys, DEFAULT_EFSP_FACILITY_ID | `facility-config.js` | NEW client-mirror-parity.test.js |
| `strip-template.js` formatZuluHhmm | `zulu-time.js` | NEW client-mirror-parity.test.js |
| `geo.js` haversineM | `geo.js` | NEW client-mirror-parity.test.js |
| `bay-view.js` TOFI_ACCEPT_REGIMES | `fdr-store.js` SEPARATION_REGIMES (not exported; source-read) | NEW client-mirror-parity.test.js |
| Bay descriptor fields the panel reads (`bay.bayId/positionId/impliesState/rackIds`), Bay -> Position -> Facility, impliesState is a real state | `facility-config.js` getAllBays | NEW bay-descriptor-parity.test.js. **L17 re-run** (impliesState vs nla.js states) |
| ws message types: server `version: VERSION, type:` envelopes vs app.js `switch (msg.type)`, both directions; client sends vs server dispatchers (efsp-ws.js, metrics.js, ws-hub.js) | ws-hub.js, efsp-ws.js, metrics.js | NEW ws-message-contract.test.js |
| efsp-snapshot / efsp-board-delta / efsp-mutation-ack fields the client reads, against a real createEfsp() | `efsp-ws.js` | NEW `crc-sync/tests/wire-payload-contract.test.mjs` |
| efsp-resync reply types (S-12) | `efsp-ws.js` _handleResync | NEW ws-message-contract.test.js + wire-payload-contract.test.mjs |
| `strip-view.js` INDICATOR_ORDER / ALERT_SLOT_KEYS | none: client-only presentation (alert slot keys = what `_stripAlerts` emits) | efsp-ui-reachability.test.js pins the first six; no server counterpart to test |
| `strip-fields.js` COMPACT_BLOCKS_* | block ids vs BLOCK_MAPS (client-only) | efsp-strip-fields.test.js (existing) |
| Stripe colours | CSS only, no server table | n/a |

### Not mirrored (checked)
Theater config fields the client reads are held by `theater-context.test.mjs`. `apt-config`, `atis`, `coverage`, `weather`, `status`, `game-time`, `init` have no hand copy of a server table; they are covered only for existence by ws-message-contract.test.js (their field lists are not contract-tested; a smell, low risk).

## Findings for the supervisor
1. **S-12 confirmed.** `sendEfspResync()` (efsp-ws.js) has no caller anywhere in `crc-desktop/app/public`. The server `efsp-resync` path is built and tested but unreachable from the shipped UI; reconnect relies on the fresh snapshot. `efsp-resync` has no `-ack` type: replies are `efsp-board-delta` or `efsp-snapshot` (now pinned). `test.todo` in ws-message-contract.test.js; decision: wire it or delete the dead path.
2. **No live drift found** in any mirror. Every new test passes on the current tree.
3. Server oddity (not drift): `field-state.js` `SUSPENSION_KINDS = ['WORKS','RUNWAY_CHANGE']` but `SUSPENSION_LABELS` only has `WORKS`, so a runway suspended by a runway change reads "suspended — works in progress" through the `|| 'works in progress'` fallback in `runwayStatusReason`. Client copy agrees with the server. Intended? Probably wants its own label.
4. Not a drift, but easy to misread: `RUNWAY_GATED_STATES` lists states whose ENTRY uses the runway (DEPARTED, FINAL, ...), the client RWY chip list is the state BEFORE each (plus earlier ones). The test encodes that relation, not equality.
5. Several mirrors are source-scanned because the client constants are not exported (`constLiteral` in tests/helpers/mirror-source.js). Moving or renaming the declaration fails the test loudly with the name to fix.
6. D-10 (god files) is a refactor concern; out of scope. The vm/source-scan helpers do not need the guarded `module.exports`.

## Defaults taken
- Lane-rules item 4 says `Co-Authored-By: Claude Opus 5.5`; the briefing said Sonnet 5.5, so commits use `Claude Sonnet 5.5`.
- Source-scan (not module load) for un-exported bay-view.js / radar-panel.js constants, rather than touching production exports.
