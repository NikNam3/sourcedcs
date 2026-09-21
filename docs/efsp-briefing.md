# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of
`EFSPImplementationGuide.md` your work package names, then write a plan before writing code. This is
a handoff, not a build order.

**This revision supersedes the previous one.** The last revision recommended **stereo routes then
WP6**; stereo routes are built (§3E), so the recommendation now is **WP6 proper** — see §5. Before
that it was called `efsp-wp4a-briefing.md` and briefed WP5, which is also built (§3C), along with a
rework of the radar picture underneath it (§3B).

## 1. State of the tree

Committed and green: **crc-sync 984 tests, crc-desktop 324 tests** (`npm test` in each). ADRs run
`0001`–`0050`.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/radars.js                    the radar list, derived from mission data + tracks
crc-sync/src/coverage.js                  what each radar is illuminating, one phase for everybody
crc-sync/src/terrain.js                   DEM fetch/decode and radar line of sight
crc-sync/src/efsp/station-coverage.js     which Positions grant which radars
crc-sync/src/efsp/correlation-store.js    Strip<->contact records, keyed by fdrId
crc-sync/src/efsp/correlation-match.js    the key ladder's matching rules (pure)
crc-sync/src/efsp/correlation-reconciler.js  the 1Hz sweep + the rate metric
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (state/)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the airspace board, correlation-highlight
docs/adr/                                 0001-0050, the reasoning behind every decision below
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
is shipped defaults now, `state/` is runtime state and a volume, and a read falls back from one to the
other so a new default lands with no migration. (Not `data/` — that name was the first choice and it
already meant shipped read-only reference data; `state-paths.js`'s header has the whole story.)

**Stereo routes** (`0050`). See §3E.

**Hardening driven by end-to-end sorties** (`0027`–`0033`, `0039`–`0041`, `0049`). See §3D.

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
| **Coverage was never re-sent when the radar list changed**, so a GCI controller whose AWACS had just taken off got contacts through it while their panel still listed nothing and the NO-COVERAGE banner stayed up | `0049` |
| Illumination outlived the radar that produced it, so re-taking a vacated Position replayed contacts stamped from before the gap | `0049` |
| A correlation record for a flight with no live Strip left was never retired — stuck with a stale contact, and sent in every snapshot forever | `0049` |
| A Strip correlated to a contact outside the controller's coverage rendered a bare track id as though it were a callsign, and clicking it drew no ring | `0049` |
| Binding a contact was pointer-only; `.bind`/`.unbind` were missing from the dot-command surface the guide calls a primary feature | `0049` |
| **Seven things the service writes were going into the Docker image with no volume**, so every deploy discarded them — and two were committed to git, so a recreate silently reverted controllers to an old snapshot | `0048` |

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

## 3E. Stereo routes

§9.10's canned-route table, WP6's cheap deliverable (`0050`). `stereo-routes.js` is squadron config
on `0048`'s `config/`-vs-`state/` split; `createFdr()` expands a short name into a complete FDR
**server-side**; Block `9F` (`STEREO`) carries the name and writing it re-files the flight; a
`<select>` beside the callsign box and `.stereo PACK1 VIPER11` both file one. WP6's acceptance
criterion is asserted verbatim in `efsp-scenario-stereo.test.mjs`.

**Three things worth knowing before touching it:**

- **The table ships empty, and that is the decision, not an omission.** Real Pack routes are squadron
  data; inventing them is D11. The picker hides itself entirely when there is no table, so nothing
  looks broken — but it also means **nobody has ever used this against real routes**. `0050`'s
  Consequences lists what discharges that (the usage guide's §4A schema, the scenario fixture).
- **`filed.stereoRouteName` is never a bare string write.** Every write resolves against the table
  and re-expands the route from it, so the label and the route cannot disagree — which matters
  because `nla.js`'s standing-release gate matches on that label. Amending Block 9 clears it, for the
  same reason. Anything that touches this field has to preserve that, not just the field.
- **`release-envelope.js` now reads one config field two ways** — the filed short name first, the
  route string as `0017`'s fallback. Retiring the fallback later means migrating the configured
  envelopes first, not just the matcher.

**Four client bugs came out of this, and all four were "a message nobody could read" or "a state
nobody could reach."** Two pre-existing: `_wireDotCommand` cleared the preview line immediately after
dispatch, so **every dot-command error was erased as it was written** (`.bind`'s "needs a track id"
has never been visible), and `_onCreateStripAck` printed `reason` and dropped `detail`. Two in the
stereo code itself, found by walking the switch/cancel cases *after* the suite was green: `.stereo`
skipped §3.6's duplicate-origination guard, and the route picker was fetched once at panel init so a
table edit plus a crc-sync restart left every controller on a stale list until they reloaded the app.

**The switch case is why `9F` is writable at all.** It shipped read-only, and walking *"VIPER11,
request change to PACK 2"* by hand showed both remedies were bad — hand-editing the route dropped the
label, the altitude and the envelope match; dropping and re-filing minted a new squawk mid-taxi. This
is §3D's lesson arriving again, in the place it always arrives: not in a mutation, but in a
transition nobody had walked.

## 4. What's left

**Not started, in the guide's own order (§16):**

- **WP6 — the military layer.** Entry is WP4. **Three** of its eight deliverables are now built:
  §9.11's airspace activation authority (`0036`), §6.4's military extension Blocks, and §9.10's
  stereo routes (`0050`, §3E). The five left are the MARSA course/altitude void interlock (§9.2),
  field state with arresting-gear gating and the runway-change workflow (§9.7), alert/scramble
  constraints (§9.6), ordnance state (§9.5) and MTR fields (§9.4) — see §5.
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
- **Stereo routes have never run against real routes** (`0050`). The table ships empty on purpose, so
  the whole feature is inert until somebody writes
  `crc-sync/state/efsp-stereo-routes.json` and restarts crc-sync — schema and install paths are in
  `docs/efsp-usage-guide.md` §4A. Until then the picker correctly hides itself, which means "not
  configured" and "broken" look identical from the outside.
- **Block `9F` is free text, not a picker.** The valid set is runtime config and
  `ENUM_SELECT_BLOCKS` is a static client literal, so a dynamic-option `<select>` for it is the
  obvious small follow-on (`0050`). A typo is refused with a visible reason, so this is ergonomics,
  not correctness.
- **`crc-desktop/tests/` has no `helpers/`**, so `efsp-stereo-panel.test.js` carries a trimmed copy
  of `efsp-ui-reachability.test.js`'s `makeElement` DOM stub. Two copies is the point at which
  lifting it out is worth doing; the third should not be written.

## 5. Where to start

**Recommended: WP6 proper.** Read its acceptance criteria in §13 before picking a deliverable. The
**MARSA course/altitude void interlock (§9.2)** is the guide's own pick — *"the highest-value single
military interlock available"* — and its acceptance line is concrete: a heading or altitude
assignment to a MARSA participant before rendezvous voids the relation, sets `voidedBy`, and alerts
every participant Strip. That makes it a relation between FDRs with its own void semantics, which is
a genuinely new shape in this subsystem; `0050`'s "one flight, one answer" reasoning and `0045`'s
record-with-a-warning shape are both worth reading first.

The **`[SOURCE-DEFINED]` audit is a WP6 acceptance criterion in its own right** — *"No UI text or
code comment presents a `[SOURCE-DEFINED]` behaviour as real-world doctrine. Audit this
explicitly."* It has never been run as a pass over the whole tree, only observed file by file, and
it gets easier to do now than after five more deliverables land.

**Before anything else, half an hour with a real stereo table.** Write two or three actual squadron
routes into `crc-sync/state/efsp-stereo-routes.json`, restart crc-sync, and file some flights on
them. Everything in §3E is proven by tests and by one hand-driven pass against a made-up table;
none of it has been driven by somebody who knows what a Pack route is. That is where the next
defect is, and it is the cheapest thing on this page.

**If you would rather do WP8:** the obligation-retraction gap and `sourcedcs-web`'s non-atomic
`store.js` writes are both real, both small, and both bite in production rather than in the
suite.

## 6. Habits this codebase has earned

- **Write ADRs as decisions get made**, not afterwards and not speculatively:
  `docs/adr/NNNN-title.md`, Context / Decision / Alternatives considered / Consequences. Pure
  bugfixes do not get one.
- **Restart the local crc-sync after editing `crc-sync/src/`.** Node does not hot-reload it, and a
  stale process looks exactly like a broken change.
- **Walk the sorties by hand once the suite is green.** `0049` is five defects found that way, in
  code that had just been written, reviewed and covered — and all five sat in a TRANSITION: a radar
  appearing, a Position vacated and retaken, a flight ending, a reconnect. The scenario files walk a
  flight's life; none of them walks the *facility* changing underneath one. That is the gap in the
  sortie suite itself, and manning churn and radar churn deserve to be scenarios rather than setup.
- **Walk what a PILOT would ask for, not just what a Strip does.** `0050` shipped complete against
  its acceptance criterion and its own design, and four defects plus one reversed decision fell out
  of asking "what if they request a different stereo?" and "what if they cancel it?" — questions the
  lifecycle never poses, because a request is not a state. `0049`'s transitions and this are the same
  habit pointed at two different axes; a slice is not done until both have been walked.
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
