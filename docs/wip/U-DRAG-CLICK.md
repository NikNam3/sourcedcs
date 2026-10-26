# U-DRAG-CLICK (H167, plus H168): wip note

Branch `lane/U-DRAG-CLICK`, `eed8835d..` (this note is the last commit) on `5168c174`. Client only, no ADR, wire unchanged.

## H167: a click or double-click must never move a Strip

**Diagnosis confirmed.** In the real browser, before the fix: grab L4J2 at 85 % of its height, 7 px of jitter,
release. It dropped below L4J3 on the first click (the new `l4-drag` spec fails on the old code at
"jitter 7px, click 1"). The cause was what the supervisor said: the drop index came from the cursor Y against the
midpoints of the Strips, measured in the closed-up Rack.

**Built:**
1. `strip-drag.js` `computeInsertionIndex(rects, ghostTopY)`: the drop follows the dragged Strip's top edge
   (the pointer minus `grabOffsetY`, measured at pointerdown from the same rect as `dragWidth`) and picks the
   nearest *slot*. A slot is the top of each closed-up Strip, or one gap below the last. At zero travel the ghost's
   top is its own slot, whatever half was grabbed and whatever the heights. A move needs about half the
   neighbour's height of travel, in either direction. The rule is still one measurement per drag (§7.2 rule 5),
   with the scroll compensation (F-404) and the cross-Rack rack-under-cursor (F-406) unchanged.
2. `isUnchangedPlacement(origin, target)`: a drop that leaves the Strip in the same Rack with the same neighbours
   (recorded from the DOM at pointerdown) sends nothing. Before, a same-place drop with a neighbour sent a MoveStrip
   and re-keyed the Strip.
3. **Tab path: it could fire from a slipped click (measured).** The Bay tabs sit directly on top of
   `#efsp-bay-content`. In a scrolled Bay a Strip is cut by that edge, and a press 2 px under it plus 11 px of
   upward slip released over a Bay tab: the Strip moved from ops-coordination to ops-proposed. The fix is
   `TAB_DROP_MIN_TRAVEL_PX = 16` with `isTabDropTravel(dx, dy)`: below 16 px a tab is not a drop target (no
   highlight either), and the release resolves in the Rack, where the ghost rule says no move.

**What the guide should say (§7.2, for the docs pass):** "The drop follows the dragged Strip, not the cursor: it
lands in the slot nearest the ghost's top edge. A release with the ghost over its own slot is no move and sends
nothing. A Position/Bay tab takes a drop only after more than 16 px of travel."

**Tests:** unit tests in `tests/efsp-order-key-insertion.test.mjs` (lower-half grab + 6/7/12 px = no move; every
grab point; mixed heights with flipped neighbours; one and two places up and down; the last Strip; the unchanged
check; the tab-travel threshold). The existing midpoint tests still hold, because with contiguous rects the slot
boundaries are the old midpoints. `e2e/l4-drag.spec.js` gains: the jittered double-click (order checked after every
click, orderKeys unchanged, so nothing was sent), the slip onto a Bay tab, and a real drag onto a Bay tab. The four
gap-aiming tests now aim the ghost's top at the gap (cursor = gap + `grab().offsetY`). With the cursor itself at the
gap and a mid-height grab, the ghost sits exactly between two slots: a 1 px tie.

## H168: what the left edge shows, on hover

`strip-edge.js` (pure): `EDGE_PRECEDENCE` is the cascade of `efsp-panel.css`, highest first:
`efsp-strip-alert` (two classes) > MARSA voided > MARSA armed > contact lost (`correlation-warned`) >
obligation overdue > obligation due > Highlight (the base `var(--efsp-highlight)`). A unit test reads the
stylesheet and fails if the rule order or the alert's specificity stops matching. `stripEdgeMarkers()` gives one
sentence per marker that says what to do, and `stripEdgeTitle()` puts the drawn one first, then "Also:" and the
others. Highlight: "Highlight: yellow (your marker). Right-click to change, Ctrl+click cycles (yellow, cyan, lime,
off)." Obligations use `OBLIGATION_LABELS` where named; MARSA and contact-lost reuse the badges' own titles; the
alert lists the 'bad' alerts' reason lines.

Hit area: `bay/strip-element.js` `_appendEdgeTip` adds a transparent `.efsp-strip-edge-tip` (absolute,
`left: -4px`, 10 px wide: the 4 px border and 6 px of padding), only when a marker shows. It is not a control, so a
press on it is a press on the Strip. It needs `user-select: none`: without it a double-click on the empty box
selected the whole Strip's text, and the next press inside that selection started Chromium's own text drag
(`pointercancel`), so the Strip could not be dragged. Spec `e2e/h168-strip-edge.spec.js` checks the title, that the
tip is what the pointer is over and draws nothing, that a double-click flips and back with no selection left, and
that a drag from the edge moves the Strip two places.

A flipped Strip builds no layout, so it shows (and names) only Highlight and obligation edges, the same as what it
draws.

## Defaults taken

- D1: tab-drop travel 16 px (more than twice the 5 px drag threshold, and more than the 11 px slip measured).
- D2: the ghost reference is the Strip's top edge (not its centre: centre-vs-slot breaks when the dragged Strip is
  taller than the neighbour below, e.g. a flipped one).
- D3 (H168): a thin child element with `title`, not a pointer-position title on the Strip. It is testable, needs
  no pointermove handler, and draws nothing.
- D4 (H168): tooltip lines in the cascade order, drawn first, the rest under "Also:".

## Findings for other lanes

- Not proven, logged only: after a double-click on non-editable Strip text (the callsign opens its Block editor
  instead, so it is not that case), the word stays selected. A press-and-drag starting on that selected word could
  start the browser's text drag rather than a Strip drag. I tried a `dragstart` preventDefault on the Strip but
  reverted it, unverified. If a controller reports "a Strip would not drag right after a double-click", start there.
- None in U-VFR-MTMA's files. Rule 9: nothing new; the specs use Position ids only as fixtures.

## Walks not done

- No touch/pen walk (the tab threshold and ghost rule are pointer-type independent).
- The tooltip text for a live alert, MARSA or obligation was not walked in the browser (unit-tested from real badge
  titles; the e2e covers Highlight).
