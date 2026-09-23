# WP6 — the military layer: the plan

> Companion to `docs/efsp-briefing.md`, which is the entry point. This is the
> sequenced plan for WP6's remaining deliverables. **Phase 1 (MARSA) is done** —
> see `docs/adr/0051`. **Phase 2 (the Block namespace) is done** — see
> `docs/adr/0052`, and the note at the end of Phase 2 for the one place it
> deviates from what is written below. Phase 3's design is the part worth not
> re-deriving.

## Context

`docs/efsp-briefing.md` is the handoff for EFSP work and its §5 recommends **WP6 proper**.
WP0–WP5 are built and green (crc-sync **984** tests, crc-desktop **324**, ADRs `0001`–`0050`);
three of WP6's eight deliverables already landed (§9.11 airspace activation authority `0036`,
§6.4's first military Blocks `0026`, §9.10 stereo routes `0050`).

This plan covers **the five remaining WP6 deliverables** plus the `[SOURCE-DEFINED]` audit
that §13 lists as a WP6 acceptance criterion in its own right:

| # | Deliverable | Guide | Acceptance criterion in §13 |
|---|---|---|---|
| 1 | MARSA relation + course/altitude void interlock | §9.2 | yes |
| 2 | Field state, arresting-gear gating, runway-change workflow | §9.7 | yes (two of them) |
| 3 | Alert / scramble constraints | §9.6 | — |
| 4 | Ordnance state | §9.5 | — |
| 5 | MTR fields | §9.4 | — |
| 6 | `[SOURCE-DEFINED]` audit over the whole tree | §0.2 | yes |

**This is several sessions' work.** It is sequenced into seven phases below, each of which
lands green with its own ADR, so stopping between phases leaves the tree in a shippable state.

Two habits from the briefing's §6 govern the whole thing and are not optional:
**walk the sorties by hand once the suite is green** (`0049` — five defects, all in transitions),
and **walk what a PILOT would ask for, not just what a Strip does** (`0050` — four defects plus
one reversed decision, all from asking "what if they request a change?").

---

## Phase 1 — MARSA (§9.2)

§9.2's title is the design brief: *"model it as an edge, not a flag."*

### 1a. `crc-sync/src/efsp/marsa-store.js` — new, a FIFTH peer store

Keyed by `marsaId`; **participants are `fdrId`s, never `stripId`s** — the same call `0045` made
for correlation and for the same reason (one FDR legitimately has several Strips: per-Facility
replicas, a TOFI `MISSION` Strip, an arrival converted in place; a `stripId` participant list
lets a tanker's INCIRLIK replica be in the relation while its CENTER replica is not, which is
two answers to an identity question).

Built on `correlation-store.js` throughout: own `_relations` Map, per-record `rev`, own `_seq`,
`setMutationLog`, a `_recordAudit` that logs refusals too, append-only `transitions[]`, one
never-throwing `apply()`, `snapshot()`/`restore()`.

Record = §9.2's `MarsaRelation` schema verbatim, **plus three fields it lacks**:

- `rendezvousAt` / `rendezvousBy` — §9.2 rule 2 arms the interlock *"prior to rendezvous"* and
  the published schema has no rendezvous field, so the interlock has no off switch. Set by an
  explicit `MarkRendezvous` op, **not derived from the radar picture**: whether two aircraft have
  joined up is a judgement a controller or the tanker makes verbally. WP5 declined to invent
  "detected airborne" for exactly this reason (`0047`); inventing a proximity threshold here is
  defect D11 *and* would silently disarm the highest-value interlock in the military layer.
- `endedBy` ∈ `END_CONDITION | PARTICIPANT_RETIRED` — the schema carries `endedAt` with no "why"
  beside it, and three different things end a relation. `voidedBy` already distinguishes the void
  causes; this does the same for the non-void ends.
- `state` ∈ `ACTIVE | ENDED | VOIDED`, `declaredBy`/`declaredPositionId`.

Ops via `apply()`: `DeclareMarsa`, `MarkRendezvous`, `AddParticipant`, `RemoveParticipant`,
`EndMarsa`, `VoidMarsa`. Invariants: ≥2 participants; **at most one ACTIVE relation per FDR**
(what makes the auto-void and the SREG refusal decidable without a tiebreak); `declaringCallsign`
required and free text (§9.2 rule 1 — *"the declaration is the tanker's, and it is verbal — the
EFSP records it, it does not decide it"*), capped at `MAX_FREE_TEXT`.

`AddParticipant`/`RemoveParticipant` exist because they are *pilot requests*, not lifecycle
states: "SHELL71, VIPER13 is joining you" arrives mid-relation, and void-and-re-declare would
lose the start event, the declaring callsign and the history of a relation that never ended.

**`restore()` keeps the relation intact, state and all** — deliberately unlike
`correlation-store.js`, whose header says a persisted track id is a lie after a restart because
DCS re-mints ids. A MARSA relation names `fdrId`s and records a verbal declaration; nothing about
a crc-sync restart makes that declaration untrue, and coming back up with every AR silently
reverted to ATC separation is the *"second controller inherits a lie"* failure §4.8.3 names,
caused by us.

### 1b. The interlock — `voidForAssignment(fdrId, {cause, blockId, …})`

**It voids; it does not refuse.** A controller who needs to turn or climb a joining aircraft must
be able to, immediately — refusing the `SetBlock` is exactly backwards. The clearance applies and
MARSA voids under it, which is the conservative direction: ATC re-assumes separation.

Not a Mutation of its own (no `baseRev`; the caller is mid-`SetBlock`), but it *is* audited under
the `clientMutationId` of the SetBlock that caused it, so the log answers "why did SHELL71's
MARSA void" with the exact clearance.

**Which Blocks count is Block Map data, not a code list** (§6.5: "the Block Map MUST be data").
Add `interlock: 'COURSE' | 'ALTITUDE'` metadata in `crc-sync/src/efsp/block-map.js` and an
`interlockFor(role, blockId)` accessor:

| Role | COURSE | ALTITUDE |
|---|---|---|
| `DEPARTURE` | `20` (guide §6.2: "Heading") | `21` (guide §6.2: "Initial altitude") |
| `ARRIVAL` | `9A-VECTOR` (radar vector) | `7` (assigned/cleared altitude) |
| `OVERFLIGHT` | *add* `9A-VECTOR` | *add* `7A` |
| `MISSION` | none | none |

- DEPARTURE's Block `7` is `filed.requestedAltitude` — **filed intent, not an assignment** — so it
  is deliberately not a trigger.
- `OVERFLIGHT` has no assignment Block today and the guide publishes none for it; add both,
  annotation-routed, mirroring ARRIVAL (`[SOURCE-DEFINED]`, same basis as `OVERFLIGHT_BLOCK_MAP`'s
  whole existence, `0023`). Without them a MARSA participant on an overflight Strip can be
  vectored with the acceptance criterion silently not holding for one role.
- `MISSION` gets none: the interlock is about *ATC* issuing a clearance, and the MISSION Role is
  the MRU-side record (§9.8), not an ATC clearance surface.
- Fire on **any** write to an interlock Block, changed value or not — §9.2 rule 2 says "any
  `SetBlock`", and the safe direction is to void. **Exception:** `confirmVacated`, which carries
  no value and issues no instruction — it records that the aircraft *left* an altitude.

### 1c. Keeping MARSA and `separationRegime` from disagreeing

`fdr.tofi.separationRegime` (Block `SREG`, `0025`) already has a `MARSA` value, and guide §4.8.3
says entering the block *"genuinely changes"* the regime — *"if a second controller takes TAC_C2
ten minutes later, the state must already be correct, or they inherit a lie."* Two answers to one
question is the defect class, so:

- Declaring writes each participant's `separationRegime` to `MARSA`; ending or voiding writes it
  back to `ATC`. Done through an injected `setSeparationRegime` closure (the `fdrExists` /
  `liveStripsForFdr` pattern) — the store never holds an `FdrStore`.
- `board-store.js` **refuses a direct `SREG` write while an ACTIVE relation holds the FDR**, with
  a reason naming the relation and pointing at End/Void MARSA. `DUE_REGARD`/`MARSA` mutual
  exclusion (§4.6.3 rule 5) already holds by construction — one enum, not two booleans.

### 1d. Wiring

- `permission.js` — `canDeclareMarsa(actingPositionId)`, refused by **class** for
  `USING_AGENCY` exactly like `canCorrelate` (a range Position works no Strips, §4.1 rule 2).
- `board-store.js` `_applySetBlock` — after a successful write, consult `rules.marsaInterlockFor`
  and return `marsaVoided` on the result. Also the `SREG` refusal (1c) and a call to
  `marsaStore.onFdrRetired()` from `_releaseFdrIfLastStrip`.
- `index.js` — construct the store, inject `fdrExists`/`setSeparationRegime`, add the two `rules`
  hooks, add `marsa` to `_persist`/`_restore`, and evict in `_reconcileRestored`.
- `efsp-ws.js` — a fourth dispatch path `efsp-marsa-mutation` → `efsp-marsa-ack` +
  `efsp-marsa-delta` (own `marsaSeq`), copying `_handleCorrelationMutation` including its
  "Primary somewhere" session check (`0029` — *"a new dispatch path is exactly where that check
  gets forgotten"*, and it was right twice). `_snapshotMessage` carries `marsa: marsaStore.getAll()`.
  A `marsaVoided` on a board-delta result emits a marsa-delta alongside, so the clearance and the
  void land in one round trip.

### 1e. Client (`crc-desktop/app/public/js/panels/efsp/`)

Follows the correlation precedent exactly — **a badge, not a Block**, because the record is keyed
by its own id with `fdrId` participants and there is no Block target kind for that (and
`efsp-ui-reachability.test.js` only holds *writable* Blocks, its documented blind spot).

- `efsp-state.js` — `efspMarsa` Map (`marsaId` → relation), `applyEfspMarsaDelta`,
  `activeMarsaForStrip(strip)`, `marsaParticipantStripIds(marsaId)`, snapshot fill, reset.
- new `marsa-badge.js` (peer of `correlation-highlight.js`) — a pure, DOM-free
  `marsaBadgeFor(strip)` returning `{text, className, title, voided, participantFdrIds}`, plus
  module-level highlight state for §9.2 rule 5 (*"selecting one participant MUST highlight the
  others"*), refreshed from `bay-view.js`'s `_afterSelectionChanged` — the one place every
  selection change runs through. UI text uses the §9.2 rule 6 glossary expansion, *"Military
  Authority Assumes Responsibility for Separation of Aircraft"*, exported from the store so
  there is one copy.
- `bay-view.js` — append the badge in `_buildStripEl` next to `_appendCorrelationBadge`; a
  `MARSA…` popover (copying `_openTofiEntryPopover`) to declare/mark rendezvous/end/void;
  participant Strips get a class so rule 5's highlight is visible.
- `efsp-ws.js` — `sendEfspMarsaMutation(actingPositionId, marsaId, baseRev, op)`, mirroring
  `sendEfspCorrelationMutation` (not registered as pending — the §5.6.3 replay machinery is keyed
  on Strip identity).
- `app.js` — `efsp-marsa-delta` / `efsp-marsa-ack` cases in the `ws.onmessage` switch.
- `efsp-panel.js` `_dispatchDotCommand` — `.marsa`, `.rendezvous`, `.endmarsa`, `.voidmarsa`.

### 1f. Tests and docs

- `crc-sync/tests/efsp-marsa-store.test.mjs` — lifecycle, the one-active-relation invariant,
  refusals audited, restore-keeps-state.
- `crc-sync/tests/helpers/efsp-scenario.mjs` — add `marsaAct`/`mustMarsaAct`, mirroring the
  existing `airspaceAct`/`mustAirspaceAct` pair (the harness already has `crew`, `hold`, `act`,
  `mustAct`, `jumpTo`, `advance`, `airborneDeparture`, `handedToCenter`, `activate`).
- `crc-sync/tests/efsp-scenario-marsa.test.mjs` — **its own durable board** (every scenario file
  needs one, `0002`). Walks a tanker + two receivers: declare → vector a receiver before
  rendezvous → **assert the relation voided, `voidedBy === 'CONTROLLER_COURSE_CHANGE'`, and every
  participant Strip carries the alert** (the §13 acceptance line, asserted verbatim) → then the
  disarmed case after `MarkRendezvous`. Use `advance()` from `tests/helpers/efsp-scenario.mjs`,
  never `InvokeNla` directly (the 400 ms double-tap guard silently swallows a second press).
- `crc-desktop/tests/efsp-marsa-client.test.js` — DOM-free badge/state, copying
  `efsp-correlation-client.test.js`.
- `crc-desktop/tests/efsp-ui-reachability.test.js` — add a `marsa` option to `renderStrip()` and a
  stubbed `sendEfspMarsaMutation`; assert the badge, the popover and the dispatched op.
- **ADR `0051`** — the fifth store, participants-are-fdrIds, void-not-refuse, rendezvous as an
  explicit action, and the `SREG` refusal.

---

## Phase 2 — the military extension Block namespace (§6.4)

The other three deliverables all need fields, and `fdr.military` is still `null` with a
`// WP6 hook` comment. This phase turns it on **once**, so phases 3–5 add behaviour rather than
schema.

**The numbering collision must be settled here and written down.** `MISSION_BLOCK_MAP` (`0026`)
froze `M1`–`M8` with its *own* meanings, which differ from the guide's §6.4 table (its `M4` is
the beacon; the guide's `M4` is IFF Mode 1/2; its `M5` is controlling agency, the guide's `M7` is).
Resolution:

- **`M1`–`M8` stay exactly as `0026` froze them.** Renumbering a shipped Block Map is worse than
  the divergence.
- **The guide's `M`-numbers are cited in comments but not used as Block ids on the ATC maps.**
  `block-map.js`'s `9F` comment already settled this once: the `M`-prefix namespace belongs to
  `MISSION_BLOCK_MAP`. The convention that wins is this codebase's own — **sub-letter the field
  onto its parent Block**, which every local extension already does (`3A`–`3E`, `8A`/`8B`,
  `9A`–`9F`, `5A`, `14A`–`14D`). Phase 3's design pass independently reached the same conclusion
  for the hook requirement. Proposed mapping, each carrying the guide's `M`-number in its comment
  so the next reader can find it:

  | Guide | Field | Block id | Parent family |
  |---|---|---|---|
  | `M15` | hook / arresting-gear requirement | `3F` | 3 = the airframe |
  | `M14` | ordnance state | `3G` | 3 = the airframe's configuration |
  | `M10` | MTR designator / entry fix / entry time | `9G` | 9 = the route; an MTR *is* a route |
  | `M11` | MTR exit fix / exit estimate / altitude after exit | `9H` | 9 = the route |
  | `M16` | alert status | **open** | no natural parent — decide in Phase 5 with §9.6 in hand |

  Confirm each against `block-map.js` and `strip-template.js` before writing, and record the whole
  mapping in the Phase 2 ADR — this is the third time the `M`-namespace question has come up and
  it should not need a fourth.

`fdr.military` becomes an object, present-and-unpopulated per §12 for everything WP6 does not
deliver (`M9` ALTRV, `M12` AR info, `M13` SCL, `M17` fuel state, `M19` release authority — all
`null`, no setter, no Block, like `identity.modeOne` already is):

```
military: { ordnanceState:'CLEAN', hookRequired:false, alertStatus:'NONE',
            mtr:{designator,entryFix,entryTimeUtc,exitFix,exitEstimateUtc,requestedAltitudeAfterExit},
            altrvRef:null, arInfo:null, scl:null, fuelState:null, releaseAuthority:null }
```

Enum fields route through dedicated setters, **not** the generic `setField` path — the precedent
`setAirspaceOwner` established (`0018`) and `setTofi` followed, for fields where a validated enum
and a structural write path matter more than a documented convention.

Touches: `fdr-store.js` (`createFdr` seed, `WRITABLE_PATHS`, new setters, snapshot/restore is
already whole-object), `block-map.js` (the new Block ids per role), `strip-template.js` +
`ENUM_SELECT_BLOCKS` client-side, `compactBlocksFor` in `bay-view.js` (or
`DELIBERATELY_NOT_IN_COMPACT_VIEW` with a reason), and the parity test.

**Add an `interlock` assertion to `crc-desktop/tests/efsp-block-map-parity.test.js`.** It
currently compares only existence / `required` / writable-kind / `path` / `provenance`, so
Phase 1's new metadata is invisible to it — which is fine until the client needs to know, and
wrong the moment it does.

### What Phase 2 actually did, and the one deviation (`docs/adr/0052`)

Built as written above, with one exception: **the `9G-*`/`9H-*` MTR Blocks are reserved, not
added.** The mapping is settled and recorded in code (`MILITARY_BLOCK_NAMESPACE` in
`block-map.js`, asserted against the Block Maps and against `setMilitary`'s allow-list), and
`fdr.military.mtr`'s six fields are seeded per §12 — but the Blocks themselves land with Phase 6,
because §9.4 is explicit that `M11`'s exit fix and exit estimate want *prominent placement*, and
that is Phase 6's design call. Adding them now would have meant six more chips on every Strip or
six `DELIBERATELY_NOT_IN_COMPACT_VIEW` entries whose only honest reason was "not designed yet".
So **Phase 6 adds `WRITABLE_PATHS` entries and Blocks together**; everything else about the shape
of `fdr.military` is settled and should not be re-opened.

`M16` (alert status) went the same way and for the reason this plan already gave: the field is
seeded and `setMilitary` validates the enum, and **Phase 5 picks its Block id** with §9.6 in hand.

Two extras, both one line and both listed in the briefing as known gaps, so they were closed here
rather than carried: the parity test now compares `interlock` (which **immediately failed** — the
client had never carried the tag at all) and `target.field` for the `tofi`/`military` kinds, and
`efsp-ui-reachability.test.js` now counts a boolean-toggle Block as writable (it did not, so `3F`
would have been invisible to the one test whose job is noticing exactly that).

---

## Phase 3 — field state and arresting gear (§9.7)

*The guide calls this "the highest-value military-specific feature in the guide, and it has no
civil equivalent." It carries two of §13's five WP6 acceptance criteria and is the foundation
Phases 4–5 build on (hot-cargo pad, alert pad).*

Two hooks for this already exist in the tree and should be used rather than replaced: the
`ops-field-state` Bay in `facility-config.js` (currently `// WP6 hook, inert`) and
`twr-runway-queue`'s **one Rack per runway** (`rwy-05` / `rwy-23`), which is the only runway
inventory anywhere in the codebase today.

A design pass has settled the seven open questions:

**Store.** A fifth peer store, but **one instance with records keyed by `facilityId`**, not one
per Facility. The guide pre-empts the "is it a store" question at §9.1 (*"the field-state model
(§9.7) is a peer of the Strip model, not a subsidiary of it"*). `BoardStore` is instantiated N
times only because a Strip is genuinely handed across boundaries and two Maps prevent it reaching
the wrong one; nothing about a runway is ever handed anywhere, so `AirspaceStore`'s single-instance
reasoning applies unchanged. Constructed *before* `index.js`'s facility loop, so `rules.fieldStateFor`
is an ordinary closure with no lazy-`facilities` dance. One record per Facility holding `runways[]`
— `rev` at the FieldState level, so two controllers reconfiguring at once collide on `STALE_REV`,
which is correct rather than costly.

**Inventory: shipped config, in `facility-config.js`'s `DEFAULT_CONFIG`.** §8.2's own table assigns
"Runway list; Rack-per-runway mapping; arresting-gear configuration (§9.7)" to Facility adaptation.
*Not* derived from `twr-runway-queue`'s rack ids: a rack id is a Strip container, gear has nowhere
to live in one, and a Facility that lays its queue out differently would silently have no runways
(`0041`'s silent-deny class). Not `0041`'s frozen inclusion list either — **there is no code-side
runway set for a config list to fall behind**; a runway list is primary data, like
`config/efsp-airspaces.json`. `rackId: 'rwy-05'` names a thing declared twenty lines above it in
the same file, which is `0043`'s *stated* relationship, not an inferred one. `DEFAULT_CONFIG` only
— `_loadOne`'s shallow merge means the shipped JSON needs no edit (`0043`'s own precedent).
`validateConfig` **warns, never throws** on a runway naming an unknown `rackId` and vice versa.
The config/state split is load-bearing: config owns *which runways and gear exist*, the store owns
*status, gear state, suspension, inspection, runwayChange* — or `setFacilityConfig` (which persists
the merged config to `state/`, `0048`) would pin a runway's status on disk forever.

**Rule 1 → `nla.js`.** One `ctx` rule `fieldStateFor()`, threaded through `board-store.js`'s
`_nlaCtx()` — which puts it on **both** call sites at once, `_applyInvokeNla` *and*
`_validateBayImpliedTransition`. That second one is the point: §3.5 rule 4 makes NLA an
accelerator, never the only path, so gating only the button is a trivial bypass via drag. A new
pure `src/efsp/field-state.js` (the `correlation-match.js`-to-`correlation-store.js` relationship)
holds `runwayIdForStrip` and `runwayInhibitFor`. **Runway resolves rack first, FDR field second** —
`strip.rackId` is where the controller *put* the Strip; the FDR field is filed intent. Cases:
DEPARTURE `TAXI` / `RUNWAY_QUEUE` / `LUAW`, and ARRIVAL **`HANDED_TO_TOWER → FINAL`, not
`FINAL → LANDED`** — the latter is an *observation* that the aircraft touched down, and inhibiting
it makes the board lie about an event that already happened and strands a landed aircraft with no
legal transition. **Unknown or unresolvable runway must not inhibit** — fail open. `CLEARED`'s
§9.6 placeholder comment stays untouched (different deliverable).

**Rule 3: its own two-acknowledgement machine** on the field-state record. `board-store.js`'s
primitives are structurally unusable on three counts — Strip-attached, *cross-Facility by
construction* (`_applyCoordinationPropose` refuses a same-Facility target, and TWR/OPS/APP are all
INCIRLIK), and one-proposer/one-responder with no way to express an AND. The machine:
`null →(TWR ProposeRunwayChange)→ PROPOSED →(OPS ack ∧ APP ack, order irrelevant)→ ACKNOWLEDGED
→(TWR BeginRunwayChange)→ IN_PROGRESS →(CompleteRunwayChange)→ PENDING_INSPECTION →(OPS
CompleteInspection per runway)→ null`, with `REJECTED` terminal. **§13's second acceptance
criterion is `BeginRunwayChange`'s single `state === 'ACKNOWLEDGED'` guard** — write that assertion
first. The acknowledger set is derived from a `runwayChangeAcknowledgers: ['OPS','APP']` config key,
so a Facility without an APP cannot deadlock and the guide's *"SOURCE has no separate SOF Position,
so OPS carries that role"* is data rather than a constant.

**Rules 1–2 are a *separate* family from rule 3** and conflating them is the easy mistake: rule 3
changes which runway is active, rules 1–2 reconfigure the gear. Ops `BeginBarrierChange` /
`SetGearState` (legal only while `SUSPENDED_BARRIER_CHANGE`) / `CompleteBarrierChange` /
`CompleteInspection` / `CloseRunway` / `OpenRunway`. **`SUSPENDED_BARRIER_CHANGE → OPEN` is not a
legal edge** — that one absent entry in a `LEGAL_TRANSITIONS` table (`airspace-store.js`'s shape)
*is* rule 2, enforced structurally rather than by a check somebody can forget.

**Rule 2 permission: a new `canActOnFieldState(actingPositionId, opKind)` + `FIELD_STATE_OP_OWNERS`
table** — `canCorrelate`'s precedent for "a new dispatch path gets its own predicate",
`canActOnState`'s shape for the table. **Not** a new entry in `OP_KINDS`: every `PERMISSIONS` entry
built with a filter would silently pick it up, which is the maximally-permissive trap
`permission.js`'s own header warns about. Attribution needs no new mechanism — `actingPositionId`
is already session-bound (`0029`), and the store stamps `lastInspection.{by,positionId}` *and*
writes the MutationLog. Session binding uses `_handleMutation`'s per-Facility check, **not**
correlation's "Primary somewhere": a field has exactly one Facility, and OPS at INCIRLIK must not
suspend a runway elsewhere.

**Rule 4: `3F`, not `M15`, and computed rather than stored.** `3F` **already exists** — Phase 2
built it (`docs/adr/0052`) on exactly this reasoning: the `M`-prefix namespace belongs to
`MISSION_BLOCK_MAP`, which `0026` froze with conflicting meanings, and the 3-family *is* the
airframe (3A type, 3B wake, 3C tail, 3D unit, 3E home station). It is a click-to-toggle boolean
routed through `fdrStore.setMilitary()`, present on all three ATC Roles, and a ✓ means the aircraft
**requires** arresting gear (not that it has a tailhook — that distinction is why it is not a
generic writable path). What is left for this phase is the *check*, not the field. The mismatch
itself is a pure `gearMismatchFor(fdr, runway)`
**derived from two records that each already broadcast whole**, which satisfies `0045` more
strongly than a stored field: a stored one would make a single `SetGearState` sweep every arrival
Strip and bump each `rev`, flooding the delta ring and invalidating every controller's optimistic
edit — the exact failure `correlation-store.js`'s `_seed` comment says is why correlation got its
own `rev`. Rendered on the Strip, not a panel (§8.5). Note this is the one §9.7 rule with **no §13
acceptance criterion**, so it must not grow a record, an alert type and a broadcast.

**Rule 5: own `fieldStateSeq` and own `efsp-field-state-delta`** — a deliberate deviation from the
guide's literal *"broadcast on the Board sequence"*, and the reasoning goes in the ADR. `boardSeq`
is not a counter, it is the index into `board-store.js`'s `_log` ring that `getDeltaSince` replays
for a reconnecting client, and that ring holds Strips. All three literal readings break: putting
field state in `BoardStore` contradicts §9.1; bumping `boardSeq` from outside leaves `getDeltaSince`
with no record at that index (a gap the client cannot detect); riding `efsp-board-delta` without
bumping silently drops field state from resync, so **a controller reconnecting after a suspension
sees an `OPEN` runway** — worse than the bug the sentence guards against. The sentence's real job
is the *contrast* (broadcast and audited, not a fire-and-forget alert), and the Airspace/Correlation
shape honours both halves. Follow **correlation, not airspace**, on one point: audit the
`STALE_REV` refusal rather than returning early, because a refused `BeginRunwayChange` is the most
interesting refusal in this deliverable.

**Ordering within Phase 3:** (1) config + pure module, (2) store with the barrier family only,
(3) wire + permission — *suspension is now reachable, audited and durable, inhibiting nothing*,
(4) NLA — **§13's first criterion lands here**, (5) the runway-change machine — **§13's second**,
(6) client panel + proactive inhibit rendering, (7) `3F` / hook mismatch last.

Acceptance lines to assert verbatim in `efsp-scenario-field-state.test.mjs`:
*"A barrier reconfiguration suspends the runway, inhibits takeoff and landing NLA with the reason
shown, and requires an attributable inspection-complete action to resume"* and *"A runway change
cannot be initiated without `OPS` and `APP` acknowledgement."* Plus a **D21 case** in
`efsp-permission.test.mjs`: a controller holding both `TWR` and `APP` must not satisfy
`BeginRunwayChange` from one acting Position.

**Two things not implemented, and the comments must say so rather than implying coverage:**
runway *occupancy* (§9.7's schema has no occupancy field and §3.5's `RUNWAY_QUEUE` row cites no
section — inventing one is D11), and genuinely configurable inspection authority (the
`fieldState.inspectionAuthorityPositionId` key narrows but cannot widen; widening needs
config-derived permissions, `0035`'s shape, which is a bigger change than this deliverable).
Also: the `ops-field-state` **Bay** is a Strip container labelled *"WP6 hook, inert"* — the
field-state **board** is not Strips and belongs in its own dock panel (`airspace-panel.js`'s
*"not a Bay of Strips"* argument). Do not wire the board into that Bay because the name matches.

---

## Phase 4 — ordnance state (§9.5)

`M14` ∈ `{CLEAN, LOADED, HUNG, EXPENDED}` — the field lands in Phase 2; this phase is the
propagation the guide actually asks for:

> `HUNG` MUST propagate to field state: hung ordnance influences **runway selection** … Implement
> as an advisory on runway assignment plus a routing constraint toward the designated
> hazardous-cargo parking area.

So: a `HUNG` Strip raises an **advisory** (not an inhibit — the guide says advisory) on
`assigned.landingRunway` / `filed.departureRunway` assignment, and the hot-cargo pad from Phase
3's field state becomes the named routing constraint. The Kunsan basis (*"selects the runway that
minimises taxi distance to the hot cargo pad, weather permitting"*) is **verified local practice
at one base, not doctrine** — the advisory must say which runway config the facility designates,
read from config, and must not compute a taxi distance this codebase has no geometry for.

---

## Phase 5 — alert and scramble (§9.6)

`M16` ∈ `{NONE, ALERT, SCRAMBLE}` — the field landed in Phase 2 (`fdr.military.alertStatus`,
validated by `setMilitary`) and **this phase picks its Block id**, which Phase 2 deliberately left
open. Sub-letter it onto a parent per `docs/adr/0052`'s table; `MILITARY_BLOCK_NAMESPACE`'s `M16`
row is where the answer goes, and a test already holds that row against the Block Maps. Behaviour:

- A `SCRAMBLE` Strip raises a **Board-wide priority indication**.
- The configured alert-pad access route is marked constrained, and conflicting taxi Strips flagged.

**The guide's `[GAP]` is binding and must be honoured in code and comment:**

> Do not implement a scramble/interceptor priority *ordering* from this guide. FAA JO 7110.65
> §2-1-4 and §9-2-7 were not read. Until then, `SCRAMBLE` raises an indication and the controller
> decides.

So: **no NLA inhibit, no queue reordering, no automatic sequencing.** `nla.js`'s `CLEARED` case
carries the placeholder comment ("Alert-pad conflict (§9.6) is WP6/field-state territory") — it
gets a *flag*, not an inhibit, and the comment is rewritten to say why.

"Conflicting taxi Strip" needs care: there is no taxi-route model in this codebase, so the honest
implementation flags Strips in ground states (`PUSHBACK`/`TAXI`/`RUNWAY_QUEUE`) at that Facility
— the set that can physically be in the way — labelled `[SOURCE-DEFINED]`, with the narrowing a
real taxi-route model would allow written down rather than faked.

---

## Phase 6 — MTR fields (§9.4)

`M10` (designator / entry fix / entry time) and `M11` (exit fix / exit estimate / requested
altitude after exit). The guide is explicit that **`M11`'s two items are what a controller asks
for by voice and must post**, so they get prominent placement, not a collapsed sub-field — which
is exactly why Phase 2 reserved the ids rather than adding the Blocks blind.

`fdr.military.mtr`'s six fields are already seeded and null (`docs/adr/0052`). This phase adds, in
one go: the six `military.mtr.*` entries in `WRITABLE_PATHS`, the `9G-*`/`9H-*` Blocks on all three
ATC Roles (`9G-MTR`/`9G-ENTRY`/`9G-TIME`, `9H-EXIT`/`9H-TIME`/`9H-ALT` — the `9A-*` split's shape,
so per-Block facility narrowing works), their client mirrors and labels, and their placement. The
`MILITARY_BLOCK_NAMESPACE` rows for `M10`/`M11` say `9G-*`/`9H-*` today; replace the wildcard with
the real ids and the drift test starts checking them. Note these are plain `fdr`-routed free text,
**not** the `military` target kind — that kind exists for the enum and the boolean, and an MTR
designator is neither.

The lost-comms rule — *"separate assuming the aircraft maintains the higher of the minimum IFR
altitude for each remaining segment or the highest altitude in the last clearance"* — is
implemented **as a rendered advisory, not a computation**: this codebase has no minimum-IFR-altitude
data for any segment, and synthesising one would be D11. The advisory states the rule and shows
the highest altitude in the last clearance, which is the half we actually have.

---

## Phase 7 — the `[SOURCE-DEFINED]` audit

§13 lists it as a WP6 acceptance criterion: *"No UI text or code comment presents a
`[SOURCE-DEFINED]` behaviour as real-world doctrine. **Audit this explicitly.**"* It has never
been run as a whole-tree pass, only observed file by file, and the briefing notes it gets harder
after every further deliverable.

1. `grep -rn "SOURCE-DEFINED" crc-sync/src crc-desktop/app docs` — inventory every marked item.
2. For each, check the **rendered UI text and the user-facing docs**, not just the code comment —
   the criterion is about what a controller reads.
3. The known-dirty list from the briefing to check first: `positionRadars`' shipped defaults
   (guesses at which scope sits at which console), `deriveEquipmentSuffix` (explicitly naive),
   `ARRIVAL`/`OVERFLIGHT`/`MISSION` Block Maps, every `*_STATE_OWNERS` table in `permission.js`,
   the whole of `nla.js`, and `fdr.comms.workingFrequencyMhz` ("appears nowhere in any FAA or DoD
   source").
4. Record the result in the ADR and in `docs/efsp-usage-guide.md`, so the next audit is a diff.

---

## Files

> Phases 1–2 are built, so several entries below already exist. **Still to create:**
> `crc-sync/src/efsp/field-state-store.js`, `crc-sync/src/efsp/field-state.js` (the pure module),
> `crc-sync/tests/efsp-field-state.test.mjs`, `crc-sync/tests/efsp-scenario-field-state.test.mjs`,
> `crc-desktop/app/public/js/panels/efsp/field-state-panel.js` and
> `crc-desktop/tests/efsp-field-state-client.test.js`.

**New (crc-sync):** ~~`src/efsp/marsa-store.js`~~ (built, `0051`), `src/efsp/field-state-store.js`,
`config/efsp-field-state-*.json`, ~~`tests/efsp-marsa-store.test.mjs`~~,
~~`tests/efsp-scenario-marsa.test.mjs`~~, `tests/efsp-field-state.test.mjs`,
`tests/efsp-scenario-field-state.test.mjs`.

**New (crc-desktop):** ~~`app/public/js/panels/efsp/marsa-badge.js`~~ (built, `0051`),
`app/public/js/panels/efsp/field-state-panel.js`, ~~`tests/efsp-marsa-client.test.js`~~,
`tests/efsp-field-state-client.test.js`.

**Changed (crc-sync):** `src/efsp/index.js` (compose + persist/restore both new stores),
`src/efsp/efsp-ws.js` (two new dispatch paths + snapshot), `src/efsp/board-store.js`
(interlock call, `SREG` refusal, retire hooks), `src/efsp/block-map.js` (`interlock` metadata,
the `M`-namespace Blocks, OVERFLIGHT's two new assignment Blocks), `src/efsp/fdr-store.js`
(`fdr.military`, new setters), `src/efsp/nla.js` (the three §9.7 placeholder cases become real),
`src/efsp/permission.js` (new op kinds + class refusals), `src/efsp/facility-config.js` (runway /
pad inventory).

**Changed (crc-desktop):** `app/public/js/app.js` (new `ws.onmessage` cases),
`app/public/js/panels/efsp/efsp-state.js`, `efsp-ws.js`, `bay-view.js`, `strip-template.js`,
`efsp-panel.js`, plus `tests/efsp-block-map-parity.test.js` and
`tests/efsp-ui-reachability.test.js`.

**Docs:** ADRs `0051`+ (one per phase — `docs/adr/NNNN-title.md`, Context / Decision /
Alternatives considered / Consequences; pure bugfixes get none); `docs/efsp-usage-guide.md` gains
`§8D MARSA`, `§8E Field state and arresting gear`, `§8F Alert and scramble` and entries under
`§5`/`§6` for the new Blocks and FDR fields, following `§8A`–`§8C`'s existing shape; and
`docs/efsp-briefing.md` rewritten as the next handoff (it supersedes rather than appends —
its own §1 says so).

## Verification

Per phase, in order:

1. `cd crc-sync && npm test` — must stay green and grow from **1052** (Phase 2's baseline).
2. `cd crc-desktop && npm test` — must stay green and grow from **361**.
3. **Restart the local crc-sync process** after any `crc-sync/src/` edit — Node does not
   hot-reload and a stale process looks exactly like a broken change (briefing §6).
4. **Walk the sortie by hand in the running app**, not just in the suite. For **Phase 3** that is:
   file a departure and taxi it into `twr-runway-queue`'s `rwy-05` Rack; as `OPS`, begin a barrier
   change on 05; confirm the departure's NLA is inhibited **with the reason rendered on the Strip**,
   and that an arrival on final to the same runway is too; complete the inspection as `OPS` and
   confirm both free up. Then propose a runway change as `TWR` and confirm `BeginRunwayChange` is
   refused until **both** `OPS` and `APP` have acknowledged.
5. **Then walk the pilot requests** — the axis that found `0050`'s four defects and, for §9.7,
   the one most likely to find more:
   - *"request runway 23"* from a Strip already sitting in the `rwy-05` Rack.
   - an aircraft **already on final** when the barrier change starts. The plan is explicit that
     `FINAL → LANDED` must **not** be inhibited: it is an observation that the aircraft touched
     down, and inhibiting it makes the board lie and strands a landed aircraft with no legal
     transition. Walk it and confirm.
   - a divert arriving with `3F` (`HOOK`) set onto a runway whose gear is derigged.
   - a runway change proposed and then **rejected** — `REJECTED` is terminal; check what the
     proposer sees.
   - two controllers reconfiguring at once (the `STALE_REV` collision, which is correct rather
     than costly — confirm the refusal is *audited*, not returned early).
   - **a crc-sync restart mid-suspension.** This is the one the rule-5 design exists for: a
     controller reconnecting after a suspension must not see an `OPEN` runway.
6. **Eyes on it, named.** Browser automation is not available to the agent, so a human has to:
   the squadron member driving §5's stereo-table pass should click these in the same sitting, and
   the ADR records what they saw rather than that it was unverified. Outstanding as of `0054`:
   the mission-line bind picker and `.mission`, the separation-regime `<select>` beside "Accept
   TOFI Entry", a Strip carrying `HOOK`/`ORDNANCE`/`+N` and its badge slots at once, and — when
   Phase 3 lands — the field-state panel, which is a new dock surface nobody has seen.
