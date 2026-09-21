# 0037 — Block 22 becomes a structured frequency, and approving a flight into an airspace moves no jurisdiction

## Context

Guide §6.2's Departure Block Map lists Block 22 as *"Frequency"* with an **entirely empty implementation-notes column** — the only guidance is the name. It was implemented here as `{kind: 'annotation'}`, a free-text cell, which is what an unspecified Block defaults to.

Beyond that, the guide has essentially no frequency model. Searching it exhaustively turns up: Block 22; `M7` (*"Controlling agency + frequency"*, the **tactical** sense — AWACS/CRC — which §4.6.4 explicitly warns is *"the opposite kind of entity"* from the FAA controlling agency); the Comms column of the §4.6 primitives table (transfers / does not — a boolean property of a primitive, never a value); and §4.7's `SFA` section. **A "working frequency" for an airspace and a "range control frequency" appear nowhere in any FAA or DoD source the guide reached.**

Nothing in the EFSP carried a frequency value at all before this. `coordination.js`'s `commsTransfers` and TOFI's `TRANSFER_COMMS` are flags — `_applyTofiTransferComms` sets `commsTransferred`, `commsTransferredAt`, `commsTransferredBy` and nothing else. The wider repo, meanwhile, represents frequencies three different ways: `atis-store.js` keys by integer Hz, the lxsrs bridge takes float MHz at its HTTP boundary, and `apt-config.js` stores an unvalidated string capped at 16 characters.

And §4.7 sets a trap worth reading before designing any of this:

> **If the panel models "ownership transfer = frequency change", `SFA` breaks it.** Implement `SFA` ownership transfer as a controller-side rotation over a frequency pool, with `APP` holding rotation jurisdiction. **The frequency is an attribute of the Strip; the controller is what moves.**

That is defect **D17** in the register: *"Ownership transfer implemented as 'send the aircraft to a new frequency', which inverts what SFA actually does."*

## Decision

### The D11 audit, stated plainly

**The working-frequency concept is `[SOURCE-DEFINED]`.** Approving a flight onto an airspace's working frequency, and a range control tower having its own control frequency, are this squadron's operating practice as described by the project owner. They are **not** FAA or DoD doctrine, no source in the guide supports them, and they must never be presented as doctrine in code, UI or wiki — defect **D11** (*"A `[SOURCE-DEFINED]` behaviour presented as FAA/DoD doctrine"*), which WP6's acceptance criteria require be audited explicitly. `airspace-config.js`'s header carries this statement at the top of the file, where anyone extending `type`/`workingFrequencyMhz`/`controlFrequencyMhz` will read it.

What *is* doctrine, and is cited as such: Block 22's existence (§6.2), §4.7/D17's constraint on what a frequency change must not mean, and §9.11's alert requirement.

### Block 22 becomes structured

A new Block-Map target kind, `{kind: 'frequency'}`, on the same template docs/adr/0018 established for `24A` and docs/adr/0032 extended: a dedicated sub-object, a dedicated setter, and **no `WRITABLE_PATHS` entry**, so there is no generic route to writing it.

```js
comms: { workingFrequencyMhz: null, airspaceId: null, changedAt: null, changedBy: null, transitions: [] },
```

`fdr-store.js`'s `setWorkingFrequency(fdrId, frequencyMhz, {airspaceId, by})` validates and appends. `block-map.js`'s `resolveBlockTarget` returns the kind as its own case and `board-store.js`'s `_applySetBlock` routes it to the setter, a fourth branch alongside the beacon, airspace-owner and tofi special cases. `null` clears it (an empty string from the UI is normalised to `null` at the dispatch site).

The history is append-only for the same reason 0032 gave airspace ownership one: a sortie that changes frequency three times has to be able to show all three afterwards. Unlike `24A`, Block 22 is edited through the ordinary free-text click-to-edit path rather than an enum `<select>` — a frequency is a numeric entry, not a restricted enum — so `isBlockEditable` gained `'frequency'` while `ENUM_SELECT_BLOCKS` did not.

**Block 22 is added to the `ARRIVAL` and `OVERFLIGHT` maps on both sides.** A flight is approved onto a frequency while it is enroute, which is exactly when its Strip is an `ARRIVAL` or an `OVERFLIGHT`; a DEPARTURE-only Block would have been invisible precisely when it matters. (It was safe to change the kind in place: no Block 22 annotation existed in the live board data.)

### One unit, one type

**MHz, as a number, validated to 30–400.** `isValidFrequency` lives in `airspace-config.js` and is imported by `fdr-store.js`, so a configured airspace frequency and a frequency a flight is approved onto can never validate differently. Conversions to Hz or to strings happen at the edges that need them (`atis-store`, the SRS bridge, `apt-config`) and never inside the EFSP. The 1e9-style Hz value and the `'134.25'` string are both rejected, which the tests assert directly.

### `ApproveAirspaceEntry` moves no jurisdiction

`ApproveAirspaceEntry {airspaceId, frequencyMhz?}` and `ClearAirspaceEntry` are **ordinary Strip Mutations**, dispatched through `applyMutation` like any other, and granted to `APP`/`CTR` via a new `AIRSPACE_ENTRY_OP_KINDS` set (kept separate from `APP_CTR_ONLY_OP_KINDS`, which those two hold for an unrelated reason).

They are deliberately *not* a coordination primitive and *not* a TOFI-shaped exchange. Nothing crosses a Facility boundary, no replica is minted, and — the §4.7/D17 point — **no jurisdiction moves**. The approving controller keeps the Strip throughout: `_applyApproveAirspaceEntry` writes `strip.airspaceEntry` and the FDR's frequency, and touches `ownerPositionId`, `coordination` and `tofiCoordination` not at all. The flight's radio moves; the controller does not. This is the direct application of *"the frequency is an attribute of the Strip; the controller is what moves"*, and it is what keeps a future `SFA` implementation possible rather than pre-broken.

**Frequency defaulting:** an explicit `op.frequencyMhz` wins; otherwise the airspace's `controlFrequencyMhz` (a range with its own tower — the flight talks to that tower), else its `workingFrequencyMhz` (an ordinary MOA), else `null`. An explicit override is allowed because a controller assigning something off-config is a normal thing to do, and recording what they actually said is more useful than refusing it.

### The §9.11 alert

> Aircraft entering unactivated airspace MUST alert.

`UNACTIVATED_AIRSPACE_ENTRY` is the sixth obligation type in `forwarding-obligations.js`, raised when a Strip has an `airspaceEntry` whose airspace is not `ACTIVE`. The monitor takes the airspace store as a dependency and passes `isAirspaceActive` into `computeDueObligations`'s ctx; everything downstream — per-`{stripId}:{obligationType}` de-duplication, the WS broadcast, the client badge — is already generic over the type, as docs/adr/0027's void-time addition demonstrated. `OVERDUE` with no `WARNING` tier: the aircraft is either in airspace nobody has activated or it is not, and there is no "due soon" about it.

**Entry into an unactivated airspace warns and is allowed**, returning `warning: 'AIRSPACE_NOT_ACTIVE'` on the ack rather than rejecting. §9.11 says *alert*, not refuse — and the block may well be hot in reality with the board simply not caught up, in which case refusing would be wrong far more often than right. The same reasoning docs/adr/0032 used for the soft TOFI-exit cross-check: what was missing is a signal, not a prohibition. The client says so on the Strip itself as well as through the obligation badge, because the controller who approved it is the one who can fix it.

## Alternatives considered

- **Leave Block 22 a free-text annotation** and let controllers type frequencies. Rejected: an approval that has to *write* a frequency needs somewhere structured to write it, and free text cannot be validated into one unit — which, given the repo's existing Hz/MHz/string split, is exactly the confusion worth not importing into the EFSP.
- **Reuse `M7` (*"Controlling agency + frequency"*)** rather than adding a frequency of its own. Rejected: §4.6.4 warns that `M7`'s "controlling agency" is the *tactical* sense (AWACS/CRC) and that the namespaces must be kept apart. Conflating them is the exact naming trap the guide calls out.
- **Model the approval as a coordination primitive or a TOFI-shaped exchange**, with propose/accept. Rejected: there is no second Facility, no replica, and nothing to negotiate — the controller already owns the flight. Making it an exchange would also have implied a jurisdiction movement that §4.7 and D17 specifically forbid reading into a frequency change.
- **Have `ApproveAirspaceEntry` transfer the Strip to the range Position.** Rejected twice over: §4.1 says a `RANGE` Position works no Strips (docs/adr/0035 enforces that by class), and it would be the D17 inversion in its purest form — treating "go to this frequency" as "you now belong to someone else".
- **Refuse entry into an unactivated airspace.** Rejected: §9.11 asks for an alert, and a hard refusal would block a correct operation whenever the board lags reality. Same distinction docs/adr/0032 drew between rule 2's data-integrity prohibition and rule 4's verbal-path soft interlock.
- **Derive the frequency strictly from config, with no override.** Rejected: a controller assigning an off-config frequency is normal, and a system that refuses to record what was actually said is worse than one that records something unexpected.
- **Store Hz as an integer**, matching `atis-store`. Rejected: MHz is what controllers say, what `airspace-config.js` holds, and what the SRS bridge takes at its HTTP boundary — one conversion at that edge beats converting everywhere a frequency is displayed.

## Consequences

- `tests/efsp-airspace-store.test.mjs` asserts the unit/type decision directly: `isValidFrequency(251.0)` is true, `'251.0'` is false (*"one unit and one type — MHz, as a number"*), and `1e9` is false (*"Hz would be out of band"*).
- `tests/efsp-scenarios.test.mjs` walks both cases end to end: a MOA sortie where the frequency defaults to `134.25` from the airspace (*"defaulted from the airspace, not typed in"*), asserting the Strip's owner is unchanged across the approval — the D17 guarantee, as a test — and a range sortie defaulting to the tower's `283.5`. Clearing the entry asserts `comms.transitions` reads `[134.25, null]`, the append-only property. A further test asserts approval into an unactivated airspace returns `ok: true` with `AIRSPACE_NOT_ACTIVE` **and** that the monitor then raises `UNACTIVATED_AIRSPACE_ENTRY`.
- `tests/efsp-block-map-parity.test.js` now compares Block 22's kind across client and server for all three roles it appears on — the drift guard that keeps `{kind:'frequency'}` from silently reverting on one side.
- `blockVisibility` picks Block 22 up automatically on every Facility, since those lists are built from `Object.keys(...BLOCK_MAP)`.
- **The server still cannot see what a pilot is actually tuned to.** `srs-client.js` reads only `RadioInfo.IFF` and discards `RadioInfo.radios[]`, so an approved frequency is a record of what the controller said, never a verification that the flight complied. `grpc-client.js`'s `getSrsClients()` does expose per-client frequencies on demand and nothing consumes it — that is the hook if verification is ever wanted.
- **`SFA` remains unbuilt, and is now buildable.** §4.7's frequency-rotation model (a pool, with `APP` holding rotation jurisdiction) has a place to live — the frequency is on the Strip's FDR, exactly where §4.7 says it belongs — and nothing in this slice models ownership transfer as a frequency change, so D17 is not pre-committed.
- `fdr.comms.airspaceId` duplicates `strip.airspaceEntry.airspaceId`. Deliberate: the FDR records what the *flight* was approved onto (durable, append-only, survives the Strip), the Strip records the current working state. They can diverge only if a second Strip on the same FDR is approved elsewhere, which is worth watching if the shared-FDR cases (docs/adr/0028) grow.
