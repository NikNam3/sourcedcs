# 0041 — Hiding a Block is an exclusion list, and a restored snapshot must agree with itself

## Context

**A configuration list that meant "everything" silently became a deny-list for everything invented afterwards.**

`facility-config.js` expressed guide §8.2's *"Block Map per Strip Role: visibility"* as `blockVisibility: { [role]: [blockId, ...] }` — an **inclusion** list. The defaults derive it from the Block Map itself (`DEPARTURE: Object.keys(blockMap.DEPARTURE_BLOCK_MAP)`), so a default config always lists exactly what exists. But `_loadOne` merges an on-disk config *over* the defaults, and `setFacilityConfig` persists one. Once written, that list is frozen: a materialised snapshot of every Block that existed the day it was saved.

The shipped configs had been written once. `config/efsp-facility-incirlik.json` and `config/efsp-facility-center.json` each carried `DEPARTURE` with 42 entries against a Block Map that now defines 47, `ARRIVAL` with 32 against 36, and `OVERFLIGHT` with 24 against 28. Every Block added since fell outside the list — and docs/adr/0039 had just made `isBlockVisible` authoritative on the write path (`_applySetBlock` rejects a Block the Facility does not make visible, closing guide §8.1's *"the configurability is the specification"* gap). The enforcement was correct. The data it enforced against was three Blocks out of date.

What that meant on the deployed server, stated plainly:

- **`IFR`, `RSVC` and `SREG` were unwritable at both Facilities.** These are guide §4.6.3's three-field separation model (docs/adr/0025). Completing a TOFI exit requires `fdr.tofi.separationRegime === 'ATC'` — `_applyTofiAccept`'s `EXIT` branch refuses otherwise, which is rule 3's *"exit is the safety-critical direction"* implemented as a hard precondition. Nothing could set it. **Tactical control could be entered and never left.**
- **`14A` and `14D` were unwritable** — docs/adr/0039's release state and void time, added two commits earlier precisely to make §3.8's release model reachable at all. The fix would not have worked in production.
- **`22` was unwritable on `ARRIVAL` and `OVERFLIGHT`** — docs/adr/0037 added the frequency Block to those two Roles because a flight is approved onto a frequency while enroute, which is exactly when its Strip is an `ARRIVAL` or an `OVERFLIGHT`. (It was already listed on `DEPARTURE`, where the Block ID predates that ADR and only its target kind changed.) So the one case the Block exists for was the case it did not cover.

**No test could have caught this.** Every test builds facility config from the defaults — either implicitly, or by pointing `CRCSYNC_EFSP_FACILITY_CONFIG_PATH*` at a temp file that does not exist so `_loadOne`'s catch falls back. The defaults are derived from the Block Map and are therefore always current, so the suite proves the mechanism works and says nothing about the data. The failure appears only against a config that has been persisted at least once — which is to say, only in production. That is the transferable lesson here, and it is worth stating separately from the fix: **a test that builds its own config is testing the code, not the deployment.**

**Second, unrelated in mechanism but found in the same sweep: a restored snapshot was never checked for being whole, or for agreeing with itself.** `_persist` wrote the Board with a plain `fs.writeFileSync` after *every successful Mutation*, and `_restore` parsed whatever it found with no cross-checks between the three things it restores — Strips (per-Facility `BoardStore`s), FDRs, and the `CodeAllocator`'s allocated-code map.

## Decision

### `hiddenBlocks` — a Facility says what it hides, not what it shows

```js
hiddenBlocks: {},   // per-Role exclusion list, empty at every Facility
```

```js
function isBlockVisible(role, blockId, facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  if (!config) return true;
  const hidden = (config.hiddenBlocks || {})[role];
  return !hidden || !hidden.includes(blockId);
}
```

**An exclusion list cannot drift.** A Block is visible until somebody deliberately hides it, so adding one to a Block Map needs no config regeneration anywhere. The inclusion list was not wrong in what it expressed on the day it was written — it was wrong in what it came to express on every day afterwards, and nothing about the shape made that visible.

The §8.3 doctrinal check is **unchanged in substance**: *"Every Block marked required in §6.2/§6.3 MUST be present and visible."* Only the direction `validateConfig` reads from changed — it now subtracts what the candidate hides from the Block Map and hands the remainder to `blockMap.validateFacilityConfig`, which still refuses any config missing a required Block:

```js
for (const role of Object.keys(candidate.hiddenBlocks || {})) {
  const all = Object.keys(blockMap.BLOCK_MAPS[role] || {});
  const visibleBlocks = all.filter(b => !candidate.hiddenBlocks[role].includes(b));
  const result = blockMap.validateFacilityConfig({ role, visibleBlocks });
  if (!result.ok) return result;
}
```

**Migration: a legacy `blockVisibility` key on disk is dropped, with a warning, not converted.** Converting would compute `hidden = full − listed` — which faithfully reproduces the accidental hiding of every Block added since the file was written, i.e. it preserves precisely the bug. It is lossless in this case because every shipped list was a full set for its day and therefore expressed no narrowing at all; there is nothing to carry forward. The warning names the Facility and tells the operator to restate any genuine narrowing as `hiddenBlocks`. Both shipped config files were cleaned in the same commit.

### A restored snapshot must be whole, and must agree with itself

Three changes, all in `index.js`:

**`_persist` writes to a sibling and renames.** `fs.renameSync` is atomic on POSIX; `fs.writeFileSync` is not. This runs after every successful Mutation, so a busy session spends a meaningful fraction of its life inside that call, and a crash or power loss partway through left a truncated file. `JSON.parse` then rejects it wholesale on restart and `_restore`'s catch comes up with an empty Board. Losing one Mutation to a crash is unavoidable; losing the entire session's Board to one is not.

**`_reconcileRestored` checks the three restored parts against each other**, called *after* the Boards are populated — it has nothing to check before then. It reports a live Strip whose FDR is missing (that Strip renders without flight data and computes its NLA against `null`), and it **repairs** a live Strip whose beacon code the allocator has free:

```js
const code = fdr.identity.beaconAssigned;
if (code && !allocator.isAllocated(code)) {
  console.warn(`[efsp] restored Strip ${strip.stripId} squawks ${code}, which the code pool had free — re-reserving it`);
  allocator.reassign(strip.fdrId, code, null);
}
```

The code case is repaired rather than only reported because leaving it alone is actively dangerous: the next `CreateStrip` scans the pool, finds that code free, and mints it for a different aircraft. That is the same two-live-aircraft-one-Mode-3/A failure docs/adr/0028 fixed for the shared-FDR case, arriving by a different route — and, as there, silent, because `validateAssignment`'s duplicate check fires only on a manual override. Re-reserving a code a live flight is already squawking is unambiguously right, which is what makes automatic repair defensible here and not in the missing-FDR case.

**`MAX_FREE_TEXT = 2000`** on `setField`'s string writes (`fdr-store.js`) and on annotations (`board-store.js`'s `_applyAnnotationSet`). The guide sets no limit and none of these fields has a natural one — a route or a remark is as long as it needs to be — but nothing bounded them at all, and a Strip is broadcast *whole* to every connected client on every update (docs/adr/0004's immediate-broadcast decision) as well as persisting in the durable snapshot. One pasted document would ride on every subsequent change to that Strip, forever. The ceiling is set generous enough that no real entry meets it: this is a bound on accidents, not a format rule.

## Alternatives considered

- **Regenerate the shipped `blockVisibility` lists.** Rejected: it fixes today and breaks again the next time a Block is added. The drift is structural — an inclusion list of "everything" is a deny-list for the future by construction — not a stale file that happened to need refreshing. Any fix that leaves the shape in place schedules the same outage.
- **Keep the inclusion list, but treat a Block missing from it as visible.** Rejected: it is indistinguishable from a deliberate hide, so hiding would simply stop working. That trades a silent deny for a silent allow.
- **Keep the inclusion list, and warn at load about Blocks in the Map but not in the list.** Rejected: a warning nobody reads is not a fix, and the write is still refused. It converts a silent failure into a noisy one without making the feature work.
- **Convert a legacy `blockVisibility` into `hiddenBlocks` on load** rather than dropping it. Rejected for the reason above — the conversion is faithful to a list that was never intended to hide anything, so it would carry the bug forward under a new key and be much harder to spot the second time.
- **Leave `_persist` non-atomic** on the grounds that the mutation log (`efsp-mutations.jsonl`, append-only) is the real durable record. Rejected: the log is an audit trail, not a restore path — nothing replays it into a Board, and building that would be a far larger change than a rename.
- **Report the free beacon code without re-reserving it.** Rejected: see the Decision. The correct action is unambiguous, and a warning in a log leaves a live duplicate-code hazard sitting in the pool until somebody reads it.
- **Cap free text at the wire boundary** (`efsp-ws.js`) instead of in the stores. Rejected for the same reason docs/adr/0040 put airspace auditing in the store rather than the handler: it would bound only what arrives over the WebSocket, and leave every other caller unbounded.

## Consequences

- **`hiddenBlocks` is empty everywhere, which is the guarantee worth asserting.** `tests/efsp-facility-config.test.mjs` now asserts exactly that — *nothing is hidden at any Facility* — plus `isBlockVisible` returning true for every Block of every Role, and that no default config carries a legacy `blockVisibility` key. This is drift-proof in a way the old per-Role "the list equals the full set" assertions were not: those compared two things that were derived from the same source and so agreed by construction, while the on-disk file that actually mattered went unchecked.
- A Facility that genuinely wants to narrow a Role now states it as an exclusion, and that statement stays true as the Block Map grows. `tests/efsp-scenarios.test.mjs` exercises it — hiding `24A` at `CENTER` refuses that Block's write while leaving `SREG` writable.
- **`.tmp` is reserved next to the snapshot path.** The scratch file exists only between the write and the rename; the concurrency suite asserts it does not outlive the write, and that the live file always parses.
- **`_reconcileRestored`'s own ordering bug was caught by the test, not by review.** It was originally called immediately after `fdrStore.restore`, before the Boards were populated — so it iterated an empty set of Strips and silently checked nothing, while looking entirely correct. It passed a read. It failed the test that asserted a freed code gets re-reserved. That is the argument for writing the assertion rather than trusting the code, restated.
- **Coordination and TOFI notes are bounded at the dispatcher, not at each reader.** `op.note` reaches `strip.coordination.note`, `strip.tofiCoordination.note` and the `receive*` peer callbacks through eight separate `op.note || null` expressions. An attempt to cap each of them individually silently matched nothing and shipped the gap intact — a 50,000-character note was still accepted and stored in full, and was caught by review rather than by the suite. `_dispatch` now truncates `op.note` once, before the switch, which is the single point every Mutation passes through and the only place that cannot be partially applied. `tests/efsp-scenario-concurrency.test.mjs` asserts both the sender's Strip and the peer replica carry the bounded note.
- The `2000` ceiling is `[SOURCE-DEFINED]` — the guide gives no figure for any of these fields, and it must not be presented as a doctrinal limit (defect D11). It is an operational bound on a broadcast-and-persist cost.
