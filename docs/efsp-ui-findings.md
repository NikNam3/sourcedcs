# EFSP UI findings

Defects found by driving the real panel in a real browser. See
`docs/efsp-ui-catalogue-briefing.md` for how this is produced and the rules
that govern it — chiefly: **entries are catalogued here, not fixed here.**

**Format.** One entry per defect, newest last, id never reused. Each needs what
a controller sees, measured evidence, and where the reproduction lives. Status
is `OPEN`, `FIXED` (with the commit), or `BY DESIGN` (with who decided).

`SPEC:` names the `test.fail()` reproduction. When somebody fixes the defect,
Playwright reports *"expected to fail but passed"* — that is the signal to
remove the annotation and flip the status here.


> **Fix run — see `docs/ui-findings/FIX-RUN-STATUS.md`.** Every entry in this
> file has been worked. Statuses below are updated in place; `FIXED (this run,
> uncommitted)` means the fix is in the working tree and not yet committed.
> Where an entry labelled something a design question, taste, or a decision for
> someone else, that label was honoured and the status says so.

---

## F-001 — every popover is painted underneath the rest of the panel

**Status:** FIXED (this run, uncommitted) — popovers are portalled out of the Strip and positioned `fixed` from JS with flip and clamp, so they escape the stacking context, the Strip's containment and the Bay's overflow in one move. `.efsp-strip`'s `contain: layout style` was deliberately left alone. Verified in Chromium: all six now win `elementFromPoint` at their own centre.
**Severity:** high — makes six controls unusable, not one
**SPEC:** `crc-desktop/e2e/marsa-popover.spec.js` (3 × `test.fail`)

**What a controller sees.** The MARSA menu "vanishes behind other strips".
Reported as a MARSA problem; it is not.

**Measured.** `.efsp-strip` carries `contain: layout style`, and **`contain:
layout` creates a stacking context**. So `.efsp-coordinate-popover`'s
`z-index: 50` competes only *inside* its own Strip, and the Strip itself is
`z-index: auto` — anything outside it paints on top. With three Strips on an
`ops-proposed` Board:

```
popover rect        x=110 y=430 w=673 h=62      position:absolute  z-index:50
.efsp-strip                                     contain:layout style  z-index:auto
elementFromPoint at the popover's centre  ->    #efsp-dot-command-input
                                                x=0 y=456 w=800 h=44
```

**Scope — this is a class, not an instance.** All six popovers use
`.efsp-coordinate-popover` positioning inside a Strip: coordinate, TOFI, MARSA,
bind, airspace, highlight. It is also the most likely explanation for the
separate report of *"buttons not doing anything"* — a control inside any
popover receives the click on whatever is on top of it instead.

**History worth knowing before fixing.** The CSS comment on that rule records
`contain: paint` being dropped because it **clipped** popovers. That fixed the
visible half of this bug and left this half: the popover is no longer clipped,
it is simply underneath. A fix that only re-examines `paint` will miss it.

---

## F-002 — the MARSA badge lands on its own row, below the controls

**Status:** FIXED (this run, uncommitted) — `flex-basis: 100%` removed from the actions row and the four badge classes; badges and actions now share one trailing row. A plain Strip 143→134 px; a Strip carrying three badges is also 134 px (was 164 px for one).
**Severity:** low — cosmetic, but reads as broken
**SPEC:** none yet

**What a controller sees.** A small dashed `MARSA…` box alone on a line under
the action buttons, aligned with nothing, looking like a rendering glitch
rather than a control.

**Measured.** `_appendMarsaBadge(el, strip)` appends to the Strip element
*after* `el.appendChild(actions)`, and `.efsp-strip-actions` is
`flex-basis: 100%`. So the actions row claims a full line and the badge is
pushed onto the next one. Confirmed by screenshot of an `ops-proposed` Strip.

**Note.** The correlation badge is appended in the same place and will do the
same thing once it renders. Worth checking both together.

---

## F-003 — a Strip is ~150px tall, so a Bay shows very few

**Status:** ANSWERED, and improved — still not a defect. Lane 4 supplied the number (**1 of 6** visible, and removing `20`/`21` changes it by zero). Acting on F-002 and F-401 instead took `#efsp-bay-content` from 201→269 px and the Strip from 143→134 px. **Whether that is enough is still the open design question F-003 always was.**
**Severity:** medium — this is the mechanism behind heads-down time
**SPEC:** none yet

**What a controller sees.** Three seeded Strips, and only the first is fully
visible in the Bay; the second's header is just appearing at the bottom edge.

**Measured.** Screenshot at a 1600×1000 viewport. Contributing: chips wrap onto
multiple lines, the actions row claims a whole line of its own (see F-002), and
most chips are **empty on a fresh Strip** — `ALT DEP RWY DEST RTE STEREO` all
blank, each still taking its full label-plus-value width.

**What is needed.** The number `docs/efsp-wp6-plan.md`'s Verification asks for:
*with six Strips in the departure Bay, how many are visible without scrolling?*
Measure it, and measure it again with `20`/`21` removed from DEPARTURE's compact
list — the plan already says that if the count drops by more than one, those
two chips move to the expanded view. **Measure; do not decide.**

---

## F-004 — crc-sync accepts any well-formed JWT without verifying it

**Status:** OPEN — needs a decision, not a fix. **Deliberately untouched by the fix run**, exactly as this entry asks.
**Severity:** unknown until someone says where crc-sync sits
**SPEC:** n/a — server-side, not a UI defect

**What it is.** `crc-sync/src/auth.js`'s `decodeJWT` base64-decodes the payload
and returns it. `requireAuth` checks only that a bearer token has three parts
and decodes. No signature check, no issuer check, no expiry check.

**How it surfaced.** It is what lets the e2e harness authenticate with a
synthetic token and no Casdoor round trip.

**Why it is a decision rather than a bug.** It is defensible if crc-sync only
ever sits behind something that has already verified the token — nginx, or the
Casdoor-authed path the deployment notes describe. It is not defensible if
`/feed` or `/api/*` is ever reachable directly. **Somebody who knows the
deployment has to answer that**; do not change it on this file's say-so.

---

## F-005 — a Strip with an open proposal can never be cleared by the side that proposed it

**Status:** OPEN — found during the fix run, not by the cataloguing lanes.
**Severity:** medium — a flight nobody answers is stuck on the Rack for good
**SPEC:** none. It surfaced as `l1-popovers.spec.js`'s `clearBay` helper hanging,
which is how it was noticed rather than a reproduction of the workflow.

**What a controller sees.** They propose a Hand Off (or any coordination
primitive, or a TOFI entry). The receiving controller never answers — they are
busy, or they have gone. The proposing controller now has no way to retire that
Strip at all. It sits in the Rack, and every attempt to drop it is refused.

**Measured.** `board-store.js` offers `PROPOSE`, `ACCEPT`, `REJECT` and
`STAND_BY`, and **no withdraw**. `_applyDropStrip` refuses while
`coordination.state === 'PROPOSED'` (*"cannot drop a Strip with an open
coordination proposal"*). Both halves are individually correct — you should not
be able to drop a flight out from under an exchange somebody else is mid-way
through answering — and together they leave no exit.

It was found because a spec's Bay-clearing helper could not clear a Bay: the
F-107 coordinate case ends by pressing *Send*, which leaves one undroppable
Strip in `app-inbound`, and six later tests died inside that helper rather than
on the behaviour they named.

**Why it is filed rather than fixed.** The fix is a new operation (a withdraw,
available to the proposer while the state is still `PROPOSED`) or a policy (an
expiry on an unanswered proposal). Which of those is right is a doctrine
question about who owns an exchange that has been started and not answered, and
it belongs to whoever owns §4.8, not to a fix run.

---

_(New findings go below. Read upward before adding — F-001 in particular
presents in many places and most "this control does nothing" reports will be
instances of it until it is fixed.)_
