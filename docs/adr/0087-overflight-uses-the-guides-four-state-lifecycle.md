# 0087 — OVERFLIGHT uses the guide's four-state lifecycle, and can be handed to the next Facility

## Context

`EFSPImplementationGuide.md:214`, under §3.4's `[SOURCE-DEFINED]` tables, gives the OVERFLIGHT
lifecycle: `INBOUND` → `IN_SECTOR` → `HANDED_OFF` → `DROPPED`. ADR 0023 built `TRANSITING` →
`DROPPED` instead, and its comments said the guide had no such table. L9's inventory (D10, F24,
F27, F32) found that wrong, and decision H63 chose the guide's own states. A second defect came with
the two-state shape: an overflight could never propose coordination (F14, `coordination.js`), so a
CTR overflight that entered APP's airspace had no way to reach APP.

## Decision

### The states, the labels and the owners

`OVERFLIGHT_STATES = ['INBOUND', 'IN_SECTOR', 'HANDED_OFF', 'DROPPED']` (`nla.js`, mirrored in the
client's `efsp-nla.js`). A new OVERFLIGHT Strip starts `INBOUND`. The **state names are the
guide's. The NLA labels and the owners are ours**, like every other `[SOURCE-DEFINED]` table here.

| State | NLA label | Result | Owners |
|---|---|---|---|
| `INBOUND` | Radar Contact | `IN_SECTOR` | APP, CTR |
| `IN_SECTOR` | Leaves Sector | `HANDED_OFF`, **no `transferTo`** | APP, CTR |
| `HANDED_OFF` | Drop | `DROPPED` | APP, CTR |

`IN_SECTOR`'s NLA is "the flight leaves our airspace for an agency this server does not model", so
nothing is transferred and nothing is occupancy-gated. The label is "Leaves Sector" and not "Hand
Off" (questions-round3 Q3-11): a controller who wants to hand the flight to **our own next
Facility** uses Coordinate/HANDOFF, as at ARRIVAL's CENTER `INBOUND`, and the big button must not
read as that.

`INBOUND` and `HANDED_OFF` are also ARRIVAL's and DEPARTURE's state names. States are per Role, and
nothing keys on a bare state without its Role (a test pins the set of source files that name those
two literals).

### Coordination (F14) and the replica's state

`COORDINATION_ELIGIBLE_STATES.OVERFLIGHT = 'IN_SECTOR'`: an IN_SECTOR overflight may propose all
five primitives. `TOFI_ELIGIBLE_STATES.OVERFLIGHT` moves from `TRANSITING` to `IN_SECTOR`.

**H74: the guide's table is one sector's view of a flight.** An overflight handed to our next
Facility is `INBOUND` there and walks the four states again. This **supersedes ADR 0022's "the
replica carries the sender's state" for OVERFLIGHT only**: `board-store.js`'s
`REPLICA_STATE_ON_RECEIPT = { OVERFLIGHT: { IN_SECTOR: 'INBOUND' } }` is read in
`receiveCoordinationProposal`, with a fallback to the sender's state, so ARRIVAL and DEPARTURE are
unchanged. On a **HANDOFF accept** the sender's Strip moves `IN_SECTOR` → `HANDED_OFF` (it has left
its sector, and may now Drop): `SENDER_STATE_ON_ACCEPT`. POINT_OUT and TRAFFIC change no state on
either side. A rejected HANDOFF leaves the sender `IN_SECTOR`.

### Bays imply no state (H75)

`app-overflight` and `ctr-overflight` no longer imply `TRANSITING`. This **supersedes ADR 0023's
implied state**: one Bay per Position holds the overflight in every live state, and the state is on
the Strip. Because INBOUND and HANDED_OFF are shared names, a Bay that implied a state by name could
file an overflight under ARRIVAL's `INBOUND` Bay, so the two Bays carry a new descriptor field,
`holdsRole: 'OVERFLIGHT'`. For a Strip whose Role has such a Bay at its owner's Position:

- no Bay implies its state (`_validateBayImpliedTransition`), and a drag into another Role's
  state-implying Bay is refused;
- a state change never relocates it (`_relocateForImpliedState`);
- a new owner, and a coordination ACCEPT, place it in that Bay (`_bayForNewOwner`,
  `_applyCoordinationAccept`).

The shipped `config/efsp-facility-{center,incirlik}.json` carry the Bay lists (the loader spreads
on-disk JSON over the defaults), so both change with the defaults.

### The traffic count

`COUNTABLE_PRE_DROP_STATES.OVERFLIGHT = ['IN_SECTOR', 'HANDED_OFF']`, judged on the state **at the
drop** like every other Role: an overflight counts once it was worked. One dropped while still
`INBOUND` is excluded as `NEVER_TRANSITED` (name and meaning kept: it never worked the sector).
The count stays **per Facility** (ADR 0065): a flight handed CTR → APP is a record at each, because
each Facility worked it. This is the existing rule for ARRIVAL and DEPARTURE replicas, not a new one
(questions-round3 Q3-12).

### A persisted Board

A snapshot written by the old build holds `TRANSITING` Strips, a state their Role no longer has.
`overflight-migration.js`'s `migrateOverflightStates` maps them to `IN_SECTOR` (the flight was being
worked) in `index.js`'s `_restore`, beside the clearance migration, logged once with a count. It is
idempotent. It runs inside `createEfsp()`, before any mission-session roll-over (which is driven by
events after start-up), so the Board is legal when the archiver looks at it (Q3-31).

## What this supersedes, without editing it

- **ADR 0023**: the `TRANSITING` → `DROPPED` lifecycle and the claim that the guide has no table;
  the overflight Bays' implied state; the omission of OVERFLIGHT from the coordination-eligible
  states.
- **ADR 0022**: that a coordination replica always carries the sender's Role *and state*. Role
  still does; state does too, except an OVERFLIGHT's `IN_SECTOR`, which arrives `INBOUND`.
- **ADR 0031**'s TOFI gate row for OVERFLIGHT (`TRANSITING`) becomes `IN_SECTOR`.

## Not decided here

- An overflight that diverts to Incirlik has no conversion to ARRIVAL: drop and create (Q3-10).
- Who creates an OVERFLIGHT for a tanker or an MTR flyer: the controller decides (Q3-13).
- Dedicated overflight FDR fields (entry and exit fix) stay deferred, as in ADR 0023.
