# 0039 — The release model becomes reachable, and its derived windows are actually enforced

## Context

Walking the release cases end to end as sorties — rather than as individual mutations — found two defects in machinery that had been built, tested and documented, and was inert in both directions.

**Nothing could set a release state.** §3.8's model is substantial: six `RELEASE_STATES`, a derived 30-minute void deadline, and inhibits threaded through `nla.js`'s `CLEARED` and `HELD` cases. `fdr-store.js` validated every write to `assigned.releaseState` and derived `voidDeadlineUtc` from `assigned.voidTimeUtc`. Both paths were in `WRITABLE_PATHS`. And **no Block Map on either side routed to either of them** — the only release-adjacent Blocks were `14` (release time), and `14B`/`14C` (the EDCT and call-for-release *times*, added by docs/adr/0017). A controller could not put a flight on hold, or set a void time, at all.

The knock-on is worse than an unreachable field. WP4's own acceptance criterion reads:

> Void-time expiry raises an alert at void + 30 minutes.

That alert exists — `VOID_TIME_EXPIRED`, the fifth forwarding obligation (docs/adr/0031). It reads `fdr.assigned.voidDeadlineUtc`, which is derived only when `releaseState === 'CLEARANCE_VOID_TIME'` and `voidTimeUtc` is set. Neither was settable, so the obligation could never fire in the real panel, and the criterion could only ever be demonstrated by a test reaching past the UI. Setting `14B`/`14C` was equally inert on its own: the times were stored, but the release state that gives them meaning could not be set alongside them.

**And the derived windows were never read.** docs/adr/0017 has derived `edctWindowStartUtc`/`edctWindowEndUtc` (±5 minutes) and `callForReleaseWindowStartUtc`/`callForReleaseWindowEndUtc` (−2/+1 minutes) on every relevant write since that slice. Searching the repo for a consumer turns up nothing outside `fdr-store.js` itself. `nla.js`'s `HELD` case checked `RELEASE_TIME`, checked the standing-release envelope for `HOLD_FOR_RELEASE`, and checked void expiry — and let `EDCT` and `CALL_FOR_RELEASE` fall straight through. A flight with a slot an hour away was not held.

Both are the same shape of bug: a mechanism complete enough to look finished, with the last connection missing.

## Decision

### Blocks `14A` and `14D`

```js
'14A': { required: false, target: { kind: 'fdr', path: 'assigned.releaseState' } },
'14D': { required: false, target: { kind: 'fdr', path: 'assigned.voidTimeUtc' } },
```

Plain `fdr`-routed on both sides, since `fdr-store.js`'s `setField` already validates `releaseState` against `RELEASE_STATES` — no dedicated target kind is needed here, unlike `24A` or Block 22, because there is no "no boolean path" requirement to enforce structurally. `14A` is listed in `ENUM_SELECT_BLOCKS` client-side (label `RLS ST`) so a controller picks one of six exact strings rather than typing one; `14D` is an ordinary click-to-edit time.

**The numbering is deliberate.** The guide's §6.2 table skips 12, 13 and 15 entirely, so `15` was available — and taking it would have been wrong. A bare `15` reads as a guide Block, and a future guide revision defining one would collide with a meaning invented here. `14B` and `14C` are already local extensions of exactly this release cluster (docs/adr/0017), so the 14-family is the established place for "something about release that the guide did not number", and the suffix marks it as local on sight.

### The windows are enforced

`nla.js`'s `HELD` case consults a table:

```js
const WINDOWED_RELEASE_STATES = {
  EDCT:             { startKey: 'edctWindowStartUtc',           endKey: 'edctWindowEndUtc',           label: 'EDCT' },
  CALL_FOR_RELEASE: { startKey: 'callForReleaseWindowStartUtc', endKey: 'callForReleaseWindowEndUtc', label: 'call-for-release' },
};
```

A table rather than two more `if` branches, because the two states differ only in which keys they read and what they are called — and because the asymmetry between them (±5 versus −2/+1) lives in `fdr-store.js` where it is derived, not here where it is checked.

**A missed window inhibits as well as an unopened one.** A slot in the future gives *"EDCT window is not open yet"*; one already past gives *"EDCT window has passed — a new slot is needed"*. Only gating the early side would have let a flight that sat through its slot push as though nothing had happened, which is precisely what a window exists to prevent — the late case is the one with operational consequences, and a controller who has missed a slot needs to know they are asking for a new one rather than using the old one.

**`RELEASE_TIME` is deliberately absent from the table.** It is a "not before" with no upper bound — the flight is released at that time and stays released — so it has no window to be outside of, and it keeps its own single-sided check immediately above. Folding it in would have required a null `endKey` and an explanation at every read.

## Alternatives considered

- **Take the guide's unused Block `15`** for the void time. Rejected: see the Decision. An unnumbered gap in the guide's table is not an invitation, and a local extension that looks like a guide Block is a trap for the next reader.
- **Give `14A` a dedicated target kind**, on the `24A`/Block 22 template. Rejected: that pattern exists to make an invalid representation *structurally unreachable* (D15's "no boolean path"). `releaseState` has no such hazard — it is a string validated against a set, which the generic `setField` path already does. Adding a kind would be ceremony without a property.
- **Enforce the EDCT window at `CLEARED` rather than `HELD`.** Rejected: `CLEARED` already refuses anything other than `RELEASED` with *"a hold is in force"*, which is what sends a constrained flight to `HELD` in the first place. §3.4 defines `HELD` as *"hold for release, release time, or void time in force"* — the state whose entire job is holding a flight against a condition — so every condition belongs in one place.
- **Let a missed window pass**, treating the slot as advisory. Rejected: it makes the late case indistinguishable from having no slot at all, and the late case is the one that matters.
- **Have the monitor alert on a missed EDCT** rather than inhibiting. Rejected for now, though it is a reasonable addition alongside the inhibit: the inhibit is what stops the aircraft, and a Strip stuck at `HELD` with a stated reason is already visible. An obligation would add a countdown, which is a separate feature.

## Consequences

- `tests/efsp-scenario-release.test.mjs` covers all four release paths as sorties: a hold that refuses the push until released; a clearance that goes void, asserting both the derived deadline and that `VOID_TIME_EXPIRED` actually fires through the monitor — WP4's acceptance criterion, exercised through the same Blocks a controller would use; an EDCT inside its window going, one an hour early refused, one an hour late refused with the distinct "needs a new slot" reason; and a call-for-release asserting the −2/+1 asymmetry against the EDCT's ±5.
- **`VOID_TIME_EXPIRED` is reachable for the first time.** docs/adr/0031 added the obligation on the strength of the guide requiring it; until this change, the only way to trigger it was to write the FDR directly.
- `blockVisibility` picks both Blocks up automatically, since those lists are built from `Object.keys(...BLOCK_MAP)`.
- Both Blocks are `DEPARTURE`-only, which matches §3.8 — release states are a departure-clearance concept, and `VOID_TIME_EXPIRED` already gates on `strip.role === 'DEPARTURE'`.
- **Separately, and closer to a pure bugfix than a decision:** a Strip could be created, moved or transferred into a Bay the Facility does not have. `CreateStrip` accepted any `bayId` string, minted the Strip, allocated it a beacon code — and it then appeared in no Rack on any Board, because every read path goes through a Bay. Invisible and unrecoverable. It was found by a typo in the scenario tests themselves (`ctr-overflights` for `ctr-overflight`), which passed. `facility-config.js` gained `bayExists`, wired as a `bayExists` rule, and `board-store.js` checks it in `_applyCreateStrip`, `_applyMoveStrip` and `_applyTransferStrip` via `_requireKnownBay`. The guard caught the original typo immediately on being added, which is the best available evidence it was worth having.
