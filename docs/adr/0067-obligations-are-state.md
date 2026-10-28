# 0067 — Forwarding obligations are state in `efsp-alerts`, not one-shot alerts

## Context

`docs/adr/0021` built §4.6.1's timed forwarding obligations as **events**: the monitor alerted each
`stripId:obligationType` "at most once", through a new `efsp-obligation-alert` broadcast, and the
client kept the latest alert per Strip in a Map nothing ever cleared. In practice that meant:

- A Strip whose void-time clearance had expired kept its `VOID TIME EXPIRED` badge after CD gave it
  a fresh void time. The Strip's own `strip.nla` (re-stated in the Mutation's board delta) said the
  flight could go; its badge said it was overdue — two answers to one question (guide §4.8.3), the
  defect `nla-status-monitor.js` was written to prevent.
- A client that connected after an obligation was raised never learnt about it.
- `ADVANCE_FORWARDING`'s escalation from `WARNING` to `OVERDUE` never reached anyone: the
  de-duplication key had no severity in it, so the escalated obligation was the "same" alert.
- `recordMet()` had no caller, so the compliance figure §11.5 asks for was missed-only.

Meanwhile `0045` (correlation warning) and `0058` (conformance and STCA in `efsp-alerts`) had
established the shape for "what is wrong right now": state, sent whole, cleared by omission.

## Decision

**An obligation is state.** `ForwardingObligationMonitor` holds the set of obligations due right
now; `tick(now)` recomputes it from the same scan as before and returns whether it changed;
`getAll()` returns it. A condition that stops being true — the Strip left HELD, was DROPPED or is
gone, coordination was proposed, the airspace was activated, the ETA was re-forwarded — leaves the
set. `computeDueObligations` (the pure function, and so *when* each type is due) is unchanged.

- **Keyed per Strip replica**, `facilityId:stripId:obligationType`, not per FDR. Unlike correlation
  (an identity question two replicas must agree on, `0045`), an obligation is a procedural duty of
  the Facility holding the Strip; two Facilities' replicas may correctly differ.
- **Entry**: `{ facilityId, stripId, obligationType, severity, dueAt, since }`. `since` is when this
  episode was first raised. `dueAt` is held from that tick: `ETA_REVISION` and
  `AMENDMENT_INSIDE_30MIN` report `dueAt: now`, and comparing it would make every tick a change.
  Change detection is on the key set and `severity` only — so the `ADVANCE_FORWARDING` escalation is
  a change and reaches the client.
- **Transport**: a third key, `obligations`, in the existing `efsp-alerts` message beside
  `conformance` and `stca`. It goes to every session, like conformance (per-session scoping is one
  line in `WsHub._efspAlertsMsg` if wanted later). `efsp-alerts` is now sent on **every** connect,
  initialised to three empty arrays, so a client connecting to a freshly started server is told
  "nothing is due" rather than keeping what it had. The `efsp-obligation-alert` message type,
  `broadcastEfspObligationAlert`, `applyEfspObligationAlert` and `clearEfspObligation` are removed:
  crc-desktop and crc-sync ship together (a crc-desktop release always redeploys crc-sync), so there
  is no old client to keep compatible with.
- **One composing function.** `WsHub.broadcastEfspAlerts` replaces the whole alert state, and its
  producers now run on three triggers (the 1 s conformance/STCA tick, the 15 s obligation sweep, the
  post-Mutation hook below). `server.js`'s `broadcastEfspAlerts()` is the only caller, and it always
  passes all three slices, so no producer can erase another's (`tests/efsp-alerts-compose.test.mjs`).
- **Re-evaluated after a Mutation.** `WsHub.setOnEfspChange(fn)` is called after any EFSP message
  that broadcast something (guarded, after the broadcasts); `server.js` wires it to re-tick the
  obligation monitor. A controller's fix clears its badge with the Mutation that fixed it, as the
  NLA status already does; the 15 s sweep remains for the clock (a deadline passing).
- **Client**: `efspObligations` is `stripId → [entries]`, replaced wholesale by each `efsp-alerts`.
  `getEfspObligation(stripId)` keeps its signature and returns the one the badge shows (`OVERDUE`
  first, then earliest `dueAt`); `getEfspObligations(stripId)` returns all.

### Compliance: what `met` and `missed` now mean

- **`missed` counts raised episodes.** An obligation that clears and later comes due again is
  counted again — it was missed twice.
- **`met` means done before it was due**, and is counted by the monitor itself (`recordMet()`'s
  only caller is `tick()`). That needs the monitor to have seen the obligation *pending* (clock
  running, not yet due) and then the satisfying condition before `dueAt`. A pure
  `computePendingObligations(strip, fdr, now)` reports the pending ones. Only two types have an
  observable lead window:

  | Type | Pending while | Met when, before `dueAt` |
  |---|---|---|
  | `ADVANCE_FORWARDING` | ARRIVAL, no `strip.coordination`, ETA known, `now < ETA − 15 min` | the same live Strip now has `strip.coordination` |
  | `VOID_TIME_EXPIRED` | DEPARTURE, `HELD`, void deadline set, `now < deadline` | the same live Strip has moved past `HELD` in the departure lifecycle |

  Anything else that ends a pending window (Strip dropped, ETA removed, release state changed, the
  Strip put back to `CLEARED`) is neither met nor missed. `ETA_REVISION`,
  `AMENDMENT_INSIDE_30MIN`, `DATA_ONLY_VERIFICATION` and `UNACTIVATED_AIRSPACE_ENTRY` are due the
  moment they exist; they have no "met" and stay missed-only. `getComplianceStats()` keeps its shape,
  `{ [type]: { met, missed } }`.

### What this changes in `0021`

`0021` is not edited (an ADR is never edited once committed). These of its statements no longer hold:

1. *"a new WS message type, `efsp-obligation-alert`"* and *"`broadcastEfspObligationAlert`"* —
   gone; obligations ride `efsp-alerts`.
2. *"Each newly-due obligation is de-duplicated (`stripId:obligationType`, alerted at most once)"* —
   replaced by the due-now set above; an obligation is listed for as long as it is due and no longer.
3. *"`recordMet()` … not wired automatically this slice"* — wired, inside the monitor, for the two
   types above. `0021`'s rejection of "any coordination Mutation after an alert counts as met"
   still stands; this is not that.
4. *"incremented on `missed` automatically (every raised alert)"* — now every raised **episode**.
5. Its Consequences bullet that the client "has no way to dismiss an obligation badge once raised —
   it clears only when the Strip itself is dropped" — the badge now clears when the obligation does.
   There is still no controller *acknowledge*: an alert clears only when its condition clears
   (decisions.md H39).

`0021`'s other decisions stand: the pure/stateful split, the six types' definitions, the 15 s
cadence, the unpersisted counters, and `DATA_ONLY_VERIFICATION` staying raised while due (no
verification Mutation exists).

## Alternatives considered

- **Records on the Board** — an `obligations` field on the Strip, re-stated by board deltas like
  `strip.nla`. Rejected: an obligation is derived from Strip, FDR, clock and airspace, not written
  by a controller. Putting it on the Strip means bumping `rev` outside a Mutation (which invalidates
  every controller's in-flight edit) or copying the NLA re-statement machinery through `efsp-ws.js`
  and `index.js`, and it would push a board delta every time a 60-second amendment window opens or
  closes.
- **Its own full-state message**, `efsp-obligations`. Works, but duplicates exactly what
  `efsp-alerts` already has: the stored last state, the per-session builder, the connect-time send,
  the client's wholesale replace and Bay re-render.
- **Keep `efsp-obligation-alert` for back-compat.** Rejected: the two apps ship together, and a dead
  message type is a second answer waiting to happen.
- **Only the 15 s sweep, no post-Mutation hook.** Rejected: a re-cleared Strip would keep its badge
  for up to 15 s while its NLA status, re-stated in the Mutation's own delta, already said otherwise.
- **Latch `AMENDMENT_INSIDE_30MIN`** so it stays up after its 60 s window. Rejected for now
  (decisions.md H38): it is the pure function's definition; a real amendment feed is the follow-up.

## Consequences

- A released or re-cleared Strip's obligation badge disappears without a reload; a reconnecting
  client sees only what is due now.
- `AMENDMENT_INSIDE_30MIN` is now visible for about a minute (it is due for 60 s after
  `fdr.updatedAt`), where before it stuck forever. Accepted (H38).
- A `met` counted from the 15 s sweep alone could be lost if the satisfying action and the deadline
  fall between two sweeps; the post-Mutation hook makes the monitor tick at the moment of the
  action, so in practice `met` is judged at the Mutation's own time.
- The obligation set is bounded by live Strips; `0021`'s `ALERTED_CAP` and its trim are gone.
- Tests: the monitor's retraction, escalation, `dueAt: now` stability, episode counting, per-replica
  keys and both met-able types (`efsp-forwarding-obligations.test.mjs`); a server-level scenario
  where a void-expired Strip is re-cleared (`efsp-scenario-release.test.mjs`); the wire shape and hook
  (`ws-hub-wire-strictness.test.mjs`); the single composer (`efsp-alerts-compose.test.mjs`); the
  client's replace semantics (`efsp-state.test.js`, `efsp-ui-reachability.test.js`); and against the
  real server, `e2e/obligation-retract.spec.js`.
