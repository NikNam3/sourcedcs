# U-BEACON-ONLY: correlation by beacon code only (H165, ADR 0142)

Lane notes for the supervisor. Branch `lane/U-BEACON-ONLY`, cut from `27000708`.

## What was built

- **Ladder = binding, then beacon code.** `correlation-match.js` is now only `buildTrackIndices` (`byBeacon`, `byId`).
  `correlation-reconciler.js` lost `_matchByCallsign`, both callsign passes and the S-L27 former-holder map (it only
  guarded the callsign rungs). A flight with no binding and no contact squawking its code is `NO TRK` (`TRACK_LOST`).
- **A controller may type a synthetic code.** `code-allocator.js` `validateAssignment(code, id, { controllerEntered })`;
  only `flight-data-store.js` `setBeaconAssigned` (SetBlock on Block 5) passes `controllerEntered: true`. The ATO path
  (`applyAtoTasking`, `ato-board.js`, `ato-sets.js`) still refuses the block; `allocate()` still skips it.
- **Re-minted synthetic codes are not followed** (new warning kind `CODE_REISSUED`). See the walk below.
- **Removed:** `PROVISIONAL`, `CALLSIGN_EXACT/FUZZY`, `AMBIGUOUS_CALLSIGN`, `REBOUND_ON_CALLSIGN`, the record's
  `confidence`, `callsignAffinity`/`splitCallsign`/`normaliseCallsign`/`AFFINITY_*`, `byStem`, `FLIGHT_DATA_PROVISIONAL`
  (presentation), client `trackNameSuffix` (label `?`, used by geojson TACTICAL labels, the STARS FDB, the info line,
  the carrier side-number label and the track panel), the `TRK?` badge and its CSS, `_provisionalSentence`.
- **Readers changed to CORRELATED only:** `app/monitors.js` (CA/MCI and airspace-entry `trackedFlights`),
  `conformance.js`, `surveillance/identity.js`, client `atc-scope.js` `atcRelation` (associated = `FLIGHT_DATA`).
  `surveillance-hints.js` already read CORRELATED only (comment updated). `computeCorrelationRate` is `correlated /
  eligible` and no longer returns `provisional`; `matchKeyCounts` = `{BINDING, BEACON}`. Nothing in the client, the
  METRICS panel or the soak report read `provisional`/`matchKeyCounts` keys.
- `config/sensor-specs.json` `_comment` updated for the block (hand edit; no code writes it).
- Wire: `npm run wire:record -- --bump` → stays **2** (record contents are not scanned; 2 is ahead of the release).

## Walks

**AI flight, the H165 case.** COLT1 filed, COLT11 flying, squawking 6012 (synthetic): `NO TRK`. The controller enters
6012 in Block 5: accepted, next tick `CORRELATED` on `BEACON`, label shows COLT1, Strip `TRK 6012`. Tested end to end
in `efsp-scenario-correlation.test.mjs` (SetBlock through the Board) and in the reconciler unit tests.

**Duplicate code.** A second Strip given 6012: accepted with `DUPLICATE_IGNORED_WARNING` (unchanged), it does not take
the contact, its NO TRK reads "the contact squawking 6012 is correlated to COLT1" (unchanged T12 behaviour).

**The AI unit leaving, and code reuse.** What the beacon rung did on any code reuse before this lane: nothing special.
It matches whichever single contact squawks the assigned code; a different contact on the same code after a loss was a
`REBOUND_ON_BEACON` transition with the warning retracted, and the client showed the new `TRK <code>` with no other
sign (the rebind is only in `transitions[]`). For a discrete code that is the FAA rule (H135) and stays. For a
synthetic code it would be wrong: `Transponders.release` returns the code to the block when the unit leaves and
`_syntheticCode` can mint it to the next AI unit (hash start, then first free), so the Strip would have jumped to an
unrelated aircraft. Now the reconciler remembers per flight `{code, trackId}` of the contact its synthetic code was seen
on (beacon match, or a binding to the contact squawking it) and refuses any other contact on that code:
`UNCORRELATED`, warning `CODE_REISSUED` with `candidateTrackIds: [newHolder]`, detail "6012 is now squawked by a
different AI aircraft — bind it, or enter its code". Client: `NO TRK`, warned colour, that tooltip. Covered: the
re-mint a tick later, in the same tick, the original unit coming back (correlates again), mission reload (memory
cleared, first match accepted).

**Code changed again.** Entering another code clears the memory for the old one; the next match is fresh. Changing
back to 6012 after a re-mint correlates the current holder (the controller has pointed at it twice).

**Unbind.** Bind the new holder → `BINDING`, memory moves to it; Unbind → the beacon rung matches it (`BEACON`).

**Players.** A pilot squawking the wrong code is now `NO TRK` (`TRACK_LOST`, `lostTrackId` = its contact) instead of a
provisional callsign match; Bind… keeps it and the assigned/observed pair still shows the mismatch. Correcting the
squawk retracts the warning (`WARNING_RETRACTED`, was `PROMOTED`).

## Defaults taken

- **D1 — `confidence` stays in the persisted-shape allow list** (`stores.js` `ENTRY_SHAPES.correlations`), and
  `CorrelationStore.restore` deletes it. Every Board snapshot written before this lane carries `confidence: null` on
  every correlation record; the strict-state rule (LT-PQ2 precedent: no exception) would stop the deployed crc-sync until
  `state/efsp-board.json` was deleted, which destroys the live Board. Rule 6 says not to take a default that can destroy
  work, so I kept the key accepted. **Supervisor to decide** whether to remove it (one line) and accept a Board reset.
  Correlation `state` was already volatile (restore nulls state/matchedBy/trackId/binding), so a persisted
  `PROVISIONAL` never comes back; old `transitions[]` entries keep their old reasons and `confidence` (history).
- **D2 — new warning kind `CODE_REISSUED`** rather than reusing `TRACK_LOST`: the store only broadcasts a warning change
  when its *kind* changes, so a TRACK_LOST → TRACK_LOST "re-minted" detail would never have reached the client.
- **D3 — the re-mint rule applies to synthetic codes only.** Discrete codes keep H135's FAA auto-acquisition.
- **D4 — two contacts on one synthetic code stay `AMBIGUOUS_BEACON` (TRK ×2)** even when one is the remembered contact
  (the briefing's "pick one": ambiguity first).
- **D5 — `_matchReason`**: a reconcile-side contact change on `BINDING` (rare) is no longer labelled with a callsign
  reason; it falls through to FIRST_MATCH/PROMOTED/DEGRADED/WARNING_RETRACTED.
- **D6 — no Transponders quarantine** of released codes: the reconciler rule covers the Strip whichever code is re-minted.

## What the usage guide §8C should say

Table: drop the `TRK?` row. *(nothing)* row: "**correlated**, by its beacon code or a controller's binding". `NO TRK`
row: add "or the AI aircraft's code went to a different aircraft (hover: 'now squawked by a different AI aircraft')".
`TRK ×2` row: "Two contacts are squawking this flight's code".

Replace the "Bind… … under a callsign DCS spells differently" sentence: "A flight is never matched by its callsign.
A jet with its transponder off, or squawking a different code, stays `NO TRK` until you bind it or give the Strip the
code it is squawking."

Replace the paragraph's last three sentences ("A callsign match is stricter … found by callsign or a binding only")
with: "**Correlating an AI flight.** An AI aircraft squawks a code from crc-sync's synthetic block (6000–6777 as
shipped). Read it off the contact's data block and type it into the Strip's beacon code (Block 5): the Strip
correlates on the next second. crc-sync never assigns such a code itself, and an ATO's Mode 3 in that block is still
refused. When that AI aircraft leaves, crc-sync may give its code to another AI aircraft; the Strip does not follow
it, it says `NO TRK` ('now squawked by a different AI aircraft'). Bind the new aircraft if it is yours, or enter the
code of the one you mean."

Also §6 (line ~627, `beaconAssigned`/`beaconObserved`): "they differ (the pilot is squawking the wrong code — the Strip
shows `NO TRK` until you bind it; once bound, both codes stay visible)". And the WP5 bullet at the top is still right.

`docs/efsp-briefing.md`'s correlation lines (if any mention the callsign rungs or PROVISIONAL) need the same cut.

## Findings for other lanes

- `correlation-store.js` `reconcile()` rewrites `record.warning` on every unmatched tick (new `raisedAt`, and
  `lostTrackId` becomes null from the second tick, because `record.trackId` was already cleared) without bumping or
  broadcasting. So the server's copy drifts from what clients hold, and the `fromTrackId` fallback to
  `warning.lostTrackId` in the matched branch only works when the contact returns within one tick. Not changed here
  (it predates this lane; my synthetic memory does not depend on it). Small fix: keep the old warning object when the
  kind and detail are unchanged.
- A Strip given a synthetic code by a controller keeps it in `CodeAllocator._allocated` like any code; the allocator
  never hands that block out, so nothing collides, but the code's holder is shown in duplicate warnings as usual.

## Not done

- Playwright: see the report (smoke + correlation-badge/label specs on lane 6).
- Usage guide / briefing: not edited (rule 3), text above.
