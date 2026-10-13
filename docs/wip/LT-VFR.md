# LT-VFR — flight following on a contact with no Strip (H136)

Lane `lane/LT-VFR`, worktree `/home/nklx/dev/personal/sourcedcs-LT-VFR`. No ADR number (briefing): this note is the
addendum for the supervisor to record. Design: `docs/parallel/research/vfr-flight-following.md` "Proposed model" (a)–(c)
and H136.

## What was built

### 1. "Start flight following" (H136 VQ1 a; JO 7110.65BB ¶5-14-4 c, ¶5-2-7 a, ¶5-3-7)

- **Server:** new Board op `StartFlightFollowing` (`crc-sync/src/efsp/board/ops/start-flight-following.js`), a
  *stripless* op (it makes its own subject; `board/strip-ops.js` `_dispatchStripless`). `{ trackId, flightData:
  { callsign, aircraftData } }`, Block 3 parsed by LT-STRIP-FIELDS' `parseAircraftData`. In one Mutation, audited as one
  entry: flight data, a discrete code from the existing allocator, an **OVERFLIGHT** Strip owned by the acting Position
  **directly IN_SECTOR** in its Overflight Bay (`ctr-overflight` / `ap-overflight`), and the contact bound to it (rung 1,
  `correlationStore.bindOnStart`, the same `_bind` as `BindTrack`). The correlation record rides an
  `efsp-correlation-delta` on the same round trip (`efsp-ws.js`).
- **Refusals** (every gate before the first write, so a refusal spends no code): the contact is already tracked
  ("this contact is already tracked as N1"); the Position may not create OVERFLIGHT Strips or the op (`PERMISSION_DENIED`;
  AP and CTR only, `AP_CTR_ONLY_OP_KINDS`); no Overflight Bay, or the Bay is full; a bad callsign or Block 3; no discrete
  code free ("no discrete beacon code is free").
- **An explicit binding claims its contact even while the picture misses it** (`holderOfTrack` checks bindings too):
  otherwise the reconciler's UNCORRELATED-with-binding state let a second Start bind the same contact.
- **Undo** takes the whole thing back: Strip removed, flight data archived (code released), binding ended
  (`board/ops/undo.js`, new Scope key `correlations`). Undo's audit entry names the removed Strip (`removed: true`).
- **Client:** a "Start flight following" section in the track panel (callsign + type + START; Enter works), shown
  **only** on a contact with no live Strip (correlated or explicitly bound) while AP or CTR is held Primary. The callsign
  field is prefilled from the contact's tag, if any. The refusal shows on the panel's own line. Keyboard path:
  `.ff <track> <CALLSIGN> <TYPE>` (track = the track number the data block shows, or the id), as `.bind` is the TRK
  badge's.

### 2. VFR the FAA way (H136 VQ2)

- **No flight-rules field.** A flight-following Strip is a Strip with no clearance: no assigned ALT/HDG.
- **Conformance** checks nothing on it and does not throw (unit test: climbing hard, `getAll()` empty).
  **Conflict Alert** treats the contact as tracked (it has flight data through the correlation) and does not crash on
  an empty clearance (unit test).
- **¶2-3-8 c, read:** *"For VFR operations, indicate the aircraft's transponder and navigation capabilities by adding
  the appropriate symbol, preceded by a slant (See TBL 2-3-10)."* The VFR form is the **same TBL 2-3-10 symbol** an IFR
  flight carries; ¶2-3-8 c only says VFR carries one too. There is no VFR-specific suffix. **What I did:** nothing new.
  Our suffix is derived from `identity.equipmentCodes` (§3.3, `deriveEquipmentSuffix`) and Block 3 refuses a typed
  suffix (LT-STRIP-FIELDS), so Start takes callsign + type only and the suffix stays empty until the controller sets the
  equipment codes the ordinary way. Default taken (below).

### 3. "Radar service terminated" (H136 VQ6 a; ¶5-1-9 a, ¶5-2-7 b, ¶7-6-11)

- **Server:** Board op `TerminateRadarService` (`board/ops/terminate-radar-service.js`): DropStrip (reason
  `RADAR_SERVICE_TERMINATED`; the one retirement path, releases the code), clears any `airspaceEntry` and the flight's
  working-frequency/airspace, and ends the explicit binding at once. AP/CTR only, the owner's. Undo puts back the Strip,
  code, entry and binding; a contact another flight has taken since is **not stolen** (warning `BINDING_NOT_RESTORED`).
- **Client:** "Radar service terminated" in the Strip's ⋯ menu ("Flight" group), offered on a live OVERFLIGHT Strip with
  no clearance owned by an AP/CTR the controller holds; greyed with a reason while a coordination or TOFI exchange is
  open. Keyboard: `.term` on the selected Strip. **Not on the NLA**: an IN_SECTOR overflight's NLA stays "Leaves Sector"
  (the handoff path); default taken.

### 4. Entry approval (H136 VQ5 a)

The existing `ApproveAirspaceEntry` works on a flight-following Strip with today's rights; no change. Tested in the unit
suite and in the spec through the ⋯ "Airspace…" popover. The alert by airspace type (VQ4 b) is LT-AIRSPACE-ALERT's.

### 5. A tag stays a name only (H134)

Nothing in this lane reads a tag as tracked: "tracked" is the correlation. The tag only prefills the callsign field.

## Wire

Two new Board op kinds, `StartFlightFollowing`, `TerminateRadarService` (recorded in
`crc-sync/tests/fixtures/wire-surface.json`; `npm run wire:record`: WIRE_PROTOCOL stays 2, surface unchanged since). The
correlation delta now also rides a Board Mutation's round trip (existing frame). Freeze goldens re-recorded once for the
permission tables (commit `6e8013a2`).

## Defaults taken (P2)

1. **Always OVERFLIGHT** from Start; a VFR flight leaving or landing at our field is created the ordinary
   DEPARTURE/ARRIVAL way (H136 VQ3 "the ordinary forms"). No type picker in the panel.
2. **AP and CTR** start and terminate (the Positions that hold an Overflight Bay and the radar service). LC/GC/OPS refused.
3. **Equipment suffix not asked at Start** (¶2-3-8 c gives no VFR form beyond the ordinary symbol; our suffix is derived).
4. **"Radar service terminated" in the ⋯ menu and `.term`, not the NLA.**
5. **The offer client-side is "an OVERFLIGHT with no clearance"**; the server accepts Terminate on any live Strip AP/CTR
   owns (a flight given a clearance since is still terminable by `.drop`/the server op).
6. **Refusal wording** "this contact is already tracked as <ACID>" (covers a bound contact the picture misses).
7. **`.ff` names the contact by its data-block track number** (or its id), as `.bind` does by id.

## Usage-guide wording (for the docs pass)

> **Flight following (VFR traffic advisories).** Click the contact. In the track panel, under *Start flight following*,
> type the callsign and the aircraft type (Block 3, e.g. `C172`) and press START (or type
> `.ff <track number> <CALLSIGN> <TYPE>`). The flight gets an overflight Strip in your Overflight Bay, in sector, with a
> discrete code to issue, and the contact is tracked under its callsign. The Strip has no assigned altitude or heading,
> so nothing is conformance-checked. Approve entry into active airspace from the Strip's ⋯ → *Airspace…* as for any
> flight. To end the service ("radar service terminated, squawk VFR"), ⋯ → *Radar service terminated* (or `.term`): the
> Strip is dropped, the code released, the entry cleared and the contact untracked. Undo takes either back within 10 s.

## Specs and tests

- `crc-desktop/e2e/flight-following.spec.js`, 4 tests, green on `E2E_LANE=3` (start → OVERFLIGHT IN_SECTOR, discrete
  code, bound, offer gone; terminate from ⋯ → code released, unbound, offer back; second Start refused naming the flight;
  Undo of the start; approve entry via ⋯ "Airspace…" on a server-created MOA (uses the fake DCS, as
  airspace-server.spec.js); terminate clears the entry; `.ff`/`.term`).
- `crc-sync/tests/efsp-flight-following.test.mjs` (10), `crc-desktop/tests/efsp-flight-following-client.test.mjs` (4).

## Findings for other lanes

- **LT-MARSA (CA/MCI):** "tracked" = correlated to a live Strip. A flight-following contact is tracked from the Start's
  Mutation on (binding, rung 1), and `correlationStore.flightDataForTrack` gives its flight data, as for any Strip. Note a
  bound contact the picture briefly misses is UNCORRELATED with the binding kept: MCI should not treat it as an
  intruder target in that window (it is not in the picture anyway). After "Radar service terminated" the contact is
  untracked at once (binding ended in the same Mutation, not at the next sweep), so it becomes an MCI intruder if it
  reports altitude (VQ8 a). The empty clearance never crashes CA.
- **LT-AIRSPACE-ALERT:** a flight-following Strip is an ordinary OVERFLIGHT Strip; approval is `ApproveAirspaceEntry`
  (`strip.airspaceEntry`, flight data `comms.airspaceId`) and Terminate clears both. VQ4 b's "tracked VFR aircraft in
  an active MOA/warning area never alerts" needs a way to know "VFR": there is no field (VQ2); the FAA-shaped reading is
  "no assigned altitude" (an empty clearance), the same test the client uses for the Terminate offer
  (`flight-following.js` `_noClearance`). Decide whether to share it.
- **Declutter/strip fields:** an OVERFLIGHT Strip shows the `KEEP IFR` cell even on a flight-following (VFR) Strip.
- **Supervisor:** the harness picture drops a client-injected contact at its next frame; the spec re-injects before each
  look (documented in the spec).
