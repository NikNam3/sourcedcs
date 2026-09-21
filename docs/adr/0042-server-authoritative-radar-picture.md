# 0042 — The radar picture becomes server-authoritative, and coverage follows the Positions a controller holds

## Context

**Every controller was looking at a different picture, and nothing in crc-sync knew radars existed.**

The radar picture was derived entirely inside each renderer. `app.js`'s `_buildAllRadars()` built the radar list from that client's own copy of the mission data; `enabledRadarIds` was an opt-in set persisted to `localStorage` under `crc-desktop-enabled-radars`; a 50 ms `setInterval` rotated each radar's beam from a phase minted locally on first sight, tested each track against a ±4° window, and called `los.js` for terrain masking. `getActiveRadars()` then filtered that by the user's checkboxes, plus — when the DATALINK toggle was on — every own-coalition airborne radar. Grep for `radar` in `crc-sync/` before this change and the only hits are `radar-locks` (a datalink lock poll) and EFSP's `radarIdTransfers`/`trackDegradationFlag`, which are coordination doctrine and unrelated.

The consequences were not subtle once looked at directly:

- **Two controllers at one board did not agree about which contacts existed.** Each had its own `enabledRadarIds`, its own sweep phase, and its own terrain-tile cache warmth. "Do you see him?" had no determinate answer.
- **Visibility was a personal preference with no relationship to the job.** A Ground controller could tick an AWACS and watch the whole theater; an Approach controller could untick their own approach radar and see nothing, with no signal that anything was wrong.
- **The intended next work package could not be built on it.** WP5 binds a Strip to a surveillance contact (guide §6.6, defect **D1**). A binding to something the other controller cannot see, on a scope whose contents are a local preference, is not a shared record — it is a per-client opinion wearing the costume of one.

`docs/adr/0033` is the reason this needs stating carefully. It **rejected** deriving Positions from radar selection, on two grounds: `GND`, `CD` and `OPS` have no radar at all, so the derivation is structurally inapplicable to half of Phase 1's Positions; and — the sharper point — *"those checkboxes control what a controller can see, and coupling authority to visibility means a controller silently acquires or loses the right to act on Strips by adjusting their display."* Its Consequences add that *"any future proposal to derive Positions from anything else has to revisit 0029 at the same time."*

## Decision

**The radar picture moves into crc-sync, and coverage is derived from the Positions a controller holds.**

Four new modules, and the chain between them:

```
radar-specs.json + missionData + tracks  ->  src/radars.js        buildRadars()
                                             src/efsp/station-coverage.js
                                                 which Positions grant which radars
                                             src/coverage.js      what each radar illuminates,
                                                 one sweep phase for everybody, terrain included
                                             src/ws-hub.js        each session receives only
                                                 what its Positions can see
```

**The arrow runs Position ⇒ coverage, which is the inverse of what 0033 rejected, and the inversion is the whole point.** 0033's objection was that authority must not follow visibility. Here visibility follows authority: a controller declares what they hold through the same "ACTING AS" selector 0033 established, and the picture is a consequence of that declaration. The hazard 0033 named — acquiring or losing the right to act on Strips by adjusting a display — cannot arise, because there is no display control left to adjust. **`docs/adr/0029` is untouched:** nothing here changes how a Position is acquired, `setHeldPositions` remains the single path, and `actingPositionId` is still bound to `positionStore.primaryOf(...) === session.controllerId` at the wire boundary. 0033's request is discharged by saying so rather than by inference.

**Held, not Primary.** Guide §4.8.2 rule 3 makes a second controller at an occupied Position an Observer, and an Observer watches. Holding a Position gets you its picture whether or not you may act on its Strips. `StationCoverage.heldPositions()` reads `PositionStore.heldBy()` for exactly this reason.

**No radar-bearing Position held means an empty picture, said out loud.** `GND`, `CD`, `OPS` and `JTAC` ship with `positionRadars: []` — an explicit statement, not an omission. A controller holding only those, or holding nothing, receives no contacts at all, and the overlay reads `NO RADAR COVERAGE — HOLD A RADAR POSITION` while the coverage panel names which held Positions work no scope. A Ground controller genuinely has no scope; the honest empty state is the answer, and it is the same fact 0033 leant on, now visible in the UI instead of only in a comment.

**A track a controller's radars have never illuminated is not sent to them at all.** `ws-hub.js`'s `_tick` asks "what has my beam passed over since I last looked" rather than "what changed in the store". There is no longer any way to see the whole theater. The two halves of the old client-side distinction are both answered by the server now and must stay distinct: *may I know about this* (in coverage) and *has my beam just found it* (`illuminatedAt`).

**A coverage change re-sends the picture rather than diffing it.** Handing back a Position releases radars, and every contact only those radars could see has to go with them. `_refreshCoverage` compares the resolved radar-id set and, when it differs, sends a fresh snapshot. Working that out as a delta would mean intersecting two coverage sets against the live picture, and a snapshot says the same thing with no chance of getting it wrong.

**Two bugs in the ported code were fixed rather than carried over**, both recorded here because they are the kind of thing a port silently preserves:

- **A CVN's approach radar shared the `app:` id namespace with airport approach radars** (`app:${track.id}` against `app:${airport.name}`). `geojson.js`'s extended centerline keyed on `'app:' + name`, so a carrier could match for an airfield. Carriers now get `cvapp:`.
- **`noseScanLastMs` was declared beside the sweep state and never read or written anywhere.** It is not ported.

**Radar specs get one home.** `spec.radar` and `spec.carrierRadar` in `crc-desktop/app/data/aircraft-types.json` were read by nothing but `_buildAllRadars` (verified). They moved to `crc-sync/config/radar-specs.json` and were deleted from the client file, which now carries display labels only. One home, rather than two copies and a parity test.

**What stays in the renderer**, and why each thing is a display concern rather than a picture concern:

- The fade and expiry pass, now on a 250 ms tick instead of 50 ms, because nothing is detected in it.
- `los.js`/`elevation.js`, **for the debug overlay and the hover profile chart only.** Masking itself is `src/terrain.js`'s (`docs/adr/0044`); the client copy exists to explain the server's answer, not to second-guess it. If the two ever disagree the server is right. Said plainly in `los-panel.js`'s header so neither gets "fixed" into the other.
- `groundLabels` and `labelOffsets`, which were always per-viewer annotations.

**The DATALINK toggle is gone, and its two jobs went to different places.** It auto-included every own-coalition airborne radar *and* drew datalink lock lines. The first was never a display preference — it was a description of what a Military Radar Unit works from, and it is now `coalition: 'own'` selectors on `TAC_C2`/`AIC`/`GCI` in facility config. The second is a display preference and moved to the Settings panel, where they live.

## Alternatives considered

- **Keep the client simulation and only replace `enabledRadarIds` with a Position-derived radar set.** Rejected, and this was the tempting one — much the smallest diff. But sweep phase and terrain-cache warmth stay per-client, so two controllers holding the same Position still see nearly-but-not-quite the same contacts, at nearly-but-not-quite the same moments. "Nearly the same picture" is the thing that makes a shared correlation record dishonest; halving the divergence does not change its kind.
- **Move coverage server-side but leave terrain masking in the renderer.** Rejected for the same reason one step further in: terrain decides whether a contact appears at all, so leaving it client-side leaves the *contents* of the picture per-client while moving only its timing. It also splits one decision across two codebases, which is how the two drift.
- **Compute correlation server-side against the full track store and leave display filtering alone.** Rejected. It would satisfy WP5's letter — the correlation rate would be computable — while leaving a Strip that says `TRK VIPER1` next to a scope where that contact is not drawn, for a controller who has not ticked the right box. The defect class §6.6 names is *identity reconciliation between two domains*; a correlation to something the controller cannot see is that defect, not a fix for it.
- **Derive Positions from coverage** (0033's direction, revisited). Rejected again, for 0033's own reasons, which have not changed: `GND`/`CD`/`OPS` still have no radar, and authority still must not follow display.
- **A per-facility fallback radar set, so holding `GND` still showed the field.** Rejected in favour of the empty state after being offered as an option. It would keep the tower chain glanceable, at the cost of one more config knob that can drift and a picture whose provenance is no longer a single sentence. The empty state with a stated cause is simpler to reason about and doctrinally true.
- **An observer/supervisor mode showing everything.** Not built. It is a real need — training, spectating, an after-action walkthrough — but it is a deliberate, attributable mode rather than the accidental default, and building it now would have restored exactly the "see everything" behaviour this ADR exists to remove. Left as a named follow-on rather than smuggled in.

## Consequences

- **`tests/ws-hub-coverage.test.mjs` pins the rule that matters**: a contact only somebody else's radar has illuminated is not delivered; a controller holding no radar Position receives nothing however many contacts exist; taking a Position re-sends the picture and handing it back empties it; and an overlay edit on an invisible contact does not leak it.
- **`tests/efsp-station-coverage.test.mjs` pins the shipped defaults** — `APP` gets the approach and field radars, `TWR` the field radar only, `GND`/`CD`/`OPS`/`JTAC` nothing, `CTR` every airfield approach radar, the MRUs the own-coalition airborne picture — and that an Observer sees exactly what the Primary sees.
- **`tests/radars.test.mjs` is the first coverage the radar derivation has ever had.** `app.js` has no `module.exports` guard, so `_buildAllRadars` could not be required from a test at all; the list, the selection and the whole sweep were untested in both packages. The only pre-existing test in the area was `crc-desktop/tests/los-math.test.js`, which moved to `crc-sync/tests/terrain.test.mjs` with the math it covers.
- **The renderer is still the part with the thinnest net.** `app.js`, `geojson.js` and `dock.js` remain unrequireable, so `applyCoverage`, `applyDelta`'s illumination handling and the fade pass are covered only by having been read. `crc-desktop/tests/coverage-panel.test.js` runs the real `radar-panel.js` against a DOM stub and pins the empty-state wording and the per-radar rows, which is the user-visible half. **Nothing here has been clicked in a browser** — no browser automation this session.
- **A client can no longer put itself back in charge of its own picture.** The coverage-panel test asserts that `setRadarEnabled`, `enabledRadarIds`, `renderRadarSearchResults` and `notifyRadarToggled` are all absent, not merely unused: a leftover setter would be a route back to the behaviour this removes.
- **`crc-desktop-enabled-radars` in `localStorage` is orphaned, deliberately.** A leftover key is harmless and never read again; clearing it would need code whose only job is to delete something nothing looks at.
- **The Airport panel's auto-open now fires on taking Tower or Approach** rather than on ticking an airport radar (`dock.js`'s `notifyCoverageChanged`, replacing `notifyRadarToggled`). It compares against what the implication last said, so manually closing an implied-open panel is still not fought — and `preserveFocus` matters more than before, because coverage can now change with no local input at all, when a colleague takes a Position.
- **A found, unfixed problem, reported rather than quietly patched: the `crc-sync` service has no volume for `config/`**, so `efsp-board.json` and `efsp-mutations.jsonl` live only inside the image and a `docker compose up -d` that recreates the container discards them. `docs/adr/0002` makes the Board durable and `docs/adr/0041` went to some trouble to make `_persist` atomic; neither survives the deployment. This change adds `crc-sync-data:/app/data` for the DEM cache **only**, and deliberately does not mount over `/app/config` — a named volume starts empty and would shadow the facility, airspace, squawk-map and radar-spec files baked into the image, which would present as every one of them having reset to defaults. Fixing Board durability properly is its own change, and it is `docs/adr/0041`'s lesson arriving again: *a test that builds its own config is testing the code, not the deployment.*
- **`settings.datalink` survives with a narrower meaning** — datalink lock lines only — and moved to the Settings panel. Its old second job is `positionRadars` config now.
