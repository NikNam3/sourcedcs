# 0076 — What "detected airborne" means, the suggestion chip, and staleness detection

## Context

`docs/adr/0047` deferred §10.3's suggestion chip and §10.4's staleness detection because both need one
definition it left open on purpose: when is an aircraft "detected airborne"? It also named
`checkOnGround` (5 km of an airfield and under 50 m above it) and refused it. That function is a radar
masking heuristic. It answers "should this contact be treated as being on the apron", not "has this
aircraft left the ground".

Correlation (WP5, `docs/adr/0045`, `0046`) now gives a Strip its contact, and the track carries
altitude, ground speed and vertical speed. The input exists. This ADR fixes the definition once, so
the chip and the staleness detector cannot disagree about it.

S-L27 also found a defect in the correlation ladder that belongs to the same subsystem: an exact
callsign match could claim an earlier flight's aircraft that was still in the air. That is decided
below too, because a chip built on a misbound contact would tell a controller that a flight which has
not left the apron is airborne.

## Decision

### "Detected airborne"

A **contact phase** is computed per correlated Strip, once per correlation tick, from the track the
Strip's correlation record points at. Three values, and the third is a real answer:

- **AIRBORNE**: all of
  - the track is an aircraft (DCS category 1 fixed-wing or 2 helicopter);
  - ground speed is at least `airborne.minGroundSpeedKt` (default **60 kt**), above any taxi speed and
    below any rotation speed, so a taxiing or towed aircraft is never airborne;
  - **height above the field is at least `airborne.minAglFt` (default 200 ft)** when it can be known,
    which is when the track is within 5 km of an airfield (the footprint `geo.js` already uses),
    measured against that airfield's elevation. 200 ft is deliberately above `checkOnGround`'s 50 m
    (164 ft): a reference-point elevation can be tens of metres off the runway under the aircraft, and
    the band between the two thresholds is UNKNOWN rather than a coin flip. Beyond 5 km of every airfield
    height is unknown and ground speed alone decides: an aircraft doing 60 kt that far from a field is
    not taxiing.
  - and that has held for **`airborne.holdSec` (default 5 s)** without a break. This is the debounce: DCS
    reports once a second, and a bounce, a one-sample altitude spike or a re-minted track must not flash
    a suggestion.
- **ON_GROUND**: `checkOnGround` is true (within 5 km of an airfield, under 50 m above it). This is
  the one place that function is the right tool: the aircraft is where a radar would mask it.
- **UNKNOWN**: everything else, including no contact, a PROVISIONAL or UNCORRELATED record, and the
  band between the two thresholds.

Only a **CORRELATED** record counts. A PROVISIONAL one (fuzzy callsign) is a guess, and a suggestion
built on a guess is how the prototype's confusion came back. UNKNOWN never contradicts anything.

### Which Strip states contradict which phase

A Strip *expects* a phase from its state:

| Role | Expects ON_GROUND | Expects AIRBORNE |
|---|---|---|
| DEPARTURE | `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE`, `LUAW` | `DEPARTED`, `HANDED_OFF` |
| ARRIVAL | `LANDED`, `TAXI_IN` | `INBOUND`, `HANDED_TO_TOWER`, `FINAL` |
| MISSION | none | `AIRBORNE`, `ON_STATION`, `OFF_STATION`, `RTB` |
| OVERFLIGHT | none | `TRANSITING` |

Pre-movement states (`PROPOSED`, `PENDING_CLEARANCE`, `CLEARED`, `HELD`, `TASKED`) expect nothing:
there may be no aircraft yet, and correlation already treats them as ineligible
(`correlation-reconciler.js`, `INELIGIBLE_STATES`). A contradiction is an expected phase against the
opposite observed phase. The table is in `src/efsp/surveillance-hints.js`, with a test that every
state in `STATES_BY_ROLE` is either listed or deliberately unlisted, the same discipline as
`INELIGIBLE_STATES`.

### The suggestion chip (§10.3)

When a DEPARTURE Strip in an expects-ON_GROUND state has an AIRBORNE contact, the server states a
**hint**: `AIRBORNE_ADVANCE`, naming the state the Strip would move to (`DEPARTED`). The Strip shows a
chip, "AIRBORNE? advance", to the Position that owns it. **One input** (a click) sends the existing
`SetState` Mutation. That is the ordinary controller path, so every rule that governs it applies
(owner check, runway inhibit, audit log, `rev`). A hint that is not accepted just stays; nothing
dismisses it but the state changing or the contact no longer being airborne.

**Nothing moves a Strip.** `SurveillanceHintMonitor` is handed read-only views, like
`CorrelationReconciler`, and writes nothing to a Board. The hints are an `efsp-alerts` slice, which
is state the client renders, never a Mutation. The ring-fence tests from 0047 stay as they are, and a
new one asserts the same of the monitor.

Only the departure's airborne chip is built. §10.3 permits "aircraft detected airborne; advance?", not
"detected landed". The arrival-side contradiction is detected and reported as staleness (below) and
carries no chip.

### Staleness (§10.4)

A Strip whose state contradicts its correlated contact for **`staleness.afterSec` (default 120 s)**
without a break raises a **low-severity indication** ("STALE") on the Strip, with a reason naming the
state and the contact. Two minutes is longer than the chip's 5 s on purpose: the chip is the prompt, and
the indication is what is left when the prompt was not acted on. Any gap (the phase becomes UNKNOWN, the
record leaves CORRELATED, the Strip's state moves to one that agrees) ends the episode; the next
contradiction is a new one.

**Each episode is logged once, when it crosses the threshold**, through
`EfspMetrics.recordStaleness` (L5's metric 6, `docs/adr/0072`), with facility, Position, Strip, flight,
the Strip state, the contact phase and how long it had persisted. The detector declares its source at
wiring, so a genuine zero reads `NO_DATA` and not `NOT_INSTRUMENTED`. The time of an occurrence is the
mission clock (`docs/adr/0079`).

The four numbers are a **tuning file** (decisions P5): `config/efsp-surveillance-hints.json`, read once
at startup, never written, validated per field with a warning and a default. None is doctrine; the
guide says only "a configured threshold" (§10.4).

### The takeoff time is stamped by the state change (Q-L16-3)

`docs/adr/0073`'s takeoff chain read `CONTROLLER` then `EST_OFF_BLOCK`. A new source, **`STATE_CHANGE`**,
sits between them: the mission-clock time at which a DEPARTURE Strip entered `DEPARTED`, however it got
there (the NLA, `SetState`, a drag into the Airborne Bay, an Undo that reverts it clears the stamp).
It is stored as an input, `fdr.timeInputs.takeoffStampedUtc`, never in the controller's own
`assigned.takeoffTimeUtc`, so a controller's entry still wins and clearing it resumes the chain. The
stamp is written by `board-store.js` and travels as an FDR update on the same Mutation ack. It is the
controller's own act (TWR pressed Airborne), not surveillance: nothing here stamps a time from a
track.

### Callsign misbinding (S-L27)

The soak reuses callsigns every 90 flights, and an exact callsign match could claim a track that still
belonged to an earlier flight (the soak's `LINGERING_TRACK` cause, S-L27). **A contact that
was correlated to a flight which has since finished is not claimable by another flight's callsign or
beacon rung.** The reconciler remembers, per track, which finished flight last held it, until the
contact leaves the picture. A controller's explicit binding (rung 1) always overrides, because it is a
person saying so. The new flight simply stays uncorrelated until its own contact appears, which is the
truth: it has no aircraft yet.

## Alternatives considered

- **`checkOnGround` negated as "airborne".** Rejected by 0047 and again here: it is false for any
  aircraft above 50 m but outside 5 km of a field, and true for none of the band between. It is kept
  for ON_GROUND only, where its meaning is exactly right.
- **Vertical speed as the test.** An aircraft that levels off immediately after rotation has none, and
  a hover (a helicopter) has none. Height and ground speed are the observable fact.
- **Height alone.** Beyond 5 km from a field there is no elevation to measure against; DEM terrain is
  an optional dependency (`CRCSYNC_MAPTILER_KEY`) and a correlation-side feature must not need it.
- **Debounce by consecutive ticks.** Mission-clock seconds are what the guide and the metrics speak,
  and a tick count would change meaning if the cadence did.
- **A chip on every ground state with the next NLA as its target.** It would offer "advance to TAXI"
  to an aircraft in the air. The suggestion has to be about what was observed: airborne means DEPARTED.
- **Moving the Strip on acceptance by a server-side action.** There is no such action: acceptance is the
  controller's `SetState`, and a hint cannot be accepted by anyone who could not have done it by hand.
- **Fixing the misbinding by timing** (a track older than the flight cannot be its aircraft).
  Rejected: a controller creates a Strip for an aircraft already in the air all the time.
- **Stamping the takeoff time into `assigned.takeoffTimeUtc`.** It would be indistinguishable from a
  controller's entry, would stop the chain, and an Undo could not tell what to remove.

## Consequences

- `crc-sync/src/efsp/airborne.js` (the phase), `surveillance-hints.js` (the monitor and the state table),
  `surveillance-hints-config.js` (the tuning file) and `config/efsp-surveillance-hints.json` are new.
- `efsp-alerts` gains a fourth slice, `surveillance`. `broadcastEfspAlerts` in `server.js` is still the
  one place it is composed.
- crc-desktop reads the slice in `efsp-state.js`; `strip-view.js` gains cases in `_stripAlerts` and one
  click hook in `_buildIndicatorSlots`; a hint changes what a Strip renders from state that is not the
  Strip's own, so it is in `_stripRenderSignature` (S-L14's standing rule).
- `time-chains.js` (both copies) gains `STATE_CHANGE`, and its fixture changes.
- The correlation reconciler gains the finished-flight memory; the soak's misbinding count is the
  acceptance row.
- Known limit: the memory is by track id. A lingering aircraft that DCS re-mints under a new id is a
  new contact to the reconciler and is not remembered. The soak re-mints (`nextRemintAt`); see
  `docs/wip/L19.md` for what the runs showed.
- Not changed: a beacon match onto an aircraft squawking another flight's code (the soak's
  `FAULT_wrongSquawk`) is the code doing its job, and still binds. Telling it apart needs evidence
  the ladder does not use (a callsign that belongs to someone else), and is a decision for another
  ADR.
