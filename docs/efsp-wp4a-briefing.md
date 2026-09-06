# EFSP — relief briefing for whoever picks up EFSP work next

Entry point for the next agent/session. Read this, then `EFSPImplementationGuide.md` §4.6 (cited throughout below) if you're touching anything cross-Facility, then start a proper plan (`/plan` or equivalent) before writing code — this document is a handoff, not a build order.

**This revision supersedes the previous one.** The previous revision recommended a "first slice" scope cut for WP4A (§4 below, kept for the record) — that slice is now **fully built and tested**. Don't re-read the old framing as "what's left to do"; jump to §2/§3.

## 0. Before anything else: nothing from WP4A onward is committed

`git status` in the repo root right now shows every WP4A-era file (everything touched since `docs/adr/0013`) as modified or untracked — `crc-sync/src/efsp/*`, `crc-desktop/app/public/js/panels/efsp/*`, both test directories, and `docs/adr/0013` through `0024`. This has been one long uncommitted working session. **Check with the project owner how they want this committed** (one large commit, split by ADR/feature, etc.) before doing anything else — don't assume and don't force-push/reset anything to "clean up" the tree.

## 1. Test status

Both suites green as of this briefing: `crc-sync` **515** tests, `crc-desktop` **190** tests (`npm test` in each directory).

## 2. What's built

**WP0–WP4** (this repo's "Phase 1"/"Phase 2"), unchanged from before:
- WP0 Reconnaissance (`0003`). WP1 Domain model/protocol (`0001`, `0002`). WP1A Position occupancy/combination/handover/self-coordination/permission evaluation. WP2 Block Map for `DEPARTURE`/`ARRIVAL` (`crc-sync/src/efsp/block-map.js`). WP3 Bays/Racks/drag/gestures/search/staleness banner. WP4 States, NLA, transfer protocol, 30s Undo (`0007`–`0012`).

**WP4A — first slice (civil ATC↔ATC only), fully built:**
1. **`CENTER` Facility + `CTR` Position** (`0013`) — the backend is now N Facility-scoped `{BoardStore, PositionStore}` pairs sharing one `FdrStore`. `facility-config.js`'s intrafacility covering chain (`CD→GND→TWR→APP`) is **deliberately not** extended to `CTR` — that's a different mechanism (interfacility `HANDOFF`, not the occupancy-fallback covering chain), see that file's own comment.
2. **The 5 cross-Facility coordination primitives** — `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `AIT` between `APP`↔`CTR` (`0015`, refined in `0022`: `OPERATIONAL_REQUEST`'s third `STAND_BY` response, `AIT`'s written-directive gating). `POINT_OUT`'s dual-jurisdiction split (data stays with initiator, separation moves to receiver) is rendered in the UI (`bay-view.js`'s `DATA:` chip).
3. **Per-Facility Strip replication — the D13 mechanism** (`0015`) — a cross-Facility exchange mints a genuinely second Strip/replica in the receiving Facility, never moves the original. `board-store.js` has dedicated replica-proposal/accept/reject machinery, independent of `_applyTransferStrip`.
4. **Forwarding obligations** (`0021`) — real periodic-scan machinery (`forwarding-obligations.js`'s `ForwardingObligationMonitor`), a new WS alert broadcast, unpersisted compliance counters. Covers `ADVANCE_FORWARDING` (15 min), `ETA_REVISION` (3 min), `AMENDMENT_INSIDE_30MIN`, `DATA_ONLY_VERIFICATION` (3 min) — the four §4.6.1 obligation types. **Does not** cover void-time expiry (see gap below).
5. **Release-across-the-boundary** (`0017`) — `EDCT`/`CALL_FOR_RELEASE` extend the existing `RELEASE_STATES`, each deriving a window on write (±5 min / −2/+1 min); standing-release envelopes (`release-envelope.js`) with an `OPERATIONAL_REQUEST` fallback when a flight is `HOLD_FOR_RELEASE` and outside every configured envelope.
6. **Airspace ownership as a direction** (`0018`) — `airspace.owner ∈ {CONTROLLING_AGENCY, USING_AGENCY}` via a dedicated setter, structurally excluded from the generic FDR field-write path (no boolean path exists). Reachable in the UI as an enum `<select>` Block 24A since `0022`.
7. **Track-degradation forces the verbal path** (`0019`) — `identity.trackDegradationFlag !== 'NONE'` rejects a coordination `PROPOSE` unless `op.note` is non-empty. Reachable in the UI as enum `<select>` Block 5A since `0022`.
8. **`TOFI`/`TACTICAL`/MRU Positions explicitly deferred**, recorded in `0020` exactly as the prior briefing recommended.

**Beyond the original first-slice scope**, built since:
- **`0022`** — the two enum-`<select>` Blocks above (5A/24A) actually wired to the UI for the first time (both had working server-side setters and zero way to reach them before this).
- **`0023`** — `APP` regains direct `ARRIVAL` self-origination for pop-up flights (alongside, not instead of, the real `CTR→APP HANDOFF` from `0014`) — for a flight with no sending Facility to hand off from at all. A real third Strip Role, **`OVERFLIGHT`** (`TRANSITING → DROPPED`, owned by `APP`/`CTR`, reuses `DEPARTURE`'s origin/destination/route/altitude/remarks fields to mean the flight's *real* origin/destination, never Incirlik). A **`ConvertToArrival`** Mutation — an in-place `DEPARTURE(HANDED_OFF) → ARRIVAL(INBOUND)` role/state change on the *same* Strip/FDR for a same-day turnaround, a deliberate, documented departure from guide §3.6's "always separate Strips" rule, restricted to `APP`/`CTR`. Also closed a long-standing gap: `identity.aircraftType`/`wakeCategory`/`tailNumber`/`unit`/`homeStation` had been validated and writable server-side since Phase 1 with **no Block anywhere ever routing a `SetBlock` at them** — new Blocks `3A`–`3E` on all three roles fix that.
- **`0024`** — every Block Map entry (all three roles) now carries a `label` (guide §2 required this from the start; never implemented until now). Compact Strip view shows a small muted label above every value, closing the "which bare value is this?" usability gap raised in live testing.
- **Live-testing bugfixes this session** (uncommitted, folded into the working tree, no dedicated ADR since they're pure bugfixes, not design decisions): the airspace-owner/degradation `<select>`'s `change`+`blur` double-`replaceWith()` crash (`bay-view.js`); a `STALE_REV` race when editing two different Blocks on the same Strip back-to-back (both click-to-edit paths now read the live Strip at commit time instead of the DOM-build-time snapshot); `toFdrFiledSeed()` (`flight-plan-lookup.js`) not mapping DD1801's `aircraftType`/`wtc` into the CreateStrip seed even though both exist on a filed plan.

## 3. What's genuinely left

**The deferred slice** (`0020`) — `TOFI` (§4.6.3, the three-field `ifr_active`/`radar_service`/`separation_regime` model, ATC⇄MRU), the `TACTICAL` Facility, MRU Positions (`TAC_C2`, `AIC`, `GCI`, `JTAC`), and the D12 audit (MRU Positions must have **zero** handoff/point-out affordance, even via combined-Position union — needs a real UI audit, not just an absent happy path). Guide's own note: this pairs naturally with WP6 (the military layer), since `separation_regime: MARSA` is conceptually part of that layer too.

**Three small pre-WP4A gaps, still open, non-blocking** (carried over from the previous briefing, still true):
- **Void-time expiry has no proactive alert.** `nla.js`'s `isVoidExpired()` is still passive-only (a controller has to look). Cheap to close now that `forwarding-obligations.js`'s alerting machinery actually exists (`0021`) — a 5th obligation type is the natural shape, rather than inventing a second alerting mechanism.
- **The single-Position-controller drop-target gap** (`efsp-panel.js`'s `_positionsWithBays()` comment, still there) — moot for the documented `DEPARTURE`/`ARRIVAL` chains (their NLA buttons transfer automatically per `0012`) but still real for a hand-off outside that chain: a controller holding only one Position has no tab to drag a Strip onto for a Position they don't hold.
- **No ADR for the WP1A position-selection deviation** (`position-store.js`'s header comment — Positions are explicitly not derived from radar-station selection, contradicting the guide's D-9 assumption). Still no `docs/adr/*` file covers this decision retroactively.

**Not started at all** (correctly — lower priority per the guide's own build-order note, §16): WP5 (track correlation), WP6 (military layer, beyond what `0020` deferred into it), WP7 (ATO ingest), WP7A (carrier/PAR), WP8 (instrumentation).

## 4. Original "first slice" recommendation (kept for the record, now done)

The previous revision of this briefing recommended scoping WP4A's first pass to civil ATC↔ATC only — `CENTER`/`CTR`, the 5 non-TOFI primitives, D13 replication, forwarding obligations, release-across-the-boundary, airspace-ownership-as-direction — deferring `TOFI`/`TACTICAL`/MRU to a follow-on slice. That's exactly what got built (§2 above), confirmed via direct code inspection, not from memory.

## 5. Where to start, depending on what's next

- **If committing first**: this is a lot of surface (12 new/changed ADRs' worth of work) — talk to the project owner about commit granularity before running any `git add`.
- **If closing the 3 small gaps**: `forwarding-obligations.js` (void-time alert), `efsp-panel.js`'s `_positionsWithBays()` (drop-target gap), `position-store.js` (retroactive ADR — no code change needed, just write it).
- **If starting the deferred `TOFI`/`TACTICAL` slice**: re-read `EFSPImplementationGuide.md` §4.6.3 and §2's `TAC_C2`/`AIC`/`GCI`/`JTAC` definitions; `docs/adr/0020` for what was explicitly deferred and why; `crc-sync/src/efsp/facility-config.js` for where a `TACTICAL` Facility gets added (mirroring `CENTER`'s addition in `0013`); `permission.js`'s D12 guard pattern (`APP_CTR_ONLY_OP_KINDS`/`COORDINATION_OP_KINDS`) as the shape a "MRU may never hold this op kind, even combined" exclusion should take.
- Write ADRs as design decisions are actually made — this repo's established convention (`docs/adr/NNNN-title.md`, context/decision/alternatives/consequences) — not speculatively upfront.
