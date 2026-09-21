# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of
`EFSPImplementationGuide.md` your work package names, then write a plan before writing code. This is
a handoff, not a build order.

**This revision supersedes the previous one.** It was called `efsp-wp4a-briefing.md` and briefed WP5;
the name was three work packages stale, so it is now `docs/efsp-briefing.md`. The last revision named
**WP5, track correlation** as the next package; it is built (§3C), and so is a rework of the radar
picture underneath it (§3B). The recommendation now is **stereo routes then WP6** — see §5.

## 1. State of the tree

Committed and green: **crc-sync 913 tests, crc-desktop 279 tests** (`npm test` in each). ADRs run
`0001`–`0048`.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/radars.js                    the radar list, derived from mission data + tracks
crc-sync/src/coverage.js                  what each radar is illuminating, one phase for everybody
crc-sync/src/terrain.js                   DEM fetch/decode and radar line of sight
crc-sync/src/efsp/station-coverage.js     which Positions grant which radars
crc-sync/src/efsp/correlation-store.js    Strip<->contact records, keyed by fdrId
crc-sync/src/efsp/correlation-match.js    the key ladder's matching rules (pure)
crc-sync/src/efsp/correlation-reconciler.js  the 1Hz sweep + the rate metric
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (data/)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the airspace board, correlation-highlight
docs/adr/                                 0001-0048, the reasoning behind every decision below
docs/efsp-usage-guide.md                  how a controller actually drives it
```

## 2. What's built

**WP0–WP4** (Phase 1 / Phase 2). Domain model and Mutation protocol (`0001`, `0002`); Position
occupancy, combination, handover, self-coordination, per-acting-Position permission (WP1A); the
Block Map as data; Bays/Racks/drag/gestures/search; States, NLA, the transfer protocol and a 30s
Undo (`0007`–`0012`).

**WP4A, both slices.** The civil half (`0013`–`0024`): the `CENTER` Facility, the 5 ATC↔ATC
coordination primitives, D13 per-Facility Strip replication, forwarding obligations, release across
the boundary, airspace ownership as a direction, the `OVERFLIGHT` Role and `ConvertToArrival`. The
military half (`0025`, `0026`): a `positionClass` concept making D12 true by construction, the
`TACTICAL` Facility, a minimal `MISSION` Role, and TOFI as its own sub-protocol.

**The `RANGE` station** (`0034`–`0038`). See §3A.

**The radar picture, reworked** (`0042`–`0044`). See §3B.

**WP5, track correlation** (`0045`–`0047`). See §3C.

**Durable runtime state** (`0048`). Seven things the service writes were going into the Docker image
with no volume behind it, so every deploy discarded the Board, the whole audit log, the squadron
squawk map, theater settings, ATIS config and the airspace definitions — and two of them were
committed to git, so a recreated container silently reverted controllers to an old snapshot. `config/`
is shipped defaults now, `data/` is runtime state and a volume, and a read falls back from one to the
other so a new default lands with no migration.

**Hardening driven by end-to-end sorties** (`0027`–`0033`, `0039`–`0041`). See §3D.

## 3A. The RANGE station

An airspace is a first-class entity in its own store (`0034`), carrying the guide's four state names,
a booked window, an append-only history, and a real approval round trip between the using agency and
whichever ATC Position owns it (`0036`). Flights are approved onto a working frequency, or onto a
range control tower's own frequency, through Block 22 (`0037`). A flight can be held to an altitude
block inside an airspace, which is how two aircraft share one (`0038`).

Two things about the shape before extending it:

- **A range Position works no Strips, structurally.** Guide §4.1's Class column for `RANGE` is "Using
  agency" and its Strip Roles column is "none". `permission.js` refuses every Strip op to the
  `USING_AGENCY` class in `canMutate` — and now every correlation op in `canCorrelate` too — by class
  rather than by absence from a table, because the `RANGES` Facility's Positions are *derived* from
  the airspace config and are never hand-listed (`0035`).
- **Most MOAs have no range control.** A Position exists only for a range that genuinely has one; an
  ordinary MOA is scheduled and activated by the ATC Position that owns the airspace it sits in,
  with no second party and no request step. That is the common case, not an exception.

`crc-sync/config/efsp-airspaces.json` ships **empty** — the real MOAs, ranges, owning authorities and
frequencies are squadron data. `tests/efsp-scenario-airspace.test.mjs` writes its own fixture, which
is the working reference for the config shape. `docs/efsp-usage-guide.md` §8A is the
controller-facing version.

## 3B. The radar picture is server-authoritative now

**Read `0042` before touching anything that draws a contact.** The picture used to be derived entirely
inside each renderer: `app.js` built the radar list from that client's own mission data,
`enabledRadarIds` was a localStorage opt-in set, and a 50 ms loop rotated each radar's beam from a
locally-minted phase. Nothing in crc-sync knew a radar existed.

That meant **two controllers at one board did not agree about which contacts existed** — different
checkbox sets, different sweep phases, different terrain-cache warmth — which makes a shared "this
Strip is that contact" record impossible to mean anything. So:

- Radars, range/beam geometry, sweep phase and terrain masking all moved into crc-sync
  (`src/radars.js`, `src/coverage.js`, `src/terrain.js`).
- **Coverage follows the Positions you hold.** `positionRadars` in facility config assigns radars to
  stations by **selector** — `{kind:'approach', airport:'LTAG'}` — never by radar id, because a radar
  id is derived from whatever mission is loaded and a persisted id list is `0041`'s inclusion list in
  a new costume (`0043`).
- **No radar-bearing Position held means an empty picture, said out loud.** `OPS`/`CD`/`GND`/`JTAC`
  ship with `positionRadars: []`. A controller holding only those gets no contacts and a banner
  saying why. Guide §4.1 and `0033` both lean on Ground and Clearance Delivery having no scope; it is
  now visible in the UI rather than only in a comment.
- **The arrow runs Position ⇒ coverage**, which is the inverse of what `0033` rejected. `0033` refused
  to derive *Positions* from radar selection; this derives *visibility* from a declaration of
  authority, which removes the hazard `0033` named rather than reintroducing it. `0029` is untouched.
- Illumination is **computed, not sampled** (`0043`). The old sweep tested a ±4° window on a 50 ms
  tick against a ~22 ms beam dwell, so it silently missed contacts; the server computes the instant
  the beam crosses a bearing, which makes the tick rate a delivery choice rather than a fidelity one.
- Terrain LOS moved with it (`0044`), decoding MapTiler PNG tiles with Node's own `zlib` — no new
  dependency — cached in memory and on disk, pre-warmed on mission load, **failing open** while warm.
  Needs `CRCSYNC_MAPTILER_KEY`; without it the picture works and masks nothing, logged once.

What went away client-side: `enabledRadarIds` and its localStorage key, the radar selector and its
search box, `getAllRadars`/`_buildAllRadars`/`getActiveRadars`'s old body, the 50 ms sweep, and the
DATALINK toggle (its radar half is a `coalition:'own'` selector now; its lock-lines half moved to
Settings). `los.js`/`elevation.js` survive **for the debug overlay only** — the server's answer is
authoritative, and `los-panel.js`'s header says so.

## 3C. WP5 — track correlation

`strip.correlation` was an inert hook keyed by `stripId`, and **the key was wrong** (`0045`). One FDR
legitimately has several Strips — per-Facility replicas, a TOFI `MISSION` Strip, an arrival converted
in place — so a per-Strip correlation lets two replicas of one airframe disagree about which contact
it is, and two answers to an identity question *is* the defect class §6.6 exists to prevent. The
record is keyed by `fdrId` in a fourth store, peer to the other three.

- The ladder is §6.6 rule 1's four rungs, run as **one ordered claim sweep** so a higher rung always
  claims a contact first. That makes a same-rung collision decidable: nobody gets it, and both
  flights are told it was ambiguous, with the candidates (`0046`).
- **Ambiguity is an answer, not a tiebreak.** Duplicate codes are structural (§3.10.2 rule 7) and
  guessing between two aircraft is worse than saying so. The badge becomes a button that lists them.
- The **uncorrelated warning retracts**, because it is a field on a record that arrives whole rather
  than a fire-and-forget alert. That is deliberately *not* the obligation-alert shape, which cannot
  retract — copying the nearest precedent would have shipped a Strip stuck at `NO TRK`.
- Match on the **raw** track callsign, display the **resolved** one. Matching on `resolveCallsign`'s
  output would make the callsign rung a laundered restatement of the beacon rung, and would let any
  client re-correlate flights by editing `config/squawk-map.json` (`0046`).
- `identity.beaconObserved` is finally written, so §3.10.2 rule 1's assigned-vs-observed three-case
  render has data behind it and **D22** is testable.
- The rate is reported — one line in the panel header, and a throttled warn below 95% — and is
  **null, never 1.0, on an empty board**, so the acceptance gate cannot pass vacuously.

## 3D. The sortie suites, and what they found

**Eight scenario files** under `crc-sync/tests/efsp-scenario*.test.mjs`, sharing a harness in
`tests/helpers/`. Each file gets its own durable board, because airspace, Strip and correlation state
persist (`0002`) and tests sharing a file share a board — and a test wanting a specific starting state
has to drive the shared one there itself.

Walking whole flights, rather than testing one mutation at a time, has now found twenty defects —
every one in machinery that already existed and looked finished:

| Defect | ADR |
|---|---|
| The terminal "Drop" NLA skipped `DropStrip`'s rules entirely — including the refusal to drop under live tactical control | `0027` |
| …and on that path the remove indicator was never set and the beacon code never released | `0027` |
| `releaseFdr` had no reference counting, so retiring a MISSION Strip freed the code of a still-airborne flight | `0028` |
| `actingPositionId` was an unchecked client claim | `0029` |
| `ConvertToArrival` discarded an open coordination or TOFI link with no guard | `0030` |
| TOFI had no (role, state) eligibility gate | `0031` |
| Airspace ownership overwrote its own history, and was never cross-checked against a TOFI exit | `0032` |
| Nothing routed to `assigned.releaseState` or `assigned.voidTimeUtc` — §3.8's release model was unreachable | `0039` |
| The EDCT and call-for-release windows were derived on every write and read by nothing | `0039` |
| A Strip could be created in a Bay the Facility does not have: accepted, holding a code, invisible | `0039` |
| Releasing an airspace with flights still in it said nothing | `0038` |
| `ConvertToArrival` erased every annotation on one click, with no undo | `0040` |
| Airspace ops were invisible to the Mutation log, so a refused request left no trace anywhere | `0040` |
| **The shipped facility config silently hid every Block added after it was written** | `0041` |
| The Board snapshot was rewritten non-atomically after every Mutation | `0041` |
| Nothing checked a restored snapshot's Strips, FDRs and code pool agreed | `0041` |
| Controller free text had no ceiling, and rides whole in every broadcast | `0041` |
| **The sweep sampled a ~22 ms beam dwell on a 50 ms tick, so contacts were missed unpredictably** | `0043` |
| A CVN's approach radar shared the `app:` id namespace with airport approach radars | `0042` |
| **`ConvertToArrival` reset the correlation of an aircraft still airborne and still squawking its code** | `0045` |
| `strip.correlation` was per-Strip, so two Facility replicas of one airframe could disagree | `0045` |
| ADR `0019`'s note that no Block targets `trackDegradationFlag` was already stale — `5A` does | `0047` |

**`0041` is still the one to read if you read only one**, and `0043` is the second. Both are the same
lesson from different directions: a shape that is correct the day it is written and wrong afterwards.
`0041`'s inclusion list froze a Block set; `0043`'s sampling tick was a fidelity decision disguised as
a performance constant. Worth carrying forward: **when something is both configurable and persisted,
ask what happens the next time the code grows** — and when a constant decides whether something is
detected at all, ask whether it should be arithmetic instead.

**Concurrency is covered and came back clean.** `efsp-scenario-concurrency.test.mjs` runs two
controllers at one Board — colliding writes, idempotent replay, both ends of a handoff acting at
once, resync inside and outside the ring-buffer window, and a replay against a Strip whose role
changed while its client was away.

## 4. What's left

**Not started, in the guide's own order (§16):**

- **WP6 — the military layer.** Entry is WP4. Two of its eight deliverables are already built:
  §9.11's airspace activation authority (`0036`), and §6.4's military extension Blocks. **Stereo
  routes (§9.10) are the cheap one and are the recommendation** — see §5.
- **WP7 / WP7A / WP8** — ATO ingest, the carrier, instrumentation. D-4 puts ATO ingest off the
  critical path for anything in the tower chain.

**Deferred with reasons, not forgotten:**

- **§10.3's suggestion chip and §10.4's staleness detection** (`0047`). Both need a definition of
  "detected airborne" that WP5 deliberately did not invent, and they share it — whichever is built
  first should define it as its own decision. §10.4 is WP8's by the guide's list. The §10.3
  prohibition is ring-fenced by construction: nothing in the correlation subsystem can write
  `strip.state` or `strip.bayId`, asserted by test.
- **`release-envelope.js`'s `radiusNm`** (`0047`). A position is obtainable now; it stays unmatched
  because a radius envelope makes a *release* depend on correlation, so a DCS re-ID would silently
  withdraw one mid-taxi. Belongs in a release-model slice.
- **`trackDegradationFlag` automation** is **refused**, not deferred (`0047`): DCS emits no
  track-quality signal, and synthesising one from correlation state is D11 *and* would force verbal
  coordination on every mission reload.

**Smaller, known, non-blocking:**

- `sourcedcs-web`'s `store.js` writes its JSON with a plain `fs.writeFileSync` — no tmp-and-rename —
  so it has the non-atomic-write problem `0041` fixed in crc-sync's `_persist`. Different service,
  small change, noted in `0048` because the audit walked past it.

- The server never retracts a forwarding-obligation alert once raised (`efsp-state.js` says so) — a
  Strip released after a void-time alert keeps the badge until the client reloads. **The correlation
  warning shows the shape that fixes this** (`0045`): a field on a record that broadcasts whole.
  Retrofitting obligations to it is a small, self-contained job.
- Airspace ops are not replayed on reconnect, unlike Strip mutations. Deliberate and tested
  (`efsp-scenario-manning.test.mjs`); correlation is the same, and for the stated reason
  (`_handleResync`'s "cheap enough at this scale").
- `AIC` and `JTAC` are configured but barely exercised; no scenario drives a Strip through either.
- The D12 audit `0020` asked for is structural in `permission.js` and tested server-side, but has
  never been walked against the rendered UI for a controller holding `TAC_C2` and `CTR` at once.
- `recordMet()` on the obligation monitor still has no caller (WP8).
- `positionRadars`' shipped defaults are **`[SOURCE-DEFINED]`** guesses at which scope sits at which
  console. The real assignment is squadron data and wants a look from somebody who knows.

## 5. Where to start

**Recommended: stereo routes (§9.10), then pick a WP6 deliverable.** The guide is unusually blunt
about it — *"the single most authentic-feeling military flight-data behaviour available… It is also
cheap. Build it early."* A local canned-route table keyed by short name, resolvable to a full route,
filable without the full flight-plan form. It fits the existing `CreateStrip` seed path:
`efsp-flight-plan-lookup.js` already pre-fills an FDR from a filed DD1801, and a stereo route is the
same shape with a local table instead of an HTTP lookup. Note `release-envelope.js` already has a
`stereoRoute` criterion waiting for it. WP6's acceptance criterion is one line: *"A stereo route filed
by short name produces a complete FDR."*

**Then WP6 proper**, and read its acceptance criteria in §13 before picking a deliverable. The MARSA
course/altitude void interlock (§9.2) is described there as *"the highest-value single military
interlock available"*, and the `[SOURCE-DEFINED]` audit is a criterion in its own right.

**If you would rather do WP8:** the obligation-retraction gap and the `config/` volume above are both
real, both small, and both bite in production rather than in the suite.

## 6. Habits this codebase has earned

- **Write ADRs as decisions get made**, not afterwards and not speculatively:
  `docs/adr/NNNN-title.md`, Context / Decision / Alternatives considered / Consequences. Pure
  bugfixes do not get one.
- **Restart the local crc-sync after editing `crc-sync/src/`.** Node does not hot-reload it, and a
  stale process looks exactly like a broken change.
- **Add a sortie, not just a unit test.** Every defect in §3D's table was invisible to per-mutation
  tests and obvious the moment a whole flight walked through. Use `advance()` from the harness rather
  than calling `InvokeNla` directly — the 400ms double-tap guard silently swallows a second press, so
  a chain walked without it passes while doing half of what it claims. And remember the shared board:
  absolute counts in a scenario file belong to the whole file, not to your test.
- **Then add the matching UI check.** A green sortie proves the server does the right thing and says
  nothing about whether a controller can ask for it.
  `crc-desktop/tests/efsp-ui-reachability.test.js` renders the real `bay-view.js` and
  `airspace-panel.js` against a DOM stub and asserts the control exists, is enabled when it should
  be, and dispatches the right op. It also holds every writable Block to being reachable somewhere,
  which is what caught §3.8's release model being invisible. **Note its blind spot:** it holds only
  *writable* Blocks, so a read-only indicator is invisible to it — which is one reason correlation
  state is a badge with its own dispatch test rather than a Block.
- **Be suspicious of a scripted edit that reports success.** A string replace matching nothing
  silently does nothing; that shipped an uncapped free-text field once, caught by review rather than
  by the suite. Grep for the thing you think you just wrote, and assert your line numbers before
  splicing a file.
- **Browser automation was not available this session**, so no UI change here has been clicked in a
  real browser. The reachability tests prove the wiring, not the pixels — drag-and-drop transfers,
  the new coverage list, the correlation ring on the map and anything layout-dependent are still
  unverified by eye.
