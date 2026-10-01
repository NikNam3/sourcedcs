# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of `EFSPImplementationGuide.md`
your work names, then write a plan before writing code. This is a handoff, not a build order.

**This revision supersedes the previous one.** The remaining EFSP work is being finished by many
agents at once, in waves of parallel lanes (`docs/efsp-parallel-plan.md`). **Wave 1 is merged**:
eleven lanes plus a bugfix lane landed field state (server), MTR fields, the USMTF ATO parser, the
carrier model, WP8 metrics and the soak harness, retracting obligation alerts, test debt and the
AIC/JTAC walks, the `[SOURCE-DEFINED]` inventory, IFF from interrogation, atobrief's USMTF export
and a fix for the gRPC reconnect loop (§3I). **Wave 2 is next** (§5), and the known bugs each have an
owning lane (§4).

If you are a lane agent, your own briefing in `docs/parallel/wave2/` and
`docs/parallel/lane-rules.md` come first, and **`docs/parallel/decisions.md` overrides both**. If you
are the supervising session, start at `docs/parallel/supervisor-handoff.md`.

## 1. State of the tree

Integration branch `efsp-wp5-correlation`. Wave 1 merged up to `3b27390`, then `8feeca0` (the human's
answers H53 and H70, ADR `0084`). Not pushed.

Green: **crc-sync 1565 pass / 8 todo** (1573 tests; the 8 todos are L8's B1–B7, owned by L23),
**crc-desktop 517**, **atobrief 77** (`npm test` in each; atobrief had no tests before wave 1). The
full Playwright suite was started at the merge and its result was never seen: **re-run it**
(`E2E_LANE=9`). Restart the local crc-sync on :3000 after any `crc-sync/src` change.

ADRs: `0001`–`0067`, `0078`, `0079`, `0084`. The gaps are reserved: `0068`–`0077` for the plan's
lanes L1b–L20, `0080`–`0089` for wave 2 and the fixes between waves (`decisions.md` S-W3a). `0060`
is the errata ADR. **An ADR is never edited once committed (P4)**: a correction is a new ADR.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/mission-clock.js             in-game Zulu, injected into every EFSP time (F1, 0079)
crc-sync/config/theaters.json             per-theater table (local offset today; variation, TA next)
crc-sync/src/radars.js                    the radar list, derived from mission data + tracks
crc-sync/src/coverage.js                  what each radar is illuminating, one phase for everybody
crc-sync/src/terrain.js                   DEM fetch/decode and radar line of sight
crc-sync/src/grpc-client.js               DCS-gRPC client: poll_rate ≥ 1, unit keep-alive, backoff (LG)
crc-sync/src/surveillance/                what a controller is told about a contact (0059)
crc-sync/src/surveillance/iff.js          classifyIff(): the one place a contact's colour is chosen (0066, 0084)
crc-sync/src/efsp/station-coverage.js     which Positions grant which radars
crc-sync/src/efsp/correlation-*.js        Strip<->contact records (fdrId-keyed), the ladder, the 1 Hz sweep
crc-sync/src/efsp/marsa-store.js          the MARSA relation, and the void interlock
crc-sync/src/efsp/field-state*.js         field state: pure rules + FieldStateStore, the sixth store (0061)
crc-sync/src/efsp/zulu-time.js            typed HHMM -> epoch ms against the mission clock (L2)
crc-sync/src/efsp/forwarding-obligations.js  obligations as state, retracting (0067)
crc-sync/src/efsp/metrics.js, traffic-count.js  WP8 metrics, §11.4 traffic count, log retention (0065)
crc-sync/src/efsp/ato/                    USMTF ATO parser: text -> mission lines, creates nothing (0063)
crc-sync/src/efsp/carrier/                pure carrier model: stack, Case, ship banner, transfers (0064)
crc-sync/src/efsp/block-map.js            the Block Maps, the interlock tags, MILITARY_BLOCK_NAMESPACE
crc-sync/tools/soak/                      the WP8 soak harness (npm run soak / soak:smoke / soak:selfcheck)
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (state/)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the airspace board, correlation-highlight
atobrief/public/js/usmtf-ato.js           atobrief's USMTF ATO export (0078)
docs/adr/                                 the reasoning behind every decision below
docs/efsp-usage-guide.md                  how a controller actually drives it
docs/parallel/                            the lanes: decisions.md (the record), briefings, research
docs/wip/                                 each wave-1 lane's notes (folded into this file and the guide)
crc-desktop/e2e/                          Playwright specs — the bugs the DOM stub cannot see
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

**The Strip layout, conformance and STCA, and what the wire may say** (`0055`–`0059`). See §4's
notes on them.

**In-game Zulu is the one clock (F1, `0079`).** crc-sync owns a `MissionClock` whose `now()` is the
DCS mission time as Zulu. Every EFSP time gate, the Strip clock, vul windows, MTR times and metrics
buckets take it **by injection**, never `Date.now()` (H11). The theater's local offset comes from
`config/theaters.json` (Syria Z+3), not a controller setting.

**Wave 1 of the parallel lanes** (`0061`–`0067`, `0078`, `0084`). See §3I.

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
  than a fire-and-forget alert. At the time that was deliberately *not* the obligation-alert shape,
  which could not retract; since `0067` obligations use this shape too (§3I).
- Match on the **raw** track callsign, display the **resolved** one. Matching on `resolveCallsign`'s
  output would make the callsign rung a laundered restatement of the beacon rung, and would let any
  client re-correlate flights by editing `config/squawk-map.json` (`0046`).
- `identity.beaconObserved` is finally written, so §3.10.2 rule 1's assigned-vs-observed three-case
  render has data behind it and **D22** is testable.
- The rate is reported — one line in the panel header, and a throttled warn below 95% — and is
  **null, never 1.0, on an empty board**, so the acceptance gate cannot pass vacuously.

## 3D. The sortie suites, and what they found

**The scenario files** under `crc-sync/tests/efsp-scenario*.test.mjs`, sharing a harness in
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
| **The expand toggle did nothing on screen** — `_reconcileRackStrips` decided whether to rebuild an element from `rev` and selection only, and expansion is client-local state that moves neither, so the reconciler reused every element unchanged. The first test written for it asserted the `data-expanded` stamp rather than the rule, and passed with the fix reverted | `0055` |
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

- **Both new Blocks are on all three ATC Roles, and neither was on MISSION.** (**Amended by H55,
  `0069`: `3G` is now also on `MISSION`**, appended as `MISSION_BLOCK_MAP`'s last row, because a pilot
  reports hung ordnance to whoever they talk to; it is still the same FDR field, so one fact with a
  second surface. `3F` stays off.) `0051`'s lesson
  applied rather than remembered. MISSION is left out deliberately: it shares its `fdrId` with the
  ATC Strip it is TOFI-linked to, so a Block there would be a *second place* to declare one
  aircraft's ordnance — `0045`'s "two answers to one question" again.
- **`hookRequired` is a bare boolean and that is exactly why it has a dedicated setter.** "Hook"
  alone does not say *has one* or *requires one*, and only the second gates an arrival on rigged
  gear. `setMilitary()` is `setTofi`'s shape, structurally excluded from `WRITABLE_PATHS`; it
  **refuses an unknown key rather than merging it**, because §12's deferred fields sit in the same
  object and "not writable yet" has to fail loudly.
- **The deferred half is present, unpopulated, and has no write path at all** — `altrvRef`,
  `arInfo`, `scl`, `fuelState`, `releaseAuthority`. `mtr` got its write path with L2's `9G-*`/`9H-*`
  Blocks (§3I). `alertStatus` is the one middle case: enum settled and validated, no Block yet;
  L13 gives it Block `14E`.
- **`restore()` seeds the namespace onto an FDR that predates it.** Every board that has ever run
  has `military: null` on disk; without the seed a §9.5 reader throws on exactly the flights that
  were airborne when the service restarted. The client guards the same case, because nothing
  reseeds an FDR already in a connected client's cache.

**`3G` `HUNG` is an advisory now (L12, `0069`) and `alertStatus` is Block `14E` (L13, `0070`)**; see
§3J.


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


## 3I. Wave 1 — what each lane left, and the traps

Each lane's full notes are in `docs/wip/<lane>.md`; what follows is what the next agent needs.

**Field state, server (L1, `0061`).** `FieldStateStore` is the **sixth store**: one record per
Facility with a `fieldState` inventory (INCIRLIK only), its own `rev`, its own sequence
(`fieldStateSeq`) and its own delta (`efsp-field-state-delta`). That last one is a deliberate
deviation from rule 5's "broadcast on the Board sequence". Every op is audited, refusals and
`STALE_REV` included, under `fieldStateFacilityId`.
- The inventory (runways as pavements with `ends`, `endHeadingsTrue`, `rackIds` per end,
  `arrestingGear`, acknowledgers, inspection authority, pads, `airportIcao`) is `DEFAULT_CONFIG`,
  read once and never written. Status, suspension, closure, inspection, requests, `activeRunway` and
  `runwayChange` are store state only. One record per pavement (`05/23`), the active **end** on the
  Facility (S-Q23).
- `field-state.js` is pure: the status machine (the absent `SUSPENDED_BARRIER_CHANGE → OPEN` edge
  *is* rule 2: only the inspection reopens), runway resolution (target rack → rack → FDR 8A/8B →
  active end → fail open, S-Q25), the inhibit wording, the into-wind end, `runwayAdvisoryFor`,
  `runwayRackFor`.
- **TWR alone closes, opens and suspends** (H18). OPS, CD, GND and APP send `RequestRunwayStatus`,
  and TWR accepts or rejects. OPS completes the works and signs off the inspection. The runway-change
  machine takes OPS/APP acknowledgements as coordination, not permission; an unmanned acknowledger
  is skipped and audited (H20); `SelfCoordinateRunwayChange` is the solo case (S-Q24).
- `nla.js` reads `ctx.fieldStateFor()`, default null, failing open. `board-store.js` threads it
  through `_nlaCtx`, judges a drag against the target rack, files Strips by runway through
  `_placementRack` (fixing "NLA always queues to `rwy-05`"), and refuses a `SetState` into a
  runway-using state on an unusable runway (S-R2-14). `FINAL → LANDED` is never inhibited (H19).
- **The suspension kind is `BARRIER_CHANGE` today, and H52 makes it generic "runway works +
  inspection".** L1b renames the kind and labels. Gear is data only (H17: DCS has no wires): no
  `SetGearState`, Incirlik ships `arrestingGear: []`.
- The active runway comes from the mission wind once per mission (`server.js`'s `mission-load`
  hunk, compared against each end's **true** heading, H22). That hunk calls the private
  `WsHub._broadcast`; L1b adds a public `broadcastEfspFieldStateDelta` and switches it.
- Traps: never add field-state kinds to `OP_KINDS`; the session binding is per-Facility, not
  "Primary somewhere"; `missionKeyOf` stays in `field-state.js` until F3 hoists it.

**MTR fields (L2, `0062`).** Six plain `fdr` Blocks on DEPARTURE/ARRIVAL/OVERFLIGHT, none on
MISSION: `9G-MTR`, `9G-ENTRY`, `9G-TIME` (M10) and `9H-EXIT`, `9H-TIME`, `9H-ALT` (M11), each one
leaf of `fdr.military.mtr`. `MILITARY_BLOCK_NAMESPACE` rows use either `blockId` or `blocks`, never
both and never a wildcard. `compactBlocksFor(role, positionId, fdr)`: the third argument adds the
flight's conditional MTR group, and **the face (`strip-view.js`) and ▼ (`bay-view.js`) must pass the
same FDR**, or a Block ends up on both or neither. **Times are epoch ms** (S-L2a): `zulu-time.js`
(`resolveZuluHhmm`, nearest occurrence within ±12 h of the mission clock) on the server,
`ZULU_HHMM_BLOCKS`/`formatZuluHhmm` on the client. Don't store a typed string. `.efsp-expanded-note`
is the place for an advisory that is not a warning.

**USMTF ATO parser (L3, `0063`).** `crc-sync/src/efsp/ato/ato-ingest.js`'s
`ingestAtoText(text, { referenceUtc })` turns USMTF text into mission lines, **creates nothing** (no
FDR, Strip or code) and never throws. Pass `missionClock.now()`, never `Date.now()`. Each line is
`{ lineId, sourceLines, provenance, fdrSeed, military, extras: { ato, identityAto }, warnings }`
(S-Q50, S-R2-8): `fdrSeed` holds only what `createFdr` accepts; the normalised callsign,
`seedable`, `missingAcceptanceFields` and the mission number live in `extras.ato`. The ATO's Mode 3
is reported in `extras.identityAto.modeThree` and never seeded as a beacon. `ATO_FIELD_TARGETS`
names the FDR path of every ATO value and whether anything can write it today (most can't: Mode
1/2, SCL, `arInfo`, datalink are L14's). USMTF is the only input (H1). The set layouts come from a
community wiki, cross-checked in `docs/parallel/research/usmtf-ato.md`; none is doctrine.
Agency types live in one table (`ato-sets.js`, H45/H54: `OTR` + callsign until answered).

**Carrier model (L4, `0064`).** `crc-sync/src/efsp/carrier/`, pure: the Marshal stack index drives
angels, DME and push time; Case as a value; the ship banner; `fdr.military.carrier`; the transfers
table. **Not wired: no Facility, Roles or client** (that is L17, wave 3). Hull CVN-72 `UNION`
(H13/H26). Every bearing is held **true**; grid convergence and magnetic variation are injected (F2
supplies both), and a value is labelled `G`/`T` when one is missing, never shown as magnetic.
Marshal radial defaults to final bearing + 180 and is settable (H27); no automatic compression
(H28); an insertion ripple stops at the first vacancy; `lowStateLb` is not M17.

**Metrics, traffic count, log retention (L5, `0065`).** Server only. `GET /api/efsp/metrics`
(`?hours`, `?missionSession`) and `GET /api/efsp/traffic-count` (`facilityId`, `from`, `to`,
`detail`, `missionSession`), both authenticated, neither naming a controller (H35). The contract
for L15 is `tests/efsp-metrics-contract.test.mjs`, and it differs from L5's briefing (list in
`docs/wip/L5.md`). The tap (`createEfspInstrumentation`) wraps `efsp.handleMessage` from
`server.js` and logs every refused `efsp-mutation` plus `NOT_HOLDING_POSITION` on any mutation
type (S-R2-5). The server stamps client metric events on receipt (S-R2-3). Retention and home
airports: `config/efsp-instrumentation.json`. Log rotation uses the **wall** clock (a storage
lifetime), everything a controller reads uses the mission clock. `EfspMetrics._mission()` is a seam
F3 replaces with `mission-session.js`.
- `positionStore.observersOf()` returns `{controllerId, controllerName, since}` records, not ids.
- `airspace-store.apply()` returns STALE_REV and NOT_FOUND before `_recordAudit`, so those refusals
  are not logged (L26's).
- Nearly every DEPARTURE NLA is transfer-shaped; the only non-transfer NLA is the terminal Drop.

**Soak harness (L6, no ADR).** `crc-sync/tools/soak/`: a discrete-event driver on a virtual clock
running the real `createEfsp` and `WsHub` with fake sockets, a shadow replica per client, a ledger
reconciling acks, broadcasts and the Mutation log. `npm run soak:selfcheck` (~40 s, proves every
detector fires), `npm run soak:smoke`, `npm run soak -- --minutes 240 --seed 1`, profiles
`realistic|stress|smoke` (H46, S-R2-6). None is in `npm test`. The literal four-hour run is the
manual workflow `crc-sync-soak.yml` and **has not been run**: the human runs it once before WP8 is
declared done. **The soak fails, with evidence**: no lost Mutations, but F1 (rebalance side
effects never broadcast) and F2 (resync across a restart) fail, and retention drives memory (F3).
Owners in §4. Run `soak:selfcheck` after touching `board-store.js`, `efsp-ws.js` or `ws-hub.js`;
after a new mutation type, add it to `driver.js`'s cmid list and `_checkBroadcast`.

**Obligations retract (L7, `0067`).** Forwarding obligations are state now, sent whole in
`efsp-alerts` (the `0058` shape) and recomputed after every broadcasting EFSP message
(`WsHub.setOnEfspChange`). `efsp-obligation-alert` is gone. **One compose function,
`broadcastEfspAlerts()` in `server.js`, builds the message** and a test counts that there is exactly
one call; add anything new inside it, never a second call. Keys are
`facilityId:stripId:obligationType`. `recordMet()` has callers now: `met` is non-zero only for
`ADVANCE_FORWARDING` and `VOID_TIME_EXPIRED` (VOID met = moved past HELD), `missed` counts raised
episodes. `DATA_ONLY_VERIFICATION` still has no "verified" action and stays raised.

**Test debt and the tactical walks (L8, no ADR).** The DOM stubs migrated to
`crc-desktop/tests/helpers/dom-stub.js` (three users now; `coverage-panel.test.js` still holds one
hand-written copy), the regex scrapes replaced by vm reads (`vm.runInContext('NAME', ctx)`, then
copy out of the context's realm before `assert.deepEqual`). `efsp-scenario-tactical.test.mjs` walks
AIC and JTAC end to end and pins **B1–B7 as `todo` tests** (§4). The AIC workflow as enforced (H2):
TAC_C2 transfers an ON_STATION line to `aic-on-station`; AIC annotates and moves it between On
Station and Committed, never advances it, and hands it back.

**`[SOURCE-DEFINED]` inventory (L9, report only).** `docs/wip/L9-source-defined-inventory.md`:
121 findings, 5 S1 (UI or guide text presenting a SOURCE choice as doctrine), none GAP-VIOLATED. L20
applies it in wave 4, with everything later lanes add; H61/H62 answered E1–E4/E8, E5/E6/E9 are
process rulings (S-L9).

**IFF from interrogation (L10, `0066`; `0084`).** `iff.js`'s `classifyIff({declared, datalink,
mode4, mode3})` is the one place a colour is chosen, per session, and takes no track. Automatic IFF
never gives bandit/hostile (H3). `Transponders#mode4Of(track)` models a valid Mode 4/5 reply: own
coalition **and** Mode 4 on (coalition models the crypto key, H3; H42 makes `CRCSYNC_COALITION`
one-per-server and legal to read). Own AI and ships answer Mode 4, ground vehicles nothing (H4); an
own player with no SRS is a bogey (H7). Radars carry `caps.mode4`; **`0084` gives airport,
approach and carrier-approach radars `mode4: true`** (H53: the squadron's fields and carrier are
military), overridable per type in `sensor-specs.json`. `describe()` returns `{who, transponder,
mode4, iffOverride}`, no `iffState`. **There is no `invisible` state**: nothing on the ground is
hidden (H6). Formation and navpoint declutter are off by default and switched off once on existing
installs (`declutterOffH6`, `navDeclutterOffH70`), code paths left for the revisit at the end of
the EFSP work.

**atobrief USMTF export (L11, `0078`).** `atobrief/public/js/usmtf-ato.js` (renderer and mapper,
browser and Node), EXPORT → USMTF, `GET /api/rooms/:id/ato.usmtf`, stateless `POST /api/usmtf`, and
editor UI for every H43 field. Classification always `UNCLAS` (H44). Auth is `ATOBRIEF_USMTF_TOKEN`
(now in `.env.example` and compose) or a role-bearing JWT, an unsigned decode like its siblings
(forgeable; recorded in `0078`). Fixtures: `atobrief/test/fixtures/usmtf/ojw1v5-export.txt` (the
trimmed, anonymised real package) and `research-render.txt`. `docs/atobrief/yaml-format.md` has the
field reference. atobrief must not hand out `6xxx` Mode 3 codes (crc-sync's AI block).

**gRPC reconnect loop (LG, bugfix).** `StreamUnits({poll_rate:0})` made DCS-gRPC panic after every
full sync, so the unit stream reconnected ~5,000 times a session. Now `poll_rate = max(1,
DCS_GRPC_POLL_RATE)`, `max_backoff` 5 s, a 5 s unit keep-alive cache (a healthy stream sends only
changed units, and the 12 s reaper would otherwise drop parked aircraft), and jittered exponential
backoff that resets after 5 s of uptime. **It still needs the human's 10-minute live check**
against real DCS (`docs/wip/LG.md` lists the four things to watch).

**One briefing correction from L6 (F14).** An `OVERFLIGHT` can never propose coordination:
`coordination.js:65` allows proposals only from ARRIVAL/INBOUND and DEPARTURE/HANDED_OFF. H63 moves
OVERFLIGHT to the guide's own four-state lifecycle (L28), which is where that gets settled.

## 3J. Waves 2 and 3 — what each lane left, and the traps

Same convention as §3I: full notes are in `docs/wip/<lane>.md`. Folded here: L1b, L12, L13, L14,
L15, L16, L22, L24, L27, F2, F3, F4, L23, L26, U6 and the client half of L18. Not yet folded: UI-A,
L17, L19 and the E2E notes.

**Field state, client (L1b, `0068`).** Three files: `field-state-rules.js` (the pure mirror of the
server rules: `fieldStateActionsFor` offers a button only for what Tower or OPS would accept,
`gearMismatchFor`, `fieldStateAlertsFor`, `fieldStateSignatureFor`), `field-state-panel.js` (the dock
panel, closed by default, left cluster) and the state getters `getEfspFieldState(facilityId)` /
`getAllEfspFieldStates()` in `efsp-state.js`, which are the contract for any other chip. The H52 rename
is done (`SUSPENDED_WORKS`, `WORKS`, `BeginRunwayWorks`, `CompleteRunwayWorks`, a request carries
`action: 'WORKS'`) and `WsHub.broadcastEfspFieldStateDelta` is public (S-L1d).
- **A chip that depends on anything other than the Strip, its FDR or the stores already in
  `bay-view.js`'s `_stripRenderSignature` must add itself to that signature**, or the Strip never
  rebuilds for it (the NLA board delta lands before the field-state delta). L1b's was one guarded line
  (S-L1b2) calling `fieldStateSignatureFor`.
- `field-state-drift.test`-style coverage: `tests/efsp-field-state-client.test.js` replays every
  button the client offers against a real `FieldStateStore`. Keep it when adding an op.
- The client derives the runway-change acknowledgers and the inspection authority from the permission
  table's owners (OPS/APP, OPS) because the record did not carry them. **L26 now puts
  `runwayChangeAcknowledgers` and `inspectionAuthorityPositionId` on the record, and the client does
  not read them yet** (open, §4). They agree for Incirlik, so nothing is wrong today.
- Traps: dockview detaches the inactive tab of a group, and a panel that looks its DOM up with
  `document.getElementById` while detached fails. This is a standing bug in `efsp-panel.js`'s
  `_renderArrivalsLine` (a new arrivals line is inserted on every render while the Strip panel is
  behind another tab) and `srs-radio.js`'s `_renderSlots` (throws on every poll once RADIO is closed).
  New panels must cache their elements (the airspace-panel rule).
- Walks not done: a 3F divert onto DOWN gear (no gear exists; the HOOK chip is proved by fixtures and a
  rendered-Strip test), a crc-sync restart mid-suspension (a page reload was walked), the wind-derived
  active end (no DCS in the harness), two physical screens.

**Hung ordnance (L12, `0069`).** `hungOrdnanceAdvisoryFor(strip, fdr, wireRecord)` in
`field-state.js` (pure; the wire record is its own inventory, `buildStatusView(record, record)`) and a
client mirror `panels/efsp/ordnance-advisory.js`, held together by the drift test in
`tests/efsp-ordnance-client.test.js`: **change both together**. It is a chip plus one reason line,
never an inhibit, and it deliberately recommends no runway (the pad is a placeholder name, H21). It
reads field state through `getEfspFieldState(strip.facilityId)` and expects `null` for CENTER/TACTICAL.
H55 put `3G` on `MISSION` and S-L12 settled the faces: always on TWR's, on APP/CTR/mission lines only
when not CLEAN (`ORDNANCE_WHEN_SET`, `isOrdnanceSet` in `strip-fields.js`), always in ▼.
- The advisory function has the three hook lines in `strip-view.js`, byte-identical to L1b's and
  L13's (S-W2A); `ord` sits before `scram` in `INDICATOR_ORDER`.
- Walks not done: HOOK + HUNG together (needs configured gear, which does not exist), the pad name
  with real client state is covered by L1b's merge (the Playwright spec's `standInFieldState` is now
  redundant and should be deleted), pad occupancy is not read (Q3), no hint in the 8A/8B editor (Q6).

**Alert and scramble (L13, `0070`).** `alert-scramble.js` is the rule module (server, pure:
`activeScrambles`, `conflictingGroundStrips`, `GROUND_STATES`, `accessRouteText`); the client mirror
is `panels/efsp/scramble.js` (`scrambleAlertsFor(strip)`, `alertPadConstraintFor(facilityId)`), held to
it by a drift test, and `#efsp-scramble-line` in `index.html` is the red line. The state is
`fdr.military.alertStatus`, written only by a controller's `SetBlock` on Block `14E` (`M16`,
DEPARTURE) or by the ATO import (`NONE`/`ALERT` only, L14). Nothing is derived into storage, so
nothing needs resetting. `nla.js` never reads it (a test holds that). The access route is
`fieldState.pads.alert.accessRoute` in `facility-config.js`, shipped as the placeholder
`ALERT ACCESS TAXIWAY` ([SOURCE-DEFINED], L20).
- **H56 is a `permission.js` rule, not an ownership accident**: `NON_OWNER_BLOCK_WRITES` lets OPS
  write `14E` on a DEPARTURE until DROPPED, whoever owns it (L23 added it, S-L13).
- `traffic-count.js` latches `alertScramble` from the logged `SetBlock`, so a scramble cancelled on
  the ground **no longer counts** as one (L26 changed the classification).
- Walks not done: no two-browser walk (one controller holding OPS/CD/GND/TWR stood in).
  `scrambleAlertsFor` rescans the live Strips once per rendered Strip (O(n²) per render); fine at
  squadron scale, cache it per render if Boards grow.

**The ATO on the Board (L14, `0071`).** `crc-sync/src/efsp/ato/ato-board.js` (preview, bind
candidates, plan, tasking, AR links, execution, the H68 whole-day date shift), `ato/callsign-fit.js`
(H60: every vowel, leading one included, back to front; unfittable returns `null`, which differs from
miztoyaml on that one edge), `efsp-ato-preview` / `efsp-ato-mutation` on the wire, and on the client
`ato-import.js`, `ato-strip.js` and the OPS "file against ATO mission" picker in `efsp-panel.js`.
- **The ATO's values live on the FDR through one setter, `fdrStore.applyAtoTasking`**, never through
  `WRITABLE_PATHS`/`setField`: that would reopen D24 and mark ATO values as controller-typed. It may
  write only `scl`, `arInfo` and `alertStatus` (`NONE`/`ALERT`) under `military`.
- Bind preselection is narrowed: a unique Mode 3 match is preselected only if the callsign agrees;
  otherwise it is offered with `MODE3_HELD_BY_OTHER`. UPDATE matches on the line id
  (`<missionNumber>#<n>`) of a flight with a live MISSION Strip on TACTICAL. A re-import bumps `rev` on
  unchanged flights (the `atoRef` changes): harmless.
- **Trap: cross-Strip render state must be in the Strip's signature** (`bay-view.js`, the `ar:` part).
  The AR highlight was invisible in the browser while every unit test passed. Same rule as L1b's.
- `_handleAtoMutation` logs its own refusals except `NOT_HOLDING_POSITION`, so L5's tap never logs one
  twice.
- Not built or not walked: the coordination-instrument capture for a Mode 3 conflict (Q-L14-9, only a
  warning exists); the pilot requests by hand against a live DCS clock (the e2e runs on the wall-clock
  fallback); a second controller watching the AR highlight; the duplicate `MODE3_SYNTHETIC` +
  `MODE3_NOT_ADOPTED` warning pair is cosmetic. atobrief handing out colliding Mode 3 codes now shows as
  duplicate warnings on the Board (H64). M6/M7 display waited for L16 (done, below).

**The METRICS panel and the client measurements (L15, `0072`).** `panels/metrics-panel.js` is the
panel; `panels/efsp/efsp-metrics-client.js` collects the browser-side measurements and flushes them
(after 10 s, at 20 events or on `beforeunload`; queue capped at 500, oldest dropped, an event older
than 5 min dropped unsent). SEARCH is counted from `_runEfspSearch`, TIME_TO_FIND from a Bay becoming
visible to the first Strip selected in it (hide detection is a 1 s poll of `efspVisibleBayId()`),
GESTURE from the static `GESTURE_INPUT_COST` table. `app/server.js` proxies the two read endpoints.
The wire shape is unchanged from L5's contract (`efsp-metrics-contract.test.mjs`). Facts the panel
depends on: `searchInvocations.byPosition[P]` has per-hour buckets and no top-level `byHour`;
`rejectedMutations.mutations` counts every Mutation and `total` the refused ones; `reconciliation` can
be `null`. `_dispatchGesture` now returns the acting Position (truthy only on dispatch).
- **Decision for the supervisor, open:** HIGHLIGHT and OFFSET each cost 2 inputs, over §7.3's ceiling
  of 1. Either accept 2 or give both a one-input entry point (a key or a direct control, plus a
  `GESTURE_INPUT_COST` row).
- Staleness shows `not instrumented (L19)` until L19 declares `sources.staleness`. A trend `↑` is not
  coloured (an observation, not a threshold failure); the supervisor may want it coloured.
- Not walked: a real hour of controlling with the panel open against DCS (trend over real hours, real
  manning, correlation rate, a real traffic count, a mission reload creating a second session in the
  selector); Electron (the e2e drives Chromium); `tests/metrics-panel.test.js` and `e2e/l15-metrics.spec.js`
  were not re-run against F3's merge by the lane.
- Flaky under load, not L15's: `grpc-client-stream.test.mjs` "a stream that stayed up resets the
  backoff" and several `e2e/l1-popovers.spec.js` tests at the 20 s budget.

## 4. What's left, and the known bugs

**Not built, in the guide's order.** WP6: the field-state panel and the hook-mismatch check (L1b),
the `HUNG` advisory (§9.5, L12), alert/scramble (§9.6, L13). WP7: the ATO import into the Board and
the AR join (L14). WP7A: the carrier Positions, Roles and Facility (L17), Incirlik's RSU/SFA/PAR
(L18). WP8: the metrics dashboard (L15), the §10.3 suggestion chip and §10.4 staleness (L19). Then
the `[SOURCE-DEFINED]` audit fixes (L20), which is a WP6 acceptance criterion in its own right.

**Known bugs, each with its owner.** Line numbers are in the wip notes named.

| Bug | Severity | Owner | Source |
|---|---|---|---|
| **B1** A JTAC handed a mission line can never hand it back (JTAC's grant is empty; TAC_C2 gets `NOT_OWNER`) | stranding | L23 | `docs/wip/L8.md` |
| **B2** TOFI EXIT cannot be answered while AIC holds the line; TAC_C2 gets `NOT_OWNER` with no detail. Fix (ii): TAC_C2 answers it | safety-critical | L23 | L8 |
| **B3** A covering reassignment or routed `TransferStrip` moves the owner but not the Bay (AIC→TAC_C2, and GND→TWR at Incirlik) | stranding | L23 | L8 |
| **B4** `TransferStrip` accepts a Bay that isn't the receiving Position's | data integrity | L23 | L8 |
| **B5** A JTAC can bind a contact and declare MARSA | doctrinal | L23 | L8, H40 |
| **B6** A JTAC session is sent every Strip on every Board. Per-session read filter, ADR `0080` (connect snapshot, resync and deltas) | doctrinal | L23 | L8, H40, H59 |
| **B7** AIC advances a line with the `SetState` escape hatch, and leaves it in a Bay that contradicts its state | doctrinal | L23 (with `SetState` owner-checking) | L8, H2 |
| **L6 F10** A covering Position is handed Strips it may not advance (CD Strips at GND), and retaking CD doesn't return them | medium | L23 | `docs/wip/L6.md` |
| **L6 F1** A rebalance changes other Strips' `orderKey`/`rev` and broadcasts only the moved Strip; clients stay stale up to 22 min and a resync cannot heal it | high | L27 | L6 |
| **L6 F2** `efsp-resync` after a crc-sync restart serves a delta from the new lifetime as if continuous (needs a Board epoch). Latent: the shipped client never sends a resync | high | L27 | L6 |
| **L6 F5** A crash between the audit line and `persist()`: a retried CreateStrip applies twice, or one change gets two audit lines | medium | L27 | L6 |
| **L6 F6** Lowest-free code reuse binds a new flight to the previous flight's still-airborne aircraft (`code-allocator.js`) | high for correlation | L27 | L6 |
| **L6 F11** Replaying a refused Mutation returns the older cached Strip, and the client's replica goes backwards | low | L27 | L6 |
| **L6 F13** Correlation, airspace and MARSA ops are not idempotent by `clientMutationId` | low | L27 | L6 |
| **L6 F8** Order keys grow without bound under same-slot inserts; only the exhaustion throw rebalances | low | L27 | L6, handoff |
| **L6 F3** Retained DROPPED Strips and FDRs drive heap, snapshot size and latency (H36) | expected | L24 | L6 |
| **L6 F4** `_appliedMutations` holds live Strip/FDR references, so archiving alone frees nothing still in the last 5000 results | medium | L24 | L6 |
| **L6 F7** `_nlaHistory` keeps NLA-dropped Strips | small | L24 | L6 |
| Peer replica writes (`receive*`, TOFI receive) are not logged | audit gap | L26 | `docs/wip/L5.md` |
| Log entries carry no `facilityId` or FDR, so a backfill can't recover the Facility once a Strip is archived | audit gap | L26 | L5 |
| **L6 F12** Airspace audit lines carry no `clientMutationId` (`efsp-ws.js` doesn't pass it); check correlation/MARSA too | audit gap | L26 | L5, L6 |
| Airspace STALE_REV/NOT_FOUND, class-based PERMISSION_DENIED and "no store" refusals are not logged | audit gap | L26 | L5 |
| An MTR (any plain `fdr` Block) amendment overwrites: no history, no `op.value` in the log | known gap | later slice (H25) | `docs/wip/L2.md` |
| Changing only the MTR designator leaves the old exit fix with no warning | low | L16, with the route table (H23) | L2 |
| Typed time Blocks `6`, `14`, `14B`–`14D`, `16`–`18`, `M6`/`M7` store the raw string where epoch ms is expected | correctness | F4 (storage), L16 (display) | L2, S-R2-17 |
| `marsa-store.js:37–41` still says obligations cannot retract; ADR `0042` names `radar-specs.json` (it is `sensor-specs.json`); `correlation-reconciler.js:50–52` claims a test forces an eligibility decision it doesn't | stale text | L20 | L4, S-L7 |
| `NOT_OWNER` acks carry no detail, so B1/B2's controller is told nothing | ergonomics | L23 (O4) | L8 |
| `_cidSeq` passes 999 after ~3 h at stress rate | low | unowned | L6 F9 |

**Human actions outstanding.** The LG 10-minute live check; one run of the four-hour soak workflow;
the H8 read of the product ADRs is done for wave 1. **Integrator actions outstanding:** the L3↔L11
cross-test (a crc-sync test parsing `ojw1v5-export.txt` and `research-render.txt` against research
§3's oracle, S-R2-7) has not been written; the Playwright re-run (§1).

**Deferred with reasons, not forgotten:**

- **`release-envelope.js`'s `radiusNm`** (`0047`). A position is obtainable now; it stays unmatched
  because a radius envelope makes a *release* depend on correlation, so a DCS re-ID would silently
  withdraw one mid-taxi. Belongs in a release-model slice.
- **`trackDegradationFlag` automation** is **refused**, not deferred (`0047`): DCS emits no
  track-quality signal, and synthesising one from correlation state is D11 *and* would force verbal
  coordination on every mission reload.
- **Declutter** (formation, navpoint, ground clutter) stays off until the very end of the EFSP work
  (H6, H70). The navpoint declutter is reworked once AIRAC data lands.
- **An audited override** for clearing an emergency onto a suspended runway (H19 candidate, not
  built): today the Strip waits.

**Smaller, known, non-blocking:**

- `sourcedcs-web`'s `store.js` writes its JSON with a plain `fs.writeFileSync` — no tmp-and-rename —
  so it has the non-atomic-write problem `0041` fixed in crc-sync's `_persist`.
- Airspace ops are not replayed on reconnect, unlike Strip mutations. Deliberate and tested
  (`efsp-scenario-manning.test.mjs`); correlation is the same.
- The D12 audit `0020` asked for is structural in `permission.js` and tested server-side, but has
  never been walked against the rendered UI for a controller holding `TAC_C2` and `CTR` at once.
  L8 lists the client walks for AIC/JTAC that nobody has done.
- `positionRadars`' shipped defaults are SOURCE's model of which scope sits at which console (H61
  keeps them, labelled as such). The real assignment is squadron data.
- **Stereo routes have never run against real routes** (`0050`). The table ships empty on purpose.
  Block `9F` becoming a picker is L16's.
- Incirlik's shipped field data (true headings 056/236, acknowledgers, pad names) is
  `[SOURCE-DEFINED]` and approximate; L20's list.
- **The Strip layout (`0056`)** was checked by eye in Playwright screenshots; the all-lit worst
  cases from the mockup have not been walked live with two controllers yet. Indicators appear only
  when something is wrong (`0058`).
- **Assigned `ALT`/`HDG` live on the FDR (`fdr.clearance`, `0058`)**, not on the Strip. Writing one
  bumps `clearanceUpdatedAt`, never `updatedAt`. Open: filed-route conformance, and terrain/MSAW
  once AIRAC data exists. Headings become magnetic everywhere with F2 (H15, H69).
- **What a client is told about a contact is decided in one place (`0059`)**: server
  `surveillance/presentation.js`, client `track-label.js`. The wire carries no DCS truth.
  `presentation.test.mjs` plus `ws-hub-wire-strictness.test.mjs` hold the line.

## 5. Where to start: wave 2

The plan is `docs/efsp-parallel-plan.md` §3–§4, the per-lane briefings are in
`docs/parallel/wave2/`, and `docs/parallel/decisions.md` (S-W3a–c) is what is actually dispatched.
Each lane works in its own worktree `/home/nklx/dev/personal/sourcedcs-<lane>` on
`lane/<lane>-…`, reads `docs/parallel/lane-rules.md`, and leaves `docs/wip/<lane>.md` for the next
fold.

**Fixes between waves, running now:**

- **F2 — magnetic** (ADR `0085`): `crc-sync/src/magnetic.js` (`variationAt`, `convergenceAt`) from
  the World Magnetic Model by position and mission date, with a per-theater override in
  `theaters.json` (H69), carried on `game-time`. `hdgCorrection` and its APRT field go; typed
  magnetic inputs are converted on the server. Also Syria's transition altitude, 10,000 ft (H62).
  Until F2 merges, wave-2 lanes that show a heading call `toMagneticDisplay(trueDeg)` and never
  apply `hdgCorrection` themselves (S-W3c).
- **F3 — mission session** (ADR `0086`): one `mission-session.js` under `state/`, a new session on
  `mission_start`, a changed mission fingerprint, or the clock stepping back more than 5 min
  (S-R2-2). It hoists L1's `missionKeyOf` and replaces L5's `_mission()` seam.
- **F4 — typed time Blocks** (bugfix): `setField` runs `resolveZuluHhmm` on every `…TimeUtc` path,
  plus a scenario test that a typed void time expires (S-R2-17).

**Wave-2 lanes** (ADR, e2e lane):

| Lane | What | ADR | Starts |
|---|---|---|---|
| L1b | field-state dock panel, inhibit reason on the Strip, hook mismatch (only when gear is configured, H57), the H52 "runway works" rename, public `broadcastEfspFieldStateDelta` | 0068 | now |
| L12 | ordnance `HUNG` advisory; any Position the pilot talks to records it (H55) | 0069 | now |
| L13 | alert/scramble: Block `14E` on DEPARTURE for M16, OPS sets it, every ground Position shows it (H56); no inhibit, no reordering | 0070 | now |
| L14 | ATO into the Board: paste/drop only, one active ATO (H65), callsigns cut to 7 (H60), the mission's date (H68), adopt the ATO squawk if the allocator accepts it (H64), the AR join | 0071 | now; merges after L16 |
| L15 | metrics dashboard and client-side measurements; per-Position numbers behind a toggle (H66) | 0072 | now |
| L16 | Block `9F` picker, §10.5 fallback chains, estimated times italic with source on hover (H67) | 0073 | after F4 |
| L22 | ATC scope in the STARS scheme (H41, H47–H50) | 0088 | mockup first (H49) |
| L23 | tactical Positions: B1–B7, F10 | 0080 | after L27 |
| L24 | archiving finished flights (H36, S-R2-13), F3/F4/F7 | 0082 | after F3 |
| L25 | miztoyaml: tankers/AWACS as missions, TACAN, datalink (S-R2-10) | 0089 | now |
| L26 | audit completeness (S-L5's gaps, F12) | 0083 | after its briefing |
| L27 | Board sync correctness: F1, F2, F5, F6, F11, F13, order-key growth | 0081 | after its briefing; before L23 |
| L28 | OVERFLIGHT's four-state lifecycle (H63) | 0087 | after its briefing |

Wave 3 (L17 carrier, L18 RSU/SFA/PAR, L19 suggestion chip and staleness) and wave 4 (L20
`[SOURCE-DEFINED]` fixes) follow as the plan says.

**The integrator, after every wave:** merge in order, run both unit suites and the full Playwright
suite, restart the local crc-sync, fold `docs/wip/*.md` into the guide and this file, and walk the
sorties and pilot requests by hand.

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
- **Check the pixels in Playwright.** The reachability tests prove the wiring, not the pixels.
  `crc-desktop/e2e/` drives the real panel against a real crc-sync; `E2E_LANE=N` (0–9) moves the
  ports, the temp state and `test-results/`, so parallel agents never share one. L2's MTR pilot walk
  (`docs/wip/L2/`) is the model: a spec per walk, screenshots, verbatim notes.
- **Every time a controller reads comes from the injected mission clock** (H11, `0079`): in-game
  Zulu, dated by the mission. `Date.now()` is only for storage lifetimes (log rotation) and
  wall-clock mechanics. A typed HHMM goes through `zulu-time.js`, and is stored as epoch ms.
- **Headings are magnetic, always** (H15, H69). Hold true internally, convert at display with the
  per-theater variation. Never a manual correction setting.
- **Tuning files are read once at startup and never written by code** (P5): `alerting.json`,
  `sensor-specs.json`, `efsp-instrumentation.json`, the facility config. A change applies on
  restart only.
- **Theater-specific values go in per-theater tables** (`config/theaters.json`), never hardcoded to
  Syria (H13). Every theater is coming.
- **Stop only processes you started, by PID** (P7). A `pkill -f "node server.js"` in wave 1 killed
  the human's live crc-sync on :3000, which belongs to the human and is never touched by an agent.
- **No backwards compatibility.** It is alpha: a changed wire message replaces the old one outright
  (`efsp-obligation-alert` went in `0067` with no shim), and a changed default is switched once on
  existing installs rather than migrated forever (`declutterOffH6`).
