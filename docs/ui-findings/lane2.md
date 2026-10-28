# UI findings — lane 2

Findings from the lane-2 cataloguing agent. Protocol:
`docs/efsp-ui-catalogue-parallel.md`. Format and rules:
`docs/efsp-ui-catalogue-briefing.md`.

Ids in this file are **F-2xx**. Read every other findings file before adding
one — `docs/efsp-ui-findings.md` and the other `docs/ui-findings/lane*.md` —
and use "extends F-xxx" rather than re-filing something already recorded.

Merged into `docs/efsp-ui-findings.md` by a human once the run is done.


> **Fix run — see `docs/ui-findings/FIX-RUN-STATUS.md`.** Every entry in this
> file has been worked. Statuses below are updated in place; `FIXED (this run,
> uncommitted)` means the fix is in the working tree and not yet committed.
> Where an entry labelled something a design question, taste, or a decision for
> someone else, that label was honoured and the status says so.

---

All measurements: Chromium via `E2E_LANE=2`, viewport 1600×1000, default
dockview layout, `DEPARTURE` Strips in `INCIRLIK`, OPS held unless stated.
Every spec lives in `crc-desktop/e2e/l2-block-editing.spec.js`, and each
`test.fail` was also run without the annotation to check it fails for the
measured reason and not a setup error.

**Read this first: F-201–F-204 share one mechanism.** Two pieces of
`bay-view.js` together produce four symptoms:

1. The Strip element has its own keydown handler, `_onStripKeydown`. It
   `preventDefault()`s **Space and Enter** and toggles selection. Nothing inside
   the Strip stops those keys bubbling up to it: not the Block `<input>`, not the
   enum `<select>`, not any popover input.
2. `renderBay()` ends by re-focusing **the Strip element** that contained
   `document.activeElement` (`el.focus()`, the §7.8 rule 3 refocus). So a render
   while a Block input has focus moves focus off the input onto its Strip.

Whoever fixes one of these should read the other three first.

---

## F-201 — a space cannot be typed into a Block, and typing stops after it

**Status:** FIXED (this run, uncommitted) — `_onStripKeydown` now stands aside when the keydown started on a control inside the Strip. Guarding on the event *target* rather than patching call sites is what made it cover the popovers too.
**Severity:** high. RTE, FULL RTE, RMKS and FAC RMKS all need spaces.
**SPEC:** `l2-block-editing.spec.js`, both "F-201: …" tests

**What a controller sees.** They click RTE and type `DCT ALPHA DCT`. The chip
ends up holding `DCTALP` or so, and the rest of what they typed goes nowhere.

**Measured.**

```
typed                     input value            focus afterwards
"DCT ALPHA DCT"           "DCTALP" / "DCTA"      div.efsp-strip
"AR TRACK" (MARSA note)   "AR" / "ART"           (popover input)
```

The space is swallowed by `_onStripKeydown`'s `preventDefault()`. Its
`_selectStrip()` asks for a render. One frame later `renderBay()` moves focus to
the Strip, so the characters typed after that frame are lost. How many survive
depends on typing speed. Any later Space or Enter toggles the Strip's selection
again.

**Scope: a class.** It covers every text input that sits inside a
`.efsp-strip`: all free-text Blocks on chips and in the expanded view, and
popover inputs. The MARSA note input was confirmed. By construction this also
covers the coordinate, TOFI and airspace popover inputs, which are lane 1's
surface and were not walked here. The enum `<select>` is F-205.

---

## F-202 — any Board update moves focus out of a half-typed Block

**Status:** FIXED (this run, uncommitted) — `renderBay` refocuses the Strip only when the node that had focus is actually gone.
**Severity:** high. On a live Board this happens constantly.
**SPEC:** `l2-block-editing.spec.js`, "F-202: a half-typed Block keeps focus when another controller updates a different Strip"

**What a controller sees.** They are typing an altitude. Somebody else, at
another Position, changes a different Strip. The rest of their typing
disappears, and the input still sits open with half a value in it.

**Measured.** Two browser contexts. Controller A holds OPS and controller B
holds CD. A hands FOC202 to CD, clicks FOC201's ALT and types `FL3`. B then
sets DEP on FOC202, which is no longer even in A's Bay:

```
focus before B's edit      input.efsp-block-input
focus after B's edit       div.efsp-strip          (FOC201's own Strip)
A then types "50"          input still reads "FL3"
```

This is mechanism 2 above. The Strip under edit is *protected* from rebuild
(`_isProtectedStripEl` sees the `.efsp-block-input`), but the refocus at the
end of `renderBay()` does not care about that. It focuses the Strip anyway.

**Scope.** Every render: every board delta, every ack, every selection
change. It applies to every editable surface inside a Strip, like F-201.

---

## F-203 — Enter commits the Block and also toggles the Strip's selection

**Status:** FIXED (this run, uncommitted) — same mechanism as F-201. The §7.8.1 non-drag move path is intact.
**Severity:** low-medium. Selection is what the Rack-header move acts on.
**SPEC:** `l2-block-editing.spec.js`, "F-203: …"

**What a controller sees.** They enter an altitude and press Enter. The Strip
lights up as selected. If it was already selected, it silently deselects.

**Measured.** An unselected Strip, ALT `FL350` and Enter. The value committed
(`SetBlock 7 FL350` sent, chip reads FL350) and the Strip's class became
`efsp-strip efsp-strip-selected`. The input's handler calls
`preventDefault()` but not `stopPropagation()`, so `_onStripKeydown` also
runs. **Why it matters:** `_onRackHeaderClick` moves the selected Strip. After
an edit, one click on a Rack header moves a Strip the controller never meant
to select.

**Scope.** It hits the Enter commit on every free-text Block. It is the same
mechanism as F-201.

---

## F-204 — clicking away from a Block edit freezes the whole Strip

**Status:** FIXED (this run, uncommitted) — protection now lasts only while the input has focus; after that the Strip reconciles normally and the edit is restored from a draft, unfocused, on the rebuilt cell. **Blur still neither commits nor reverts**, as this entry insists. One open edit at a time, which `_buildBlockCell`'s comment had always claimed.
**Severity:** high. The screen shows a state the server no longer has, and acting on it fails.
**SPEC:** `l2-block-editing.spec.js`, the three "F-204: …" tests

**What a controller sees.** They click ALT, type, then click somewhere else.
Blur correctly neither commits nor reverts; that is checked by a passing test,
"blur neither commits nor reverts". But the input stays open **indefinitely**,
and from then on the Strip stops updating. Other people's edits never appear.
If the Strip is handed off, it **stays in this Bay** with its old NLA button,
and pressing that button returns `STALE_REV`.

**Measured.**

```
abandoned edit, then SetBlock 8=LTAG on the same Strip:
  store  filed.departureAirport = "LTAG"     rev 2
  DOM    .efsp-block-8 = ""                  data-rev 1

abandoned edit, then InvokeNla (OPS+CD held):
  store  bayId cd-pending-clearance, owner CD, PENDING_CLEARANCE
  DOM    still in #efsp-bay-content (ops-proposed), NLA reads "Send to Clearance"
  press that NLA  ->  #efsp-mutation-error "STALE_REV"
```

`_isProtectedStripEl` protects any Strip holding a `.efsp-block-input` from
being rebuilt, moved **or removed**. That is correct while someone is typing.
It is wrong once they have left, and nothing ends the edit short of refocusing
the input and pressing Esc. Even after Esc the stale Strip stays until some
later render. The comment in `_startBlockEdit` says "the next click elsewhere
… will naturally replace it once re-rendered". That is not true, because the
protection is exactly what stops the re-render.

**Also measured, same root:** `_buildBlockCell`'s comment says that starting
a new edit reverts any other cell still open. It does not. Clicking ALT and
then DEP leaves **two** inputs open on one Strip. Nothing limits them to one
per Strip or one per Board, so a controller can freeze several Strips
without noticing.

**Note for the fixer.** §3.7 rule 5 means blur must not *commit*. The rule is
satisfied. The open question is what an abandoned edit should look like when
it should neither commit nor lock the Strip. That is a design choice. For
example, the edit could survive a rebuild instead of blocking it. Do not
"fix" this by committing or reverting on blur.

---

## F-205 — the enum `<select>` commits on the first arrow key, and Space closes it

**Status:** FIXED (this run, uncommitted) — arrow keys no longer commit. **The contract question was decided**: one contract for both cell kinds — Enter commits, Esc reverts, blur never sends a Mutation.
**Severity:** medium. An arrow key amends a clearance field.
**SPEC:** `l2-block-editing.spec.js`, both "F-205: …" tests

**What a controller sees.** They click DEGR (or RLS ST, ARSPC, RADAR, SEP REG,
ORDNANCE) and press ↓ to look at the options. The first option they pass is
committed at once and the picker disappears. If they press Space to open the
list, the picker disappears instead.

**Measured.** A fresh Strip, DEGR reading `NONE`. Click, and the `<select>`
(90×30) takes focus:

```
ArrowDown  ->  sent [{kind:'SetBlock', blockId:'5A', value:'CST'}]   select gone, focus on <body>
Space      ->  nothing sent, select gone, focus on div.efsp-strip
```

`_buildEnumSelectCell` commits on `change`, and Chromium fires `change` for
every arrow press on a closed `<select>`. Space bubbles to `_onStripKeydown`
(F-201's mechanism), which moves focus. The select's `blur` → `revert()` then
closes it.

**Related.** The free-text path's contract is "Enter commits, Esc reverts,
blur does neither". The `<select>` path reverts on blur. That is harmless
today, because a mouse pick has already committed, but it is a second
contract for the same kind of cell. Whoever fixes this should decide if both
should follow one contract.

**Scope.** All six enum Blocks (`ENUM_SELECT_BLOCKS`): 5A, 14A, 24A, RSVC,
SREG and 3G.

---

## F-206 — "—" in an enum picker does nothing, so an enum Block can never be cleared

**Status:** FIXED (this run, uncommitted) — and this entry's fallback turned out to be the right answer for most of them. The server accepts a clear only for **SREG and RSVC**, which now offer `—`. `5A` and `3G` already have their cleared value among their options (`NONE`, `CLEAN`); `14A`'s six states are exhaustive; `24A` is append-only by design. Those four no longer offer `—` once set.
**Severity:** low-medium. Standing rule 1 fails: an enabled choice that does nothing.
**SPEC:** `l2-block-editing.spec.js`, "F-206: …"

**What a controller sees.** DEGR was set to `CST` by mistake. They open the
picker and choose `—`. The picker closes and the Block still reads `CST`. No
other control clears it.

**Measured.** No Mutation is sent and nothing is shown. The `change` handler
returns early on `!value`. So `—` is offered as an option but can never be
acted on.

**Scope.** All six enum Blocks. Whether the server would *accept* a clear
(null or '') was not checked. If it would not, the finding becomes "`—`
should not be offered once a value is set".

---

## F-207 — extends F-103: a refused Block edit throws away what was typed

**Status:** FIXED (this run, uncommitted) — the refusal carries the Block label and the typed text, and the Block editor re-opens seeded with it, so a long route is corrected rather than retyped.
**Severity:** medium
**SPEC:** `l2-block-editing.spec.js`, "F-207: …"

**Only the new part.** F-103 already records that the refusal banner does not
name the Strip and clears after 6 s. For Block edits there is a further
loss. The input closes on Enter *before* the server replies. On refusal the
Block goes back to its old value, with no mark on the Block itself, and the
typed text exists nowhere on screen:

```
STEREO  "NOSUCH" + Enter  ->  banner "VALIDATION_ERROR: NOSUCH is not a configured stereo route"
                              chip reads ""  (no marker, typed value gone)
FREQ    "999" + Enter     ->  banner "VALIDATION_ERROR: frequency must be a number between 30 and 400 MHz, not 999"
                              chip reads ""
```

To correct a long route, the controller retypes all of it from memory, and
after 6 s they cannot even see what was wrong with it.

---

## Extends F-105 — the `⌿` and `*` controls are 20×20 and 14×22

**Partly resolved with F-105, and these two are its documented exceptions.**
`⌿` is now 32×44 and `*` 26×32. Neither reaches 44×44, deliberately: a full 44
would reach onto the editable value cell 2 px away and steal its clicks. Closing
that gap needs the chip layout to change, which is a decision, not a tidy-up.


**SPEC:** `l2-block-editing.spec.js`, the two "extends F-105: …" tests

These are new surfaces for the touch-target class F-105 already records:

```
button.efsp-confirm-vacated-btn  (⌿, INIT ALT once it has a value)   20 x 20
button.efsp-annotation-overflow  (*, a chip with >2 superseded)      14 x 22
```

Both work: one press strikes the entry, and one press opens the expanded view
at the full history. Size is the only issue. `*` is the smallest control on
the Strip after MARSA…. Both specs fail even against the helper's lenient
32 px check (see F-105's harness note).

---

## F-208 — the expanded view: rows that say nothing, and a collapse button that scrolls away

**Status:** PARTLY FIXED (this run, uncommitted), and deliberately so. **The defect is fixed**: Escape collapses, a labelled `▲ Collapse` sits at the end of the expanded rows, and the trailing actions row is now sticky so the top `▲` stays reachable (`position: sticky` does work under `contain: layout style` — verified). **The Block-Map-order half is untouched**, because this entry labels it taste or workflow, not a defect.
**Severity:** low. Partly a taste or workflow question, labelled below.
**SPEC:** `l2-block-editing.spec.js`, both "F-208: …" tests

**What a controller sees.** They press `▼`. The Strip grows from 140 px to
684 px, in a Bay whose viewport is 201 px (F-401 and lane 4's numbers). They
scroll down to read the rows. The `▲` that closes the view is now 423 px above
the top of the Bay.

**Measured.**

```
fresh DEPARTURE Strip, ▼ pressed:
  rows    22 — 2 REV, 6 PROP DEP, 10 ATIS, 11 APREQ, 14 RLS TIME, 16 MVMT, 17 TAXI,
               18 TAKEOFF, 19 GATE, 23 FAC RMKS, 24 MIT RMKS, 26 NLA, 2A VOICE, 4A RMV,
               4B DATALINK, 9A–9C FAC A–C, 9D FULL RTE, 9E RMKS, 14B EDCT, 14C CFR
  Strip   140 px -> 684 px          Bay viewport 201 px (y 254..455)
  last row scrolled into view  ->  ▲ at y=-169
```

- **Defect:** the only way to collapse is the `▲` in the actions row, which
  sits *above* the 22 rows. There is no Esc and no second control at the
  bottom.
- **Taste or workflow, not a defect:** the list is Block Map order, including
  rows that can never show anything. Examples are `26 NLA` (the NLA is the
  button already on the Strip, and its row is a bare label), `2 REV` and
  `4A RMV` (system-derived, read-only). `_expandedBlockIdsFor` says the view
  shows "what the chips cannot". These rows qualify on that test, but they
  hold no content.

**Walked, no finding:** expansion opens and closes, survives a re-render (an
edit to the same Strip leaves it expanded), and expanding a second Strip
collapses the first, as designed. `*` opens the view at the right Block with
the full history (e.g. INIT ALT: 1000, 2000, 3000 struck through, 4000
active). Struck (`⌿`) and superseded entries render with distinct styles.

---

## Walked, no finding

- **Boolean toggle (IFR, 3F HOOK).** One click sends the flipped value. Blank
  cells are still 28×20 targets. It works.
- **`⌿` confirm-vacated.** It appears only once INIT ALT has an ACTIVE entry.
  One press sends `confirmVacated:true`. The entry renders struck, `⌿` goes
  away, and nothing is refused. Whether striking an altitude should take one
  press is a workflow question, not recorded as a defect.
- **Esc.** It reverts the free-text input and sends nothing. It is correct
  whenever the input still has focus (see F-202 for when it doesn't).
- **Blur.** It neither commits nor reverts (§3.7 rule 5 / §7.4 rule 2). A
  passing test holds this. What it costs is F-204.

## Not reported, deliberately

- **Fdr-routed Blocks such as ALT (7) keep no struck history.** Only
  annotation Blocks have a history chain, so §3.7 rule 2's "superseded value
  MUST remain visible" is out of reach for them. That is a server data-model
  question, not a UI defect, and not this lane's.
