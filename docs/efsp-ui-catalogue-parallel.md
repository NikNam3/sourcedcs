# Running several cataloguing agents at once

Read **`docs/efsp-ui-catalogue-briefing.md` first** — it defines the role, the
harness, the two standing rules, the traps, and the recording format. This file
only adds what changes when more than one agent works at the same time.

Everything in the main briefing still applies, above all:

> **Catalogue. Do not fix.**

## Your lane

You will be told a **lane number**. It decides four things, and getting any of
them wrong means colliding with another agent working in the same checkout.

| Lane | Ports | Findings file | Spec prefix | Finding ids |
|---|---|---|---|---|
| 0 | 3010 / 3110 | `docs/efsp-ui-findings.md` | *(none)* | `F-0xx` |
| 1 | 3011 / 3111 | `docs/ui-findings/lane1.md` | `l1-` | `F-1xx` |
| 2 | 3012 / 3112 | `docs/ui-findings/lane2.md` | `l2-` | `F-2xx` |
| 3 | 3013 / 3113 | `docs/ui-findings/lane3.md` | `l3-` | `F-3xx` |
| 4 | 3014 / 3114 | `docs/ui-findings/lane4.md` | `l4-` | `F-4xx` |

**Run every command with your lane set:**

```bash
cd crc-desktop
E2E_LANE=2 npm run e2e
E2E_LANE=2 npx playwright test e2e/l2-popovers.spec.js
```

`E2E_LANE` moves the ports, the temp state directory and `test-results/`, all of
which two concurrent runs would otherwise overwrite for each other. **If you
forget it you will fight lane 0 for :3010 and your run will fail or, worse,
quietly interfere with theirs.** Lane 0 is the default, which is why it is the
one already-running agent's lane and not yours.

## Four rules that only exist because you are not alone

1. **Write only to your own files.** Your findings file, your `lN-`-prefixed
   specs, your screenshots under `docs/ui-findings/lN/`. Never edit another
   lane's findings file or specs, and never edit `docs/efsp-ui-findings.md`
   unless you are lane 0.
2. **Do not run `git commit`, `git add`, or any branch operation.** Several
   agents committing into one working tree corrupts each other's work. Write
   files; a human collects them.
3. **Do not touch shared files.** `e2e/helpers/app.js`, `playwright.config.js`,
   `package.json` and the existing specs are shared. If you need a new helper,
   **put it in your own spec file** and say in your report that it might belong
   in the shared helper. The one exception is a harness bug that blocks you
   from observing something at all — fix it, and say so loudly in your report.
4. **Screenshots go under `docs/ui-findings/lN/`** if you keep one, and are
   deleted otherwise. Do not leave throwaways in `e2e/`.

## Read the other lanes before you write

Before adding a finding, read **every** findings file that exists — yours,
`docs/efsp-ui-findings.md`, and any `docs/ui-findings/lane*.md`. Duplicates
across lanes are the main cost of running in parallel and they are expensive to
merge afterwards.

If you find something another lane has already recorded, **do not re-file it**.
If your case adds something real — a second surface it affects, a sharper
measurement, a worse consequence — add a line to *your* file that says
"extends F-0xx" and describes only the new part.

### The one that will dominate

**F-001: every popover is painted underneath the panel.** `contain: layout` on
`.efsp-strip` creates a stacking context, so `z-index` inside a Strip cannot
compete with anything outside it. It affects **all six popovers** and it is the
likely cause of most *"this control does nothing"* symptoms, because the click
lands on whatever is on top instead.

Until it is fixed, expect to keep meeting it. When you do: confirm it is the
same mechanism with `expectOnTop`, note the surface under "extends F-001", and
move on. **Do not open a new finding for each popover.**

## Lane scopes

Take the lane you were given and stay in it. Overlap wastes a whole agent.

### Lane 1 — popovers and overlays

Every popover: coordinate, TOFI, MARSA, bind, airspace entry, highlight. For
each: open it, `expectOnTop` the popover **and every control inside it**, check
it dismisses on an outside click and *not* on an inside one, and check what
happens when it is open and a board update arrives (`_isProtectedStripEl`).
Also the no-coverage overlay and the disconnect overlay: what do they cover, and
should they.

### Lane 2 — Block editing and the expanded view

Click-to-edit on every writable Block: Enter commits, Esc reverts, **blur must
do neither** (§3.7 rule 5 / §7.4 rule 2). The enum `<select>`, the boolean
toggle, the `⌿` confirm-vacated button. The `▼` expanded view: does it open,
close, survive a re-render, and show what it should. The `*` history overflow
and the struck-through amendments. Whether a Block that is refused says so.

### Lane 3 — coordination, TOFI and the mission line

`HANDOFF` / `POINT_OUT` / `TRAFFIC` / `OPERATIONAL_REQUEST` / `AIT` end to end
between `APP` and `CTR`. TOFI entry with the separation-regime picker, comms
transfer, exit, and the refusal when `SREG` is not back at `ATC`. The mission-line
bind picker and `.mission`. The `+N` shared-FDR badge. **This lane needs two
browser contexts** — most of these have two sides, and a one-sided walk misses
the half where the bug is.

### Lane 4 — layout, density and drag

Answer the number `docs/efsp-wp6-plan.md` asks for: *with six Strips in the
departure Bay, how many are visible without scrolling?* Measure it, then measure
it again with `20`/`21` removed from DEPARTURE's compact list. **Measure; do not
decide** — the plan already states what the number means.

Then: chip wrapping at narrow widths, the actions row, badge placement, what
happens to a Bay with thirty Strips, and drag-and-drop between Bays and Racks,
which has never been exercised outside a DOM stub.

## What to hand back

Per the main briefing, plus your lane number, and explicitly:

- **which findings you filed as "extends"** rather than new, and what they extend,
- **anything you hit that belongs to another lane** — name it and leave it; do
  not follow it, and do not file it,
- **any shared file you were tempted to change** and why you did not.
