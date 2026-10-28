# 0035 — The `RANGES` Facility derives its Positions from the airspace config, and a `USING_AGENCY` Position works no Strips by class

## Context

The guide's §2 Defined Terms names five Facilities — *"`INCIRLIK`, `CENTER`, `RANGES`, `TACTICAL`, `CARRIER`"* — and §4.1's Position table gives `RANGES` exactly one Position, `RANGE` ("Range Control"). Adding a Facility is otherwise a solved problem here: docs/adr/0013 established the pattern for `CENTER`, docs/adr/0025 repeated it for `TACTICAL`, and `index.js`, `board-store.js` and the server's `efsp-ws.js` all iterate `facilityConfig.getFacilityIds()` generically, so the single act of adding a key to `DEFAULT_CONFIGS` creates a Facility.

What does not transfer is the Position *set*. The operational picture, from the project owner:

- Most MOAs have **no range control of their own**. A flight working inside one is approved a frequency change to a working frequency, and the airspace belongs to whoever owns the airspace it sits in — Ankara Center, for the ones around Incirlik.
- Some ranges — air-to-ground ones especially — **do** have a range control tower, with its own control frequency.

A hand-listed `positions: ['RANGE']` would model neither. It would invent a controller station for every MOA that has none (and `_applyTransferStrip`'s occupancy gating and the covering chain both assume a Position is a thing somebody can hold), while collapsing several genuinely distinct range towers into one identity.

## Decision

**`positions` is derived.** `facility-config.js`'s `DEFAULT_RANGES_CONFIG` reads the airspace definitions:

```js
const DEFAULT_RANGES_CONFIG = {
  facility: 'RANGES',
  positions: airspaceConfig.getRangePositionIds(),
  positionClasses: Object.fromEntries(
    airspaceConfig.getRangePositionIds().map(id => [id, 'USING_AGENCY'])
  ),
  coveringChain: {},
  blockVisibility: {},
  bays: {},
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};
```

`getRangePositionIds()` returns every distinct `usingPositionId` across the configured airspaces. A range with control of its own contributes a Position; an ordinary MOA contributes none, because there is nobody to be. That is the operational fact above, expressed as configuration rather than as a special case in code.

**Load order, and why there is no cycle.** `facility-config.js` requires `airspace-config.js` at the top, before it builds its `configs` Map, because the derived `positions` array must exist by the time `DEFAULT_CONFIGS` is constructed. `airspace-config.js` deliberately requires nothing from `facility-config.js` in return — it validates Position references by *shape* (a non-empty string) rather than by existence, and its module comment says so explicitly.

**`bays: {}`, and it stays empty.** §4.1 rule 2 gives `RANGE` a Field State board; §4.2 says *"Airspace board (not a strip rack)"*. Its board is `airspace-store.js` (docs/adr/0034), which is not a Bay of Strips, so `getAllBays('RANGES')` correctly returns nothing. This has a useful client-side consequence for free: the Strip panel builds its Position tabs from Bays (`computePositionTabs`), so a range Position never grows a strip-rack tab without any client-side special-casing.

**Absent from `coveringChain`.** The chain exists to re-route Strips away from a vacated Position (defect D19's stranding case, guide §4.8.6 rule 3). A Position that owns no Strips has none to strand, so an empty chain is the correct answer rather than an omission. This is a different reason from docs/adr/0013's and 0025's refusals to extend the chain *across* a Facility boundary, and worth not conflating with them.

**A new Position class, `USING_AGENCY`** — the guide's own Class column for the `RANGE` row.

**And the structural half: `permission.js` refuses every Strip op to that class, in `canMutate`.**

```js
const NO_STRIP_OP_CLASSES = new Set(['USING_AGENCY']);
function _worksNoStrips(positionId) {
  return NO_STRIP_OP_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

function canMutate(actingPositionId, opKind) {
  if (_worksNoStrips(actingPositionId)) return false;
  const allowed = PERMISSIONS[actingPositionId];
  return !!allowed && allowed.has(opKind);
}
```

This is the load-bearing decision of the ADR. A derived Position is **never hand-listed in `PERMISSIONS`**, so `PERMISSIONS[rangePositionId]` is `undefined` and the lookup already returns `false` — the right answer, for the wrong reason. §4.1's Primitives column for `RANGE` reads *"no strip primitives — owns airspace state"* and its Strip Roles column reads *"none"*; that is a rule, and it should hold because it is stated, not because a table happens to have no entry. Refusing by class makes it true by construction: it keeps holding if someone later adds a `PERMISSIONS` entry for a range Position by mistake, and any future using-agency Position inherits it with no new line.

It is the same shape as docs/adr/0025's `MRU_OR_NON_ATC_CLASSES` strip-back loop, and deliberately a *separate* set rather than an extra member of it. That loop removes the 5 coordination op kinds from MRU Positions; this refuses *everything*. Folding `USING_AGENCY` into `MRU_OR_NON_ATC_CLASSES` would have said something weaker and less true.

## Alternatives considered

- **Hand-list `positions: ['RANGE']`**, one Position for all ranges, as `CENTER` does for `CTR`. Rejected: it invents a controller station for MOAs that have none, and merges distinct range towers — which have distinct frequencies and distinct schedules — into one identity that two controllers would have to contend for.
- **Give every airspace a Position, MOAs included.** Rejected for the same reason, from the other end: an uncontrolled MOA would need somebody to *hold* it before it could be scheduled or activated, which is a fiction the occupancy model would then have to carry. The `_isUsing` fallback in docs/adr/0036 handles the no-using-agency case properly instead.
- **Derive the Positions but hand-list them in `PERMISSIONS` anyway**, so the refusal is visible in the table. Rejected: impossible to keep correct, since the set is not known until config loads, and it would reintroduce exactly the by-omission fragility the class check exists to remove.
- **Add `USING_AGENCY` to `MRU_OR_NON_ATC_CLASSES`.** Rejected: that set means "may not use the 5 ATC↔ATC coordination primitives". A using-agency Position may not use *any* Strip op. Reusing the set would have understated the rule and made both harder to read.
- **A `RANGES` config file shipped with the repo**, mirroring `efsp-facility-center.json`. Not rejected so much as unnecessary: the env override `CRCSYNC_EFSP_FACILITY_CONFIG_PATH_RANGES` exists for symmetry, and the absence of the file falls back to defaults exactly as `TACTICAL` has done since docs/adr/0025 (with the same benign startup warning). The derived Position set is the thing that actually configures this Facility, and it lives in `efsp-airspaces.json`.

## Consequences

- **`RANGES` is a real Facility with zero Positions until an airspace declares one**, which is the shipped state (`config/efsp-airspaces.json` is `[]`). `crc-sync/tests/efsp-facility-config.test.mjs` asserts this directly — `getPositionSet('RANGES')` is `[]` and `getAllBays('RANGES')` is `[]` — alongside the updated exact-Facility-list assertion, which now reads `['INCIRLIK', 'CENTER', 'TACTICAL', 'RANGES']`.
- `crc-sync/tests/efsp-scenarios.test.mjs` writes its own `efsp-airspaces.json` fixture before importing anything, precisely because the derivation happens at require time. That file is the working reference for the config shape.
- `tests/efsp-permission.test.mjs` asserts `NO_STRIP_OP_CLASSES` contains `USING_AGENCY`, and the scenario suite asserts the behaviour end to end: a range Position is refused `InvokeNla`, `SetState` and `DropStrip` on a real Strip, while still running its own airspace.
- **An airspace's `controllingPositionId` is cross-checked against the real Position sets at startup**, by `index.js`'s `_validateAirspaceReferences` — the only place without a require cycle, since both configs are in scope there and neither may require the other back. `validateAirspaces` still checks shape only, which is all it can do. A typo warns loudly at boot naming the airspace and the Position, rather than failing later as a bare `PERMISSION_DENIED` with nothing pointing at the config. It warns rather than throws: one bad airspace should not stop the server, and the rest of the board still works. `usingPositionId` needs no such check — the RANGES Position set is built from those values, so they exist by construction.
- **The `RANGES` facility config is never read from or written to disk** (`DERIVED_FACILITY_IDS` in `facility-config.js`). An on-disk override would freeze a `positions` array that goes stale the moment an airspace is added or removed, and `setFacilityConfig` would have been the way to write one — it now refuses for this Facility, pointing at the airspace config instead. This also removes a load-failure warning that would otherwise fire on every boot for a file that should never exist.
- The client cannot hard-code the RANGES Position list for the same reason `PERMISSIONS` cannot. `radar-panel.js`'s `EFSP_FACILITY_POSITIONS` keeps its static entries for the three Strip Facilities and reads RANGES from the snapshot instead — documented in place, since reading *all* of them from the snapshot would mean no "acting as" checkboxes at all until the first snapshot lands.
