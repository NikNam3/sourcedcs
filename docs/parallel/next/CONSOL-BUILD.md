# CONSOL-BUILD: the next controller takes the hat (lanes CONSOL-S and CONSOL-C)

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. The design is **ADR 0110** (`docs/adr/0110-consolidation-means-the-next-controller-takes-the-hat.md`,
> Proposed): read all of it, especially §1 to §9 and the walks table. Rulings: decisions.md **H104** (GCLC-1..4),
> S-WAVEB-4, and the answers to `docs/parallel/questions-consol.md` (Q-C1..Q-C3) once given. ADR 0105 and its lane note
> `docs/wip/GCLC.md` are the mechanism you generalise. VERSION's protocol rule applies (`npm run wire:record`).

| | CONSOL-S (server) | CONSOL-C (client) |
|---|---|---|
| Starts after | Q-C1..Q-C3 answered, **or** at once with the recommended lists (each answer is then a config-line follow-up) and supervisor items S1-S3 below decided | CONSOL-S's **wire commit** (step 5) |
| ADR | 0110 (Proposed): see S4 | none |
| Size / model | **1 lane** / Sonnet 5.5 | **0.6 lane** / Sonnet 5.5 |
| E2E lane | none | one `E2E_LANE` from the supervisor: new `consol-hat.spec.js`, plus `gclc-combine.spec.js` and `signon-reconnect.spec.js` re-run |
| Merge | S, then C right after it (the protocol bump lands with S, so a release needs both) | |

## What can start before the answers

Everything except the **contents** of three lists. The mechanism, the schema, the wire, the client, every test that
uses fixture configs, and the TACTICAL rename do not depend on Q-C1..Q-C3. Ship the recommended lists (ADR 0110 §1) in
the JSON files; an answer that differs is a one-line config change plus the shipped-config test and, if the carrier
order changes, the walk test for W6/W13/W14. Keep the shipped-config assertions in **one** test
(`efsp-facility-config.test.mjs`) so that follow-up touches one file.

## Supervisor items (decide before CONSOL-S's step 3)

- **S1. ADR 0105 decision 4 changes.** With LC or AP staffed, an NLA into an empty GC is **delivered to GC and offered**
  instead of inhibited (ADR 0110 §4). GC also returns to `consolidation` as `["LC", "AP"]`, which is 0105's offer under
  the new meaning, extended to AP (Q-C1). H104 GCLC-1 (b) says "remove the GC→LC consolidation link"; the behaviour it
  asked for (no Strip moves, LC offered GC, warn never block) is kept exactly. Confirm, or tell the human.
- **S2. Strict state.** The new `consolidation` shape makes an old `state/efsp-facility-*.json` copy invalid, which stops
  start-up (ADR 0095). No code writes these files. Before the deploy, check the server's `crc-sync-state` volume for
  them (`infra/RUNBOOK.md` line from CONSOL-S); there is no compatibility shim (lane rule: no backwards compatibility).
- **S4. ADR 0110 is committed as Proposed.** P4 says a committed ADR is never edited. Either the supervisor allows
  CONSOL-S to change its Status line to Built and append a "Differs from the draft" list (as 0105 has, from its wip
  draft), or CONSOL-S records the differences in `docs/wip/CONSOL-S.md` and the supervisor marks it.
- **S3. Names.** `handBack` (TACTICAL), `hatOffers` (Position entry), `offeredTo` (ack warning), `UNSTAFFED_RECEIVER`
  (mutation warning), `transfers.toUnstaffed` (metrics), `self.controllerId` (snapshot). Change them now or never.

## CONSOL-S owns

- Config: `crc-sync/config/efsp-facility-{incirlik,carrier,tactical}.json` (`center` unchanged);
  `src/efsp/facility-schema.js` (shape, `handBack`, the rewritten `consolidation:` note); `src/efsp/facility-config.js`
  (`getConsolidation` returns lists, new `getHandBack`, RANGES' derived config gets `handBack: {}`).
- `src/efsp/position-store.js`: `consolidatedAt` = first staffed list member (no walk); `handBackTo(id)`; the
  observer-promotion rule in `setSignedOnPositions` (ADR 0110 §3.1, finding F1); `hatOffersFor(positionId, strips)` or an
  equivalent pure helper; `getAll()` drops `consolidatedPositions`.
- `src/efsp/index.js` (one line: construct the store with both maps).
- `src/efsp/efsp-ws.js`: `staffingChanged` (no reassign for consolidation; warnings `offeredTo`; the offer frame and its
  directed send removed); positions serialised through **one** helper that adds `hatOffers` (today three call sites:
  ~318, ~443, ~648); the mutation path re-sends `positions` when the Facility's offers changed (before/after compare);
  `_snapshotMessage` gains `self`; `luawWhileCombined` reads the generalised list.
- `src/efsp/combination.js`: `NON_LOCAL` = `OPS, CD, GC, AP, SFA, PAR`; the AP/SFA/PAR wording (¶2-6-12); remove
  `offerAfterSignOff`, `GROUND`.
- `src/efsp/board/ops/transfer-strip.js`, `board/ops/carrier-handoff.js`: deliver to the unstaffed Position when
  `consolidatedAt` is staffed, warning `UNSTAFFED_RECEIVER`; `handBack` keeps routing. `board-store.js`:
  `reassignPositionStrips` called only for `handBack`; `returnConsolidatedStrips` unchanged (migration, ADR 0110 §9).
- `src/efsp/warnings.js` / `refusal-codes.js` (the new warning code); `src/efsp/metrics.js` (`toUnstaffed`; optional
  unstaffed-with-Strips minutes, only if under ~40 lines).
- `tools/soak/driver.js`, `tools/soak/report.js`: the stranded/hand-back path (`driver.js` ~620-635) becomes "waiting
  for the hat" (the driver's client at the target Position takes it after a think time, or the churn-back retakes CD);
  report fields renamed.
- Tests (below), `wire-surface.json`, `module-graph-exports.json` if exports change, the freeze goldens.
- `infra/RUNBOOK.md`: the S2 deploy check (one paragraph). `docs/wip/CONSOL-S.md`.

## CONSOL-C owns

- `crc-desktop/app/public/js/panels/efsp/panel/combination.js`: the offer rows derived from `positions[].hatOffers`
  where `self.controllerId` is Primary, plus the Observer prompt (an unstaffed Position this session observes);
  "Not now" per client, re-shown when the count grows; a self-vacated Position's offer hidden; Take = `efsp-set-positions`
  (adds the Position, or re-sends the same set for the Observer case). Callsigns of the offered Strips listed.
- `panels/efsp/combination-rules.js`: generalised non-local list and wording, Primary decided by `self.controllerId`;
  `offerText`/`offerStands` rewritten for standing offers.
- `panels/efsp/efsp-messages.js`: drop the `efsp-position-offer` handler; store `self` from the snapshot.
- `panels/radar-panel.js` (`renderPositionWarnings`, ~280): `offeredTo` wording; `routedTo` kept for hand-back.
- `panels/efsp/panel/refusal.js`: `UNSTAFFED_RECEIVER`. `panels/metrics-panel.js`: `toUnstaffed`.
- `efsp-panel.css`: severe offer style (reuse `.efsp-combination-severe`).
- Tests: `crc-desktop/tests/efsp-combination-rules.test.mjs`, `metrics-panel.test.mjs`; e2e below.
- Usage guide (owned by C, the client lane, as GCLC did): §8M rewritten as "Taking a hat" (every Facility), the
  Facility table at the top, §8K, §8L, §8F1's consolidation row, the line at ~918-922. `docs/wip/CONSOL-C.md` with the
  release-note line.

## Steps (CONSOL-S)

0. **Step 0**: re-find every file:line ADR 0110 cites on your base; list differences in the wip note. Run the unit suite
   once for a baseline count.
1. `refactor(CONSOL-S)`: schema + config loader + PositionStore list semantics, with `handBack` for TACTICAL. Behaviour
   identical except that no chain is walked transitively (prove with the existing tests; the shipped lists keep today's
   first hop).
2. `behaviour(CONSOL-S)`: `staffingChanged`, transfer/carrier routing, observer promotion, combination generalisation.
3. Shipped lists (recommended or answered), `hatOffers`, the mutation-path positions re-send, `self`.
4. Tests and walks (below). Then `npm run freeze:update`, listing every trace that moved, in the behaviour commit.
5. **Wire commit**: `npm run wire:record`, `wire-surface.json`. CONSOL-C is cut from here.
6. Soak driver/report, `npm run soak:selfcheck` (touches `efsp-ws.js` and `board/**`: required by CLAUDE.md).
7. RUNBOOK line, wip note, report.

## Tests that prove it

Server (`node --test`), new file `tests/efsp-consol-hat.test.mjs` unless noted; each walk is one test named by its W
number from ADR 0110 §8:

- Schema: list shape, unknown member, self in own list, repeat, a Position in both maps, `handBack` loop; a string value
  is refused with a message naming the fix (`efsp-facility-schema.test.mjs`).
- `consolidatedAt` is first-staffed, no walk; the lane symmetry (APP1↔APP2) is legal (`efsp-position-store.test.mjs`).
- Observer promotion by re-declaring (F1), and only when there is no Primary (`efsp-position-store.test.mjs`).
- W1, W2 (CD), W3 (LC with LUAW: the ack names it, the offer has `onRunway`), W4 (both orders give the same Board),
  W6, W7 (sign-on later), W8, W9, W11, W12 (grace expiry/takeover: extend `signoff-effects.test.mjs`), W13, W14
  (carrier, per the Q-C2 answer), W15, W17, W18 (undo re-sends positions).
- `hatOffers` appears in the snapshot, in the staffing re-send and in a mutation delta that changed offers, and not in one
  that did not.
- Combination warnings: LC+AP (normal and LUAW), LC+OPS, LC+RSU none, CD+GC none; `LUAW_WHILE_COMBINED` with AP
  (`efsp-gclc-combination.test.mjs`).
- TACTICAL hand-back unchanged (`efsp-scenario-tactical*.test.mjs` must pass with only the key renamed).
- Rewritten for the new meaning: `efsp-ws.test.mjs` (~260-318), `efsp-board-store.test.mjs` (~788-797, `routedTo`),
  `efsp-scenario-incirlik-l18.test.mjs` (~280, 303, 373: SFA/PAR/RSU warnings become `offeredTo`), `efsp-scenario-manning.test.mjs`,
  `efsp-facility-config.test.mjs`, `efsp-metrics-tap.test.mjs`, `efsp-metrics-contract.test.mjs`, `efsp-nla.test.mjs` and
  every other file `grep -ln "routedTo\|consolidatedFrom\|consolidatedPositions\|position-offer" tests/` lists (21 files at `4f6be7d8`; most only
  touch fixtures).
- Freeze: re-record (positions carry `hatOffers`); `npm run walk` (control release) must stay green.

Client (CONSOL-C):

- `efsp-combination-rules.test.mjs`: offers derived for Primary only, Observer prompt, self-vacated hidden, "Not now"
  re-shown on growth, severe on `onRunway`, AP wording.
- e2e `consol-hat.spec.js` (two controllers): CD leaves with a CLEARED Strip → GC's row appears → Take CD → Push works;
  LC leaves with a LUAW departure → AP's row is severe → Take LC → COMBINED line red; sign-on later shows the row; reload
  (reconnect) shows it again. `gclc-combine.spec.js` updated (offer is now standing). Run only these plus the boot smoke.

## Gates before the report

crc-sync full unit suite once, `npm run freeze` green after the update, `npm run walk`, `npm run soak:selfcheck` PASS,
`wire-protocol.test.mjs` green after `wire:record`; crc-desktop unit suite once and the specs above (never the full
Playwright suite, S-TEST).

## Size

Server ~1 lane: about 10 source files, mostly small edits; `staffingChanged` and the positions helper are the real work;
~21 test files touched, most for fixtures and field names; the soak driver change is the riskiest. Client ~0.6 lane:
one panel module rewritten, rules and tests, one spec, the guide sections.

## Status

**CONSOL-S built** (branch `lane/CONSOL-S-consol-s`, notes `docs/wip/CONSOL-S.md`). ADR 0110 is not edited (S4). Shipped lists are decisions.md
H111; S1 is built switchable (delete GC's line from `efsp-facility-incirlik.json`'s `consolidation`). CONSOL-C is not started; its file list is in
the wip note. `efsp-position-offer` is still sent beside `hatOffers` until CONSOL-C removes it.
