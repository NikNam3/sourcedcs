# 0118: Conflict Alert is between tracked targets, a Mode C intruder has its own alert, formations and MARSA are grouped, and a receiver under MARSA is checked against the refueling block

**Status.** Built (lane LT-MARSA, 2026-10-13), for live-test findings T14 to T18 (`docs/parallel/live-test-2026-10-11.md`)
and H134 LT-RQ16. Rulings: decisions.md **H134** (LT-RQ10 note, LT-RQ15 a, LT-RQ16 a), **H136** (VQ7 a, VQ8 a),
**S-ARCH-56** (tracked = correlated). Research: `docs/parallel/research/live-test-faa.md` Q6, Q7, Q12;
`docs/parallel/research/vfr-flight-following.md` V4. **Amends** ADR 0058 (which pairs CA processes; conformance of a
receiver under MARSA) and ADR 0051 (the void notice has an acknowledgement). ADR 0099's formation Join is unchanged: the
tanker join is not one.

Editions (research, "Sources and editions"): JO 7110.65BB Basic 2-20-25 with Chg 1 to Chg 3 (7-9-26); JO 7610.14A
effective 8-7-25 with Chg 2 (7-9-26); JO 7210.3EE with Chg 1 to Chg 3 (7-9-26); P/CG with Chg 1 to Chg 3 (7-9-26).

## Context

The live test found: T14, the "MARSA voided" notice never went away; T15, after a void, clicking a field on one Strip
made the two Strips reorder; T16, conflict alerts between aircraft of one formation; T17, LEVEL_BUST on a receiver
climbing from its assigned altitude to the tanker after the tanker cleared it to join; T18, the question whether a tanker
join is MARSA or a formation Join. H134 LT-RQ16 a then put Conflict Alert on the FAA model.

What the orders say (quoted from the research):

- P/CG CONFLICT ALERT: *"... between tracked targets (known IFR or VFR aircraft) that require his/her immediate
  attention/action."* MODE C INTRUDER ALERT: *"... between a tracked target (known IFR or VFR aircraft) and an untracked
  target (unknown IFR or VFR aircraft) that requires immediate attention/action."*
- JO 7210.3EE ¶12-6-12 (STARS): *"b. MCI Alert base altitude must be set at any value between ground level and 500 feet
  AGL ..."*; *"d. Facility air traffic managers are authorized to inhibit the display of MCI Alert at specified
  sectors/position."* ¶8-2-5 (ERAM): *"b. MCI Alert base altitude must be set at any value between ground level and 5,000
  feet MSL ... When a facility's or sector's ground level is above 5,000 feet MSL, base altitudes may be set to 1,500
  AGL."* ¶12-6-3 b: *"Display Mode C on untracked (unassociated) targets ..."*
- JO 7110.65BB ¶5-13-1 c.1(b) (ERAM): *"The Group Suppression (SG) function must be applied exclusively to inhibit the
  displaying of alerts among military aircraft engaged in special military operations where standard en route separation
  criteria does not apply."* NOTE: *"... i.e., air refueling operations, ADC practice intercept operations, etc."*
  ¶5-14-6 c.2 (STARS): *"The inhibit function must only be used to inhibit the display of CA for aircraft routinely
  engaged in operations where approved separation criteria do not apply."*
- ¶2-1-13: *"Control formation flights as a single aircraft. Separation responsibility between aircraft within the
  formation rests with the flight leader and the pilots of the other aircraft in the flight."* c.1: *"For a standard
  formation only the aircraft acting as the lead will squawk an ATC assigned beacon code ... Ensure all other aircraft
  squawk standby."* P/CG FORMATION FLIGHT a: standard formation *"no more than 1 mile laterally or longitudinally and
  within 100 feet vertically from the flight leader"*.
- ¶9-2-13 NOTE c: *"MARSA begins between the tanker and receiver when the tanker and receiver(s) have entered the air
  refueling airspace and the tanker advises ATC that he/she is accepting MARSA."* NOTE d: *"MARSA ends ... when the
  tanker advises ATC that the tanker and receiver aircraft are vertically positioned within the air refueling airspace and
  ATC advises MARSA is terminated."* c NOTE 3: *"Upon rendezvous completion, the tanker must keep receiver aircraft within
  3 miles of the tanker until MARSA is terminated."* d NOTE: *"Altitude or course changes issued will automatically void
  MARSA."*
- JO 7610.14A ¶5-5-3 c: *"1. Headings and altitudes assignments may be made with the tanker concurrence with MARSA
  remaining in effect. 2. Each tanker must keep receiver(s) aircraft in either standard or nonstandard formation until
  further ATC clearances are received and approved separation is achieved."* ¶5-5-6 a: *"All aircraft require 1,000 feet
  separation between the lowest tanker altitude and the applicable receiver altitude from the track ARIP to ARCP or from
  the ARIP to anchor point."* ¶5-5-1 d: *"... should request and be assigned at least three (3) consecutive
  altitudes/flight levels."* ¶5-5-7 d: the tanker is responsible for *"Receiver navigation ... after rendezvous
  completion through completion of refueling operations"*.

## Decision

### 1. Which pairs alert (H134 LT-RQ16 a)

Our "tracked" is a track correlated to a Strip, `CORRELATED` or `PROVISIONAL` (both put the flight's identification on
the label, P/CG ASSOCIATED; S-ARCH-56). `conflict-alert.js`:

| Pair | Alert |
|---|---|
| two tracked | **CA** (`kind: 'CA'`), IFR or VFR alike |
| tracked and untracked, the untracked one reporting altitude | **MCI** (`kind: 'MCI'`, `intruder: <trackId>`) |
| tracked and untracked primary-only (no transponder reply) | nothing (H136 VQ8 a; inference from the name) |
| two untracked | nothing |

The old header rule "Not suppressed: a pair with no Strips. Two unknowns can still collide" is gone. "Reports altitude"
is our transponder model: the target's transponder replies (`transponders.transponderOf`), which is Mode C here
(ADR 0059); it is decided server-wide, not per session sensor (ours).

### 2. MCI base altitude and inhibit (H136 VQ7 a)

A new optional facility key, `modeCIntruder: { baseAltitudeFt, reference: 'AGL'|'MSL', highTerrainAglFt?,
inhibitedPositions? }`, validated against ¶12-6-12 b (AGL: 0 to 500) and ¶8-2-5 b (MSL: 0 to 5,000). Shipped: INCIRLIK
and CARRIER 500 ft AGL; CENTER 5,000 ft MSL with `highTerrainAglFt: 1500`; nothing inhibited. A file without the key gets
the terminal default (500 ft AGL). Read once at start-up (P5).

An MCI is delivered like a CA (to a session at an ATC Position with both contacts in its picture) **and** only when one
of the session's signed-on Positions shows it: an ATC Position, not in its Facility's `inhibitedPositions`, with the
intruder above that Facility's floor (`mciFloorFt`): AGL, the ground plus the base; MSL, the base, or the ground plus
1,500 ft where the ground is known to be above 5,000 ft. The ground is crc-sync's terrain store (MapTiler DEM). **Where
the ground is not known** (no `CRCSYNC_MAPTILER_KEY`, or the tile not cached yet) it is taken as sea level, and the
high-terrain rule does not apply (ours). The per-session filter runs in the hub (`conflictAlertFor`, never sent). The
inhibit is facility configuration, not a controller button: ¶12-6-12 d gives it to the facility manager.

### 3. Formations and MARSA are groups (T16, research Q7)

The effect of a standing ERAM Group Suppression / STARS inhibit: no CA/MCI between aircraft of one group. A group is one
flight's flight data (a formation is one flight data, ADR 0099), or, while an ACTIVE MARSA relation holds it, the whole
relation. Alerts against everybody outside the group stay.

**Ours: how an uncorrelated wingman is known to be a member.** In DCS a wingman may still squawk, so it is an
uncorrelated target with altitude and would raise MCI against its own lead. An uncorrelated airborne target within
`formationLateralNm` (1 NM, the P/CG standard formation) and `formationVerticalFt` (1,000 ft; the P/CG's 100 ft is too
tight for DCS wingmen stacking) of a tracked flight whose `flightSize > 1` is taken as a member: the nearest ones, at most
`flightSize - 1`, each to its nearest lead (`formationMembers`). A member is tracked for alerting as part of its formation
(the periphery idea of ¶5-5-8): a non-member tracked aircraft gets a CA against each member, an untracked one an MCI. The
recognition uses only what radar shows (position, altitude), never the DCS group.

### 4. Air refueling (T17, T18, H134 LT-RQ10)

**T18:** the tanker join is MARSA with the tanker (¶9-2-13, 7610.14A ¶5-5-3), never a formation Join: the receiver keeps
its flight plan, Strip and code. The orders call the post-rendezvous cell a nonstandard formation for navigation and
airspace, which §3 above gives it for alerting while MARSA lasts. Nothing in the app turns a tanker join into a
`JoinFormation`, and nothing new does.

**T17:** a receiver in an ACTIVE relation with `startEvent: 'TANKER_ACCEPTED'` is no longer checked against its own
assigned heading or altitude (the tanker navigates for it, 7610.14A ¶5-5-7 d; ATC's altitude assignment no longer
governs the climb to the tanker). It is checked against **the refueling block relative to the tanker**
(`evaluateRefuelingBlock`):

- vertically, `refuelingBlockFt` (1,000 ft) above and below the tanker's altitude. **Ours** (H134 LT-RQ10): the orders give
  1,000 ft between the tanker's lowest altitude and the receiver before the rendezvous (¶5-5-6 a) and three consecutive
  altitudes for the AR block (¶5-5-1 d), but no vertical limit relative to the tanker after it;
- the ordinary wrong-way logic, measured from the block: outside it and moving away faster than `wrongWayFpm` is
  `WRONG_WAY` (2,000 ft below and climbing toward it is fine; 1,350 ft below and descending is not); having been inside
  it, more than `levelBustFt` (our usual 500 ft buffer) outside is `LEVEL_BUST`; both carry `block` and `tanker`;
- laterally, `refuelingLateralNm` (3 NM, ¶9-2-13 c NOTE 3, 7610.14A ¶5-5-3 c): having once been within it, outside it is
  the new kind `TANKER_DISTANCE` (`nm`, `limitNm`, `tanker`). Not before the receiver has closed, so the rendezvous from
  far out never alerts.

The tanker is the participant the ATO tasks as one (`military.arInfo.asTanker`), else the one whose callsign is the
declaring callsign (the tanker declares; matching is ours). The tanker keeps its ordinary checks (ATC cleared it). A
relation whose tanker cannot be told, or whose tanker track is not correlated, leaves its receivers with no altitude or
heading check at all (H134 LT-RQ10 a's fallback). When the relation ends or voids the receiver is back on its own
clearance on the next tick. Other MARSA start events (MTR entry, local declaration) keep ordinary conformance.

### 5. The void notice is acknowledged (T14, H134 LT-RQ15 a)

The orders are silent about a notice. A new MARSA op, `AcknowledgeVoid`, on a `VOIDED` relation not yet acknowledged,
sets `voidAcknowledgedAt` (mission clock) and `voidAcknowledgedBy` (the acting Position) and records a
`VOID_ACKNOWLEDGED` transition. The wire gate refuses it (`PERMISSION_DENIED`) unless the acting Position owns a live
Strip of one of the participants. The client shows the void (badge, red reason line and an exchange row with
**Acknowledge**) on every participant Strip until then, and nothing after.

### 6. A protected Strip holds its place in the Rack (T15)

The Rack reconciler skipped a protected Strip (one being edited, dragged or with a popover open) without stepping its
cursor past it, so any render while the edit was open inserted every Strip below it above it, and the order flipped
back when the edit closed. After a void the click itself causes that render (selection, and the participants'
signatures). Fixed in `bay-view.js`: a protected Strip at the cursor moves the cursor past it. Spec
`e2e/l1-marsa.spec.js` "T15" fails on the old reconciler and passes now.

## Wire

`efsp-alerts` `conflictAlert` entries gain `kind` and, for an MCI, `intruder`; conformance alerts gain `tanker`, `block`
on the refueling kinds and the kind `TANKER_DISTANCE`; MARSA relations gain `voidAcknowledgedAt`/`voidAcknowledgedBy`;
the `efsp-marsa-mutation` op kinds gain `AcknowledgeVoid`. `npm run wire:record`: the protocol stays 2 (the last release
speaks 1). The persisted MARSA shape accepts the two new keys.

## Consequences

- A pair of uncorrelated contacts never alerts. A VFR aircraft with no Strip is only ever an MCI intruder; "Start flight
  following" (S-ARCH-56) turns its future MCI into a CA.
- The client draws an MCI exactly like a CA (red, on the Strip, the data block and the scope overlay), tagged `MCI` and
  named "Mode C Intruder"; a track in both shows `CA`.
- A manual suppress of one alert (the FAA "CO"/suppress) is not built (silent for our design; not needed for T16).
