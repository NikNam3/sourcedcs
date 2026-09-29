# Finishing the EFSP with many agents at once

The remaining work from `EFSPImplementationGuide.md` §13, cut into lanes that can run at the same
time without editing the same code, and the order to dispatch them in. Written 2026-09-29 at
commit `49e6bb2` (crc-sync 1151 tests, crc-desktop 488, ADRs up to `0059`; `0060` is the corrections ADR, so lane ADRs start at `0061` — see `docs/parallel/decisions.md` P4–P6).

Every agent reads, in order: **this file (its own lane only)**, `docs/efsp-briefing.md`, and for
WP6 lanes `docs/efsp-wp6-plan.md`. The WP6 plan's design decisions are settled; lanes implement
them and do not re-derive them.

---

## 1. How the agents are kept apart

### Two standing roles beside the lanes

Every wave runs with two extra roles.

- **The questioner** reads the lanes' briefings and the code and asks the questions a lane would
  otherwise stop on: design choices, product calls, squadron data, anything ambiguous. It writes
  them to `docs/parallel/questions-*.md` with a recommended answer each, and it keeps doing so as
  lanes report.
- **The supervisor** is the main session, because only it can talk to the human. It triages every
  question:
  - one with a sensible default, or one the code, the guide or an ADR already answers, it decides
    itself and records the decision in `docs/parallel/decisions.md`;
  - one that is really the human's call (product, squadron data, realism), it asks.

  It also takes the problems lanes report (a shared-file conflict, a blocking bug in another lane's
  area, a question that came up mid-work), decides or redistributes them, and merges lanes in order.

Lanes read `docs/parallel/decisions.md` before starting and whenever they are told it changed. A
lane that hits a question not answered there **writes it down, takes the recommended default, and
carries on**. It stops only when the default could destroy work or cross another lane's files.

### One worktree and one branch per agent

Each agent works in its own git worktree on its own branch, cut from the integration branch
(`efsp-wp5-correlation` today). Agents **commit on their own branch**. An integrator (a human, or
the main session) merges lanes back in the order below. Two agents never share a checkout, so
nobody overwrites anybody's files. The only collision left is a merge conflict, and §2 keeps those
small and mechanical.

A new worktree has no `node_modules`. Before running anything:

```bash
(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)
```

### What no agent does

- **Touch the running crc-sync on :3000.** It belongs to the human doing live testing. Agents
  verify with `npm test` and Playwright only.
- **Edit the shared docs:** `docs/efsp-briefing.md`, `docs/efsp-usage-guide.md`, `CLAUDE.md`, the
  crc-sync README. Each lane writes `docs/wip/<lane>.md` instead: what the guide should say, what
  the briefing should say, and the manual walk it could not do. The integrator folds these in once
  per wave, so the shared docs are rewritten once rather than merged ten times.
- **Take an ADR number or an e2e lane it was not given.** Both are assigned in the tables below.
- **Merge, rebase another lane's branch, or push.**

### Playwright lanes

`E2E_LANE=N` moves ports (`3010+N` / `3110+N`), the temp state directory and `test-results/`. Only
0–9 exist, and only one agent may hold a number at a time. Lanes that never need a browser get none.

---

## 2. The files more than one lane touches

These are the only places lanes can conflict. The rule for each is what keeps merges mechanical.

| File | Touched by | Rule |
|---|---|---|
| `crc-sync/src/efsp/index.js` | L1, L5, L14, L17 | **Registration only**: construct a store, add it to `_persist`/`_restore`. Append at the end of each block, never reorder |
| `crc-sync/src/efsp/efsp-ws.js` | L1, L14, L17 | A new dispatch path is a new `case` and a new `_handle…` method **appended at the end**. Snapshot: append one key |
| `crc-desktop/app/public/js/app.js` | L1b, L14, L15, L17 | new `ws.onmessage` cases appended at the end of the switch |
| `crc-desktop/app/public/index.html`, `dock.js` | L1b, L14, L15 | new `<script>` tags and dock-panel entries appended, one per lane |
| `crc-sync/src/efsp/block-map.js` + `tests/efsp-block-map-parity.test.js` | L2, L13, L17 | **serialised**: L2 in wave 1, L13 in wave 2, L17 in wave 3 |
| `crc-sync/src/efsp/nla.js` | L1, L13, L17 | **serialised**: L1 → L13 → L17 |
| `crc-sync/src/efsp/permission.js` | L1, L17 | serialised: L1 → L17 |
| `crc-sync/src/efsp/facility-config.js` | L1 (runway inventory), L13 (alert pad), L17 (CARRIER facility) | serialised by wave. Each edits its own facility's block |
| `crc-sync/src/efsp/fdr-store.js` | L2 (MTR paths), L16 (§10.5 chains) | different functions; L16 is wave 2 |
| `panels/efsp/strip-view.js` | L1b, L12, L13, L19 | **only through `_stripAlerts` / `_buildIndicator`** (ADR 0058's warnings-only rule): add a case, never restructure |
| `panels/efsp/strip-template.js`, `strip-fields.js` | L2, L13, L16, L17 | labels and field lists: append entries |
| `tests/efsp-ui-reachability.test.js` | L2, L13, L17 | append tests at the end; do not touch the harness |

Everything else a lane touches is new files, or files no other lane edits.

---

## 3. Dispatch order

```
PRE-WAVE ─ supervisor, before any worktree is cut
  F1  mission clock (in-game Zulu, ADR 0079) — decisions.md H11 — DONE, uncommitted
  commit plan + docs/parallel + briefings (S-Q1)

WAVE 1 ─ after F1, 11 agents, all independent
  L1  field state — server        ─────┐ (long pole)
  L2  MTR fields                   ─┐  │
  L3  ATO parser                  ─┐│  │
  L4  carrier model (pure)       ─┐││  │
  L5  WP8 metrics + traffic count │││  │
  L6  WP8 soak harness            │││  │
  L7  obligation-alert retraction │││  │
  L8  test debt + AIC/JTAC walks  │││  │
  L9  [SOURCE-DEFINED] inventory  │││  │   (read-only report)
  L10 IFF from interrogation      │││  │
  L11 atobrief USMTF export       │││  │   (atobrief only)
                                  │││  │
WAVE 2 ─ after L1 (and L2/L3/L5) merge, 6 agents
  L1b field state — client + hook mismatch   ◄── L1
  L12 ordnance HUNG advisory                 ◄── L1
  L13 alert / scramble                        ◄── L1, L2
  L14 ATO binding + AR join                   ◄── L3
  L15 metrics dashboard                       ◄── L5
  L16 9F picker + §10.5 fallback chains       ◄── L2
                                  │
WAVE 3 ─ after wave 2 merges, 3 agents
  L17 carrier roles + CARRIER facility        ◄── L4, L13  (solo on the core files)
  L18 Incirlik RSU / SFA / PAR               ◄── L17 roles (can start its client half alongside)
  L19 §10.3 suggestion chip + §10.4 staleness ◄── L1b (strip-view)
                                  │
WAVE 4 ─ last, 1 agent + integrator
  L20 [SOURCE-DEFINED] audit fixes            ◄── everything
  Integrator: docs rewrite, full e2e, live sortie walks
```

In total: **21 lanes, up to 11 at once**. Wave 1 is the widest because most of the remaining work
does not touch the core yet. The core files (`nla.js`, `block-map.js`, `permission.js`) are why
the later waves narrow: those files are handed from lane to lane in order, never shared at once.

---

## 4. The lanes

Each lane lists its **scope**, **what it owns** (new files, or edits only it makes), the **shared
files** it touches under §2's rules, and its **acceptance** criteria. An agent's report back must
state its test counts, the ADR it wrote, and its `docs/wip/<lane>.md`.

### Wave 1

**L1 — Field state, server (§9.7).** ADR `0061`. No e2e lane.
- Scope: `docs/efsp-wp6-plan.md` Phase 3, ordering steps (1)–(5): config and pure module, the store
  (barrier family), wiring and permission, NLA inhibits, the runway-change machine.
- Owns: new `src/efsp/field-state-store.js`, `src/efsp/field-state.js`,
  `tests/efsp-field-state.test.mjs`, `tests/efsp-scenario-field-state.test.mjs`.
- Shared: `facility-config.js` (runway inventory in INCIRLIK's `DEFAULT_CONFIG`), `nla.js`,
  `board-store.js` (`_nlaCtx` only), `permission.js`, `index.js`, `efsp-ws.js`.
- Acceptance: §13's two acceptance lines asserted word for word, the D21 case in
  `efsp-permission.test.mjs`, and a crc-sync restart mid-suspension coming back `SUSPENDED`.
- Leaves the client (step 6) and `3F` (step 7) to L1b. Send nothing new to the client except the
  delta message; the panel is L1b's.

**L2 — MTR fields (§9.4).** ADR `0062`. E2E lane 2.
- Scope: WP6 plan Phase 6: `9G-*`/`9H-*` Blocks on the three ATC Roles, `WRITABLE_PATHS`, the
  `MILITARY_BLOCK_NAMESPACE` rows, client labels and placement (Layout C's per-Position field grid,
  ADR 0056; `M11`'s exit fix and time placed prominently), and the lost-comms rule as a rendered
  advisory.
- Shared: `block-map.js`, the parity test, `fdr-store.js` (`WRITABLE_PATHS`), `strip-template.js`,
  `strip-fields.js`, reachability tests.
- Acceptance: parity and reachability green; a pilot walk of *"request a different exit fix"*
  written up in `docs/wip/L2.md`.

**L3 — ATO parser (§9.9, part 1).** ADR `0063`. No e2e lane.
- Scope: a pure parser for USMTF-style ATO sets, and the mapping to FDR seeds and `fdr.military`
  per §9.9's table. **No wiring into the Board.**
- Owns: new `crc-sync/src/efsp/ato/` (parser, mapping), fixtures, `tests/efsp-ato-*.test.mjs`.
- Acceptance: WP7's first bullet against a fixture (mission number, package, vul window,
  controlling agency, IFF codes). The community-source caveat goes in the module header, as §9.9
  requires.

**L4 — Carrier model, pure (WP7A, part 1).** ADR `0064`. No e2e lane.
- Scope: the marshal stack as a pure module (the stack index drives angels, DME and push time),
  Case as a value, computed final bearing, and the ship-state record. A design ADR for how
  MARSHAL/FINAL/PATTERN and the CARRIER facility will wire in, which L17 then implements.
- Owns: new `crc-sync/src/efsp/carrier/`, its tests.
- Shared: none. **Do not add the facility or the Roles yet**: that is L17, after the core files are
  free.
- Acceptance: WP7A's first, second and fifth bullets (renumbering in one operation; nothing
  independently editable; bearing computed), as unit tests.

**L5 — WP8 metrics and traffic count (§11.3–§11.5, server).** ADR `0065`. No e2e lane.
- Scope:
  - the §11.5 metric set collected server-side, from the Mutation log, correlation stats,
    obligation monitor and transfer results;
  - the §11.4 traffic count from `DROPPED` Strips (local, transient, formation, SUA traversal,
    alert scramble);
  - §11.3 Mutation-log retention as config (default 30 days);
  - a read endpoint or WS message for L15.
- Owns: new `src/efsp/metrics.js`, `src/efsp/traffic-count.js`, tests.
- Shared: `index.js` (registration), `mutation-log.js` (retention).
- Client-side metrics (search invocations, time-to-find, inputs per gesture) belong to L15. Here,
  only define the message shape they will send.

**L6 — WP8 soak harness.** No ADR (tooling). No e2e lane.
- Scope: a driver that runs crc-sync's EFSP stores under simulated traffic (Strips created,
  advanced, coordinated, dropped; correlation churning). It runs for N minutes and reports memory,
  order-key growth and dropped Mutations. A four-hour run is the §13 acceptance criterion; the
  default run is ten minutes.
- Owns: new `crc-sync/tools/soak/`. Nothing else.

**L7 — Obligation alerts retract.** ADR `0067` (it changes what `0021` decided; per P4 that is a new ADR, never an Update to `0021`). No e2e lane.
- Scope: the briefing's known gap (forwarding-obligation alerts never clear). Move them to the
  correlation-warning shape (ADR 0045): state on a record that is broadcast whole, so clearing is
  just the next message.
- Shared: `forwarding-obligations.js`, the obligation part of `efsp-state.js`, `ws-hub.js`'s
  obligation broadcast.

**L8 — Test debt and the unwalked Positions.** No ADR. No e2e lane.
- Scope:
  - migrate the two hand-maintained DOM stubs to `tests/helpers/dom-stub.js`;
  - replace `efsp-coordination-client.test.js:77`'s regex scrape;
  - scenario tests that drive a Strip through `AIC` and `JTAC` (never exercised).
- Tests only. If a scenario finds a bug, **record it in `docs/wip/L8.md` and do not fix it** —
  the bug's owner lane fixes it.

**L9 — `[SOURCE-DEFINED]` inventory (read-only).** No ADR. No e2e lane.
- Scope: WP6 plan Phase 7, steps 1–3, **as a report only**: every marked item, and every piece of
  UI text or documentation that presents one as doctrine, with file:line.
- Writes only `docs/wip/L9-source-defined-inventory.md`. L20 applies the fixes last, because every
  other lane will add to the list.

**L10 — IFF from interrogation, not coalition.** ADR `0066`. No e2e lane.
- Scope: ADR 0059's open item. Auto-IFF (`surveillance/iff.js`) classifies from what an IFF
  interrogator would get (Mode 4/5 from SRS `mode4`, the synthetic transponder, and radar
  `caps.ssr`) rather than the DCS coalition. Per session, like the rest of the presentation.
- Owns: `crc-sync/src/surveillance/iff.js`, `presentation.js` (the IFF part), their tests. No EFSP
  files.

#### L11 — atobrief exports its ATO as USMTF (ADR 0078)
- **Scope:** `atobrief` only. A pure `usmtf-ato.js` (renderer + mapper, browser and Node), `GET /api/rooms/:id/ato.usmtf`, stateless `POST /api/usmtf`, a USMTF option in the EXPORT dialog. Exports only fields atobrief stores today (A1 default); missing fields become `-` with a warning.
- **Owns:** everything new under `atobrief/`; the trimmed, anonymised `ojw1v5` fixture and its USMTF export for L3 (H16).
- **Shared files:** none in crc-sync or crc-desktop.
- **Acceptance:** semantic equality with the research fixture, exact equality with its own committed output; briefing `docs/parallel/wave1/L11.md`.

#### L21 — coalition isolation (planned, H14; timing is Decision Desk C1)
- Both coalitions controlled at once on one server, each unaware of the other: per-session coalition, and EFSP stores, alerts, tags, declarations, datalink and presence all scoped by it. Design ADR first. Default slot: solo, right after wave 1 merges.

### Wave 2 — dispatch when L1 has merged (L13 also waits for L2, L14 for L3, L15 for L5, L16 for L2)

**L1b — Field state, client, and the hook mismatch (§9.7 steps 6–7).** ADR `0068` (its own; a merged ADR is never amended). E2E lane 1.
- Scope: the field-state dock panel (its own panel, **not** the `ops-field-state` Bay; see the WP6
  plan), the inhibit reason on the Strip, and `gearMismatchFor` computed from `3F` and the runway's
  gear, shown as an indicator.
- Owns: new `panels/efsp/field-state-panel.js`, its client test.
- Shared: `app.js`, `index.html`, `dock.js`, `efsp-state.js`, `strip-view.js` (`_stripAlerts`
  only).
- Acceptance: the WP6 plan's Phase 3 manual walk, done in Playwright, with screenshots in
  `docs/wip/L1b/`.

**L12 — Ordnance `HUNG` (§9.5).** ADR `0069`. E2E lane 3.
- Scope: WP6 plan Phase 4. An advisory on runway assignment, and the hot-cargo pad as a routing
  constraint read from field-state config. No taxi-distance computation (there is no geometry for
  it).
- Shared: `field-state.js` (a pure function added to L1's module), `strip-view.js`
  (`_stripAlerts`).

**L13 — Alert and scramble (§9.6).** ADR `0070`. E2E lane 4.
- Scope: WP6 plan Phase 5. Pick `M16`'s Block id, add the board-wide `SCRAMBLE` indication, and
  flag Strips in ground states at the Facility, with **no** inhibit and **no** reordering (the
  guide's `[GAP]`, binding). Alert-pad config goes in the field-state inventory.
- Shared: `block-map.js` + parity, `nla.js` (`CLEARED`'s comment becomes a flag, not an inhibit),
  `facility-config.js`, `efsp-panel.js` (the board-wide indication), `strip-view.js`.

**L14 — ATO into the Board (§9.9, part 2).** ADR `0071`. E2E lane 5.
- Scope:
  - an import path (panel action or file drop) that creates `MISSION` Strips from L3's parser,
    through the existing mission-line `CreateStrip` (ADR 0054);
  - ATO↔Strip binding on Mode 3/A;
  - a tanker's AR line joined with its receivers' Strips. The join sits beside MARSA but is **not**
    MARSA: rendering the join must not declare anything.
- Shared: `efsp-ws.js` (a dispatch path if one is needed), `efsp-panel.js`, `app.js`.
- Acceptance: WP7's three bullets.

**L15 — Metrics dashboard, client (§11.5).** ADR `0072`. E2E lane 6.
- Scope: a dock panel showing L5's metrics and traffic count, plus the client-side measurements:
  search invocations, time-to-find after entering a Bay, inputs per gesture.
- Owns: new `panels/metrics-panel.js`.
- Shared: `app.js`, `index.html`, `dock.js`, and small hooks in `efsp-panel.js` (search) and
  `bay-view.js` (selection timing). Append only.

**L16 — Block `9F` picker and the §10.5 fallback chains.** Bugfix plus ADR `0073`. E2E lane 7.
- Scope:
  - `9F` becomes a `<select>` of the configured stereo routes, replacing free text (ADR 0050's
    follow-on);
  - §10.5's ordered fallbacks for departure, off-block and takeoff time, with the chosen source
    shown on hover. Check what `fdr-store.js:382` already records first.
- Shared: `strip-template.js`, `fdr-store.js`.

#### L22 — ATC scope in the STARS scheme (H5, H41)
- Variant B of `docs/parallel/research/stars-mockups.html`: `scheme` per contact in `presentation.js` (radar types classified in `sensor-specs.json`), position letters in facility config, coast hold, FDB/PDB/LDB by relation to the viewer, handoff/point-out blink, and a per-user "ATC map background" toggle giving the strict (A) look. Client work lives in `track-label.js` plus the map layers.
- Waits for L10 (both edit `presentation.js`/`ws-hub.js`) and L1b (strip-view). ERAM for CTR is a later lane.

### Wave 3 — dispatch when wave 2 has merged

**L17 — Carrier Roles and the CARRIER Facility (WP7A, part 2).** ADR `0074`. E2E lane 8.
- Scope: L4's design wired in:
  - the four CV Positions;
  - the `MARSHAL`/`FINAL`/`PATTERN` Roles through `STATES_BY_ROLE`, the Block Maps,
    `INELIGIBLE_STATES` (a test forces this decision), `permission.js` and `facility-config.js`;
  - Case as broadcast state and the four transfer kinds;
  - the client.
- **The only lane in its wave allowed on `nla.js`, `block-map.js` and `permission.js`.**

**L18 — Incirlik `RSU`, `SFA`, `PAR` (§4.1, §4.7).** ADR `0075`. E2E lane 9.
- Scope: the three Incirlik Positions the config still lacks, and SFA's frequency-rotation transfer.
  They use the `PATTERN` and `FINAL` Roles.
- Depends on L17's Roles. Start the client half (pattern board, the `FINAL` component shared with
  PAR) alongside L17, and the server half after L17 merges.

**L19 — Surveillance informs, the controller advances (§10.3, §10.4).** ADR `0076`. E2E lane 1 (L1b is done by then).
- Scope: first, decide in the ADR what "detected airborne" means (ADR 0047 left it open on
  purpose). Then:
  - the suggestion chip, one input to accept;
  - staleness detection: a Strip whose state contradicts its correlated track for longer than a
    threshold gets a low-severity indication, and each occurrence is logged for L5's metric.
- **Nothing may move a Strip.** The existing test asserting that stays green.

### Wave 4 — last

**L20 — `[SOURCE-DEFINED]` audit, fixes.** ADR `0077`. No e2e lane.
- Scope: apply L9's inventory, plus everything the other lanes added since. This is the §13
  acceptance criterion. It edits comments and UI text everywhere, which is why it runs alone.

**Integrator, between every wave and at the end:**
- merge the lanes in the order listed;
- run both unit suites and the full Playwright suite;
- restart the local crc-sync;
- fold `docs/wip/*.md` into the usage guide and briefing, and rewrite the briefing as the next
  handoff;
- walk the sorties and pilot requests by hand. This is where `0049` and `0050` found their
  defects, and no lane can do it for you.

---

## 5. Not for agents

- `Unit:getRadar()` returning a lock target (ADR 0059): needs a live DCS mission.
- Magnetic vs grid heading: a decision for you first, then work.
- Terrain / MSAW: waits for AIRAC data.
- The per-Position radar defaults and the stereo-route table: squadron data.
- The two-controller walk of Layout C's worst cases, and the D12 walk of TAC_C2 + CTR in the
  rendered UI: people at two screens.
