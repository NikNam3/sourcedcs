# UI findings — lane 4

Findings from the lane-4 cataloguing agent. Protocol:
`docs/efsp-ui-catalogue-parallel.md`. Format and rules:
`docs/efsp-ui-catalogue-briefing.md`.

Ids in this file are **F-4xx**. Read every other findings file before adding
one — `docs/efsp-ui-findings.md` and the other `docs/ui-findings/lane*.md` —
and use "extends F-xxx" rather than re-filing something already recorded.

Merged into `docs/efsp-ui-findings.md` by a human once the run is done.

All measurements: Chromium via the lane-4 harness (`E2E_LANE=4`), default
dockview layout, `DEPARTURE` Strips in `INCIRLIK`, nothing populated beyond
callsign/type/wake unless stated. The EFSP panel in the default layout is
**half the viewport wide and ~45% of it tall** (800×449 at 1600×1000), which
matters for every number below.


> **Fix run — see `docs/ui-findings/FIX-RUN-STATUS.md`.** Every entry in this
> file has been worked. Statuses below are updated in place; `FIXED (this run,
> uncommitted)` means the fix is in the working tree and not yet committed.
> Where an entry labelled something a design question, taste, or a decision for
> someone else, that label was honoured and the status says so.

---

## Extends F-003 — the number: **1 of 6**, and `20`/`21` change nothing at the default width

**Status:** measurement, not a defect — F-003 asked for it. **Not decided here.**
**SPEC:** `crc-desktop/e2e/l4-density.spec.js` — "six DEPARTURE Strips: how many are visible" (passes; records the numbers as test annotations)

**The number.** Six `DEPARTURE` Strips in `ops-proposed`, harness viewport
1600×1000, default layout:

```
                         Strip height   #efsp-bay-content   fully visible   partly visible
as shipped                140–143 px        201 px               1               1
20/21 removed from list   140–143 px        201 px               1               1
```

**Removing `20`/`21` drops the count by zero.** HDG and INIT ALT sit at the
end of the second chip row; taking them out shortens that row but does not
remove it, so the Strip height does not change at all.

**It is width-dependent, so the one number is not the whole answer.** Strip
height by EFSP-panel width (panel = half the viewport in the default layout),
both variants measured side by side:

```
panel width   Strip, as shipped   Strip, without 20/21
  512 px           178                  178
  640–720          143                  143
  800–960          140–143              140–143
 1100              140                  105      <- the only band where 20/21 cost a row
 1280–1600         105                  105
```

So `20`/`21` cost one chip row, 35 px, only for panel widths of roughly
1000–1280 px. Everywhere else they're free.

**The bigger lever is the Bay's own height, not the chips.** `#efsp-bay-content`
by viewport height, default layout:

```
viewport 1280×800  -> Bay 101 px  -> 0 Strips fully visible
viewport 1024×800  -> Bay  65 px  -> 0   (Strip is 178 px at that width)
viewport 1600×1000 -> Bay 201 px  -> 1
viewport 1600×1440 -> Bay 421 px  -> 2
```

Where the Strip's 143 px goes (panel 800 px wide, from the Strip's own top):

```
chip row 1        0– 39   (18 chips)
chip row 2       45– 77   (9 chips + STATE)
actions row      83–115   32 px — four buttons right-aligned, rest of the row empty
MARSA… badge    121–136   15 px, its own row (F-002)
```

The two non-chip rows plus their gaps are **59 px, 41% of the Strip.** The Bay's
chrome is in F-401.

At a 280 px panel (viewport 560) the toolbar wraps to 123 px and the Bay tabs
to 117 px. The Strip is 310 px and is cut off by the dot-command row. That's
recorded as data, not a finding: the default layout never goes that narrow.

---

## F-401 — 68 px of empty status lines sit between the tabs and the Strips

**Status:** FIXED (this run, uncommitted) — all five surfaces collapse when empty (68 px → 0), and `#efsp-bay-content` went 201 → 269 px. **The trade-off this entry flags was resolved** by moving the two transient banners *below* the Bay: a refusal then takes its height out of the Bay's own flex box and no Strip moves. `#efsp-connection-banner` deliberately stays above it.
**Severity:** medium — a third of a Bay that can show one Strip
**SPEC:** `crc-desktop/e2e/l4-density.spec.js` — "an empty status line takes no height"

**What a controller sees.** Three thin empty bands between the `+ New Strip`
toolbar and the Position tabs, and another under the dot-command input. They look
like leftover borders. Visible in every screenshot of the panel.

**Measured.** Clean load, OPS held, nothing refused, no warnings, 1600×1000:

```
#efsp-connection-banner    h=16   text ""
#efsp-correlation-rate     h= 4   text ""
#efsp-mutation-error       h=16   text ""
#efsp-mutation-warning     h=16   text ""
#efsp-dot-command-preview  h=16   text ""
                          ----
                           68 px reserved, empty
#efsp-bay-content          h=201
```

The Bay is 201 px tall and a Strip is 143 px (see above). 68 px is 34% of the Bay
and about half a Strip.

**Scope.** All five status surfaces, and on every Position and Bay, because
they're panel-level. Note that `#efsp-mutation-error` is where every refusal
lands (F-103). Collapsing it when it's empty makes the Bay jump when a refusal
appears, so "take no height" and "don't shift the Strips under the pointer"
pull against each other. **That trade-off is a design call.** The finding is
only that the height is spent while nothing is shown.

---

## F-402 — a dragged Strip lands one slot above the gap the controller aimed at

**Status:** FIXED (this run, uncommitted) — §7.2 rule 5 is kept (still exactly one measurement per drag); the cache simply **moved** to just after the dragged Strip leaves the flow, which is the 'one layout change too early' this entry diagnosed. Upward drags are unchanged by construction.
**Severity:** medium — reordering is the whole point of dragging, and it's wrong every time
**SPEC:** `crc-desktop/e2e/l4-drag.spec.js` — "dropping at the gap the controller can see puts the Strip there"

**What a controller sees.** They drag the top Strip down into the gap between the
3rd and 4th, and the blue insertion line is drawn in that gap. After the drop, the
Strip sits between the 2nd and 3rd.

**Measured.** Four Strips A1–A4, A1 dragged by a real pointer to the midpoint of
the *visible* gap between A3 and A4, measured after the drag started:

```
before the drag        A1 @288   A2 @430   A3 @572   A4 @714     (Strip 140px)
drag starts            A1 -> position:fixed, leaves the flow; the Rack closes up:
                                 A2 @288   A3 @430   A4 @572
insertion line         drawn at y=572, i.e. in the gap A3|A4 — matches what is seen
expected order         A2 A3 A1 A4
actual order           A2 A1 A3 A4
```

**Mechanism.** `_onStripPointerDown` caches the other Strips' rects *before*
`.efsp-strip-dragging` (`position: fixed`) takes the dragged Strip out of the flow.
Every Strip below it then moves up by one Strip height, and `computeInsertionIndex`
keeps answering against the old positions. The insertion line happens to be drawn
where the pointer is, so the line and the result disagree.

**Scope.** Every drag *downward* within a Rack. Dragging upward past Strips that
sit above the dragged one is unaffected, because those didn't move. Guide §7.2
rule 5 ("rects cached at pointerdown") is the rule being followed. The rule is
sound, but the cache is taken one layout change too early. F-404 is the same
cache going stale for a different reason.

---

## F-403 — the dragged Strip swells to twice the panel's width and covers the map

**Status:** FIXED (this run, uncommitted) — in JS, not CSS: the pre-drag width is captured at pointerdown and pinned on the ghost. Nothing in CSS can name that width. The `contain: layout` on `.efsp-rack` lever was deliberately **not** used — it creates a stacking context and collides with F-001's and F-404's fixes. Ghost right edge now 792 against a panel edge of 800 (was 1492).
**Severity:** low-medium — cosmetic, but it's the one thing on screen during a drag
**SPEC:** `crc-desktop/e2e/l4-drag.spec.js` — "the dragged Strip stays inside the Strip panel"

**What a controller sees.** When a drag starts, the Strip jumps wider, re-wraps
into fewer rows, and its right half is drawn over the radar map next to the panel.

**Measured.** 1600×1600 viewport, panel 800 px wide:

```
at rest     .efsp-strip   w=784   h=140
dragging    .efsp-strip   w=1484  h=105   right edge x=1492, panel right edge x=800
```

**Mechanism.** `position: fixed` resolves against the nearest ancestor with
`contain: layout`, which is dockview's `.dv-grid-view` (the whole dock grid), not
the viewport or the panel. With `width: auto` the Strip becomes as wide as the grid
allows. The fix is probably to pin `width` from the pre-drag rect, but **that's
for whoever fixes it.**

**Scope.** Every drag, every Bay.

---

## F-404 — scrolling a Bay during a drag drops the Strip where it would have been before the scroll

**Status:** FIXED (this run, uncommitted) — the cache carries the `scrollTop` it was taken at and the pointer is mapped into that space, so the insertion line and the result agree. `_finishDrag` reads `scrollTop` itself rather than trusting the last `pointermove`, which is what makes the autoscroll route work — Chromium's autoscroll moves the container with no `pointermove` at all.
**Severity:** medium-high — in a Bay taller than its viewport (every Bay, per the numbers above), a Strip can't be dragged to any slot that isn't already on screen
**SPEC:** `crc-desktop/e2e/l4-drag.spec.js` — "scrolling the Bay mid-drag still drops where the pointer is" and "a Strip autoscrolled to an off-screen slot drops where the pointer is"

**What a controller sees.** They drag a Strip down, the Bay scrolls (by the wheel,
or because they held it at the bottom edge), and they release in the gap they want.
The Strip lands near where it started.

**Measured.** 1600×1600 viewport, Bay 501 px tall, Strips 140 px:

```
10 Strips, C0 dragged, wheel +600px mid-drag, released in the visible gap C5|C6
    -> landed at the top: [nothing] C0 C1       (did not move at all)
 8 Strips, D0 dragged, held at the bottom edge 1.5s (Bay autoscrolled 0 -> 545),
    released in the visible gap D6|D7
    -> landed between D1 and D2
```

**Mechanism.** The same pointerdown rect cache as F-402. Scrolling moves every
Strip, and the cache keeps the pre-scroll positions. Autoscroll isn't the app's.
Chromium scrolls the overflow container while the button is held at its edge, so it
happens, and the app doesn't account for it.

**Scope.** Every drag in a Bay that scrolls. With the default layout that's any Bay
holding two or more Strips.

**Walked, not a finding:** autoscroll itself works with a mouse (see above).
Whether it works with touch (`touch-action: none` on the Strip) wasn't tested,
because the harness has no touch emulation.

---

## F-406 — a Strip can't be dragged between the two runway Racks

**Status:** FIXED (this run, uncommitted) — cross-Rack dragging implemented, scoped to Racks of the same Bay (a cross-*Bay* move is what the tabs are for, and they carry ownership semantics a bare Rack element does not). **It needed a second fix to be reachable at all** — see the note added below.
**Severity:** medium — a runway change for a queued departure is a normal pilot request (`docs/efsp-wp6-plan.md` §Verification 5: *"request runway 23"*)
**SPEC:** `crc-desktop/e2e/l4-drag.spec.js` — "a Strip can be dragged from one Rack to another in the same Bay"

**What a controller sees.** In `twr-runway-queue`, they drag a Strip from the
`RWY-05` Rack down onto the `RWY-23` Rack and let go. It snaps back into
`RWY-05`.

**Measured.** R1 and R2 walked through the real NLA chain into `rwy-05`, R3 moved
to `rwy-23`. R1 dragged by a real pointer to the bottom of R3 inside the `rwy-23`
Rack, then released: `R1.rackId` is still `rwy-05` 3 s later. No refusal is shown.

**Mechanism.** `_finishDrag` commits to `rackEl`, the Rack the drag *started*
in. Rects are cached only for that Rack, and nothing resolves which Rack is under
the pointer. So a drop anywhere outside the tabs is a reorder within the source
Rack. The only drop targets that change location are the Position and Bay tabs,
and those are per Bay, not per Rack.

**Scope.** Any Bay with more than one Rack. Today that's only `twr-runway-queue`.
**There is a non-drag path:** select the Strip, then click the other Rack's
header (`_onRackHeaderClick`). So the move is possible, just not by the gesture
that looks like it should work. Whether dragging *should* cross Racks is arguably a
design call. `strip-drag.js`'s header says "within/between Racks".

---

## Extends F-305 — an OVERDUE obligation badge, and the MARSA badge, never appear by themselves

**Resolved with F-305.** Both now appear without the controller touching the
Strip. Note the spec for the obligation badge was *also* stale for an unrelated
reason — see the fix run's spec notes.


**SPEC:** `crc-desktop/e2e/l4-badges.spec.js` — "an obligation alert shows on the Strip without anything else happening" and "declaring MARSA updates the badge on the participants"

Lane 3's F-305 names the mechanism (`_stripElNeedsRebuild` looks only at the
Strip's own `rev`, selection and expansion), and lists the MARSA and correlation
badges as "plausibly" affected but unmeasured. This entry measures two more
surfaces. One of them is the worst place for the bug to be.

1. **Obligation alerts (`efsp-obligation-alert`).** These live in their own
   store (`efspObligations`) and never touch the Strip's `rev`. Delivered exactly
   as `app.js` handles the message (`applyEfspObligationAlert` +
   `renderAllOpenEfspBays`), with `VOID_TIME_EXPIRED` / `OVERDUE`:
   `.efsp-obligation-badge` count **0**, and the Strip has no
   `efsp-strip-obligation-overdue` border. One click to select the Strip, and it
   appears. **An overdue-obligation alarm that only shows once the controller
   happens to touch that Strip isn't an alarm.** Severity high on this surface.
2. **MARSA declare.** Declared through the page's own `sendEfspMarsaMutation`.
   The page's store reports the relation `ACTIVE` and both participants' `rev`
   stay at 1. The badge still reads `MARSA…` and changes to `MARSA ⚠` only after a
   selection click. This also means `marsa-popover.spec.js`'s "declaring MARSA
   from the popover actually declares it" (expects two badges) **will still fail
   after F-001 is fixed**, for this reason.

**Correction — the correlation badge.** An earlier version of this entry said
the correlation badge was unmeasured "because the harness has no tracks". That
was wrong. With no tracks, every eligible flight goes `UNCORRELATED`. Lane 1
measured it (lane1.md, "Extends F-305 — the correlation badge"), and I re-checked
it independently on a fresh APP `ARRIVAL` Strip in `app-inbound`:

```
+8 s    store UNCORRELATED (warning TRACK_LOST), correlationBadgeFor -> "NO TRK"
        DOM data-rev 1: no .efsp-correlation-badge, no Bind…, no warned edge
select  DOM: "NO TRK", Bind… present, warned edge present   (rev still 1)
```

Same result as lane 1's. The consequence is theirs to state: *Bind…* is the bind
popover's only opener, so it can't be opened on a fresh Strip at all.

---

## Extends F-002 — it's every Strip-level badge, and each one costs a full row

**Resolved with F-002.** Badges and the actions share one trailing row. A Strip
carrying three badges is 134 px, the same as a plain one. **Still open as a
design question:** three *wide* state badges at once wrap and cost 50 px, at which
point the NLA button's vertical position becomes a function of badge width.


**SPEC:** `crc-desktop/e2e/l4-badges.spec.js` — "an obligation badge does not push the Strip onto another row"
**Screenshot:** `docs/ui-findings/l4/f002-badges.png`

F-002 records the MARSA badge landing on its own row under the actions and
predicts the correlation badge does the same. Measured on the obligation badge:
**Strip 140 px → 164 px** for one `VOID TIME EXPIRED` badge. The badge sits on
its own full-width row *under* the NLA button, and the MARSA badge sits on another
row below that.

**Scope.** In `_buildStripEl`, everything appended after `actions` lands below
it: the coordination/POINT_OUT pair, STAND BY, obligation, correlation, MARSA.
`.efsp-obligation-badge`, `.efsp-tofi-badge`, `.efsp-coordination-badge-standby`
and `.efsp-coordination-badges` each carry `flex-basis: 100%`, so each claims a
row. A Strip carrying the combination `docs/efsp-wp6-plan.md` §Verification 6
asks someone to look at (`HOOK`/`ORDNANCE`/`+N` and its badge slots) will be
several rows taller than a plain one. Only the obligation badge was measured.

**Related, for the merger.** This entry, lane 1's F-105 (the `MARSA…` button,
43×15 px) and lane 2's extension of F-105 (`⌿` 20×20, `*` 14×22) come from the
same place. Strip-level controls and badges were added one at a time, each sized
and placed on its own, and together they cost height and touch area. Worth
reading as one pattern.

---

## Note added by the fix run — F-105 had quietly stopped most of a Strip being draggable

Found while implementing F-406, and worth recording because it is a collision
between two fixes in this same catalogue, not a pre-existing defect.

`.efsp-block-editable` cells `stopPropagation()` their `pointerdown` so the
Strip's drag-start handler never sees them. That guard was old and correct while
those cells were 28×20. **F-105 grew them to 44×44 of border box**, overhanging
12 px vertically and 3 px horizontally past the box a controller sees — so a
pointerdown anywhere in that overhang was swallowed, and most of a Strip was no
longer draggable at all.

Simply dropping the guard is wrong, and the reason was measured rather than
assumed: **pointer capture retargets `click` too.** With the Strip holding
capture from pointerdown, a click on a Block cell is delivered to the Strip and
the cell's own handler never runs, so Blocks would stop being editable entirely.

The fix is to **capture at the drag threshold, not at pointerdown.** Below
`DRAG_THRESHOLD_PX` nothing is captured, so a press on a cell is an ordinary
click and the editor opens; past it the Strip captures and it is a drag. The
threshold was always what told those two apart — it just was not being asked
until after the decision had been made.

**Still open, deliberately.** F-105's ±3 px horizontal overhang is documented as
making two neighbouring cells' targets meet in the middle of the gap between
them — but the *first* chip on a wrapped row has no left neighbour, so its
overhang lands in `.efsp-strip`'s 8 px left padding. A controller aiming at the
Strip's left edge to select it opens the CALLSIGN editor instead. Trimming the
overhang would take those cells to 41×44 and break WP3's own 44×44 criterion, so
this is a decision about what the panel must meet, not a tidy-up.

---

## F-407 — chip labels on one row sit at three different heights

**Status:** FIXED (this run, uncommitted) — `.efsp-block-chip { align-self: stretch }`, so chips are uniform per row and the top-anchored labels start together. One label offset per row instead of three.
**Severity:** low — cosmetic
**SPEC:** `crc-desktop/e2e/l4-badges.spec.js` — "the chip labels on one row line up"

**What a controller sees.** The small grey labels above the values (CALLSIGN,
TYPE, TAIL…) form a slightly ragged line rather than a straight one. Easiest to see
in `docs/ui-findings/l4/f002-badges.png`: `TYPE` and `CID` sit lower than
`CALLSIGN` and `SQUAWK`.

**Measured.** Fresh `DEPARTURE` Strip, panel 800 px, label top relative to the
Strip:

```
row 1   CALLSIGN ACFT WAKE ORDNANCE SQUAWK DEGR   7 px   (chip h=32 — editable, padded)
        TAIL UNIT HOME HOOK ALT DEP RWY …         9 px   (chip h=29 — empty editable)
        TYPE CID                                 10 px   (chip h=27 — read-only)
```

`.efsp-strip` is `align-items: center`, so chips of three different heights
are centred, and their top-anchored labels land at three different offsets.

**Scope.** Every chip row on every Strip.

---

## Departure clearance chain — walked past Mark Cleared (outside lane 4's scope, at the coordinator's request)

Lane 1's F-101–F-105 came from walking this chain before the run was split. Its
specs press real buttons only as far as Mark Cleared, and tried the double-tap only
on *Send to Clearance*. This section covers the rest, by real pointer presses.
All five Positions were held. Setup advanced Strips with the page's own
`_invokeNla`, and the step under test was always a real click.
**SPEC:** `crc-desktop/e2e/l4-chain.spec.js`.

### Extends F-102 — confirmed at every step, and it's exactly the three same-owner ones

**Resolved with F-102**, server-side, for exactly those three steps.


Walked one Strip through all eight NLAs by clicking each button in the Bay it was
actually in. Every button was enabled and on top (`elementFromPoint` hits it). The
Bay and state after each step matched lane 1's F-102 table line for line. The
defect is at Mark Cleared, Taxi and Cleared for Takeoff. **The other five are
correct**, because every transfer-shaped step lands in the receiver's Bay for the
new state. No new data beyond that confirmation.

### Extends F-101 — a class across all four transfer steps, and the neighbour gets *its own* NLA

**Resolved with F-101.** This extension's fourth row — a double-tap on *Hand Off
to APP* pressing *Line Up and Wait* for a different aircraft — is the case the
board-wide guard was designed against.


**SPEC:** `l4-chain.spec.js` — "a double-tap on Approve Pushback / To Runway Queue / Hand Off to APP moves only the Strip that was tapped" (3 × `test.fail`)

Two taps 150 ms apart at the same point on the upper of two Strips:

```
double-tap on          tapped Strip              and also changed
Approve Pushback       L4P1 CLEARED -> PUSHBACK   L4P2 CLEARED -> PUSHBACK
To Runway Queue        L4Q2 TAXI -> RUNWAY_QUEUE  L4Q1 TAXI -> RUNWAY_QUEUE
Hand Off to APP        L4H1 DEPARTED -> HANDED_OFF  L4Q2 RUNWAY_QUEUE -> LUAW
```

With *Send to Clearance* (lane 1) and *Accept Hand Off* (lane 3), that's every
transfer-shaped NLA that was tried. **The last row is the new part, and it's the
worst case of this bug.** The Strip that slides up under the pointer doesn't
have to be in the same state as the one tapped. In `twr-runway-queue`, a
departed aircraft and a queued one share the Bay (F-102 keeps the departed one
there). So a double-tap on *Hand Off to APP* pressed **Line Up and Wait** for a
different aircraft, a runway clearance nobody gave. (That neighbour was another
test's Strip on the shared Board, which is how the case turned up.)

### F-408 — an NLA the server will refuse looks exactly like one it will accept

**Status:** FIXED (this run, uncommitted) — both halves. crc-sync now computes the inhibit status per Strip and puts it on the wire (`strip.nla`), with wording byte-identical to what the press returns, re-broadcast on change when Position occupancy **or the clock** moves it; the panel renders the reason beside a disabled button rather than merely greying out (§3.5 rule 2). Four locally-computed gates were removed in favour of the server's single answer.
**Severity:** medium — §3.5 rule 2 ("MUST render the reason, not merely grey out") and `docs/efsp-wp6-plan.md` §Verification 4 ("inhibited **with the reason rendered on the Strip**")
**SPEC:** `l4-chain.spec.js` — "an NLA the server will refuse says so before it is pressed"

**What a controller sees.** A normal, bright *Hand Off to APP* button. They press
it, and a red line appears near the top of the panel: `NLA_INHIBITED: no receiving
Position present`. Nothing on the Strip warned them before, and after 6 s nothing
says it at all (F-103).

**Measured.** A Strip at `DEPARTED` with APP released, so nothing covers it:

```
before the press   button.efsp-nla-btn  enabled  title=null  class "efsp-nla-btn"
                   Strip text contains no reason
after the press    #efsp-mutation-error "NLA_INHIBITED: no receiving Position present"
                   state DEPARTED (unchanged)
```

**Mechanism.** The client pre-renders only three disabled states (`bay-view.js`,
the NLA block): not this owner's state, open coordination, and terminal Drop under
TOFI. Every `inhibited:` reason in `crc-sync/src/efsp/nla.js` is computed only
server-side, on the press, and no inhibit status ever reaches the client. These
include no beacon, flight plan invalid (F-104), a hold is in force, no receiving
Position, release time not reached, outside the standing release envelope,
EDCT/call-for-release window, and void time expired.

**Scope — a class.** Every server-side inhibit reason on every Role, of which
only one was measured. Receiver-absent was reachable only for APP. With the other
Positions held, CD, GND and TWR were covered (`coveringPositionFor`) and weren't
inhibited, which is correct. Distinct from F-103 (the banner after the press isn't
attributable) and F-104 (one reason's wording): this is about there being nothing
*before* the press.

### Walked, noted, not filed

- **Real buttons at all eight steps** reach and advance the Strip. Nothing is
  covered, and there are no F-001 effects on the NLA button.
- **The server's 400 ms per-Strip guard drops a second NLA silently.** Found
  because the spec's own setup outran it: *Approve Pushback* sent under 400 ms
  after *Mark Cleared* on the same Strip did nothing, and no message appeared.
  That's the guard doing its job against a double-tap. It's only a problem if a
  deliberate fast sequence on one Strip is a real workflow, which is a judgement
  call, so I didn't file it.
- **F-201 / F-204 weren't hit.** Setup supplied ALT/DEP/DEST/RTE at creation, so
  no Block editing was needed on the chain.

## Id note

**F-405 is unused.** It was allocated to "no autoscroll at the Bay edge", which
turned out to be wrong: Chromium autoscrolls while the button is held at the edge.
The real defect there is F-404's second route.

## Walked, no finding

- **Drag onto an own Bay tab** (`ops-proposed` → `ops-coordination` tab): the tab
  lights up (`.efsp-drop-target`), and the Strip moves there, still OPS, still
  `PROPOSED`.
- **Drag onto another Position's tab** (OPS → `CD`, both held): a transfer into
  `cd-pending-clearance`, state `PENDING_CLEARANCE`. It's the same thing *Send to
  Clearance* does.
- **Drag onto a Position tab whose default Bay is illegal** (OPS → `GND`): refused
  with `VALIDATION_ERROR: dropping here would set state to PUSHBACK, but the only
  valid next state from PROPOSED is PENDING_CLEARANCE`. Legible, in the panel.
  The attribution and 6 s timeout problems are F-103's.
- **Scroll position across Board updates**, 30 Strips, Bay scrolled to 2000:
  another Strip created → `scrollTop` 2000 unchanged. The Strip at the top of the
  view sent to Clearance → `scrollTop` 2000 unchanged, and the next Strip moves up
  into its place. No jump.
- **Horizontal overflow**: none at any panel width from 280 to 1600 px. Nothing
  in the panel extends past its edges at rest (F-403 is only during a drag).
- **30 Strips**: seeded in 8.7 s (one round trip each). No rendering problem
  was seen beyond the density numbers above.

## Belongs to another lane — seen, not followed

None beyond what's filed as "extends" above. The MARSA badge measurement touches
lane 1's MARSA flow, and it's recorded as extending lane 3's F-305 because that's
where the mechanism is.
