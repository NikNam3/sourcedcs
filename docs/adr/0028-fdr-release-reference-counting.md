# 0028 — A beacon code is released only when the LAST Strip referencing its FDR is dropped

## Context

`FdrStore.releaseFdr(fdrId)` released the FDR's Mode 3/A code unconditionally:

```js
releaseFdr(fdrId) {
  const fdr = this._fdrs.get(fdrId);
  if (!fdr) return;
  this._codeAllocator.release(fdr.identity.beaconAssigned);
}
```

and `CodeAllocator.release(code)` is a bare `this._allocated.delete(code)`, which makes that code immediately available to the very next `allocate()` — a sequential octal scan from `0001` that takes the first code not currently in `_allocated`.

That was correct while one FDR meant one live Strip, which was true for the whole of Phase 1. It stopped being true twice over. docs/adr/0015's D13 replication mints a genuinely separate Strip in the receiving Facility sharing the sender's `fdrId`, and docs/adr/0025's TOFI goes further: it is the first primitive to bind two **different Strip Roles** to one FDR — a `MISSION` Strip on `TACTICAL`'s Board and the ATC-side Strip it was created from — whose lifecycles are explicitly independent of each other and of the exchange state (docs/adr/0026, and its test: *"the MISSION Strip advances through its own lifecycle... independent of the TOFI exchange state"*).

So: a TOFI exit completes, the MRU controller retires their `MISSION` Strip — entirely legitimately, the mission is over — and the shared beacon code goes back in the pool **while the ATC-side flight is still airborne, still squawking it, and still displaying it in Block 5**. The next `CreateStrip` for an unrelated departure then scans the pool and hands out that same code. Two live aircraft, one Mode 3/A code.

It is silent, which is what makes it worse than defect D23's ordinary duplicate case. D23's detection path, `code-allocator.js`'s `validateAssignment`, fires only on a **controller override** via `setBeaconAssigned` — it warns `DUPLICATE_IGNORED_WARNING` when the code is held by a different FDR. The automatic `allocate()` scan never consults it, and has no reason to: from its point of view the code was free.

Found by walking the military sortie end to end in `tests/efsp-scenarios.test.mjs`; no per-mutation test could have seen it, because it requires two Strips, one FDR, and a specific retirement order.

## Decision

**Refcount against the Strip Maps, at the moment of release.** `BoardStore` gains `_releaseFdrIfLastStrip(strip)`, called from `_retireStrip` (docs/adr/0027) in place of the direct `releaseFdr` call:

```js
_releaseFdrIfLastStrip(strip) {
  const othersLive = this._rules.liveStripsForFdr
    ? this._rules.liveStripsForFdr(strip.fdrId, strip.stripId)
    : 0;
  if (othersLive === 0) this._fdrStore.releaseFdr(strip.fdrId);
}
```

with a new rule wired in `index.js`'s composition root:

```js
liveStripsForFdr: (fdrId, excludeStripId) => {
  let n = 0;
  for (const { boardStore } of facilities.values()) {
    for (const s of boardStore.getAll()) {
      if (s.fdrId === fdrId && s.stripId !== excludeStripId && s.state !== 'DROPPED') n++;
    }
  }
  return n;
},
```

**Deliberately global, not this Facility's own Board.** This is the crux. `index.js` builds one `{BoardStore, PositionStore}` pair *per Facility* (docs/adr/0013) but keeps a **single shared `FdrStore` and `CodeAllocator`** across all of them. The code pool is therefore global while the Strips that justify holding a code are scattered across three per-Facility `_strips` Maps — so "is anyone still using this code" is a question only a cross-Facility count can answer. A same-Facility check would have left the exact TOFI case unfixed, since the `MISSION` Strip and its ATC-side Strip are by construction in different Facilities.

It uses the same lazy-closure-over-`facilities` shape as the existing `peerBoard` rule directly above it, for the same construction-order reason recorded there: the other Facilities' `BoardStore` instances do not exist yet on the first iteration of the wiring loop.

`releaseFdr` itself is unchanged in behaviour but its contract is now documented: callers must not invoke it while another Strip references the FDR, and `_releaseFdrIfLastStrip` is the guard that enforces that.

The optional-rule shape (`this._rules.liveStripsForFdr ? ... : 0`) matches every other rule in `board-store.js` and keeps the many hand-built test fixtures that construct a partial `rules` object working unmodified — they fall back to the old unconditional-release behaviour, which is correct for a single-Facility fixture with one Strip per FDR.

## Alternatives considered

- **A refcount field on the FDR itself**, incremented on replica creation and decremented on drop. Rejected on two counts. It is derived state duplicating what the Strip Maps already authoritatively hold, so any path that creates or retires a Strip without touching it — `reassignPositionStrips`, a future bulk operation, `restore()` — silently corrupts it, and a corrupted refcount fails in the *dangerous* direction (hits zero early, releases a live code). It would also have to survive the durable snapshot (docs/adr/0002) and be reconciled on restore against the Strips actually restored, which is the same scan this decision does, just done once at a less useful moment.
- **Never release automatically; require an explicit "close flight" action.** Rejected as inventing a new controller obligation the guide does not describe, to solve a bookkeeping problem, and it fails open — a forgotten close leaks the code permanently, which is the pre-existing bug from docs/adr/0027 restated as a feature.
- **Scan only the dropping Strip's own Facility**, accepting the cross-Facility case as a known gap. Rejected: that *is* the case this exists for.
- **Extend `validateAssignment`'s duplicate check to the `allocate()` scan**, so a reused code at least warns. Rejected as treating the symptom — the code was genuinely free by the allocator's own bookkeeping, so there is nothing for it to detect. Worth revisiting independently if D23's duplicate surface ever grows, but it is not this bug.

## Consequences

- **One sortie legitimately ends holding several Strips on one FDR**, and the code is released only when the last of them goes. The military scenario test asserts this step by step: after the `MISSION` Strip is dropped the code is still held; after the arrival Strip is dropped it is *still* held (the sender-side departure Strip `APP` kept at handoff is a third live Strip); after that one is dropped it is still held (CTR's own); only after CTR's is dropped does `isAllocated(beacon)` finally go false. That sequence is the clearest available statement of the design.
- **The stale-replica problem is now visible rather than merely latent.** Because a forgotten sender-side Strip pins the code, it is no longer free for that flight to be re-created cleanly. That is a real operational cost of the guide's own replica model (§4.6: each holder retires its own Strip on its own schedule), and it is why the client grew a shared-FDR badge in the same session — a Strip whose flight has siblings elsewhere now says so.
- The `Undo`-of-a-Drop path (docs/adr/0027) re-claims through `FdrStore.reacquireFdr`, which is the mirror of this decision at the individual-FDR level: it too refuses to act when the code has moved on.
- A future work package that introduces per-Facility code pools (guide §3.10's fuller named-pool model, explicitly out of scope in `code-allocator.js`'s header) would make the global scan wrong and needs its own ADR — at that point "which pool does this FDR's code belong to" becomes a real question rather than a degenerate one.
