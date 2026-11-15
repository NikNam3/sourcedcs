# Contact click jumps to its Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a contact on the map (its label, its tactical square, or its ATC disc / `+`) opens the track panel and
makes the Strip panel switch to the Position tab and Bay that hold the contact's Strip, selected and scrolled into view.
The first click always counts.

**Architecture:** A new `panels/efsp/strip-reveal.js` decides the tab switch (pure function + a thin effect) and is called
from `correlation-highlight.js`'s `selectStripForTrack`. It writes the leaf `panel/state.js` and marks the `tabs` topic
(the change bus flushes synchronously, so `tabs.js` has rendered when the selection scrolls). It never imports `tabs.js`
(that would close a cycle through `bay-view.js` → `strip-element.js` → `correlation-highlight.js`). The label-drag click
swallow moves into a tiny testable gate, `label-drag-gate.js`.

**Tech Stack:** crc-desktop renderer, native ES modules, `node:test`.

**Spec:** the short design agreed in conversation on 2026-11-15 (approach 1, "jump on every contact click"), summarised:
- Jump only when the Strip belongs to a Bay of a Position this controller holds, and the Strip is not already on screen.
- Never switch while a Block edit or a Strip popover is open: select only.
- Never act on another controller's Strip (no switch; selection behaves as today).
- Several Strips for one contact: the one on screen, else one this controller holds, else the first.
- Switch tabs inside the Strip panel only; never bring the panel's dock tab to the front.
- The ATC disc and `+` keep their STARS gesture (`atcTargetClick`) and also open the track panel and jump.
- Primary-only contacts: there is no way to start tracking one today (v3 backlog, "Primary-only tracking"). The jump is
  keyed by trackId, so a primary contact bound to a VFR Strip (ADR 0146 binding) must work; tests stub that binding.
- Label click swallow: reset the dragged flag on every mouse-down; drag threshold 5 px → 8 px.

## Global Constraints

- No import cycle (`tests/module-graph.test.mjs`, bound 0). No `window.*` globals (`tests/no-window-globals.test.mjs`).
- One job per file; new files stay well under 300 lines.
- Test runs: `nice -n 19`, only the relevant files (listed per task).
- Work in a worktree off `main` (branch `strip-jump`); the `vfr-handoffs` checkout has unrelated uncommitted work.

## Review Focus

1. Search Bay open and the Strip is in its results: it is on screen, so no switch (the pure function takes `onScreen`).
2. The Strip's Bay belongs to a drop-only Position (not held): no switch, selection unchanged from today.
3. Contact with no Strip (an untracked primary `+`): track panel opens, Strip selection left alone (existing rule).
4. Clicking an ATC disc that accepts a handoff: the Strip has just moved to the controller's Bay via a pending ack; the
   jump uses the Strip as it is now and must not throw if its Bay is not yet held — it simply does nothing.
5. A drag that ends off the label, then a click on any label: the click opens the panel.

---

### Task 1: `strip-reveal.js` — decide and perform the tab switch

**Files:**
- Create: `crc-desktop/app/public/js/panels/efsp/strip-reveal.js`
- Modify: `crc-desktop/app/public/js/panels/efsp/bay/block-edit.js` (export `hasOpenBlockEdit(): boolean` reading `_openBlockEdit`)
- Modify: `crc-desktop/app/public/js/panels/efsp/bay/popover-portal.js` (export `hasOpenPopover(): boolean`, `_openPopovers.size > 0`)
- Test: `crc-desktop/tests/efsp-strip-reveal.test.mjs`

**Interfaces:**
- Produces:
  - `stripRevealTarget(strip, { bays, actingPositionIds, onScreen, editing }) -> { positionId, bayId } | null`
    (pure; `bays` is `getEfspBays()`'s list; the Bay is found by `strip.bayId`, its `positionId` must be in
    `actingPositionIds`; null when `!strip`, `onScreen`, `editing`, Bay unknown, or Position not held)
  - `revealEfspStrip(stripId) -> boolean` (effect: reads `getEfspStrip`, `getEfspBays`, `getActingPositions`
    (efsp-ws.js), `_stripElById` (open-bays.js) for `onScreen`, `hasOpenBlockEdit() || hasOpenPopover()` for `editing`;
    on a target calls `_setActivePositionTab`, `_setActiveBayId` (panel/state.js), then `markEfspChanged('tabs')`;
    returns whether it switched)

- [ ] **Step 1: Write the failing tests** (pure function), in `efsp-strip-reveal.test.mjs`:
  - `held Strip off screen -> its Position and Bay`: bays `[{bayId:'ap-arrivals',positionId:'AP'}]`, acting `['AP','TWR']`,
    `onScreen:false` → `{positionId:'AP', bayId:'ap-arrivals'}`
  - `on screen -> null` (same, `onScreen:true`)
  - `editing -> null` (`editing:true`)
  - `Bay of a Position not held -> null` (acting `['TWR']`)
  - `unknown Bay -> null` (strip.bayId `'gone'`)
  - `primary contact bound to a VFR Strip`: stub strip `{stripType:'VFR', bayId:'ap-arrivals'}` plus a correlation record
    `{state:'CORRELATED', matchedBy:'BINDING', trackId:'P1'}` with a primary-only track (no code) in
    `latestFromServer`; assert `stripIdsForTrackId('P1')` returns it and `stripRevealTarget` gives the AP target.
- [ ] **Step 2: Run, expect FAIL** — `cd crc-desktop && nice -n 19 node --test tests/efsp-strip-reveal.test.mjs` (module not found)
- [ ] **Step 3: Implement** `stripRevealTarget`, `revealEfspStrip`, `hasOpenBlockEdit`, `hasOpenPopover`.
- [ ] **Step 4: Run, expect PASS** — same command, plus `nice -n 19 node --test tests/module-graph.test.mjs tests/no-window-globals.test.mjs`
- [ ] **Step 5: Commit** — `feat(efsp): strip-reveal decides the tab switch to a Strip`

### Task 2: contact click uses it, ATC disc and `+` included

**Files:**
- Modify: `crc-desktop/app/public/js/panels/efsp/correlation-highlight.js` (`selectStripForTrack`, `_preferVisibleStrip`)
- Modify: `crc-desktop/app/public/js/map-interactions.js` (`_onAtcTargetClick`)
- Test: `crc-desktop/tests/efsp-correlation-client.test.mjs` (extend)

**Interfaces:**
- Consumes: `revealEfspStrip(stripId)` from Task 1.
- `selectStripForTrack(trackId)` keeps its return (the chosen stripId or null); it now calls `revealEfspStrip(stripId)`
  BEFORE `selectEfspStripById(stripId)`, so the scroll finds the freshly rendered element.

- [ ] **Step 1: Write the failing tests:**
  - `several Strips: one held by an acting Position wins over the first when none is open` (open Bays `[]`, s1 owned by a
    Position not held, s2 by `AP` held → `'s2'`); needs an acting-positions test seam in efsp-ws.js if none exists
    (check for an existing `_set…ForTest` first).
  - `a contact with no Strip leaves the panel tabs alone` (`_activeBayId` unchanged after `selectStripForTrack('none')`).
- [ ] **Step 2: Run, expect FAIL** — `nice -n 19 node --test tests/efsp-correlation-client.test.mjs`
- [ ] **Step 3: Implement.** `_preferVisibleStrip`: on screen, else held (Bay's Position in `getActingPositions()`), else
  first. `_onAtcTargetClick`: after `atcTargetClick(id)`, `showTrackPanel(id)` and `selectStripForTrack(id)` (inside the
  existing `_atcLastClick` dedupe, so disc + symbol is still one gesture).
- [ ] **Step 4: Run, expect PASS** — the test file above plus `tests/efsp-strip-reveal.test.mjs tests/module-graph.test.mjs`
- [ ] **Step 5: Commit** — `feat(scope): a contact click jumps the Strip panel to its Strip, ATC targets too`

### Task 3: the first label click always counts

**Files:**
- Create: `crc-desktop/app/public/js/label-drag-gate.js`
- Modify: `crc-desktop/app/public/js/map-interactions.js` (replace `_labelDragged` and the inline `dist < 5`)
- Test: `crc-desktop/tests/label-drag-gate.test.mjs`

**Interfaces:**
- Produces: `LABEL_DRAG_THRESHOLD_PX = 8`; `createLabelDragGate() -> { down(), move(distPx) -> boolean /* true once dragging */, takeClick() -> boolean /* true = treat as a click */ }`.
  `down()` clears the dragged state; `takeClick()` returns false after a drag and clears it.

- [ ] **Step 1: Write the failing tests:** `move(7)` keeps it a click; `move(8)` makes it a drag and `takeClick()` false;
  `a drag with no click, then down(), then takeClick() -> true` (the swallowed-click bug).
- [ ] **Step 2: Run, expect FAIL** — `nice -n 19 node --test tests/label-drag-gate.test.mjs`
- [ ] **Step 3: Implement** the gate; in map-interactions, `_onLabelMouseDown` calls `gate.down()`, the mousemove label
  branch returns early unless `gate.move(dist)`, `_onLabelClick` returns unless `gate.takeClick()`.
- [ ] **Step 4: Run, expect PASS** — the test file plus `tests/module-graph.test.mjs`
- [ ] **Step 5: Commit** — `fix(scope): a label drag no longer swallows the next label click; 8 px drag threshold`

### After the tasks

- Run the three new/changed test files once more together, then hand over for a live check: click a contact whose
  Strip is in another held Position's Bay; click an ATC disc; drag a label, release off it, click a label.
