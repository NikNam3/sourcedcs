# EFSP — status and briefing for the next work package (WP4A)

Entry point for whoever picks up EFSP work next. Read this, then `EFSPImplementationGuide.md` §4.6 (cited throughout below), then start a proper plan (`/plan` or equivalent) for WP4A itself — this document is a briefing and a recommended scope cut, not a line-by-line build order. WP4A is large enough, and touches enough genuinely new architecture (per-Facility Strip *replicas*, not a moved Strip), that it deserves its own dedicated planning pass with the project owner rather than being speculatively fully designed here.

## 1. What's built (verified by direct code inspection, not from memory)

Two rounds of implementation (this repo's own "Phase 1" and "Phase 2", which together cover the guide's **WP0 → WP4**) are complete and tested:

- **WP0** — Reconnaissance (`docs/adr/0003-wp0-findings-d1-a3-false.md`).
- **WP1** — Domain model and protocol: FDR/Strip separation, JSON Mutation protocol, optimistic concurrency, durable persistence (`docs/adr/0001`, `0002`).
- **WP1A** — Position occupancy, combination, handover, self-coordination, per-acting-Position permission evaluation (D21 guarded by construction — see `crc-sync/tests/efsp-permission.test.mjs`'s "has exactly N parameters" tests and the cross-role `canCreateStripRole` tests).
- **WP2** — Block Map, both `DEPARTURE` and `ARRIVAL` (`crc-sync/src/efsp/block-map.js`), with a server/client parity test (`crc-desktop/tests/efsp-block-map-parity.test.js`).
- **WP3** — Bays/Racks/interaction layer: keyed drag-safe rendering, the four paper gestures (offset/flip/highlight/attention), search Bay, heartbeat/staleness banner.
- **WP4** — States, NLA (both lifecycles), transfer protocol with presence gating and covering-chain fallback, 30s Undo (state-only transitions), restart-survives-a-transfer tested. `docs/adr/0007`–`0012` record the real decisions here, most recently: every NLA transition that crosses a `DEPARTURE_STATE_OWNERS` boundary is now transfer-shaped (`docs/adr/0012`), not just `DEPARTED→APP`.

Both test suites are green: `crc-sync` 357 tests, `crc-desktop` 160 tests (`npm test` in each directory).

Facility/Position set currently live: one Facility (`INCIRLIK`), five Positions (`OPS`, `CD`, `GND`, `TWR`, `APP`), covering chain `CD→GND→TWR→APP` (**stops at APP** — see gap below).

### Known gaps worth closing, not large enough to be their own WP

- **Void-time expiry has no active alert.** Guide WP4 acceptance: *"Void-time expiry raises an alert at void + 30 minutes."* Today `nla.js`'s `isVoidExpired()` only gates the `HELD` NLA (passive — a controller has to look). No proactive alert/notification exists. Cheap, WP4-shaped, worth doing before or alongside WP4A rather than folding into it.
- **The single-Position-controller drop-target gap** (`crc-desktop/app/public/js/panels/efsp/efsp-panel.js`, `_positionsWithBays()`'s own comment) is moot for the documented DEPARTURE/ARRIVAL lifecycle chains (ADR 0012 made those NLA buttons transfer automatically) but still real for any hand-off outside that chain.
- **No ADR exists for the WP1A position-selection deviation** (`crc-sync/src/efsp/position-store.js`'s header comment: Positions are explicitly *not* derived from radar-station selection, contradicting the guide's D-9 assumption — this project's owner decided a dedicated Position selector instead). The guide's own §0.4 requires an ADR for every such departure; this one predates the ADR discipline being applied consistently and should get a retroactive one.

None of these block WP4A. Worth a small pre-pass if convenient, otherwise fine to defer.

## 2. Why WP4A is next, per the guide itself

`EFSPImplementationGuide.md` §16 ("Build order, in one paragraph") is explicit:

> **"WP1A comes immediately after the protocol, and WP4A must not slip."** Together they are the load-bearing structure of an eighteen-position panel worked by three or four people... WP4A because the class distinction — military ATC does handoffs, Military Radar Units do not — is expensive to retrofit and easy to get wrong. **Every other work package assumes both.**

WP1A is done. WP4A's own entry criterion (§13) is `WP4`, also done. Every later work package in the guide's table (WP5 track correlation, WP6 military layer, WP7 ATO ingest, WP7A carrier/PAR, WP8 instrumentation) is explicitly *lower* priority than WP4A per this build-order note — WP5 "can proceed in parallel once the UI exists," but WP4A is called out by name as the one thing that must not slip. So: **WP4A is the next work package**, not WP5/6/7.

## 3. What WP4A actually is (§4.6, quoted in full — this is the hard part)

> **The Strip does not cross the Facility boundary.** Each Facility materialises its own Strip from forwarded data... **One logical Flight Data Record; N per-Facility Strip replicas; synchronised by data messages plus coordination events.** Implementing this as a strip *move* across Facilities is defect class D13.

This is a materially different mechanism from everything built so far. `TransferStrip` (guide §4.5, everything WP4 built) moves ownership of *one* Strip within a Facility. WP4A's cross-Facility primitives create a **second, independent Strip replica** in the receiving Facility — both sides can then be removed independently, and `ADR 0007`'s own text is explicit that `TWR→APP`'s existing "Hand Off" is *not* this mechanism (both are `INCIRLIK` Positions; there's no second Facility to replicate into yet).

**Guide-specified deliverables (§13, WP4A):**
- The Facility model (§2, §4.6) — a second Facility. This project's own code comments already assume it will be called `CTR` (Ankara Center) — see `nla.js`'s and `docs/adr/0007`'s references to "the real cross-Facility HANDOFF, still APP↔CTR and still unbuilt."
- Coordination primitives with correct jurisdiction semantics: `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `TOFI`, `AIT` (table at §4.6, reproduced below).
- Per-Facility Strip replication from forwarded data (the D13 mechanism above).
- Timed forwarding obligations (§4.6.1): 15-minute advance forwarding, >3-minute ETA revision, verbal+automated coordination inside 30 min of departure, 3-minute verification for data-only facilities.
- Release objects across the boundary (§4.6.2): `RELEASED` / `HOLD_FOR_RELEASE` / `RELEASE_TIME` / `EDCT` (±5 min) / `CALL_FOR_RELEASE` (−2/+1 min), travelling controller-to-controller `CTR→APP→TWR`.
- The three-field TOFI separation model (§4.6.3): `ifr_active` (bool), `radar_service` (`ACTIVE`/`TERMINATED`), `separation_regime` (`ATC`/`MARSA`/`USING_AGENCY`/`DUE_REGARD`/`SEE_AND_AVOID`) — explicitly **not derivable from each other or from airspace type**.
- Airspace ownership as a direction (§4.6.4): `airspace.owner ∈ {CONTROLLING_AGENCY, USING_AGENCY}`, never a bare boolean.

| Primitive | Between | Radar ID | Comms | Jurisdiction | Accept |
|---|---|---|---|---|---|
| `HANDOFF` | ATC ⇄ ATC | transfers | **transfers** | passes to receiver | `"RADAR CONTACT"` |
| `POINT_OUT` | ATC ⇄ ATC | transfers | does not | **stays with initiator** | `"POINT OUT APPROVED"` |
| `TRAFFIC` | ATC ⇄ ATC | transfers | does not | stays with initiator | `"TRAFFIC OBSERVED"` |
| `OPERATIONAL_REQUEST` | ATC ⇄ ATC | — | — | stays with requester | `"APPROVED"`/`"UNABLE"`/`"STAND BY"` |
| `TOFI` | **ATC ⇄ MRU** | — | separate step | see §4.6.3 | acknowledgement |
| `AIT` | ATC ⇄ ATC | transfers | transfers | passes | silent, requires a written directive |

**Guide acceptance criteria (§13, WP4A):**
- A `POINT_OUT` leaves data ownership with the initiator **and** moves separation responsibility to the receiver, and the UI shows both.
- `TAC_C2`, `GCI`, `AIC` and `JTAC` have **no** handoff or point-out affordance at all — audited in the UI, not merely absent from the happy path. (This is defect **D12** — an MRU Position must never be offered an ATC primitive, even via combined-Position union — §4.6, §4.1.)
- A cross-Facility exchange produces **two Strip replicas**, each independently removable, not one moved Strip.
- A track-degradation flag disables silent transfer and forces the verbal path.
- The 15/3/30-minute obligations each raise an alert at the right moment, with compliance instrumented.
- `separation_regime` cannot be set implicitly by airspace type — attempting it is a validation error.
- Setting airspace ownership requires a direction; no boolean path exists.

## 4. Recommended scope cut for a first slice

WP4A as specified pulls in the `TACTICAL` Facility and its MRU Positions (`TAC_C2`, `AIC`, `GCI`) purely to prove the D12 refusal case — that's a genuinely different *kind* of Position (no ATC service at all) from anything built so far, and `TOFI`'s MRU coordination is its own sub-protocol. Pulling all of that in at once mirrors exactly the mistake the existing Phase 2 plan deliberately avoided when it scoped APP+ARRIVAL without WP5/6/7.

**Suggested first slice — civil ATC↔ATC only:**
1. Add the `CENTER` Facility and `CTR` Position. Extend the covering chain to `CD→GND→TWR→APP→CTR` (currently truncated at `APP` — `facility-config.js`'s own comment already flags this as Phase-1-truncated).
2. Build `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `AIT` between `APP` and `CTR` specifically — the real primitive `ADR 0007` said `TWR→APP` deliberately was *not*. This finally closes that loop: a departing flight's real path becomes `TWR→APP` (intrafacility `TransferStrip`, already built) then `APP→CTR` (interfacility `HANDOFF`, new), and an arriving flight's real origination becomes `CTR→APP` `HANDOFF` instead of `ADR 0008`'s current stub (APP self-originates ARRIVAL Strips because there's no CTR to hand off from yet).
3. Per-Facility Strip replication, the D13 mechanism — this is the architectural core and should be designed first, before any primitive is wired to UI.
4. Forwarding obligations (§4.6.1), release-across-boundary (§4.6.2), airspace-ownership-as-direction (§4.6.4).
5. Defer `TOFI` (§4.6.3) and the `TACTICAL` Facility/MRU Positions to a follow-on slice, alongside or just before WP6 (the military layer, which `separation_regime: MARSA` and `TOFI` are conceptually part of). Record this deferral as an ADR — it's a genuine scope decision, not free.

This isn't mandated by the guide (WP4A is specified as one work package) — it's a scoping recommendation for whoever plans this next, exactly the kind of call the existing Phase 2 plan made explicitly and recorded. Confirm it with the project owner before committing to it, the same way Phase 2's scope cut was a stated decision, not an assumption.

## 5. Where to start

- Re-read `EFSPImplementationGuide.md` §4.6 in full (lines ~456–541) and §2 (Defined Terms) for the Facility/Position vocabulary — `CTR`, `TAC_C2`, `AIC`, `GCI`, `JTAC` are all defined there.
- `crc-sync/src/efsp/facility-config.js` — where `CENTER`/`CTR` gets added, mirroring how `APP`/`INCIRLIK` was extended in Phase 2.
- `crc-sync/src/efsp/board-store.js` — every `_apply*` method assumes one Strip, one Facility; the replica mechanism is new machinery, not an extension of `_applyTransferStrip`.
- `docs/adr/0007-departed-nla-real-handoff-to-app.md` and `0008-arrival-role-and-origination.md` — both explicitly describe what they are *not* (the real cross-Facility mechanism) and are the natural first things WP4A supersedes.
- Write the ADRs as design decisions are actually made (this repo's established convention — `docs/adr/NNNN-title.md`, context/decision/alternatives/consequences), not speculatively upfront.
