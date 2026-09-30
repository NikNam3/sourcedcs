# 0088 — ATC scopes draw contacts in the STARS scheme, chosen per contact per session

Decided by the human: H5, H41 (variant B), H47, H48, H49, H50, and H71 (the approved mockup
`docs/wip/L22-mockup.html` with its nine defaults). Amends nothing. It adds one field to the wire
track defined in `0059`, and `0059` itself is unchanged. Research: `docs/parallel/research/stars.md`.

## Context

Every scope drew every contact the same way, the tactical/GCI way. Colour meant **affiliation**
(`iffState`), and every contact had the same data block. That answers "whose side is it on?". A Tower,
Approach or Center controller needs a different answer: "what is my relation to it?". Is it mine,
coming to me, pointed out to me, someone else's, or nobody's? On the old scope ownership, handoffs and
point-outs were visible only on the Strips.

STARS is the FAA and DoD terminal system, and it is what a USAF RAPCON runs. It answers exactly that
question. H5 gave ATC Positions their own scheme, with "military (tactical) wins" where both kinds
of radar see a contact. H50 made the choice per contact from the Positions held.

## Decision

### Which scheme draws a contact: crc-sync decides, per session

`presentation.js` sends one more allow-listed key, `scheme: 'TACTICAL' | 'ATC'`:

1. a session holding **no ATC Position** (`coverage.stca` false) gets `TACTICAL` for every contact;
2. otherwise a contact is `TACTICAL` while the datalink reports it, or while any of the session's
   radars classed `TACTICAL` saw it within **two of that radar's sweeps** (`SCHEME_HOLD_SWEEPS`, the
   hysteresis of H41 S1);
3. otherwise `ATC`.

The client cannot work this out. `sources` says what was measured, not which kind of radar measured it:
an AWACS without height and an approach radar both give `PRIMARY, SSR`.

Radar kinds are classed once in `config/sensor-specs.json`, in its new `presentation` section. It is
read at startup and never written (P5). Airport, approach and CVN approach radars are `ATC`. AWACS,
fighter and ship search radars are `TACTICAL`. `buildRadars` stamps the class on every radar record.
A CVN's approach radar is `carrierApproach`, even though its `type` is `carrier`. A change of whether an ATC
Position is held now re-sends the picture, as a change of radars already did.

### Position letters are Facility config

`positionLetters` in each Facility config gives the one character an ATC scope draws on a contact
that Position owns. The defaults are TWR `T`, APP `A`, CTR `C` (OPS `O`, CD `D`, GND `G`), and `M` for
every tactical Position. A letter must be one character A-Z or 0-9 on a known Position. The EFSP
snapshot carries them all (`positionLetters`).

### The client draws what the controller's relation is

`crc-desktop/app/public/js/atc-scope.js` works the relation out from the EFSP Board every client
already has. The owner is the ATC Strip that still holds the flight: a sender's Strip stops owning
once its handoff is ACTIVE, and a receiver's replica owns only once it is. A point-out never moves
ownership. While TOFI is ACTIVE, or its EXIT is still PROPOSED, the owner is the tactical side, with
letter `M` (H48). `track-label.js` writes the block (`atcBlockLines`).

| Relation | Block | Colour | Character |
|---|---|---|---|
| mine | FDB | white | my letter |
| handoff to me, proposed | FDB, blinking | white | sender's letter |
| pointed out to me | FDB with `PO`, blinking; steady once accepted | yellow | owner's letter |
| someone else's (or `M`) | PDB `alt gs` | green | owner's letter |
| uncorrelated, squawking | LDB `code / alt` | green | `*` |
| uncorrelated, primary only | none | — | `+` |

Every contact has a blue fused-target disc under its character, and a coasting contact has no disc.
Line 0 stacks indicators by severity: `EM`/`RF`/`HJ` (red, blinking until clicked), `CA` (red,
blinking until clicked), `SA` (yellow, steady: a shared `hostile` declaration, H47), then the
`0058` conformance tag in the app's own colours. An emergency or a conflict forces an FDB.
Altitude is Mode C only, in three digits. Ground speed is in tens of knots, alternating every 2 s
with the flight plan's type. The assigned values carry a trend arrow: `A060↓ H250`. The heading shown
is the controller's typed, already magnetic value, and nothing here converts a bearing. History is
five blues, and it never shows identity.

**Local, never synced.** A click on the target accepts a handoff or point-out offered to me (the
same `ACCEPT` mutation as the Strip's button). If nothing is offered, it acknowledges what is blinking,
steps a finished exchange down (white → green → PDB), or opens a PDB into an FDB. A click on the block still opens the track panel,
and a drag still moves it. A blink after an accept happens only for a change this scope saw happen,
so a reconnect shows the settled picture. A same-Facility transfer, which has no PROPOSED step, blinks
at the sender too.

**Coast (H41 S6)** is client-only. A correlated ATC contact whose returns stop for two of its slowest
ATC radar's sweeps shows `CST` in its altitude field, with no disc, at its dead-reckoned position.
It stays for the app's existing fade window and is then gone.

**"ATC Map Background"** is a personal setting, next to Elevation Contours, and on by default.
Turned off in a session where every radar is `ATC` and there is no datalink, it gives a black scope
with the strict STARS palette (the measured TCW values). The coastline and runways are dim gray, and
contours, rivers and names are hidden. The conformance tag and the CPA overlay stay either way.

## Consequences

- Tactical scopes are unchanged. A tactical-only session never sees an ATC contact.
- A mixed session (e.g. TAC_C2 + APP) shows both schemes side by side. A contact flips when a
  tactical radar gains it, and flips back two of that radar's sweeps after losing it. While a
  tactical radar sees an APP-owned flight, it loses its STARS cues, and the Strip still shows the ownership.
- `iffState` is not drawn on ATC contacts, except that a declared hostile carries `SA`.
- ATC blocks use Roboto Mono (Regular, and Medium for the character). MapTiler's glyph endpoint
  serves both.
- Not built (stars.md §5.4): scratchpads, CWT letters, MSAW, PTL, altitude filters, beacon-select,
  `WHO`, Quick Look, Dwell, the STARS received/assigned code pair (a provisional correlation keeps its
  `?`), and aural alarms.
- ERAM for CTR (H41) is a later lane of its own. It would need `scheme` to grow a third value, or a
  client-side choice.
