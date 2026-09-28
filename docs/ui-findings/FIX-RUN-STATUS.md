# Fix run — complete

A run to fix the catalogued UI findings (`docs/efsp-ui-findings.md` and
`docs/ui-findings/lane*.md`). Work was split across agents by file ownership,
with `bay-view.js` held by exactly one agent at a time.

**Nothing is committed.** All of it is in the working tree on
`efsp-wp5-correlation`.

## Where it ended

| suite | before | after |
|---|---|---|
| `cd crc-desktop && npm test` | 392 pass | **448 pass, 0 fail** |
| `cd crc-sync && npm test` | 1068 pass | **1101 pass, 0 fail** |
| `cd crc-desktop && npx playwright test` | 64 catalogued failures | **82 pass, 0 fail** |

Every entry in every findings file has been worked and its status updated in
place. **37 of the 38 numbered findings are fixed.** The one that is not is
F-004, which asks for a deployment decision rather than a fix and was
deliberately left alone. F-003 was a measurement, not a defect; it is answered,
and the density it complained about improved anyway (Bay 201→269 px, Strip
143→134 px).

## The three `test.fail` annotations that remain, all deliberate

The protocol in `docs/efsp-ui-findings.md` is that "expected to fail but passed"
is the signal to retire an annotation. 76 test instances were retired. Three stay:

- **`extends F-105: the ⌿ confirm-vacated button meets the touch floor`** — 32×44
  by design. A full 44 would reach onto Block 21's value cell, 2 px away, and
  steal its clicks.
- **`extends F-105: the * history overflow meets the touch floor`** — 26×32, same
  reason.
- **`F-208: the expanded view lists only Blocks it can show something for`** — the
  finding itself calls the Block-Map-order rows "taste or workflow, not a
  defect". The annotation now records a deliberate non-defect rather than an
  open bug.

Do **not** relax those assertions to make them green. The first two need a chip
layout change, which is a decision about what the panel must meet.

## Things worth knowing before working in here again

- **`_stripRenderSignature` is now the rule for redraws.** F-305 was fixed as a
  class: the signature covers everything `_buildStripEl` derives from outside the
  Strip record, and `_stripElNeedsRebuild` compares it. Anything new you derive
  from outside the Strip record must join the signature, or it will silently not
  repaint.
- **Popovers are portalled out of their Strip** and positioned `fixed` from JS.
  `_isProtectedStripEl` therefore keys on Strip id, not DOM containment —
  `el.contains()` cannot work any more. `.efsp-strip`'s `contain: layout style`
  is load-bearing for three separate things and must not be touched.
- **The NLA's inhibit status comes from the server** (`strip.nla`), with wording
  byte-identical to what the press returns, so there is one wording per reason.
  Four client-side gates were removed in favour of it.
- **Pointer capture happens at the drag threshold, not at pointerdown.** F-105's
  44×44 targets had quietly made most of a Strip undraggable, and the obvious fix
  was wrong — capture retargets `click` too, so dropping the cell guards would
  have made Blocks uneditable.
- **`flex: 1 1 0` on the Strip's reason/note sentences is load-bearing.** A
  content-sized sentence would break the trailing row onto a second line and take
  the NLA button with it.
- **The e2e suite shares one Board across spec files** and `ops-proposed` grows
  monotonically through a run. Several specs were failing on each other rather
  than on the behaviour they named. Four leaks were fixed; the underlying growth
  was not. A shared `afterEach` cleanup helper in `e2e/helpers/app.js` would fix
  the class, at the cost of touching every file in the suite.

## Open questions for a human

1. **F-005**, newly filed — a Strip with an unanswered proposal can never be
   retired by the side that proposed it. Needs a withdraw op or an expiry policy;
   which one is a doctrine question.
2. **Three wide state badges at once costs 50 px**, and the NLA button's vertical
   position then becomes a function of badge width. Should a Strip ever carry
   three?
3. **F-105's horizontal overhang eats the Strip's own left gutter.** The first
   chip on a wrapped row has no left neighbour, so aiming at the Strip's left
   edge to select it opens the CALLSIGN editor. Trimming it would break the
   44×44 criterion.
4. **F-401's placement call** — the refusal banner now sits below the Bay so it
   cannot displace Strips.
5. **F-102 read the config as authoritative** — a Bay with `impliesState` means
   that state, so a state-only NLA now moves the Strip. The finding noted the
   opposite reading was also available.
6. **F-103's refusal now lasts 30 s and is dismissible** rather than vanishing at
   6 s. Whether it should time out at all was labelled a workflow question.
7. **F-004** is untouched and still needs someone who knows the deployment.
