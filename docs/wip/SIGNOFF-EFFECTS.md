# SIGNOFF-EFFECTS (a disconnect's sign-off has an explicit sign-off's effects)

## Code as found
- `crc-sync/src/efsp/efsp-ws.js` `_handleSetPositions` held all the effects inline: Strips of a vacated Position follow consolidation or raise a `routedTo: null` warning, a newly staffed Position gets its routed-away Strips back, `reconcileExchanges()` on every Facility (ADR 0101, DR-6, H106 AC-3), the other Boards' touched Strips as extra deltas (B2), `persist()` when a Strip moved or a repair ran, the GC offer (ADR 0105) as a `directed` frame, and the full-Board `efsp-board-delta` with the Positions.
- Disconnect: `ws-hub.js` `_onClosed` (grace 0) and `sweepPendingSignOffs` (grace expiry) called `efsp.onDisconnect`, which only ran `PositionStore#onDisconnect` for each Facility. No repair, no persist, no offer, no frame (`_refreshOthersIfStaffingChanged` only re-sent coverage).
- Takeover: `PositionStore#_signOn` signs the absent Primary off abruptly inside the taker's own `efsp-set-positions`. That already ran the explicit path, but only for the taker's `vacated` set; the Position the absent Primary lost was never named to it.

## Done: one function
`efsp-ws.js` `staffingChanged(ctx, controllerId, changes, persist)` holds every effect above. Three callers:
1. explicit `efsp-set-positions` (`_handleSetPositions`, one Facility, plus the takeover set below);
2. grace expiry and grace 0 (`signOffController`, every Facility the controller held, via `efsp.onDisconnect`); ws-hub `_signOff` sends the frames, the directed offer and the coverage refresh like `_onMessage` does;
3. takeover: `PositionStore#drainTakenOver()` names the Positions an absent Primary lost to a sign-on; they are added to that sign-on's `vacated`, so the same function sees them.
`PositionStore#onDisconnect` now returns `{ vacated }`. Wire unchanged (same frames), so the protocol number does not move.

## Tests
`crc-sync/tests/signoff-effects.test.mjs`: grace expiry with a live HANDOFF held by the absent AP (repaired, snapshot file holds it, CENTER's session gets the Strip, a watcher gets the Positions), the unrepairable case (standing `exchangeProblems`), the GC offer to LC's Primary only, and two takeovers during the grace. The takeover tests passed before the change too (the explicit path covered them); they pin it.

## Goldens
None moved: the freeze traces sign off through explicit `efsp-set-positions` only.
