# 0043 — Radars are assigned to stations by selector, not by id, and illumination is computed rather than sampled

## Context

`docs/adr/0042` moved the radar picture into crc-sync and made coverage follow the Positions a controller holds. That leaves two questions it deliberately did not answer: **how a Position says which radars it works**, and **how the server decides what each of those radars is currently illuminating**. Both had a tempting wrong answer.

**On assignment.** The obvious shape is a list of radar ids per Position — `"APP": ["app:Incirlik", "apt:Incirlik"]`. But a radar id is derived from live mission data: `apt:Incirlik` exists only while that theater is loaded, and `crc:11` only while that AWACS is airborne with that unit id. A persisted list of ids is therefore a snapshot of what existed the day it was written, which is precisely the shape `docs/adr/0041` condemned:

> An inclusion list of "everything" is a deny-list for the future by construction.

0041's failure was `blockVisibility` freezing a Block set and silently hiding every Block invented afterwards. The same shape here would freeze a radar set and silently grant nothing the next time the squadron flew a different map — and, as in 0041, **no test would see it**, because tests build their own fixtures and the failure only appears against config written for a theater that is no longer loaded.

**On illumination.** The renderer sampled. Every 50 ms it computed each radar's beam angle and accepted any track within ±4° of it. Doing the arithmetic: a 4° beam on a 2000 ms rotation dwells on a target for about 22 ms, and the ±4° acceptance window is about 44 ms wide — against a 50 ms tick. **Targets were being missed, unpredictably, depending on where the tick happened to land.** Nobody had reported it, because a contact missed on one rotation is usually caught on the next and the symptom is a slightly jumpy scope, which reads as radar realism. Porting that loop to the server would have moved the bug with it and made it authoritative.

## Decision

### Assignment is by selector, resolved against the radars that exist right now

A new `positionRadars` key in each facility config, holding selectors that describe what a radar **is** rather than naming one:

```jsonc
"positionRadars": {
  "TWR": [{ "kind": "airport",  "airport": "LTAG" }],
  "APP": [{ "kind": "approach", "airport": "LTAG" },
          { "kind": "airport",  "airport": "LTAG" }],
  "OPS": [], "CD": [], "GND": []
}
```

- `kind` is one of the five radar types. `airport` matches `icao` first then the raw mission name, case-insensitively; `"*"` matches every airfield in the theater, which is how `CTR` gets an en-route picture that needs no editing when the map changes. `coalition: "own"` narrows airborne and ship radars to `CRCSYNC_COALITION`.
- **A selector that resolves to nothing is legitimate, and warns rather than failing.** The same config has to work across theaters, so `{ kind: 'approach', airport: 'EGLL' }` in a Caucasus mission is correct config with nothing to match. `validateConfig` therefore checks selector **shape** only, and `reportUnresolvedSelectors` names what did not resolve — warning instead of throwing, the `_validateAirspaceReferences` precedent, because one bad entry must not stop the board.
- **That check runs on mission load, not at construction**, and the first implementation got this wrong in a way only running the server showed. At construction there is no theater to check against, so it could only print *"this will have no coverage in a theater without that airfield"* for every airfield selector unconditionally — three lines of noise on every boot, saying nothing. Noise in a startup log is how a real warning gets ignored. Moved to where the answer exists, it now says something true and useful: against the live squadron server it reports that `TAC_C2`/`AIC`/`GCI` have no coverage because no AWACS or fighter is airborne.
- **A malformed selector is a different matter and is refused**, because it can never resolve in any theater: an unknown `kind`, a non-string `airport`, a `coalition` that is not `own`/`any`, or an `airport` on an airborne `kind` — that last one being a config that is confused about what it is asking for.
- **The tick interval and the callsign-affinity values are module constants — not facility config, and not persisted.** Nothing about them is per-Facility, and persisting a tuning constant lets an old snapshot pin a value the code has since moved past. That is 0041's *"what happens the next time the code grows?"* answered in advance rather than after.

The shipped defaults are **`[SOURCE-DEFINED]`**. Which scope sits at which console is squadron data; the guide says nothing about it, and neither does DCS. `TWR` gets the field surveillance radar, `APP` (the RAPCON) gets that plus the 80 nm approach radar, `CTR` gets every airfield approach radar, and the MRUs get the own-coalition airborne picture — which is what the deleted DATALINK toggle used to switch on for everyone at once, now stated as a property of the Positions it describes. `RANGES` Positions get none: guide §4.1 rule 2 makes a range the using agency, owning airspace state rather than a scope. None of this may be presented as any real facility's equipment (defect **D11**).

### Illumination is computed, not sampled

`src/coverage.js` computes the instant the beam crosses a target's bearing instead of testing where the beam happens to be. Everything reduces to one primitive:

```js
lastCrossing(since, now, epoch, period, offset)  // the latest such instant in (since, now], or null
```

A 360° dish crosses a target at bearing θ once per rotation, at `sweepStart + sweepMs·(θ/360) + k·sweepMs`. A nose radar oscillates across `angleFromNose`, so a full there-and-back cycle is `2·sweepMs` and a target inside the arc is crossed twice — once outbound, once inbound — with the later crossing winning. Outside the arc it is never crossed at all.

**The tick rate becomes a delivery choice rather than a fidelity one**, which is the point. `tests/coverage.test.mjs` walks a whole rotation at tick sizes from 10 ms to 400 ms and asserts the target is illuminated exactly once per rotation at every one of them; the sampling implementation fails that test for every tick longer than its ~44 ms window. The server ticks at 250 ms, against real scan periods of 2–3 s, and `SWEEP_BEAM_DEG` survives only as the width of the wedge the debug overlay draws.

**One `sweepStart` per radar, for the whole server**, minted on first sight and stable thereafter — the concrete form of `docs/adr/0042`'s shared picture. It is sent to clients in the `coverage` message, so the debug beam overlay draws where the beam actually is; each renderer used to mint its own phase, which made that overlay decorative.

**The sweep runs over occupied Positions' radars only** (`StationCoverage.activeRadars()`). An unattended airfield's radar costs nothing, and its phase is minted lazily if anyone ever takes the Position.

**Gate order is the original's, and the order is a cost decision**: the cheap category tests, then range, then the beam arithmetic, then terrain last because it is the only expensive one. **Line-of-sight answers are cached for 1 s per (radar, track) pair** — at jet speeds that is ~250 m of movement against terrain sample spacing of several kilometres at any useful range, so the answer cannot meaningfully change inside the window.

**Ground contacts skip terrain masking**, keeping the original's exception and its reason: DCS grades airfields flat regardless of the real terrain, so a vehicle on the ramp reads as buried in a hill the sim does not model.

## Alternatives considered

- **A persisted list of radar ids per Position.** Rejected: see the Context. It is `docs/adr/0041`'s inclusion list wearing a different hat, and it fails on exactly the event the squadron performs most often — loading a different map.
- **Derive the assignment from the airfield an airspace names**, the way `docs/adr/0035` derives the `RANGES` Position set from the airspace config. Rejected: that derivation works because an airspace genuinely describes its own using agency. Nothing in the airspace config describes a radar, so the derivation would have to invent the relationship it claims to read.
- **Radar ids with a startup migration** that rewrites them when the theater changes. Rejected: it makes the config a cache of a derivation, so the derivation exists anyway and the persisted copy is pure liability — and a migration that runs on mission load is a config rewrite under a working controller, which guide §8.4 forbids (defect **D10**).
- **Port the sampling sweep unchanged and simply tick faster.** Rejected. 10 ms would mostly hide the bug at forty times the cost, and "mostly" is the wrong property for the thing that decides whether a contact exists. It would also make the tick rate load-bearing, so any future performance tuning would silently change what controllers see.
- **Keep a beam-width window, but compute the crossing to decide when to test it.** Rejected as the worst of both: the window's only remaining job would be to discard some crossings the arithmetic already found, i.e. to reintroduce the misses on purpose.
- **Emit an illumination the moment `grpcClient` reports a unit**, instead of on a tick. Rejected: that fires hundreds of times a second for a picture that has not meaningfully changed, and `TrackStore` has no emitter to hang it on — its delta log is consumed per client session.
- **Hysteresis on a lost contact**, so a track flickering at the edge of range does not drop out. Not built, deliberately. A 250 ms tick against a 12 s stale window means a contact is either there or genuinely was not; adding a grace timer would mean showing contacts the picture did not have. If live use shows flicker, that is hardening with evidence behind it rather than a guess now.

## Consequences

- **`tests/coverage.test.mjs` includes the 22 ms-dwell case by name**, walking a rotation at six tick sizes. It is the regression test for the bug this replaces, and it fails against any sampling implementation.
- Also pinned there: every bearing illuminated exactly once per rotation; a nose radar's twice-per-cycle crossings and its arc edges being inclusive; a nose radar following its aircraft's heading; the gate order's observable effects (a ground vehicle seen only by the radar that sees ground, an approach radar ignoring an aircraft on the ramp, a radar on the ramp illuminating nothing); terrain blocking, terrain failing open while warming, and the 1 s line-of-sight cache.
- **`tests/efsp-station-coverage.test.mjs` pins selector resolution**, including `"*"`, `coalition: 'own'` excluding the enemy AWACS, de-duplication across overlapping selectors, an unresolvable-but-well-formed selector being accepted, and each malformed shape being refused with a reason.
- **`radarBearingPositionIds()` exists so the UI can say which Positions have a scope at all**, and a test holds `TWR`/`APP`/`CTR`/`TAC_C2`/`AIC`/`GCI` to being radar Positions and `OPS`/`CD`/`GND`/`JTAC` to not being. That assertion is what would catch a future Position being added with no decision made about its coverage.
- **The shipped on-disk facility configs need no edit.** `_loadOne` merges on-disk config over the defaults, and neither file carries `positionRadars`, so the defaults apply — no migration, and the same reasoning that keeps `hiddenBlocks` drift-free.
- **A drive-by fix while in the file:** `DEFAULT_RANGES_CONFIG` still carried `blockVisibility: {}`, the key `docs/adr/0041` replaced with `hiddenBlocks`. It was inert, because `RANGES` is derived and never persisted and `isBlockVisible` reads the new key. It is corrected anyway — a stale key in a default config invites the next reader to copy it.
- **`tests/tracks.test.mjs` is new**, and exists because `clear()` and `expireStale()` are the two places a DCS track identity vanishes, which is what WP5's correlation has to survive. `TrackStore` had no test file at all.
