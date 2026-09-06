# 0024: Block labels in the compact Strip view

## Status

Accepted.

## Context

The guide's own §2 Defined Terms describes a Block Map as the per-Strip-Role
mapping from Block ID to field definition: "**label**, data binding,
provenance class, required/optional, editability, actions." Every
`DEPARTURE_BLOCK_MAP`/`ARRIVAL_BLOCK_MAP`/`OVERFLIGHT_BLOCK_MAP` entry in
`strip-template.js` (client) and `block-map.js` (server) had every one of
those except `label` — it was simply never added, since Phase 1.

In practice this meant reading a Strip required already knowing which bare
value corresponds to which field: `VADER11 / 001 0001 NONE LTAG DCT
INBOUND` gives no visual indication that `0001` is a squawk code, `LTAG` an
origin airport, `NONE` a track-degradation flag. Made worse by several
Block IDs meaning different things per role at the same visual position
(Block 7 is filed altitude for DEPARTURE/OVERFLIGHT but an annotation-routed
assigned altitude for ARRIVAL; Block 8 is the departure airport for
DEPARTURE but the origin airport for ARRIVAL) — a controller couldn't even
rely on a consistent meaning across roles once they'd memorized a position.

Found and raised directly by live testing during the ConvertToArrival work
(docs/adr/0023) — not a new problem, just newly annoying once Strips
started actually round-tripping real data on-screen.

## Decision

Add a short (≤8 character), always-visible, muted-uppercase label stacked
above each Block's value in the compact Strip view — no hover required, no
layout overhaul. Chosen over an inline `label: value` format or a
hover-only tooltip after a side-by-side preview comparison; the stacked
form is also the closest match to how real EFS/TFDM displays annotate
compact fields.

**Client-only.** `block-map.js` (server) is never used for display — only
validation/permission/routing — so it gets no `label` field, matching the
asymmetry `efsp-block-map-parity.test.js` already documents for `field`/
`flag` (client-only display/behavior extras the server has no use for).

Implementation:
- `strip-template.js`: a `label` string added to every entry across all
  three Block Maps (not just the ones currently shown in the compact view —
  cheap to do exhaustively now, so a future fuller-detail view needs no
  extra work). New `blockLabelFor(blockId, role)` export, a one-line lookup
  mirroring `resolveBlockValue`'s role-fallback shape.
- `bay-view.js`: the compact-view Block loop (`_buildStripEl`) wraps each
  `_buildBlockCell(strip, id)` result in a `.efsp-block-chip` span with an
  optional `.efsp-block-label` span in front of it, rather than modifying
  `_buildBlockCell` itself — its click-to-edit/enum-`<select>` internals
  needed zero changes.
- `efsp-panel.css`: `.efsp-block-chip` (inline-flex column) and
  `.efsp-block-label` (~8px, uppercase, muted, `line-height:1`) — the
  two-line chip fits within `.efsp-strip`'s existing 44px touch-target
  floor (§7.6 rule 4) with no other layout change.

Where a Block ID means the same thing across every role that has it, the
label is identical (`CALLSIGN`, `SQUAWK`, `RTE`, `RMKS`, `ARSPC`, `STATE`,
`NLA`, ...). Where it genuinely differs, each role's entry is labeled for
what it actually is there:

| Block | DEPARTURE | ARRIVAL | OVERFLIGHT |
|---|---|---|---|
| 7 | ALT (filed) | ALT (assigned, annotation-routed) | ALT (filed) |
| 8 | DEP | ORIG | ORIG |
| 8A | RWY (departure runway) | FIX (arrival fix) | *(no Block 8A)* |
| 8B | DEST | RWY (landing runway) | DEST |

**Deliberately out of scope**: the NLA button and the Offset/Coordinate/
Drop/Confirm-Vacated buttons get no label above them — their own button
text already says what they do in plain English, and a redundant label
above an already-self-explanatory button would be visual noise without
addressing the actual problem (cryptic bare *values*, not unclear
*actions*).

## Consequences

- `efsp-strip-template.test.js` gained a completeness invariant: every
  Block Map entry across all three roles has a non-empty label of 8
  characters or fewer, plus a couple of `blockLabelFor` lookup tests.
- No server-side (`crc-sync`) change, and no `efsp-block-map-parity.test.js`
  change — `label` joins `field`/`flag` in that test's already-documented
  client-only-extras exclusion list.
- 9A/9B/9C (DEPARTURE's three generic route-restriction annotation Blocks)
  all share the label `RESTR` — they're interchangeable scratch slots with
  no distinct meaning to tell apart by label, unlike ARRIVAL's `9A-FUEL`/
  `9A-DEST`/`9A-PTOUT`/`9A-VECTOR`/`9A-SPEED` split, which does have one.
