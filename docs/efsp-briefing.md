# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent or session. Read this, then the part of `EFSPImplementationGuide.md`
your work names, then write a plan before writing code. This is a handoff, not a build order.

**This revision supersedes the previous one.** The remaining EFSP work is being finished by many
agents at once, in waves of parallel lanes (`docs/efsp-parallel-plan.md`, history). **Waves 1, 2 and 3, the
architecture refactor (W1-W7, ADRs `0095`-`0097`) and the vocabulary rename are merged** into `efsp-wp5-correlation` (§1). Wave 1
(§3I) landed runway status (server), MTR fields, the USMTF ATO parser, the carrier model, WP8 metrics and
the soak harness, retracting obligation alerts, IFF from interrogation, atobrief's USMTF export and the
gRPC reconnect fix. Wave 2 and the fixes between waves (§3J) landed the runway-status panel, hung
ordnance, alert/scramble, the ATO on the Board and the AR join, the METRICS panel, the `9F` picker and
the time fallback chains, the STARS scope, magnetic headings, mission sessions, archiving, Board sync
correctness, the tactical Positions' fixes, audit completeness and block altitudes. Wave 3 (§3J) added
the carrier Positions and Facility (L17), the suggestion chip and staleness (L19), the UI follow-up
(UI-A), the per-theater transition altitude (TA), the client-mirror parity tests (PARITY), the soak
fixes (SOAK) and the infra hygiene lane (HYG); the client half of Incirlik's pattern board and FINAL
component (L18) was already in, and now its server half (RSU/SFA/PAR, ADR `0093`), SOAKW (the soak's
not-judged memory rule) and L28 (OVERFLIGHT lifecycle, ADR `0087`). UI-B (client resync wiring), QAS and E2E-harden were merged afterwards. The refactor moved
the code into `board/`, `wire/`, `sync/`, `authority/` and a client of native ES modules; the rename gave every
identifier, wire name and doc word the FAA-based vocabulary (`docs/glossary.md` maps old words to new ones: read it
before any ADR or note older than the rename). **L20** (the comment and pointer sweep, plus the `[SOURCE-DEFINED]`
sweep) is complete (S-L20-DONE). After the rename came the post-refactor features (ADRs `0098`-`0106`, not folded here, §3K) and the
**architecture check (H103)**: its 15 bugs and its three phases (bugs, tests and tooling, structure) are merged, and so are ARCHIVE-12H (`0107`),
MISSION-CLEAR (`0108`), CARRIER-ATO (`0109`), consolidation as hat offers (`0110`), NX-1, THEATERS, DESK-SPLIT and DESK-NOTICES: §3K says what changed
and the traps. After phase 3 came the **panels** (§3K, "Panels and Divert"): the tabbed Settings panel, Divert (`0111`), the carrier's one
state and the NATOPS EAT (`0113`), the MARSHAL recovery board (`0114`) and its server-side marks (`0115`), the CARRIER MAP, the side number
leading on carrier Strips and views, the wire-surface scan of the carrier half, the PAR sample and panel (`0112`) and, reversing the carrier
half of `0112`, **the PAR as an airfield feature** (`0116`). **Phase 3 is done.** The human then ran a **live test** (2026-10-11, findings T1-T31):
its **fix batch is merged** (§3L: terrain WebP, client fixes, airspace fixes, correlation, the single frequency approach without an SFA Position (`0117`),
Strip fields, the PAR missed approach, flight following, Mode C intruder and MARSA groups (`0118`), the airspace-conflict alert (`0119`)), except the
RSU. **Round 2** (the human's findings U1-U21 of 2026-10-13) has started: U-STRIP is merged (§3L); §5 lists what runs and what is queued. Up to
**four lanes run in parallel** since 2026-10-14 (S-ARCH-62); §4 lists what is open.

If you are a lane agent, your own briefing in `docs/parallel/wave2/` and
`docs/parallel/lane-rules.md` come first, and **`docs/parallel/decisions.md` overrides both**. If you
are the supervising session, start at `docs/parallel/supervisor-handoff.md`.

## 1. State of the tree

Integration branch `efsp-wp5-correlation`. It carries waves 1-3 (including UI-B, QAS, E2E-harden), the
architecture refactor W1-W7 (FREEZE, then BOARD, WIRE, SYNC, AUTH, APP, DATA, TIME, LOG, the ES-module client, BACKCOMPAT
and the W7 RENAME), L20, the post-refactor features, the whole architecture check (phases 1-3) and the panels (§3K), the live-test fix batch
and round 2's U-STRIP (§3L), up to `543c1c1f`. Not pushed.

Green, as recorded on the U-STRIP tree (`19c0ef1c`, S-ARCH-61): **crc-sync** `npm test` **2740**, **freeze** (`npm run freeze`, opt-in) **56/56**,
**walk** (`npm run walk`, depth 4) **23/23**, `wire-protocol.test.mjs` 9/9 (protocol stays **2**), **crc-desktop** `npm test` **1296**; `soak:selfcheck`
last PASS on the LT-AIRSPACE-ALERT tree (S-ARCH-58; U-STRIP moved no Board, wire or hub file). sourcedcs-web, atobrief, infra and the Python `tools/tests` were last counted earlier (web 151 and infra 27 at S-ARCH-11, pytest 363 at S-ARCH-28; not re-measured).
**Playwright:** the last full sharded run (S-ARCH-58, on the LT-AIRSPACE-ALERT tree) was **249/249**. U-STRIP ran its own `u-strip` 9/9 and 112
regression specs on `E2E_LANE=7`; the sharded run on its tree was started at S-ARCH-62 (read its summary line: **the sharded runner exits 0 even
when a spec fails**, S-ARCH-54). Watch `l4-drag` 172 (Rack-to-Rack drag, S-ARCH-57). Under load many specs fail that pass alone: re-run a failure alone before counting it (S-ARCH-14's rule). Every spec must
`require('./helpers/test')` and leave no Strips on the Board (E2E-fix, §3J). `ordnance-hung`'s "pilot walks" test needs `runway-status.spec.js` to have run first (it
relies on the active runway), as on the baseline. A fresh worktree needs `npm ci` in `crc-sync`, `crc-desktop` and `crc-desktop/app` (a missing `app/node_modules` fails the packaging test).
Restart the local crc-sync on :3000 after any `crc-sync/src` change.

ADRs: `0001`-`0119` except `0090` and `0092` (0117 the single frequency approach and the PAR final, 0118 CA/MCI and MARSA grouping, 0119 the
airspace-conflict alert and the using agency; `0120` (U-RSU), `0121` (LT-GROUND) and `0122`-`0125` (U-RELEASE, U-PAR, U-MOA, U-JURISDICTION)
are reserved for queued or running lanes; 0095 structure, 0096 clocks, 0097 logging, 0098-0106 the post-refactor features, 0107 12 h archive, 0108 mission reset, 0109 carrier ATO lines, 0111 Divert, 0112 the PAR sample (its carrier half replaced by 0116), 0113 carrier state and EAT, 0114 recovery board, 0115 the marks on the stack entry, 0116 the PAR is an airfield feature; 0110 consolidation, which stays "Proposed" as committed: its acceptance is decisions.md S-ARCH-25 plus H111/H113, P4). `0077` is the L20 house style; `0090` and `0092` were not used (TA took none: it applies `0085`/H62), `0060` is the errata ADR.
**An ADR is never edited once committed (P4)**: a correction is a new ADR.

**Layout (ADR `0095`).** `board-store.js` is the `BoardStore` facade; the work is in `board/` (collaborators) and
`board/ops/` (one file per Board op, `{kind, authorize?, apply, auditFields?}`). `wire/` holds the `/feed` handler's
skeleton and `wire/families/` one file per wire family; `efsp-ws.js` binds them. `sync/` is the replay cache and the
sync log. `authority/` holds who may do what (`positions/`, `strip-types/`, `classes.js`, `op-kinds.js`; `permission.js`'s
`canMutate` evaluates them). `stores.js` is the registry of persisted stores and `PERSISTED_SHAPE`: an unknown key or an
old shape in `state/` stops start-up. `crc-sync/src/app.js`'s `createApp()` is the composition root with the named
tickers; `server.js` only builds the gRPC and SRS clients and listens. Facility data is the four complete
`config/efsp-facility-*.json` (`facility-schema.js`); a missing or invalid one is a start-up error, with no merge.
The CRC client is native ES modules (`crc-desktop/README.md` "Client modules").

```
crc-sync/src/app.js, src/app/             createApp({env}): composition root, named tickers (0095); its pieces in src/app/, two named links in late-binding.js; server.js only listens
crc-sync/src/efsp/synced-store.js         SyncedStore: the base of the five sequenced stores outside the Board (SERVER-SEAMS-2; the SFA store went in 0117)
crc-sync/src/efsp/                        the subsystem — stores, rules, the wire handler
crc-sync/src/efsp/board/, board/ops/      BoardStore's collaborators and one file per Board op (0095)
crc-sync/src/efsp/wire/, wire/families/   the /feed handler's skeleton and one file per wire family
crc-sync/src/efsp/sync/                   replay cache, sync log
crc-sync/src/efsp/authority/              Positions, strip types, op kinds: who may do what
crc-sync/src/mission-clock.js             in-game Zulu, injected into every EFSP time (F1, 0079)
crc-sync/src/mission-session.js           which mission we are in: new session on start/other mission/clock step-back (F3, 0086)
crc-sync/src/magnetic.js                  WMM2025 variation + grid convergence, per-theater override (F2, 0085)
crc-sync/src/theater-context.js           the one conversion point: variationAt, trueToMagnetic, gridToMagnetic, transitionAltFt
crc-sync/config/theaters.json             per-theater table: local offset, transitionAltFt, tmCentralMeridianDeg, magneticVariation override
crc-sync/src/radars.js                    the radar list, derived from mission data + tracks
crc-sync/src/coverage.js                  what each radar is illuminating, one phase for everybody
crc-sync/src/terrain.js, webp-lossless.js  DEM fetch/decode (MapTiler terrain-rgb-v2 is lossless WebP, decoded in pure JS) and radar line of sight
crc-sync/src/grpc-client.js               DCS-gRPC client: poll_rate ≥ 1, unit keep-alive, backoff (LG)
crc-sync/src/surveillance/                what a controller is told about a contact (0059)
crc-sync/src/surveillance/iff.js          classifyIff(): the one place a contact's colour is chosen (0066, 0084)
crc-sync/src/efsp/position-coverage.js     which Positions grant which radars
crc-sync/src/efsp/correlation-*.js        Strip<->contact records (flightDataId-keyed), the ladder, the 1 Hz sweep
crc-sync/src/efsp/marsa-store.js          the MARSA relation, the void interlock, AcknowledgeVoid (0118)
crc-sync/src/conflict-alert.js            CA between tracked targets, MCI against an untracked one (facility `modeCIntruder`), formation/MARSA groups (0118)
crc-sync/src/efsp/conformance.js          ALT/HDG conformance; the tanker block (TANKER_DISTANCE); no heading check on a final (0117, 0118)
crc-sync/src/efsp/airspace-entry-alert.js the airspace-conflict alert by airspace type (0119); vfr.js `hasNoClearance` (parity with the client)
crc-sync/src/efsp/par-final.js            PAR_HANDOFF / LANDED / MISSED_APPROACH conversions and the FinalCall calls (0117); sfa.js the pool
crc-sync/src/efsp/aircraft-data.js        Block 3 parser and the ICAO wake table (LT-STRIP-FIELDS)
crc-sync/src/efsp/runway-status*.js         runway status: pure rules + RunwayStatusStore (0061)
crc-sync/src/efsp/zulu-time.js            typed HHMM -> epoch ms against the mission clock (L2)
crc-sync/src/efsp/forwarding-obligations.js  obligations as state, retracting (0067)
crc-sync/src/efsp/metrics.js, traffic-count.js  WP8 metrics, §11.4 traffic count, log retention (0065)
crc-sync/src/efsp/ato/                    USMTF ATO parser: text -> mission lines, creates nothing (0063)
crc-sync/src/efsp/carrier/                pure carrier model: carrier state (carrier-state.js), stack + Delta + marks (marshal-stack.js), ship banner, handoffs, sun, hull config (0064, 0074, 0113-0115)
crc-sync/src/efsp/carrier-store.js        CarrierStore: SetCarrierState, the stack ops, handoffs; its own wire messages (L17, 0074, 0113)
crc-sync/config/efsp-carrier-recovery.json  carrier tuning: firstFixDme 21, pushSpacingSec 60, fixToRampSec 360 (ours), tanker defaults (0113)
crc-sync/src/surveillance/par.js, par-monitor.js  the PAR sample, airfield final Bays only, `par-sample` frame outside deliverEfsp (0112, 0116)
crc-sync/src/efsp/carrier-tick.js         the ship-state tick from the hull's track (L17)
crc-sync/config/efsp-carriers.json        the hulls (`hullId`, `label`, `match` {`unitName`, `type`, `coalition`}, `angledDeckDeg`; an unknown key refuses start-up, H127)
crc-sync/src/efsp/airborne.js, surveillance-hints.js  "detected airborne" phase and the suggestion/staleness monitor (L19, 0076)
crc-sync/config/efsp-surveillance-hints.json  its four thresholds, read once (P5)
crc-sync/src/efsp/block-map.js            the Block Maps, the interlock tags, MILITARY_BLOCK_NAMESPACE
crc-sync/tools/soak/                      the WP8 soak harness (npm run soak / soak:smoke / soak:selfcheck)
crc-sync/src/state-paths.js               shipped defaults (config/) vs runtime state (state/)
crc-desktop/app/public/js/                leaves (settings, map-handle, picture, view-state, ...), no import cycle (bound 0), no window globals (§3K)
crc-desktop/app/public/js/panels/efsp/    the Strip panel, the change bus, sync-cursor, facility-topology, the airspace board, correlation-highlight, carrier-state/carrier-panel (L17), carrier-management-panel (0113), marshal-panel + marshal-board-model (0114/0115), carrier-map-panel + carrier-map-model, carrier-final-distance (DIST), par-panel + par-model (0112/0116), pattern-board (L18), bay-views (the FINAL Bay line)
crc-desktop/app/public/js/settings-registry.js  registerSettingsTab: one Settings tab per panel (SETTINGS-TABS)
atobrief/public/js/usmtf-ato.js           atobrief's USMTF ATO export (0078)
docs/adr/                                 the reasoning behind every decision below
docs/efsp-usage-guide.md                  how a controller actually drives it
docs/parallel/                            the lanes: decisions.md (the record), briefings, research
docs/wip/                                 each lane's notes (waves 1-3 folded by DOCFOLD and DOCS2; the phase-3 notes by DOCFOLD-3 and moved to `docs/wip/folded-phase3/`; the integrator removes them at the end)
crc-desktop/e2e/                          Playwright specs — the bugs the DOM stub cannot see
```

## 2. What's built

**WP0–WP4** (Phase 1 / Phase 2). Domain model and Mutation protocol (`0001`, `0002`); Position
staffing, combination, handoff, self-coordination, per-acting-Position permission (WP1A); the
Block Map as data; Bays/Racks/drag/gestures/search; States, NLA, the transfer protocol and a 30s
Undo (`0007`–`0012`).

**WP4A, both slices.** The civil half (`0013`–`0024`): the `CENTER` Facility, the 5 ATC↔ATC
coordination primitives, D13 per-Facility Strip replication, forwarding obligations, release across
the boundary, airspace ownership as a direction, the `OVERFLIGHT` strip type and `ConvertToArrival`. The
military half (`0025`, `0026`): a `positionClass` concept making D12 true by construction, the
`TACTICAL` Facility, a minimal `MISSION` strip type, and TOFI as its own sub-protocol.

**The `RANGE` Position** (`0034`–`0038`). See §3A.

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

**The Strip layout, conformance and Conflict Alert (CA), and what the wire may say** (`0055`–`0059`). See §4's
notes on them.

**In-game Zulu is the one clock (F1, `0079`).** crc-sync owns a `MissionClock` whose `now()` is the
DCS mission time as Zulu. Every EFSP time gate, the Strip clock, vul windows, MTR times and metrics
buckets take it **by injection**, never `Date.now()` (H11). The theater's local offset comes from
`config/theaters.json` (Syria Z+3), not a controller setting.

**Wave 1 of the parallel lanes** (`0061`–`0067`, `0078`, `0084`). See §3I.

**Waves 2 and 3 and the fixes between them** (`0068`–`0076`, `0080`–`0086`, `0088`, `0089`, `0091`; `0093` on
a branch). See §3J: the runway-status panel (L1b), hung ordnance (L12), alert/scramble (L13), the ATO on the
Board (L14), the METRICS panel (L15), the `9F` picker and time chains (L16), the STARS scope (L22),
archiving (L24), Board sync correctness (L27), the tactical Positions (L23), audit completeness (L26),
block altitudes (U6), magnetic headings (F2), mission sessions (F3), typed time Blocks (F4), the carrier
Positions and Facility (L17), the suggestion chip and staleness (L19), the UI follow-up (UI-A), the
per-theater transition altitude (TA), the client-mirror parity tests (PARITY), the soak fixes (SOAK), and
Incirlik's pattern board and FINAL component (L18, both halves; the FINAL component is now the PAR panel, §3K).

**The panels and Divert** (`0111`-`0116`). See §3K: the tabbed Settings panel, Divert, the carrier's state and the NATOPS EAT,
the MARSHAL recovery board and its marks, the CARRIER MAP, the side number, the PAR sample and panel, and the PAR as an airfield
feature only.

## 3A. The RANGE Position

An airspace is a first-class entity in its own store (`0034`), carrying the guide's four state names,
a booked window, an append-only history, and a real approval round trip between the using agency and
whichever ATC Position owns it (`0036`). Flights are approved onto a working frequency, or onto a
range control tower's own frequency, through Block 22 (`0037`). A flight can be held to an altitude
block inside an airspace, which is how two aircraft share one (`0038`).

Two things about the shape before extending it:

- **A range Position works no Strips, structurally.** Guide §4.1's Class column for `RANGE` is "Using
  agency" and its strip types column is "none". `permission.js` refuses every Strip op to the
  `USING_AGENCY` class in `canMutate` (the class is `NO_STRIP_OP_CLASSES` in `authority/classes.js`) — and now every correlation op in `canCorrelate` too — by class
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
- **Coverage follows the Positions you are signed on to.** `positionRadars` in facility config assigns radars to
  Positions by **selector** — `{kind:'approach', airport:'LTAG'}` — never by radar id, because a radar
  id is derived from whatever mission is loaded and a persisted id list is `0041`'s inclusion list in
  a new costume (`0043`).
- **No radar-bearing Position signed on means an empty picture, said out loud.** `OPS`/`CD`/`GC`/`JTAC`
  ship with `positionRadars: []`. A controller signed on to only those gets no contacts and a banner
  saying why. Guide §4.1 and `0033` both lean on Ground and Clearance Delivery having no scope; it is
  now visible in the UI rather than only in a comment.
- **The arrow runs Position ⇒ coverage**, which is the inverse of what `0033` rejected. `0033` refused
  to derive *Positions* from radar selection; this derives *visibility* from a declaration of
  authority, which removes the hazard `0033` named rather than reintroducing it. `0029` is untouched.
- Illumination is **computed, not sampled** (`0043`). The old sweep tested a ±4° window on a 50 ms
  tick against a ~22 ms beam dwell, so it silently missed contacts; the server computes the instant
  the beam crosses a bearing, which makes the tick rate a delivery choice rather than a fidelity one.
- Terrain LOS moved with it (`0044`), cached in memory and on disk, pre-warmed on mission load, **failing open** while warm.
  Needs `CRCSYNC_MAPTILER_KEY`; without it the picture works and masks nothing, logged once. **`0044`'s "PNG instead of
  WebP" is out of date** (LT-TERRAIN, S-ARCH-48, no superseding ADR): `terrain-rgb-v2` serves lossless WebP only, so every
  tile failed and nothing was masked until the fix. `src/webp-lossless.js` is a pure-JS lossless (VP8L) decoder (RFC 9649,
  byte-identical to libwebp 1.6.0 on 11 real tiles, refuses lossy and animated WebP); tiles are fetched and cached as
  `{z}/{x}/{y}.webp`, and the PNG decoder stays, picked by magic bytes. Still no dependency.

What went away client-side: `enabledRadarIds` and its localStorage key, the radar selector and its
search box, `getAllRadars`/`_buildAllRadars`/`getActiveRadars`'s old body, the 50 ms sweep, and the
DATALINK toggle (its radar half is a `coalition:'own'` selector now; its lock-lines half moved to
Settings). `los.js`/`elevation.js` survive **for the debug overlay only** — the server's answer is
authoritative, and `los-panel.js`'s header says so.

## 3C. WP5 — track correlation

`strip.correlation` was an inert hook keyed by `stripId`, and **the key was wrong** (`0045`). One flight data
legitimately has several Strips — per-Facility replicas, a TOFI `MISSION` Strip, an arrival converted
in place — so a per-Strip correlation lets two replicas of one airframe disagree about which contact
it is, and two answers to an identity question *is* the defect class §6.6 exists to prevent. The
record is keyed by `flightDataId` in a fourth store, peer to the other three.

- The ladder is §6.6 rule 1's four rungs, run as **one ordered claim sweep** so a higher rung always
  claims a contact first. Two **contacts** matching one flight equally is ambiguous: nobody gets them, and the
  flight is told so, with the candidates (`0046`). Two **flights** claiming one contact at the same rung (a duplicate
  code) is not: the first in sweep order takes it, and since LT-CORRELATION the other's `TRACK_LOST` detail names the
  flight that has it (`tick()`'s docstring still says "neither gets it": wrong, queued for cleanup).
- **The beacon rung has no former-holder exclusion (H135, LT-CORRELATION).** An active Strip's assigned discrete code
  acquires the contact squawking it even if a finished flight once held that contact (JO 7110.65BB ¶5-3-3 d, ¶5-3-4),
  which supersedes `0076`'s S-L27 for rung 2 only; the callsign rungs (3, 4) keep `_formerHolder`. No ADR. An AI
  contact squawks the synthetic 6xxx block, which Block 5 refuses, so it is never acquired by code. The code source was
  checked both ways (`efsp-correlation-code-source.test.mjs`): the label and the beacon rung read one `Transponders`.
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
| `releaseFlightData` had no reference counting, so retiring a MISSION Strip freed the code of a still-airborne flight | `0028` |
| `actingPositionId` was an unchecked client claim | `0029` |
| `ConvertToArrival` discarded an open coordination or TOFI link with no guard | `0030` |
| TOFI had no (strip type, state) eligibility gate | `0031` |
| Airspace ownership overwrote its own history, and was never cross-checked against a TOFI exit | `0032` |
| Nothing routed to `assigned.departureRelease` or `assigned.voidTimeUtc` — §3.8's release model was unreachable | `0039` |
| The EDCT and call-for-release windows were derived on every write and read by nothing | `0039` |
| A Strip could be created in a Bay the Facility does not have: accepted, holding a code, invisible | `0039` |
| Releasing an airspace with flights still in it said nothing | `0038` |
| `ConvertToArrival` erased every annotation on one click, with no undo | `0040` |
| Airspace ops were invisible to the Mutation log, so a refused request left no trace anywhere | `0040` |
| **The shipped facility config silently hid every Block added after it was written** | `0041` |
| The Board snapshot was rewritten non-atomically after every Mutation | `0041` |
| Nothing checked a restored snapshot's Strips, flight data and code pool agreed | `0041` |
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
| **OVERFLIGHT had no Block meaning "ATC assigned this course/altitude"** — so §9.2's interlock was silently unreachable on one of the three ATC strip types, and its acceptance criterion would have passed anyway | `0051` |
| **DEPARTURE's Blocks 20 and 21 were labelled `SCRATCH`** since Phase 1 — they are the guide §6.2's own "Heading" and "Initial altitude"; ARRIVAL/OVERFLIGHT's meaning had been copied onto DEPARTURE. `CONFIRM_VACATED_ELIGIBLE_BLOCKS` has listed DEPARTURE's `21` all along, which only makes sense for an altitude | `0051` |
| `.efsp-coordinate-submit` has had no CSS rule since WP5, so the bind picker's candidate rows render as default browser buttons inside a dark popover | `0051` |
| **`DropStrip` had no affordance anywhere** — never state-gated server-side and OPS always held the permission, but the only way to ask was the `.drop` dot-command, so an OPS controller who proposed the wrong Strip had no visible way to undo it. `efsp-ui-reachability.test.mjs` held every writable *Block* to being reachable and said nothing about *ops* | — |
| **The no-radar-coverage overlay was `position: fixed; inset: 0`**, so an empty scope washed out the entire application — Strip panel, radio, airport panel — when the only thing with nothing to show was the map | — |
| **Five of six MARSA interlock Blocks could not be reached from the panel at all**, along with guide-REQUIRED Blocks including `9A-FUEL` — `_buildBlockCell` was only ever called from the compact list, and the "annotation editor" that `DELIBERATELY_NOT_IN_COMPACT_VIEW` excused them to was never built | `0055` |
| **§3.7's append-only history had never been rendered** — the server kept, persisted and broadcast every superseded entry since Phase 1 and `resolveBlockValue` discarded all but the ACTIVE one before it reached the DOM. No strikethrough CSS existed anywhere; `PREPLANNED` appeared zero times in the repo | `0055` |
| **The expand toggle did nothing on screen** — `_reconcileRackStrips` decided whether to rebuild an element from `rev` and selection only, and expansion is client-local state that moves neither, so the reconciler reused every element unchanged. The first test written for it asserted the `data-expanded` stamp rather than the rule, and passed with the fix reverted | `0055` |
| **The bind and MARSA popovers were missing from `_isProtectedStripEl`**, so another controller's board delta destroyed either one mid-interaction — the third time that list was found incomplete after the same bug | `0055` |
| **A resync from a client AHEAD of the server was served a delta, not a snapshot** — `currentSeq - lastSeq` goes negative when the server restarts with a cleared or rolled-back Board, which passes the window check trivially, so the server replayed from an empty ring and answered "nothing changed" to a client holding a whole Board of Strips that no longer existed. They never went away, and reconnecting did not help | — |
| **`efsp-block-map-parity.test.mjs` did not compare `interlock`** — adding the assertion failed immediately: the client had never carried the tag `0051` introduced, so the server could mark a Block and the panel could not know | `0052` |
| …and it did not compare `target.field` either, so a `tofi`/`military` Block could route to the wrong key of the right object on one side only | `0052` |
| **`efsp-ui-reachability.test.mjs` did not count a boolean-toggle Block as writable**, so the one test whose job is noticing an unreachable Block was blind to a whole class of them — harmless only because `IFR` was the sole example and happened to be in the compact view | `0052` |

**`0041` is still the one to read if you read only one**, and `0043` is the second. Both are the same
lesson from different directions: a shape that is correct the day it is written and wrong afterwards.
`0041`'s inclusion list froze a Block set; `0043`'s sampling tick was a fidelity decision disguised as
a performance constant. Worth carrying forward: **when something is both configurable and persisted,
ask what happens the next time the code grows** — and when a constant decides whether something is
detected at all, ask whether it should be arithmetic instead.

**Concurrency is covered and came back clean.** `efsp-scenario-concurrency.test.mjs` runs two
controllers at one Board — colliding writes, idempotent replay, both ends of a handoff acting at
once, resync inside and outside the ring-buffer window, and a replay against a Strip whose strip type
changed while its client was away.

## 3E. Stereo routes

§9.10's canned-route table, WP6's cheap deliverable (`0050`). `stereo-routes.js` is squadron config
on `0048`'s `config/`-vs-`state/` split; `createFlightData()` expands a short name into a complete flight data
**server-side**; Block `9F` (`STEREO`) carries the name and writing it re-files the flight; a
`<select>` beside the callsign box and `.stereo PACK1 VIPER11` both file one. WP6's acceptance
criterion is asserted verbatim in `efsp-scenario-stereo.test.mjs`.

**Three things worth knowing before touching it:**

- **The table ships the squadron's Incirlik departures** (KEMER1, MANAZ2, MANAZ3, TARSU4, from the human
  2026-10-12). Real Pack routes are squadron data; inventing them is D11. With an empty table the picker
  stays visible, disabled and empty (H134). **They have not yet been used in a live session**. `0050`'s
  Consequences lists what discharges that (the usage guide's §4A schema, the scenario fixture).
- **A stereo route sets no remarks, and the loader is strict (U-STRIP, H138 U4, S-ARCH-61).** `remarks` left the shipped
  table, `toFlightDataFiledSeed` and the validator; the picker shows the name only (`description` stays in the file and
  the API answer, never shown or filed). `validateStereoRoutes` refuses any key outside `name`, `route`, `active`,
  `description`, `departureAirport`, `destinationAirport`, `requestedAltitude`, so a `state/efsp-stereo-routes.json`
  that still has `remarks` **stops start-up** naming the file and key. The four removed remark texts are quoted
  verbatim in `docs/wip/U-STRIP.md`.
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
keyed by `marsaId`, whose participants are `flightDataId`s — `0045`'s key choice reused, and for the same
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
  to the interlock. Per-strip type, because **DEPARTURE's Block 7 is the filed request and ARRIVAL's is
  the assigned altitude** — same id, opposite answers. A list elsewhere is `0041`'s frozen inclusion
  list again.
- **OVERFLIGHT had no assignment Block at all** and gained two (`7A`, `9A-VECTOR`). Without them the
  acceptance criterion passed on two strip types and quietly did not hold on the third. Worth carrying
  forward: *when a rule is per-strip-type, check every strip type, because the test that passes is not the test
  that matters.*
- **The relation owns `separationRegime` while ACTIVE**, and a direct `SREG` write is refused with a
  reason pointing at End/Void. Two answers to "who is separating these aircraft" is the defect class.
  Anything that touches `flightData.tofi.separationRegime` now has a non-controller writer to account for.

Unlike a correlation record, **a relation survives a restart intact** — a persisted track id is a
lie after a restart, and a recorded verbal declaration is not.

## 3G. The military Block namespace — settled once, on purpose

`flightData.military` was the literal `null` of a `// WP6 hook` comment. `0052` turns it into an object in
one pass, so §9.5, §9.6, §9.7 and §9.4 add **behaviour** rather than each adding schema and each
answering the same three questions differently.

The part worth not re-deriving is the naming, which had been asked and answered four separate
times (`0026`'s frozen `M1`–`M8`, `0050`'s `9F`, `0051`'s `3F`, and three more deliverables
waiting):

- **The guide's §6.4 `M`-numbers are never Block ids on an ATC Block Map.** The `M`-prefix belongs
  to `MISSION_BLOCK_MAP`, which `0026` froze with *different* meanings — its `M4` is the beacon,
  the guide's `M4` is IFF Mode 1/2. A test holds every ATC strip type to using no `M`-prefixed id at all.
- **Sub-letter the field onto its parent Block**, and cite the guide's number in the comment. That
  is what `3A`–`3E`, `8A`/`8B`, `9A`–`9F`, `5A` and `14A`–`14D` already do. So: `3G` ordnance
  (`M14`) and `3F` hook (`M15`), both in the 3-family because **the 3-family is the airframe**.
- **The mapping lives in code**, as `MILITARY_BLOCK_NAMESPACE` in `block-map.js`, asserted against
  the Block Maps *and* against `setMilitary`'s allow-list. A comment drifts; this fails a test.

Four things to know before extending it:

- **Both new Blocks are on all three ATC strip types, and neither was on MISSION.** (**Amended by H55,
  `0069`: `3G` is now also on `MISSION`**, appended as `MISSION_BLOCK_MAP`'s last row, because a pilot
  reports hung ordnance to whoever they talk to; it is still the same flight data field, so one fact with a
  second surface. `3F` stays off.) `0051`'s lesson
  applied rather than remembered. MISSION is left out deliberately: it shares its `flightDataId` with the
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
- **`restore()` seeds the namespace onto a flight data that predates it.** Every board that has ever run
  has `military: null` on disk; without the seed a §9.5 reader throws on exactly the flights that
  were airborne when the service restarted. The client guards the same case, because nothing
  reseeds a flight data already in a connected client's cache.

**`3G` `HUNG` is an advisory now (L12, `0069`) and `alertStatus` is Block `14E` (L13, `0070`)**; see
§3J.


## 3H. The mission line exists from tasking — and one hole found on the way

`TAC_C2` can frag a **mission line** against a filed flight before the jet moves
(`0054`), instead of waiting for TOFI to mint one. `TASKED` finally means something:
it used to be reachable only at the moment TOFI was proposed, by which time the
aircraft had been airborne for twenty minutes, so the MRU's first action was pressing
"Airborne" on a jet that already was.

Five things to know before extending it:

- **The shared `flightDataId` IS the link.** No link object, no join table. That is already
  how this codebase answers "same flight?" everywhere (TOFI replicas, coordination
  replicas, correlation `0045`, refcounting `0028`, the `+N` badge), and it is what
  makes the binding work in **both directions for free** — WP7's ATO-first case is the
  same op run later, so it is a caller change rather than a mechanism change.
- **`CreateStrip` takes an optional `op.flightDataId`**, mutually exclusive with `op.flightData`,
  deliberately **strip-type-agnostic**. Its duplicate check scans the LOCAL Board only: the
  global `liveStripsForFlightData` is strip-type-blind, and the coordination primitives legitimately
  put same-strip-type Strips for one flight data on two Boards.
- **TOFI finds before it mints**, and `mintedForTofi` is what keeps that safe.
  `bayForImpliedState` **falls back to `bays[0]`** when no Bay implies the state,
  TAC_C2's `bays[0]` is `tac-c2-tasked`, and TAC_C2 has no Bay for `OFF_STATION` or
  `RTB` — so a relocation copied blindly onto the reuse path files a working mission
  line back under *Tasked*. The same flag decides that a rejected exchange retires the
  Strip it minted but never one TAC_C2 tasked itself.
- **Unbind is Drop, and there is no re-bind.** Mutating a Strip's `flightDataId` would drag
  correlation, MARSA membership and refcounting with it. A mis-bind is catchable
  instead: `M3` renders the bound flight's callsign, so the wrong jet shows the wrong
  callsign immediately.
- **While a TOFI is ACTIVE neither Strip can be retired.** Pre-existing, now reachable
  far more often, and walked in the scenario suite so it is a known property rather
  than an 0200 surprise.

**And the hole (`0053`).** Nothing ever required `flightData.tofi.separationRegime` to be set.
`TOFI_EFFECTS`/`tofiEffect` in `coordination.js` **is dead code** — it looks like it
applies the exchange's effects and has no runtime consumer at all — so the whole of
tactical control could run with the flight data saying nothing about who was separating the
aircraft, and the EXIT gate then failed twenty minutes downstream for a reason nobody
could trace. Accepting an ENTRY now **requires** the regime, asked for and never
derived (defect D14), with a picker beside the Accept button. An ACTIVE MARSA relation
is the one exception — it owns the regime (`0051`).


## 3I. Wave 1 — what each lane left, and the traps

Each lane's full notes are in `docs/wip/<lane>.md`; what follows is what the next agent needs.

**Runway status, server (L1, `0061`).** `RunwayStatusStore` is the **sixth store**: one record per
Facility with a `runwayStatus` inventory (INCIRLIK only), its own `rev`, its own sequence
(`runwayStatusSeq`) and its own delta (`efsp-runway-status-delta`). That last one is a deliberate
deviation from rule 5's "broadcast on the Board sequence". Every op is audited, refusals and
`STALE_REV` included, under `runwayStatusFacilityId`.
- The inventory (runways as pavements with `ends`, `endHeadingsTrue`, `rackIds` per end,
  `arrestingGear`, acknowledgers, inspection authority, pads, `airportIcao`) is the `runwayStatus` section of each
  `config/efsp-facility-*.json` [at the time of writing it was `DEFAULT_CONFIG`, a literal in `facility-config.js`, which DATA-1
  deleted: S-M-DATA1], read once and never written. Status, suspension, closure, inspection, requests, `activeRunway` and
  `runwayChange` are store state only. One record per pavement (`05/23`), the active **end** on the
  Facility (S-Q23).
- `runway-status.js` is pure: the status machine (the absent `SUSPENDED_BARRIER_CHANGE → OPEN` edge
  *is* rule 2: only the inspection reopens), runway resolution (target rack → rack → flight data 8A/8B →
  active end → fail open, S-Q25), the inhibit wording, the into-wind end, `runwayAdvisoryFor`,
  `runwayRackFor`.
- **LC alone closes, opens and suspends** (H18). OPS, CD, GC and AP send `RequestRunwayStatus`,
  and LC accepts or rejects. OPS completes the works and signs off the inspection. The runway-change
  machine takes OPS/AP acknowledgements as coordination, not permission; an unstaffed acknowledger
  is skipped and audited (H20); `SelfCoordinateRunwayChange` is the solo case (S-Q24).
- `nla.js` reads `ctx.runwayStatusFor()`, default null, failing open. `board-store.js` threads it
  through `nlaCtx` [then `_nlaCtx`] (`board/placement.js`), judges a drag against the target rack, files Strips by runway through
  `placementRack` [then `_placementRack`] (fixing "NLA always queues to `rwy-05`"), and refuses a `SetState` into a
  runway-using state on an unusable runway (S-R2-14). `FINAL → LANDED` is never inhibited (H19).
- **The suspension kind is `BARRIER_CHANGE` today, and H52 makes it generic "runway works +
  inspection".** L1b renames the kind and labels. Gear is data only (H17: DCS has no wires): no
  `SetGearState`, Incirlik ships `arrestingGear: []`.
- The active runway comes from the mission wind once per mission (`deriveActiveRunwaysFromWind` in `src/app.js`, called from its `mission-load` handler [then a `server.js` hunk], compared against each end's **true** heading, H22). It sends through the public `WsHub.broadcastEfspRunwayStatusDelta` (L1b).
- Traps: never add runway-status kinds to `OP_KINDS`; the session binding is per-Facility, not
  "Primary somewhere"; `missionKeyOf` is gone: F3 hoisted it as `missionFingerprint` in `mission-session.js`.

**MTR fields (L2, `0062`).** Six plain `flightData` Blocks on DEPARTURE/ARRIVAL/OVERFLIGHT, none on
MISSION: `9G-MTR`, `9G-ENTRY`, `9G-TIME` (M10) and `9H-EXIT`, `9H-TIME`, `9H-ALT` (M11), each one
leaf of `flightData.military.mtr`. `MILITARY_BLOCK_NAMESPACE` rows use either `blockId` or `blocks`, never
both and never a wildcard. `compactBlocksFor(stripType, positionId, flightData)`: the third argument adds the
flight's conditional MTR group, and **the face (`strip-view.js`) and ▼ (`bay-view.js`) must pass the
same flight data**, or a Block ends up on both or neither. **Times are epoch ms** (S-L2a): `zulu-time.js`
(`resolveZuluHhmm`, nearest occurrence within ±12 h of the mission clock) on the server,
`ZULU_HHMM_BLOCKS`/`formatZuluHhmm` on the client. Don't store a typed string. `.efsp-expanded-note`
is the place for an advisory that is not a warning.

**USMTF ATO parser (L3, `0063`).** `crc-sync/src/efsp/ato/ato-ingest.js`'s
`ingestAtoText(text, { referenceUtc })` turns USMTF text into mission lines, **creates nothing** (no
flight data, Strip or code) and never throws. Pass `missionClock.now()`, never `Date.now()`. Each line is
`{ lineId, sourceLines, provenance, flightDataSeed, military, extras: { ato, identityAto }, warnings }`
(S-Q50, S-R2-8): `flightDataSeed` holds only what `createFlightData` accepts; the normalised callsign,
`seedable`, `missingAcceptanceFields` and the mission number live in `extras.ato`. The ATO's Mode 3
is reported in `extras.identityAto.modeThree` and never seeded as a beacon. `ATO_FIELD_TARGETS`
names the flight data path of every ATO value and whether anything can write it today (most can't: Mode
1/2, SCL, `arInfo`, datalink are L14's). USMTF is the only input (H1). The set layouts come from a
community wiki, cross-checked in `docs/parallel/research/usmtf-ato.md`; none is doctrine.
Agency types live in one table (`ato-sets.js`, H45/H54: `OTR` + callsign until answered).

**Carrier model (L4, `0064`).** `crc-sync/src/efsp/carrier/`, pure: the Marshal stack index drives
angels, DME and push time; Case as a value; the ship banner; `flightData.military.carrier`; the transfers
table. **Wired by L17 (`0074`, §3J)**: the CARRIER Facility, the strip types, the store and the client. Hull CVN-72 `UNION`
(H13/H26). Every bearing is held **true**; grid convergence and magnetic variation are injected (F2
supplies both), and a value is labelled `G`/`T` when one is missing, never shown as magnetic.
Marshal radial defaults to final bearing + 180 and is settable (H27); no automatic compression
(H28); an insertion ripple stops at the first vacancy; `lowStateLb` is not M17. [Since `0113`: push time is no longer
Charlie + slot; the EAT is worked back from the ramp time, and the Case, radial and ramp time are carrier state (§3K).]

**Metrics, traffic count, log retention (L5, `0065`).** Server only. `GET /api/efsp/metrics`
(`?hours`, `?missionSession`) and `GET /api/efsp/traffic-count` (`facilityId`, `from`, `to`,
`detail`, `missionSession`), both authenticated, neither naming a controller (H35). The contract
for L15 is `tests/efsp-metrics-contract.test.mjs`, and it differs from L5's briefing (list in
`docs/wip/L5.md`). The tap (`createEfspInstrumentation`) wraps `efsp.handleMessage` from
`server.js` [now `src/app.js`] and logs every refused `efsp-mutation` plus `NOT_HOLDING_POSITION` on any mutation
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
and L19's fix is proven by unit test only. Run `soak:selfcheck` after touching `board-store.js`, `board/**`,
`efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**` or `tools/soak/host-core.js`; after a new mutation type, add it to `driver.js`'s cmid list and
`_checkBroadcast`.

**Obligations retract (L7, `0067`).** Forwarding obligations are state now, sent whole in
`efsp-alerts` (the `0058` shape) and recomputed after every broadcasting EFSP message
(the hub's `onEfspChange` constructor dependency, run by `_deliver`). `efsp-obligation-alert` is gone. **One compose function,
`broadcastEfspAlerts()` in `src/app.js` [then `server.js`], builds the message** and a test counts that there is exactly
one call; add anything new inside it, never a second call. Keys are
`facilityId:stripId:obligationType`. `recordMet()` has callers now: `met` is non-zero only for
`ADVANCE_FORWARDING` and `VOID_TIME_EXPIRED` (VOID met = moved past HELD), `missed` counts raised
episodes. `DATA_ONLY_VERIFICATION` still has no "verified" action and stays raised.

**Test debt and the tactical walks (L8, no ADR).** The DOM stubs migrated to
`crc-desktop/tests/helpers/dom-stub.js` (three users now; `coverage-panel.test.mjs` still holds one
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
L15, L16, L22, L24, L27, F2, F3, F4, L23, L26, U6, L18 (both halves), UI-A,
L17, L19, TA, PARITY, GRPC, SOAK, SOAKW, HYG, L25 and E2E-fix. Not yet folded: L28 (merged, notes in `docs/wip/L28.md`), UI-B (merged since), L20.

**Runway status, client (L1b, `0068`).** Three files: `runway-status-rules.js` (the pure mirror of the
server rules: `runwayStatusActionsFor` offers a button only for what Tower or OPS would accept,
`gearMismatchFor`, `runwayStatusAlertsFor`, `runwayStatusSignatureFor`), `runway-status-panel.js` (the dock
panel, closed by default, left cluster) and the state getters `getEfspRunwayStatus(facilityId)` /
`getAllEfspRunwayStatuss()` in `efsp-state.js`, which are the contract for any other chip. The H52 rename
is done (`SUSPENDED_WORKS`, `WORKS`, `BeginRunwayWorks`, `CompleteRunwayWorks`, a request carries
`action: 'WORKS'`) and the runway-status delta is built in `wire/frames.js` (`runwayStatusDelta`) and sent through `deliverEfsp` (S-L1d, SERVER-SEAMS-2).
- **A chip that depends on anything other than the Strip, its flight data or the stores already in
  `bay-view.js`'s `_stripRenderSignature` must add itself to that signature**, or the Strip never
  rebuilds for it (the NLA board delta lands before the runway-status delta). L1b's was one guarded line
  (S-L1b2) calling `runwayStatusSignatureFor`.
- `runway-status-drift.test`-style coverage: `tests/efsp-runway-status-client.test.mjs` replays every
  button the client offers against a real `RunwayStatusStore`. Keep it when adding an op.
- The client derives the runway-change acknowledgers and the inspection authority from the permission
  table's owners (OPS/AP, OPS) because the record did not carry them. **L26 now puts
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

**Hung ordnance (L12, `0069`).** `hungOrdnanceAdvisoryFor(strip, flightData, wireRecord)` in
`runway-status.js` (pure; the wire record is its own inventory, `buildStatusView(record, record)`) and a
client mirror `panels/efsp/ordnance-advisory.js`, held together by the drift test in
`tests/efsp-ordnance-client.test.mjs`: **change both together**. It is a chip plus one reason line,
never an inhibit, and it deliberately recommends no runway (the pad is a placeholder name, H21). It
reads runway status through `getEfspRunwayStatus(strip.facilityId)` and expects `null` for CENTER/TACTICAL.
H55 put `3G` on `MISSION` and S-L12 settled the faces: always on LC's, on AP/CTR/mission lines only
when not CLEAN (`ORDNANCE_WHEN_SET`, `isOrdnanceSet` in `strip-fields.js`), always in ▼.
- The advisory function has the three hook lines in `strip-view.js`, byte-identical to L1b's and
  L13's (S-W2A); `ord` sits before `scram` in `INDICATOR_ORDER`.
- Walks not done: HOOK + HUNG together (needs configured gear, which does not exist), the pad name
  with real client state is covered by L1b's merge (the Playwright spec's `standInRunwayStatus` is now
  redundant and should be deleted), pad occupancy is not read (Q3), no hint in the 8A/8B editor (Q6).

**Alert and scramble (L13, `0070`).** `alert-scramble.js` is the rule module (server, pure:
`activeScrambles`, `conflictingGroundStrips`, `GROUND_STATES`, `accessRouteText`); the client mirror
is `panels/efsp/scramble.js` (`scrambleAlertsFor(strip)`, `alertPadConstraintFor(facilityId)`), held to
it by a drift test, and `#efsp-scramble-line` in `index.html` is the red line. The state is
`flightData.military.alertStatus`, written only by a controller's `SetBlock` on Block `14E` (`M16`,
DEPARTURE) or by the ATO import (`NONE`/`ALERT` only, L14). Nothing is derived into storage, so
nothing needs resetting. `nla.js` never reads it (a test holds that). The access route is
`runwayStatus.pads.alert.accessRoute` in `facility-config.js`, shipped as the placeholder
`ALERT ACCESS TAXIWAY` ([SOURCE-DEFINED], L20).
- **H56 is a permission rule, not an ownership accident**: `NON_OWNER_BLOCK_WRITES` (`authority/positions/civil-atc.js`, assembled in `authority/index.js`, read through `permission.js`'s `mayActBesideOwner`) lets OPS
  write `14E` on a DEPARTURE until DROPPED, whoever owns it (L23 added it, S-L13).
- `traffic-count.js` latches `alertScramble` from the logged `SetBlock`, so a scramble cancelled on
  the ground **no longer counts** as one (L26 changed the classification).
- Walks not done: no two-browser walk (one controller signed on to OPS/CD/GC/LC stood in).
  `scrambleAlertsFor` rescans the live Strips once per rendered Strip (O(n²) per render); fine at
  squadron scale, cache it per render if Boards grow.

**The ATO on the Board (L14, `0071`).** `crc-sync/src/efsp/ato/ato-board.js` (preview, bind
candidates, plan, tasking, AR links, execution, the H68 whole-day date shift), `ato/callsign-fit.js`
(H60: every vowel, leading one included, back to front; unfittable returns `null`, which differs from
miztoyaml on that one edge), `efsp-ato-preview` / `efsp-ato-mutation` on the wire, and on the client
`ato-import.js`, `ato-strip.js` and the OPS "file against ATO mission" picker in `efsp-panel.js`.
- **Carrier flights have ATO lines (H109, `0109`).** `ato-board.js` `carrierOf` marks a line whose DEPLOC/ARRLOC names a hull
  (`carrier/hull-config.js` `hullForLocation`, `hullCode`): `flightData.ato.carrier` and the preview line's `carrier`
  (`{ hullId, hullCode, departs, recovers }`; the key is absent for land lines). `carrier/ato-bind.js` `atoFlightForLaunch`,
  called in `board/ops/create-strip.js`, binds a MARSHAL/LAUNCH `CreateStrip` made from `flightData` to the one ATO flight with that callsign
  that has a live MISSION line and no other live Strip (warning `BOUND_TO_ATO`). `traffic-count.js` `classifyLocality(..., { preDropState })`
  treats the hull as the CARRIER Facility's home field (`homeAirports.CARRIER = ["UNION"]`). Tests: `efsp-scenario-carrier-ato.test.mjs`.
- **The ATO's values live on the flight data through one setter, `flightDataStore.applyAtoTasking`**, never through
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
  selector); Electron (the e2e drives Chromium); `tests/metrics-panel.test.mjs` and `e2e/l15-metrics.spec.js`
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
`resolveTimeChain(name, flightData)` returns `.estimated`, so anything bucketing by takeoff time must check it.
The one new stored input is `flightData.timeInputs.flightPlanDepartureUtc` (from the DD-1801's `depTime`, dated
by the mission clock; `restore()` seeds `timeInputs`). `flightData.ato.departure.timeUtc` feeds the P-time
chain. `ZULU_HHMM_BLOCKS` now covers `M6`/`M7` (the set is derived from the Block Maps by a test), and
`resolveZuluHhmmAfter` dates the vul end. `time-chains.js` loads before `strip-template.js`.
- Opt-in `E2E_STEREO_ROUTES` makes the e2e harness install a stereo table (fixture
  `e2e/fixtures/l16-stereo-routes.json`).
- Open: the state-transition source for takeoff (needs a hook in `board/strip-ops.js` [then `board-store.js`] and a flight data broadcast on
  a state-only Mutation, would be the takeoff chain's next source); **W2** TAXI/TAKEOFF are on no face
  (a GC controller must expand the Strip; owner: the field lists); **W3** a typed TAXI does not follow
  a later P-time change and nothing flags it (a conformance-style hint, whoever takes §10.2 next); **W5**
  an estimate cannot be accepted as the actual without retyping a different value (left open in `0073`);
  the route `description` is not shown as the option's title; editing a vul start does not move a stored
  end, and a start moved past its end is not refused (MISSION validation); a stale MTR exit fix after a
  designator change is still not warned (H23 keeps MTRs free text).

**Mission session (F3, `0086`).** `crc-sync/src/mission-session.js`, persisted to
`state/mission-session.json`, the instance is the `missionSession` const in `src/app.js`'s "F3 mission
session" block [then `server.js`]. A new session (`reason` in `FIRST`, `MISSION_START`, `MISSION_CHANGED`,
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
- **Behaviour fixed on the way:** a LC runway change used to be undone by the next gRPC reconnect (it
  overwrote the `missionKey` the guard compared); the guard now reads its own `windDerivedSession` on
  the runway-status record (a harmless extra field on the wire).
- **No migration.** Existing `efsp-metrics.json` / `efsp-traffic-count.jsonl` can hold session numbers
  from L5's old counter, and the new counter starts at 1: **clear those two files, or accept repeated
  numbers, on a machine with state.** A persisted runway status has no `windDerivedSession`, so its wind is
  re-applied once.
- **Walks not done, human-gated:** whether DCS-gRPC sends `mission_start` to a stream that connects
  *after* the mission has started (if it does, every crc-sync restart rolls the session: restart against
  a running server and watch `[mission-session]` in the log); a real `.miz` restart through DCS.

**Mission reset (H108, `0108`).** At a real mission roll-over the system clears the per-mission state.
`mission-session.js` decides (`onMissionReset(fn)`, beside `onNewSession`): at once for `MISSION_CHANGED`, `CLOCK_STEP_BACK` and a
`MISSION_START` that names a different fingerprint; for a `MISSION_START` on the SAME fingerprint (or none known) only once
`observeClock()` sees the clock more than `CONFIRM_STEP_BACK_MS` (60 s) behind the old session's high-water mark within
`CONFIRM_WINDOW_MS` (10 min wall); never for FIRST, a reconnect or a restart (the pending confirmation is memory only). `app.js`
subscribes: `efsp.resetForMission(session)` (`src/efsp/mission-reset.js`: each Board's `BoardStore.resetForMission`, which
force-retires every live Strip through `StripOps#retire(strip, 'system', { force: true })` and writes one `MissionResetStrip`
entry per Strip and one `MissionReset` entry per Board; then `marsaStore`, `carrierStore`, `runwayStatusStore`, `sfaStore`
`resetForMission()` and `correlationStore.forgetAll()`), persists, delivers one board-delta per Board plus one delta per store whose
seq moved through `deliverEfsp`, and runs the archiver's roll-over sweep, which files what was just dropped. Kept: the active
runway and its wind source, config, airspaces, the Mutation log, metrics. See `docs/wip/folded-phase3/MISSION-CLEAR.md` for the walks not done.

**Typed time Blocks (F4, bugfix, no ADR).** `flight-data-store.js`'s `TYPED_TIME_LABELS` and
`normalizeTypedTime(path, value, nowMs)` are the **only** rule for a typed time: a finite number is epoch
ms already, empty clears to null, a string goes through `resolveZuluHhmm` against the injected clock, and
anything else is `VALIDATION_ERROR` ("<label> must be a UTC time as HHMM, e.g. 1432") with no partial
write. `setField` applies it before the write (so `voidDeadlineUtc` and the EDCT/CFR windows derive from a
number) and `createFlightData` applies it to the two filed times of a seed. `normalizeMtrValue` delegates to it.
A fallback chain must hand `setField`/`createFlightData` epoch ms or the controller's typed string, never a
formatted date. **Persisted flight data that hold a string time are not migrated**; a leftover string compares as
before until the Block is retyped. `efsp-scenario-typed-times.test.mjs` is the sortie (a typed void time
expires; a typed release holds the NLA until reached).

**Magnetic (F2, `0085`).** `magnetic.js` evaluates WMM2025 (`data/wmm/WMM2025.COF`, verbatim from NCEI,
tested against both NCEI tables) at a position and the mission date, snapped to the UTC day.
`theater-context.js` is the server's single conversion point (`variationAt`, `convergenceAt`,
`trueToMagnetic`, `magneticToTrue`, `gridToMagnetic`, `transitionAltFt`, `windFrom`) and builds the
`theater` wire message: **its own message** (a 1° grid covering the airfields' box plus 3°, values to
0.01°, a few hundred numbers that change once a day), not a field on `game-time`. `theater-settings.js`,
its messages and `hdgCorrection` are deleted (and stay deleted: `theater-context.js` and `config/theaters.json`, ADR `0085`). Client: `app/public/js/magnetic.js` (`toMagneticDisplay`,
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
(`Archiver`, `ARCHIVE_AFTER_MS` = 12 h (was 2 h; H107, `0107`), `sweepChanged`, `archiveDeltas`), on the `createEfsp` facade as
`efsp.archiver`, swept every 60 s and rolled on `missionSession.onNewSession` in `src/app.js`'s [then `server.js`'s]
"Archiving finished flights" block. `BoardStore` gains `archiveStrip`, `droppedWallAtOf` (stamped in
`_retireStrip`; any other DROPPED Strip is stamped the first time a sweep sees it), `getDeltaSince`'s
`gone`, and `droppedWallAt` in the snapshot; `FlightDataStore.archiveFlightData`; `traffic-count.js`'s `hasCountFor`.
The archiver builds its own referenced set from every Board (a Strip is archived only when its flight data has no
live Strip and no un-archived DROPPED one). The wire carries `gone` and `flightDataList.gone`
(`wire/frames.js`'s board delta builder passes `gone`/`flightDataListGone` through; `efsp-state.js`'s
`applyEfspDelta` handles `flightDataList.gone`). **ADR 0002's "durable" now means durable until archived.**
- **Soak acceptance was restated, H72:** 4 h run, net-growth limit **25%** (`tools/soak/report.js`
  `THRESHOLDS.netGrowthPct`; no `--warmup-min`, no 8 h run). Measured 17.2% (old 10% gate would fail, and
  so does the pruned baseline at 20.3%): the growth is the capped caches filling (`_appliedMutations`
  1218/5000, ring `_log` 1379/2000), not finished flights. `strips.dropped` and `flightDataList` are flat after
  2 h. **The rows "snapshot within 2x of pruned" and "p50 <= 3 ms" cannot pass with 2 h retention**
  (about 200 Strips and 100 flight data make a 284 KB snapshot) and need restating or a persist fix; the
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
(never a live Strip or flight data), is rebuilt as a result on replay (`replayed: true`, the current Strip), and
the four non-Board handlers (airspace, correlation, MARSA, TOFI) have `_cachedOutcome` / `_rememberOutcome`
blocks. A Mutation without a `clientMutationId` is **never cached** (before, every later cmid-less one was
answered with the first one's result). Crash-once: replay records persist in the snapshot for 10 minutes
(`REPLAY_PERSIST_WINDOW_MS`, loaded at restore unfiltered) and the boot reconcile (`_reconcileLogTail`)
marks any successful, cmid-bearing Board line no Board holds with `op: 'NotPersisted'`, which voids the
earlier line with that cmid. `_handleSetPositions` now persists when it reassigned anything. Persist is
**compact JSON and skips a write whose body is unchanged since the last success**; it stays synchronous
before the ack (no debounce, no batching, either would let an acknowledged change die with the process).
`code-allocator.js` keeps a rotating cursor (`flightData.codeCursor`, beside `flightData.codes`).
- Traffic count: a retried drop gets the same `countId`, so `liveCountRecords` and `_index` read
  COUNT/VOID in file order (a COUNT after a VOID revives it); `reconcile({ backfill })` replays the
  markers; `isNotPersistedDrop` is exported.
- Harness: `driver.js` skips M8's broadcast check for a replay (it now broadcasts nothing by design),
  `logLinesFor` applies the marker rule, `selfcheck` passes; no detector was weakened.
- Walks and numbers not done: `p50 <= 3 ms` unloaded (2.16 ms measured with `--prune-retired` on a loaded
  machine, re-measure after L24); the dirty check holds the last serialised body in memory (about the
  snapshot's size, bounded now L24 retains); the shipped client still never sends `sendEfspResync`, so
  the epoch matters for any future client and for the soak.

**Tactical Positions (L23, `0080`).** `TACTICAL_CAPABILITIES` (`authority/positions/tactical.js`, evaluated by `permission.js`) is the capability table
(`PERMISSIONS.JTAC`, `canCorrelate`, `canDeclareMarsa` read it); `mayActBesideOwner` carries the two
named exceptions to "only the owner acts": TAC_C2 answering TOFI on an AIC-held line
(`TOFI_ANSWER_ACTIONS`, B2) and OPS writing `14E` (S-L13). `board-store.js`: `_dispatch` [now the op table, `board/strip-ops.js` and `board/ops/`] has the
ownership gate (`NOT_OWNER` now carries `<OWNER> holds this Strip`); `SetState` is owner-checked for
every strip type (`_setStateOwnerRefusal` in `board/ops/set-state.js`, in the op's `authorize` step [then the `_dispatch` case], **not** in `_applySetState`, which the NLA
and Undo paths also call and which must not be owner-checked; a `SetState` to DROPPED routes to
`_applyDropStrip`); `_bayForNewOwner` moves the Bay with the owner (B3/B4); `reassignPositionStrips` and
`returnConsolidatedStrips` implement F10 [since `0110` only TACTICAL's hand-back moves Strips; `returnConsolidatedStrips` only drains Strips an old Board persisted: §3K] (`consolidatedFrom` on the Strip, first Position kept through a second
hop); the coordination op gains `CANCEL`; `SystemCoordinationEnd` and `SystemReassign`
(`position-retaken`) are log entries. **Per-session read scope (B6)**: `crc-sync/src/efsp/read-scope.js`
and `efsp-ws.js`'s `readScopeOf`/`filterForSession`/`supplementFor`/`readScopeKey`; `ws-hub.js`'s
`_deliver` (public: `deliverEfsp(frames)`), `_efspFilter`, `_efspAlertsMsg(session)` and the connect snapshot filter
every EFSP send (`snapshotFor(session)`, `_snapshotMessage(ctx, session)`); the heartbeat stays unfiltered (not
flights). A Strip that becomes visible to a session arrives with its flight data, correlation and MARSA records.
**Any new EFSP frame is built in `wire/frames.js` and sent through `deliverEfsp`/`_deliver`** (SERVER-SEAMS-2: the
six older entry points, `_broadcastEfsp`, `broadcastEfspBoardDelta`, `broadcastEfspRunwayStatusDelta` and the rest,
are gone; `broadcastEfspAlerts` stays, a per-session state send, still filtered).
- U7: `receiveCoordinationPeerGone` ends only a PROPOSED or ACTIVE link (S-L23: a completed handoff is not a live link, so the receiver's later drop leaves the sender's Strip alone; tested).
- Open: the two UI follow-ups above (a TAC_C2-only controller cannot Accept an AIC-held exit from the
  panel; the JTAC's drop-only tabs); GCI has no hand-back row (unchanged); `permission.js`'s module
  header still said "no coordination primitives are built" (stale since WP4A; L20 sweeps it); the 4-hour soak was not
  run for this lane; `CANCEL` and the two system log entries are new op strings (a `CANCEL` is not a
  coordination attempt for the metrics tap).

**Audit completeness (L26, `0083`).** One outcome, one audit entry: a store logs what reaches it, and the
metrics tap (`metrics.js` `_post`) logs whatever carries `result.unaudited` (the handlers in `efsp-ws.js`
set it on every pre-store refusal, so it replaced the old "efsp-mutation or NOT_HOLDING_POSITION"
condition). Every entry has `facilityId` and the flight data (`null` Facility for correlation/MARSA, the
controlling Facility for airspace); `SetBlock` records `blockId`/`value`; transitions carry a wire `action`;
airspace passes `clientMutationId` into `apply`. Seven `Peer*` ops (plus `InterfacilityCoordinationCancel`) record
replica changes with `source: 'peer'`, `causedBy` and `clientMutationId: null` (`_recordPeer`,
`_activeCmid` in `applyMutation`; `isDropTransition` is guarded by `source: 'peer'` so a cancelled
replica's retire is not a drop). A cached replay stays unlogged. `traffic-count.js`: a scramble called off
on the ground is not counted, one called off after departure keeps its latch; an archived drop
backfilled at boot keeps its Facility. **`getRunwayStatus` now carries `runwayChangeAcknowledgers` and
`inspectionAuthorityPositionId`**; the client still falls back to the owners table (open item).
- At L26 the soak harness did not install the metrics tap; the SOAK lane did (§3J), and the ledger now
  expects exactly one audit line per answered Mutation, from the right writer. `drop-broadcast` failed
  with and without this lane and the SOAK lane fixed the detector. `efsp-scenario-concurrency.test.mjs`
  shares one log across tests, two assertions use `findLast`. The ATO "no store" refusal is reached only
  through `_atoGate`, which the handler already logs.

**Block altitudes (U6, `0091`).** `flight-data-store.js`'s `parseAltitude(text)` returns a band `{ lowFt, highFt }`
(a single altitude is a zero-width band); `parseAltitudeFt` still answers a single altitude only. A block
is stored `parsed: null, block: { lowFt, highFt }` with `value` rewritten canonical, so a reader that only
knows single altitudes ignores the entry rather than misreading it. Conformance deviation is the distance
to the nearest edge (`0058`'s tolerances unchanged); `clearance-migration.js` [deleted by BACKCOMPAT; the old clearance shapes are no longer read] reads blocks too;
`requestedAltitudeAfterExit` takes a block. Client: the track panel, the scope's data block and the map
line show it. Open: **`strip-view.js`'s conformance reason line reads `a.assigned` (the edge), so a block
bust says "from FL240" without the block** (use `a.block`; UI-A left it, now UI-B's); the existing test that
expected `FL190B210` refused was updated; CA does not read assigned altitude (a conservative rule is
in the ADR for later); a block on a datalink/atobrief import path is not walked (the ATO import carries
no clearance altitude). Pre-existing `crc-sync npm test` failures at U6's base are listed in
`docs/wip/U6.md`.

**Incirlik RSU / SFA / PAR (L18, `0075`).** [**Superseded in part by `0117` (§3L):** there is no SFA Position, no
rotation record, no `sfa-store.js`, no `SfaRotation` op and no `efsp-sfa-*` family any more; "Landing assured" is gone
(`FinalCall`); the paragraphs below are the history.] The client half was built standalone and
unit-tested; the server half and the mounting came with `lane/L18-server`, now merged
(below). L18's FINAL talk-down component (cadence bar, call prompts, 0.3 deg tolerance) is **gone**: PAR-2 replaced it with
the PAR panel and a one-line FINAL Bay view, and `0116` took the carrier out of the PAR (§3K, "Panels and Divert").
What stays from L18's client half is `pattern-board.js` (RSU: closed, initial, base, final; PriFly: initial, break,
downwind, groove; configured by leg list; advisories only, nothing refuses; a "Next leg" button is the touch alternative
to drag; a Strip whose Rack is not a leg shows in an UNPLACED column; tests now in `tests/efsp-pattern-board.test.mjs`).
Defaults, all `[SOURCE-DEFINED]`: PAR's terminal events reuse the FINAL strip type's states (Landing assured, Ball to
`BALL`; Missed approach, Waveoff to `BOLTER_WAVEOFF`; no new state, `nla.js` is L17's); long-in-pattern 10 min, more
than one on the last leg advised; chip actions Landed (`RECOVERED`) and Drop (`DROPPED`).
- **Server half (L18 server, ADR `0093`, merged).** Built on L17
  plus this client half (re-run PARITY's tests on the merged tree). `facility-config.js`
  gives INCIRLIK eight Positions (`RSU`, `SFA`, `PAR` all `MILITARY_ATC`: a new class would silently drop CA,
  the `0041` inclusion-list trap), consolidating `SFA`/`PAR` at `AP` [`0110`: an offer list, and RSU -> LC] and **none for RSU** [as written then], Bays `rsu-pattern`,
  an SFA frequencies Bay (implies `INBOUND`, an existing ARRIVAL state), `par-final` (one Strip) and a second
  PAR Bay `par-missed` (BOLTER_WAVEOFF), and a validated `singleFrequencyApproach: { jurisdiction: 'AP',
  rotationSize: 3, pool }` (five placeholder UHF frequencies, `freq-1..5` = 232.1 to 236.1 MHz,
  `[SOURCE-DEFINED]`; initial rotation AP/SFA/PAR on `freq-1/2/3`). Every grant derives from one table,
  `INCIRLIK_CAPABILITIES` in `authority/positions/incirlik-military.js` [then `permission.js`] (`ops`, `createsStripTypes`, `ownsStates`, `requestsRunwayStatus`,
  `rotatesSfa`, `sendsSfaRotation`, `receivesSfaRotation`). RSU originates PATTERN Strips, may send
  `RequestRunway...` (CLOSE, OPEN, WORKS) and never closes a runway (H18); SFA and PAR originate nothing.
  New modules `sfa.js` and `sfa-store.js` (the rotation record `{ rackId: positionId }`, persisted with the EFSP
  state, one whole delta, audited; **only AP edits it**: the table's `rotatesSfa` is the ceiling and
  config's `jurisdiction` narrows it). The `SfaRotation` Strip op moves an ARRIVAL at INBOUND to FINAL at
  `ON_FINAL` in place and to PAR, trigger type `CONTROLLER_INITIATED` (the four stay four), and never touches
  the flight's frequency (D17). It is refused when PAR is unstaffed (no consolidation fallback, a FINAL Strip at
  AP would sit in a Bay AP does not have) or `par-final` is full. **A frequency is the flight data's working
  frequency and the Rack is that frequency**: filing a Strip on an SFA Rack writes the pool frequency (the
  field an airspace approval also writes), and a system placement puts a Strip back on the Rack matching
  its frequency. Wire: `efsp-sfa-mutation`, `efsp-sfa-ack`, `efsp-sfa-delta`, `sfaRotation` in the snapshot;
  audit fields `sfaTransfer` and `sfaTrigger`. Bay descriptors gain three flags (L17 had none and found its
  Bays by `bayId`): `view` (`'pattern' | 'final' | 'sfa-freqs'`), `replacesRacks` (the component is the Bay's
  interface; RSU's and PAR's replace their racks, the carrier's PriFly pattern and final Bays carry `view`
  and keep them) and `capacity` (enforced by the server; the occupant is named in the refusal);
  `validateConfig` rejects unknown keys. Client: `sfa-state.js`, `bay-views.js` [L18's own client-side FINAL sample was
  replaced by the server's PAR sample, `0112`]. It also regenerated the shipped
  `config/efsp-facility-incirlik.json`, which overrode `DEFAULT_CONFIG` then (the loader spread on-disk JSON
  over it; since DATA-1 the four facility JSON files are complete, a missing or invalid one is a start-up error and nothing is merged). Tests: crc-sync 1922, crc-desktop 771, `efsp-scenario-incirlik-l18.test.mjs` walks the
  acceptance (rotation moves the controller, the frequency stays), switch frequency, switch controller,
  cancel, late arrival and restart; `e2e/l18-incirlik.spec.js` 3/3 on `E2E_LANE=9`.
  - **It fixed a bug in the client half that only a browser shows**: two Bay-view scripts both declared a
    top-level `finite`, and `_el` collided with `metrics-panel.js`, so one script failed to load (since the ES-module
    client this class of bug cannot recur).
  - Open: `capacity: 1` could enforce "one at a time" on the carrier's final Bays (not set: a behaviour
    change in L17's design); an airspace approval that rewrites a flight's frequency desyncs its SFA Rack (the Rack
    is a placement, the flight data is the truth). [A PAR vacated with an aircraft on final: `0110`, the Strip stays
    PAR's and AP is offered the hat.] `docs/wip/L18.md` is stale on `BARRIER_CHANGE` (it is `WORKS`) and on the SFA state.

**Carrier Positions and the CARRIER Facility (L17, `0074`).** New: `carrier-store.js` (the `CarrierStore`),
`carrier-tick.js` (the ship state from the hull's track), `carrier/hull-config.js`, `carrier/sun.js`,
`carrier/handoff-effects.js`, `config/efsp-carriers.json`; client `carrier-state.js` and `carrier-panel.js`.
- **Strip types and Facility.** `MARSHAL`, `FINAL` and `PATTERN` strip types (committed first so L18 could read them), and
  the `CARRIER` Facility with four Positions `CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`; PriFly is
  outside the consolidation [`0110`/H111: offer lists, PriFly on them: §3K]. Grants come from `CARRIER_CAPABILITIES`;
  radar selectors are `{ kind: 'carrier', hull, radar }` (Marshal and lanes take both radars, PriFly the
  search radar); Position letters `V`, `P`, `1`, `2`. `computeNla` falls back to the DEPARTURE table for an
  unknown strip type (the `0064` trap), so the NLA tables were registered in the same commit as the strip types; a test
  now holds an explicit expectation for every state of every strip type in `INELIGIBLE_STATES`, so a state added
  later fails until someone decides. `LAUNCH` is correlation-eligible (ship radars set `noGroundAircraft`,
  but correlation matches the flight data against the track store).
- **Wire.** `efsp-carrier-mutation`, `efsp-carrier-ack`, `efsp-carrier-delta` and `carriers` in the snapshot,
  each in its own replay-cache kind (`carrier`); the `CarrierHandoff` op, and `carrierHandoff` /
  `carrierTrigger` audit fields. `normalizeStack` returns `{ok, stack, dropped}`, not the stack (the first
  restore silently emptied the stack; the crash-replay tests caught it).
- **Behaviour.** The recovery Case is one setting for the ship, as one delta [PriFly's then; since `0113` PriFly or the Marshal set it in the CARRIER panel]; the night floor is the
  sun more than 6 degrees below the horizon at the ship, from the mission clock. FINAL's identity Blocks
  are `carrier-derived` and Block 5 is off its map, so nothing is writable on FINAL by construction. The
  four handoffs (Commence, Radar contact, Ball, See you) are explicit `CarrierHandoff` ops beside the NLA,
  one implementation; a drag into a handoff Bay is refused with the button's name, a bolter is the one
  allowed drag. A recovery check-in is appended to the stack at the next free slot. Typed values (Zulu HHMM, magnetic
  bearings) are converted server-side [since `0113` through the one `SetCarrierState` op; the stack holds no time or radial].
- **Two bugs it found.** A dropped launch Strip released the flight's squawk and the bound recovery
  `CreateStrip` did not re-claim it (a duplicate code was possible): fixed in `_applyCreateStrip`
  (`reacquireFlightData`). A Case change left every carrier Strip's stamped `nla` stale until the NLA status monitor
  was made to tick after a carrier op.
- **Watch items (S-L17).** [The Marshal-holds-Strips item is gone: `0110` moves no Strip at a sign-off.] The banner reads "hull not found" in the harness (no
  gRPC), so the tick is unit-tested with a built track and a real DCS ship is a live check for the human;
  a Playwright run combining five spec files failed three `l17-carrier` and two `tactical-positions` tests
  that pass alone; deck-state board contents (`0064` B8) are not built; the weather advisory knows only
  night [since `0113` also typed ceiling and visibility]. Traffic count: a launch, a trap and a recovered pattern flight each count once.
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
  contradiction is staleness only, with no chip. The carrier strip types (`MARSHAL`, `FINAL`, `PATTERN`) expect
  nothing: an airfield-relative phase means nothing for a moving deck (a ship-relative one is a supervisor decision). **Staleness** is 120 s after the 5 s hold, logged once per
  episode through `metrics.recordStaleness` on the mission clock, with the source declared at wiring so a
  genuine zero is `NO_DATA`. `efsp-alerts` has a fourth slice, `surveillance`, composed in `src/app.js`'s [then `server.js`'s]
  `broadcastEfspAlerts` and filtered by visible Strip in `read-scope.js`. Both indicators are quiet
  (`_litIndicator` cases `hint` and `stale`, like `ar`/`trk`): no attention styling, no reason line. A hint
  written against a state the Strip has since left is not drawn. The chip is a click target only for a
  Position the controller is signed on to that owns the Strip.
- **Takeoff stamp.** `_stampTakeoffOnStateChange` (`board/strip-ops.js`; then `board-store.js`) writes `flightData.timeInputs.takeoffStampedUtc`
  through `FlightDataStore.setTakeoffStamp`; `time-chains.js` (both copies, byte-identical) has a `STATE_CHANGE`
  source between `CONTROLLER` and `EST_OFF_BLOCK`. DEPARTURE only; stamped on entering DEPARTED or HANDED_OFF
  from a non-airborne state; first stamp wins; cleared when the Strip is taken back to a pre-airborne state;
  kept through a Drop; it bumps `flightData.rev` but not `flightData.updatedAt` (AMENDMENT_INSIDE_30MIN reads that as "the
  plan was amended").
- **Misbinding.** `correlation-reconciler.js`: a contact held by a flight that has since finished is not
  claimable by another flight's callsign or code rung (`_formerHolder`); an explicit binding still can. The
  memory is by track id and is dropped when the contact leaves the picture or on a mission reload. **Known
  limit:** an aircraft DCS re-mints under a new track id is a new contact; a callsign memory with a position
  test is not built (the "defer, then harden" rule). The fix is proven by unit test, not the soak.
- Open: the chip's `SetState` to DEPARTED is refused while the runway is suspended (`_setStateRunwayRefusal`,
  H19), right for a clearance and odd for an observed fact (UI-B / runway-status decides; Drop still works); a
  real-mission walk is owed (taxi a jet, line up, take off without pressing Airborne, watch the chip appear
  5 s after rotation).

**UI follow-up (UI-A, no ADR taken).** All inside `0056`/`0058`'s rules. U1: OPS shows ORDNANCE (`3G`) on its
DEPARTURE face always and may write it on any non-DROPPED departure whoever holds it (a second
`NON_OWNER_BLOCK_WRITES` row, the `14E` precedent). **U2's root cause:** `efsp-arrivals.js` skipped every new
Strip whose `updatedBy` was one of the controller's own ids, and a coordination replica carries the
proposer's id, so one controller signed on to AP and CTR was never told; a minted replica
(`mintedForCoordination`, `mintedForTofi`) is now an arrival whoever made it. If a human still sees no
notification with two controllers, the next suspect is `signedOnPositions`/`getActingPositions()` at the receiving
client. U3: the label is `KEEP IFR` (TOFI's `ifrActive`) with a hover. U4: TYPE edits the bare aircraft type
(Block `3A`); the wake category stays in the expanded view. U5: RELEASE (`14A`) on a DEPARTURE's face at AP
and CTR. U8: when the paired mission Strip is OFF_STATION or RTB and the ATC Strip's TOFI is ACTIVE, CTR's
NLA slot is a filled `TOFI Exit` button (`tofiExitDueFor` in `efsp-nla.js`; the render signature carries the
mission line's state). S-L15: Alt+click toggles OFFSET, Ctrl/Cmd+click steps HIGHLIGHT. S-L16: TAXI (17) on
GC's face and TAKEOFF (18) on LC's; a typed TAXI/TAKEOFF earlier than the proposed departure is dotted with
a hover; retyping the value an estimate shows now sends it, so the estimate becomes the actual; `setField`
(`flight-data-store.js` `_vulWindowRefusal`) refuses a vul start not before the end and an end not after the start.
S-L23: a signed-on `TAC_C2` gets a client-local "with AIC/JTAC" tab listing the live MISSION lines AIC/JTAC hold
(read-only guidance, MISSION lines only); a JTAC-only controller no longer gets drop-only tabs (H59). S-L1b:
`_renderArrivalsLine` caches its element, `srs-radio.js` its two buttons, `openPanel` waits for `dock`.
- Server edits were minimal: `permission.js` (one row) and `flight-data-store.js`. Nothing in `nla.js`/`block-map.js`.
- Open: GCI-held lines are not in the "with AIC/JTAC" tab (GCI is not a `TAC_C2` delegate); the metrics
  `time-to-find` counts that tab as a real Bay (harmless); `srs-radio.js` has no unit test (browser only);
  the strip-view reason line for a block-altitude bust (U6) was not touched. Playwright: `ui-a.spec.js` 7/7.

**Per-theater transition altitude (TA, no ADR; applies `0085`/H62).** `FlightDataStore` takes
`transitionAltFt: () => number` beside `clock` (`createEfsp({ clock, transitionAltFt })`; `src/app.js` passes
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
hand-copied client table against its server truth. New: `crc-desktop/tests/client-mirror-parity.test.mjs`
(IFF states, NLA labels and owners, the 400 ms and 30 s literals, runway-status tables, Position lists, Zulu,
haversine, regimes), `bay-descriptor-parity.test.mjs`, `ws-message-contract.test.mjs` (server envelope types
against `app.js`'s `switch (msg.type)`, both directions) and `crc-sync/tests/wire-payload-contract.test.mjs`
(snapshot, delta and ack fields the client reads, against a real `createEfsp()`). Several mirrors are
source-scanned (`tests/helpers/mirror-source.mjs` `constLiteral`) because the client constants are not
exported; moving a declaration fails loudly. **Re-run it after any change to `nla.js`, `block-map.js`,
`permission.js` or `facility-config.js`** (L18's server half especially). No live drift was found.
- **S-12 is confirmed and ruled:** `sendEfspResync()` has no caller in the client, so the resync path
  (`0081`) is unreachable from the shipped UI; reconnect relies on the fresh snapshot. Ruling: wire it
  (UI-B, after UI-A); the `test.todo` in `ws-message-contract.test.mjs` then flips. `efsp-resync` has no
  `-ack` type: the reply is `efsp-resync-reply` with `answer: 'snapshot' | 'delta'` [at the time, `efsp-board-delta` or `efsp-snapshot`; R3-47].
- `runway-status.js` has `SUSPENSION_KINDS = ['WORKS','RUNWAY_CHANGE']` but `SUSPENSION_LABELS` only `WORKS`, so
  a runway suspended by a runway change reads "suspended — works in progress" through a fallback; the client
  copy agrees. It wants its own label (UI-B).

**Soak: SOAK and SOAKW (no ADR).** SOAK: the `drop-broadcast` selfcheck failure was detector drift, not a
detector bug (since L24/L26/L27 a Strip moves on within seconds, so nothing was left stale at the 60 s
checkpoint): in `drop-broadcast` mode the driver now judges the starved client's shadow against fresh truth
at the drop (`where: 'post-drop'`). The soak host now builds `createEfspInstrumentation` as `src/app.js` does (through `createApp`, `tools/soak/host-core.js`),
so efsp-mutation refusals and `unaudited` pre-store refusals get a `source: 'wire'` line, and the ledger
expects **exactly one audit line per answered Mutation from the right writer** (`auditWrongSource` replaced
`auditForRefusal`; the gate got stricter). **The heap slope is not fleet ramp-up**: a finished Strip stays 2 h in the soak
(12 h in production, `0107`; the soak host sets its own retention) before the archiver removes it (`0082`), so `strips.dropped` climbs until then (about 42/h, 26-37 KB each);
10 min gives 5.8 MB/h, 240 min gives -0.3 and passes; a 130-minute warm-up on a 180-minute run passes.
`--warmup-min <m>` overrides the warm-up. **SOAKW** (merged):
`memoryPolicy()` in `tools/soak/report.js` judges `memory.slope` and `memory.netGrowth` only on runs of 3 h or
more with a warm-up of at least the soak's retention (`tools/soak/retention.js`, 2 h; `--retention-min` overrides; not production's `ARCHIVE_AFTER_MS`, `0107`); the default
warm-up on such runs is `max(10 %..25 % rule, retention)`; shorter runs print `NOT JUDGED` (a pass, with the
per-DROPPED-Strip KB and residual rows kept and `report.json` carrying `memory.judged: false` and
`notJudgedReason`); `--judge-memory` forces the gate and the selfcheck `leak` case uses it, so a 20-minute run
still has to fail the slope. Tests: `tests/soak-memory-policy.test.mjs`. `soak:smoke` reports the memory gates as
not judged.

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

## 3K. Phase 3 and after — structure, seams, consolidation, the panels, and the traps

Phase 3 of the architecture check (H103/H106, `docs/parallel/arch-check-plan.md`) is merged, with ARCHIVE-12H,
MISSION-CLEAR, CARRIER-ATO, NX-1, CONSOL (ADR `0110`), DESK-SPLIT and DESK-NOTICES after it. No lane in it changed the wire
protocol (`WIRE_PROTOCOL` stays 2; `wire:record` said "surface unchanged" every time; new fields are optional). **ADRs `0098`-`0106`
(airspace registry, split/join, undo, control release, TOFI regime, wire protocol, per-Facility heartbeat, GC/LC, store resync) are not
folded into this file**: their notes are in `docs/wip/` and `docs/parallel/post-refactor/`, and the guide carries their controller-facing
half (that the guide covers them fully is unverified).

**Bugs the check found, fixed in phase 1-3** (the 15 of the plan, B1-B15): a reconnect signing a controller off (B1, DESK-SIGNON: a 15 s
grace keyed on the controllerId, `config/sign-on-grace.json`), a sign-off repair never persisted (B2), an op's throw leaving partial
writes (B3; every store answers `INTERNAL_ERROR` on a throw, `src/efsp/store-throw.js`), the single `warning` field (B4, now
`warnings: [{code, detail?}]`), the runway-status delta skipping read scope (B5), a system TOFI entry bumping a rev (B6), stale chips (B7),
a stuck push-to-talk (B8), the Undo button rebuilt every 250 ms (B9), web files written non-atomically (B10), web airspace rules (B11),
the dead "Update required" link and the Casdoor popup (B12, B13), the deploy gate reading source but deploying `:latest` (B14, now by digest
and fail-closed), and a missing service token looking like an outage (B15). The localhost `POST /api/sync-config` hole is a known finding
the human chose to leave (AC-2).

### crc-sync (SERVER-SEAMS-1/2, SEAMS, SERVER-TIDY)

- **Config is read when built, not when required.** `facility-config.js` is `createFacilityConfig({ env })` (eager, strict, no module state);
  `stereo-routes.js` `createStereoRoutes({ env })`, `apt-config.js` `createAptConfig({ env })`, `iff.js` `ownCoalitionFrom(env)`;
  `state-paths.js` `dirs(env)` and an optional trailing `env` on `readPath`/`writePath`/`statePaths` (`CONFIG_DIR`/`STATE_DIR` are gone);
  `permission.js` is `createPermission({ classOf })` (module-level `permission.canMutate` no longer exists; wire families use `ctx.permission`).
  **`createApp({ env })` means it: the injected env is the whole environment**, so a test that passed `env: {}` and relied on `process.env`
  paths must pass `{ ...process.env }`. `tests/no-require-time-config.test.mjs` requires the config modules with missing dirs and expects
  success and no files. Still lazy-on-first-use process caches, not factories: `instrumentation-config`, `surveillance-hints-config`,
  `theaters` (`defaultTransitionAltFt()`), `synthetic-block`, `carrier/hull-config`, `carrier/flight-record`. Still reading `process.env` at
  require time: `booking-lookup.js`, `airspace-schema.js` (`loadStandingList` default path), `DCS_GRPC_PROTO_PATH` in `grpc-client.js`
  (SERVER-SEAMS-1's list; re-check before relying on it).
- **Clocks.** The clock allow-list in `tests/clock-policy.test.mjs` is **empty** under `src/efsp`: the next bare `Date.now()` there fails.
  Still bare, outside that scan: `collab-store.js`, `auth.js`, `atis-store.js`, `tracks.js`, `ws-hub.js`, `srs-client.js`, `grpc-client.js`,
  `app.js` (weather `updatedAt`, the conflict-alert tick). `WALL_CLOCK` is `src/mission-clock.js`'s.
- **No late setters but two named links.** `setMutationLog`, `setRegimeLocator`, `flightDataStore.setWriteObserver`,
  `board.setAirborneObserver`, `efsp.setAbsentCheck`, `nlaStatusMonitor.setOnDelta` and `wsHub.setOnEfspChange` are constructor dependencies
  now. What is left is `src/app/late-binding.js` (`wsHub`, hub <-> producers of server frames; `surveillanceHints`, Boards <-> hint
  monitor), which **throws if used unbound or bound twice**, and `archiver.setIsCounted`. `createEfsp({ locateTrack })` builds the regime
  locator; with none it logs an **error once** at the first regime question and answers unlocated.
- **`createApp` is split.** `app.js` is 257 lines; the pieces are `src/app/{http-routes,radar-picture,monitors,tickers,feed-handlers,archive,
  airport-weather,active-runway,late-binding}.js`. `efsp/index.js`'s rules bag moved intact to `efsp/facility-rules.js` and the regime locator
  to `efsp/regime-locator.js`; the SFA logic left the bag for `sfa.js`. ARCH-S 2b's "pass `facilityView`/modules instead of closures" is not done.
- **One delivery path.** `WsHub#_deliver({ broadcasts, directed })` / `deliverEfsp(frames)`: read-scope filter, directed frames, then the
  post-change hook (not re-entered) after any delivery that sent a frame. The six `broadcastEfsp*` entry points are gone; the hub builds no
  EFSP frame (`wire/frames.js` has `serverBoardDelta`, `correlationDelta`, `runwayStatusDelta`). **Any new EFSP frame is built in
  `wire/frames.js` and sent through `deliverEfsp`.** `broadcastEfspAlerts` stays a per-session state send. Server-originated deltas now also run
  the obligation re-check.
- **`efsp/synced-store.js` (`SyncedStore`)** is the base of the sequenced stores outside the Board (six then, five since `0117` removed the SFA store) (clock, mutationLog, SyncLog, `currentSeq`/`epoch`,
  `_bump(record)`, `_guarded(what, log, fn)`, `_writeAudit`); Board and flight-data store keep their own. `BoardState.bump(strip, by, at)` is
  the one rev/updatedAt/updatedBy/touch at all 12 Board sites (the `placement` rebalance and undo restore keep their own semantics).
- **Refusals and attestation.** `src/efsp/refusal-codes.js` `REFUSAL_CODES` (16) is the list a new refusal code must join (a source scan in
  `tests/refusal-codes.test.mjs` fails both ways), and the client table must word it (`efsp-refusal-banner.test.mjs`). `checkControlAxis`
  returns `attestation: {with, needs:[scope...]}` on the "coordinate with X" refusal (reason stays `VALIDATION_ERROR`); the client reads
  the field, never the sentence, so the sentence may be reworded. A replayed attestation refusal answers from the replay cache, which does not
  store `attestation`: only a lost-ack retry shows the plain banner (edge; widen `replayRecord` and the `stores.js` shape check if it matters).
  `EXISTS`, `CRASH_BEFORE_PERSIST` and `NOT_PERSISTED` are audit-only, not ack refusals.
- **Service tokens (SEAMS).** `requireServiceToken(name, getToken)` in `sourcedcs-web/service-token.js` and `crc-sync/src/service-token.js`
  (byte-identical hand copies, hash-then-compare, token read per request, unset or empty 503 "<name> not configured", wrong or missing 401;
  `infra/tests/service-token-parity.test.js` plus the shared `tests/fixtures/service-token-table.json`). crc-sync's two web pulls share
  `src/efsp/web-call.js` (401/403 "rejected the service token", abort "timed out", other "unreachable"). `GrpcClient`/`SrsClient` take `{env}` and
  read `CRCSYNC_DCS_GRPC_HOST || DCS_GRPC_HOST` (and SRS, poll rate, backoff) at connect time; no production key was renamed. Worth considering,
  not done (needs an `infra/.env` step): `CRCSYNC_INTERNAL_URL` / `SOURCEDCS_WEB_INTERNAL_URL`; compose still hardcodes `SOURCEDCS_CRCSYNC_URL`.
- **Tests.** `tests/helpers/with-paths.mjs` `withPaths(prefix, {ENV: file}, {stateDir, shippedConfig, extraEnv})` (presets `FACILITIES`, `BOARD`,
  `MUTATION_LOG`, `AIRSPACES`, `APP_PATHS`; `.env` for `createApp/createEfsp({env})`, `.apply()` for modules that still read `process.env`) replaced the
  hand-set env blocks in 26 files; other files still have them and work either way. The two scenario walks use a stepped wall clock;
  `ato tokenize` asserts linear scaling; the gRPC held-open test is 0.6 s. crc-desktop's parity tests build the shipped facility config and permission from
  the factories (`crc-desktop/tests/helpers/server-config.mjs`, INTEG-PARITY).

### Server, behaviour added after the check (ADRs `0107`-`0110`)

- **Archive retention 12 h (H107, `0107`).** `ARCHIVE_AFTER_MS` is 12 h (the archive section above says so). `createApp({ archiveRetentionMs })` is for tests and
  the soak only; the soak keeps 2 h in `tools/soak/retention.js` (`--retention-min`, `CRCSYNC_SOAK_RETENTION_MIN`, reaches the forked host by
  environment variable) and prints "soak retention 2 h (production 12 h)". **No soak exercises the production 12 h value**; only unit tests pin it. The
  whole-snapshot `_persist` cost grows with retention (`0107` estimates about 1.5 MB at 12 h). `docs/wip/SOAK.md`/`SOAKW.md` and ADR `0082` still say 2 h (history).
- **Mission reset (H108, `0108`)** is described under §3J's "Mission reset". Two facts added since: the ATO MISSION lines on TACTICAL are cleared too (re-import the
  ATO per mission), and the `efsp-board-delta` of a reset carries `missionReset: {at, strips}` (DESK-NOTICES, below). The correlation store has no `gone`: a
  reset moves its seq once with an empty `updated`, and a client keeps stale correlation records for dead flights until its next resync (harmless).
- **Carrier flights have ATO lines (H109, `0109`)** is described under §3J's ATO section.
- **Consolidation is "the next controller takes the hat" (H104, H111, H113, `0110`; CONSOL-DESIGN, CONSOL-S, CONSOL-C).** No Strip moves when an ATC Position is
  left; `consolidation` in each `config/efsp-facility-*.json` is `{ Position: Position[] }`, an ordered offer list, plus a required `handBack` map (`{}` where
  empty; a string value is refused with the fix named). Shipped: Incirlik `CD:[GC,LC,AP] GC:[LC,AP] LC:[AP] RSU:[LC] PAR:[AP]` (`SFA:[AP]` went with the SFA Position, `0117`); carrier
  `APP1:[MARSHAL,APP2,PRIFLY] APP2:[MARSHAL,APP1,PRIFLY] PRIFLY:[MARSHAL,APP1,APP2] MARSHAL:[APP1,APP2,PRIFLY]`; TACTICAL `consolidation {}` and
  `handBack {AIC,GCI,JTAC -> TAC_C2}` (the only sign-off that still moves a Strip). One test pins the lists (`efsp-facility-config.test.mjs`). H113 keeps GC
  on the list: an NLA or transfer into an empty GC is delivered there with `UNSTAFFED_RECEIVER` and LC/AP are offered GC; a "no" edit is deleting the
  `"GC": ["LC","AP"]` line and its pin (`efsp-consol-s1-switch.test.mjs` runs that config). A Position with no list keeps the old refusal.
  `PositionStore`: `consolidatedAt` is the first staffed list member (else the staffed `handBack` target); `hatTakerOf`, `handBackTo`, `hasHandBack`,
  `positionIds`; `getAll()` no longer has `consolidatedPositions`; **F1:** re-declaring a Position you observe that has no Primary makes you its Primary
  (`_promoteObserver`). Wire: Position entries carry `hatOffers: [{positionId, count, onRunway, observersFirst}]` (one serialiser, `positionsWire`, in
  `efsp-ws.js`), a mutation delta carries Positions when a Facility's offers changed, snapshots carry `self: {controllerId}`; the positions-ack warning is
  `{positionId, count, offeredTo, onRunway?}` (`offeredTo: null` = nobody); `transfers.toUnstaffed` replaced `routedToConsolidated`; `efsp-position-offer` and
  `legacyOfferAfterSignOff` are gone. **F4:** a HANDOFF replica is minted only at a staffed Position or one a staffed Position is offered; otherwise
  `NO_RECEIVING_POSITION` (stricter than before: a proposal to an empty AP/CTR with nobody offered used to leave a replica nobody could ACCEPT).
  `onRunway` is DEPARTURE in LUAW plus ARRIVAL in FINAL. `combination.js` `NON_LOCAL = OPS, CD, GC, AP, PAR` (SFA left in `0117`) (client `combination-rules.js` is
  parity-tested against it). Walks W1-W19 are in `tests/efsp-consol-hat.test.mjs`. **Release note: crc-sync and crc-desktop must ship together**
  (the offer frame is gone; the protocol number is unchanged). **Release checklist (S2):** check the server volume for any `state/efsp-facility-*.json`
  (strict state refuses the old `consolidation` shape; `infra/RUNBOOK.md`). RSU->LC and SFA/PAR->AP are the ADR's own, not asked of the human.
  Not walked: a read-scoped session (`0080`): `hatOffers` counts all Strips server-side while the callsigns come from the local Board; the carrier's
  consolidation never met a real DCS ship; two hulls.
- **THEATERS (F2).** `tmCentralMeridianDeg` for TheChannel (3), Kola (21) and GermanyCW (21; far from the map, so convergence is about -6 deg at 50N 14E, as the source
  exports it) came from pydcs master `55dc18ad`, in `config/theaters.json` and `tools/miztoyaml/projection.py`; `crc-sync/tests/theater-parity.test.mjs`
  keeps them equal both ways. MarianaIslandsWWII, Afghanistan and Iraq are unsourced (pydcs has no terrain for them) and left out; `projection.py` still
  defaults an unknown theater to Syria.
- **NX-1, the soak (tools only).** `run.js` sets `CRCSYNC_SOAK_HINTS=1` so `createApp` builds the hint monitor and the Boards' `airborneEvidence` as in
  production; shadow clients keep one cursor per `STORE_SYNC` store (six then, five since `0117`; parity-tested against `STORE_SYNC`), resync like the client and fail on a store more than 6
  beats behind (`mutations.storeSync.stale`, selfcheck case `drop-store-delta`). Limits: `hints.airborneEver` stays 0 (the synthetic flights never leave
  a DEPARTURE Strip on the ground while the contact is airborne), and the soak never rolls the mission, so `0108` is unexercised. The shadow asks for 23-31 correlation
  slices per 20 min (§4). Local 240-minute soaks (S-ARCH-23, soak retention 2 h, memory judged): seed 1 PASS (slope 0.45 MB/h), seed 2 PASS (slope **0.92 MB/h**, R^2 0.6,
  near the 1.0 gate; if a run fails on slope the first suspect is the per-Strip snapshot growth, 31 KB to 289 KB over 4 h). They do not replace the human's workflow run.

### crc-desktop (DESK-ACKS, DESK-SYNC, DESK-TIDY-1/2, DESK-GRAPH, DESK-SPLIT, CONSOL-C, DESK-NOTICES)

- **The import graph has no cycle.** `tests/module-graph.test.mjs` `LARGEST_CYCLE_MAX = 0` (59/106 before phase 3, then 39, 36, 30, 11, 2, 0; **never raise it**). The
  leaves import nothing and no module imports `app.js` for state (only `main.js` imports `startApp`): `settings.js`, `map-handle.js` (`map`, `mapReady`, drag, measure),
  `picture.js` (`latestFromServer`, `tracks`, `history`, coverage, `missionData`, `getBullseye`, `getLatestTrack`, `getAllTracks`), `view-state.js`, `scope-constants.js`,
  `format.js`, `html-escape.js`, `dock-handle.js`, `map-style.js`, the mission clock, and under `panels/efsp/`: `facility-topology.js`, `sync-cursor.js`,
  `efsp-change-bus.js`, `efsp-message-registry.js`, `board-data.js`, `carrier-final-distance.js`, `mtr-advisory.js`. `app.js` keeps the socket, the fade beat and
  `applySnapshot`/`applyCoverage` and writes the leaves. `bay-view.js` re-exports nothing.
- **No `window` globals.** `tests/no-window-globals.test.mjs` fails on any `window.<name>`, `window[...] =` or `globalThis.x =` that is not a browser API or the
  preload bridge (`crcLinks`, `crcUpdate`). The Playwright specs reach modules through `window.crc.<module>`, which only the test helper `e2e/helpers/modules.js`
  sets; **when a function moves to another module the spec must follow it** (DESK-SPLIT moved `_invokeNla` from `crc.bayView` to `crc.dispatch` and CONSOL-C's two
  new specs, written after DESK-SPLIT branched, failed until the supervisor fixed them, S-ARCH-32).
- **The change bus (`efsp-change-bus.js`).** `markEfspChanged(...topics)`, `onEfspChanged(topics, fn, {order})`, `batchEfspChanges(fn)`; the 16 topics are in
  `EFSP_TOPICS` (an unknown topic throws, so a typo cannot go silent); subscriber order is RESOLVE (the highlights) -> PANEL -> BAYS -> VIEW (map, track panel,
  airspace, runway status). `dispatchEfspMessage` and `redrawEfspStore` run their handler in a batch, so the flush is once per frame, after state is applied. **A
  handler only applies state and marks a topic**; it does not call a renderer. A new view subscribes at load.
- **One sync cursor (`sync-cursor.js`).** One `{ seq, epoch, behind }` per Board (`board:<facilityId>`) and per store (`store:<key>`), one gap/in-flight/retry table
  (`RESYNC_RETRY_HEARTBEATS = 10`), one registry observer `noteEfspFrameForSync` in `efsp-ws.js` as the only resync trigger, one `requestEfspResync(name, reason)`. A store resync
  redraws through `registerEfspStoreRedraw(key, fn)` (no synthetic delta frames). A snapshot is `clearCursors()` plus re-adopt. `efspBoardSeq`/`getEfspBoardSeq` are gone (read
  `getCursor(boardCursorName(f)).seq` or `efspResyncPositionFor(f).lastBoardSeq`). A pending CreateStrip is **re-sent after a reconnect with its cmid** (safe: the replay cache
  answers a seen cmid with the original outcome, applies an unseen one fresh; it keys on the cmid alone and persists 10 minutes).
- **One ack path.** `sendEfsp(msg, { pending, onAck })` in `efsp-ws.js`, `settleEfspAck(ack, result)`, `orphanEfspAcks()`: one cmid -> continuation map; `onAck` returning `true`
  means "I showed the outcome". A send the socket cannot carry answers `NOT_CONNECTED`; a (re)connect answers `CONNECTION_LOST` to every non-replayable request. The refusal
  banner is the default surface. A popover closes on an accepted ack and stays open, with its input, on a refusal (`_sendFromPopover` in `bay/popover-portal.js`). `preview`
  (ATO) and `efsp-positions-ack` keep their own matching. `attestationRequest(attestation, op)` reads the structured field; **no client regex over server prose remains**.
- **`openPopover({ el, anchor, strip, onClose, focus })`** (`bay/popover-portal.js`) owns position, one-open-at-a-time, outside-`pointerdown`, Escape and the deferred
  post-close render for eight popovers and the Strip menu. The airspace card's menu, the layer menu and the ground-label popup are not on it (not portalled).
- **`facility-topology.js`** is the one Facility -> Position table (`DEFAULT_FACILITY_ID`, `RANGES_FACILITY_ID`, `facilityOfPosition`, `positionsOf`, `shippedFacilityIds`,
  `allFacilityIds`), parity-tested against `crc-sync/config/efsp-facility-*.json` (`facility-topology-parity.test.mjs`, which also fails if a consumer hard-codes
  `'INCIRLIK'|'TACTICAL'|'CENTER'`). It stays a table, not derived from the snapshot, because the "acting as" checkboxes and the airspace editor must work before the first
  snapshot. `client-rule-tables-parity.test.mjs` covers five rule tables; `tests/web-airspace-parity.test.mjs` the web's coordinate parser.
- **`innerHTML`.** `html-escape.js` `escapeHtml` is the one escaper; `tests/html-sinks.test.mjs` scans every `innerHTML`/`outerHTML`/`insertAdjacentHTML` right-hand
  side (a dynamic part must be `escapeHtml(...)`, a literal, or on its short reviewed allow-list) and asserts `index.html` has no inline handler. There is no CSP meta
  (needs the CDN list, the map-tile origins and a pass over inline `style=`; its own lane).
- **Splits (DESK-SPLIT, S-ARCH-31).** `efsp-state.js` (361 lines) -> `board-data.js` plus per-store modules (public names still re-exported from `efsp-state.js`); `strip-view.js`
  (215) -> `strip-dom/exchanges/alerts/indicators/menu`; `airspace-editor.js` (328) -> `airspace-draft.js` plus DOM; `airspace-panel.js` (165) -> view-state/rules/views/card;
  `map-setup.js` (93) -> `map-layers-overlays/tracks/map-interactions`. DESK-SPLIT was stopped before its report: only the 12 committed commits are known (its own lane note does not exist).
- **Consolidation client (CONSOL-C).** `combination-rules.js` `hatRows(positions, selfId, strips, acting, {hidden, callsignOf})` derives the standing offer rows from
  `hatOffers` where `self.controllerId` is Primary, and a "Take Q?" row for each Position this session observes that has no Primary and owns Strips; "Not now" hides a row until
  the count (or the runway count) grows; Take is `sendEfspSetPositions(declared + Q)`. `efspSelf`/`getEfspSelf()` come from the snapshot (`efsp-state.js`). `UNSTAFFED_RECEIVER` is worded
  in `refusal.js`; `metrics-panel.js` reads `transfers.toUnstaffed`. `e2e/consol-hat.spec.js` (4) walks it.
- **Mission-reset notice (DESK-NOTICES).** `noteMissionReset` (`panel/undo-slot.js`) shows "New mission — the Board was cleared (N Strips)" in the dismissible undo-message slot (same
  `at` from a second Facility adds to the count; a reset where no Board had Strips sends no delta, so no notice). Popovers close on **any** removed Strip, and pending Mutations on removed
  Strips go through `settleEfspAck` + `notifyEfspOrphanedMutation`. The ATO preview shows an `efsp-ato-carrier` hull tag (`line.carrier.hullCode`). An undone Split sends
  `flightDataList.gone` (`undo.js` returns `flightDataGone`). Unit-tested through the registry; **no Playwright spec** (the harness cannot drive a reset).
- **Tests and e2e.** `e2e/airspace-server.spec.js` (2) drives the airspace panel against crc-sync's own acks, with `e2e/helpers/fake-dcs.js` (GetTheatre plus one airdrome) on
  `syncPort + 200`; the harness sets `CRCSYNC_MISSION_SESSION_PATH` into the throwaway state dir. Every spec screenshot goes to `test.info().outputPath(...)`
  (`e2e-spec-hygiene.test.mjs` enforces it and bans `docs/wip` in a spec's code). Setter seams that tests genuinely need stay (47 after DESK-TIDY-2); the 164 underscore exports
  and the `efspFlightDataList` rename were not done.

### Panels and Divert (ADRs `0111`-`0116`; SETTINGS-TABS to CARRIER-FOLLOWUP)

Designs approved by the human (H115-H123, mockups `docs/mockups/{par-panel,marshal-stack-panel,carrier-map-panel}.html`), built one
lane at a time (H112), merged S-ARCH-37 to S-ARCH-45 plus CARRIER-FOLLOWUP. `WIRE_PROTOCOL` stays **2** throughout (already ahead of the last
release, 1, so every change ships together). Lane notes: `docs/wip/{SETTINGS-TABS,DIVERT,CARRIER-STATE,MARSHAL-BOARD,MARSHAL-FIX,MARSHAL-MARKS,
CARRIER-MAP,SIDE-SWAP,WIRE-RECORD,PAR-1,PAR-2,CARRIER-FOLLOWUP}.md`; where a later lane reverses an earlier one, the later wins (below).

- **SETTINGS-TABS (client).** `settings-registry.js` (a leaf importing only `settings.js`): `registerSettingsTab(id, fields, {label})` at
  module load, `getSetting(key)` where used; fields `toggle`/`number`/`select`, keys global (prefix with the panel), stored per controller in
  localStorage `crc-desktop-settings`, never synced. Registered tabs sit before SRS. Static tabs renamed DECLTR -> RADAR, RADIO -> SRS.
  Registered today: `par`, `marshal`, `carrier-map`. The CARRIER panel has none.
- **DIVERT (`0111`).** `Divert` Board op, AP/CTR only, owner only; OVERFLIGHT at INBOUND/IN_SECTOR and ARRIVAL at INBOUND. Destination
  classified by `rules.divertDestinationFor` (a Facility's `runwayStatus.airportIcao` or a hull id = ours, `data/icao.json` maps names):
  ours -> ARRIVAL at INBOUND; not ours -> OVERFLIGHT (an ARRIVAL becomes OVERFLIGHT at IN_SECTOR). Form fields from FAA JO 7110.65 ¶4-2-1,
  ¶4-2-5, ¶4-5-7; blank = unchanged; altitude through the clearance history; `strip.diverts` append-only (persisted shape; split parts do not
  copy it); 10 s Undo. Refused for departures, open coordination or TOFI, the sender of an ACTIVE HANDOFF, and the receiver before
  TRANSFER_CONTROL (the conservative default, kept, S-ARCH-37). No new refusal code. `facility-rules.js` now reads `data/icao.json`.
- **CARRIER-STATE (`0113`).** One state per hull, each value `{value, source: dcs|default|override|none, override, default}`; one op
  `SetCarrierState {field, value}` (null clears) replaces `SetCase`, `SetShipInput`, `SetCharlieTime`, `SetMarshalRadial`; capability
  `editsCarrierState` for CV_PRIFLY and CV_MARSHAL; every change audited, last-writer-wins per field. Bearings typed magnetic, refused with no
  ship. **EAT per CV NATOPS** (H118): `EAT(N) = rampTime + N × pushSpacing − fixToRamp`, `pushTimeUtc` on the derived entry now means the EAT,
  `rampEtaUtc` beside it; ADR 0064's EAT = Charlie + slot is gone, so **the Strip's EAT/PUSH Block reads 6 min earlier than before for the same
  input**. Tuning `config/efsp-carrier-recovery.json` (`firstFixDme` 21, `pushSpacingSec` 60, `fixToRampSec` 360 ours, tanker 6,000 ft/port ours);
  `marshalDme = firstFix + slot`. Ceiling/visibility have no DCS source (`none` until typed); wind over deck from `app/ship-wind.js`. The banner
  (`ShipState`) holds only what the game says. Client `carrier-management-panel.js`, `carrier-send.js`.
- **MARSHAL-BOARD (`0114`) and MARSHAL-MARKS (`0115`).** Stack entry gains `pushedAtUtc`, `eatUtc` (written at Commence, cleared by Back to
  stack) and `unpassed` (`['angels'|'eat']`, HOLDING only, decided server-side by `markClearanceChanges`); stack gains `deltaMs`. Stack ops `Delta`
  (even, >= 4, 60 cap ours; holding flights only; a new ramp time clears it), `BackToStack` (handoff `COMMENCED_TO_MARSHAL`, Case II/III, next slot
  at the top, marks both), `PassClearance` (Marshal only, refused if the value moved since read; no Undo, like Move/Delta/CloseUp). Flight fields
  `sideNumber` (`C18`) and `approachTurnNm` (`C19`). Client `marshal-panel.js`, `marshal-board-model.js` (pure; `buildBoard` takes CARRIER Strips
  only), `marshal-picture.js`. **Removed:** `carrierOrderRack`, the stack slot board and its drop target, the client-side marks.
- **MARSHAL-FIX.** `strip-view.js` notices a just-arrived Strip when the press **ends** (pointerup/pointercancel), not at pointerdown: removing the
  "from" line mid-press moved the step buttons 34 px, so the click landed on no button (`control-release.spec.js:141`).
- **CARRIER-MAP (client, no ADR).** SVG panel (`carrier-map-panel.js`, `carrier-map-model.js`), not a second MapLibre map (glyphs need the
  MapTiler key; Web Mercator; no ordered stack labels). North-up on the ship, 2.5-65 nm, no fullscreen (H121), no basemap (H123). Patterns only
  while occupied, from Strip state (spin by geometry, ours); labels via `track-label.js` `sideAltText`. Settings `carrierMapRangeNm`,
  `carrierMapRingSpacing`.
- **SIDE-SWAP and the side number (H122, H124 (2)).** `sideNumberLeads(stripType, positionId, flightData)` in `strip-fields.js` (strip type with C1
  and C18, owned by a CARRIER Position, side number typed) swaps C1/C18 and their spans; PATTERN gained a read-only C18 shown only while it leads.
  `leadingFlightName()` names the flight in the PriFly chip (callsign to `aka`), the carrier FINAL line, the refusal banner and the arrivals
  line. Bay search matches the side number.
- **WIRE-RECORD.** `tools/wire-surface.js` now reads the server's own lists: the Board op table (adds `CarrierHandoff`, `SfaRotation` [gone in `0117`]), every store
  family's op kinds, carrier handoff/Case/field names, stack/entry/view keys, `STORE_SYNC`, every delta's frame keys; a probe test and a
  completeness test. The CLAUDE.md line is in.
- **PAR-1 (`0112`) and PAR-2.** `surveillance/par.js` + `par-monitor.js`: a `par-sample` frame every 500 ms to sessions signed on to the FINAL
  Strip's owner (a sensor output: no seq, outside `deliverEfsp`); range along course from the threshold, height above TDZE, EL/AZ deviation, GS/VS,
  INOP per scope (`NO_APPROACH`, `NO_TDZE`), 12-plot trail. Incirlik `parApproaches` in the facility file, `config/par.json` (3.06°, 500 ms).
  Client leaf `par-samples.js`, bus topic `par`; `par-panel.js` + `par-model.js` (PAR Settings tab: `parAutoscale`, `parGpa`, `parTolEl`, `parTolAz`).
  **`final-panel.js` is deleted**: the FINAL Bay (`bay-views.js`, `view: 'final'`) is one line per flight with the terminal ops, updated in place.
- **CARRIER-FOLLOWUP (`0116`, H125/H126): the PAR is an airfield feature.** This reverses PAR-1/PAR-2's carrier half and voids H124 (1). `ParMonitor`
  samples only final Bays of a Facility with `runwayStatus`; `par.js` lost `carrierTouchdown`, `validateHullApproach`, `kind`, `hullId`,
  `NO_SHIP`, `NO_COURSE`; the hull config has no `approach`. The PAR panel is callsign/runway/Landing assured + Missed approach only [`0117`: the four `FinalCall` calls now, §3L]. The carrier
  FINAL Bay line: side number, **no range**, Ball (`CarrierHandoff FINAL_TO_LSO`) and Waveoff (`SetState BOLTER_WAVEOFF`), a label not a link.
  **DIST (`C17`)** on a carrier Strip: `carrier-final-distance.js` `carrierDistanceNm`, ship (banner) to correlated contact, the same for every
  carrier Position; at Incirlik the PAR range to the threshold. `bay-views.js refreshDistBlocks()` rewrites `.efsp-block-C17` in place at most
  1 Hz on `scope`/`par`. **Fresh ship position:** `shipStateChanged`'s `positionStepNm` 0.05 NM (ours) republishes the banner as the ship moves
  (about every 6 s at 30 kt).

**Not walked, from the lane notes:** a real DCS ship and real contacts in any carrier panel (every spec injects a ship); a divert with an ACTIVE
TOFI, on the AP replica while CTR still holds communications, a split part of a diverted formation, a diverted flight in MARSA; a Case change while
a flight is commenced; two Marshal Primaries (one Position has one Primary); a PAR live track (fix timing vs the 500 ms frame), a controller holding
both CV lanes; the DCS wind direction at the ship against a real DCS.

### Traps, in the order they were hit

1. **A lane runs BOTH unit suites**, whichever side it edits. Three merges in a row broke the other side's tests (SERVER-SEAMS-1 left 34 crc-desktop parity tests on removed singletons:
   INTEG-PARITY; DESK-SYNC renamed client code crc-sync's `efsp-scenario-resync` and `wire-payload-contract` load: INTEG-SYNC; DESK-SPLIT moved the chip `crc-sync/tests/efsp-ui-b-hooks.test.mjs` reads).
2. **Client modules are leaves plus the change bus, with no import cycle (bound 0).** A new module that imports `app.js`, `bay-view.js` or `efsp-state.js` for state will
   fail `module-graph.test.mjs`; make it a leaf, or mark a bus topic instead of calling a renderer. Never raise `LARGEST_CYCLE_MAX`.
3. **No `window.*`.** Import from the leaf (`picture.js`, `map-handle.js`, ...). Unit tests that used to stub `window.getLatestTrack` fill `latestFromServer`.
4. **`deliverEfsp` is the one server path.** A new frame is built in `wire/frames.js` and sent through it; never a second broadcast loop.
5. **`SyncedStore` for a new sequenced store**, registered in `stores.js`; the client's `STORE_SYNC` table, the soak's shadow table (parity test) and a `registerEfspStoreRedraw` must follow.
6. **Config factories and `createApp({env})`.** Do not read `process.env` or a file at require time; take `env` or a built config. A test that wants private paths uses `withPaths`.
7. **A new refusal code** joins `REFUSAL_CODES` and the client wording table, or two tests fail.
8. **e2e specs reach modules through `crc.<module>` and must follow a moved function** (`crc.dispatch._invokeNla`, S-ARCH-32). `consol-hat` and `gclc-combine` call it.
9. **Goldens:** never hand-merge; take either side, `npm run freeze:update`, check the diff is small, commit it separately. `wire:record` after any wire change (S-ARCH-9 and `CLAUDE.md`).
10. **Playwright under load fails specs that pass alone**; re-run a failure alone before counting it (S-ARCH-14's rule). The last full run is in §1.
11. **A figure that moves on a Strip or in a Bay view is updated in place**, never by rebuilding DOM at the sample rate: a FINAL view rebuilt at 2 Hz
    detached its buttons under a click (PAR-2), and a Bay redraws only on Board topics, so DIST needs `refreshDistBlocks` (CARRIER-FOLLOWUP).
    Likewise nothing may move under a held press (MARSHAL-FIX).
12. **The harness has no DCS ship**: a carrier spec injects one under every carrier frame (copy `e2e/carrier-map.spec.js` `mapPage`), and correlations
    it injects must be re-applied (a resync replaces them without a delta).
13. **`wire:record` does not see** record contents, ack payloads, the heartbeat, the snapshot's fixed keys, op argument names or `REFUSAL_CODES`:
    a change there needs `npm run wire:record -- --bump`.

## 4. What's left, and the known bugs

**Not built, in the guide's order.** WP7A: Incirlik's RSU/SFA/PAR is built (§3J), with the PAR panel (§3K); the carrier Positions (L17) and their panels (§3K) have never met a real DCS ship. WP8's §10.3 suggestion chip
and §10.4 staleness (L19) and OVERFLIGHT's four-state lifecycle (L28, `0087`) are built. Everything else in WP6 to WP8 that the guide names is built: the runway-status
panel, `HUNG`, alert/scramble, the ATO import and AR join, the metrics dashboard. L20 and UI-B are complete.

**Known bugs and open items, each with its owner.** Removed from this table because decisions.md shows them done (checked row by row): UI-B's rows (the client resync, the
`RUNWAY_CHANGE` label, the L19 chip against a suspended runway: S-UIB with R3-46/R3-47, and the other stores' resync, Q3-3, which DESK-SYNC and `0106` closed); the gestures at
the one-input ceiling (H110: keep the 2-input forms beside the 1-input ones); the merge-time archive, mission-restart and carrier-ATO decisions (Q3-2 H107, Q3-4 H108, Q3-6 H109);
the Marshal holding Strips it cannot advance and a vacated PAR leaving a Strip at AP (`0110`: no Strip moves at a sign-off); L20's stale-text sweep (S-L20-DONE); and, from earlier
folds, B1-B7, F1-F13 (L23, L24, L26, L27), U1-U8 (UI-A, L16), the `drop-broadcast` selfcheck and CLAUDE.md's soak claims (SOAK, DOCS2), L19's misbinding, the hard-coded 18,000 ft (TA), the `tools/miztoyaml` frequency bug (L25),
and all 15 architecture-check bugs B1-B15 (§3K). ARCH-S/W/C's findings that phase 3 did not fix are in the table below or in §3K's "not done" lists.

| Item | Severity | Owner | Source |
|---|---|---|---|
| **A reset drop counts as traffic**: a Strip dropped by the mission reset in a countable pre-drop state is counted like a finished flight (an exclusion reason `mission-reset` would be one line in `countability`, `traffic-count.js`). The human's call | decision | human | MISSION-CLEAR, S-ARCH-20 |
| **A carrier recovery with no plan and no ATO line counts UNKNOWN**: the flight data does not remember it launched from the hull. If every UNION cycle should count LOCAL without an ATO line, record the launch on `military.carrier` at the Launched NLA. A UNION launch recovering at Incirlik counts TRANSIENT (the recommended default, the human can overrule). Two hulls and a real recovery Strip through FINAL/PATTERN into the count are not walked | low | unowned | CARRIER-ATO |
| **`correlations` has `gapFromDeltas: false`**: a reconciler delta that moves `correlationSeq` by more than one is never adopted, so each busy tick costs a slice resync (23-31 per 20 min in the soak; cheap, self-healing). A client/server decision (adopt a jump when the delta's own seq is the server's, or not) | decision | next lane | NX-1, S-ARCH-22 |
| **Hat offers for a read-scoped session** (`0080`): `hatOffers` counts every Strip server-side while the callsigns come from the session's local Board, so an offer can name a count its callsign list does not show. Not walked | low | unowned | CONSOL-C, S-ARCH-30 |
| **The reset notice has no Playwright spec** (the harness cannot drive a mission reset: it needs a test hook); it is unit-tested through the registry. A pending Mutation on a Strip a reset removed can show **two refusals** (the orphan notice and the server's later NOT_FOUND ack; not deduplicated) | low | unowned | DESK-NOTICES, S-ARCH-32 |
| **A same-mission crash restart with no clock step-back does not clear the Board** (`0108`'s Consequences): a DCS crash restarted on the same mission whose clock does not read a minute behind the old high-water mark is not seen as a new mission. The reset also drops the ATO MISSION lines (re-import per mission) | known limit | human to confirm in practice | MISSION-CLEAR, S-ARCH-20 |
| **The soak never rolls the mission** (`MissionSession` bound directly, the clock never steps back), so `0108`'s reset is unexercised; a future host command calling `noteMissionStart` with a new fingerprint would do it. `hints.airborneEver` stays 0 (no synthetic airborne-on-ground-Strip traffic) and no soak runs the production 12 h retention | test debt | later soak lane | NX-1, ARCHIVE-12H |
| **Soak seed 2's heap slope is 0.92 MB/h (R^2 0.6)**, near the 1.0 MB/h gate, with a real trend; seed 1 is 0.45. If the human's workflow run (`crc-sync-soak.yml`, minutes 240, seed 1, realistic, realtime false, selfcheck true; a second run with seed 2) fails on slope, the first suspect is the per-Strip snapshot growth (31 KB to 289 KB over 4 h). It needs the branch pushed | acceptance | human | S-ARCH-23, NX-1 |
| Three theaters have no `tmCentralMeridianDeg` (MarianaIslandsWWII, Afghanistan, Iraq): pydcs has no terrain for them and nothing citable was found, so their grid headings cannot be converted; needs an export from someone with the maps. `projection.py` still defaults an unknown theater to Syria | theater work | unowned | F2, THEATERS |
| **Carrier, never seen live:** the banner reads "hull not found" without a real ship, so the CARRIER panel, the MARSHAL board's DME placement and APP order, the CARRIER MAP and DIST have only seen an injected ship; the DCS wind at the ship (`ship-wind.js`) and its direction convention are unchecked; the carrier's final Bays have no `capacity: 1`; two hulls, the deck-state board (`0064` B8) are not walked; the carrier's consolidation (`0110`) has never been exercised against a vacated carrier Position | medium | human live check / L17 owner | L17, S-L17, L18S, CONSOL-S, CARRIER-STATE, CARRIER-MAP |
| **Incirlik RSU/SFA/PAR:** an airspace approval that rewrites a flight's frequency desyncs its SFA Rack; the PAR sample and panel have never seen a live DCS track (fix timing against the 500 ms frame, the DCS Incirlik elevation); the placeholder frequencies and PAR coverage are `[SOURCE-DEFINED]` | medium | human live check | L18S, PAR-1, PAR-2 |
| **Squadron data owed for the panels:** the LTAG PAR plate (RWY 05/23 thresholds, now worked out from the ARP assuming a 10,000 ft runway; TDZE, `null` = DCS elevation; TCH 50; DH 200; published GPA) into `config/efsp-facility-incirlik.json` `parApproaches`; `fixToRampSec` 360 measured (approach speed under it assumed); CVN-72 data (angled deck, side numbers in use; the carrier glideslope and touchdown point are **no longer needed**: no carrier PAR since `0116`); the tanker defaults | data | human / squadron | PAR-1, CARRIER-STATE, `0116` |
| **`state/` notes for the next deploy:** a Board snapshot from before CARRIER-STATE (`carriers[].shipInputs`, a stack with `charlieTimeUtc`/`marshalRadialDeg`) **refuses start-up**; the fix is deleting `state/efsp-board.json` and `state/efsp-mutations.jsonl` (the local :3000 was cleared, H122; the production volume is the human's call). A `state/efsp-carriers.json` copy that still has a hull `approach` (or any key this build does not know) **refuses start-up**, naming the file and the key (`0116`, H127); delete the key. A test host copying `config/` must copy `efsp-carrier-recovery.json` too | release check | human / supervisor | CARRIER-STATE, `0116`, H122, H127 |
| **`wire:record` still does not scan** record contents (Strip, flight data outside the carrier flight fields, airspace/correlation/MARSA/runway/SFA records, the hull view's `hull` contents), ack payloads, `efsp-heartbeat`, the snapshot's fixed keys, op argument names and `REFUSAL_CODES`. A change there needs `--bump` by hand. Adding refusal codes or argument names to the surface is the human's open question (S-ARCH-43) | tooling | next wire lane | WIRE-RECORD, S-ARCH-43 |
| **Carrier panel defaults to confirm:** the receiver may Divert only after TRANSFER_CONTROL (conservative, kept); a mark stays until passed even when the value moves back; PassClearance has no Undo; a flight with no side number is listed by callsign; the 6 nm turn-in drawn when none is assigned; the spin rule (3.5 nm, 1,000 ft) | decision | human | S-ARCH-37, S-ARCH-41, MARSHAL-BOARD, CARRIER-MAP |
| A Marshal Observer's click on a marked row: whether it is not sent or refused by the Primary gate is not asserted in a spec; the server refusal for a non-Marshal is walked. The divert chip sits after the ordered indicator slots (not in `INDICATOR_ORDER`); a Strip moved by a TransferStrip without `rackId` is in the Board but unrendered | low | unowned | MARSHAL-MARKS, DIVERT |
| The client still derives runway-change acknowledgers and the inspection authority from the permission table's owners when a record lacks `runwayChangeAcknowledgers` / `inspectionAuthorityPositionId` (L26; `runway-status-rules.js` carries the fallback). Agrees for Incirlik, wrong for any other config | low | unowned | L1b, L26 |
| `strip-alerts.js`'s conformance reason line reads `a.assigned` (the nearest edge), so a block-altitude bust says "from FL240" without the block; use `a.block` (the line numbers moved in DESK-SPLIT; the note predates it) | low | unowned | U6 |
| GCI-held lines are not in `TAC_C2`'s "with AIC/JTAC" tab (GCI is not a delegate: UI-B skipped it with the reason); the metrics `time-to-find` counts that tab as a Bay; `srs-radio.js` has no unit test | low | unowned | UI-A, UI-B |
| A trend `↑` in METRICS is not coloured (an observation, not a threshold failure) | decision | supervisor | L15 |
| One `LINGERING_TRACK` in the 240-minute soak at wave 2: it did not reproduce for L19 (20 seeds at 240 min, 6 at 480), so the fix is unit-tested only. Known limit: a DCS re-mint of a lingering aircraft under a new track id is a new contact to the reconciler; a callsign memory with a position test is not built | watch | next soak run | L27, L19 |
| `grpc-client.js` `windFrom = heading·180/π + 270` is unexplained and the DCS wind vector may be grid, not true (about -2° at Incirlik): needs a live check against the mission editor's wind. The ATIS-wind frame follows it | needs a live check | human | F2, S-F2b |
| Whether DCS-gRPC sends `mission_start` to a stream that connects *after* the mission started (if so every crc-sync restart rolls the mission session; since `0108` a same-fingerprint roll clears the Board only when the clock steps back too; R3-41 says ignore it near connect); a real `.miz` restart through DCS, to see the clear happen. Restart crc-sync against a running server and check the log has no `mission reset` line | needs a live check | human | F3, S-F3, MISSION-CLEAR |
| An MTR (any plain `flightData` Block) amendment overwrites: no history, no `op.value` in the log (`SetBlock` records `blockId`/`value`, which narrows it) | known gap | later slice (H25) | L2 |
| Changing only the MTR designator leaves the old exit fix with no warning (H23 keeps MTRs free text) | low | with an MTR route table | L2, L16 |
| Still bare `Date.now()` outside `src/efsp`: `collab-store.js`, `auth.js`, `atis-store.js`, `tracks.js`, `ws-hub.js`, `srs-client.js`, `grpc-client.js`, `app.js` (weather `updatedAt`, the conflict-alert tick), the `now` defaults of `conflict-alert.js`/`coverage.js`/`datalink.js` | low | unowned | SERVER-SEAMS-1 |
| Still open from the architecture check: `facilityView`/modules instead of the rules bag's closures (ARCH-S 2b); the 164 underscore exports and `efspFlightDataList` -> `efspFlightData` in the client; a CSP meta for `index.html`; the carrier/runway CSS split; the warning field has no state (a warning raised before its panel opened is dropped; 6 s auto-clear, no dismiss); a store's replayed attestation refusal loses `attestation`; the localhost `POST /api/sync-config` hole (AC-2 left it by decision) | cleanup | unowned | ARCH-S/W/C, DESK-TIDY-2, DESK-ACKS |
| Squadron data to confirm: Incirlik GND 275.8 / TWR 251.0 placeholder frequencies (GCLC), the real comm card (R3-53), the MapTiler key rotation (RUNBOOK) | data | human | GCLC, MAPKEY |
| `_cidSeq` passes 999 after ~3 h at stress rate | low | unowned | L6 F9 |
| Merging L3 and L11: a crc-sync test parsing `ojw1v5-export.txt` and `research-render.txt` against research §3's oracle (S-R2-7) has not been written | test debt | integrator | wave 1 |
| Two cosmetic behaviours left alone by decision (D-3): a double 6xxx warning, and a `rev` bump on an unchanged ATO re-import | cosmetic | none | L20PREP |

**Human actions outstanding.** The LG 10-minute live check; one run of the four-hour soak workflow (above); the live wind check (S-F2b) and the live `mission_start` check (S-F3); a live walk of
a real DCS ship against the carrier banner, CARRIER panel, MARSHAL board and CARRIER MAP, and of a real PAR track at Incirlik; L19's taxi/line-up/take-off-without-Airborne walk; the `.env` and MariaDB `init.sh` items from HYG (CLAUDE.md); the squadron
data above. **Release checks:** crc-sync and crc-desktop ship together (`0110`'s offer frame is gone); look for any `state/efsp-facility-*.json` on the server volume before the first deploy of `0110`
(strict state refuses the old `consolidation` shape; RUNBOOK); delete `state/efsp-board.json` and `state/efsp-mutations.jsonl` before the first deploy of
CARRIER-STATE (the old carrier shape refuses start-up) and any hull `approach` in `state/efsp-carriers.json`; clear `efsp-metrics.json` and `efsp-traffic-count.jsonl` on a machine with state when F3 reaches it (its session counter restarts at 1).
**Integrator actions outstanding:** the L3↔L11 cross-test above; the unloaded crc-sync run; then remove the remaining `docs/wip/*.md`.

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
- **Stereo routes have not run in a live session yet** (`0050`). The table now ships the squadron's four Incirlik departures (2026-10-12).
  Block `9F` is a picker now (L16).
- Incirlik's shipped field data (true headings 056/236, acknowledgers, pad names) is
  `[SOURCE-DEFINED]` and approximate; L20's list.
- **The Strip layout (`0056`)** was checked by eye in Playwright screenshots; the all-lit worst
  cases from the mockup have not been walked live with two controllers yet. Indicators appear only
  when something is wrong (`0058`).
- **Assigned `ALT`/`HDG` live on the flight data (`flightData.clearance`, `0058`)**, not on the Strip. Writing one
  bumps `clearanceUpdatedAt`, never `updatedAt`. Open: filed-route conformance, and terrain/MSAW
  once AIRAC data exists. Headings are magnetic everywhere (F2, H15, H69).
- **What a client is told about a contact is decided in one place (`0059`)**: server
  `surveillance/presentation.js`, client `track-label.js`. The wire carries no DCS truth.
  `presentation.test.mjs` plus `ws-hub-wire-strictness.test.mjs` hold the line.

## 5. Where to start: phase 3 is done, what is queued

The plan was `docs/efsp-parallel-plan.md` (history) and then `docs/parallel/arch-check-plan.md`; `docs/parallel/decisions.md` is what is actually dispatched. Each lane works in its own worktree
`/home/nklx/dev/personal/sourcedcs-<lane>` on `lane/<lane>-…`, reads `docs/parallel/lane-rules.md`, and leaves `docs/wip/<lane>.md` for the next fold. **Everything that was dispatched is merged
into `efsp-wp5-correlation`**: waves 1-3, the refactor W1-W7 and the rename, L20, the post-refactor features (ADRs `0098`-`0106`), and the architecture check's three phases (bugs, tests and tooling,
structure: §3K) with ARCHIVE-12H, MISSION-CLEAR, CARRIER-ATO, NX-1, THEATERS, CONSOL-DESIGN/S/C, SERVER-TIDY, DESK-SPLIT (its 12 committed commits, S-ARCH-31) and DESK-NOTICES,
then the panels: SETTINGS-TABS, DIVERT, CARRIER-STATE, MARSHAL-BOARD, CARRIER-MAP, MARSHAL-FIX, MARSHAL-MARKS, SIDE-SWAP, WIRE-RECORD, PAR-1, PAR-2 and
CARRIER-FOLLOWUP (§3K), and this docs pass (DOCS-PANELS).

**The one-agent rule (H112).** Since 2026-10-05 **one agent works at a time** (it replaces H105's three); a stopped agent is not resumed, a fresh one is launched. Every briefing requires both unit
suites (S-ARCH-16). The supervisor runs the sharded Playwright after a merge that touched the client (`lane-rules.md` 7).

**Queued, in no fixed order** (none is dispatched; check decisions.md first):

| What | Why it waits | Source |
|---|---|---|
| `definitionHistory` on the wire | the airspace History view is partial without it; a later crc-sync lane | S-WAVEB-2 |
| A route from a DCS line drawing | AP2B-Q3: "later" | H102 |
| The correlation seq-jump decision (`gapFromDeltas: false`, §4) | a client/server decision; costs slice resyncs, not correctness | NX-1 |
| **Declutter last** (formation, navpoint, ground clutter) | stays off until the very end of the EFSP work (H6, H70); the navpoint declutter is reworked once AIRAC data lands | §4 deferred |
| The cleanup list at the end of §4 (`facilityView`, underscore exports, CSP, CSS split, bare `Date.now()` sites) | each rewrites import lines or shared contracts; do them one at a time | DESK-TIDY-2, SERVER-SEAMS-1/2 |
| A soak that rolls the mission, and the human's 240-minute workflow run | tools lane / human action | NX-1 |
| The live checks in §4 | need a real DCS server and a real ship | human |
| The squadron data in §4 (LTAG PAR plate, `fixToRampSec`, CVN-72) | data, not code: config files only | human / squadron |
| Refusal codes and op argument names on the wire surface | waits for the human's answer (S-ARCH-43) | next wire lane |
| The deck-state board (`0064` B8) | not designed | later carrier lane |

**What to keep true while working** (§3K's traps): both unit suites in every lane; client modules are leaves plus the change bus with no cycle; no `window.*`; `deliverEfsp` is the one server delivery
path; `SyncedStore` for a new sequenced store; config factories and `createApp({env})`; `withPaths` for private test paths; e2e specs reach modules through `crc.<module>` and follow a moved function;
`wire:record` after a wire change; never hand-merge a golden.

**The integrator, after every merge:** run both unit suites and, when the client changed, the sharded Playwright (re-run a failing spec alone before counting it); restart the local crc-sync; fold
`docs/wip/*.md` into the guide and this file; walk the sorties and pilot requests by hand. A standing rule since `S-M-e2efix-l23`: every e2e spec must `require('./helpers/test')` and leave no Strips on the Board.

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
- **When a rule is per-strip-type, check every strip type.** `0051`'s acceptance criterion would have passed on
  DEPARTURE and ARRIVAL while doing nothing at all on OVERFLIGHT, because each strip type has its own
  Block Map and the criterion names no strip type. The test that passes is not always the test that
  matters; `block-map.js`'s `interlockBlocks()` exists so that one is now asserted per strip type.
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
  **The guard does not cover every advance.** `board/ops/invoke-nla.js` sets the latch only when the NLA did
  not transfer (`if (applied.ok && !result.transferTo) nlaHistory.set(...)`), and a carrier handoff returns before
  it. So a double tap on a transfer-shaped NLA such as "Hand Off to AP" is guarded only on the client
  (`_swallowRepeatAdvance`, `bay-view.js`, a board-wide 400 ms window in browser time); the server evaluates a
  second press afresh instead of discarding it as a no-op success. The e2e harness turns the server guard off
  (`CRCSYNC_NLA_GUARD_MS=0`), so no spec shows the difference.
- **Then add the matching UI check.** A green sortie proves the server does the right thing and says
  nothing about whether a controller can ask for it.
  `crc-desktop/tests/efsp-ui-reachability.test.mjs` renders the real `bay-view.js` and
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
