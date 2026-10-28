# UI findings — lane 1

Findings from the lane-1 cataloguing agent. Protocol:
`docs/efsp-ui-catalogue-parallel.md`. Format and rules:
`docs/efsp-ui-catalogue-briefing.md`.

Ids in this file are **F-1xx**. Read every other findings file before adding
one — `docs/efsp-ui-findings.md` and the other `docs/ui-findings/lane*.md` —
and use "extends F-xxx" rather than re-filing something already recorded.

Merged into `docs/efsp-ui-findings.md` by a human once the run is done.


> **Fix run — see `docs/ui-findings/FIX-RUN-STATUS.md`.** Every entry in this
> file has been worked. Statuses below are updated in place; `FIXED (this run,
> uncommitted)` means the fix is in the working tree and not yet committed.
> Where an entry labelled something a design question, taste, or a decision for
> someone else, that label was honoured and the status says so.

---

## Found before the lane assignment — outside lane 1's scope

F-101–F-105 were found walking the departure clearance chain as an unassigned
single agent, before this run was split into lanes. They are **not** popovers
or overlays. They are kept here so they aren't lost, rather than filed in
`docs/efsp-ui-findings.md` (lane 0's file). The merger should decide where
they go. F-105 (touch targets) overlaps lane 4's layout scope. Nothing below is
duplicated in any other findings file as of this writing.
## F-101 — a double-tap on NLA advances the NEXT Strip too

**Status:** FIXED (this run, uncommitted) — `_swallowRepeatAdvance()` now calls `efsp-nla.js`'s `isWithinDoubleTapWindow`, which had been exported for this and never called. **Board-wide, not per Strip**: the server's per-`stripId` guard structurally cannot see a tap that lands on the neighbour that reflowed up. Applied to every NLA press, Drop, and coordination/TOFI ACCEPT/REJECT.
**Severity:** high — an input nobody meant is sent, and to a different aircraft
**SPEC:** `crc-desktop/e2e/l1-nla-clearance-chain.spec.js` — "a double-tap on NLA moves only the Strip that was tapped"

**What a controller sees.** Two Strips in `ops-proposed`. They double-tap
*Send to Clearance* on the top one, and **both** leave for Clearance.

**Measured.** Two `DEPARTURE` Strips (AAA11 above BBB22), OPS+CD held,
two `page.mouse.click` at the same point on AAA11's NLA button 150 ms apart:

```
150 ms after the first tap, elementFromPoint at the same point ->
    button.efsp-nla-btn "Send to Clearance"  inside BBB22's Strip
after the second tap:
    AAA11  cd-pending-clearance  PENDING_CLEARANCE
    BBB22  cd-pending-clearance  PENDING_CLEARANCE   <- never touched
```

The first Strip is transferred away, the Rack reflows, and the neighbour's
NLA button is now exactly where the pointer is. The second tap is a normal
click on a different Strip, so the server's 400 ms guard
(`board-store.js` `_applyInvokeNla`, keyed per `stripId`) cannot catch it.

**Scope — a class.** Every *transfer-shaped* NLA removes the Strip from the
Bay you are looking at: Send to Clearance, Approve Pushback, To Runway Queue,
Hand Off to APP, and every terminal Drop. Any of them double-tapped with a
neighbour below advances the neighbour. `efsp-nla.js` exports
`isWithinDoubleTapWindow` / `DOUBLE_TAP_MS` for exactly this ("so the button
visibly disables … without waiting on a round trip"), and nothing in
`app/public/js` calls it.

---

## F-102 — Mark Cleared, Taxi and Takeoff leave the Strip in the Bay for its old state

**Status:** FIXED (this run, uncommitted) — server-side. A state-only NLA now moves the Strip into the Bay whose `impliesState` matches its new state, for the same owner; nothing moves where no such Bay exists (LUAW). **The design question in the note below was resolved the way this entry's own evidence points**: the config says a Bay means a state, and dragging into one already changed state.
**Severity:** medium — the Bay name contradicts the Strip
**SPEC:** `crc-desktop/e2e/l1-nla-clearance-chain.spec.js` — "after each NLA the Strip sits in the Bay for its new state"

**What a controller sees.** CD presses *Mark Cleared*; the Strip stays in
`cd-pending-clearance`, now reading CLEARED, while `cd-cleared` stays empty.
The same happens at GND (a taxiing aircraft still in `gnd-pushback`) and TWR
(an airborne one still in `twr-runway-queue`, `twr-airborne` empty).

**Measured.** Full chain walked for one DEPARTURE Strip, OPS/CD/GND/TWR/APP
held, reading the Strip's own `bayId`/`state` after each NLA:

```
NLA pressed             bayId after               state after
Send to Clearance       cd-pending-clearance      PENDING_CLEARANCE
Mark Cleared            cd-pending-clearance      CLEARED        <- cd-cleared implies CLEARED
Approve Pushback        gnd-pushback              PUSHBACK
Taxi                    gnd-pushback              TAXI           <- gnd-taxi-out implies TAXI
To Runway Queue         twr-runway-queue          RUNWAY_QUEUE
Line Up and Wait        twr-runway-queue          LUAW           (no LUAW Bay — fine)
Cleared for Takeoff     twr-runway-queue          DEPARTED       <- twr-airborne implies DEPARTED
Hand Off to APP         app-departures            HANDED_OFF
```

**Scope — a class.** Every *state-only* NLA (same owner before and after,
`nla.js` header comment) goes through `_applySetState`, which never touches
`bayId`; only transfer-shaped NLAs move Bays. So all three same-owner steps
that have an `impliesState` Bay configured are affected.

**Note.** `facility-config.js` gives those Bays `impliesState`, and dragging
*into* one does change state — so the config says a Bay means a state. If the
intent is instead that a Strip stays put until moved by hand, that is a
decision someone should state; either way the screen currently disagrees
with itself.

---

## F-103 — a refusal does not say which Strip it was about, and is gone after 6 s

**Status:** FIXED (this run, uncommitted) — the refusal names the Strip by callsign, raw reason codes map to plain sentences (the code stays on `title`/`data-reason`), the banner is click-to-dismiss and lasts 30 s, and the refused Strip and Block are marked. **The timeout was not removed** — this entry labels that a workflow question.
**Severity:** medium — rule 2 is met on paper and not in practice
**SPEC:** `crc-desktop/e2e/l1-nla-clearance-chain.spec.js` — "a refusal names the Strip it refused"

**What a controller sees.** A red line near the top of the panel,
`NLA_INHIBITED: no receiving Position present`, with nothing to say which of
the Strips below it belongs to. Look away for six seconds and it is gone.

**Measured.** OPS held, CD not; AAA11 and BBB22 in `ops-proposed`; NLA pressed
on BBB22.

```
#efsp-mutation-error   "NLA_INHIBITED: no receiving Position present"
                       contains "BBB22"?  no
                       rect x=0 y=132 w=800 h=19, 12px, rgb(255,92,92), no background
BBB22's Strip          className "efsp-strip"   — no refused/error marker
6.9 s later            #efsp-mutation-error text ""
```

`_showMutationError` (`efsp-panel.js`) writes `${reason}: ${detail}` to the
one shared banner and clears it on a 6 s timer.

**Scope — a class.** Every rejection of every op on every Strip goes through
this one banner, so none of them is attributable to a Strip.

**Labelled separately as a workflow question, not a defect:** whether a
refusal should time out at all. The attribution problem stands either way.

---

## F-104 — "flight plan invalid" does not say what is missing

**Status:** FIXED (this run, uncommitted) — now `flight plan incomplete — ALT, DEP, DEST, RTE not filed`, naming only what is actually missing, using the Block labels the panel shows.
**Severity:** low-medium — the controller has to guess among 28 chips
**SPEC:** `crc-desktop/e2e/l1-nla-clearance-chain.spec.js` — "Mark Cleared's refusal names the missing fields"

**What a controller sees.** *Mark Cleared* on a fresh Strip gives
`NLA_INHIBITED: flight plan invalid`. The Strip has 28 chips, most of them
empty; nothing says which four matter.

**Measured.** `nla.js` `isFlightPlanValid` requires `route`,
`requestedAltitude`, `departureAirport`, `destinationAirport`
(`REQUIRED_FOR_CLEARANCE`) and returns the bare string `'flight plan invalid'`.
Filling ALT, DEP, DEST, RTE through the chips is what makes the next press
succeed; the refusal names none of them, and nothing on the Strip marks those
four chips as required.

**Scope.** Only this inhibit reason checked; other `inhibited:` strings in
`nla.js` are specific (`'a hold is in force'`, `'void time expired'`).

---

## F-105 — the MARSA… button is 43×15 px with 8 px text

**Status:** FIXED (this run, uncommitted) **with two documented exceptions.** Trailing-row controls got real 44×44 boxes; in-chip controls keep their visual size and layout footprint and take the target from padding plus an equal negative margin. `.efsp-marsa-btn` went from 8 px at 2.07:1 to 10 px at 5.57:1. **Exceptions:** `⌿` is 32×44 and `*` is 26×32, because a full 44 would reach onto the editable value cell 2 px away and steal its clicks; closing those needs the chip layout to change. The harness floor was raised from its actual `>= 32` to 44×44.
**Severity:** medium — the smallest control on the Strip, and in a class with the rest
**SPEC:** `crc-desktop/e2e/l1-touch-targets.spec.js`

**What a controller sees.** A faint, tiny `MARSA…` box in the Strip's bottom
left corner that reads as decoration (see F-002 for where it lands).

**Measured.** Fresh `DEPARTURE` Strip, 1600×1000 viewport:

```
button.efsp-marsa-btn   43 x 15 px   font-size 8px   color rgb(58,90,58) on transparent
button.efsp-offset-btn  32 x 32
button.efsp-expand-btn  32 x 32
button.efsp-drop-btn    32 x 32
button.efsp-nla-btn     ~60–204 x 32
editable Block cells    28 x 20      (e.g. ALT, DEP, DEST, RTE when empty)
```

WP3's acceptance criterion is 44×44 CSS px. **None** of the Strip's controls
meets it; MARSA is under it by a factor of three in height.

**Scope — a class.** Every Strip control is under 44 px. **Harness note:**
`expectTouchTarget` in `e2e/helpers/app.js` prints "under the 44px floor" but
asserts `>= 32`, so it passes every 32 px button above. Not changed here —
which floor the helper should enforce is the same decision as this finding.


---

## Lane 1 — popovers and overlays

### Harness change (shared file, made under the protocol's exception)

**`crc-desktop/playwright.config.js` — crc-sync was not hermetic.** The config
set `CRCSYNC_DCS_GRPC_HOST/PORT` and `CRCSYNC_SRS_HOST/PORT`, but those are
only `infra/docker-compose.yml`'s `.env` keys. The crc-sync process reads
`DCS_GRPC_HOST` (`host:port`) and `SRS_HOST`/`SRS_PORT`
(`src/grpc-client.js:9`, `src/srs-client.js:6-7`). So every e2e run, in every
lane, connected to the **production** defaults `server.sourcedcs.page:50051`
and `:5002`. Visible as `grpcStatus === 'connected'` with no DCS anywhere
local. Changed to the unprefixed names; the same fix is now committed as
`2f49e27` (made in parallel by the session that owns the harness), so there is
nothing left to merge here. After the change crc-sync logs
`ECONNREFUSED 127.0.0.1:1` and `smoke.spec.js` still passes. **Consequence for
other lanes:** gRPC and SRS now read `reconnecting` rather than `connected`,
so screenshots taken before and after this change differ in the top bar.

### Walked, no finding

- **`#no-awacs-overlay` scope.** Adopted into `#map` (`dock.js`). Measured at
  800×449 over the map only, beside `#efsp-panel`. Correct.
- **`#disc-overlay` scope.** `position: fixed; inset: 0` over the whole window
  (1600×1000), including the Strip panel. But `app.js` shows it only on
  `grpcStatus === 'disconnected'`. A live crc-sync with DCS down sends
  `reconnecting`, and `grpc-client.js` emits `disconnected` only before its
  first report or on a proto-load failure. So in practice it appears when the
  crc-sync socket itself closes, when the Strip panel is dead too. Covering
  everything then is defensible.
- **Popover dismissal.** At 1600×2400 with a lone Strip (so F-001 is out of
  the way), clicking a control inside the coordinate, TOFI, airspace and MARSA
  popovers, then the popover's own padding, leaves each open. An outside click
  closes all six. Correct. The bind and highlight popovers contain only buttons
  that act and close by design, so there is no non-acting control to click.
- **A board update on a *different* Strip** while a popover is open leaves it
  open, for all six. Correct.

---

## F-106 — both overlay messages are below 4.5:1 contrast

**Status:** FIXED (this run, uncommitted) — `#disc-msg` 2.13:1 → 5.80:1, `#no-awacs-msg` 3.56:1 → 6.74:1, hue preserved. The wording question was left alone, as this entry asks.
**Severity:** low — shown rarely, but shown exactly when something is wrong
**SPEC:** `crc-desktop/e2e/l1-overlays.spec.js` (2 × `test.fail`)

**What a controller sees.** A dim reddish-brown `GRD DISCONNECTED` over an
already-dimmed window. A dim blue `NO RADAR COVERAGE — HOLD A RADAR POSITION`
over the map.

**Measured.** Computed style, WCAG 2 ratio against the message box's own
background composited on black (the kindest assumption):

```
#disc-msg      "GRD DISCONNECTED"            rgb(106,58,58)  on rgba(13,13,13,.9)   2.13 : 1
#no-awacs-msg  "NO RADAR COVERAGE — HOLD…"   rgb(74,106,154) on rgba(13,13,13,.9)   3.56 : 1
```

Both are 13px, so the 4.5:1 body-text floor applies. Both colours are
hard-coded in `css/overlays.css` rather than taken from the `--ui-text-*` tokens
the rest of the UI uses.

**Scope.** Both window-level status messages, so a class of two. `#stale-banner`
and `#pick-banner` weren't measured, since neither is an overlay.

**Labelled as a taste question, not a defect:** `GRD` presumably means gRPC
(the top bar says `GRPC`). In an ATC client it also reads as Ground, which is
a Position here (`GND`). Whether it should say what disconnected in plain
words is a wording call.

---

## F-107 — act from a popover after its Strip changed and you get a bare `STALE_REV`

**Status:** FIXED (this run, uncommitted) — all four dispatch paths now read the live Strip (`getEfspStrip(strip.stripId) || strip`), the fix the Block editor already carried. Verified in Chromium.
**Severity:** medium — exactly the case popover protection exists for, and it ends in a refusal
**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "a popover still works after its Strip changed underneath it"

**What a controller sees.** They open *Coordinate…*, pick Hand Off, type a
note. Meanwhile somebody else touches the same Strip (offsets it, edits a
Block, anything). They press *Send* and the panel says `STALE_REV`. Nothing
says what went stale or what to do. The note they typed is gone with the
popover.

**Measured.** 1600×2400 viewport, so the popover is uncovered (not F-001).
APP holds an ARRIVAL Strip in `app-inbound` and opens *Coordinate…*.
`SetFlag offset` then arrives for the same Strip:

```
server Strip       rev 1 -> 2, flags.offset false -> true
DOM Strip          data-rev="1", no offset class     <- protected, by design (_isProtectedStripEl)
popover            still open                        <- correct
press Send         #efsp-mutation-error "STALE_REV"; no coordination recorded
```

**Mechanism.** `_dispatchCoordination`, `_dispatchTofi`, `_dispatchGesture`
(highlight) and the airspace popover's *Approve entry* all pass the `strip`
object captured when the popover opened to `sendEfspMutation`, which sends its
`rev` as the base. `_isProtectedStripEl` deliberately stops the Strip being
rebuilt while a popover is open, so that captured object is guaranteed to be
stale whenever a remote update lands. The Block editor already avoids this:
`getEfspStrip(strip.stripId) || strip`.

**Scope — a class of four.** Coordinate, TOFI, airspace entry, highlight.
**Not** MARSA or bind: `_dispatchMarsa` and `_dispatchCorrelation` send their
own relation's current `rev`, not the Strip's. All four were driven end to end
in the browser, each with the same result: `STALE_REV`, nothing applied.

**Related, not separately filed:** `STALE_REV` is the raw reason code, so the
refusal is on screen but not legible. That's F-103's class (refusal wording and
attribution).

---

## F-108 — close a popover without acting and its Strip stays out of date

**Status:** FIXED (this run, uncommitted) — closing a popover now asks for the render its Strip had been waiting for.
**Severity:** medium — the Strip shows something that is no longer true, with no sign of it
**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "a Strip catches up once its popover closes"

**What a controller sees.** They right-click a Strip, change their mind, and
click away. Somebody else had offset that Strip in the meantime. The Strip
still looks un-offset, and keeps looking that way until some unrelated update
happens to redraw the Rack.

**Measured.** 1600×2400 viewport, APP, one ARRIVAL Strip. Highlight popover
opened, then `SetFlag offset` applied to the same Strip, then an outside click:

```
while open        server flags.offset true    DOM .efsp-strip-offset absent   <- protected, by design
closed            popover gone                DOM .efsp-strip-offset absent
closed + 5 s      (no other activity)         DOM .efsp-strip-offset absent   <- stale
```

**Mechanism.** `_reconcileRackStrips` skips a protected Strip ("it reconciles
on a later render once unprotected"). But none of the six `_close*Popover`
functions requests a render, so "a later render" means whenever some other
board update arrives. On a quiet Board, that can be never. When the controller
*does* act, the ack's render catches the Strip up, which is why this only
shows on the close-without-acting path.

**Scope — a class of six.** Highlight, coordinate, TOFI, airspace, bind,
MARSA. None of their close functions call `renderAllOpenEfspBays`. Driven in
the browser for highlight; the other five are from the code.

---

## Extends F-001 — every one of the six popovers, measured

**Resolved with F-001.** Popovers are portalled out of the Strip and positioned
`fixed` with flip and clamp, which is what this extension argued was needed: the
coordinate and TOFI cases could not be fixed by stacking alone, because they also
opened downward from a Strip near the bottom of a short Bay. All six now pass
`elementFromPoint` at their own centre in Chromium.


**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "extends F-001: the <name> popover is on top" (6 × `test.fail`)

Same mechanism, confirmed with `elementFromPoint` on each popover's centre.
Default 1600×1000 viewport, three Strips in the Bay, popover opened on the
first:

```
popover      rect (x y w h)       what is actually at its centre
highlight    20  427 102  38      span.efsp-block            (the next Strip down)
MARSA        115 430 668  62      input#efsp-dot-command-input
coordinate   485 459 298 140      div.dv-void-container      (dockview, outside the panel)
airspace     494 439 289  90      input#efsp-dot-command-input
TOFI         563 459 220 140      div.dv-void-container
bind         497 447 286  33      input#efsp-dot-command-input
```

**The new part: coordinate and TOFI extend past the bottom of the Strip
panel.** `#efsp-bay-content` ends at y=455, and both popovers run y=459–599,
entirely below it, into dockview's containers. In a screenshot of
`#efsp-panel` the coordinate popover **is not visible at all**. Pressing
*Coordinate…* shows the controller nothing, which is F-001's "button does
nothing" symptom in its purest form. A fix to the stacking context alone will
not make these two visible: they also open downward from a Strip near the
bottom of a short Bay, with nothing to flip or clamp them. So they need
checking separately once F-001 is fixed.

**Also observed:** in a taller panel (1600×2400) with the popover clear of
neighbours, the coordinate popover is on top and its controls are reachable.
So F-001 is about what surrounds the popover, not the popover itself. That's
consistent with the original entry.

---

## F-109 — Escape closes none of the six popovers

**Status:** FIXED (this run, uncommitted) — Escape closes all six and does not reach the Block-edit or selection handlers behind them. Fixed as the consistency problem this entry frames it as, not as a doctrine breach.
**Severity:** low
**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "Escape closes the <name> popover" (6 × `test.fail`)

**What a controller sees.** They open a popover by mistake and press Esc.
Nothing happens. The only way out is to click somewhere else.

**Measured.** Each popover open, then `keyboard.press('Escape')`: the popover
element is still in the DOM, for all six. No `keydown` handler exists on any
popover or on the document for them (bay-view.js). Their only dismissal is the
capture-phase `pointerdown` outside listener.

**Why it's filed, and the honest limit.** I found no rule in the guide or the
usage guide that requires Escape on a popover, so this is not a doctrine
breach. It is filed because of the inconsistency: in the same panel, Escape
*does* revert a Block edit and an enum `<select>` (§7.4 rule 2,
`_startBlockEdit` / `_buildEnumSelectCell`). A controller who has learned "Esc
backs out" finds it works on a Block and not on the popover next to it.
Whether popovers should honour it is a decision; the inconsistency is measured.

---

## Extends F-305 — the correlation badge, measured, and it takes the bind popover with it

**Resolved with F-305.** The render signature covers the correlation record, so
the badge and *Bind…* appear on a fresh Strip without anything else happening —
which is what made the bind popover openable at all.


**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "extends F-305: an uncorrelated flight shows NO TRK and Bind… on its own"

F-305 (lane 3) names the mechanism. Lane 4's extension lists the correlation
badge as unmeasured "because the harness has no tracks to correlate against".
That isn't needed: with no tracks at all, every eligible flight goes
`UNCORRELATED`, which is exactly the state that should draw a warning. Measured
on a fresh APP ARRIVAL Strip:

```
+3 s   page store: getEfspCorrelationForStrip -> { state: UNCORRELATED }
       correlationBadgeFor(strip) -> { text: "NO TRK", warned: true }
+8 s   DOM: data-rev="1", .efsp-correlation-badge: none, Bind…: none,
       .efsp-strip-correlation-warned: absent
then   one unrelated SetFlag (rev 1 -> 2)
+0.8 s DOM: badge "NO TRK", Bind… present, warned edge present
```

**The new part, for lane 1's surface:** *Bind…* is the bind popover's only
opener on an uncorrelated flight, and it's built by the same
`_appendCorrelationBadge` call. So on a fresh Strip the bind popover **cannot
be opened at all** until something unrelated touches the Strip. And "no
contact matches this flight" (§6.6's warning) is exactly the condition that
never shows up by itself. This spec's other bind tests select the Strip first
to force the rebuild, and say so.

---

## Extends F-201 — the coordinate and TOFI notes, and every popover `<select>`

**Resolved with F-201** for the coordinate note, the TOFI note and the popover
`<select>`s (the keydown guard tests the event target, so it covers popovers it
knows nothing about). The MARSA and bind halves needed F-110's re-anchoring as
well, because a Space there was activating the enclosing `<button>`.


**SPEC:** `crc-desktop/e2e/l1-popovers.spec.js` — "extends F-201: …" (3 × `test.fail`)

Lane 2 confirmed F-201 on the MARSA note and left the other popovers to lane 1.
Which popovers have a text field at all: **coordinate** (`textarea` note) and
**TOFI** (`textarea` note). Airspace has only a `<select>`. **Bind and
highlight have no text input and no `<select>`**, only buttons, so F-201 can't
reach them.

**Measured** at 1600×2400, a lone Strip, the field focused programmatically (so
F-001 is out of the way). `keyboard.type('HOLD AT ALPHA')`:

```
popover      per-key delay   textarea value   focus afterwards
coordinate   0 ms            ""               div.efsp-strip
coordinate   80 ms           "HOLD"           div.efsp-strip
TOFI         0 ms            "HOLDAT"         div.efsp-strip
TOFI         80 ms           "HOLD"           div.efsp-strip
```

A controller typing a coordination note gets at most its first word.

**The new part: the popovers' `<select>`s.** Space is how a keyboard user
opens a focused `<select>`. Measured cleanly on the coordinate primitive
picker (a fresh popover, one Space, nothing typed first): the keydown is
`defaultPrevented`, so the picker never opens; the Strip becomes
**selected** (`getSelectedEfspStripId()` null → its id); and one render later
**focus moves to the Strip** (`activeElement` → `div.efsp-strip`). The TOFI
target and airspace pickers showed the same focus move in a run that had typed
into the note first, so I rely on the code for those two: all three are
`<select>`s inside the Strip, under the same handler. So none of the three
can be operated from the keyboard with Space. This is the same
`_onStripKeydown` handler, reached because every popover is appended *inside*
its Strip. F-205 (lane 2) is the enum-Block `<select>`; these are different
elements with the same cause.

---

## MARSA, walked (briefing flow 4)

Picked up after the lane sweep, at the coordinating session's request: no lane
had walked what MARSA *does*. Setup avoids F-001 throughout: 1600×2400, the
Board emptied first, two DEPARTURE Strips held by OPS, and the popover opened
on the **bottom** Strip so nothing is below it.

**The question asked: is the pre-rendezvous interlock broken, or unreachable?
Neither, as it turns out.** Typing `FL150` into INIT ALT (Block `21`) on a
participant and pressing Enter voids the relation server-side:
`VOIDED / CONTROLLER_ALTITUDE_CHANGE`. A value with no space in it gets past
F-201, and the declaration had landed before the edit began, so F-202 didn't
interfere. **The interlock works and can be reached. What breaks is what
happens on either side of it:** declaring from the popover (F-110), showing the
void (extends F-305 below), and the separation regime (F-111).

---

## F-110 — every click inside the MARSA popover rebuilds it empty, so it can't declare

**Status:** FIXED (this run, uncommitted) — dissolved by F-001's portalling: the popover is no longer a descendant of the `<button>` that opens it, so a click inside it no longer bubbles to that button and rebuilds it. This also fixed the MARSA/bind half of F-201. Both declarer-field reproductions now pass in Chromium.
**Severity:** high — the popover's declare form cannot be completed with a mouse
**SPEC:** `crc-desktop/e2e/l1-marsa.spec.js` — "F-110: …" (2 × `test.fail`)

**What a controller sees.** They click *MARSA…*, click into "who declared it
(heard on frequency)" and type `SHELL71`. The field stays empty. They pick the
other flight from the dropdown and it snaps back. They press *Declare* and it
is refused, because the declarer is required (§9.2 rule 1).

**Measured.** Event trace on the declarer `<input>`, one real mouse click at
its centre (`elementFromPoint` there is the input itself, so not F-001):

```
pointerdown, mousedown, focus, focusin(INPUT), click(INPUT), blur -> activeElement BODY
the <input> in the popover afterwards: a DIFFERENT element (tag gone)
the candidate <select>, clicked: also REPLACED
keyboard.type('TNK574') afterwards -> input value ""
```

**Mechanism.** `_openMarsaPopover(strip, anchorEl)` does
`anchorEl.appendChild(popover)`, and `anchorEl` is the `MARSA…` `<button>`
(or the badge `<button>`) whose click handler opens the popover. A `click`
anywhere inside the popover bubbles to that button. The handler runs
`_openMarsaPopover` again, which `_closeMarsaPopover()`s and builds a fresh,
empty one. The popover's own `pointerdown` `stopPropagation()` doesn't help,
because the rebuild is driven by `click`. Only *Declare* survives, because its
own handler calls `stopPropagation()`. It also puts an `<input>` and
`<select>`s inside a `<button>`, which is invalid HTML (interactive content
inside a button).

**Scope.** MARSA only. The bind popover is also anchored in its button, but it
has no field, and its rows call `stopPropagation()`. Coordinate, TOFI and
airspace anchor on the Strip element, not a button.

**Reproduction note, added when the spec was rebuilt after a machine shutdown.**
The original `l1-marsa.spec.js` was lost; this finding's traces survived and the
spec was rebuilt from them. The **declarer-input half reproduces** — two tests,
both failing for the measured reason. The **candidate-`<select>` half does
not**, and is currently unverified: `selectOption()` dispatches `input`/`change`
without a bubbling `click`, so it never reaches the anchor button, and
Playwright's `click()` on a native `<select>` did not rebuild the popover
either. Two attempts, then stopped rather than shaping the test until it
agreed. The mechanism says it should — a `click` on the select bubbles like any
other — so this is most likely a limitation of driving a native select
headlessly, not a correction to the finding. **Treat the picker half as
measured-by-hand but not spec-backed** until someone reproduces it another way.

**The way round exists.** `.marsa <CALLSIGN> <DECLARER>` in the dot-command
line declared an ACTIVE relation. That line is outside any Strip, so neither
this nor F-201 applies to it.

---

## Extends F-305 — the MARSA void and the participant highlight are never drawn

**Resolved with F-305 and F-111.** The void now renders as an alert sentence on
every participant Strip, the declaring Strip stops reading `MARSA ⚠`, the peer
stops offering the declare button, and SEP REG reads ATC. WP6 plan §13's
acceptance line is met.


**SPEC:** `crc-desktop/e2e/l1-marsa.spec.js` — "extends F-305: …" (2 × `test.fail`)

Lane 4's extension covers the badge after a *declaration*. These are two more
surfaces of the same mechanism (`_stripElNeedsRebuild` looks only at the
Strip's own `rev`). **One of them is a WP6 acceptance line.**

1. **The interlock's void.** The plan's §13 acceptance line: *"assert the
   relation voided … and every participant Strip carries the alert."* In the
   panel, after the INIT ALT edit on A:

   ```
                relation (page store)                A's badge     B's badge   any banner
   +0.8 s       VOIDED / CONTROLLER_ALTITUDE_CHANGE   "MARSA ⚠"     "MARSA…"    none
   +3 s         VOIDED                                "MARSA ⚠"     "MARSA…"    none
   +8 s         VOIDED                                "MARSA ⚠"     "MARSA…"    none
   select B     VOIDED                                "MARSA ✕"     "MARSA ✕"
   ```

   A was rebuilt by its own `SetBlock` ack, *before* the `efsp-marsa-delta`
   carrying the void arrived. So the controller who just issued the clearance
   sees their own Strip still saying **MARSA armed**, while ATC has in fact
   re-assumed separation. B still offers *MARSA…* (the **declare** button) for
   a flight that is in a relation. No message anywhere says a void happened.
   **Severity on this surface: high.** It is the one moment this interlock
   exists for, and the display says the opposite.

2. **§9.2 rule 5, the participant highlight.** With a relation active,
   selecting A: `getMarsaHighlightStripIds()` holds B's id, but B's element has
   no `efsp-strip-marsa-participant` class. It appears only after an unrelated
   `SetFlag` bumps B's `rev`. Selection and expansion were given `dataset`
   entries on the Strip element so the reconciler can see them; the MARSA
   highlight is client-local state of exactly that kind and has none.

---

## F-111 — SEP REG never shows MARSA; the server has it and the panel is never told

**Status:** FIXED (this run, uncommitted) — the MARSA regime writes now ride a board delta, in the declare **and** the end/void/interlock directions (this entry only measured declare).
**Severity:** high — guide §4.8.3's "they inherit a lie", in the direction it warns about
**SPEC:** `crc-desktop/e2e/l1-marsa.spec.js` — "F-111: …"

**What a controller sees.** A MARSA relation is declared. The SEP REG chip on
both participants stays blank. A controller reading the Strip is told nothing
about who is separating the aircraft.

**Measured.** Declared through the page's own `sendEfspMarsaMutation`:

```
this page, after the ack      efspFdrs[A].tofi.separationRegime = null    SEP REG chip: empty
same page after reload        efspFdrs[A].tofi.separationRegime = "MARSA"
```

So the server did write it (plan §1c: declaring writes `MARSA`, ending or
voiding writes `ATC`, via `fdrStore.setTofi`). Every connected client just
keeps the old value until it next takes a full snapshot.

**Mechanism.** `efsp-ws.js` `_handleMarsaMutation` returns an `efsp-marsa-ack`
and an `efsp-marsa-delta`, and nothing else. The FDR write that `setTofi` made
on each participant isn't broadcast as an FDR/board delta. The interlock path
(`marsaVoided` on a `SetBlock` result) presumably has the same gap for the
write back to `ATC`, but I only measured the declare direction.

**Why this one matters beyond display.** Plan §1c: *"Two answers to one
question is the defect class"*, and the guide's own example is a second
controller taking over *"ten minutes later"*. Today the controller who has
been connected all along holds the stale answer (blank or old regime), and
only someone who reconnects sees the truth.
