# 0066 — a contact's IFF colour is what your interrogator got back, not its DCS coalition

Amends `0059` (closes its first Open item and replaces its "enemy on the ground is not sent" rule).
`0059` itself is unchanged; this ADR is the correction.

## Context

Every contact on the scope has a colour: friendly (blue), neutral (grey), bogey (yellow), bandit
(orange) or hostile (red). Bandit and hostile only ever come from a controller declaring them. The
other three were worked out automatically, and they were worked out from the **DCS coalition**: the
game's own record of which side a unit is on.

No real sensor knows that. `0059` rebuilt the picture so that the wire carries only what a
controller's own sensors know (a position from a radar return, a code and Mode C altitude from an
interrogating radar, a height from a 3D radar, a callsign from the datalink) and left one leak open:
the colour. Its own words were "Auto-IFF still reads the DCS coalition. That is truth leaking
through colour, and it should come from IFF interrogation (Mode 4/5) instead."

The leak showed in several ways:

- an own AI aircraft was blue on **every** scope, even a primary-only radar that never asked it
  anything;
- an own player was blue as long as their transponder was on, whether or not their Mode 4 was;
- an enemy player squawking a perfectly good code was still yellow, because the game said "enemy";
- an enemy aircraft on the ground was hidden outright (`invisible`), which again only the game could
  know.

What really answers "whose side is it on" is IFF interrogation. A military interrogator sends a
Mode 4/5 challenge; only an aircraft holding the right crypto keys (our side) can answer it
validly. A civil or ATC radar reads Mode 3/A (the code) and Mode C (the altitude), which anyone can
squawk. The datalink identifies its own participants. Everything else is silent.

## Decision

### The colour comes from what this controller's sensors got back

Evaluated top to bottom, first match wins:

| # | What this controller's sensors got | Colour |
|---|---|---|
| 1 | a controller has **declared** the contact | the declared colour |
| 2 | the contact **reports on the datalink** to this controller | friendly |
| 3 | one of this controller's radars carries a **Mode 4/5 interrogator** and the contact gave a **valid** reply | friendly |
| 4 | one of this controller's radars reads **Mode 3/C** and the contact is squawking | neutral |
| 5 | anything else: asked and got silence, or a radar that never asks | bogey |

Automatic IFF never says bandit or hostile. That stays a controller's call.

Row 4 (a Mode 3/C reply alone is neutral, not bogey) is an identification criterion the squadron
chose, not a doctrine: `[SOURCE-DEFINED]`. It keeps civil and neutral traffic grey and separates
traffic that answers from traffic that does not.

### It is worked out per controller

Only the radars of the Positions *this* controller holds count, and only those that saw the contact
on the current look (a radar that lost the contact a minute ago lends no colour, just as it lends no
altitude). So **two controllers can see the same aircraft in two colours**: the tower sees an own
fighter grey (it only reads its code) while the AWACS controller sees it blue (its Mode 4 answered).
That is correct: each is shown what their own equipment knows.

Where a controller holds both a tactical radar and an ATC radar that see the same contact, the
tactical (Mode 4) answer wins, since any radar with a Mode 4 interrogator answers row 3 (decision H5).

### Which radars carry a Mode 4/5 interrogator

| Radar | Height | Mode 3/C | Mode 4/5 |
|---|---|---|---|
| airport (tower) | no | yes | **no** |
| approach | no | yes | **no** |
| carrier approach | no | yes | **no** |
| AWACS | yes | yes | **yes** |
| fighter | yes | yes | **yes** |
| ship air/surface search | yes | yes | **yes** |

Tactical radars interrogate Mode 4; ATC radars do not. A radar spec in `config/sensor-specs.json`
can override this per aircraft type (`"caps": { "mode4": false }` for an airframe with no
interrogator). `[SOURCE-DEFINED]`, like every figure in that file.

### Who gives a valid Mode 4/5 reply

| Contact | Mode 3/C | Valid Mode 4/5 | Datalink |
|---|---|---|---|
| own player, SRS on, Mode 4 switch on | its code | **yes** | if its type is a participant |
| own player, SRS on, Mode 4 switch off | its code | no | if participant |
| own player, transponder off or no SRS client | none | no | if participant |
| own AI aircraft | synthetic 6xxx code | **yes** | if participant |
| own ship | none | **yes** | carriers are participants |
| neutral AI aircraft | synthetic 6xxx code | no | no |
| hostile AI aircraft | none | no | no |
| enemy or neutral player, any switches | its code, if on | **no** — wrong keys | no |
| neutral or hostile ship | none | no | no |
| any ground vehicle | none | no | no |

The coalition is still read in one place, the transponder model, and only to decide **what a
contact would transmit**: whether it holds our crypto keys. It is never read to decide a colour.
DCS AI has no IFF switch, so own AI aircraft and ships are assumed keyed
(`transponder.mode4For: ["own"]` in `sensor-specs.json`; no other side can ever be honoured there,
because the keys are ours). SRS has a single Mode 4 switch and no separate Mode 5; it is treated as
"Mode 4/5 reply enabled".

### Nothing is hidden on the ground any more

The old `invisible` state (an enemy aircraft on the ground was never sent) is gone. An aircraft on
the ground is presented like any other contact, coloured by the table above (decision H6: every
declutter behaviour stays off until the end of the EFSP work). Only the airport radar sees aircraft
on the ground at all, so in practice this is the tower's scope.

For the same reason the client's **formation label declutter** (sequential squawks flying close
together show only the lead's label) is switched off by default, and switched off once for existing
installs. The code is kept, and a controller can still turn it on in Settings > DECLTR. Both are to
be revisited at the end of the EFSP work.

### When a colour change reaches the scope

- A **declaration** (or clearing one) shows at once on every scope that has the contact, without
  waiting for a radar sweep, as before.
- An **automatic** change (a pilot switches Mode 4 on, a Mode 4 radar picks the contact up, a
  datalink report starts) shows with the **next radar return**, which is when a real interrogation
  would happen. If a contact is relabelled for another reason first (a tag, a correlation), the
  relabel carries the current colour, so a Mode 4 change can occasionally show a few seconds before
  the next sweep. That is accepted; caching each controller's last interrogation is not worth it.

## Alternatives considered

- **Coalition-free but global** (classify from the contact's own answers, ignoring which radars saw
  it). Smaller, but a controller with a primary-only radar, or an ATC radar with no Mode 4
  interrogator, would still be told "friendly": the aircraft's answer reaching someone whose sensors
  never asked the question. Rejected.
- **A new `unknown`/`pending` state** separating "not interrogated" from "interrogated, no reply".
  It changes the set of colours the client knows, needs new symbols, and would let controllers
  declare it. `bogey` already means "identity unknown" in GCI brevity. Rejected for now.
- **Ground clutter**: hide an aircraft on the ground unless it answers something (squawk or
  datalink), on the grounds that a parked aircraft is a stationary return filtered out by moving
  target indication. Rejected by decision H6 for now: no hiding until the end of the EFSP work.
- **A surface range gate**: the airport radar sees aircraft on the ground only within a few miles of
  itself, like a surface movement radar. Most realistic; belongs in the coverage model. A later
  refinement.
- **Moving aircraft on the ground as primary returns (MTI)**: would flicker at every hold-short. A
  possible later refinement.
- **Saying why a contact is friendly on the wire** (a `MODE4` entry beside `SSR`, `HEIGHT`,
  `DATALINK`): changes the wire and the client. A follow-up.

## Consequences

What a controller will see change (bold = different from before):

| Contact | Seen by | Before | After |
|---|---|---|---|
| own AI fighter, airborne | AWACS / GCI | friendly | friendly (Mode 4) |
| own AI fighter, airborne | approach or tower radar | friendly | **neutral** (code only) |
| own AI fighter, airborne | a primary-only radar | friendly | **bogey** |
| own player, SRS, Mode 4 on | AWACS | friendly | friendly |
| own player, SRS, Mode 4 off | AWACS | friendly | **neutral** |
| own player, SRS on | approach or tower radar | friendly | **neutral** |
| own player, no SRS, airborne | AWACS | bogey | bogey |
| own player, no SRS, datalink type | GCI with datalink | bogey | **friendly** (datalink) |
| neutral AI airliner | any radar reading codes | neutral | neutral |
| neutral AI airliner | a primary-only radar | neutral | **bogey** |
| hostile AI fighter | AWACS | bogey | bogey |
| hostile player, SRS on, Mode 4 on | AWACS | bogey | **neutral** (answers Mode 3, crypto fails) |
| hostile AI parked | tower | not shown | **bogey** (shown) |
| own AI parked | tower | friendly | **neutral** (its code) |
| own player parked, no SRS | tower | friendly | **bogey** |
| hostile player parked, SRS on | tower | not shown | **neutral** (shown, it squawks) |
| own carrier | GCI with datalink | friendly | friendly (datalink) |
| own escort ship | AWACS / ship radar | friendly | friendly (Mode 4) |
| neutral ship | ship radar | neutral | **bogey** |
| hostile ship | ship radar | bogey | bogey |
| own ground vehicle | tower | friendly | **bogey** (vehicles have no IFF) |
| neutral ground vehicle | tower | neutral | **bogey** |
| any contact, declared | any radar seeing it | declared | declared |

- **ATC scopes (tower, approach, carrier approach) go grey and yellow**: cooperative traffic is
  neutral, silent traffic is bogey, own or not. How ATC scopes draw their traffic is a separate
  decision (the STARS-style ATC draw scheme, decisions H5/H41); this ADR only decides what the
  sensors know. If the squadron wants own traffic blue on the approach scope, it is one line in
  `radars.js` (`approach: { mode4: true }`).
- **Pilots must switch Mode 4 on** to show blue on the AWACS scope. A player with Mode 4 off is
  grey there, like a civil aircraft.
- **A player with no SRS client** is a primary return: bogey, unless their type reports on the
  datalink to a controller who has it.
- The tower now sees every aircraft on the ground within its radar's reach, enemy ramps included
  when no terrain data masks them (`CRCSYNC_MAPTILER_KEY` is optional).
- The coverage message's radar records gain `caps.mode4`: that is the controller's own equipment,
  not a contact.
- Nothing about the contact that was not already on the wire goes on it. The truth-leak guarantee
  is now behavioural: with every sensor answer fixed, changing a contact's coalition or player flag
  changes nothing a controller receives (`presentation.test.mjs`, "THE coalition test").
- Code: `surveillance/iff.js` `classifyIff()` takes answers, never a track;
  `surveillance/transponder.js` `mode4Of()`; `surveillance/presentation.js` classifies per session;
  `ws-hub.js`'s label fingerprint keeps only the declaration; `radars.js` `caps.mode4`;
  `config/sensor-specs.json` `transponder.mode4For`.

## Open

- Whether an AI correlated to a Strip squawks the Strip's code (carried from `0059`).
- A surface range gate for the airport radar, and MTI for moving ground traffic (above).
- A `MODE4` source on the wire (above).
- Needs a live DCS + SRS check: an F-16 flips Mode 4 and changes colour on a GCI scope within one
  sweep while staying grey on approach.
