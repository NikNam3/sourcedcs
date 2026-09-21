# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of
`EFSPImplementationGuide.md` your work package names, then write a plan before writing code. This is
a handoff, not a build order.

**This revision supersedes the previous one.** The last one named `RANGE`/airspace scheduling as the
next work package; it is built (§3A). The recommendation now is **WP5, track correlation**, with
stereo routes (§9.10) as a cheap early win — see §5.

## 1. State of the tree

Committed and green: **crc-sync 660 tests, crc-desktop 244 tests** (`npm test` in each). Working
tree clean. ADRs run `0001`–`0041`.

```
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/tests/                           efsp-*.test.mjs, incl. efsp-scenario-*.test.mjs
crc-desktop/app/public/js/panels/efsp/    the Strip panel and the airspace board
docs/adr/                                 0001-0041, the reasoning behind every decision below
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

**Hardening driven by end-to-end sorties** (`0027`–`0033`, `0039`–`0041`). See §3B.

## 3A. The RANGE station

An airspace is a first-class entity in its own store (`0034`), carrying the guide's four state names,
a booked window, an append-only history, and a real approval round trip between the using agency and
whichever ATC Position owns it (`0036`). Flights are approved onto a working frequency, or onto a
range control tower's own frequency, through Block 22 (`0037`). A flight can be held to an altitude
block inside an airspace, which is how two aircraft share one (`0038`).

Two things about the shape before extending it:

- **A range Position works no Strips, structurally.** Guide §4.1's Class column for `RANGE` is "Using
  agency" and its Strip Roles column is "none". `permission.js` refuses every Strip op to the
  `USING_AGENCY` class in `canMutate`, by class rather than by absence from a table — because the
  `RANGES` Facility's Positions are *derived* from the airspace config and are never hand-listed
  (`0035`).
- **Most MOAs have no range control.** A Position exists only for a range that genuinely has one; an
  ordinary MOA is scheduled and activated by the ATC Position that owns the airspace it sits in,
  with no second party and no request step. That is the common case, not an exception.

`crc-sync/config/efsp-airspaces.json` ships **empty** — the real MOAs, ranges, owning authorities and
frequencies are squadron data. `tests/efsp-scenario-airspace.test.mjs` writes its own fixture, which
is the working reference for the config shape. `docs/efsp-usage-guide.md` §8A is the
controller-facing version.

## 3B. The sortie suite, and what it found

**61 tests across seven files** under `crc-sync/tests/efsp-scenario*.test.mjs`, sharing a harness in
`tests/helpers/` — 37 of them named `SCENARIO`, which are the whole-flight walks; the rest are the
guards and edge cases each walk turned up. Each file gets its own durable board, because airspace
and Strip state persist (`0002`) and tests sharing a file share a board.

Walking whole flights, rather than testing one mutation at a time, found seventeen defects — every
one of them in machinery that already existed and looked finished:

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

**`0041` is the one to read if you read only one.** `blockVisibility` was a materialised inclusion
list, so every Block invented after a config was persisted fell outside it and became unwritable —
on the real server that meant `IFR`/`RSVC`/`SREG` could not be set, and since completing a TOFI exit
requires setting `SREG` back to ATC, tactical control could be entered and never left. No test saw
it, because tests build config from the defaults, which derive from the Block Map and are always
current. **It only appears against a config that has been persisted once — i.e. only in production.**
Worth carrying forward as a habit: when something is both configurable and persisted, ask what
happens to it the next time the code grows.

**Concurrency is covered and came back clean.** `efsp-scenario-concurrency.test.mjs` runs two
controllers at one Board — colliding writes, idempotent replay, both ends of a handoff acting at
once, resync inside and outside the ring-buffer window, and a replay against a Strip whose role
changed while its client was away. All of it held first time.

## 4. What's left

**Not started, in the guide's own order (§16):**

- **WP5 — track correlation.** Entry is WP3, which is long done; the guide says it "can proceed in
  parallel once the UI exists". This is the recommendation — see §5.
- **WP6 — the military layer.** Entry is WP4. One of its eight deliverables, §9.11's airspace
  activation authority, is already built (`0036`). Stereo routes (§9.10) are another, and are cheap.
- **WP7 / WP7A / WP8** — ATO ingest, the carrier, instrumentation. D-4 puts ATO ingest off the
  critical path for anything in the tower chain.

**Smaller, known, non-blocking:**

- The server never retracts an obligation alert once raised (`efsp-state.js` says so) — a Strip
  released after a void-time alert keeps the badge until the client reloads.
- Airspace ops are not replayed on reconnect, unlike Strip mutations. Deliberate and tested
  (`efsp-scenario-manning.test.mjs`), but it is a decision, not a law.
- `AIC` and `JTAC` are configured but barely exercised; no scenario drives a Strip through either.
- The D12 audit `0020` asked for is structural in `permission.js` and tested server-side, but has
  never been walked against the rendered UI for a controller holding `TAC_C2` and `CTR` at once.
- `recordMet()` on the obligation monitor still has no caller (WP8).

## 5. Where to start

**Recommended: WP5, track correlation.** It is the piece that connects the Strip board to the radar
picture, which is what a GCI client is for, and every dependency is in place: `strip.correlation`
has been an inert `{ state: 'UNCORRELATED' }` hook since Phase 1, and crc-sync already holds live
track telemetry in `src/tracks.js` fed from DCS-gRPC.

Read guide §6.6 first — six short, specific requirements, and unusually direct about why: identity
reconciliation between the flight-data and track domains is a **named, measured defect class**, not
a join. The real-world numbers are in there (100% of Strip selections highlighted under a second,
but only 85–90% of Strips matched a target). Requirement 2 is the load-bearing one: store the
correlation as its own record with its own history, never a raw track ID on the FDR, because the
underlying track identity *will* change.

Its acceptance criteria suit the way the sortie suite already works: a track identity change must
re-bind on beacon code or raise an uncorrelated warning, and must never silently break the binding.
Write that one deliberately — the guide names it as the defect class to test on purpose.

**Cheap and worth doing alongside: stereo routes (§9.10).** A local canned-route table keyed by short
name, resolvable to a full route, filable without the full flight-plan form. The guide: *"the single
most authentic-feeling military flight-data behaviour available… It is also cheap. Build it early."*
It fits the existing `CreateStrip` seed path — `efsp-flight-plan-lookup.js` already pre-fills an FDR
from a filed DD1801, and a stereo route is the same shape with a local table instead of a lookup.

**If you would rather do WP6:** read its acceptance criteria in §13 before picking a deliverable. The
MARSA course/altitude void interlock (§9.2) is described there as "the highest-value single military
interlock available", and the `[SOURCE-DEFINED]` audit is a criterion in its own right.

## 6. Habits this codebase has earned

- **Write ADRs as decisions get made**, not afterwards and not speculatively:
  `docs/adr/NNNN-title.md`, Context / Decision / Alternatives considered / Consequences. Pure
  bugfixes do not get one.
- **Restart the local crc-sync after editing `crc-sync/src/`.** Node does not hot-reload it, and a
  stale process looks exactly like a broken change.
- **Add a sortie, not just a unit test.** Every defect in the table above was invisible to
  per-mutation tests and obvious the moment a whole flight walked through. Use `advance()` from the
  harness rather than calling `InvokeNla` directly — the 400ms double-tap guard silently swallows a
  second press, so a chain walked without it passes while doing half of what it claims.
- **Then add the matching UI check.** A green sortie proves the server does the right thing and says
  nothing about whether a controller can ask for it.
  `crc-desktop/tests/efsp-ui-reachability.test.js` renders the real `bay-view.js` and
  `airspace-panel.js` against a DOM stub and asserts the control exists, is enabled when it should
  be, and dispatches the right op. It also holds every writable Block to being reachable somewhere,
  which is what caught §3.8's release model being invisible.
- **Be suspicious of a scripted edit that reports success.** A string replace matching nothing
  silently does nothing; that shipped an uncapped free-text field this session, caught by review
  rather than by the suite. Grep for the thing you think you just wrote.
- **Browser automation was not available this session**, so no UI change here has been clicked in a
  real browser. The reachability tests prove the wiring, not the pixels — drag-and-drop transfers
  and anything layout-dependent are still unverified by eye.
