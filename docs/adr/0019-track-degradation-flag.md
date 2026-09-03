# 0019 — `trackDegradationFlag` is a new FDR field, distinct from `identity.degradation`, forcing verbal coordination on `PROPOSE`

## Context

Guide §4.6 rule 5: *"Track-degradation flags (CST, FAIL, NONE, IF, NT, TRK) force verbal coordination: the panel MUST surface them and MUST disable silent transfer while present."* `fdr-store.js` already had an `identity.degradation` field (`NONE | TRANSPONDER_FAILED | MODE_C_FAILED`) from Phase 1, modeling equipment failure per guide §3.10. These are different vocabularies describing different things — radar-track-quality flags (a surveillance-system concept, from `[Coord]`'s cross-Facility coordination doctrine) versus transponder/Mode-C equipment state (an aircraft-equipment concept, from §3.10) — that happen to sound similar.

## Decision

A new field, `fdr.identity.trackDegradationFlag`, defaulting to `'NONE'`, validated against a new `TRACK_DEGRADATION_FLAGS` set (`{'NONE', 'CST', 'FAIL', 'IF', 'NT', 'TRK'}`) via the ordinary `setField()`/`WRITABLE_PATHS` path (unlike `docs/adr/0018`'s `airspace.owner` — this field has no "no boolean path"-style requirement, an enum check inside the generic path is sufficient). `identity.degradation` is left completely untouched.

`board-store.js`'s `_applyCoordinationPropose` (`docs/adr/0015`) checks it: when the FDR's `trackDegradationFlag !== 'NONE'`, a coordination `PROPOSE` is rejected with `VALIDATION_ERROR` unless `op.note` is non-empty. A non-empty note is the electronic stand-in for "verbal coordination occurred" — there is no separate verbal-coordination-logging mechanism in this simulation, so the note field carries that record. Client-side, the Coordinate popover (`bay-view.js`) surfaces the degraded flag as a visible warning and makes its note field visually required (`efsp-coordinate-note-required`) before it will even attempt to send — this is the proactive half of the same "surface the reason before it reaches the server" pattern `docs/adr/0010` established for per-State authority.

## Alternatives considered

- **Reuse `identity.degradation` for both purposes**, treating `TRANSPONDER_FAILED`/`MODE_C_FAILED` as also implying track degradation. Rejected: these are genuinely different concepts describing different failure surfaces (what the *aircraft's* equipment reports vs. what the *radar/tracking system* reports about the aircraft) — an aircraft can have fully working equipment while still presenting a degraded track (weak return, ground clutter, a coasting track), and vice versa. Conflating them would mean a `MODE_C_FAILED` aircraft is silently treated as forcing verbal coordination even when its track is perfectly solid, or the reverse — a real correctness bug, not just an awkward reuse.
- **A simple boolean (`isDegraded`) rather than the guide's actual 5-value enum plus `NONE`.** Rejected: the guide explicitly names 5 distinct flag values (`CST`, `FAIL`, `IF`, `NT`, `TRK`) as displayable states, not one undifferentiated "degraded" bit — collapsing them would lose information a controller might reasonably want to see (which specific degradation is present), for no implementation cost saved.

## Consequences

- `efsp-fdr-store.test.mjs` covers the default (`NONE`), rejection of invalid values, and acceptance of every listed flag.
- `efsp-board-store-coordination.test.mjs` covers the interlock directly: a `PROPOSE` without a note is rejected once the flag is set to `CST`; the same `PROPOSE` with a note succeeds.
- The client's degraded-note-required UX is enforced only client-side as a proactive convenience — the server-side `VALIDATION_ERROR` in `_applyCoordinationPropose` remains the actual authority, consistent with every other client-mirror in this codebase (`docs/adr/0010`'s own stated caveat).
- No mechanism sets `trackDegradationFlag` automatically from surveillance data this slice (WP5 track correlation isn't built) — it is a controller-set field only, reachable via the generic Block-editing path once a Block Map entry is added for it (not added this slice — no Block currently targets `identity.trackDegradationFlag`; it is settable via `setField` directly/tests, and via a future dedicated control).
