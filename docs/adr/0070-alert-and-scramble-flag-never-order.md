# 0070 — Alert and scramble (§9.6): Block 14E, a Board-wide flag, and no ordering

## Context

Guide §9.6, whole:

> `M16` ∈ `{NONE, ALERT, SCRAMBLE}`.
> **Alert status is a ground-movement constraint at least as much as an air constraint**. Verified
> local rules: taxiing aircraft yield to alert scrambles; aircraft must not block runway access from
> the alert pad; a specific taxiway is kept clear for alert scrambles.
> Implement: a `SCRAMBLE` Strip MUST raise a Board-wide priority indication, and MUST mark the
> configured alert-pad access route as constrained, with any conflicting taxi Strip flagged.
> **[GAP] Do not implement a scramble/interceptor priority *ordering* from this guide.** FAA JO
> 7110.65 §2-1-4 and §9-2-7 were not read. Until then, `SCRAMBLE` raises an indication and the
> controller decides.

Before this ADR, `fdr.military.alertStatus` existed, was seeded `NONE` and was validated by
`setMilitary()`, but had no Block. ADR `0052` left it that way on purpose: "no natural parent; §9.6's
own decision". ADR `0061` (L1) added the field-state store, with an alert pad in INCIRLIK's config
(a placeholder name, decisions.md H21) and an `alertPad {occupied, occupantFdrId}` record with no
ops. ADR `0065` (L5) gave the traffic count an `alertScramble` category. It is latched from any logged
Mutation of a Strip whose FDR reads `SCRAMBLE`.

## Decision

### M16 is Block `14E`, on DEPARTURE only

`'14E': { target: { kind: 'military', field: 'alertStatus' } }` sits on `DEPARTURE_BLOCK_MAP`, after
`14C`. `MILITARY_BLOCK_NAMESPACE.M16` names it (`blockId: '14E'`). This keeps ADR 0052's convention of
a sub-letter on a parent Block, and never an `M`-id on an ATC map.

- **Why the 14-family.** 14, 14A–14D are the release model: release time, release state, EDCT, call
  for release and void time. A scramble is a release decision: it launches a flight now.
- **Rejected: `3H` on all three ATC Roles.** The 3-family is the airframe (type, wake, tail, unit,
  home station, hook, ordnance; ADR 0052). Alert posture is not a fact about the airframe, and an
  ARRIVAL/OVERFLIGHT alert status means nothing.
- **Rejected: `2B` on DEPARTURE.** The 2-family is the Strip's identity. Alert status does not
  identify the flight.
- **DEPARTURE only.** Only a departure sits on an alert pad. The namespace drift test reads only
  `DEPARTURE_BLOCK_MAP`, so a separate test requires `14E` to be absent from ARRIVAL, OVERFLIGHT and
  MISSION.

The write goes through the ordinary `SetBlock`, which `board-store.js` already routes to
`setMilitary()` for a `military` target. So every write is a **logged Strip Mutation**
(decisions.md S-L5): the audit sees it, and L5's traffic-count latch counts it with no call into
`traffic-count.js`. Permission is unchanged: the Strip's owner writes it.

On the client the Block is labelled `ALERT` and is an enum `<select>` of `NONE`/`ALERT`/`SCRAMBLE`.
`NONE` is the cleared value and is in the list, as `3G`'s `CLEAN` is. It is on the **OPS, CD, GND
and TWR** DEPARTURE grids: OPS sets it (decisions.md H56), and every ground Position shows it.

### A SCRAMBLE is a flag: nothing orders, inhibits, moves or transfers

The `[GAP]` is binding, and the code honours it in four places:

1. `crc-sync/src/efsp/alert-scramble.js` is pure. It computes who is scrambling and which Strips
   are flagged. Nothing on the server calls it to change a Strip.
2. `nla.js` never reads the alert status. Its comments now say why an alert-pad conflict is a flag
   and not an inhibit, and the diff is comment lines only. A test asserts that `computeNla` gives the
   same answer for every DEPARTURE and ARRIVAL state whatever the alert status, and that the word
   `alertStatus` does not appear in `nla.js`.
3. The sortie snapshots every other Strip's `orderKey`, Bay, Rack, owner and NLA before the scramble
   and compares them after. The Playwright walk compares the Strip order in `gnd-taxi-out` and
   `twr-runway-queue` in the DOM.
4. The verified local rules appear only as reason text, labelled "SOURCE practice", never as
   FAA/USAF doctrine: "taxiing traffic yields and the alert-pad access route stays clear;
   sequencing is the controller's call".

### When a scramble is active

A scramble is active while the FDR's `alertStatus` is `SCRAMBLE` **and** the flight has a live
DEPARTURE Strip in a pre-airborne state. The pre-airborne states are `PROPOSED`, `PENDING_CLEARANCE`,
`CLEARED`, `HELD`, `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE` and `LUAW`. At `DEPARTED` or `DROPPED` the
indication ends by itself, because it is derived from state. **Nothing resets the field.** It keeps
`SCRAMBLE` for the audit and the latch. Only a controller's `SetBlock 14E` writes it. A cancelled
scramble is set back to `ALERT` or `NONE` by hand.

### Which Strips are flagged — `[SOURCE-DEFINED]`

A Strip is flagged when it belongs to the scrambler's Facility (never another Facility) and is on
the movement area:

- a DEPARTURE at `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE` or `LUAW`;
- an ARRIVAL at `LANDED` or `TAXI_IN`.

A scrambler is never flagged, whether it is this scrambler or another one. This goes beyond the WP6
plan's three states (`PUSHBACK`/`TAXI`/`RUNWAY_QUEUE`). The reason is "must not block runway access
from the alert pad": an aircraft lined up, or rolling out, blocks it just as a taxiing one does. A
test requires each state set to be a subset of its Role's states, so a state rename cannot silently
empty the set.

There is **no taxi-route model**, so the set covers the whole Facility. With a route model (taxiway
segments per Strip, and the alert pad's access route as a list of segments) it would narrow to the
Strips whose cleared route crosses or holds on the access route, plus anything on the scrambler's
departure runway. Inventing taxiway geometry until then would be fabricated doctrine (D11).

### The access route

INCIRLIK's `fieldState.pads.alert` gains one key: `accessRoute: 'ALERT ACCESS TAXIWAY'`. It is a
`[SOURCE-DEFINED]` placeholder name (H21): a name only, with no geometry. `validateConfig` rejects a
non-string `accessRoute` and checks nothing else. L1's store already spreads the pad config into the
`alertPad` record, so the name reaches the client with no store or wire change.

When no route is configured, or the client has no field state (L1b not loaded), the indication is
still raised. The route then reads "the alert-pad access route", with "(not configured)" added when
field state is known but has no route. §9.6's first MUST does not depend on config.

### The Board-wide indication

`#efsp-scramble-line` sits at the top of the Strip panel, above the connection banner. It is visible
on every Position tab for every connected controller, whatever they hold. It has one row per active
scramble at any Facility:

`SCRAMBLE  VIPER11  INCIRLIK · CLEARED · <route> constrained · 4 flagged`

Clicking the callsign switches to the owning Position's tab and Bay, if held, and selects the Strip.
A new row flashes once. There is no sound, and rows never collapse (H6). `refreshEfspPanel()` renders
it after every snapshot, delta and positions ack.

On the Strips, the scrambler gets a red `SCRAMBLE` chip. Each flagged ground Strip gets an amber one
with a reason line: "VIPER11 is scrambling from INCIRLIK. SOURCE practice: keep clear of `<route>`.
Clears when VIPER11 is airborne or the scramble is cancelled." `ALERT` alone lights nothing beyond
its `14E` field (ADR 0058: nothing is drawn for what is normal).

The chips go through strip-view.js's wave-2 hook, the same three edits made byte for byte by L1b,
L12 and L13: the `INDICATOR_ORDER`/`ALERT_SLOT_KEYS` line, the three hook calls in `_stripAlerts`,
and the `ALERT_SLOT_KEYS` condition in `_buildIndicatorSlots`. L1b's field-state panel reads
`alertPadConstraintFor(facilityId)`, which this lane defines.

### One rule set, two copies

The browser cannot load crc-sync's module, so `crc-desktop/.../panels/efsp/scramble.js` copies the
pure functions and the state sets by hand. `efsp-scramble-client.test.js` requires crc-sync's file
and runs both copies over one fixture table. The answers must be identical.

## Alternatives considered

- **Server resets `alertStatus` to `NONE` on `DEPARTED`.** Rejected. It is a write no controller
  made, which EFSP avoids. It would also hide the scramble from L5's latch if it ran first.
- **An inhibit on conflicting taxi Strips, or reordering the runway queue.** Forbidden by the
  `[GAP]`.
- **Deriving `alertPad.occupied` from an `ALERT` Strip.** Rejected. It would be a second place that
  says where an aircraft is. Occupancy stays present and unpopulated (§12; Q7).
- **An OPS-only permission for `14E`.** Rejected this wave. It would be a `permission.js` change, and
  that file belongs to L23 in wave 2. H56 chose "OPS sets it; every ground Position shows it". The
  Block is on OPS's grid, and the owner permission still applies (see Consequences).

## Consequences

- ADR 0052's "`alertStatus` … no Block, because picking its parent is §9.6's call" is now decided:
  `14E`. ADR 0052 is not edited (P4).
- ADR 0061's alert pad gains `accessRoute`. Its record is unchanged.
- ADR 0065's `alertScramble` counts a scramble set through `14E`, including one set back before the
  drop. The sortie proves both.
- ADR 0058 holds: `ALERT` is quiet.
- **H56 and ownership.** OPS can write `14E` only while OPS owns the Strip (`PROPOSED`). Once CD owns
  it, only CD can, and later GND or TWR. An OPS order while CD holds the Strip is refused
  `NOT_OWNER`. If "OPS sets it" is meant literally at every state, `permission.js` needs an
  OPS-may-write-14E rule. That needs a supervisor decision.
- The Mutation log records `op: 'SetBlock'` without the Block id or value. The audit therefore shows
  *that* 14E changed, but not to what. This is an audit-completeness gap, for L26.
