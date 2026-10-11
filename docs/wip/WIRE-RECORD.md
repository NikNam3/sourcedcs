# WIRE-RECORD: the wire-surface scan covers the carrier half

Finding S-ARCH-41 (CARRIER-STATE, MARSHAL-BOARD, MARSHAL-MARKS): `crc-sync/tools/wire-surface.js` never saw the carrier
ops, stack keys or handoff names, so a carrier-only wire change could ship without a protocol bump.

## What `computeSurface` covers now

Each item is read from the list the server itself dispatches by or builds with. Nothing is copied by hand.

| Surface key | Source |
|---|---|
| `clientToServer`, `serverToClient` | unchanged (text scan of `ws-hub.js`, `efsp-ws.js`, `efsp/**`, the family registry) |
| `efspOpKinds` | **the Board op table** (`board/ops/`, what `StripOps#dispatch` looks up) ∪ `OP_KINDS` ∪ coordination step ∪ formation ∪ `Undo`. New: `CarrierHandoff`, `SfaRotation`, which the client sends in `efsp-mutation`. The old comment called them internal, which was wrong |
| `storeOpKinds[<family type>]` | airspace `AIRSPACE_OP_KINDS`; carrier `STATE_OP` (`SetCarrierState`, now exported) + `STACK_OP_KINDS`; runway status `RUNWAY_STATUS_OP_OWNERS` keys (the authority table that gates it); SFA `SET_OP` (now exported); correlation, MARSA and ATO from their dispatch literals (`case 'X':`, `op.kind ===/!== 'X'`; an empty scan throws) |
| `carrier` | `CARRIER_HANDOFFS` keys (e.g. `COMMENCED_TO_MARSHAL`), `TRIGGER_TYPES`, `CASES`, `FIELD_NAMES` (SetCarrierState `field`), `ENTRY_STATUSES`, `CLEARANCE_FIELDS` (`unpassed` values), `STACK_KEYS`, `ENTRY_KEYS`, `CARRIER_FLIGHT_FIELDS`, plus the keys of a real `CarrierStore.view()` (shipped hulls, one appended flight): the view's top level, `state`, and a derived stack entry |
| `sfaTransfers` | `SFA_TRANSFERS` keys |
| `storeSync` | `STORE_SYNC` (snapshot/heartbeat key, seq/epoch keys, delta type) |
| `frameKeys` | the hub frames as before, plus every store delta: board, airspace (built by its family's `broadcasts`), correlation, MARSA, runway status, carrier (real store), SFA, from `wire/frames.js` |

Removed op kinds (`SetCase`, `SetCharlieTime`, `SetMarshalRadial`) need no special case. They are gone from
`STACK_OP_KINDS`/`STATE_OP`, so a removal changes the surface the same way an addition does.

Server change: `carrier-store.js` exports `STATE_OP`, `sfa-store.js` exports `SET_OP`. No behaviour change.

## Tests added (`crc-sync/tests/wire-protocol.test.mjs`)

- A child process patches `STACK_OP_KINDS`, `ENTRY_KEYS` and `CARRIER_HANDOFFS` with a probe value. The test checks that
  each probe reaches the surface and that the surface no longer equals the fixture. Checked by hand as well: adding
  `'Probe'` to `STACK_OP_KINDS` in source fails "the wire surface matches the recorded fixture" (`Differs: storeOpKinds`).
- Completeness: every `*-mutation` family has op kinds on the surface; every `STORE_SYNC` entry has its delta's frame
  keys and a `storeSync` row; every Board op table kind is in `efspOpKinds`. A new family or store fails here until
  `wire-surface.js` reads it.

## Still not covered (needs `npm run wire:record -- --bump` by hand)

- Keys inside a Strip, a flight-data record (outside the carrier flight fields), or an airspace, correlation, MARSA,
  runway-status or SFA record.
- Ack payload keys (each family's `ack()`), `efsp-heartbeat` (built inline in `ws-hub.js`), `efsp-snapshot`'s fixed keys
  (`facilities`, `boardSeqByFacility`, `positionLetters`, …). The store and family parts of the snapshot are covered
  through `storeSync`.
- Op argument names (e.g. `op.transfer`, `op.minutes`, `op.field`) and refusal codes (`REFUSAL_CODES`). Refusal codes
  could be added cheaply if the supervisor wants them on the surface.
- Value meanings (a unit or an enum's semantics). This is what `--bump` is for.

## Protocol

`npm run wire:record` printed:
`wire:record: WIRE_PROTOCOL stays 2 (last release speaks 1, already ahead of it); surface recorded.`
(The last tag is `crc-desktop-v1.5.0`, which predates the file, so it counts as protocol 1.)

## CLAUDE.md line for the supervisor

Add this to "Wire protocol (`docs/adr/0103`)", after "Any change to the wire: run `cd crc-sync && npm run wire:record`":

> The scan (`tools/wire-surface.js`) covers message types, the Board op table and every store family's op kinds, the carrier's handoff/Case/field names and stack, entry and view keys, `STORE_SYNC`, and the top-level keys of every hub frame and store delta; record contents, ack payloads and the snapshot's fixed keys are not scanned, so a change there needs `npm run wire:record -- --bump`.

## Defaults taken

- Correlation, MARSA and ATO op kinds come from a text scan of their dispatch literals. Those stores have no exported
  list, and adding one would be a hand-kept copy beside the switch.
- The derived-entry keys are the ones seen for one HOLDING flight on the shipped hull. A key that appears only in
  another state (e.g. `eatUtc`) is already covered by `entryKeys`.
