# 0018 — Airspace ownership is stored as a direction via a dedicated setter, structurally excluded from the generic FDR field-write path

## Context

Guide §4.6.4: `airspace.owner ∈ {CONTROLLING_AGENCY, USING_AGENCY}`, and explicitly: *"Never a bare `released` boolean — the word is used in both directions in the source material: released to the using agency means active, released to the controlling agency means available."* This is defect class **D15** in the guide's own register (§15): *"Airspace ownership stored as a boolean rather than a direction."* WP4A's acceptance criteria require this be genuinely unrepresentable, not merely documented as wrong: *"Setting airspace ownership requires a direction; there is no boolean path."*

## Decision

A new FDR sub-object, `fdr.airspace = {owner: null, changedAt: null, changedBy: null}` (present from `createFdr()`, `owner: null` meaning undecided — not a default direction), added the same way the existing `military`/`trackRef` WP6/WP5 hooks are: present but inert until relevant.

`owner` is **never added to `WRITABLE_PATHS`** — the generic `setField()` allow-list `SetBlock` and every controller-driven write ultimately routes through. It is settable *only* through a new dedicated method, `fdr-store.js`'s `setAirspaceOwner(fdrId, owner, {by})`, which validates `owner` against a fixed `AIRSPACE_OWNERS` set (`{'CONTROLLING_AGENCY', 'USING_AGENCY'}`) and rejects everything else — explicitly including both booleans, `1`/`0`, and free-text like `'released'`/`'hot'`/`'cold'` — with `VALIDATION_ERROR`. This is the same structural pattern `identity.beaconAssigned` already uses (`setField()` explicitly rejects that path with `'use setBeaconAssigned'`), for the same underlying reason: some fields need validation beyond "is this key in the allow-list," and the guarantee only holds if there is *no* alternate route to writing it, not merely a documented convention not to.

A new Block-Map target kind, `{kind: 'airspace-owner'}` (Block `24A`, `required: false`, present in both `DEPARTURE_BLOCK_MAP` and `ARRIVAL_BLOCK_MAP`), is distinct from `'fdr'`/`'annotation'`; `block-map.js`'s `resolveBlockTarget` returns it as its own case, and `board-store.js`'s `_applySetBlock` routes it to `setAirspaceOwner` rather than the generic `fdr-store.setField` call — a third branch alongside the existing beacon special-case.

## Alternatives considered

- **Document the "always use setAirspaceOwner" convention and add `airspace.owner` to `WRITABLE_PATHS` with in-line validation inside `setField()`.** Rejected: this is exactly the shape of guarantee the guide's own D15 register entry is warning against — a documented convention is not a structural guarantee, and the whole point of this acceptance criterion is that the boolean path must not *exist*, not merely be discouraged. `identity.beaconAssigned`'s existing precedent already established the stronger pattern; reusing it here is more consistent with the codebase than introducing a second, weaker one.
- **Model `owner` as a plain string field with an enum check only at the API/wire boundary (efsp-ws.js), not inside `fdr-store.js` itself.** Rejected: `fdr-store.js` is the single point every FDR mutation — from any caller, present or future — actually passes through. Pushing the validation up to one caller (the WS layer) would leave a hole for any other caller (a future dot-command, a future admin tool) to write an invalid value directly.

## Consequences

- `efsp-fdr-store.test.mjs` gained direct coverage of the "no boolean path" guarantee: `setAirspaceOwner` rejects `true`, `false`, `1`, `0`, `null`, `undefined`, `''`, and several plausible-looking-but-wrong strings, all with `VALIDATION_ERROR`; a fresh FDR's `airspace.owner` starts `null`, not a default direction; the generic `setField()` path is confirmed to reject `'airspace.owner'` outright.
- This is the explicit template `docs/adr/0020`'s deferred `separation_regime` field (TOFI, guide §4.6.3 — also explicitly required to never be derivable/settable implicitly, defect D14) should follow when that work lands: a dedicated sub-object, a fixed enum, a dedicated setter, never a `WRITABLE_PATHS` entry.
- No client UI writes `24A` this slice (read-only display via the ordinary Block-rendering path) — setting airspace ownership is reachable server-side/via tests only, pending a dedicated control.
