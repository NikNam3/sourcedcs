# STORE-THROWS (phase 2, B3 for the six non-Board stores)

Done: correlation, carrier, airspace, MARSA, runway-status and SFA `apply` catch-alls answer `INTERNAL_ERROR` (not
`VALIDATION_ERROR`) on a throw. Shared helper `crc-sync/src/efsp/store-throw.js` (`internalError`, `partialAuditTail`).
A throw counts as "after a write" when the store's sync seq moved since the op began; then the result is `partial`:
- audit line: `ok:false, reason/outcome INTERNAL_ERROR, partial:true, error`, and `after` is the record as it now stands;
- `wire/skeleton.js` persists on `ok || partial` and broadcasts the delta for a partial result (SFA's `persistWhen` and
  `broadcasts` extended the same way); `family.after` hooks still run only on `ok`;
- MARSA declare: the relation minted before the throw is attached; regime writes are drained into `flightDataList`.
A throw before any write stays a plain `INTERNAL_ERROR` refusal: audit line without `partial`, no persist, no broadcast.
The replay cache stores the refusal as before (now `INTERNAL_ERROR`), so a retry does not run the op twice.

Wire: `INTERNAL_ERROR` was already a reason the Board emits; crc-desktop has no per-reason table for it. No wire-surface
change (`npm run wire:record`: protocol stays 2, surface unchanged). No client change.

Tests: `crc-sync/tests/store-op-throws.test.mjs` (7). Not done: store-bookkeeping consolidation (ARCH-S #6, SERVER-SEAMS).
Flaky under full-suite load (pass alone): `ato tokenize: pathological inputs finish fast`, `grpc-client-stream ... jittered delays`.
