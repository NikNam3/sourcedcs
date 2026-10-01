# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of `EFSPImplementationGuide.md`
your work names, then write a plan before writing code. This is a handoff, not a build order.

**This revision supersedes the previous one.** The remaining EFSP work is being finished by many
agents at once, in waves of parallel lanes (`docs/efsp-parallel-plan.md`). **Waves 1 and 2 and most of
wave 3 are merged**, the last of them on the dry-run integration branch `integ/wave3-dry` (§1). Wave 1
(§3I) landed field state (server), MTR fields, the USMTF ATO parser, the carrier model, WP8 metrics and
the soak harness, retracting obligation alerts, IFF from interrogation, atobrief's USMTF export and the
gRPC reconnect fix. Wave 2 and the fixes between waves (§3J) landed the field-state panel, hung
ordnance, alert/scramble, the ATO on the Board and the AR join, the METRICS panel, the `9F` picker and
the time fallback chains, the STARS scope, magnetic headings, mission sessions, archiving, Board sync
correctness, the tactical Positions' fixes, audit completeness and block altitudes. Wave 3 (§3J) added
the carrier Positions and Facility (L17), the suggestion chip and staleness (L19), the UI follow-up
(UI-A), the per-theater transition altitude (TA), the client-mirror parity tests (PARITY), the soak
fixes (SOAK) and the infra hygiene lane (HYG); the client half of Incirlik's pattern board and FINAL
component (L18) was already in. **Built but not on that branch:** L18's server half (RSU/SFA/PAR,
`lane/L18-server`, ADR `0093`) and SOAKW (the soak's not-judged memory rule,
`lane/SOAKW-warmup-default`). **Not started:** L28 (OVERFLIGHT lifecycle), UI-B (resync wiring and the
follow-ups listed in §4), L20 (the `[SOURCE-DEFINED]` sweep, §5). The known bugs each have an owning
lane (§4).

If you are a lane agent, your own briefing in `docs/parallel/wave2/` and
`docs/parallel/lane-rules.md` come first, and **`docs/parallel/decisions.md` overrides both**. If you
are the supervising session, start at `docs/parallel/supervisor-handoff.md`.

## 1. State of the tree

Integration branch `efsp-wp5-correlation`, merged through `c12cd7c` (wave 3a: L26, U6 and L18's client
half). **The dry-run branch `integ/wave3-dry` (worktree `../sourcedcs-INTEG`) sits on top of it** and
carries, in merge order, GRPC, SOAK, DOCFOLD, TA, HYG, PARITY, L17, L19 and UI-A (`0935ee5`); the real
`efsp-wp5-correlation` waits for the human's go. Neither is pushed. **Not on `integ/wave3-dry`:** L18's
server half (`lane/L18-server`, `395c0f7`, built on L17 plus L18's client half, so it merges after L17 and
PARITY, and PARITY's tests are to be re-run then), SOAKW (`lane/SOAKW-warmup-default`, `ac3eb39`, merges
after SOAK), and the DOCS2 lane's doc fixes (this file and the guide). L28 and L20 have not started; UI-B
has not merged.

Green, last recorded per lane (no integrated run is recorded for `integ/wave3-dry`: the unit suites
have to be re-run unloaded at the real merge, S-U6): **crc-sync** 1887 (L17), 1884 (TA), 1878 (PARITY), 1873 (L19), 1879 (SOAKW, with the soak fixes), 1922 on `lane/L18-server`; **crc-desktop** 736
(L17), 737 (TA), 764 with one todo (PARITY), 771 on `lane/L18-server`; atobrief 77; Python
`tools/tests` 360 (L25). (`npm test` in each; the one crc-desktop failure a fresh worktree shows is
the packaging test's missing `app/node_modules`: run `npm ci` inside `crc-desktop/app`.)
**Playwright:** the full suite has not been run on the integrated branch. Per lane: E2E-fix left the
whole suite at 115 passed, 0 failed; UI-A's full run was 124 passed and 2 flaky (both pass alone);
`l17-carrier` 5/5 and `l19-surveillance-hints` 2/2 alone, and `l18-incirlik` 3/3 on its branch. L17 saw
three `l17-carrier` and two `tactical-positions` failures when five spec files ran together, passing
alone: the integrator's full run decides whether that is load or a leak. Every spec must
`require('./helpers/test')` and leave no Strips on the Board (E2E-fix, §3J). `ordnance-hung`'s "pilot
walks" test needs `field-state.spec.js` to have run first (it relies on the active runway), as on the
baseline. Restart the local crc-sync on :3000 after any `crc-sync/src` change.

ADRs on `integ/wave3-dry`: `0001`–`0076`, `0078`–`0086`, `0088`, `0089`, `0091`; `0093` is on
`lane/L18-server`. The gaps: `0077` and `0087` are reserved for L20 and L28, `0090` and `0092` were not
used (TA took none: it applies `0085`/H62), `0060` is the errata ADR. **An ADR is never edited once
committed (P4)**: a correction is a new ADR.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/mission-clock.js             in-game Zulu, injected into every EFSP time (F1, 0079)
crc-sync/src/mission-session.js           which mission we are in: new session on start/other mission/clock step-back (F3, 0086)
crc-sync/src/magnetic.js                  WMM2025 variation + grid convergence, per-theater override (F2, 0085)
crc-sync/src/theater-context.js           the one conversion point: variationAt, trueToMagnetic, gridToMagnetic, transitionAltFt
crc-sync/config/theaters.json             per-theater table: local offset, transitionAltFt, tmCentralMeridianDeg, magneticVariation override
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
crc-sync/src/efsp/carrier/                pure carrier model: stack, Case, ship banner, transfers, sun, hull config (0064, 0074)
crc-sync/src/efsp/carrier-store.js        CarrierStore: Case, stack, ship settings, hand-overs; its own wire messages (L17, 0074)
crc-sync/src/efsp/carrier-tick.js         the ship-state tick from the hull's track (L17)
crc-sync/config/efsp-carriers.json        the hulls (id, radars, callsign)
crc-sync/src/efsp/airborne.js, surveillance-hints.js  "detected airborne" phase and the suggestion/staleness monitor (L19, 0076)
crc-sync/config/efsp-surveillance-hints.json  its four thresholds, read once (P5)
crc-sync/src/efsp/block-map.js            the Block Maps, the interlock tags, MILITARY_BLOCK_NAMESPACE
crc-sync/tools/soak/                      the WP8 soak harness (npm run soak / soak:smoke / soak:selfcheck)
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (state/)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the airspace board, correlation-highlight, carrier-state/carrier-panel (L17), final-panel and pattern-board (L18)
atobrief/public/js/usmtf-ato.js           atobrief's USMTF ATO export (0078)
docs/adr/                                 the reasoning behind every decision below
docs/efsp-usage-guide.md                  how a controller actually drives it
docs/parallel/                            the lanes: decisions.md (the record), briefings, research
docs/wip/                                 each lane's notes (all merged lanes folded into this file and the guide by DOCFOLD and DOCS2; DOCS2's list of what it rewrote is `docs/wip/DOCS2.md`; the integrator removes them at the end)
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

**Waves 2 and 3 and the fixes between them** (`0068`–`0076`, `0080`–`0086`, `0088`, `0089`, `0091`; `0093` on
a branch). See §3J: the field-state panel (L1b), hung ordnance (L12), alert/scramble (L13), the ATO on the
Board (L14), the METRICS panel (L15), the `9F` picker and time chains (L16), the STARS scope (L22),
archiving (L24), Board sync correctness (L27), the tactical Positions (L23), audit completeness (L26),
block altitudes (U6), magnetic headings (F2), mission sessions (F3), typed time Blocks (F4), the carrier
Positions and Facility (L17), the suggestion chip and staleness (L19), the UI follow-up (UI-A), the
per-theater transition altitude (TA), the client-mirror parity tests (PARITY), the soak fixes (SOAK), and
Incirlik's pattern board and FINAL component (L18; the server half is on a branch).

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
  "Primary somewhere"; `missionKeyOf` is gone: F3 hoisted it as `missionFingerprint` in `mission-session.js`.

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
table. **Wired by L17 (`0074`, §3J)**: the CARRIER Facility, the Roles, the store and the client. Hull CVN-72 `UNION`
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
lifetime), everything a controller reads uses the mission clock. `EfspMetrics` takes the injected `missionSession`
(F3; the `_mission()` seam and `noteMissionLoad` are gone).
- `positionStore.observersOf()` returns `{controllerId, controllerName, since}` records, not ids.
- `airspace-store.apply()` returns STALE_REV and NOT_FOUND before `_recordAudit`, so those refusals
  are not logged (L26's).
- Nearly every DEPARTURE NLA is transfer-shaped; the only non-transfer NLA is the terminal Drop.

**Soak harness (L6, no ADR).** `crc-sync/tools/soak/`: a discrete-event driver on a virtual clock
running the real `createEfsp` and `WsHub` with fake sockets, a shadow replica per client, a ledger
reconciling acks, broadcasts and the Mutation log. `npm run soak:selfcheck` (~40 s, proves every
detector fires, 5/5 since the SOAK lane), `npm run soak:smoke`, `npm run soak -- --minutes 240 --seed 1`,
profiles `realistic|stress|smoke` (H46, S-R2-6). None is in `npm test`. The literal four-hour run is the
manual workflow `crc-sync-soak.yml` and **has not been run**: the human runs it once before WP8 is
declared done. **State after wave 3** (L27, L24, SOAK, L19): F1, F2, F5, F6 and F13 are fixed, every
sync check reads 0, `drop-broadcast` fires again, the metrics tap is installed in the soak host, and the
only soak finding left on short runs is the heap slope, which is retention filling and not a leak
(see the SOAK/SOAKW paragraph in §3J: judged on runs of 3 h or more only). The `LINGERING_TRACK` that
wave 2 saw (exact-callsign correlation onto an earlier flight's still-airborne aircraft; the soak
reuses callsigns every 90 flights) did **not** reproduce for L19 on the base (20 seeds at 240 min),
and L19's fix is proven by unit test only. Run `soak:selfcheck` after touching `board-store.js`,
`efsp-ws.js` or `ws-hub.js`; after a new mutation type, add it to `driver.js`'s cmid list and
`_checkBroadcast`.

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
(forgeable; recorded in `0078`). **Nothing sends the token**: crc-sync never reads it, and its ATO
import (L14) takes a pasted or dropped file rather than fetching from atobrief (S-8). Fixtures: `atobrief/test/fixtures/usmtf/ojw1v5-export.txt` (the
trimmed, anonymised real package) and `research-render.txt`. `docs/atobrief/yaml-format.md` has the
field reference. atobrief must not hand out `6xxx` Mode 3 codes (crc-sync's AI block): the editor's `_randomSquawkCode` and miztoyaml's generator both skip them.

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
L15, L16, L22, L24, L27, F2, F3, F4, L23, L26, U6, L18 (both halves; the server half is on a branch), UI-A,
L17, L19, TA, PARITY, GRPC, SOAK, SOAKW, HYG, L25 and E2E-fix. Not yet folded: L28 and UI-B (not merged), L20.

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
- **HIGHLIGHT and OFFSET** each cost 2 inputs at L15, over §7.3's ceiling of 1. UI-A gave both a
  one-input entry point (Alt+click toggles OFFSET, Ctrl/Cmd+click steps HIGHLIGHT, with
  `GESTURE_INPUT_COST` rows); the menu and swatch forms stay at 2 inputs. Whether that satisfies the
  ceiling is still open for the human.
- Staleness read `not instrumented (L19)` until L19 declared `sources.staleness`; it now reads
  `COLLECTING` from startup and `NO_DATA` until the first episode. A trend `↑` is not coloured (an
  observation, not a threshold failure); the supervisor may want it coloured.
- Not walked: a real hour of controlling with the panel open against DCS (trend over real hours, real
  manning, correlation rate, a real traffic count, a mission reload creating a second session in the
  selector); Electron (the e2e drives Chromium); `tests/metrics-panel.test.js` and `e2e/l15-metrics.spec.js`
  were not re-run against F3's merge by the lane.
- Flaky under load, not L15's: `grpc-client-stream.test.mjs` "a stream that stayed up resets the
  backoff" and several `e2e/l1-popovers.spec.js` tests at the 20 s budget.

**`9F` picker and the §10.5 time chains (L16, `0073`).** The `9F` options come from the last
successful fetch of the stereo table (`efsp-stereo-routes.js`'s `cachedStereoRoutesClient()`); the cache
key is in the Strip render signature (`stereo:` in `_stripRenderSignature`) and a changed cache asks for
a render, because the first render after a load always beat the fetch and every `9F` stayed "no stereo
routes configured". The chains are computed at read, never stored: `time-chains.js` has **two
byte-identical copies, one per package** (crc-sync and `panels/efsp/`; they never share code, `0001`),
held equal by `crc-sync/tests/fixtures/time-chains.json` plus a byte-equality test on each side;
`resolveTimeChain(name, fdr)` returns `.estimated`, so anything bucketing by takeoff time must check it.
The one new stored input is `fdr.timeInputs.flightPlanDepartureUtc` (from the DD-1801's `depTime`, dated
by the mission clock; `restore()` seeds `timeInputs`). `fdr.ato.departure.timeUtc` feeds the P-time
chain. `ZULU_HHMM_BLOCKS` now covers `M6`/`M7` (the set is derived from the Block Maps by a test), and
`resolveZuluHhmmAfter` dates the vul end. `time-chains.js` loads before `strip-template.js`.
- Opt-in `E2E_STEREO_ROUTES` makes the e2e harness install a stereo table (fixture
  `e2e/fixtures/l16-stereo-routes.json`).
- Open: the state-transition source for takeoff (needs a `board-store.js` hook and an FDR broadcast on
  a state-only Mutation, would be the takeoff chain's next source); **W2** TAXI/TAKEOFF are on no face
  (a GND controller must expand the Strip; owner: the field lists); **W3** a typed TAXI does not follow
  a later P-time change and nothing flags it (a conformance-style hint, whoever takes §10.2 next); **W5**
  an estimate cannot be accepted as the actual without retyping a different value (left open in `0073`);
  the route `description` is not shown as the option's title; editing a vul start does not move a stored
  end, and a start moved past its end is not refused (MISSION validation); a stale MTR exit fix after a
  designator change is still not warned (H23 keeps MTRs free text).

**Mission session (F3, `0086`).** `crc-sync/src/mission-session.js`, persisted to
`state/mission-session.json`, the instance is the `missionSession` const in `server.js`'s "F3 mission
session" block. A new session (`reason` in `FIRST`, `MISSION_START`, `MISSION_CHANGED`,
`CLOCK_STEP_BACK`) starts on a DCS `mission_start`, a load with a different fingerprint, or a clock step
back of more than 5 min; subscribe with `missionSession.onNewSession((session, previous) => …)` (L24
does). Users: the wind-derived runway (H22), the metrics session number (H32), the traffic-count
`missionSession`, the archiver (H36).
- **Defaults worth knowing.** The `mission_start` roll happens at the *following* mission-load (so the
  new session carries that load's fingerprint and theater, and the wind derivation never runs on the
  previous mission's airports). The clock is observed only on `game-time` (`observeClock()` after
  `missionClock.sample()`, never inside the load handler, where the clock can carry the old theater's
  offset). A clock-step roll followed within 2 min wall by a load of a different fingerprint is one
  session. `setActiveRunwayFromWind` takes `{ missionSession }` (a number) and can return
  `skipped: true`; the server's wind block is `deriveActiveRunwaysFromWind(missionData)`.
- **Behaviour fixed on the way:** a TWR runway change used to be undone by the next gRPC reconnect (it
  overwrote the `missionKey` the guard compared); the guard now reads its own `windDerivedSession` on
  the field-state record (a harmless extra field on the wire).
- **No migration.** Existing `efsp-metrics.json` / `efsp-traffic-count.jsonl` can hold session numbers
  from L5's old counter, and the new counter starts at 1: **clear those two files, or accept repeated
  numbers, on a machine with state.** A persisted field state has no `windDerivedSession`, so its wind is
  re-applied once.
- **Walks not done, human-gated:** whether DCS-gRPC sends `mission_start` to a stream that connects
  *after* the mission has started (if it does, every crc-sync restart rolls the session: restart against
  a running server and watch `[mission-session]` in the log); a real `.miz` restart through DCS.

**Typed time Blocks (F4, bugfix, no ADR).** `fdr-store.js`'s `TYPED_TIME_LABELS` and
`normalizeTypedTime(path, value, nowMs)` are the **only** rule for a typed time: a finite number is epoch
ms already, empty clears to null, a string goes through `resolveZuluHhmm` against the injected clock, and
anything else is `VALIDATION_ERROR` ("<label> must be a UTC time as HHMM, e.g. 1432") with no partial
write. `setField` applies it before the write (so `voidDeadlineUtc` and the EDCT/CFR windows derive from a
number) and `createFdr` applies it to the two filed times of a seed. `normalizeMtrValue` delegates to it.
A fallback chain must hand `setField`/`createFdr` epoch ms or the controller's typed string, never a
formatted date. **Persisted FDRs that hold a string time are not migrated**; a leftover string compares as
before until the Block is retyped. `efsp-scenario-typed-times.test.mjs` is the sortie (a typed void time
expires; a typed release holds the NLA until reached).

**Magnetic (F2, `0085`).** `magnetic.js` evaluates WMM2025 (`data/wmm/WMM2025.COF`, verbatim from NCEI,
tested against both NCEI tables) at a position and the mission date, snapped to the UTC day.
`theater-context.js` is the server's single conversion point (`variationAt`, `convergenceAt`,
`trueToMagnetic`, `magneticToTrue`, `gridToMagnetic`, `transitionAltFt`, `windFrom`) and builds the
`theater` wire message: **its own message** (a 1° grid covering the airfields' box plus 3°, values to
0.01°, a few hundred numbers that change once a day), not a field on `game-time`. `theater-settings.js`,
its messages and `hdgCorrection` are deleted. Client: `app/public/js/magnetic.js` (`toMagneticDisplay`,
`magneticText`, `magneticVariationAt`, `gridConvergenceDeg`, `requestTrueFromMagnetic`);
`GET /api/magnetic/to-true` is proxied by crc-desktop's local server and is for local drawing only.
**Rules for any lane:** show a true bearing with `magneticText(trueDeg, lat, lon)` (`"045"` / `"---"`);
never apply a variation or convergence yourself; a typed magnetic value goes to the server as typed and
`theaterContext.magneticToTrue` converts it; a DCS grid heading (`track.course`,
`orientation.heading`) goes through `gridToMagnetic`.
- **Conformance** (follow-up, S-F2 finding 1): `ConformanceMonitor` takes an injected
  `gridToMagnetic`, compares magnetic with magnetic, reports `actual` in magnetic and does not check
  heading when the answer is unknown. The soak host and the mission-clock test inject the identity
  function because their courses are synthetic.
- **Wind (H76):** `/api/apt-weather` sends `windFromMagnetic` and `windFromTrue` (via
  `theaterContext.windFrom()`), no raw `windFrom`; no client surface shows METAR-style text yet.
- **Open:** non-Syria `transitionAltFt` is 18000 `[SOURCE-DEFINED]` (TA, §3J, now applies the setting to
  every place that hard-coded it); **six theaters have no
  `tmCentralMeridianDeg`** (TheChannel, MarianaIslandsWWII, Kola, Afghanistan, Iraq, GermanyCW), so their
  grid headings cannot be converted, and `tools/miztoyaml/projection.py` needs the same additions (a test
  should keep the two tables equal); stale comments still name `theater-settings.js`
  (`efsp-ws.js:6`, `facility-config.js:5,42`, `mutation-log.js:5,41`); ADR `0048`'s table and `0079`'s
  "`gameTimeOffset` is gone" paragraph describe a `theater-settings.json` that no longer exists (belongs in
  the next errata ADR); **`grpc-client.js:764` `windFrom = heading·180/π + 270` is unexplained** (the proto
  says `heading` is already the from-direction, and the DCS wind vector is probably grid, not true,
  about -2° at Incirlik): it needs a live check against the mission editor's wind before anything changes;
  the APRT read-only line layout was never checked in a browser; no live DCS run.

**The ATC scope in the STARS scheme (L22, `0088`).** crc-sync's `presentation.js` sends
`scheme: 'TACTICAL'|'ATC'` per contact per session (in `WIRE_KEYS`; `ws-hub-wire-strictness.test.mjs`
covers it), with a hold of 2 tactical sweeps (`SCHEME_HOLD_SWEEPS`) so it does not flip on a missed
sweep. `sensor-specs.json`'s new `presentation` section classes each radar kind (airport, approach,
carrierApproach = ATC; awacs, fighter, carrier = TACTICAL) and `radars.js` stamps it. Every Facility
config has `positionLetters` (validated, sent in the EFSP snapshot); `ws-hub.js` tells the picture
whether the session holds an ATC Position and re-sends it when that changes. Client: `atc-scope.js`
(relation, view, local acknowledgements and click-downs, coast state, palette), `atcBlockLines` in
`track-label.js` (still the only code that turns a track into text), an ATC branch in `geojson.js`
(ATC tracks draw no PPL), the `atc-targets`/`atc-symbols`/`atc-labels` layers and `applyAtcBackground`
in `map-setup.js`. **Do not decide a block's text or colour anywhere else.**
- ATC text size copies the tactical label layer (so `applyScale` in `app.js` is untouched). A third
  scheme value (or a client-side choice) would be needed for an ERAM-style CTR scope in a later lane; the
  relation and click logic in `atc-scope.js` can be reused.
- Not walked: live DCS (the e2e injects the picture); a real handoff accept end to end against real
  Strips (the unit test pins the dispatched op, the e2e shows the picture); the black background in
  light mode. The spec is `crc-desktop/e2e/l22-stars-scope.spec.js`, writing into `docs/wip/L22/`.

**Archiving finished flights (L24, `0082`; H36, H72, H73).** `crc-sync/src/efsp/archiver.js`
(`Archiver`, `ARCHIVE_AFTER_MS` = 2 h, `sweepChanged`, `archiveDeltas`), on the `createEfsp` facade as
`efsp.archiver`, swept every 60 s and rolled on `missionSession.onNewSession` in `server.js`'s
"Archiving finished flights" block. `BoardStore` gains `archiveStrip`, `droppedWallAtOf` (stamped in
`_retireStrip`; any other DROPPED Strip is stamped the first time a sweep sees it), `getDeltaSince`'s
`gone`, and `droppedWallAt` in the snapshot; `FdrStore.archiveFdr`; `traffic-count.js`'s `hasCountFor`.
The archiver builds its own referenced set from every Board (a Strip is archived only when its FDR has no
live Strip and no un-archived DROPPED one). The wire carries `gone` and `fdrs.gone`
(`ws-hub.js`'s `broadcastEfspBoardDelta` passes `gone`/`fdrsGone` through; `efsp-state.js`'s
`applyEfspDelta` handles `fdrs.gone`). **ADR 0002's "durable" now means durable until archived.**
- **Soak acceptance was restated, H72:** 4 h run, net-growth limit **25%** (`tools/soak/report.js`
  `THRESHOLDS.netGrowthPct`; no `--warmup-min`, no 8 h run). Measured 17.2% (old 10% gate would fail, and
  so does the pruned baseline at 20.3%): the growth is the capped caches filling (`_appliedMutations`
  1218/5000, ring `_log` 1379/2000), not finished flights. `strips.dropped` and `fdrs` are flat after
  2 h. **The rows "snapshot within 2x of pruned" and "p50 <= 3 ms" cannot pass with 2 h retention**
  (about 200 Strips and 100 FDRs make a 284 KB snapshot) and need restating or a persist fix; the
  per-DROPPED-Strip figure is no longer meaningful. Profile: `_persist` is 40% self-time
  (`JSON.stringify(…, null, 2)` of the whole snapshot on every Mutation) and `correlation-store`
  `deepClone` 17%; L27 has since landed a compact dirty-only persist (below).
- `SetState` to `DROPPED` bypasses `_retireStrip` (no TOFI guard, no remove indicator, no beacon
  release). Whether a client can send it is an open question for L23's capability table; the archiver
  copes either way.
- The soak host does not wire L5's instrumentation, so there the archiver runs unguarded (no traffic
  count) and warns once.

**Board sync correctness (L27, `0081`).** One event, one broadcast: `BoardStore.drainTouched()` returns
every Strip a Mutation touched (`_touch` is followed by a `rev` bump) and `efsp-ws.js`'s `_boardDelta`
broadcasts all of them, including a rebalanced Rack and the peer Board's. **Every `efsp-board-delta`
carries `boardEpoch`** (`_boardEpochFor` in `ws-hub.js`; the heartbeat carries `boardSeq` and no epoch).
`_handleResync` is resolve → `_deltaCanServe(boardStore, boardEpoch, lastSeq)` → build: a delta only
within one Board lifetime. `getDeltaSince` returns `{ updated, gone, seq }` (and `_handleResync` sends
`gone: [...DROPPED, ...delta.gone]`). The idempotency cache holds **compact frozen JSON-safe records**
(never a live Strip or FDR), is rebuilt as a result on replay (`replayed: true`, the current Strip), and
the four non-Board handlers (airspace, correlation, MARSA, TOFI) have `_cachedOutcome` / `_rememberOutcome`
blocks. A Mutation without a `clientMutationId` is **never cached** (before, every later cmid-less one was
answered with the first one's result). Crash-once: replay records persist in the snapshot for 10 minutes
(`REPLAY_PERSIST_WINDOW_MS`, loaded at restore unfiltered) and the boot reconcile (`_reconcileLogTail`)
marks any successful, cmid-bearing Board line no Board holds with `op: 'NotPersisted'`, which voids the
earlier line with that cmid. `_handleSetPositions` now persists when it reassigned anything. Persist is
**compact JSON and skips a write whose body is unchanged since the last success**; it stays synchronous
before the ack (no debounce, no batching, either would let an acknowledged change die with the process).
`code-allocator.js` keeps a rotating cursor (`fdr.codeCursor`, beside `fdr.codes`).
- Traffic count: a retried drop gets the same `countId`, so `liveCountRecords` and `_index` read
  COUNT/VOID in file order (a COUNT after a VOID revives it); `reconcile({ backfill })` replays the
  markers; `isNotPersistedDrop` is exported.
- Harness: `driver.js` skips M8's broadcast check for a replay (it now broadcasts nothing by design),
  `logLinesFor` applies the marker rule, `selfcheck` passes; no detector was weakened.
- Walks and numbers not done: `p50 <= 3 ms` unloaded (2.16 ms measured with `--prune-retired` on a loaded
  machine, re-measure after L24); the dirty check holds the last serialised body in memory (about the
  snapshot's size, bounded now L24 retains); the shipped client still never sends `sendEfspResync`, so
  the epoch matters for any future client and for the soak.

**Tactical Positions (L23, `0080`).** `permission.js`'s `TACTICAL_CAPABILITIES` is the capability table
(`PERMISSIONS.JTAC`, `canCorrelate`, `canDeclareMarsa` read it); `mayActBesideOwner` carries the two
named exceptions to "only the owner acts": TAC_C2 answering TOFI on an AIC-held line
(`TOFI_ANSWER_ACTIONS`, B2) and OPS writing `14E` (S-L13). `board-store.js`: `_dispatch` has the
ownership gate (`NOT_OWNER` now carries `<OWNER> holds this Strip`); `SetState` is owner-checked for
every Role (`_setStateOwnerRefusal`, in the `_dispatch` case, **not** in `_applySetState`, which the NLA
and Undo paths also call and which must not be owner-checked; a `SetState` to DROPPED routes to
`_applyDropStrip`); `_bayForNewOwner` moves the Bay with the owner (B3/B4); `reassignPositionStrips` and
`returnCoveredStrips` implement F10 (`coveredFrom` on the Strip, first Position kept through a second
hop); the coordination op gains `CANCEL`; `SystemCoordinationEnd` and `SystemReassign`
(`position-retaken`) are log entries. **Per-session read scope (B6)**: `crc-sync/src/efsp/read-scope.js`
and `efsp-ws.js`'s `readScopeOf`/`filterForSession`/`supplementFor`/`readScopeKey`; `ws-hub.js`'s
`_broadcastEfsp`, `_efspFilter`, `_efspAlertsMsg(session)` and the connect snapshot filter every EFSP send
(`snapshotFor(session)`, `_snapshotMessage(ctx, session)`); `broadcastEfspFieldStateDelta` and the
heartbeat stay unfiltered (not flights). A Strip that becomes visible to a session arrives with its FDR,
correlation and MARSA records. Any new EFSP broadcast must go through `_broadcastEfsp`.
- U7: `receiveCoordinationPeerGone` ends only a PROPOSED or ACTIVE link (S-L23: a completed handoff is not a live link, so the receiver's later drop leaves the sender's Strip alone; tested).
- Open: the two UI follow-ups above (a TAC_C2-only controller cannot Accept an AIC-held exit from the
  panel; the JTAC's drop-only tabs); GCI has no hand-back row (unchanged); `permission.js`'s module
  header still says "no coordination primitives are built" (stale since WP4A, L20); the 4-hour soak was not
  run for this lane; `CANCEL` and the two system log entries are new op strings (a `CANCEL` is not a
  coordination attempt for the metrics tap).

**Audit completeness (L26, `0083`).** One outcome, one audit entry: a store logs what reaches it, and the
metrics tap (`metrics.js` `_post`) logs whatever carries `result.unaudited` (the handlers in `efsp-ws.js`
set it on every pre-store refusal, so it replaced the old "efsp-mutation or NOT_HOLDING_POSITION"
condition). Every entry has `facilityId` and the FDR (`null` Facility for correlation/MARSA, the
controlling Facility for airspace); `SetBlock` records `blockId`/`value`; transitions carry a wire `action`;
airspace passes `clientMutationId` into `apply`. Seven `Peer*` ops (plus `PeerCoordinationCancel`) record
replica changes with `source: 'peer'`, `causedBy` and `clientMutationId: null` (`_recordPeer`,
`_activeCmid` in `applyMutation`; `isDropTransition` is guarded by `source: 'peer'` so a cancelled
replica's retire is not a drop). A cached replay stays unlogged. `traffic-count.js`: a scramble called off
on the ground is not counted, one called off after departure keeps its latch; an archived drop
backfilled at boot keeps its Facility. **`getFieldState` now carries `runwayChangeAcknowledgers` and
`inspectionAuthorityPositionId`**; the client still falls back to the owners table (open item).
- At L26 the soak harness did not install the metrics tap; the SOAK lane did (§3J), and the ledger now
  expects exactly one audit line per answered Mutation, from the right writer. `drop-broadcast` failed
  with and without this lane and the SOAK lane fixed the detector. `efsp-scenario-concurrency.test.mjs`
  shares one log across tests, two assertions use `findLast`. The ATO "no store" refusal is reached only
  through `_atoGate`, which the handler already logs.

**Block altitudes (U6, `0091`).** `fdr-store.js`'s `parseAltitude(text)` returns a band `{ lowFt, highFt }`
(a single altitude is a zero-width band); `parseAltitudeFt` still answers a single altitude only. A block
is stored `parsed: null, block: { lowFt, highFt }` with `value` rewritten canonical, so a reader that only
knows single altitudes ignores the entry rather than misreading it. Conformance deviation is the distance
to the nearest edge (`0058`'s tolerances unchanged); `clearance-migration.js` reads blocks too;
`requestedAltitudeAfterExit` takes a block. Client: the track panel, the scope's data block and the map
line show it. Open: **`strip-view.js`'s conformance reason line reads `a.assigned` (the edge), so a block
bust says "from FL240" without the block** (use `a.block`; UI-A left it, now UI-B's); the existing test that
expected `FL190B210` refused was updated; STCA does not read assigned altitude (a conservative rule is
in the ADR for later); a block on a datalink/atobrief import path is not walked (the ATO import carries
no clearance altitude). Pre-existing `crc-sync npm test` failures at U6's base are listed in
`docs/wip/U6.md`.

**Incirlik RSU / SFA / PAR (L18, `0075`).** The client half is on `integ/wave3-dry`, standalone,
unit-tested and **mounted nowhere there**; the server half and the mounting are on `lane/L18-server`
(below): `panels/efsp/final-panel.js` (the FINAL component, shared by PAR and the carrier Final lane:
pure model `finalCallsDue`, `createFinalTracker`, `finalViewModel`, `terminalActionsFor` plus
`renderFinalPanel`; zero input elements, a test holds it; a free-running 5 s cadence bar off the mission
clock, because a voice call cannot be observed and a tap per call is data entry, guide 7.10; required calls
(mile, glidepath intercept, decision altitude, trend) prompt from sample crossings and clear after 4 s) and
`pattern-board.js` (RSU: closed, initial, base, final; PriFly: initial, break, downwind, groove; configured
by leg list; advisories only, nothing refuses; a "Next leg" button is the touch alternative to drag; a
Strip whose Rack is not a leg shows in an UNPLACED column). `css/efsp-pattern-final.css` and the tags in
`index.html`; `tests/efsp-final-panel.test.js` (18 tests, stand-in data). Defaults, all `[SOURCE-DEFINED]`:
PAR's terminal events reuse the FINAL Role's states (Landing assured, Ball to `BALL`; Missed approach,
Waveoff to `BOLTER_WAVEOFF`; no new state, `nla.js` is L17's); glidepath tolerance 0.3 deg, trend step
0.1 deg, prompt hold 4 s, long-in-pattern 10 min, more than one on the last leg advised; chip actions
Landed (`RECOVERED`) and Drop (`DROPPED`).
- **Server half, built on `lane/L18-server` (`395c0f7`, ADR `0093`, not on `integ/wave3-dry`).** Based on L17
  plus this client half, so it merges after L17 and PARITY (re-run PARITY's tests then). `facility-config.js`
  gives INCIRLIK eight Positions (`RSU`, `SFA`, `PAR` all `MILITARY_ATC`: a new class would silently drop STCA,
  the `0041` inclusion-list trap), covering `SFA`/`PAR` to `APP` and **none for RSU**, Bays `rsu-pattern`,
  an SFA frequencies Bay (implies `INBOUND`, an existing ARRIVAL state), `par-final` (one Strip) and a second
  PAR Bay `par-missed` (BOLTER_WAVEOFF), and a validated `singleFrequencyApproach: { jurisdiction: 'APP',
  rotationSize: 3, pool }` (five placeholder UHF frequencies, `freq-1..5` = 232.1 to 236.1 MHz,
  `[SOURCE-DEFINED]`; initial rotation APP/SFA/PAR on `freq-1/2/3`). Every grant derives from one table,
  `INCIRLIK_CAPABILITIES` in `permission.js` (`ops`, `createsRoles`, `ownsStates`, `requestsRunwayStatus`,
  `rotatesSfa`, `sendsSfaRotation`, `receivesSfaRotation`). RSU originates PATTERN Strips, may send
  `RequestRunway...` (CLOSE, OPEN, WORKS) and never closes a runway (H18); SFA and PAR originate nothing.
  New modules `sfa.js` and `sfa-store.js` (the rotation record `{ rackId: positionId }`, persisted with the EFSP
  state, one whole delta, audited; **only APP edits it**: the table's `rotatesSfa` is the ceiling and
  config's `jurisdiction` narrows it). The `SfaRotation` Strip op moves an ARRIVAL at INBOUND to FINAL at
  `ON_FINAL` in place and to PAR, trigger type `CONTROLLER_INITIATED` (the four stay four), and never touches
  the flight's frequency (D17). It is refused when PAR is unmanned (no covering fallback, a FINAL Strip at
  APP would sit in a Bay APP does not have) or `par-final` is full. **A frequency is the FDR's working
  frequency and the Rack is that frequency**: filing a Strip on an SFA Rack writes the pool frequency (the
  field an airspace approval also writes), and a system placement puts a Strip back on the Rack matching
  its frequency. Wire: `efsp-sfa-mutation`, `efsp-sfa-ack`, `efsp-sfa-delta`, `sfaRotation` in the snapshot;
  audit fields `sfaTransfer` and `sfaTrigger`. Bay descriptors gain three flags (L17 had none and found its
  Bays by `bayId`): `view` (`'pattern' | 'final' | 'sfa-freqs'`), `replacesRacks` (the component is the Bay's
  interface; RSU's and PAR's replace their racks, the carrier's PriFly pattern and final Bays carry `view`
  and keep them) and `capacity` (enforced by the server; the occupant is named in the refusal);
  `validateConfig` rejects unknown keys. Client: `sfa-state.js`, `bay-views.js`; the FINAL sample is the
  distance to the radar's site, glidepath against a nominal 3 degrees and decision height + 200 ft
  (carrier: distance to the ship), all `[SOURCE-DEFINED]`. It also regenerated the shipped
  `config/efsp-facility-incirlik.json`, which overrides `DEFAULT_CONFIG` (the loader spreads on-disk JSON
  over it). Tests: crc-sync 1922, crc-desktop 771, `efsp-scenario-incirlik-l18.test.mjs` walks the
  acceptance (rotation moves the controller, the frequency stays), switch frequency, switch controller,
  cancel, late arrival and restart; `e2e/l18-incirlik.spec.js` 3/3 on `E2E_LANE=9`.
  - **It fixed a bug in the client half that only a browser shows**: `pattern-board.js` and `final-panel.js`
    both declared a top-level `finite`, and `_el` collided with `metrics-panel.js`, so one script failed to
    load; the Node tests load one module each. A test now holds the Bay-view scripts' top-level names unique
    across `index.html`.
  - Open: `capacity: 1` could enforce "one at a time" on the carrier's final Bays (not set: a behaviour
    change in L17's design); a PAR vacated with an aircraft on final leaves the Strip in APP's coordination
    Bay where APP cannot advance it (the same shape as L17's watch item, §3J); an airspace approval that
    rewrites a flight's frequency desyncs its SFA Rack (the Rack is a placement, the FDR is the truth);
    the FINAL panel has never seen a live DCS track (the harness shows `--`). `docs/wip/L18.md` is stale
    on `BARRIER_CHANGE` (it is `WORKS`) and on the SFA state.

**Carrier Positions and the CARRIER Facility (L17, `0074`).** New: `carrier-store.js` (the `CarrierStore`),
`carrier-tick.js` (the ship state from the hull's track), `carrier/hull-config.js`, `carrier/sun.js`,
`carrier/transfer-effects.js`, `config/efsp-carriers.json`; client `carrier-state.js` and `carrier-panel.js`.
- **Roles and Facility.** `MARSHAL`, `FINAL` and `PATTERN` Roles (committed first so L18 could read them), and
  the `CARRIER` Facility with four Positions `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`; PriFly is
  outside the covering chain, the chain is APP2 to APP1 to Marshal. Grants come from `CARRIER_CAPABILITIES`;
  radar selectors are `{ kind: 'carrier', hull, radar }` (Marshal and lanes take both radars, PriFly the
  search radar); Position letters `V`, `P`, `1`, `2`. `computeNla` falls back to the DEPARTURE table for an
  unknown Role (the `0064` trap), so the NLA tables were registered in the same commit as the Roles; a test
  now holds an explicit expectation for every state of every Role in `INELIGIBLE_STATES`, so a state added
  later fails until someone decides. `LAUNCH` is correlation-eligible (ship radars set `noGroundAircraft`,
  but correlation matches the FDR against the track store).
- **Wire.** `efsp-carrier-mutation`, `efsp-carrier-ack`, `efsp-carrier-delta` and `carriers` in the snapshot,
  each in its own replay-cache kind (`carrier`); the `CarrierTransfer` op, and `carrierTransfer` /
  `carrierTrigger` audit fields. `normalizeStack` returns `{ok, stack, dropped}`, not the stack (the first
  restore silently emptied the stack; the crash-replay tests caught it).
- **Behaviour.** The recovery Case is PriFly's, one setting for the ship, as one delta; the night floor is the
  sun more than 6 degrees below the horizon at the ship, from the mission clock. FINAL's identity Blocks
  are `carrier-derived` and Block 5 is off its map, so nothing is writable on FINAL by construction. The
  four hand-overs (Commence, Radar contact, Ball, See you) are explicit `CarrierTransfer` ops beside the NLA,
  one implementation; a drag into a hand-over Bay is refused with the button's name, a bolter is the one
  allowed drag. A recovery check-in is appended to the stack at the next free slot. Typed Charlie time (Zulu
  HHMM) and marshal radial (magnetic) are converted server-side.
- **Two bugs it found.** A dropped launch Strip released the flight's squawk and the bound recovery
  `CreateStrip` did not re-claim it (a duplicate code was possible): fixed in `_applyCreateStrip`
  (`reacquireFdr`). A Case change left every carrier Strip's stamped `nla` stale until the NLA status monitor
  was made to tick after a carrier op.
- **Watch items (S-L17).** The covering chain ends at the Marshal, who then holds approach Strips it cannot
  advance (`0064`'s design, kept: confirm in a walk); the banner reads "hull not found" in the harness (no
  gRPC), so the tick is unit-tested with a built track and a real DCS ship is a live check for the human;
  a Playwright run combining five spec files failed three `l17-carrier` and two `tactical-positions` tests
  that pass alone; deck-state board contents (`0064` B8) are not built; the weather advisory knows only
  night. Traffic count: a launch, a trap and a recovered pattern flight each count once.
- Shared-file hunks to expect on a merge: `efsp-ws.js`, `ws-hub.js`, `index.js`, `replay-cache.js`,
  `traffic-count.js`, `board-store.js`, and on the client `strip-view.js`, `bay-view.js`, `efsp-state.js`,
  `radar-panel.js`'s `EFSP_FACILITY_POSITIONS` (a new `CARRIER` line, a one-line merge with L18),
  `geojson.js`, `map-setup.js`, `app.js`.

**Surveillance informs, the controller advances (L19, `0076`).** `airborne.js` (pure phase: AIRBORNE /
ON_GROUND / UNKNOWN with a debounce) and `surveillance-hints.js` (`SurveillanceHintMonitor`, the Strip-state
table), tuned by `config/efsp-surveillance-hints.json` (read once, P5). "Detected airborne" is a CORRELATED
contact (never PROVISIONAL), aircraft category, ground speed >= 60 kt, >= 200 ft above the nearest airfield
inside its 5 km footprint (speed alone beyond it), held 5 s; the four numbers are `[SOURCE-DEFINED]` (L20).
- **The chip** exists only for a DEPARTURE on the ground side (PUSHBACK, TAXI, RUNWAY_QUEUE, LUAW) and offers
  `SetState` to `DEPARTED`, not `InvokeNla` (from TAXI the NLA would say "to runway queue"). The arrival-side
  contradiction is staleness only, with no chip. The carrier Roles (`MARSHAL`, `FINAL`, `PATTERN`) expect
  nothing: an airfield-relative phase means nothing for a moving deck (a ship-relative one is a supervisor decision). **Staleness** is 120 s after the 5 s hold, logged once per
  episode through `metrics.recordStaleness` on the mission clock, with the source declared at wiring so a
  genuine zero is `NO_DATA`. `efsp-alerts` has a fourth slice, `surveillance`, composed in `server.js`'s
  `broadcastEfspAlerts` and filtered by visible Strip in `read-scope.js`. Both indicators are quiet
  (`_litIndicator` cases `hint` and `stale`, like `ar`/`trk`): no attention styling, no reason line. A hint
  written against a state the Strip has since left is not drawn. The chip is a click target only for a
  Position the controller holds that owns the Strip.
- **Takeoff stamp.** `board-store.js` `_stampTakeoffOnStateChange` writes `fdr.timeInputs.takeoffStampedUtc`
  through `FdrStore.setTakeoffStamp`; `time-chains.js` (both copies, byte-identical) has a `STATE_CHANGE`
  source between `CONTROLLER` and `EST_OFF_BLOCK`. DEPARTURE only; stamped on entering DEPARTED or HANDED_OFF
  from a non-airborne state; first stamp wins; cleared when the Strip is taken back to a pre-airborne state;
  kept through a Drop; it bumps `fdr.rev` but not `fdr.updatedAt` (AMENDMENT_INSIDE_30MIN reads that as "the
  plan was amended").
- **Misbinding.** `correlation-reconciler.js`: a contact held by a flight that has since finished is not
  claimable by another flight's callsign or code rung (`_formerHolder`); an explicit binding still can. The
  memory is by track id and is dropped when the contact leaves the picture or on a mission reload. **Known
  limit:** an aircraft DCS re-mints under a new track id is a new contact; a callsign memory with a position
  test is not built (the "defer, then harden" rule). The fix is proven by unit test, not the soak.
- Open: the chip's `SetState` to DEPARTED is refused while the runway is suspended (`_setStateRunwayRefusal`,
  H19), right for a clearance and odd for an observed fact (UI-B / field-state decides; Drop still works); a
  real-mission walk is owed (taxi a jet, line up, take off without pressing Airborne, watch the chip appear
  5 s after rotation).

**UI follow-up (UI-A, no ADR taken).** All inside `0056`/`0058`'s rules. U1: OPS shows ORDNANCE (`3G`) on its
DEPARTURE face always and may write it on any non-DROPPED departure whoever holds it (a second
`NON_OWNER_BLOCK_WRITES` row, the `14E` precedent). **U2's root cause:** `efsp-arrivals.js` skipped every new
Strip whose `updatedBy` was one of the controller's own ids, and a coordination replica carries the
proposer's id, so one controller holding APP and CTR was never told; a minted replica
(`mintedForCoordination`, `mintedForTofi`) is now an arrival whoever made it. If a human still sees no
notification with two controllers, the next suspect is `heldPositions`/`getActingPositions()` at the receiving
client. U3: the label is `KEEP IFR` (TOFI's `ifrActive`) with a hover. U4: TYPE edits the bare aircraft type
(Block `3A`); the wake category stays in the expanded view. U5: RELEASE (`14A`) on a DEPARTURE's face at APP
and CTR. U8: when the paired mission Strip is OFF_STATION or RTB and the ATC Strip's TOFI is ACTIVE, CTR's
NLA slot is a filled `TOFI Exit` button (`tofiExitDueFor` in `efsp-nla.js`; the render signature carries the
mission line's state). S-L15: Alt+click toggles OFFSET, Ctrl/Cmd+click steps HIGHLIGHT. S-L16: TAXI (17) on
GND's face and TAKEOFF (18) on TWR's; a typed TAXI/TAKEOFF earlier than the proposed departure is dotted with
a hover; retyping the value an estimate shows now sends it, so the estimate becomes the actual; `setField`
(`fdr-store.js` `_vulWindowRefusal`) refuses a vul start not before the end and an end not after the start.
S-L23: a held `TAC_C2` gets a client-local "with AIC/JTAC" tab listing the live MISSION lines AIC/JTAC hold
(read-only guidance, MISSION lines only); a JTAC-only controller no longer gets drop-only tabs (H59). S-L1b:
`_renderArrivalsLine` caches its element, `srs-radio.js` its two buttons, `openPanel` waits for `dock`.
- Server edits were minimal: `permission.js` (one row) and `fdr-store.js`. Nothing in `nla.js`/`block-map.js`.
- Open: GCI-held lines are not in the "with AIC/JTAC" tab (GCI is not a `TAC_C2` delegate); the metrics
  `time-to-find` counts that tab as a real Bay (harmless); `srs-radio.js` has no unit test (browser only);
  the strip-view reason line for a block-altitude bust (U6) was not touched. Playwright: `ui-a.spec.js` 7/7.

**Per-theater transition altitude (TA, no ADR; applies `0085`/H62).** `FdrStore` takes
`transitionAltFt: () => number` beside `clock` (`createEfsp({ clock, transitionAltFt })`; `server.js` passes
`theaterContext.transitionAltFt()`), read when a Block's text is written. `formatAltitudeBlock(band, taFt)`
and `normalizeMtrValue(path, value, nowMs, taFt)` take it explicitly; `BLOCK_FL_FROM_FT` is gone. Canonical
block text now switches to FL at the theater's transition altitude (Syria 10,000 ft: `FL100-FL120`,
`8000-FL100`); a single typed altitude is stored as typed; **stored values are feet and parsing needs no
transition altitude** (`FL100` and `100` are 10,000 ft everywhere). One constant, `DEFAULT_TRANSITION_ALT_FT`
(18000) in `src/theaters.js`, backs an unlisted theater and fixtures that inject nothing; `altimetry.indicatedAltFt`
has no default any more. The client already received `transitionAltFt` on the `theater` message; the
duplicate `?? 18000` fallbacks in `aprt-panel.js`, `track-label.js` and `strip-view.js` are removed
(`app.js` keeps 18000 as a commented placeholder until the first `theater` message). Block text already stored
on a Strip is not rewritten when the theater changes. This supersedes U6's "fixed 18,000 ft" note in
behaviour.

**Client-mirror parity tests (PARITY, tests only).** `docs/wip/PARITY.md` has the inventory of every
hand-copied client table against its server truth. New: `crc-desktop/tests/client-mirror-parity.test.js`
(IFF states, NLA labels and owners, the 400 ms and 30 s literals, field-state tables, Position lists, Zulu,
haversine, regimes), `bay-descriptor-parity.test.js`, `ws-message-contract.test.js` (server envelope types
against `app.js`'s `switch (msg.type)`, both directions) and `crc-sync/tests/wire-payload-contract.test.mjs`
(snapshot, delta and ack fields the client reads, against a real `createEfsp()`). Several mirrors are
source-scanned (`tests/helpers/mirror-source.js` `constLiteral`) because the client constants are not
exported; moving a declaration fails loudly. **Re-run it after any change to `nla.js`, `block-map.js`,
`permission.js` or `facility-config.js`** (L18's server half especially). No live drift was found.
- **S-12 is confirmed and ruled:** `sendEfspResync()` has no caller in the client, so the resync path
  (`0081`) is unreachable from the shipped UI; reconnect relies on the fresh snapshot. Ruling: wire it
  (UI-B, after UI-A); the `test.todo` in `ws-message-contract.test.js` then flips. `efsp-resync` has no
  `-ack` type: replies are `efsp-board-delta` or `efsp-snapshot`.
- `field-state.js` has `SUSPENSION_KINDS = ['WORKS','RUNWAY_CHANGE']` but `SUSPENSION_LABELS` only `WORKS`, so
  a runway suspended by a runway change reads "suspended — works in progress" through a fallback; the client
  copy agrees. It wants its own label (UI-B).

**Soak: SOAK and SOAKW (no ADR).** SOAK: the `drop-broadcast` selfcheck failure was detector drift, not a
detector bug (since L24/L26/L27 a Strip moves on within seconds, so nothing was left stale at the 60 s
checkpoint): in `drop-broadcast` mode the driver now judges the starved client's shadow against fresh truth
at the drop (`where: 'post-drop'`). The soak host now builds `createEfspInstrumentation` as `server.js` does,
so efsp-mutation refusals and `unaudited` pre-store refusals get a `source: 'wire'` line, and the ledger
expects **exactly one audit line per answered Mutation from the right writer** (`auditWrongSource` replaced
`auditForRefusal`; the gate got stricter). **The heap slope is not fleet ramp-up**: a finished Strip stays 2 h
before the archiver removes it (`0082`), so `strips.dropped` climbs until then (about 42/h, 26-37 KB each);
10 min gives 5.8 MB/h, 240 min gives -0.3 and passes; a 130-minute warm-up on a 180-minute run passes.
`--warmup-min <m>` overrides the warm-up. **SOAKW** (`lane/SOAKW-warmup-default`, not on `integ/wave3-dry`):
`memoryPolicy()` in `tools/soak/report.js` judges `memory.slope` and `memory.netGrowth` only on runs of 3 h or
more with a warm-up of at least the retention (`ARCHIVE_AFTER_MS`, read from `archiver.js`); the default
warm-up on such runs is `max(10 %..25 % rule, retention)`; shorter runs print `NOT JUDGED` (a pass, with the
per-DROPPED-Strip KB and residual rows kept and `report.json` carrying `memory.judged: false` and
`notJudgedReason`); `--judge-memory` forces the gate and the selfcheck `leak` case uses it, so a 20-minute run
still has to fail the slope. Tests: `tests/soak-memory-policy.test.mjs`. Until SOAKW merges, `soak:smoke`
reports a memory failure on every short run.

**gRPC reconnect (GRPC, no ADR).** The "unit stream ended, reconnecting" loop was the `poll_rate: 0` bug LG
already fixed (the logs counted in the research note came from the pre-LG client). The one change: the
reconnect delay is `max(base, jittered)`, so jitter can no longer give a retry under 1 s (one test). A
crc-sync still looping is running pre-LG code and needs a restart. The 10-minute live check
(`docs/wip/LG.md`) stays with the human.

**Infra and hygiene (HYG, no ADR).** `.env.example` and `infra/docker-compose.yml` agree; `CRCSYNC_COALITION`
is wired to crc-sync (3 BLUE default, 2 RED); the dead `LOG_LEVEL` is gone; `trust proxy` 1 in all three apps
plus nginx `X-Forwarded-For`; sourcedcs-web's `saveJSON` is atomic; installer pruning keeps the newest 3
versions per platform (`pruneReleases`); the release workflow lost a meaningless `paths` filter and uploads
blockmaps before manifests. CLAUDE.md carries the operational detail. Left for the human: the MariaDB
`init.sh` mount path, whether to untrack `sourcedcs-web/data/*.json` and `lxsrs_v2_state.json`, and the
unverified `flake.nix` hash.

**miztoyaml and the H43 fields (L25, `0089`).** Tankers and AWACS are missions now (`REFUELING`, `AEW`, one per
flight, numbered in flight order, so the numbers of other flights shift); `registry.tankers[]` and
`registry.control_agencies.<cs>` link to theirs through `mission_number`, tankers also get `freq_mhz`, `tacan`
(the group's `ActivateBeacon` type 4), `system` (a DCS-type table) and `arcp`; `missions[].datalink` carries
`l16_callsign` and `ju` (strings). H60 callsigns (`ato_callsign`, kept equal by hand to L14's `fitCallsign`:
two copies of one rule) are used for missions, registry keys and comms. The group frequency bug (a route
beacon's Hz read as MHz) is fixed. `_random_squawk` never returns 6xxx (S-L3). Not emitted because the `.miz`
does not hold them: IFF Mode 1/2/3, package id and commander, alert status, vul, report-in point,
`offload_klb`, a receiver's `refuel`, `control.agency_id`. `build_spins_sections` is tested but never called.
Python tests 330 to 360; one new file needs `npm ci` in `atobrief/` (it runs the YAML through
`usmtf-ato.js`) and is skipped without it.

**E2E-fix (no ADR).** The 13 consistent Playwright failures were mostly stale specs, a state leak between
spec files, and one real regression: `.efsp-strip .efsp-ind` used `all: unset` (content-box) with
`height: 22px` plus a border, so every chip was 24 px and the `l4-badges` budget (28 px) broke; fixed with
`box-sizing: border-box` in `efsp-panel.css`, budget untouched. Standing rules: **every spec must
`require('./helpers/test')`** (it serves `dockview-core` and `maplibre-gl` from `node_modules`, not the
CDNs, and installs a `_freshField` fixture that walks INCIRLIK back to OPEN on the first test of each
file); **a spec must retire every Strip it creates** (the Board and crc-sync live for the whole run, so
`l1-touch-targets`' VIPER11, `l1-popovers`' `L####` Strips and alert-scramble's scramble were visible to later
files); `playwright.config.js` installs `e2e/fixtures/l16-stereo-routes.json` by default
(`E2E_STEREO_ROUTES=none` skips L16's spec); a run killed by `timeout` leaves the lane's web servers
listening (ports 3019/3119), stop them by PID. Remaining fragility: l15's traffic count and l1-popovers'
correlation redraw are load-sensitive.

## 4. What's left, and the known bugs

**Not built, in the guide's order.** WP7A: the server half of Incirlik's RSU/SFA/PAR is built but not merged
(`lane/L18-server`, §3J); the carrier Positions are on `integ/wave3-dry` (L17) and have never met a real DCS
ship. WP8's §10.3 suggestion chip and §10.4 staleness are built (L19). Not started: OVERFLIGHT's four-state
lifecycle (L28, H63; H74/H75 answered), UI-B (below), and the `[SOURCE-DEFINED]` audit fixes (L20), which is a
WP6 acceptance criterion in its own right and runs last. Everything else in WP6 to WP8 that the guide names is
built: the field-state panel, `HUNG`, alert/scramble, the ATO import and AR join, the metrics dashboard.
**UI-B** is the follow-up lane that starts from `integ/wave3-dry`: wire `sendEfspResync()` (S-12, with the
open question of the other sequence numbers: carrier, field state, ATO and metrics have their own and no
resync, Q3-3), the `RUNWAY_CHANGE` suspension label, the L19 chip against a suspended runway, and the
items in the table marked UI-B.

**Known bugs and open items, each with its owner.** Fixed since wave 1 and removed from this table:
B1–B7, F10 (L23); F1, F2, F5, F6, F8, F11, F13 and the replay cache holding live references (L27); F3,
F4, F7 (L24; F7's `_nlaHistory` entry is deleted by `archiveStrip`, I did not test it separately);
every audit gap, F12 included (L26); typed time Blocks storing raw strings (F4, L16); `NOT_OWNER` acks
without detail (L23); U1–U5 and U8, TAXI/TAKEOFF on no face, the typed-TAXI-ignores-P-time and
estimate-as-actual items, vul validation, the `_renderArrivalsLine` and `srs-radio.js` dockview bugs,
`openPanel` racing `initDock`, a `TAC_C2`-only controller not seeing an AIC-held line (UI-A); the one-input
entry points for HIGHLIGHT and OFFSET (UI-A, see the first row); the `drop-broadcast` selfcheck failure and
CLAUDE.md's stale soak claims (SOAK and DOCS2); the misbinding of a lingering aircraft (L19, unit-tested);
the hard-coded 18,000 ft (TA); the `tools/miztoyaml` frequency bug (L25).

| Item | Severity | Owner | Source |
|---|---|---|---|
| **S-12: `sendEfspResync()` has no caller** in the client, so a client that misses a delta or sees an epoch change has no recovery path but a reconnect; ruled "wire it", and the other stores (carrier, field state, ATO, metrics) have no resync at all | medium | UI-B | PARITY, S-PARITY, Q3-3 |
| A runway suspended by a runway change reads "suspended — works in progress" through a fallback (`SUSPENSION_LABELS` has only `WORKS`) | low | UI-B | PARITY |
| The L19 chip's `SetState` to DEPARTED is refused while the runway is suspended (H19): right for a clearance, odd for an observed fact | decision | UI-B / field state | L19 |
| **Gestures at the one-input ceiling**: HIGHLIGHT and OFFSET now have one-input forms (Alt+click, Ctrl/Cmd+click); the menu and swatch forms still cost 2. Accept, or remove the 2-input forms | decision | human | L15, UI-A |
| A trend `↑` in METRICS is not coloured (an observation, not a threshold failure) | decision | supervisor | L15 |
| The client still derives runway-change acknowledgers and the inspection authority from the permission table's owners; the record carries `runwayChangeAcknowledgers` and `inspectionAuthorityPositionId` (L26). Agrees for Incirlik, wrong for any other config | low | UI-B | L1b, L26 |
| `strip-view.js`'s conformance reason line reads `a.assigned` (the nearest edge), so a block-altitude bust says "from FL240" without the block; use `a.block` | low | UI-B | U6 |
| GCI-held lines are not in `TAC_C2`'s "with AIC/JTAC" tab (GCI is not a delegate); the metrics `time-to-find` counts that tab as a Bay; `srs-radio.js` has no unit test | low | UI-B | UI-A |
| **Carrier, never seen live:** the Marshal holds approach Strips it cannot advance when the chain ends at it (`0064`'s design, kept); the banner reads "hull not found" without a real ship; the weather advisory knows only night; the carrier's final Bays have no `capacity: 1`; two hulls, the deck-state board (`0064` B8) and the in-browser final-bearing line are not walked | medium | human live check / L17 owner | L17, S-L17, L18S |
| **Incirlik RSU/SFA/PAR (on `lane/L18-server`):** a PAR vacated with an aircraft on final leaves the Strip with APP where APP cannot advance it; an airspace approval that rewrites a flight's frequency desyncs its SFA Rack; the FINAL panel has never seen a live DCS track; its thresholds and the placeholder frequencies are `[SOURCE-DEFINED]` | medium | human live check / L20 | L18S |
| One `LINGERING_TRACK` in the 240-minute soak at wave 2: it did not reproduce for L19 (20 seeds at 240 min, 6 at 480), so the fix is unit-tested only. Known limit: a DCS re-mint of a lingering aircraft under a new track id is a new contact to the reconciler; a callsign memory with a position test is not built | watch | next soak run | L27, L19 |
| The 4-hour soak's heap gates (net growth 25%, H72) need the human's workflow run; with SOAKW they are judged only on runs of 3 h or more with a 2 h warm-up; the unloaded p50 <= 3 ms was only measured as a proxy | acceptance | human | L24, L27, SOAKW |
| **Merge-time decisions in the questions file** (`docs/parallel/questions-round3.md`): the 2 h archive against 1.5–3 h sorties (a returning flight loses its FDR, ATO line, MARSA and `military` Blocks; Q3-2), a DCS crash or mission restart with live Strips (Q3-4), carrier flights with no path into the ATO, traffic count or home-airport rule (Q3-6) | decision | human | L24, F3, L17 |
| `grpc-client.js:764` `windFrom = heading·180/π + 270` is unexplained and the DCS wind vector may be grid, not true (about -2° at Incirlik): needs a live check against the mission editor's wind. The ATIS-wind frame follows it | needs a live check | human | F2, S-F2b |
| Six theaters have no `tmCentralMeridianDeg` (TheChannel, MarianaIslandsWWII, Kola, Afghanistan, Iraq, GermanyCW): their grid headings cannot be converted; `tools/miztoyaml/projection.py` needs the same table and a test keeping the two equal | theater work | unowned | F2 |
| Whether DCS-gRPC sends `mission_start` to a stream that connects *after* the mission started (if so every crc-sync restart rolls the mission session); a real `.miz` restart through DCS | needs a live check | human | F3, S-F3 |
| An MTR (any plain `fdr` Block) amendment overwrites: no history, no `op.value` in the log (`SetBlock` now records `blockId`/`value`, which narrows it) | known gap | later slice (H25) | L2 |
| Changing only the MTR designator leaves the old exit fix with no warning (H23 keeps MTRs free text) | low | with an MTR route table | L2, L16 |
| Stale text: `marsa-store.js:37–41` says obligations cannot retract; ADR `0042` names `radar-specs.json` (it is `sensor-specs.json`); `correlation-reconciler.js:50–52` claims a test forces an eligibility decision it doesn't; `permission.js`'s module header says "no coordination primitives are built"; comments in `efsp-ws.js:6`, `facility-config.js:5,42`, `mutation-log.js:5,41` still name the deleted `theater-settings.js`; ADRs `0048` (table) and `0079` ("`gameTimeOffset` is gone") describe a `theater-settings.json` that no longer exists, which belongs in the next errata ADR; `atobrief/server.js`'s header comment names port 3000 for the presenter URL (the default is 4000); `docs/wip/L18.md` and `L13.md` (see `docs/wip/DOCFOLD.md`) | stale text | L20 | L4, S-L7, L23, F2 |
| `_cidSeq` passes 999 after ~3 h at stress rate | low | unowned | L6 F9 |
| Merging L3 and L11: a crc-sync test parsing `ojw1v5-export.txt` and `research-render.txt` against research §3's oracle (S-R2-7) has not been written | test debt | integrator | wave 1 |
| Two cosmetic behaviours left alone by decision (D-3): a double 6xxx warning, and a `rev` bump on an unchanged ATO re-import | cosmetic | none | L20PREP |

**Human actions outstanding.** The LG 10-minute live check (GRPC found nothing more to do); one run of the
four-hour soak workflow; the live wind check (S-F2b) and the live `mission_start` check (S-F3); a live walk of
a real DCS ship against the carrier banner and of a real FINAL track; L19's taxi/line-up/take-off-without-Airborne
walk; desk L11-8b; the `.env` and MariaDB `init.sh` items from HYG (CLAUDE.md). **On a machine with state,
clear `efsp-metrics.json` and `efsp-traffic-count.jsonl` (or accept repeated numbers)** when F3 reaches
it: its session counter restarts at 1. **Integrator actions outstanding:** merge `lane/L18-server` and
`lane/SOAKW-warmup-default`; re-run PARITY's tests then; the L3↔L11 cross-test above; the full Playwright
re-run and the unloaded crc-sync run (§1); then remove `docs/wip/*.md` (L28's and UI-B's notes still need
folding when they land).

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
- The D12 audit `0020` asked for is structural in `permission.js` and tested server-side; L23 walked a
  JTAC, an AIC and a combined CTR+AIC controller in Playwright, but a `TAC_C2`-only controller answering
  an AIC-held exit and GCI's hand-back (no row) were not walked.
- `positionRadars`' shipped defaults are SOURCE's model of which scope sits at which console (H61
  keeps them, labelled as such). The real assignment is squadron data.
- **Stereo routes have never run against real routes** (`0050`). The table ships empty on purpose.
  Block `9F` is a picker now (L16).
- Incirlik's shipped field data (true headings 056/236, acknowledgers, pad names) is
  `[SOURCE-DEFINED]` and approximate; L20's list.
- **The Strip layout (`0056`)** was checked by eye in Playwright screenshots; the all-lit worst
  cases from the mockup have not been walked live with two controllers yet. Indicators appear only
  when something is wrong (`0058`).
- **Assigned `ALT`/`HDG` live on the FDR (`fdr.clearance`, `0058`)**, not on the Strip. Writing one
  bumps `clearanceUpdatedAt`, never `updatedAt`. Open: filed-route conformance, and terrain/MSAW
  once AIRAC data exists. Headings are magnetic everywhere (F2, H15, H69).
- **What a client is told about a contact is decided in one place (`0059`)**: server
  `surveillance/presentation.js`, client `track-label.js`. The wire carries no DCS truth.
  `presentation.test.mjs` plus `ws-hub-wire-strictness.test.mjs` hold the line.

## 5. Where to start: what is left of waves 3 and 4

The plan is `docs/efsp-parallel-plan.md` §3–§4, the per-lane briefings are in `docs/parallel/wave2/`
(and the later ones beside them), and `docs/parallel/decisions.md` is what is actually dispatched. Each
lane works in its own worktree `/home/nklx/dev/personal/sourcedcs-<lane>` on `lane/<lane>-…`, reads
`docs/parallel/lane-rules.md`, and leaves `docs/wip/<lane>.md` for the next fold. **Merged into
`integ/wave3-dry`** (and so folded in §3J): GRPC, SOAK, DOCFOLD, TA, HYG, PARITY, L17, L19 and UI-A, on top
of L1b, L12–L16, L22–L27, F2–F4, U6 and L18's client half; L25 and E2E-fix are in too. **Built, not yet
merged:** L18's server half and SOAKW.

| Lane | What | ADR | State |
|---|---|---|---|
| L18 (server half) | RSU/SFA/PAR Positions, Bays, `singleFrequencyApproach`, `SfaRotation`, the Bay `view`/`replacesRacks`/`capacity` flags, client mounting | 0093 (0075 Part B) | built on `lane/L18-server`; merges after L17 and PARITY, re-run PARITY then |
| SOAKW | `memory.slope` judged only on 3 h+ runs with a retention-length warm-up | none | built on `lane/SOAKW-warmup-default`; merges after SOAK |
| UI-B | wire `sendEfspResync()` (and decide the other stores' resync, Q3-3), the `RUNWAY_CHANGE` label, the L19 chip against a suspended runway, the `a.block` reason line, the runway-change owners fallback, the GCI "with" tab (§4) | open | starts from `integ/wave3-dry` |
| L28 | OVERFLIGHT's four-state lifecycle (H63, H74, H75), and the E2E hardening for `ordnance-hung`'s order dependence | 0087 | not started; starts from `integ/wave3-dry` |
| L20 | the `[SOURCE-DEFINED]` fixes and stale-text sweep (§4); the L19 thresholds, L18's FINAL/placeholder values, non-Syria transition altitudes | 0077 | wave 4, last |

**The integrator, after every wave:** merge in order, run both unit suites and the full Playwright
suite, restart the local crc-sync, fold `docs/wip/*.md` into the guide and this file, and walk the
sorties and pilot requests by hand. A standing rule since `S-M-e2efix-l23`: every e2e spec must
`require('./helpers/test')` and leave no Strips on the Board.

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
