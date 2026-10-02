# The next code lanes after the refactor and L20: dispatch, ownership, merge order

Base: `efsp-wp5-correlation` at or after `99c9577` (S-L20-DONE), once the sharded Playwright run S-L20-DONE asked for
has finished. Rulings: `docs/parallel/decisions.md`. **decisions.md wins over every briefing here, and the merged code
wins over a briefing's line numbers.** Conventions: `docs/parallel/refactor/README.md` (worktrees, install, step 0,
the Test policy S-TEST, the report) and `docs/parallel/lane-rules.md`, both in full, except where this file says the
window is closed.

## What changed since the refactor briefings

- **The refactor window is closed** (S-M-BACKCOMPAT). Behaviour lanes do not maintain the goldens. `npm run freeze` is
  opt-in: a lane may use it as an identity proof, and may re-record with `npm run freeze:update` **in its behaviour
  commit**, listing every trace that moved (S-desk3, L20-STR did this in `3658c14`). There are no structural or
  behaviour approvals per commit any more. A lane still separates `refactor(<LANE>)` from `behaviour(<LANE>)` commits,
  so the supervisor can review and drop them one at a time.
- **The vocabulary is the glossary's** (`docs/glossary.md`, rename-map §3-§5): flight data, strip type, staffed,
  signed on, consolidated at, runway status, LC/GC/AP, CA, INITIATED.
- **Wire protocol** (from VERSION on): once VERSION has merged, every lane that changes the wire runs
  `cd crc-sync && npm run wire:record`. It bumps `WIRE_PROTOCOL` in both copies only when the current number has
  already shipped. For lanes cut before VERSION merged (UNDO-S, AIRSP-2S-A, AUDIT-GAPS), the supervisor runs it at
  their merge.
- **Release-note lines** go in each lane's wip under "Release note". The supervisor folds them into
  `crc-desktop/build-assets/release-notes.md`. No lane edits that file.
- **E2E**: never the full suite in a lane (S-TEST). A lane runs the boot smoke plus the specs it changed or the panels
  it touched, one file at a time, on its own `E2E_LANE`. The supervisor runs the sharded suite
  (`npm run e2e:sharded`) on lanes no running agent holds, once after BRIDGE + ESM-GUARDS merge, and after each batch
  of client feature halves.

## Briefings

New, in this folder:
[VERSION](VERSION.md) · [MAPKEY](MAPKEY.md) · [BRIDGE](BRIDGE.md) · [ESM-GUARDS](ESM-GUARDS.md) ·
[DATA-3](DATA-3.md) · [AUDIT-GAPS](AUDIT-GAPS.md) · [WIRE-B](WIRE-B.md) · [SYNC-B](SYNC-B.md) (SYNC-B-S, SYNC-B-C).

Already briefed, in `docs/parallel/post-refactor/`, not rewritten here. H100 is applied in each one.
[UNDO](../post-refactor/UNDO.md) (UNDO-S, UNDO-C) · [SPLIT-JOIN](../post-refactor/SPLIT-JOIN.md) (SJ-S, SJ-C) ·
[CONTROL-RELEASE](../post-refactor/CONTROL-RELEASE.md) (CR-S, CR-C) · [TOFI-REGIME](../post-refactor/TOFI-REGIME.md) ·
[AIRSP-2-server](../post-refactor/AIRSP-2-server.md) (2S-A, 2S-B) · [AIRSP-2-panel](../post-refactor/AIRSP-2-panel.md)
(2P-A, 2P-B) · [AIRSP-2-web](../post-refactor/AIRSP-2-web.md) (2W).

**Running now** (S-L20-W1): AIRSP-2W, and AIRSP-2P-B step 1 (the mockup for the human, DA-8).

## One dispatch table (cap 10 agents, including one Opus questioner per wave)

Sizes are in lanes (1 ≈ a full lane-length). Model: Sonnet 5.5 for code. Opus is used only where a briefing says the
lane designs a contract others follow (UNDO-S). "Cut from" means the worktree's base. Lanes never merge or rebase
(lane-rules 4); the supervisor merges in the order of the next section.

| Lane | Size / model | Side | Wave | Start when | Cut from | E2E | Merges after |
|---|---|---|---|---|---|---|---|
| **AUDIT-GAPS** | 0.75 / Sonnet | server | A | now | dev tip | – | nothing; **first in wave A** |
| **DATA-3** | 1 / Sonnet | server | A | now | dev tip | – | AUDIT-GAPS (no overlap; any order) |
| **VERSION** | 1.25 / Sonnet | both + CI | A | now | dev tip | 3 | – |
| **BRIDGE** | 1 / Sonnet | client e2e | A | now | dev tip | 1 | – |
| **ESM-GUARDS** | 1 / Sonnet | client | A | now (partitioned from BRIDGE) | dev tip | 2 | BRIDGE (shared fixture JSON) |
| UNDO-S | 1.5 / **Opus** | server | A | now | dev tip | – | AUDIT-GAPS |
| AIRSP-2S-A | 1.5 / Sonnet | server | A | now | dev tip | – | – |
| AIRSP-2W | 1.25 / Sonnet | web | running | – | – | – | integration check after 2S-B |
| AIRSP-2P-B mockup | (step 1 of 2P-B) | design | running | – | – | – | human approval |
| **MAPKEY** | 0.5 / Sonnet | both | A (first free slot) | 2P-B's mockup handed over | dev tip | 4 | VERSION (one shared line in `sync.js`) |
| SJ-S | 1.25 / Sonnet | server | B | UNDO-S's contract commit (UNDO.md step 1) | that commit | – | UNDO-S |
| CR-S | 1.5 / Sonnet | server | B | UNDO-S's contract commit **and** AUDIT-GAPS merged (`board/coordination.js`) | dev tip after AUDIT-GAPS + the contract commit merged in | – | UNDO-S |
| **WIRE-B** | 0.75 / Sonnet | both | B | VERSION merged | dev tip | 3 | VERSION |
| AIRSP-2S-B | 0.75 / Sonnet | server | B | any free slot (codes against ADR 0098's interface) | dev tip | – | 2S-A |
| TOFI-REGIME | 1 / Sonnet | server, then client | B | AUDIT-GAPS merged (`board/tofi.js`). Server part first, with the 2S-A stub. Client commits only after BRIDGE + ESM-GUARDS merged | dev tip | 0 | 2S-A **and** CR-C |
| UNDO-C | 0.5 / Sonnet | client | C | UNDO-S's wire commit, **and** BRIDGE + ESM-GUARDS merged | the wire commit, then dev merged in by the supervisor | 5 | UNDO-S |
| AIRSP-2P-A | 1 / Sonnet | client | C | BRIDGE + ESM-GUARDS merged (end-to-end checks after 2S-A merges) | dev tip | 8 | 2S-A |
| AIRSP-2P-B code | 1.1 / Sonnet | client | C | mockup approved **and** BRIDGE + ESM-GUARDS merged | dev tip | 9 | 2P-A |
| SJ-C | 0.5 / Sonnet | client | C | SJ-S's wire commit + BRIDGE/ESM-GUARDS merged | the wire commit | 6 | SJ-S |
| CR-C | 1 / Sonnet | client | C | CR-S's wire commit + BRIDGE/ESM-GUARDS merged | the wire commit | 7 | CR-S |
| **SYNC-B-S** | 1 / Sonnet | server | C | WIRE-B, 2S-A and UNDO-S merged | dev tip | – | WIRE-B |
| **SYNC-B-C** | 0.75 / Sonnet | client | C | SYNC-B-S's wire commit | that commit | 4 | SYNC-B-S |

### Slot plan

| | Wave A | Wave B (rolling fill) | Wave C (rolling fill) |
|---|---|---|---|
| Lanes | AUDIT-GAPS, DATA-3, VERSION, BRIDGE, ESM-GUARDS, UNDO-S, 2S-A (7) + running 2W, 2P-B mockup (2) | UNDO-S and 2S-A continuing; SJ-S, CR-S, WIRE-B, 2S-B, TOFI-REGIME (server), MAPKEY (if not yet) | UNDO-C, 2P-A, 2P-B, SJ-C, CR-C, TOFI-REGIME (client), SYNC-B-S, then SYNC-B-C |
| Questioner (Opus) | 1 | 1 | 1 |
| Peak | 10 | ≤ 10 | ≤ 10 |

**Fill order when a slot frees** (critical path first):

1. SJ-S and CR-S as soon as UNDO-S's contract commit lands. The UNDO-S → SJ-S/CR-S → CR-C → TOFI-REGIME chain is the
   longest.
2. MAPKEY.
3. WIRE-B (when VERSION has merged).
4. AIRSP-2S-B.
5. TOFI-REGIME's server part.
6. The client halves, in the order UNDO-C, 2P-A, CR-C, SJ-C, 2P-B. Each needs BRIDGE and ESM-GUARDS merged and its own
   server wire commit (2P-A and 2P-B code against ADR 0098 and need no server commit to start).
7. SYNC-B-S, then SYNC-B-C.

The questioner reads each lane's step-0 note ("Code as found" plus the design notes) and challenges it against this
README, the briefing, decisions.md and the code, before the lane writes production code. Lanes keep their defaults
meanwhile (P2) and answer each point in their wip.

### The dependency chains (why the table is ordered this way)

- **UNDO-S → SJ-S / CR-S** (the undo contract every one-click op declares, ADR 0100). → **CR-C → TOFI-REGIME** (both
  touch the coordination exchange rows; CR-C merges first).
- **AIRSP-2S-A → 2S-B, TOFI-REGIME** (ADR 0098's registry and `airspace/containment.js`), **→ SYNC-B-S** (the airspace
  store's seq and snapshot change shape in 2S-A).
- **VERSION → WIRE-B → SYNC-B-S → SYNC-B-C**: all three edit `ws-hub.js`'s connect and tick area. VERSION also makes
  the protocol bump of the other two mechanical.
- **Server halves before client halves**: every client half is cut from its server lane's wire commit.
- **BRIDGE and ESM-GUARDS before every client feature half.** ESM-GUARDS rewrites guard lines in `strip-view.js`,
  `bay-view.js`, `bay/**`, `efsp-messages.js` and about 40 more files, which the client halves edit next. BRIDGE moves
  every spec, and the client halves add specs. Starting a client half before both merge would mean resolving
  hundreds of hunks.
- **AUDIT-GAPS before UNDO-S merges and before CR-S/TOFI-REGIME start**: it edits `board-store.js` (system audit
  records), `board/coordination.js` and `board/tofi.js` (duplication, PeerGone record) and two op files (`covering`
  locals). UNDO-S owns the facade and the op files' `undo` key next, CR-S owns `board/coordination.js`, and
  TOFI-REGIME owns `board/tofi.js`.

## File ownership: where two lanes meet

Every briefing's "Owns" is exact. These files are touched by more than one lane, at hunk level, in different functions.
The listed order is the merge order. The supervisor resolves the (one-line) conflicts.

| File | Lanes, in merge order | What each touches |
|---|---|---|
| `crc-sync/src/ws-hub.js` | VERSION → WIRE-B → SYNC-B-S; TOFI-REGIME | `attach`/`_admit` → `_tick` heartbeat `boards` → `_tick` `stores`; the efsp-alerts compose line |
| `crc-sync/src/efsp/efsp-ws.js` | AUDIT-GAPS → UNDO-S → WIRE-B → SYNC-B-S | SetPositions' `covering` local → Board-path ack → snapshot aliases → snapshot maps and resync `stores` |
| `crc-sync/src/efsp/board-store.js` | AUDIT-GAPS → UNDO-S | the two `SystemReassign` record blocks → facade delegation and option |
| `crc-sync/src/efsp/board/coordination.js` | AUDIT-GAPS → CR-S | replica mint, degradation check, PeerGone record → HANDOFF actions and mirrors |
| `crc-sync/src/efsp/board/tofi.js` | AUDIT-GAPS → TOFI-REGIME | replica mint and degradation check → pending regime and MARK_ENTERED |
| `crc-sync/src/efsp/board/ops/{transfer-strip,carrier-handoff}.js` | AUDIT-GAPS → UNDO-S | `covering` locals → `undo` declaration |
| `crc-sync/src/efsp/metrics.js` | UNDO-S, 2S-A, then the supervisor's DATA-3 `DAY_MS` one-liner | counters → op classification → the import |
| `crc-sync/src/efsp/authority/positions/*.js` | 2S-A → SJ-S, CR-S, TOFI-REGIME | airspace rows → formation, release and MARK_ENTERED grants. AUDIT-GAPS uses a new `authority/narrowing.js` instead |
| `crc-sync/src/efsp/{carrier,marsa}-store.js` | UNDO-S → SYNC-B-S | undo restore ops → the `SyncLog` epoch option |
| `crc-sync/src/efsp/stores.js` | 2S-A → SYNC-B-S | the airspace entry → the six `sync` declarations |
| `crc-sync/src/grpc-client.js` | DATA-3, 2S-B (any order) | weather reference and ISA import → `_getDrawings` |
| `crc-sync/src/app.js` | MAPKEY, 2S-B, TOFI-REGIME (any order) | the `/api/client-config` route → the airspace service mount and calendar ticker → the `tofi-regime` ticker |
| `crc-sync/.env.example`, root `.env.example`, compose | VERSION, MAPKEY, 2S-B | one line each |
| `crc-desktop/app/public/js/sync.js` `getSyncFeedUrl` | VERSION → MAPKEY | query parameters → one `loadMaptilerKey()` call |
| `crc-desktop/tests/module-graph.test.mjs` and `fixtures/module-graph-exports.json` | BRIDGE → ESM-GUARDS | the bridge section and test 7 → the two `todo` lines (and `app.js`'s export row, optional) |
| `crc-desktop/app/public/js/panels/efsp/**` (strip-view, bay popovers, efsp-state, efsp-ws) | ESM-GUARDS → WIRE-B → UNDO-C, CR-C, SJ-C, TOFI-REGIME, 2P-A, 2P-B → SYNC-B-C | guards → heartbeat gap → features → store sync |
| `docs/efsp-usage-guide.md` | UNDO-C → SJ-C → CR-C → TOFI-REGIME (one section each) | as their briefings say |
| `CLAUDE.md` | VERSION (one paragraph, one env row), MAPKEY (one env row) | – |
| `infra/RUNBOOK.md` | VERSION, MAPKEY (one section each) | – |

## Merge order

1. AUDIT-GAPS
2. DATA-3
3. VERSION
4. BRIDGE, then ESM-GUARDS. **Sharded Playwright** (the supervisor's).
5. MAPKEY
6. UNDO-S (+ `wire:record`; + DATA-3's `metrics.js` one-liner)
7. AIRSP-2S-A (+ `wire:record`)
8. SJ-S, CR-S (either order)
9. WIRE-B
10. AIRSP-2S-B, then AIRSP-2W's integration check
11. UNDO-C, AIRSP-2P-A, AIRSP-2P-B, SJ-C. **Sharded Playwright.**
12. CR-C, then TOFI-REGIME
13. SYNC-B-S, then SYNC-B-C. **Sharded Playwright.**

A lane that finishes early waits for its turn. A lane whose merge would break the order goes to "main", and the
supervisor decides. Before any prod deploy, the human is asked (R3-79). VERSION's gate refuses a crc-sync whose
protocol the published client does not speak.

## Not briefed: needs the human first

| Item | Source | Options | Recommendation |
|---|---|---|---|
| The soak without the surveillance-hint monitor and the airborne observer | S-APP0 ("enabling it is a later approved behaviour commit"), SOAK/SOAKW | (a) wire `surveillanceHints` and the airborne observer into the soak host through `createApp`. The soak then exercises L19's hints and UI-B's observed-departure bypass, its traffic and alerts change, and the 4 h run (R3-45) must be redone once; (b) keep the opt-out and document it as a known gap | **(a)**, as a small behaviour lane after SYNC-B (it touches `tools/soak/**` and the hub path SYNC-B changes) |
| TIME-B follow-up: heading, wrong-way and level-bust persistence | S-TIMEB (default: "stay mission time (follow-up candidate)"), ADR 0096 | (a) move those persistence durations to the injected wall clock, as TIME-B did for the 5 s airborne hold, the 120 s staleness and the heading grace; (b) keep them on mission time (they freeze when DCS pauses, which a controller may find right) | **(a)**: ADR 0096's own rule is "durations on the wall clock, facts on the mission clock", and these are durations |
| RP-F1: GC consolidated at LC | H101 RP-F1 (d) "decide after the refactor", the human's note "ground and tower are two different controllers" | (a) GC is never consolidated at LC: an unstaffed GC's Strips go to CD, or stay with an "unstaffed" alert; (b) keep GC → LC, since JO 7210.3 allows combining positions; (c) a short doctrine research lane (Opus, docs only: JO 7210.3 position combination, the guide §4.8.6) with an ADR draft, then the human picks | **(c)**, then a small lane on `facility-config`/`position-coverage` |

Also waiting on the human, with nothing to brief:

- the squadron data to verify (usage guide §8F1, S-L20-DONE), plus DATA-3's list;
- the comm card's real frequencies and approach buttons (R3-53; DATA-3 builds the schema);
- performing the MapTiler key rotation (MAPKEY prepares it);
- approving the AIRSP-2P-B mockup.

## Left out on purpose

- `tools/soak/host-core.js` wraps `bs._rebalanceRack` by name. W5-11 decided to keep this, so it has no lane.
- C-2 (double 6xxx warning, `rev` bump on an unchanged re-import): S-L20PREP D-3 said no.
- R3-64's export trim (the `_`-named test seams): it needs a lane that checks planned use first. BRIDGE uses those
  seams as they are.
