# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then `docs/efsp-wp6-plan.md` if you are
continuing WP6, then the part of `EFSPImplementationGuide.md` your work package names, then write a
plan before writing code. This is a handoff, not a build order.

**This revision supersedes the previous one.** WP6 is **in progress**: MARSA and its course/
altitude void interlock (§9.2) are built (§3F), and so is §6.4's military Block namespace (§3G) —
the pass that settled, once, what the guide's `M`-numbers are called here. Since then the mission
line was moved off TOFI so it exists from tasking, which turned up a regime nothing ever required
anyone to declare (§3H). Four of WP6's eight deliverables remain and the next one is **§9.7 field
state** — see §5. Before MARSA the
recommendation was stereo routes (§3E, built), and before that WP5 (§3C, built, along with a
rework of the radar picture underneath it, §3B).

## 1. State of the tree

Committed and green: **crc-sync 1068 tests, crc-desktop 388 tests** (`npm test` in each). ADRs run
`0001`–`0055`.

**There is a written plan for the rest of WP6**, covering all five remaining deliverables plus the
`[SOURCE-DEFINED]` audit, sequenced into phases that each land green with their own ADR. Phases 1
(MARSA) and 2 (the Block namespace) are done, and Phase 2's own section in the plan records the one
place it deviated. The plan carries a full design for §9.7 field state — the biggest remaining
piece — including the seven integration decisions it needs; do not re-derive them. **§9.7's `3F`
already exists**: Phase 2 built the hook requirement as a Block and a field, so Phase 3 owes the
*check*, not the field.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/radars.js                    the radar list, derived from mission data + tracks
crc-sync/src/coverage.js                  what each radar is illuminating, one phase for everybody
crc-sync/src/terrain.js                   DEM fetch/decode and radar line of sight
crc-sync/src/efsp/station-coverage.js     which Positions grant which radars
crc-sync/src/efsp/correlation-store.js    Strip<->contact records, keyed by fdrId
crc-sync/src/efsp/correlation-match.js    the key ladder's matching rules (pure)
crc-sync/src/efsp/correlation-reconciler.js  the 1Hz sweep + the rate metric
crc-sync/src/efsp/marsa-store.js          the MARSA relation, and the void interlock
crc-sync/src/efsp/block-map.js            the Block Maps, the interlock tags, MILITARY_BLOCK_NAMESPACE
crc-desktop/app/public/js/panels/efsp/marsa-badge.js  the badge + the participant highlight
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (state/)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the airspace board, correlation-highlight
docs/adr/                                 0001-0055, the reasoning behind every decision below
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

**MARSA, and the course/altitude void interlock** (`0051`). See §3F.

**The military Block namespace** (`0052`). See §3G.

**The mission line from tasking, and a regime that was never declared** (`0053`, `0054`). See §3H.

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
| **OVERFLIGHT had no Block meaning "ATC assigned this course/altitude"** — so §9.2's interlock was silently unreachable on one of the three ATC Roles, and its acceptance criterion would have passed anyway | `0051` |
| **DEPARTURE's Blocks 20 and 21 were labelled `SCRATCH`** since Phase 1 — they are the guide §6.2's own "Heading" and "Initial altitude"; ARRIVAL/OVERFLIGHT's meaning had been copied onto DEPARTURE. `CONFIRM_VACATED_ELIGIBLE_BLOCKS` has listed DEPARTURE's `21` all along, which only makes sense for an altitude | `0051` |
| `.efsp-coordinate-submit` has had no CSS rule since WP5, so the bind picker's candidate rows render as default browser buttons inside a dark popover | `0051` |
| **`DropStrip` had no affordance anywhere** — never state-gated server-side and OPS always held the permission, but the only way to ask was the `.drop` dot-command, so an OPS controller who proposed the wrong Strip had no visible way to undo it. `efsp-ui-reachability.test.js` held every writable *Block* to being reachable and said nothing about *ops* | — |
| **The no-radar-coverage overlay was `position: fixed; inset: 0`**, so an empty scope washed out the entire application — Strip panel, radio, airport panel — when the only thing with nothing to show was the map | — |
| **Five of six MARSA interlock Blocks could not be reached from the panel at all**, along with guide-REQUIRED Blocks including `9A-FUEL` — `_buildBlockCell` was only ever called from the compact list, and the "annotation editor" that `DELIBERATELY_NOT_IN_COMPACT_VIEW` excused them to was never built | `0055` |
| **§3.7's append-only history had never been rendered** — the server kept, persisted and broadcast every superseded entry since Phase 1 and `resolveBlockValue` discarded all but the ACTIVE one before it reached the DOM. No strikethrough CSS existed anywhere; `PREPLANNED` appeared zero times in the repo | `0055` |
| **The bind and MARSA popovers were missing from `_isProtectedStripEl`**, so another controller's board delta destroyed either one mid-interaction — the third time that list was found incomplete after the same bug | `0055` |
| **A resync from a client AHEAD of the server was served a delta, not a snapshot** — `currentSeq - lastSeq` goes negative when the server restarts with a cleared or rolled-back Board, which passes the window check trivially, so the server replayed from an empty ring and answered "nothing changed" to a client holding a whole Board of Strips that no longer existed. They never went away, and reconnecting did not help | — |
| **`efsp-block-map-parity.test.js` did not compare `interlock`** — adding the assertion failed immediately: the client had never carried the tag `0051` introduced, so the server could mark a Block and the panel could not know | `0052` |
| …and it did not compare `target.field` either, so a `tofi`/`military` Block could route to the wrong key of the right object on one side only | `0052` |
| **`efsp-ui-reachability.test.js` did not count a boolean-toggle Block as writable**, so the one test whose job is noticing an unreachable Block was blind to a whole class of them — harmless only because `IFR` was the sole example and happened to be in the compact view | `0052` |

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

## 3F. MARSA — the highest-value military interlock

§9.2's title is the design brief: *"model it as an edge, not a flag."* A **fifth store** (`0051`),
keyed by `marsaId`, whose participants are `fdrId`s — `0045`'s key choice reused, and for the same
reason: a `stripId` participant list would let two replicas of one airframe disagree about whether
it is separating itself.

Five things to know before extending it:

- **The interlock voids; it does not refuse.** A pre-rendezvous heading or altitude goes through and
  the relation ends under it. That is the conservative direction — ATC re-assumes separation —
  and refusing the clearance would leave a controller arguing with the panel about an aircraft in
  the air. The same asymmetry settles two smaller calls: it fires on *any* write to a tagged Block,
  changed or not, with `confirmVacated` the one carve-out (it issues nothing).
- **Rendezvous is an explicit controller action, not inferred from the radar picture.** `0047`'s
  call about "detected airborne", one step further on. A proximity threshold would be D11, and its
  failure is asymmetric: firing early **silently disarms the highest-value interlock in the military
  layer**, with nothing on any screen saying so.
- **Which Blocks count is Block Map data** (`interlock: 'COURSE'|'ALTITUDE'`), not a list held next
  to the interlock. Per-Role, because **DEPARTURE's Block 7 is the filed request and ARRIVAL's is
  the assigned altitude** — same id, opposite answers. A list elsewhere is `0041`'s frozen inclusion
  list again.
- **OVERFLIGHT had no assignment Block at all** and gained two (`7A`, `9A-VECTOR`). Without them the
  acceptance criterion passed on two Roles and quietly did not hold on the third. Worth carrying
  forward: *when a rule is per-Role, check every Role, because the test that passes is not the test
  that matters.*
- **The relation owns `separationRegime` while ACTIVE**, and a direct `SREG` write is refused with a
  reason pointing at End/Void. Two answers to "who is separating these aircraft" is the defect class.
  Anything that touches `fdr.tofi.separationRegime` now has a non-controller writer to account for.

Unlike a correlation record, **a relation survives a restart intact** — a persisted track id is a
lie after a restart, and a recorded verbal declaration is not.

## 3G. The military Block namespace — settled once, on purpose

`fdr.military` was the literal `null` of a `// WP6 hook` comment. `0052` turns it into an object in
one pass, so §9.5, §9.6, §9.7 and §9.4 add **behaviour** rather than each adding schema and each
answering the same three questions differently.

The part worth not re-deriving is the naming, which had been asked and answered four separate
times (`0026`'s frozen `M1`–`M8`, `0050`'s `9F`, `0051`'s `3F`, and three more deliverables
waiting):

- **The guide's §6.4 `M`-numbers are never Block ids on an ATC Block Map.** The `M`-prefix belongs
  to `MISSION_BLOCK_MAP`, which `0026` froze with *different* meanings — its `M4` is the beacon,
  the guide's `M4` is IFF Mode 1/2. A test holds every ATC Role to using no `M`-prefixed id at all.
- **Sub-letter the field onto its parent Block**, and cite the guide's number in the comment. That
  is what `3A`–`3E`, `8A`/`8B`, `9A`–`9F`, `5A` and `14A`–`14D` already do. So: `3G` ordnance
  (`M14`) and `3F` hook (`M15`), both in the 3-family because **the 3-family is the airframe**.
- **The mapping lives in code**, as `MILITARY_BLOCK_NAMESPACE` in `block-map.js`, asserted against
  the Block Maps *and* against `setMilitary`'s allow-list. A comment drifts; this fails a test.

Four things to know before extending it:

- **Both new Blocks are on all three ATC Roles, and neither is on MISSION.** `0051`'s lesson
  applied rather than remembered. MISSION is left out deliberately: it shares its `fdrId` with the
  ATC Strip it is TOFI-linked to, so a Block there would be a *second place* to declare one
  aircraft's ordnance — `0045`'s "two answers to one question" again.
- **`hookRequired` is a bare boolean and that is exactly why it has a dedicated setter.** "Hook"
  alone does not say *has one* or *requires one*, and only the second gates an arrival on rigged
  gear. `setMilitary()` is `setTofi`'s shape, structurally excluded from `WRITABLE_PATHS`; it
  **refuses an unknown key rather than merging it**, because §12's deferred fields sit in the same
  object and "not writable yet" has to fail loudly.
- **The deferred half is present, unpopulated, and has no write path at all** — `mtr`, `altrvRef`,
  `arInfo`, `scl`, `fuelState`, `releaseAuthority`. `alertStatus` is the one middle case: enum
  settled and validated, no Block, because picking its parent is §9.6's call. The `9G-*`/`9H-*` MTR
  ids are *reserved*, for the same reason — §9.4 says `M11`'s two items want prominent placement,
  so §9.4 places them.
- **`restore()` seeds the namespace onto an FDR that predates it.** Every board that has ever run
  has `military: null` on disk; without the seed a §9.5 reader throws on exactly the flights that
  were airborne when the service restarted. The client guards the same case, because nothing
  reseeds an FDR already in a connected client's cache.

**`3G` accepts `HUNG` and nothing acts on it yet, and `alertStatus` is unreachable from the UI.**
Both are visible half-features rather than silent ones, and both are the next deliverables' work.


## 3H. The mission line exists from tasking — and one hole found on the way

`TAC_C2` can frag a **mission line** against a filed flight before the jet moves
(`0054`), instead of waiting for TOFI to mint one. `TASKED` finally means something:
it used to be reachable only at the moment TOFI was proposed, by which time the
aircraft had been airborne for twenty minutes, so the MRU's first action was pressing
"Airborne" on a jet that already was.

Five things to know before extending it:

- **The shared `fdrId` IS the link.** No link object, no join table. That is already
  how this codebase answers "same flight?" everywhere (TOFI replicas, coordination
  replicas, correlation `0045`, refcounting `0028`, the `+N` badge), and it is what
  makes the binding work in **both directions for free** — WP7's ATO-first case is the
  same op run later, so it is a caller change rather than a mechanism change.
- **`CreateStrip` takes an optional `op.fdrId`**, mutually exclusive with `op.fdr`,
  deliberately **role-agnostic**. Its duplicate check scans the LOCAL Board only: the
  global `liveStripsForFdr` is role-blind, and the coordination primitives legitimately
  put same-role Strips for one FDR on two Boards.
- **TOFI finds before it mints**, and `mintedForTofi` is what keeps that safe.
  `bayForImpliedState` **falls back to `bays[0]`** when no Bay implies the state,
  TAC_C2's `bays[0]` is `tac-c2-tasked`, and TAC_C2 has no Bay for `OFF_STATION` or
  `RTB` — so a relocation copied blindly onto the reuse path files a working mission
  line back under *Tasked*. The same flag decides that a rejected exchange retires the
  Strip it minted but never one TAC_C2 tasked itself.
- **Unbind is Drop, and there is no re-bind.** Mutating a Strip's `fdrId` would drag
  correlation, MARSA membership and refcounting with it. A mis-bind is catchable
  instead: `M3` renders the bound flight's callsign, so the wrong jet shows the wrong
  callsign immediately.
- **While a TOFI is ACTIVE neither Strip can be retired.** Pre-existing, now reachable
  far more often, and walked in the scenario suite so it is a known property rather
  than an 0200 surprise.

**And the hole (`0053`).** Nothing ever required `fdr.tofi.separationRegime` to be set.
`TOFI_EFFECTS`/`tofiEffect` in `coordination.js` **is dead code** — it looks like it
applies the exchange's effects and has no runtime consumer at all — so the whole of
tactical control could run with the FDR saying nothing about who was separating the
aircraft, and the EXIT gate then failed twenty minutes downstream for a reason nobody
could trace. Accepting an ENTRY now **requires** the regime, asked for and never
derived (defect D14), with a picker beside the Accept button. An ACTIVE MARSA relation
is the one exception — it owns the regime (`0051`).


## 4. What's left

**Not started, in the guide's own order (§16):**

- **WP6 — the military layer, in progress.** Entry is WP4. **Four** of its eight deliverables are
  built: §9.11's airspace activation authority (`0036`), §6.4's military extension Blocks (`0026`
  and now `0052`, §3G), §9.10's stereo routes (`0050`, §3E) and §9.2's MARSA interlock (`0051`,
  §3F). The four left are field state with arresting-gear gating and the runway-change workflow
  (§9.7), alert/scramble constraints (§9.6), ordnance state (§9.5) and MTR fields (§9.4) — see §5.
  Two of §13's five WP6 acceptance criteria are met; §9.7 carries two more and the
  `[SOURCE-DEFINED]` audit is the fifth. **§9.5, §9.6 and §9.4 now owe behaviour, not schema** —
  `0052` turned the namespace on in one pass so they would not each have to.
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
- **`crc-desktop/tests/helpers/dom-stub.js` now exists** (`0054`) and holds the shared `makeElement`.
  The two older hand-maintained copies in `efsp-ui-reachability.test.js` and
  `efsp-stereo-panel.test.js` still stand and should migrate to it — mechanical, and both stubs now
  need the same `querySelector` class support `0055` added, which is the second time one change has
  had to be made twice.
- **`efsp-coordination-client.test.js:77` still scrapes `AIRSPACE_ENTRY_POSITIONS` out of
  `bay-view.js` with a regex.** `0055` replaced the equivalent scrape of the compact-Block list with
  a vm-sandbox read and deliberately left this one; it breaks the same way the moment that constant's
  shape changes.
- **The Strip's layout is unverified by eye** (`0051`, `0052`). The reachability tests render the
  real `bay-view.js` against a DOM stub and prove the wiring, not the pixels. The Strip carries
  seven badge/indicator slots plus two more Block chips now (`HOOK`, `ORDNANCE`), and nobody has
  looked at one with all of them lit.

## 5. Where to start

**Recommended: §9.7 field state**, the next phase of the WP6 plan. The guide calls it *"the
highest-value military-specific feature in the guide, and it has no civil equivalent"*, it carries
**two** of §13's five WP6 acceptance criteria, and §9.5's hung-ordnance propagation and §9.6's alert
pad both build on it. Its full integration design — fifth-vs-per-Facility store, where the runway
inventory lives, how rule 1 reaches `nla.js`, the two-acknowledgement runway-change machine,
permission, the `M15` hook check, and why rule 5's *"broadcast on the Board sequence"* has to be
deviated from — is already written down in the WP6 plan. Read it rather than re-deriving it; several
of those decisions are non-obvious and one of them (the sequence) is a deliberate deviation from the
guide's literal text that needs its reasoning carried into the ADR.

Two hooks for it already exist and should be used, not replaced: the `ops-field-state` Bay in
`facility-config.js` (currently `// WP6 hook, inert`) and `twr-runway-queue`'s one-Rack-per-runway
layout. And `nla.js` already carries the exact placeholder comments where rules 1's inhibits belong
— they say *"§9.7 is WP6 territory — never triggers here"*, and this is where that stops being true.

**Its `M15` half is already done.** `0052` built Block `3F` (`HOOK`) and `fdr.military.hookRequired`
with the rest of the namespace, so §9.7 owes the *check* — `gearMismatchFor(fdr, runway)`, derived
rather than stored — and not the field. §3G has the shape; the plan's rule-4 paragraph has the
reasoning for computing rather than storing it, which is the part worth reading first.

**The `M`-namespace question is settled** (`0052`, §3G) and should not be re-opened: the guide's
`M`-numbers are never Block ids outside `MISSION_BLOCK_MAP`, fields sub-letter onto their parent
Block, and `MILITARY_BLOCK_NAMESPACE` holds the mapping in code with a test behind it. §9.6 and
§9.4 each have exactly one id left to choose — `alertStatus`'s parent, and the real `9G-*`/`9H-*`
spellings — and both go in that table.

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
- **When a rule is per-Role, check every Role.** `0051`'s acceptance criterion would have passed on
  DEPARTURE and ARRIVAL while doing nothing at all on OVERFLIGHT, because each Role has its own
  Block Map and the criterion names no Role. The test that passes is not always the test that
  matters; `block-map.js`'s `interlockBlocks()` exists so that one is now asserted per Role.
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
