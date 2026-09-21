# 0046 — The correlation ladder is an ordered claim sweep on raw track callsigns, ticked once a second, and ambiguity is an answer

## Context

`docs/adr/0045` settled where the correlation lives. This settles how it is worked out.

Guide §6.6 rule 1 gives the ladder: *"Correlation keys, in priority order: explicit controller binding → Mode 3/A beacon code → callsign exact match → callsign fuzzy match (flagged as provisional)."* Four rungs, and nothing about how to resolve a collision between two flights on the same rung, how often to run it, or what "fuzzy" means.

Three things had a tempting wrong answer.

**On the callsign rung.** `resolve.js`'s `resolveCallsign` already produces a display callsign per track, and it is right there. Matching on it looks like reuse.

**On fuzziness.** Levenshtein distance with a threshold is the obvious reach.

**On cadence.** §6.6 rule 4 says selection must highlight a contact within a second, which reads as a requirement on the matcher.

## Decision

### Match against the raw track callsign, never `resolveCallsign`'s output

Four reasons, and the first is decisive:

1. **`resolveCallsign` rewrites the display name from the squawk map** — `squawkMap[squawk]`, then `squawkSeq` base+offset. Matching on it would make the callsign rung a **laundered restatement of the beacon rung**: a squawk match with a config lookup in the middle. That collapses two rungs into one and destroys the point of a ladder, which is that when beacon evidence fails, callsign can still succeed on *independent* evidence.
2. It would make surveillance identity depend on `config/squawk-map.json`, which **any connected client can edit live** (`ws-hub.js`'s `squawkMapSet`). A squadron config edit silently re-correlating flights is indefensible.
3. `resolveCallsign` also mints `TN#####` for non-friendly tracks and applies controller renames from `collab-store.js`. A controller renaming a contact on the scope must not re-bind a flight strip.
4. The raw track callsign is the DCS unit callsign, which is what a pilot files. That is the right thing to compare against `fdr.identity.callsign`.

**Match on raw; display resolved.** The Strip badge shows the contact's *resolved* callsign via `window.getLatestTrack`, so the controller reads the same name they see on the scope. The asymmetry is deliberate, and both halves are commented, so neither gets "fixed" into the other by a later reader who finds two notions of a contact's name.

`tests/efsp-correlation-match.test.mjs` asserts this as a negative: it edits the squawk map, proves the display name really changed, and proves no correlation moved.

### The fuzzy rule decomposes structure; it does not measure distance

| case | condition | affinity |
|---|---|---|
| exact | normalised strings equal | `1.0` → `CALLSIGN_EXACT` |
| formation numbering | same stem, one side's digits a prefix of the other's | `0.9` |
| suffixed element | same stem after dropping one trailing letter, or one side has no digits | `0.8` |
| same stem, different element | same stem, both have digits, neither a prefix | `0.7` |
| otherwise | — | no match |

**The formation case is the highest-value rule in the subsystem for a milsim.** DCS names a two-ship `VIPER11`/`VIPER12` while the flight plan filed `VIPER1` for the formation, because guide §3.2 rule 2 makes a formation **one** Identity with `flightSize > 1`. Without it, every formation would read as uncorrelated.

**No edit distance, no tunable threshold.** A distance cutoff has no doctrinal basis (defect **D11**'s shape) and misfires exactly where it matters: `VIPER1`↔`VIPER2` and `VIPER1`↔a typo'd `VIPER1` are both distance 1 and mean opposite things. The structural rule gives them different answers, is deterministic, and every row above is one assertion.

**The affinity values and the tick interval are module constants — not facility config, and not persisted.** Nothing about them is per-Facility, and persisting a tuning constant lets an old snapshot pin a value the code has since moved past. That is `docs/adr/0041`'s *"what happens the next time the code grows?"* answered in advance.

### One ordered claim sweep, and ambiguity is a first-class outcome

The sweep walks **rung by rung across all eligible flights**, claiming contacts into a `claimed` map as it goes, rather than resolving each flight independently. A higher rung therefore always claims a contact before a lower one can. That gives the priority order for free, guarantees **one contact never correlates to two flights**, and makes a same-rung collision decidable.

**At each rung, all candidates are collected. Exactly one is a match; more than one is `AMBIGUOUS_*`, with `candidateTrackIds`, and nothing is guessed.** Duplicate beacon codes are structural and explicitly accepted (§3.10.2 rule 7: *"Duplicate codes raise an alert, never a hard block"*), so they get the same treatment. And it applies the right pressure: ambiguity drives the controller toward rung 1, the one key that outranks everything, which is what rung 1 is for. The badge becomes a button listing the candidates.

The payoff assertion is in `tests/efsp-scenario-correlation.test.mjs`: two flights both called `VIPER1` with transponders off are both ambiguous; one then squawks its assigned code, claims its contact on the beacon rung, and **the other resolves on the callsign rung against the single contact left**. Resolving flight-by-flight cannot produce that.

### Eligibility is an exclusion list

```js
const INELIGIBLE_STATES = new Set([
  'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD',  // pre-movement
  'TASKED',                                             // the ATO line predates the jet
  'DROPPED',
]);
```

Plus: the FDR must have at least one live Strip, and one eligible Strip is enough (a `PROPOSED` departure Strip beside an `AIRBORNE` `MISSION` Strip on one FDR means there is an aircraft).

**An inclusion list would mean a state added in WP6 or WP7 silently leaves the denominator, so the rate silently *rises* — flattering and wrong.** With an exclusion list a new state defaults to eligible, the rate *falls*, and somebody notices. A test holds every state in `nla.js`'s `STATES_BY_ROLE` against the list, so adding a state forces a decision rather than defaulting it. `docs/adr/0041`'s lesson, applied to a denominator instead of a config list.

### A 1000 ms tick, and why it does not govern rule 4

**§6.6 rule 4's benchmark is on selection highlighting, and highlighting does not pass through the reconciler at all.** The Strip panel and the map live in one renderer, so Strip→contact is a local Map lookup plus the existing rAF-batched `updateMap()`. There is no code path in which it takes a frame.

What the tick bounds is how fresh `trackId` is: 1000 ms is twice the WebSocket tick so a correlation delta never races two of them, and the worst case — a contact that has only just appeared — is bound within about a second, at the benchmark rather than over it.

**Not reacting to track deltas:** `TrackStore` has no emitter and its delta log is consumed per client session, so the available signal is `grpcClient.on('unit')` — hundreds a second for a picture that has not meaningfully changed, each landing on the immediate-broadcast path `docs/adr/0004` reserved for controller actions. **Not on demand:** rule 3 forbids *silent* breakage, so a broken binding must warn whether or not anyone is looking, and rule 6's rate must be measured continuously rather than sampled when somebody clicks.

### Mission reload, and no hysteresis

`resetPicture('MISSION_RELOAD')` is called from `server.js`'s existing `mission-load` handler, right after `trackStore.clear()`. Every record drops to `UNCORRELATED` with `TRACK_IDENTITY_LOST`, **and the explicit bindings drop with them.** Dropping the binding is the load-bearing call: it named a specific contact which provably no longer exists, and keeping it would let the sweep prefer a dead id over a live beacon match — the silent break itself. Rule 3 permits exactly two outcomes on an identity change, and this does **both, in sequence, within one tick**: warn immediately, re-bind on the beacon next tick.

`expireStale()` (12 s) gets no special case — the full ladder runs every tick, so a re-minted id is found on the beacon rung the tick it appears. **No hysteresis and no second grace timer**, deliberately: a 1 s tick against a 12 s window means at most one tick of visible warning, and that second is *correct* — the picture genuinely had no contact. If live use shows flicker, that is hardening with `transitions[]` as evidence, not a guess now.

### The rate, reported and no larger

`computeCorrelationRate(records)` is pure and takes records rather than reading a store, so it tests against a fixture with no clock — the `computeDueObligations` shape. `rate = (correlated + provisional) / eligible`, matching §6.6's own measured quantity (*"85–90% of Strips matched a surveillance target"*, i.e. matched at all).

**Null when nothing is eligible, never 1.0.** An empty board is not 100% correlated, and reporting it as such would let the ≥95% acceptance gate pass vacuously.

Reported two ways: a `console.warn` at most once a minute when the instantaneous rate is below `0.95` **with at least 3 eligible flights** (so one pre-taxi outlier does not cry wolf), and one line in the panel header — `TRK 96% (24/25)`, red below target. In-memory, unpersisted, reset on restart: the same minimal §11.5 hook `ForwardingObligationMonitor.getComplianceStats()` is, and named as such.

**No selection-latency histogram.** Do not instrument a quantity that cannot vary — see above. `getStats()` is the plug point for WP8's real metric set.

## Alternatives considered

- **Match on `resolveCallsign`'s output.** Rejected: see the Decision. It is the single change that would most quietly undermine the ladder, because it looks like reuse and reads as sensible.
- **Levenshtein with a threshold.** Rejected: no doctrinal basis, and it cannot distinguish the two distance-1 cases that matter most. A threshold would also be the tunable the ADR above refuses to persist, immediately wanting to be one.
- **Resolve each flight independently, then de-duplicate.** Rejected: de-duplication needs a tiebreak, and any tiebreak is a guess between two aircraft. The ordered sweep makes the priority order do the work and turns the remaining collisions into a reportable outcome.
- **Break a tie by proximity, callsign length, or which flight is older.** Rejected outright. Every one of these is a plausible-sounding heuristic for "which aircraft is this", which is the question a controller is looking at a scope to answer. `AMBIGUOUS_*` plus a binding control is slower and correct.
- **Auto-bind the best fuzzy match and let the controller correct it.** Rejected: rule 1 flags fuzzy as *provisional*, not as a decision, and a wrong binding a controller has to notice is worse than no binding they can see.
- **An inclusion list of eligible states.** Rejected for `docs/adr/0041`'s reason, sharpened: the failure direction matters. An inclusion list fails by flattering the metric, which is the direction nobody investigates.
- **Tick at 250 ms** to match the coverage sweep. Rejected: four times the work for a quantity whose benchmark is one second, and it would make the correlation delta race the 500 ms WebSocket tick.
- **Tick at 5 s** and lean on the reconnect snapshot. Rejected: rule 4's benchmark is one second, and a contact appearing would take up to five.
- **Hysteresis on a lost contact.** Rejected as premature: it means showing contacts the picture does not have, and the evidence for whether it is needed does not exist yet. The history will hold it if it does.

## Consequences

- **`tests/efsp-correlation-match.test.mjs`** pins the full affinity table, `beaconFromTrack`'s number→octal-string bridge (SRS reports `Mode3` as a number; `code-allocator.js` mints 4-digit octal strings, and a code containing an 8 or 9 yields null rather than a plausible-looking wrong answer), and the squawk-map negative.
- **`tests/efsp-correlation-reconciler.test.mjs`** pins the ordered sweep's payoff case, both ambiguity kinds, the eligibility list against `STATES_BY_ROLE`, change-only broadcasting, and the rate including its null case.
- **`INELIGIBLE_STATES` is now a decision point that cannot be skipped.** Adding an EfspState in WP6 or WP7 fails a test until somebody says whether a flight in it could have a contact.
- **An exact callsign match is `CORRELATED` unless the contact's observed code contradicts the assigned one**, in which case it degrades to `PROVISIONAL`. The name agreeing while the transponder does not is real evidence against the identity, and §3.10.2 rule 1 exists so a controller can see it. A fuzzy match is `PROVISIONAL` regardless, per rule 1.
- **The reconciler is structurally incapable of moving a Strip** (§10.3's MUST NOT). It is handed a read-only view of the Boards and never a `BoardStore` it could mutate, and two tests assert the Strips it saw came back byte-identical — including the case where an airborne contact contradicts a Strip still at `PUSHBACK`, which is exactly what §10.3's deferred suggestion chip is for (`docs/adr/0047`).
- **A correlation delta is server-originated immediate state with no ack and no Mutation behind it**, which is new. Obligation alerts are the only precedent and they are alerts, not state. Justified because the record *is* state, and it is the only EFSP state that changes without a Mutation — because surveillance is not a controller. Said plainly at `ws-hub.js`'s `broadcastEfspCorrelationDelta`.
- **No `efsp-resync` branch for correlation**, so §5.6's "two paths only" holds: a reconnecting client gets the full array in its `efsp-snapshot` and a fresh reconcile delta within a second, the same reasoning `_handleResync` already gives for FDRs and Positions.
