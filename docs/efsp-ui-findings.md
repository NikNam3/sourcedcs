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

---

## F-001 — every popover is painted underneath the rest of the panel

**Status:** OPEN
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

**Status:** OPEN
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

**Status:** OPEN — needs a number before it is actionable
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

**Status:** OPEN — needs a decision, not a fix
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

_(New findings go below. Read upward before adding — F-001 in particular
presents in many places and most "this control does nothing" reports will be
instances of it until it is fixed.)_
