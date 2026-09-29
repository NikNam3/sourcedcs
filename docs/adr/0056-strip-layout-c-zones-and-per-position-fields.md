# 0056 — the Strip gets a fixed layout: a tab, a field grid, a menu, and a rule for where every new control goes

## Context

The Strip was one wrapping flex row. Controls and badges were added one at a time, each sized and coloured on its own, and CSS `order` sorted them into a "trailing row" (F-002). Live use found the result hard to read and hard to work:

- **Up to 12 buttons and 6–8 badges on one Strip**, in six font sizes, eight border colours and three horizontal paddings. The worst case read from the code is a CTR replica with an operational request pending, a TOFI accepted from it, MARSA and an ambiguous track. Several colours meant nothing in particular.
- **About 28 fields on every departure**, whichever Position was looking at it: CID, TAIL, ACFT and WAKE (already inside TYPE), HOOK and ORDNANCE for everyone, a frequency for Positions that sit on one, a runway for CTR.
- **Reasons shrank to one character wide** (F-006), because a sentence shared the row with the buttons.
- **A much-amended altitude pushed its own current value out of view**: the field showed two struck priors before the value in force.
- **No rule for where the next control goes.** The docs already name about a dozen more (withdraw a proposal, the §10.3 airborne suggestion, staleness, scramble, APREQ, carrier transfers). Each would have been one more button on the row.

Four mockup rounds with the user (a controller) settled the layout before any code was written. The final one is the reference.

## Decision

### Three columns, and a rule for each

```
┌──── tab ────────────────┬──── main ─────────────────────┬ tools ┐
│ DEP · HANDED OFF        │ CALLSIGN  TYPE  SQUAWK  …     │  ⋯    │
│ ─ HANDOFF ← APP ─────── │ [TRK][MARSA][TOFI][AIRSPACE]… │  ▼    │
│   waiting · 0:42        │ ▲ reason, a full line         │  ✕    │
│   [Reject] [Accept]     │ (expanded view)               │       │
│ [ next step (NLA) ]     │                               │       │
└─────────────────────────┴───────────────────────────────┴───────┘
```

| Where | What goes there |
|---|---|
| **Tab row** | An exchange in progress, with its own answer buttons: incoming or outgoing coordination, TOFI (in, out, accepted with comms not yet moved), a MARSA relation armed and waiting for rendezvous, an ambiguous track to pick. Incoming rows carry an amber rule. The line under each says how long it has waited or why it is blocked. It never carries filler such as "answer this". |
| **Tab bottom** | The one next step, the NLA. |
| **⋯ menu** | Everything the controller starts, grouped Start / Flight / Strip: Coordinate…, TOFI…, TOFI Exit…, Airspace… / Leave airspace, MARSA…, Bind… / Unbind, Convert to Arrival, Offset. **An item a Position can never use is left out; one it can use but not right now is listed, disabled, with the reason.** |
| **Indicators** | Standing state: TRK, MARSA, TOFI, AIRSPACE, TIMER, +N, and the previous leg when there is one. Fixed slots, always drawn, dim when off, so each sits in the same place on every Strip in a Bay. The airfield Positions have no TOFI or AIRSPACE slot. |
| **Reason lines** | Every sentence the Strip owes the controller (NLA inhibit, TOFI exit blocked, MARSA armed or voided), each on a full-width line of its own. |
| **Tools** | ⋯ ▼ ✕ only. |

Planned features and where they land, so they do not reopen this ADR:

| Feature | Lands in |
|---|---|
| Withdraw a proposal (F-005) | a button in the outgoing exchange's own tab row |
| §10.3 "detected airborne, advance?" | the NLA, as a suggestion |
| §10.4 staleness | a new indicator slot |
| Obligation acknowledge / met | the TIMER slot, or a tab row while overdue |
| §9.6 scramble | an indicator slot, plus a tab row for the order |
| §9.5 / §9.7 hung ordnance, hook / barrier | reason lines under the NLA |
| §9.3 ALTRV / APREQ | the menu to start it, a tab row while pending |
| WP7A carrier transfers | tab rows / the NLA, kept as separate controls, as the guide requires |
| §9.4 MTR fields | the field grid of the Positions that fly MTRs |

### Indicators are not controls

The MARSA badge and `TRK ×N` used to be buttons. A 22 px indicator cannot also be a 44 px target (F-105) without its hit area landing on the fields above. Their actions moved to where the zone rule puts them: MARSA… in the menu (its popover still offers End, Add, Remove and Void), Rendezvous and Void on the armed tab row, and Pick… on the ambiguous-track row.

### Colour means something is wrong, or nothing

Everything is grey by default. Amber means waiting on you or blocked; orange-red (`--efsp-bad`, #ff8a4c) means something failed: NO TRK, MARSA voided, an overdue timer. It is kept apart from #ff5c5c, which §7.7 rule 4 reserves for Attention. A Strip has at most one filled button, in blue: the next step, or Accept on an incoming exchange. Disabled is a dashed outline, the same everywhere (F-007).

Tokens are `--efsp-*` on `:root`, not `#efsp-panel`, because popovers and the menu are portalled to `<body>` (F-001). The panel no longer borrows base.css's green `--ui-*` ramp. It stays dark in both themes; a light variant is a follow-up.

### Fields are per Position, on a fixed grid

`strip-fields.js` carries a list per (Role, owning Position), falling back to the per-Role list and always filtered by the Role's Block Map. The rules, each held by `efsp-strip-fields.test.js`:

- TYPE (3) carries count, type and wake, so **ACFT (3A) and WAKE (3B)** get no field.
- **CID (4) and TAIL (3C)** are on no Strip. Nothing reads CID at a glance, and TAIL matters only to carrier control, which is not built.
- **HOOK (3F) and ORDNANCE (3G)** are Tower's alone.
- **Runway** only for OPS, CD, GND, TWR and APP.
- **FREQ (22)** only for APP and CTR, who work more than one frequency.
- **STATE (25 / M25)** is on no Strip: the tab header says it.

| Role | Position | Fields |
|---|---|---|
| DEP | OPS | 1 3 5 6 7 8 8A 8B 9 9F 3D 3E |
| DEP | CD | 1 3 5 7 8 8A 8B 9 9F 10 14A 14D 20 21 |
| DEP | GND | 1 3 5 8 8A 14A 14D |
| DEP | TWR | 1 3 5 8A 20 21 14D 3F 3G |
| DEP | APP | 1 3 5 7 8A 9 20 21 22 5A SREG |
| DEP | CTR | 1 3 5 7 8B 9 22 24A IFR RSVC SREG 5A |
| ARR | GND | 1 3 5 8B |
| ARR | TWR | 1 3 5 8B 9A-FUEL 3F 3G |
| ARR | APP | 1 3 5 6 7 8A 8B 9A-VECTOR 9A-SPEED 22 5A SREG |
| ARR | CTR | 1 3 5 6 7 9A-VECTOR 22 24A IFR RSVC SREG 5A |
| OVF | APP | 1 3 5 7A 8B 9 9A-VECTOR 22 5A SREG |
| OVF | CTR | 1 3 5 7A 8B 9 9A-VECTOR 22 24A IFR RSVC SREG 5A |
| MSN | all | M3 M1 M2 M4 M5 M6 M7 |

Everything left off is in the expanded view. `efsp-ui-reachability.test.js` now checks reachability per (Role, Position), not per Role; that check is what makes trimming the lists legal (docs/adr/0055).

The fields sit on a grid (`repeat(auto-fill, minmax(66px, 1fr))`, CALLSIGN, TYPE and 24A spanning two columns, RTE three), so a field sits in the same column on every Strip of a Bay, like the boxes on a paper strip.

### An amended field keeps its value in force

The current value keeps the field to itself. The latest superseded value sits small and struck in the label line, followed by `+N` for the rest. `+N` is the §3.7 overflow indicator, and it opens the expanded view with the full chain. `CHIP_HISTORY_LIMIT` is 1.

### Minimum sizes and resizing

| Element | Minimum | When there is no room |
|---|---|---|
| any button | 44 × 44 | never shrinks; a tab row's buttons wrap onto another line |
| tab | 176 px (up to 220 px, 24% of the Strip) | below a 480 px Strip the tab becomes a band across the top |
| field column | 66 px | fields drop to the next grid row; RTE ends in … and is whole in the expanded view |
| reason line | full width, 80ch | wraps between words |
| Strip | 320 px | the Bay scrolls sideways |

The Strip is the size container (`container: efsp-strip / inline-size`). It already carries `contain: layout style`, so this adds no containing block for the drag ghost (F-403 / F-404). That is why the container is not the Rack. The grid is on an inner `.efsp-strip-grid`, because a container query cannot restyle its own container.

### The menu is a portalled popover

`.efsp-strip`'s layout containment would trap a `position: fixed` menu inside the Strip, so a `<details>` inside the Strip cannot work. The menu goes through `_mountPopover` like the other six popovers, which also gives it Strip protection while it is open. It is a case in `POPOVER_CASES`.

### Code

- `strip-fields.js` holds the field and slot data.
- `strip-view.js` holds the tab, fields, indicators, reasons, tools and menu. It loads after `bay-view.js`.
- `bay-view.js` keeps the gates (`_canProposeTofiEntry` and the rest), so the client/server drift tests still find them, and `_buildStripEl` calls `_buildStripLayout` for every Strip that is not flipped.
- Moved elements keep their older classes (`.efsp-nla-btn`, `.efsp-coordinate-accept-btn`, `.efsp-marsa-badge`, …). Tests and the findings docs select on them; the look is decided by the Layout C section at the end of `efsp-panel.css`.

## Consequences

- The NLA's x position is fixed. Its y is the bottom of the tab, which varies with the number of exchange rows. The board-wide double-tap guard (F-101) still applies.
- Anything a controller starts is one press further away (⋯, then the item). In exchange, the face of a quiet Strip carries one button.
- The e2e specs press menu items through `startAction` / `stripMenuItem` in `e2e/helpers/app.js`; the unit tests use `menuItem`.
- Out of scope, flagged to the user: a departure has no assigned-altitude Block, APP's climbs can only overwrite INIT ALT, and CTR's copy starts with no annotations, so HDG and INIT ALT are empty there. That changes what data a Strip holds and needs its own ADR.
