# 0068 — The field state reaches the controller: its own FIELD STATE dock panel, a proactive mirror of tower's authority, RWY and HOOK chips on the Strip, the hook check computed and never stored, and the barrier change generalised to runway works

## Context

ADR `0061` built field state on the server (guide §9.7): one record per Facility and one runway record per pavement, tower's authority over the runway, the works/inspection sequence, the runway change and its acknowledgements, the NLA inhibits (rule 1), and its own delta on its own sequence. It had no client. A controller could not see a runway's status, could not act on it, and saw a suspended runway only as the reason the server stamps under a held NLA (`strip.nla.inhibited`, ADR `0056`'s "reasons render under the NLA").

Rule 4 of §9.7 (a hook-equipped aircraft, `3F` from ADR `0052`, "MUST be checked against gear state") was left unbuilt by `0061`. ADR `0052` said that the gear-mismatch check "now has data to read". Under decisions.md H17, DCS simulates no arresting wires, so the gear is a stub: Incirlik ships `arrestingGear: []` and no op changes a gear's state.

The human then ruled on the two open questions this lane carried:

- **H52 (desk item L1-W1):** the barrier change becomes a generic "runway works + inspection" suspension.
- **H57 (L1b-Q1):** the hook mismatch fires only when gear is configured.

The supervisor added **S-L1d**, a public field-state broadcaster in `ws-hub.js`, and **S-L1b2**, a line in the Strip render signature (below).

## Decision

### 1. A FIELD STATE dock panel, not the `ops-field-state` Bay

`panels/efsp/field-state-panel.js` is its own dockview panel. It sits in the left cluster, is closed by default, and is opened from the PANELS list (L1b-Q4, Q8). AIRSPACE (guide §4.2, "not a strip rack") is the precedent.

- **Why not the Bay:** a runway is not a Strip, and nothing about it belongs in a rack.
- **Why a separate panel:** a TWR controller wants the field and the Strips side by side, which two panels give and one tab does not.
- **The Bay is untouched:** `ops-field-state` stays the inert Strip container that `0061` left, and `facility-config.js`'s line for it is unchanged.

The panel shows **every** record in the snapshot (L1b-Q6 (a)): a CTR controller may want to know Incirlik's runway is shut. For each Facility it shows:

- the active end, and how it was set (from the mission wind, or by a runway change);
- each runway, with a status badge;
- who suspended, closed or inspected it, and when;
- its arresting gear, or "No arresting gear configured (SOURCE practice).";
- any request waiting on tower;
- the runway change, with one chip per acknowledger (`OPS ✓ self 1441Z`, `APP …`, `APP skipped`), a rejection or withdrawal, and `PENDING INSPECTION`;
- both pads, by name, plus L13's `alertPadConstraintFor` line when that function exists.

Every time is in-game Zulu (`HHMMZ`) from the server's mission-clock stamps (H11). The one direction shown, the wind that picked the active end, goes through F2's `toMagneticDisplay` (H15, S-W3c). Until F2 merges, a guarded stand-in returns null and the direction is left out, rather than showing a true bearing as if it were magnetic.

When the controller holds TWR and runway requests are waiting, the tab title carries their count, e.g. `FIELD STATE (1)` (L1b-Q9 (a)).

### 2. The buttons are a proactive mirror, held to the server by a drift test

`field-state-rules.js`'s `fieldStateActionsFor(record, heldPositionIds)` decides which buttons a controller sees. Its shape follows `airspace-panel.js`'s `airspaceActionsFor`. It mirrors `permission.js`'s `FIELD_STATE_OP_OWNERS` and the store's preconditions:

- **Tower's authority (H18, S-L1b):** TWR closes, opens and begins works, and accepts or rejects requests. OPS, CD, GND and APP only **request**; a controller holding TWR is not offered requests.
- **OPS's steps:** OPS completes works and signs off the inspection.
- **The runway change:**
  - Only TWR proposes it, and never onto a closed runway.
  - An acknowledger is offered Ack only while the change is `PROPOSED` and it has not acked. Each held acknowledger gets its own Ack, so an ack is always sent AS one Position (D21).
  - Begin is offered only once the change is `ACKNOWLEDGED`.
  - The one-input `SelfCoordinateRunwayChange` is offered to a controller holding TWR and every acknowledger (S-Q24).

The server decides; the mirror only chooses which buttons to draw. A refusal goes to the Strip panel's existing refusal banner, named by the runway (`runway 05/23 — …`, F-103's attribution rule).

**Drift test** (`tests/efsp-field-state-client.test.js`):

- The client owners table must deep-equal crc-sync's.
- The resolver, the inhibit wording and the Q30 advisory run on both sides over one table of cases.
- Most strongly: for 12 field states × 11 held-Position sets, every offered button is replayed against a real `FieldStateStore` and must be **accepted**. A mirror that offers a button the server refuses fails the build.

Two config values are not on the wire record: the acknowledger set before a change is proposed, and the inspection authority. The client falls back to the permission table's owners (`AckRunwayChange` → OPS and APP; `CompleteInspection` → OPS), which equal Incirlik's config. This is client-derived with no server twin (L1b-Q10 (a)).

### 3. RWY and HOOK chips on the Strip

`fieldStateAlertsFor(strip)` returns alerts in `strip-view.js`'s `_stripAlerts` shape. The Strip draws them as chips at the left end of the indicator row, with warnings first. There are three:

- **`RWY 05 SUSP` / `INSP` / `CLSD`** (tone bad). The Strip's resolved runway is not OPEN. It shows on every Strip that will still use the runway (L1b-Q5 (a)):
  - DEPARTURE in `CLEARED`, `HELD`, `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE`, `LUAW`;
  - ARRIVAL in `INBOUND`, `HANDED_TO_TOWER`, `FINAL`.

  So a controller sees it before the NLA does. The reason line names the runway and what clears it. When the server's own NLA inhibit already names that runway, the chip stays but its reason is left empty, so the Strip never says the same thing twice (T7). On `FINAL`, the line adds that landing is not held (H19: `FINAL → LANDED` is never inhibited).
- **`RWY 05 INACT`** (tone attn). The runway is OPEN, but the Strip is queued in the rack of an end that is not active (decisions.md Q30; `runwayAdvisoryFor`). Nothing moves a Strip on its own (§10.3).
- **`HOOK`** (tone bad). Rule 4, below.

The runway is resolved exactly as the server resolves it (S-Q25): rack, then FDR 8A/8B, then the active end, then nothing. The client fails open: with no record, an unresolvable runway, OVERFLIGHT/MISSION or DROPPED, there is no chip (ADR `0058`'s "nothing for normal", T8).

These are the **wave-2 hook lines**, byte-identical in L1b, L12 and L13 (S-W2A). `INDICATOR_ORDER` gains `rwy, gear, ord, scram` after `conf`, and `ALERT_SLOT_KEYS` names the alert-driven chips. `_stripAlerts` ends with three `typeof … === 'function'` calls (`fieldStateAlertsFor`, `ordnanceAlertsFor`, `scrambleAlertsFor`), and `_buildIndicatorSlots` draws a chip for every `ALERT_SLOT_KEYS` key.

**S-L1b2 — field state is in the Strip's render signature.** `bay-view.js` rebuilds a Strip element only when `_stripRenderSignature` changes. Field state is not on the Strip. The server's re-stamped `nla` board-delta (`nlaStatusMonitor.tick()`) reaches the client *before* the `efsp-field-state-delta`, so without a change the Strip rebuilt with the old field state and never again. One guarded line at the end of the signature adds `fieldStateSignatureFor(strip)`: the Facility's runway statuses, suspension kinds, active end and gear, plus the Strip's derived alerts.

### 4. Rule 4: `gearMismatchFor(fdr, runway)`, computed and never stored

`gearMismatchFor` is pure and client-only (L1b-Q12 (a)). It returns `{text:'HOOK', reason}` when `fdr.military.hookRequired` is true, the runway resolves, the runway **has configured gear** (H57), and none of it is `UP`. `DOWN` and `OUT_OF_SERVICE` are not usable.

**`[SOURCE-DEFINED]`: the gear counted is all the gear on the pavement.** The alternative is a narrower reading: only gear serving the landing end.

The check applies to ARRIVAL Strips that are `INBOUND`, `HANDED_TO_TOWER` or `FINAL`.

**Computed, never stored.** It is derived from two records that already broadcast whole: the FDR and the field state (ADR `0045`'s principle). So it adds no record field, alert type or message, and `crc-sync` contains no `gearMismatch` code.

**H57/H17's effect:** Incirlik ships `arrestingGear: []`, so **the check never fires on the shipped config.** It is proved on fixtures (client tests and a rendered-Strip test). It is correct the day gear data exists. A server twin can be hoisted into `field-state.js` if a server consumer appears.

### 5. H52: runway works replace the barrier change (a rename, server and client)

L1's `kind` field made this a rename, as `0061` intended:

| Before | After |
|---|---|
| Status `SUSPENDED_BARRIER_CHANGE` | `SUSPENDED_WORKS` |
| Suspension kind `BARRIER_CHANGE` | `WORKS` |
| Ops `BeginBarrierChange` / `CompleteBarrierChange` | `BeginRunwayWorks` / `CompleteRunwayWorks` |
| Request action `BARRIER_CHANGE` | `WORKS` |
| Inhibit reason `runway 05/23 suspended — barrier change` | `runway 05/23 suspended — works in progress` |

The sequence is unchanged: TWR begins, then works are complete (OPS), then the attributable inspection (OPS), then OPEN. No compatibility is kept (lane rule 5). A persisted record with the old status restores as `SUSPENDED_INSPECTION`, by the store's existing unknown-status rule, so the runway is inspected before use.

### 6. S-L1d: `WsHub.broadcastEfspFieldStateDelta`

`ws-hub.js` gains a public broadcaster that sends the same `efsp-field-state-delta` a field-state op returns. `server.js`'s wind-derived active-runway hunk uses it instead of the private `_broadcast`.

## Alternatives considered

- **The `ops-field-state` Bay as the board.** Rejected (above, and `0061`): runways are not Strips.
- **Reading the Bay's inhibit only from `strip.nla.inhibited`.** That was enough for rule 1's letter. But a Strip in `CLEARED` or `TAXI` would not show the problem until its gated NLA. Q5 (a) shows it on every Strip that will use the runway.
- **Hook check fires with no inventory (L1b-Q1 (b)).** Rejected by H57: every hook arrival at Incirlik would be flagged forever over data known to be absent.
- **Per-end gear counting.** Kept as the alternative to the pavement-wide `[SOURCE-DEFINED]` reading.
- **Invalidating Strip elements from `app.js` on a field-state delta** instead of the signature line. Rejected: it would reach into `bay-view.js`'s DOM from outside and miss Strip elements that dockview has detached.
- **Adding the acknowledger set and inspection authority to the wire record.** It would make the mirror exact for any config. It was not done, because `crc-sync` changes in this lane were limited to H52 and S-L1d. It is recorded as a finding.

## Consequences

- A controller sees and works the field from one panel. Every Strip that will use a runway that is not OPEN says so, in one line.
- The mirror cannot drift silently: the drift test replays every offered button against the real store.
- `strip-view.js` carries hook lines for L12 (`ordnanceAlertsFor`) and L13 (`scrambleAlertsFor`). Their chips appear when their files load.
- `getEfspFieldState(facilityId)` and `getAllEfspFieldStates()` are a contract with L12, L13 and L22.
- The shipped config never raises HOOK.

Earlier ADRs this builds on, **none edited** (P4):

- `0056`: reasons render under the NLA; the field-state reason arrives that way.
- `0058`: nothing for normal; alerts sit left in the row.
- `0061`: this changes its barrier naming to works (H52) and its `server.js` broadcast (S-L1d).
- `0052`: `3F` now has a reader.
- `0045`: derived, never stored.
- `0079`: mission-clock times.
