# 0055 — every Block is reachable, §3.7's history is finally rendered, and the excuse list that hid both is gone

## Context

`_buildBlockCell` was called from exactly two places in `bay-view.js`: the flipped view (Block `1` alone) and a loop over `compactBlocksFor(role)`. There was **no expanded Strip view, no annotation-editor UI, and no dot-command** for an arbitrary Block. `annotation-editor.js` is a pure model with no production callers, and the "Tab/Shift+Tab cycling (efsp-panel.js)" its own header refers to **does not exist** — that string is its only occurrence in the client.

So every writable Block outside one hand-maintained list was unreachable from the panel. Among them: **five of the six Blocks §9.2's MARSA interlock watches** (DEPARTURE `20`/`21`, OVERFLIGHT `7A`/`9A-VECTOR`, ARRIVAL `9A-VECTOR`), and guide-**required** Blocks including `9A-FUEL`, which §8.3 says must survive any facility narrowing. The interlock `docs/adr/0051` calls *"the highest-value single military interlock available"* was, in practice, untriggerable by a human — its acceptance criterion passes only in server-side scenarios that call `SetBlock` directly.

ARRIVAL's Block `7` was the exception and stayed reachable, because `'7'` was in the shared compact list and is annotation-routed on that Role. An earlier note in the session that said *all six* interlock Blocks were unreachable was wrong; it is five.

Separately, **§3.7 had never been visible**. `resolveBlockValue` collapses a cell to its one `ACTIVE` entry before it reaches the DOM, so the server's append-only history — kept, persisted and broadcast since Phase 1 — was discarded by the renderer. There was no strikethrough CSS anywhere and `PREPLANNED` appeared zero times in the repo. Rule 2 is explicit about the cost:

> A superseded value MUST remain visible **in the same Block**, rendered struck through, **until the Strip is `DROPPED`**. Where space does not permit, the Block MUST render an **overflow indicator** and expose full history **on tap** — modelled on ATOP's `*` convention.

**Why the test that exists for exactly this missed it.** `efsp-ui-reachability.test.js` held every writable Block to being in the compact view *or* on a `DELIBERATELY_NOT_IN_COMPACT_VIEW` excuse list. Most entries excused a Block with the reason *"annotation editor"* — a surface that was never built. **An excuse list whose reasons name surfaces that do not exist is a test reporting green while covering nothing.**

## Decision

### The excuse list is deleted; reachability is checked behaviourally

The per-Role test now renders the Strip, renders it expanded, and requires every writable Block to actually appear in one of them. Nothing can be excused by assertion. This is the root fix — the list was the mechanism by which a fully implemented, guide-required Block could be simultaneously unreachable and green.

### An expanded Strip view, one Strip at a time

A `▼` toggle renders every Block in `BLOCK_MAPS[strip.role]`, **in Block Map order** — deliberate, not a default: that is the order of the paper strip and of the guide's own §6.2/§6.3 tables, so it is learnable and stable, unlike anything derived from a property that changes as the Strip is worked. Read-only Blocks render too, so this is also the first place Block `2`/`4`/`25` can be read explicitly.

**`_expandedStripId` is a single id, not a Set.** DEPARTURE's Block Map is ~30 entries; several Strips expanded at once means 30 × N rows rebuilt on every board delta, in a panel whose rendering rules exist to keep Bays cheap. Bounded by construction rather than by hoping.

Keyed by `stripId` rather than DOM state, so expansion **survives a re-render** — board deltas rebuild Strips constantly. Deliberately *not* the popover pattern: a popover must be added to `_isProtectedStripEl` or a remote delta destroys it, and this has no such requirement.

The editable cell is **`_buildBlockCell` reused unchanged**, so free text, the enum `<select>`, the boolean toggle and the `⌿` button all arrive with their Enter-commits / Esc-reverts / never-on-blur contract intact rather than being reimplemented in a second surface.

### Per-Role compact lists, and the criterion is edit frequency

Because the expanded view makes everything reachable, **reachability cannot be why a Block earns a chip**. What earns one is being edited on most Strips of that Role: a heading and an initial altitude are issued with every departure clearance, a radar vector constantly.

**Interlock-ness was considered and rejected as the test.** It describes what happens *when* you edit a Block, not how often, and adopting it would have the next slice adding chips for the wrong reason. DEPARTURE gains `20`/`21`; ARRIVAL gains `9A-VECTOR`; OVERFLIGHT gains `7A`/`9A-VECTOR`. Per-Role is what makes this safe — `20`/`21` are "Heading"/"Initial altitude" on DEPARTURE and radar scratchpads on the airborne Roles, which is exactly why they could not live in one shared list.

### §3.7 renders in the Block, bounded, with the guide's own overflow convention

Rule 2 wants the superseded value *in the same Block*, so this is not an expanded-view-only feature. The chip shows up to **two** prior entries struck through above the current value; beyond that a `*` indicator carries the count and opens the expanded view, which shows the unbounded chain. The indicator is only legal *because* that surface exists.

A Block with a single entry renders **nothing extra** — the common case must not sprout an empty container on every unamended Block of every Strip. `PREPLANNED` gets its own muted state rather than being folded into `SUPERSEDED`.

One new pure function, `annotationHistory(strip, blockId)`, beside the existing `activeAnnotationValue`/`hasActiveAnnotationEntry` and following their DOM-free discipline.

### The NLA button is pinned to its own row

`.efsp-nla-btn { margin-left: auto }` on a wrapping flex container put the primary affordance on whichever row it happened to land on — differing **between Strips in the same Bay**, by callsign length and which optional Blocks were populated. NLA is reached for without looking, so making its position a function of chip count would have made adding chips a net loss. The trailing controls now live in `.efsp-strip-actions` with `flex-basis: 100%`, the idiom the badges already use. This is part of this slice, not a follow-up: step 1 is not safe without it.

### Interactive state must survive a remote re-render — enumerated, not listed

The **bind and MARSA popovers were both missing from `_isProtectedStripEl`**, so another controller's board delta destroyed either one mid-interaction. That is the **third** time that list has been found incomplete; highlight, coordinate, TOFI and airspace were each added after the same bug.

Adding two entries fixes two instances of a class, so the test enumerates the class: it opens each popover in turn and asserts the Strip is protected. A seventh cannot repeat this without failing.

## Alternatives considered

**A per-Block popover instead of an expanded view.** Cheaper and reuses the popover pattern, but it only reaches Blocks that already have a chip — so it does not solve reachability at all.

**A `.set <block> <value>` dot-command only.** Smallest change, and §7.1 rule 5 makes dot-commands a primary surface. Rejected as the *only* answer: it leaves every annotation Block invisible, so a controller cannot read what is already there — which is most of what §3.7 is for.

**Adding the guide-required Blocks as chips too.** Nine more chips on a Strip already carrying seven badge slots. The expanded view reaches them at no height cost.

**History in the expanded view only.** Simpler, and it fails rule 2: a superseded value one click away is not "visible in the same Block".

**Teaching the source-scraping regex the new shape.** `efsp-ui-reachability.test.js` read the compact list out of `bay-view.js` with `body.match(/\['1',[\s\S]*?\]/)`. It is replaced by running the module in the existing vm sandbox and calling `compactBlocksFor(role)`. (`efsp-coordination-client.test.js` scrapes `AIRSPACE_ENTRY_POSITIONS` the same way; noted and deliberately left.)

## Consequences

- **Standing rule:** if an excuse list is ever reintroduced, every entry must name a surface with a file path. This slice exists because one did not.
- **Strips are taller.** More chips means fewer Strips visible per Bay, which is the mechanism behind the measured heads-down and Pending-bay problems. The hand-walk asks for the number before and after; if it drops by more than one, `20`/`21` move to the expanded view.
- §9.2's interlock is triggerable from the panel by a person for the first time.
- The `⌿` confirm-vacated button, which has existed since Phase 2, is exercised by a test for the first time — `stripAt()` always set `annotations: {}` and Block `21` had no chip to render it on.
- `confirmVacated` now dispatches against the live Strip, not the one its DOM was built against; it was the only cell action missing that stale-`baseRev` fix.
- Acting-position resolution is `_resolveActingPositionId` in all three former inline copies.
- The DOM stubs support `.class` in `querySelector`, which is what made `_isProtectedStripEl`'s `.efsp-block-input` check testable at all — it could not fire while the stub returned null.
- **Nothing here has been clicked.** Every claim is a wiring assertion against a DOM stub. The chip history, the overflow `*`, the expanded panel and the pinned actions row are all layout, and layout is exactly what these tests do not cover.
