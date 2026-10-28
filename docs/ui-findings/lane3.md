# UI findings — lane 3

Findings from the lane-3 cataloguing agent. Protocol:
`docs/efsp-ui-catalogue-parallel.md`. Format and rules:
`docs/efsp-ui-catalogue-briefing.md`.

Ids in this file are **F-3xx**. Read every other findings file before adding
one — `docs/efsp-ui-findings.md` and the other `docs/ui-findings/lane*.md` —
and use "extends F-xxx" rather than re-filing something already recorded.

Merged into `docs/efsp-ui-findings.md` by a human once the run is done.


> **Fix run — see `docs/ui-findings/FIX-RUN-STATUS.md`.** Every entry in this
> file has been worked. Statuses below are updated in place; `FIXED (this run,
> uncommitted)` means the fix is in the working tree and not yet committed.
> Where an entry labelled something a design question, taste, or a decision for
> someone else, that label was honoured and the status says so.

---

All measurements: Chromium via `E2E_LANE=3`, viewport 1600×1000, default
dockview layout (`#efsp-panel` is 800×449, `#efsp-bay-content` 800×186).
**Two browser contexts in every flow**: each is its own page, its own token and
controller name, holding its own Position (CTR at CENTER, APP at INCIRLIK,
TAC_C2 at TACTICAL). Distinct controller names matter: the same controllerId on
both sides makes a HANDOFF self-coordinated (§4.8.3), which is a different path.
Every spec is in `crc-desktop/e2e/l3-coordination.spec.js`.

None of these depend on radar contacts, tracks or SRS, so the production-DCS
harness bug fixed in `2f49e27` does not affect them.

**About `dispatchEvent('click')` in the specs.** The Coordinate and TOFI
popovers can't be clicked by pointer (F-001). So every spec that is *not* about
that fires the popover's Send by `dispatchEvent`. That way it measures its own
defect instead of failing on F-001 first.

**Read first: F-302, F-305 and F-307 are one theme.** An exchange has two
sides, and the side that has to act next is often not shown the state it
needs. That happens either because nothing renders it (F-302, F-307), or
because the Strip never redraws when the state arrives (F-305).

---

## Extends F-001 — scrolling the Bay does not reach the Coordinate or TOFI popover

**Resolved with F-001**, along the line this extension set out: the fix lets the
popover escape the Strip's containment rather than winning a z-index contest.


**SPEC:** `l3-coordination.spec.js`, "the Coordinate popover can be reached on a lone Strip, even after scrolling the Bay" and "the TOFI popover can be reached on a lone Strip"

Lane 1's F-001 extension already records that these two popovers open below
`#efsp-bay-content` (y=459–599 against a Bay ending at y=455). This entry adds
two things.

1. **It takes only one Strip.** F-001's reproduction needs a neighbour below.
   Here a lone CTR ARRIVAL Strip is enough.
2. **Scrolling does not help, and the reason matters for the fix.** The Bay is
   `overflow: auto`, so a controller's first move is to scroll down. Measured
   with the popover open: Bay `scrollHeight` 211 against `clientHeight` 186. The
   popover's bottom sits about 330 px into the Bay, but the scroll range stops at
   211. The popover is not part of the Bay's scrollable overflow. `.efsp-strip`'s
   `contain: layout` turns everything that overflows a Strip into ink overflow.
   With `scrollTop = scrollHeight`, `elementFromPoint` at *Send* returns dockview's
   `div.dv-void-container`, or `div.dv-sash` for the TOFI popover.

So the fix has to let the popover escape the Strip's containment, not just win
a z-index contest. A popover that opens upward, or is portalled out of the
Strip, would do it.

**Consequence in lane 3's terms.** The mouse cannot send any of the five
coordination primitives, or a TOFI ENTRY to CTR's two-candidate picker. There is
also no dot-command for either (`_dispatchDotCommand` has `bind`, `mission` and
the MARSA verbs, but no coordination or TOFI verb). Only keyboard Tab-through
into an invisible popover reaches Send.

---

## F-302 — the sender's Strip never shows the state of its own coordination

**Status:** FIXED (this run, uncommitted) — the five coordination primitives now carry a state badge through PROPOSED / ACTIVE / REJECTED, shaped like the existing TOFI badge rather than a second idiom. POINT_OUT's `DATA:`/`SEP:` chips were left as §4.6 rule 1's both-halves requirement, not conflated with status.
**Severity:** high. A refusal nobody sees is rule 2 exactly. A pending handoff nobody sees is how one gets forgotten.
**SPEC:** `l3-coordination.spec.js`, "the sender can see a HANDOFF is pending, and then that it was accepted" and "a rejected proposal is visible to the controller who sent it"

**What a controller sees.** CTR proposes a Hand Off to APP. The only change on
CTR's Strip is that the *Coordinate…* and ✕ buttons disappear. When APP accepts,
✕ comes back. When APP rejects, or answers an Operational Request with
*Unable*, *Coordinate…* comes back. Nothing ever says "handoff to APP pending",
"accepted" or "rejected".

**Measured.** Two contexts, CTR and APP. The CENTER Strip's
`coordination.state` in the CTR page's own store, against what the Strip renders:

```
primitive            coordination.state   sender's Strip shows
HANDOFF              PROPOSED             nothing (Coordinate… and ✕ removed)
HANDOFF              ACTIVE               nothing (✕ back)
TRAFFIC              PROPOSED / ACTIVE    nothing
OPERATIONAL_REQUEST  PROPOSED             nothing; "STAND BY" chip only after APP presses Stand By
OPERATIONAL_REQUEST  REJECTED (Unable)    nothing; Coordinate… back; #efsp-mutation-error ""
POINT_OUT            PROPOSED / ACTIVE    DATA: CTR / SEP: CTR -> SEP: APP chips
POINT_OUT            REJECTED             chips removed; Coordinate… back; banner ""
```

TOFI does have this. `.efsp-tofi-badge` reads `TOFI ENTRY: PROPOSED`, then
`ACTIVE`, then `EXIT: PROPOSED`. The five coordination primitives have no
equivalent. The POINT_OUT chips exist because §4.6 rule 1 requires both halves
to be shown, not as a status display, and they vanish on rejection too.

**Scope — a class.** All five primitives, in all three outcomes. The rejection
case is the one that breaks rule 2. The server refuses on the controller's
behalf, correctly, and the only sign on the panel is a button coming back.

---

## F-303 — a rejected replica stays in the receiver's Coordination Bay, fully workable

**Status:** FIXED (this run, uncommitted) — both halves. Server-side the NLA **and** the drag route now refuse a rejected replica; client-side it reports itself inhibited, so F-408's rendering covers it. **Drop stays available deliberately** — it is how a dead replica is cleared. Decided and recorded: the replica is left inert, **not reaped**, because it is the receiving controller's only record that they declined the flight.

**Reopened and extended (strip-layout work, after `6d3c77b`).** The fix above covered the NLA and the drag route only. Live testing found CTR could still reject APP's handoff and then open a **TOFI** on the dead replica, which minted a MISSION Strip on TACTICAL for a flight APP still worked. Airspace entry, Convert to Arrival, SetBlock, SetFlag, SetState, TransferStrip and Undo were equally open. Now:
- **Server:** `board-store.js`'s `_dispatch` refuses every op on a rejected replica (`_rejectedReplicaOpRefusal`) except `DropStrip`, `InvokeNla` (already limited to DROPPED) and `MoveStrip` (already refused into a state-implying Bay). One wording for all of them.
- **Client:** the replica no longer offers TOFI…, TOFI Exit…, Airspace…/Leave airspace, Convert to Arrival, MARSA…, Bind…/Unbind or ⇥, and double-click/right-click/shift-click send nothing. MARSA and correlation are flight-level and never reach `_dispatch`, so for those two the client is the only guard.
- **The earlier decision is reversed.** It read "✕ / Airspace… / Bind… / MARSA… are FDR-level facts about a real airframe… deliberately left alone". The airframe is real, but the controller who declined it has no business working it; only Drop stays.
- **The related question below is answered too:** a *pending* replica may not open a TOFI (server and client) until it has been accepted.
**Severity:** high. The facility that declined a flight can hand it to its own Tower, and the server accepts that.
**SPEC:** `l3-coordination.spec.js`, "a rejected replica in the receiver's Coordination Bay cannot be worked"

**What a controller sees.** APP rejects a Point Out from CTR. The replica stays
in `app-coordination` as an ordinary Strip, with an enabled *Hand to Tower*, ✕,
*Airspace…*, *Bind…* and *MARSA…*. Nothing marks it as dead.

**Measured.** After APP pressed *Reject*, then *Hand to Tower* on the same
replica:

```
INCIRLIK replica   coordination REJECTED   bayId app-coordination   NLA "Hand to Tower" enabled
press it           -> bayId twr-arrivals, state HANDED_TO_TOWER      (no refusal)
CENTER Strip       coordination REJECTED   still owned by CTR, INBOUND
```

INCIRLIK Tower now holds an arrival Strip for a flight that CENTER still owns,
and that APP explicitly declined. The same happened after an Operational
Request answered *Unable*.

**Mechanism.** The NLA button is only inhibited while
`coordination.state === 'PROPOSED'` (the `hasOpenCoordination` check in
`_buildStripEl`). `_canProposeCoordination`'s comment says a rejected replica is
"left inert", and it does stop *Coordinate…* being offered. Nothing else
applies that rule. Server-side, `_applyInvokeNla` doesn't refuse it either.

**Scope.** Every primitive's rejected replica: the NLA, ✕, and the
airspace/bind/MARSA affordances. **Related question, not filed:** a *pending*
(PROPOSED) replica also offers *Airspace…*, *Bind…* and *MARSA…*, which lets
APP approve airspace entry for a flight it hasn't accepted. That may be
intended.

---

## F-304 — the proposer's note is never shown to the receiver

**Status:** FIXED (this run, uncommitted) — the note is rendered and attributed on all five primitives and on TOFI ENTRY and EXIT, and the peer who proposed is now named.
**Severity:** medium-high. With a degraded track the note is the *mandatory* record of the verbal coordination, and it only goes one way.
**SPEC:** `l3-coordination.spec.js`, "the proposer's note reaches the receiver" and "a TOFI note reaches the MRU controller"

**What a controller sees.** CTR types a note into the Coordinate or TOFI
popover. APP or TAC_C2 gets a Strip with *Accept* and *Reject*, and no note
anywhere: not on the Strip, not in a tooltip, not in the expanded view.

**Measured.** The note is sent (`op.note`) and stored on the replica
(`receiveCoordinationProposal` writes `coordination.note`). The receiver's Strip
`innerText` doesn't contain it, and no `[title]` inside the Strip does either.
`bay-view.js` has no read of `coordination.note` or `tofiCoordination.note`
anywhere. The only `note` references are the two popovers that *write* one.

The popover's placeholder says *"Verbal coordination note (required)"* when the
track is degraded, and `_applyCoordinationPropose` refuses without one. The
system demands the note and then never shows it to the person it's for.

**Scope.** All five coordination primitives, and TOFI ENTRY and EXIT. **Also
not shown to the receiver:** who proposed. *Accept Hand Off* doesn't say from
CTR. Only POINT_OUT's `DATA:` chip names the peer.

---

## F-305 — a Strip does not redraw when something it shows changes elsewhere

**Status:** FIXED (this run, uncommitted) — **as a class, not six instances.** `_stripRenderSignature` stamps `el.dataset.sig` with everything `_buildStripEl` derives from outside the Strip record, and `_stripElNeedsRebuild` compares it — generalising the mechanism selection and expansion already used. Keyed reconciliation is untouched. **The rule going forward:** anything new in `_buildStripEl` that comes from outside the Strip record must join the signature.
**Severity:** high for the TOFI exit, which stays blocked after its blocker is cleared. Low for the `+N` badge.
**SPEC:** `l3-coordination.spec.js`, "the +N badge appears on the ATC Strip when a mission line is fragged against it" and "Accept TOFI Exit enables once CTR has set SEP REG back to ATC"

**What a controller sees.**
1. **TOFI exit stuck.** CTR proposes TOFI Exit. TAC_C2's *Accept TOFI Exit* is
   disabled, titled *"CTR must set separation regime back to ATC before this exit
   can be accepted"*. CTR sets SEP REG to ATC. TAC_C2's button stays disabled
   with the same title, indefinitely.
2. **`+N` missing.** TAC_C2 frags a mission line against CTR's flight
   (`.mission` or the bind picker). CTR's Strip shows no `+1`. The badge's own
   comment says this is exactly *"how the ATC controller sees that one exists"*.
   It also misses the replica a HANDOFF, POINT_OUT or TRAFFIC proposal creates.
   By the same mechanism it should also stay after a sibling is dropped. That
   follows from the code and was not measured.

**Measured.**

```
TOFI exit:  TAC_C2 page efspFdrs[EXIT].tofi.separationRegime   "ATC"   (the FDR update did arrive)
            MISSION Strip rev unchanged, DOM data-rev unchanged
            button.efsp-coordinate-accept-btn "Accept TOFI Exit"   disabled   (3 s later)

+N:         CTR page store: 2 live Strips on the fdrId (ARRIVAL + MISSION)
            CTR Strip: no .efsp-shared-fdr-badge
            switch to ctr-departures and back ->  "+1 {…at TACTICAL/TAC_C2 (MISSION)}"
```

**Mechanism.** `_stripElNeedsRebuild` rebuilds a Strip only when its *own*
`rev`, selection or expansion changed. Two things on a Strip are computed from
*other* records. The exit-accept gate reads `getEfspFdr(strip.fdrId).tofi`,
which lives in the FDR store and moves without touching the Strip's rev. The
`+N` badge reads `otherLiveStripsForFdr`, whose siblings move without touching
this Strip's rev. A Bay-tab switch builds every Strip fresh, which is why that
"fixes" it.

**Scope — a class.** Anything `_buildStripEl` derives from outside the Strip
record: the FDR (SREG gate, and any FDR-derived Block if the FDR updates without
a rev bump), siblings (`+N`), and plausibly the correlation and MARSA badges
(different stores). Only the two above were measured. **Distinct from** lane 1's
F-108 and lane 2's F-204, which are about *protected* Strips skipping a render.
These Strips are not protected; the reconciler looks at them and decides nothing
changed.

---

## F-306 — the regime stated when accepting TOFI never reaches either screen

**Status:** FIXED (this run, uncommitted) — the TOFI accept's regime write now rides both the ack and the board delta. The audit this entry asked for was done across all eight server-side FDR-write sites; it found this one and F-111's, and no others.
**Severity:** high. SEP REG reads blank for the whole of tactical control, which is exactly what docs/adr/0053 was written to stop.
**SPEC:** `l3-coordination.spec.js`, "the regime stated when accepting TOFI shows in SEP REG on both sides"

**What a controller sees.** TAC_C2 picks DUE_REGARD in the regime picker and
presses *Accept TOFI Entry*. On CTR's Strip, SEP REG stays empty. On TAC_C2's
own page the FDR also says nothing. A page opened afterwards shows DUE_REGARD.

**Measured.**

```
after Accept TOFI Entry (DUE_REGARD), 1.5 s:
  CTR page     efspFdrs[..].tofi.separationRegime   null
  TAC_C2 page  efspFdrs[..].tofi.separationRegime   null
  fresh page (connected afterwards, snapshot)      "DUE_REGARD", changedBy mru-ctl
```

`_applyTofiAccept` writes it with `this._fdrStore.setTofi(...)`, and the snapshot
proves the write happened. The delta or ack that carries the accept evidently
doesn't carry the FDR. By contrast, CTR editing SEP REG through the chip *does*
reach both pages (see F-305). **The fix is likely in crc-sync** (the accept path
not including the FDR in `fdrs.updated`), but the defect is on screen.

**Consequence.** Combined with F-305, CTR sees SEP REG blank while the server
holds DUE_REGARD. Nothing tells CTR it has to be moved to ATC before the exit
can complete (F-307).

**Scope.** Measured for the ENTRY accept's regime write. Any other server-side
FDR write made as a side effect of a Strip op (for example the MARSA store's
`separationRegime` write, `marsa-store.js`) is worth checking for the same gap.

---

## F-307 — CTR is not told what is blocking the TOFI exit it proposed

**Status:** FIXED (this run, uncommitted) — the precondition is shown to the proposer, worded for the side reading it, and rendered as text rather than only as a `title` on a disabled button.
**Severity:** medium. The only person who can clear the block is the one not told about it.
**SPEC:** `l3-coordination.spec.js`, "CTR is told what is blocking the TOFI exit they proposed"

**What a controller sees.** CTR presses *TOFI Exit…*. The badge reads
`TOFI EXIT: PROPOSED` and stays that way. On TAC_C2's side, *Accept TOFI Exit*
is disabled with the reason in its `title`. TAC_C2 can't fix it, because SREG
exists only on the ATC-side Strip. CTR, who can, sees nothing.

**Measured.** SREG at MARSA (the spec) or DUE_REGARD (by hand), *TOFI Exit…* pressed. CTR Strip:
`.efsp-tofi-badge` "TOFI EXIT: PROPOSED" with no title. `#efsp-mutation-error`
is empty. No mention of SEP REG or ATC anywhere on CTR's panel. The server
allowed the proposal. Its refusal only comes at *accept* (`separation_regime
must be set back to ATC…`), on the other side.

**Also:** the MRU's reason exists only as a `title` on a *disabled* button, a
hover tooltip with no touch equivalent. So it barely meets rule 2 on that side
either.

**Scope.** TOFI EXIT only. It's the one exchange with a precondition the
*proposer* has to satisfy.

---

## F-308 — binding a mission line from the picker still demands a callsign, then discards it

**Status:** FIXED (this run, uncommitted) — bind mode no longer demands a callsign, and a typed callsign that disagrees with the picked flight is now refused rather than silently discarded.
**Severity:** medium. It invites the adjacent-callsign mis-pick the picker's own comment says it must survive.
**SPEC:** `l3-coordination.spec.js`, "a mission line bound from the picker does not need a callsign retyped"

**What a controller sees.** TAC_C2 picks `BINDA1 · 0001` in the bind picker and
presses *+ New Strip*. They get *"Enter a callsign first"*. They type one, and
if they type the neighbour (`BINDA2`), the mission line is fragged for
**BINDA1**, with no word about the callsign they typed.

**Measured.** Picker `BINDA1`, callsign empty: `#efsp-create-strip-msg`
"Enter a callsign first", no Strip created. Picker `MSNA11`, callsign `MSNA12`:
a MISSION Strip created on MSNA11's FDR, and MSNA12 still has only its ARRIVAL.

**Mechanism.** `_submitCreateStrip` validates the typed callsign (non-empty,
`^[A-Z0-9]{1,7}$`) before it reads `_selectedBindFdrId()`. A bound `CreateStrip`
carries no `fdr` (by design: identity comes from the bound flight), so the
typed value is thrown away. `.mission <CALLSIGN>` doesn't have this problem.

**Scope.** Bind mode of the create form only.

---

## F-309 — `.mission` on a flight that already has a mission line says the flight doesn't exist

**Status:** FIXED (this run, uncommitted) — the wording now distinguishes 'already has a mission line' from 'no such flight'. The refusal itself was always right; the picker was left alone.
**Severity:** low
**SPEC:** `l3-coordination.spec.js`, ".mission on a flight that already has a mission line says so"

**What a controller sees.** `.mission TWICE1` a second time answers *"no live
flight TWICE1 available to frag against"*, about a flight that is live and on
CTR's screen.

**Measured.** `_missionBindCandidates()` drops every FDR that already has a
live MISSION Strip, so the lookup misses and the generic message fires. The
refusal itself is right (one mission line per flight). Only the wording is
wrong.

**Scope.** `.mission` only. The picker just omits the flight, which is fine.

---

## Extends F-101 — a double-tap on *Accept Hand Off* accepts the next replica too

**Resolved with F-101.** The guard is board-wide precisely because of this
extension's point — the class is any control whose success removes its Strip from
the Bay you are looking at, so a per-Strip guard cannot see the second tap.


**SPEC:** `l3-coordination.spec.js`, "a double-tap on Accept Hand Off accepts only the replica that was tapped"

Same mechanism as F-101, on the receiving side of a coordination. Two HANDOFF
replicas are stacked in `app-coordination`. Tap the first replica's *Accept Hand
Off*. It leaves the Bay, the Rack reflows, and the second replica's *Accept*
is now under the pointer. A second tap there accepts a flight nobody looked at.

```
neighbour's Accept under the pointer after the first tap   1 ms, 40 ms   (two runs, elementFromPoint polled)
fixed-gap second tap   150 ms   DBL…B stayed PROPOSED     (one run)
                       250 ms   DBL…B ACTIVE, moved to app-inbound   (one run; another run at 250 ms did not reproduce)
                       350 ms   DBL…B ACTIVE, moved to app-inbound
```

Timing varies from run to run, so the spec polls for the neighbour to arrive
(up to 400 ms, the guide's double-tap window) and then taps. It is not a fixed
gap. It also depends on what else is in the Bay. With earlier tests' dead
replicas above it (F-303), the reflow didn't carry the neighbour under the
pointer and the spec passed. So it runs first in the file. So F-101's class is wider than transfer-shaped NLAs: it is
**any control whose success removes its Strip from the Bay you are looking
at**, and every coordination Accept and TOFI Accept Entry does that.

---

## Workflow question, not filed as a defect — an accepted replica vanishes from the Bay you're looking at

After *Accept Hand Off* / *Accept TOFI Entry*, the Strip moves out of the
Coordination Bay (`app-inbound`, `tac-c2-tasked`). The receiver is left looking
at an empty `app-coordination` with nothing saying where it went. Whether the
view should follow, or leave a pointer, is a design call. SPEC: none.

## Walked, no finding

- **AIT** is correctly shown disabled, *"AIT (no written directive)"*, where the
  Facility has none.
- **Operational Request's three-way response** renders *Approve / Unable /
  Stand By*, and *Stand By* puts a `STAND BY` chip on **both** Strips.
- **TOFI ENTRY's regime picker** is on top and reachable, defaults visibly to
  MARSA, and its choice is sent. That it's then lost is F-306.
- **Transfer Comms** renders on both sides once accepted, and disappears from
  both once either side presses it.
- **Accept/Reject** buttons on a pending replica are on top (`elementFromPoint`
  hits the button itself).
