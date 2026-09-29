# 0059 — sensors decide what the wire says: one presentation function, a transponder model, and a datalink feed

## Context

A controller asked why a track correlated to a Strip did not show the Strip's callsign. Following the
question showed that the label and the Strip had never been connected, and that the label was not
made from what a controller could know at all:

- **Every contact carried DCS ground truth to the client**: raw callsign, type, coalition, player
  flag, true altitude. The radar picture (`0042`) decided only *whether* a contact was seen. Once
  seen, a primary-only contact on a 2D approach radar still showed its callsign and flight level.
- **The label came from `resolve.js`**, which predates EFSP: the squawk map, then a controller
  rename, then a `TN#####` for hostile contacts, then the raw DCS callsign. The squawk map was a stand-in
  for flight plans. Correlation (`0045`, `0046`) published which flight a contact is and never fed back
  into its name.
- **Label logic was spread** over the map's data block, the track panel, the bind picker, the
  correlation badge, the conflict text, a client-only ground-label map and the squawk panel. Changing
  how a contact is named meant finding all of them.
- **Two existing bugs** were found along the way:
  - `coverage.js` replaced a track's radar list every tick with only the radars that hit it on that
    tick. A second controller's radar sweeping a contact withdrew it from the first controller's
    picture, or stamped it with the other radar's time.
  - Correlation's beacon rung read the SRS code even when the transponder was switched off.

In the real system these are separate layers, each with its own evidence:
- a primary return gives a position;
- the tracker gives speed and course;
- a transponder reply to an interrogating radar gives the code, and Mode C gives the pressure altitude;
- correlation with a flight plan gives the callsign;
- a 3D radar gives a height with no help from the aircraft;
- on the tactical side, the datalink gives its own participants' identities.

Decisions the controller made:
- the squawk map goes;
- AI aircraft squawk a synthetic code (own and neutral coalitions only; hostile AI does not);
- a player with no SRS client has no transponder;
- the datalink feature is remade as a proper feed;
- a correlated Strip's callsign beats a controller's tag;
- the wire carries only what sensors know;
- STCA is for ATC positions only, and only when both aircraft are in the controller's picture.

## Decision

### One function decides the wire: `surveillance/presentation.js`

`presentTrack(track, ctx)` is the only place a wire track is built. `ws-hub.js` calls nothing else.
Its output is an allow-list, and nothing outside it is ever sent:

```
{ id, lat, lon, domain: 'AIR'|'SEA'|'GROUND', onGround, illuminatedAt, sources,
  iffState, iffOverride,
  label: { callsign, source: 'FDR'|'FDR_PROVISIONAL'|'DATALINK'|'TAG'|null, tag, trackNumber },
  type, ssr: { code, ident, emergency } | null,
  altitude: { ft, ref: 'QNH'|'STD', source: 'MODE_C'|'RADAR'|'DATALINK' } | null,
  dl: { lock } | null }
```

It runs **per session**, against the sensors of that controller's own Positions:

| The controller's sensors… | …give |
|---|---|
| any radar return | position (`PRIMARY`) |
| a radar with `caps.ssr`, when the transponder is on | the code, ident, emergency, and a Mode C altitude (`SSR`) |
| a radar with `caps.height` | an altitude with the transponder off (`HEIGHT`) |
| the datalink, for a participant | callsign, type, altitude, radar lock (`DATALINK`) |

Where more than one source gives an altitude, Mode C wins, then radar height, then datalink. We
have no real Mode C, so the number itself is computed as before: DCS true altitude through
`altimetry.js`, on QNH below transition and standard pressure above. What changed is **when** it is
sent. Only a radar that saw the contact within two of its own sweeps counts, so a radar that lost the
contact a minute ago does not still lend it an altitude.

The label is chosen in this order:
1. the correlated flight's callsign;
2. a provisional match's callsign, flagged `?` on the client;
3. the datalink callsign;
4. the controller's tag;
5. nothing.

With nothing, the client falls back to the code, then the track number. `type` comes from the FDR,
else the datalink, else it is null. An enemy on the ground (`iffState` `invisible`), or a contact no
current sensor has, is not sent at all.

### Radars say what they can measure

`buildRadars` gives every radar `caps: { height, ssr }`:

| Radar | height | ssr |
|---|---|---|
| airport, approach, carrier approach | no | yes |
| AWACS, fighter, carrier search | yes | yes |

A per-type `caps` in the spec overrides these defaults. `config/radar-specs.json` is now
**`config/sensor-specs.json`**, the one home for everything a sensor can know: radar types,
carrier radars, datalink participants and period, and which coalitions' AI squawk. All of it is
`[SOURCE-DEFINED]`.

Illumination is now kept **per radar**, as `trackId → Map<radarId, at>`, and a session's view of it
uses only its own radars, which fixes the vanishing-contact bug.

### What the transponder sends: `surveillance/transponder.js`

- **A player** squawks what SRS reports. No SRS client, or status 0, means no transponder.
- **Own and neutral AI** squawk a synthetic code from **6000–6777**, stable for the unit's life, and
  released when it leaves or the mission reloads.
- **Hostile AI** does not squawk.
- **Ships and vehicles** have no transponder.

`code-allocator.js` never allocates the synthetic block and refuses it as an override ("reserved for
uncontrolled traffic"), so no FDR can hold one. Correlation's beacon rung is fed the code the
transponder is actually **sending** (`beaconOf`). A switched-off transponder no longer
beacon-correlates, and an AI never does. It correlates on its raw callsign or not at all.

### Who a contact is: `surveillance/identity.js`

This is the same for every session: the correlated FDR (callsign, type, provisional or not), the tag,
and a track number. **Every** contact gets a track number from `track-numbers.js`, sequential, which
moves out of `collab-store.js`. `labelFor()` is the one name for a contact where there is no
per-session picture, which is the STCA text.

**Correlation still matches the raw DCS callsign**, never the label (`0046`'s first half, unchanged).
The label now comes from correlation itself, so matching on it would let a correlation confirm
itself. The squawk-map negative test is replaced by one that pins this.

`0046`'s other half ("display resolved": the Strip badge shows the contact's resolved callsign) is
**superseded**. A correlated contact's label is the Strip's own callsign, so the badge would repeat
it. The badge now names the contact by its own reference instead: `TRK 4521`, or `TRK TN00042`.

### The datalink feed: `surveillance/datalink.js`

This replaces `grpc-client.js`'s `_playerUnits` and `_pollRadarLocks`. The old poll never worked: it
read `row.active` and `row.targetLat`, which its Lua never set, and it logged every poll.

- **Participants** are own-coalition units of a type in `datalink.participants`, players and AI
  alike. Each reports every `pliPeriodMs` on its own phase.
- **Locks** are polled every `lockPollMs` in one `Eval`: `Unit.getByName(n):getRadar()` →
  `target:getName()` → contact. The target object `getRadar` returns has not been checked against
  live DCS yet.
- **The grant** is a selector kind, `{ kind: 'datalink' }`, in `positionRadars`, given to
  TAC_C2/AIC/GCI. It matches no radar, so the sweep, terrain prewarm and unresolved-selector report
  all skip it. Coverage carries `datalink: true`.
- **A participant is visible to a datalink session with no radar.** A lock is sent **only when its
  target is already in that session's picture**: the datalink never reveals a position the
  controller's own sensors have not.

### Sending it: `ws-hub.js`

There is **one hub timer** instead of one per session. Each tick:
1. The datalink ticks.
2. Every contact is described once: identity, IFF, transponder. A fingerprint of who it is (IFF,
   correlation, FDR callsign and type, tag) bumps a per-contact label revision when it changes.
3. Each session gets a delta with three parts:
   - `updated`: a new return from one of its sensors;
   - `relabeled`: identity only, with no new position, so a correlation, bind, FDR edit, tag or
     declaration shows at once without waiting for a sweep, and only for contacts already in the
     picture;
   - `gone`: contacts that left the picture.

This replaces "every source pushes a dirty id", which would have needed a hook in five places and
missed the sixth. The `TrackStore` and `CollaborativeStore` delta logs, the no-picture "send
everything" mode, and every squawk-map message are deleted.

### STCA is for ATC

`efsp-alerts` is sent per session:
- **Conformance** is about a flight and goes to everybody.
- **A conflict** goes only to a controller holding a `MILITARY_ATC` or `CIVIL_ATC` Position
  (coverage `stca: true`), and only when both aircraft are in their picture.

This amends `0058`, which broadcast every conflict. Military positions and radars do not do
collision avoidance the way ATC does. A conflict's text names each aircraft by `identity.labelFor`.

### The client: `track-label.js`

This is the only code that turns a wire track into text: name, provisional `?`, code line (`EMR`,
`RDF`, `HIJ` in the emergency colour), altitude (marked `*` for radar height and `L` for datalink),
info line, picker row, type, whether a ship or vehicle gets a data block (once tagged), and whether
the tag is editable (not while a flight or datalink names the contact). Its consumers are the map's
data block and icons, the track panel, the bind picker, the correlation badge and the formation
declutter.

Deleted from the client:
- the squawk panel;
- client altimetry, `resolveCallsign`, `checkOnGround` and `squawkEmergency`;
- `groundLabels` (a vehicle's label is now the shared tag);
- the "show AI units" toggle (a radar does not know who is a player);
- `radarLocks` and the old lock message;
- the "DCS units" intercom group;
- the track panel's flight-plan lookup by callsign, and its proxy. The correlated FDR *is* the flight
  plan, and the route overlay reads it.

The coalition toggle stays: the airport panel uses it for bullseye, and it drives nothing about the
picture.

## Consequences

- A contact reads as its sensors allow:
  - an uncorrelated AI on an approach radar shows its 6xxx code and Mode C;
  - a player with no SRS shows only a track number there;
  - an AWACS shows a bandit's height marked `*`;
  - a correlated flight shows its Strip's callsign the moment it correlates.
- Formation declutter now needs a code and Mode C on both contacts, and compares codes as octal (it
  compared them as decimal before).
- Vertical rate exists only when an altitude does.
- Radar labels in the coverage panel use the unit's own DCS callsign: the radar is the controller's
  own sensor, not a contact.
- Tests:
  - `presentation.test.mjs` has one case per sensor combination.
  - `ws-hub-wire-strictness.test.mjs` holds every sent key to the allow-list, asserts no truth
    leaks, and covers relabelling, the datalink lock leak and STCA scoping.
  - Also `transponder.test.mjs`, `identity.test.mjs`, `datalink.test.mjs`, the per-radar
    illumination regression in `coverage.test.mjs` and `ws-hub-coverage.test.mjs`, and
    `crc-desktop/tests/track-label.test.js`.

## Open

- **Auto-IFF still reads the DCS coalition** (`surveillance/iff.js`). That is truth leaking through
  colour, and it should come from IFF interrogation (Mode 4/5) instead.
- Whether an AI correlated to a Strip should squawk the Strip's assigned code.
- Magnetic vs grid heading (carried from `0058`).
- `Unit:getRadar()` returning a lock target needs a live DCS check.
