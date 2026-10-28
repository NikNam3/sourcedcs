# 0072 — WP8, client half: the METRICS panel, and the three measurements only a client can make

## Context

`0065` built the §11.5 metric set and the §11.4 traffic count on the server, and defined the wire
contract for this ADR (`crc-sync/tests/efsp-metrics-contract.test.mjs`). It left two things for the
client:

- Three metrics only a client can observe: **search invocations** per Position, **time-to-find**
  (Strip selection latency after Bay entry), and **inputs per paper gesture**. Until now the only
  hook was a `console.log` counter in `efsp-panel.js`. The server reported all three as
  `NOT_INSTRUMENTED`.
- WP8's first acceptance bullet, *"Every metric in §11.5 is collected and visible."* Nothing
  displayed any of it.

The rulings that shape this are H11 (the mission clock decides every bucket), H32 (a metrics
session is one mission load to the next, with a rolling hour beside it), H35 (everyone signed in
sees the dashboard; no per-person breakdown), H66 (per-Position numbers are shown, folded), S-R2-3
(the server stamps each client event on receipt and ignores the client's `at`) and S-R2-4
(`missionSession` on every bucket; no `controllerId` on the wire).

## Decision

### Measurement: `efsp-metrics-client.js`, always running

It loads after `efsp-ws.js` and runs whether or not the panel is open. Four hooks, each one line at
its call site, each null-safe and wrapped so that nothing escapes:

| Hook | Called from | Reports |
|---|---|---|
| `noteEfspSearch(positionId, bayId)` | `efsp-panel.js` `_runEfspSearch`, non-empty query, before the Bay switches to the results | `SEARCH { bayId }`, the Bay searched *from*. Never the text |
| `noteEfspBayVisible(bayId, positionId)` | `efsp-panel.js` `_renderBayTabs`, every render, with `efspVisibleBayId()` (null when hidden) | starts or abandons a time-to-find entry |
| `noteEfspStripSelected(stripId)` | `bay-view.js` `_selectStrip` and `selectEfspStripById`, with the new selection (null when toggled off) | `TIME_TO_FIND { bayId, latencyMs }` |
| `noteEfspGesture(gesture, entryPoint, positionId)` | the four gesture entry points, after `_dispatchGesture` | `GESTURE { gesture, inputs }` |

`_dispatchGesture` now returns the acting Position it dispatched for, or nothing when it declined
(a dead replica, no acting Position). A gesture that did not happen is not counted.

**Batching.** One `efsp-metrics-report` per (Facility, Position), with at most 100 events and a
fresh `reportId`. It flushes 10 s after the first queued event, at 20 queued events, or on
`beforeunload`. Because the server stamps on receipt, the flush time decides the hour an event
lands in. So the flush is prompt, and an event that has waited more than 5 min (a closed socket) is
dropped rather than stamped into a later hour. While the socket is closed the queue is kept, capped
at 500 with the oldest dropped. An event for a Position not held is dropped at queue time and again
at flush time, because the server would refuse it (`NOT_HOLDING_POSITION`). Acks produce at most one
`console.warn` per refusal reason and never a banner. `at` is `missionNow()`, which is logged but
never trusted. Durations come from `performance.now()`. All of these limits are code constants, not
a tuning file (P5).

**Time-to-find** `[SOURCE-DEFINED]`:
- It **starts** when a Bay *becomes* visible, which is a different Bay from the last visible one or
  the panel coming back into view. It never restarts on a re-render (T5).
- It **stops** at the first selection of a Strip in that Bay. For the search pseudo-Bay, any Strip
  counts, since its results belong to other Bays. It reports for the Position whose tab the Bay is
  under.
- It is **abandoned, with no sample,** when the controller leaves the Bay, when the panel is hidden
  (checked every second while an entry is open), or after 10 min.
- These are **not samples:**
  - a toggle-off;
  - a selection of a Strip in another Bay (the entry stays open);
  - a Bay with no Strips;
  - a selection in the same task as the Bay entry. That is the arrivals line, which opens a Bay and
    selects a Strip in one click. A controller cannot enter a Bay and select in the same event
    handler, so the rule needs no edit to the arrivals code.

**Inputs per gesture** `[SOURCE-DEFINED]`: each entry point has a declared cost in
`GESTURE_INPUT_COST`. The costs are `FLIP:dblclick` 1, `ATTENTION:shift-click` 1,
`HIGHLIGHT:contextmenu+swatch` 2 and `OFFSET:menu` 2. A new entry point needs a row, and a missing
row throws rather than counting 1. Raw pointer events were rejected because they are noisy and hard
to attribute (a double-click is two clicks).

### The dashboard: the `metrics` dock panel

- **Placement.** Titled `METRICS`, in the left cluster and on the PANELS list. It needs no Position.
- **Polling.** It sends `efsp-metrics-request` over the WebSocket on show and every 30 s, and only
  while it is on screen. Only the reply to the latest `requestId` is rendered.
- **Rows.** Seven rows in the guide's §11.5 order, each with a name, a target, and two cells: *This
  mission* and *Last hour*. A small selector lists earlier missions. For those, *Last hour* is
  `—`, because the server sends `lastHour: null` for a past session.
- **Verdicts.** `MET`, `NOT MET`, `NO DATA`, `NOT INSTRUMENTED`, and `TRENDING ↓/↑/→` for the
  three trending-down metrics. Only `NOT MET` is coloured (`0056`, `0058`). `NO DATA` and
  `NOT INSTRUMENTED` are grey and say what they mean in words. A null rate reads `—`, never `0`
  or `100%`.
- **Staleness.** It reads `not instrumented (L19)` until `sources.staleness` is set.
- **Trend** `[SOURCE-DEFINED]`. It uses the last three complete hours that have a value. It reads
  `↓` when none rose and at least one fell, `→` when all are flat, and otherwise the direction of
  the last step. It needs two points. The rolling hour has no series, so its trend cell is `—`.
- **Sparklines.** Inline SVG with no axes. The `title` gives the numbers by `HHMMZ` hour.
- **Per Position.** Search and time-to-find are shown per Position, folded by default (H66). The
  view-model is built from named fields only, so a `controllerId` that reappeared on the wire still
  would not be shown (H35).
- **Traffic count** (§11.4):
  - A Facility selector. It defaults to the first Facility where a Position is held, else INCIRLIK.
  - The partition line `local + transient + unknown = flights`, with `aircraft` beside it.
  - The overlapping subsets, labelled "of which", never as shares (T12).
  - Breakdowns by hour, by aircraft type, and by the reasons Strips were not counted.
  - The `policy` string, verbatim.
  - A reconciliation line. It is plain when the count reconciles and coloured when it does not.
  - The traffic request is scoped to the selected mission session and its time span.
- **Times.** Always `HHMMZ` on the mission clock.
- **HTTP routes.** `crc-desktop/app/server.js` proxies `GET /api/efsp/metrics` and
  `/api/efsp/traffic-count` for curl and scripts. The panel itself uses the WebSocket.

## What this adds to 0065

It adds nothing to the wire. It is the producer of the `efsp-metrics-report` events that `0065`
defined, and the consumer of its bodies as shipped. The client's first accepted report stamps
`sources.client`, so from then on the three client metrics read `COLLECTING`/`NO_DATA` instead of
`NOT_INSTRUMENTED`.

## Alternatives considered

- **Charts from a library.** Rejected: no new dependency, and the app runs offline.
- **Measuring in `_afterSelectionChanged`.** Rejected: another lane owns that function this wave,
  and its two callers are the actual selection sources anyway.
- **Flushing only while connected, dropping otherwise.** Rejected. A short reconnect should not
  lose measurements, and the 5-minute age cap already bounds the wrong-hour error.
- **Facility totals only, no per-Position rows.** Rejected by H66. A Position is a role. The fold
  keeps it out of the way.

## Consequences

- The dashboard shows HIGHLIGHT and OFFSET at 2 inputs, over the §7.3 ceiling of 1. That is a
  finding, not a bug in the count. `bay-view.js`'s own comment, which says a swatch click is the
  whole interaction, does not count the right-click that opens the swatches.
- Time-to-find does not measure Bays that were never used to find a Strip. Abandoned entries are
  counted locally (`efspMetricsClientStats()`) and are not sent, because `0065`'s body has no field
  for them.
- Search per manned hour reads `—` until crc-sync's 60 s tick has recorded manning for the hour.
- A new gesture entry point, or a new place that sets the selected Strip, must call its hook.
  `tests/efsp-metrics-hooks.test.js` pins the current ones, and proves that loading the client
  leaves the dispatched Mutations byte-identical.
