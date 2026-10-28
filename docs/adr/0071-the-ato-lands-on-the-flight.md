# 0071 — the ATO lands on the flight: one import, one setter, and the AR join is not MARSA

## Context

WP7 (guide §9.8, §9.9 part 2) asks that a USMTF ATO produce mission Strips "with correct mission
number, package, vul window, controlling agency and IFF codes", that "a tanker's AR line and its
receivers' Strips render as a joined group", and that §9.9's community-source caveat stay in the
parser's documentation. ADR `0063` (L3) built the parser: text in, mission lines out, nothing
written. ADR `0054` made a mission line able to bind to an existing FDR through `CreateStrip`
(`op.fdrId`), and left one question to WP7: *"WP7 must decide whether an ATO-created FDR allocates
[a beacon code] at all"* (`0054…md:86`).

What shaped the decision:

1. **Most of what an ATO says has no home and no writer.** `identity.modeOne`/`modeTwo` had "no
   setter anywhere"; `setMilitary` refuses `arInfo` and `scl` by name; departure, recovery,
   on-station, datalink, control type and frequencies are not FDR fields at all.
2. **Mode 1/2 must never be ATC-writable** (§3.10.3 rule 1; defect D24). `WRITABLE_PATHS` excludes
   them by construction, and that has to survive.
3. **The ATO's date is the planner's real-world date, its times are in-game** (decision H68).
4. **The human's rulings**: adopt the ATO's Mode 3 when the allocator accepts it (H64); paste or
   drop only, and only one ATO is ever active (H65); callsigns over 7 characters lose vowels from
   the back (H60); warn on 6xxx codes (S-L3).

## Decision

### The import is two wire messages, and the server re-parses

- `efsp-ato-preview` (read-only, answered to the sender, never logged, not a `…-mutation`) returns
  what an import *would* do: every line with its preselected action, its bind candidates, its
  missing acceptance fields, its warnings, the AR groups, and the flights an earlier ATO tasked that
  this one does not mention.
- `efsp-ato-mutation` (`op.kind: 'ImportAto'`) carries **text and choices only**. The server
  re-parses, refuses with `STALE_REV` if the text's SHA-1 is not the one previewed, validates every
  choice against its own re-parse (a `BIND` must name one of that line's recomputed candidates), and
  creates each line through the **existing** `CreateStrip` (ADR `0054`) with a clientMutationId
  derived per line (`<cmid>#<lineId>`), so a replayed import is idempotent line by line; a handler
  cache (200) returns the first ack verbatim. Best effort: a refused line is reported, the others go
  on. One audit entry records the import (never the text); each line is also audited as the
  `CreateStrip` it is. One `efsp-board-delta` carries every new Strip and every touched FDR.
- **Who**: Primary at `TAC_C2` **at TACTICAL** (the per-Facility binding of `_handleMutation`,
  not "Primary somewhere"). `[SOURCE-DEFINED]` `ATO_IMPORT_ORIGIN`: TACTICAL / TAC_C2 /
  `tac-c2-tasked` / `main`. Tanker lines land there too; `tac-c2-tanker` stays inert (it implies no
  state, and the first NLA would move a Strip out of it anyway).
- The client never sends a seed, a code or a parsed field (`ato-import.js`).

### The ATO's facts live on the flight's FDR, through one setter

`fdrStore.applyAtoTasking(fdrId, tasking, { by })` is the **only** writer of `identity.modeOne`,
`identity.modeTwo`, `military.scl`, `military.arInfo` and the new `fdr.ato` sub-object (the rest of
the line: mission type, departure/recovery, on-station, report-in point, control, targets, remarks,
missing acceptance fields, the ATO's Mode 3 and datalink, and `atoRef`). It gives those fields
their first writer. It is outside `WRITABLE_PATHS` and `MILITARY_WRITABLE_FIELDS` (both
byte-identical to before), refuses unknown keys, validates everything before writing, sets
provenance `'ATO'` and bumps `rev` once. No new store: FDRs already persist, restore, snapshot and
ride the board-delta, and a join keyed by `fdrId` is what MARSA and correlation already do. Readers
treat an absent `fdr.ato` as none (`createFdr` is untouched).

`tasking.mode` says how the flight met the ATO:

- **CREATE** (a new FDR from the line's seed): every seed path is marked `'ATO'`.
- **BIND** (a flight already filed): a seed path is filled only where the flight has nothing yet;
  the filed flight's own values stand and are reported as kept.
- **UPDATE** (a re-import, matched on the ATO line id, Q55(a)): a seed path is replaced only while
  its provenance is still `'ATO'`. A value a controller typed (`CONTROLLER_ENTERED`) is kept and
  the preview lists it as the controller's (§10.2 rule 3). Everything else the ATO owns is replaced.

**Contract C1** (L16): `fdr.ato.departure.timeUtc` is epoch ms, in-game Zulu, or `null`.

### The beacon code — answering ADR 0054's inherited question (H64)

On a **newly created** flight the ATO's Mode 3 is **adopted** as `identity.beaconAssigned` when
`codeAllocator.validateAssignment` accepts it, and the code `createFdr` just minted is released
(one code per flight, no pool leak); a duplicate is adopted with `DUPLICATE_IGNORED_WARNING`,
never refused (D23). A reserved, 6000–6777 (the AI block, S-L3) or malformed code is not adopted:
the minted code stays and the preview says so (`MODE3_NOT_ADOPTED`). On a **bind or an update the
assigned code is never touched** — the ATC code is authoritative (§3.10.3 rule 3), and the ATO's
code sits in `fdr.ato.iff.modeThree`.

When the two differ, **every** Strip of the flight shows an amber `M3 ATO <code>` chip and the
sentence *"ATO tasks Mode 3 4521; ATC assigned 4533. The ATC code stands unless coordinated."*,
until the codes agree. Nothing prefers either code silently. Recording the coordination instrument
that would resolve it is **not built** (Q-L14-9); the convention is `[SOURCE-DEFINED]`.

### Binding: the Mode 3/A first, the callsign as the fallback — and nothing binds without a confirm

A line's candidates are the flights with a live non-MISSION Strip on any Board and no live MISSION
Strip on TACTICAL: those whose assigned code equals the ATO's assignable Mode 3, or, only when there
are none, those whose callsign equals the line's. Exactly one candidate on the callsign, or one on
the Mode 3 **with the same callsign**, is preselected `BIND`; two or more, or a Mode 3 match on a
flight with **another callsign**, preselects `CREATE` and lists them, with `MODE3_HELD_BY_OTHER`
saying why (a squawk match across callsigns is as likely a clash as the same flight; ambiguity is
an answer, ADR `0046`). The preview is the confirm — one input for the whole ATO — which is what
keeps this on the right side of ADR `0054`'s rejection of *automatic* Mode 3/A binding.

The **ATO-first** direction is the caller change 0054 promised: when OPS types a callsign that an
ATO mission flight has and that flight has no ATC Strip, the toolbar's bind picker offers "file
against ATO mission `<msn>`" (picked only when exactly one matches) and sends `CreateStrip` with
`op.fdrId` — no new flight, no new code, no server change.

### Only one ATO is active (H65)

A new import **replaces** the previous one in this sense: every line it shares with a flight an
earlier ATO tasked (and whose MISSION Strip is live) is an `UPDATE` that rebinds that flight to the
new ATO (`fdr.ato.atoRef` names the new message); a flight the new ATO does not mention is **listed,
never dropped** — its Strips and its old `fdr.ato` are left exactly as they were. Nothing is torn
down by an import. `MSGID … /CHG/` needs no special case: every import diffs.

### Dates: the mission's calendar (H68)

One pure helper applies one **whole-day shift** to every time in the document (`atoDateShift`,
`redateAtoTime`): the middle of the ATO's `TIMEFRAM` (or of its own times, without one) is moved by
whole days to the calendar day nearest the mission clock's now. Every time keeps its time of day and
its day within the ATO (the second day of a 0600Z–0559Z ATO stays the second day), and a mission
flown in either calendar day of the period sees the period around it. The raw DTGs are stored
unchanged beside the re-dated epochs, and an `ATO_DATE_DIFFERS` note names both dates. The mission
clock is injected (H11); nothing reads the wall clock.

### Callsigns (H60)

`ato/callsign-fit.js` `fitCallsign()` runs on L3's normalised callsign: vowels are cut from the back
to the front until it is 7 characters (`ENFIELD11` → `ENFLD11`, `SHADOW11` → `SHADW11`). One that
still does not fit returns `null` and its line waits for a controller to type a callsign. The same
rule lives in miztoyaml's `ato_callsign` (L25, ADR `0089`); a test holds the two to the same nine
cases. They differ on purpose in one edge: miztoyaml leaves an unfittable name uncut for a planner
(atobrief then warns `CALLSIGN_NOT_SEEDABLE`), the import returns `null`. `[SOURCE-DEFINED]`.

### The AR join is a badge, and it is not MARSA

`military.arInfo.links` holds, per flight, `{ role, peerFdrId, peerLineId, peerMissionNumber,
peerCallsign, arcp, windows }` (`role` is this flight's role), resolved at import from L3's AR links
(`tankerLineId`/`receiverLineId` → the flight that line created, bound or updated; a skipped line
falls back to the flight an earlier ATO tasked on it). On the Strip: an `AR SHELL71` / `AR ×2` badge
in tone `'on'` (not a warning, ADR `0058`), after MARSA; selecting any participant highlights the
others' Strips (`efsp-strip-ar-participant`, not the MARSA colour). Peers are resolved at render
time, so a dropped receiver leaves the group without its tanker's record being edited, and the
join is part of the Strip's render signature. **Nothing about the join declares MARSA, writes the
MARSA store or touches `fdr.tofi`** (tested: no relation, every `separationRegime` unchanged), and no
control on the badge dispatches anything.

Mode 1/2, the ATO's Mode 3, datalink, SCL, mission type, agency, on-station time, AR detail and the
missing fields show as **read-only rows** in the ▼ view of every Strip of the flight, whatever its
Role — no Block, no editor (§3.10.3 rule 1; `block-map.js` is untouched).

## Consequences

- WP7's three bullets are test names in `crc-sync/tests/efsp-scenario-ato.test.mjs` (bullet 2 also in
  `crc-desktop/tests/efsp-ato-strip.test.js`); the caveat is asserted in `ato-ingest.js`,
  `ato-board.js` and `callsign-fit.js`.
- M6/M7 still render the raw epoch until L16's time rendering merges (contract C2).
- An import that applies nothing (every line skipped or refused) changes nothing, including which
  ATO the flights point at.
- A re-import bumps every touched FDR's `rev` even when no value changed (its `atoRef` did).
- Not built: the coordination-instrument capture for a Mode 3 conflict; fetching the ATO from
  atobrief (H65 says paste/drop only).

## Supersedes / changes

- Answers ADR `0054`'s inherited question (above). ADR `0054` itself is not edited (P4).
- Gives `identity.modeOne/modeTwo`, `military.arInfo` and `military.scl` (ADR `0052`'s
  "present and unpopulated") their first and only writer.
- `tac-c2-tanker` remains inert, as `facility-config.js` says.
