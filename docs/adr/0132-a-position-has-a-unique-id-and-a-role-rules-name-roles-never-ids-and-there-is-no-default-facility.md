# 0132: A Position has a unique id and a role; rules name roles, never ids, and there is no default Facility

**Status.** Accepted as the design (supervisor, 2026-10-20, at the human's request: "write the adr now so no future agents
use the same fallback"); built by lane **U-ROLE-POSITIONS** (queued). Rulings: decisions.md **S-ARCH-79** (what a second
airfield needs today), the human's 2026-10-20 note that one controller may hold LC together with CTR or AP. Builds on
ADR 0013/0025 (Facilities, Position classes), 0074 (the CARRIER Facility), 0110 (consolidation and hat offers). Supersedes
nothing; it binds every lane from now on, including ones that never add a Facility.

## Context

The human asked whether a second airfield (Konya, LTAN, with its own tower) can be added by writing a facility file.
It cannot, for three reasons found in the code on 2026-10-20:

1. **The facility files are a code table.** `crc-sync/src/efsp/facility-config.js` names four files in
   `FACILITY_CONFIG_FILES` and lists `SHIPPED_FACILITY_IDS = ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER']`, with one
   environment variable per file. A fifth `config/efsp-facility-*.json` is never read.
2. **Rules are written against Position ids.** Position ids are globally unique (`facility-config.js`
   `getPositionClass` comment; `permission.js`), and the rules name them literally: the departure state owners
   (`authority/strip-types/departure.js`: `TAXI: ['GC']`, `RUNWAY_QUEUE: ['LC']`, `HANDED_OFF: ['AP', 'CTR']`,
   `ctx.isStaffed('CD')`), `arrival.js`, `overflight.js`, `mission.js`, the Position families
   (`authority/positions/civil-atc.js` alone names `'LC'` 12 times), `combination.js` (`LOCAL = 'LC'`,
   `NON_LOCAL = ['OPS','CD','GC','AP','PAR']`), `position-store.js`, the carrier handoffs. The client mirrors them
   (`efsp-nla.js`, `runway-status-rules.js`, `bay/authority-mirror.js`, `panel/create-strip.js`, `formation-rules.js`,
   `combination-rules.js` and others). So `LC` *means* Incirlik's tower: a second tower cannot be called `LC` (the id is
   taken), and a `KONYA_LC` has no rights at all.
3. **Incirlik is a silent default.** `DEFAULT_FACILITY_ID = 'INCIRLIK'` (server `facility-config.js`, client
   `facility-topology.js`) is the default parameter of about 25 server getters, of `efsp-ws.js`'s three message handlers
   (`msg.facilityId || DEFAULT_FACILITY_ID`) and of the client's `sendEfspCreateStrip`. With one airfield it is
   harmless; with two, every call that forgets its Facility acts on Incirlik without an error.

The CARRIER Facility already shows the naming that works (`CV_MARSHAL`, `CV_PRIFLY`, `CV_APP1`, `CV_APP2`: unique,
prefixed ids), but its rules again name those ids.

**Holding several Positions decides the design.** One controller routinely holds Positions in more than one Facility:
Incirlik `LC` with `CENTER`'s `CTR`, or `LC` with `AP`. The held set is kept per Facility on the client
(`sendEfspSetPositions(facilityId, signedOn)`), Strip ops send `facilityId` and `actingPositionId`, but the airspace,
carrier and correlation wire families send **only** `actingPositionId` and find its Facility from the unique id. Any
design that reuses a Position id in two Facilities makes those messages, every held-set comparison and every bare
`positionId === 'LC'` check ambiguous.

## Decision

### 1. Identity: one globally unique Position id, never reused, never qualified

A Position is identified by its id alone, unique across every Facility, as today. **No two Facilities may use the same
Position id**, and no code may identify a Position by a `(facilityId, positionId)` pair. Start-up refuses a facility file
whose Position id another Facility already has (strict, naming both files, ADR 0095).

Incirlik keeps `OPS`, `CD`, `GC`, `LC`, `AP`, `PAR`; `CENTER` keeps `CTR`. A new Facility prefixes its ids with its own
name (`KONYA_CD`, `KONYA_GC`, `KONYA_LC`, `KONYA_AP`), as CARRIER does. No Board snapshot, Strip or wire id changes.

**Rejected: reuse `LC` per Facility and qualify by Facility.** It needs `facilityId` on every message that names a
Position (a wire change), on every Strip reference (`ownerPositionId`, coordination peers, hat offers, the audit), and
it turns every bare comparison into a place where Konya's tower is mistaken for Incirlik's. A controller holding both
towers would be ambiguous in the airspace, carrier and correlation families.

### 2. Every Position has a role, declared in its facility file

Each facility file gains `positionRoles: { <positionId>: <role> }` beside `positionClasses`. Required for every Position
(strict: a missing or unknown role stops start-up). The role vocabulary is closed and lives in one module
(`authority/roles.js`): `OPS`, `CD`, `GC`, `LC`, `AP`, `PAR`, `CTR`, `TAC_C2`, `AIC`, `GCI`, `JTAC`, `CV_MARSHAL`,
`CV_PRIFLY`, `CV_APP`, `RANGE` (derived). Incirlik's roles equal its ids; `KONYA_LC`'s role is `LC`; `CV_APP1` and
`CV_APP2` are both `CV_APP`. A role is what a Position does; a class (ADR 0025) stays what kind of agency it is. Both
are read per Position.

### 3. Rules name roles, and always about one acting Position

Every rule, server and client, is written against **roles**: the state-owner tables (`TAXI: ['GC']` is a role list),
the Position families, combination, the carrier handoffs and their client mirrors. A rule is evaluated for **the one
Position that is acting**: `roleOf(actingPositionId)` and `facilityOf(actingPositionId)`. When a rule needs "the CD"
(`ctx.isStaffed('CD')`), it means `positionWithRole(facilityId, 'CD')`, the Position with that role **in the Strip's
Facility**, never a search across Facilities.

**Forbidden from now on** (a test enforces the first two, see §8):
- a literal Position id in a rule, a state table or a client mirror (ids belong in facility files and tests only);
- asking whether a controller holds "any" Position with a role (`signedOn.some(p => roleOf(p) === 'LC')`) without
  naming the Facility;
- picking the acting Position by role when the controller holds that role in two Facilities. The client acts as the
  Position the Strip's Facility gives, or asks.

### 4. There is no default Facility

`DEFAULT_FACILITY_ID` is removed from server and client, and so is every default `facilityId` parameter. A message's
Facility is the Facility of its acting Position (§1 makes that unique); a message that names a `facilityId` not matching
its acting Position, or a Strip op whose acting Position is not in the Strip's Facility (except the cross-Facility
coordination primitives, which already name both sides), is refused (`FACILITY_MISMATCH`, a new refusal code). A getter
without a Facility is a programming error, not Incirlik.

### 5. Who hands to whom is configuration

The topology the rules hard-code today moves into the facility file, as Position ids (unique, §1), never roles:
- `departureHandoff`: where a departure goes after LC (Incirlik: `AP`; a field with no approach: `CTR`);
- `arrivalFrom`: who may hand an arrival to this field's approach or tower (Incirlik `AP`: `CTR`);
- `consolidation` lists may name **another Facility's** Position (a Konya with no approach staffed:
  `KONYA_AP: ['CTR']`), so CTR can take Konya's approach hat; the hat offer (ADR 0110) is then cross-Facility, and the
  Strips stay in their own Facility.

A handoff always goes to the Position id the topology names, never to "an AP somewhere".

### 6. Facility files are discovered

crc-sync reads every `config/efsp-facility-*.json` (and its `state/` override, ADR 0048); the Facility id is the file's
`facility` key and must be unique. The per-file environment variables are replaced by one directory override for tests
(`CRCSYNC_EFSP_FACILITY_DIR`). RANGES stays derived.

### 7. The client shows the Facility where it matters

Labels add the Facility only when a controller holds the same role in two Facilities (`KONYA LC`, `INCIRLIK LC`);
otherwise they stay as today. Panels that belong to one Facility (runway status, PAR, frequencies, the SFA rack) show
the Facility they are for and offer the others the controller holds. The positions frame carries each Position's role
(a new key: `npm run wire:record`, ADR 0103).

### 8. Proof

- A test fixture Facility `TESTFIELD` (`TF_CD`, `TF_GC`, `TF_LC`, roles `CD`/`GC`/`LC`, `departureHandoff: 'CTR'`) is
  added by a facility file only, with no code change, and a departure runs CD → GC → LC → CTR on it.
- A source scan test (like `no-window-globals`) fails on a quoted Position id in `crc-sync/src/efsp/**` or
  `crc-desktop/app/public/js/panels/efsp/**` outside an allow-list of id-free files, and on `DEFAULT_FACILITY_ID`.
- The holding walk below, each row as a test (server) and the two-tower rows as a Playwright spec.

## The holding walk

| One controller holds | What must hold |
|---|---|
| Incirlik `LC` + `CTR` | As today. A departure LC hands to CTR still needs both presses (the conversation collapses, the state changes are real). The MRU/non-ATC refusal (ADR 0025) is evaluated for the acting Position. |
| `LC` + `AP` (one Facility) | As today: consolidation and hat offers inside Incirlik. |
| `KONYA_LC` + Incirlik `LC` | Two towers. Every rule takes its Facility from the acting Position or the Strip; a Konya Strip is never acted on as Incirlik `LC`. Runway status, PAR and frequencies show which field. |
| `KONYA_LC` + `CTR` | Konya departures go to `departureHandoff`; with `KONYA_AP` unstaffed, its hat is offered to `CTR` by `consolidation` (cross-Facility), Konya's Strips stay Konya's. |
| `KONYA_LC` + Incirlik `AP` | Incirlik's approach is not Konya's: a Konya departure is never offered to `AP` unless Konya's topology names it. |
| `TAC_C2` + `LC` | An MRU and an ATC Position: the coordination refusal applies to the MRU acting, not to the controller. |
| `CV_APP1` + `CV_APP2` (one role twice, one Facility) | Both act as `CV_APP`; the Strip's owner decides which Position acts. |

## Consequences

- No backward compatibility (P1): the facility files gain `positionRoles` (and `departureHandoff`, `arrivalFrom`), and a
  `state/` facility override without them stops start-up, naming the file.
- Incirlik's ids do not change, so Board snapshots, the Mutation log and the freeze goldens keep their ids; the goldens
  re-record only where the facility hash or the positions frame changes.
- Adding an airfield becomes: a facility file, its airspace and radar entries, its frequencies. Anything more is a
  defect against this ADR.
- Until U-ROLE-POSITIONS lands, the rule for every lane is already §3 and §4: no new literal Position id in a rule, no new
  use of `DEFAULT_FACILITY_ID`, no "holds any LC" check.
