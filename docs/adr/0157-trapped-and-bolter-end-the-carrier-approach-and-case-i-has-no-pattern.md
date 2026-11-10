# 0157: TRAPPED and BOLTER end the carrier approach, and Case I has no pattern

**Status.** Built (2026-11-10). Amends, without editing (P4): ADR 0156 §1 (the recovery's states), §4 (BULLSEYE's button,
CV_PATTERN's DROP), §5 (Case I's CV_PATTERN), §10 (the MARSHAL row's one button) and its Built note "Counting".
[SOURCE-DEFINED]: the human's rulings of 2026-11-10 (decisions H179-H181); CV NATOPS was not re-read for this.

## Context

ADR 0156 ended every recovery with a DROP: Case II/III went BULLSEYE → TO PATTERN → CV_PATTERN → DROP, and Case I went
from the Marshal's SGNL C into PriFly's CV_PATTERN → DROP. That records neither the trap nor the bolter, puts a Case I
flight in a "pattern" the human says Case I does not have, and leaves PriFly no Strip for a jet that is on deck again.

## The rulings (2026-11-10)

1. **Case II/III.** After FLY BULLS the controller gets **two options, TRAPPED and BOLTER**. BOLTER keeps the Strip with
   the same lane, in the pattern (CV_PATTERN), where TRAPPED / BOLTER are offered again. TRAPPED hands the Strip to
   **PriFly**, and the jet is **ON DECK**: PriFly can DROP it, or launch it again.
2. **Case I.** SGNL C still hands the Strip from the Marshal to PriFly, but not into a pattern state: Case I has only the
   Marshal stack. PriFly's new state offers TRAPPED / BOLTER; BOLTER keeps it there, TRAPPED puts it on deck as in 1.
   Abort to the Case II/III stack works from the new state.
3. With PriFly not present (staffed or consolidated), TRAPPED is inhibited ("no receiving Position present").

## Decision

1. **`SIGNAL_CHARLIE`** is the new `CV_RECOVERY` state (PriFly's alone): the flight is cleared to land ("Charlie" is the
   Navy signal; the name collides with no other strip type's state, ADR 0074's rule). The Strip and the panel show
   SIGNAL CHARLIE. PriFly's Bay `cv-prifly-pattern` is now **`cv-prifly-charlie`** (implies SIGNAL_CHARLIE). `CV_PATTERN`
   is the lanes' only (Case II/III); PriFly no longer owns it.
2. **The NLA keeps its one primary action and gains siblings: `also`.** `computeNla` may return `also`, a list of further
   next actions, each a carrier handoff (`carrierHandoff`, the CarrierHandoff op) or the drop (`toState: 'DROPPED'` alone,
   the DropStrip op), each with its own `inhibited` when it has one. `nlaStatusFor` puts the list on the wire as
   `strip.nla.also` **even when the NLA itself is inhibited**: BOLTER stays live beside a TRAPPED with no PriFly. The shaping
   is one small module (`crc-sync/src/efsp/nla-also.js`); the client draws it with one leaf
   (`crc-desktop/.../efsp/nla-also.js`) on the Strip (beside the NLA button) and on the MARSHAL row (a second button), so
   both are visible buttons, never a menu item only. N siblings, not two: precedent was ADR 0156's single `alsoHandoff`
   (TO MARSHAL beside DROP), which is now `also` with one entry; FINAL's `alsoLegal` is a drag rule, not a button, and stays.
   A drag into a Bay implying a sibling handoff's state is refused with that button's name, as for the NLA's.
3. **Four new rows in `CARRIER_HANDOFFS`** (doctrine stays data, the Board reads it; the client mirror is drift-tested):

   | Row | Label | From | To | Case (flight's) | States | Becomes | Stack |
   |---|---|---|---|---|---|---|---|
   | `TRAPPED` | TRAPPED | APP1, APP2 | PriFly | II, III | BULLSEYE, CV_PATTERN | CV_LAUNCH ON_DECK | remove, no close-up |
   | `BOLTER` | BOLTER | APP1, APP2 | same | II, III | BULLSEYE, CV_PATTERN | CV_RECOVERY CV_PATTERN | none |
   | `CASE_I_TRAPPED` | TRAPPED | PriFly | same | I | SIGNAL_CHARLIE | CV_LAUNCH ON_DECK | remove, no close-up |
   | `CASE_I_BOLTER` | BOLTER | PriFly | same | I | SIGNAL_CHARLIE | CV_RECOVERY SIGNAL_CHARLIE | none |

   One row per Case rather than one row with a per-state target: a row has one `toState`, and the Case I pair is PriFly's
   own (no hand-off), so two rows keep each one's sender, receiver and target plain.
4. **The buttons.** Case II/III at BULLSEYE and CV_PATTERN: **TRAPPED** (the NLA, to PriFly; inhibited "no receiving
   Position present" when PriFly is neither staffed nor offered to anyone) with **BOLTER** beside it. Case I at
   SIGNAL_CHARLIE: **TRAPPED** (PriFly keeps it) with **BOLTER** beside it. The Marshal's SGNL C now goes to SIGNAL_CHARLIE.
5. **TRAPPED is the inverse of LAUNCH_TO_MARSHAL**: the same Strip, flight and squawk become `CV_LAUNCH` at ON_DECK in
   PriFly's launch Bay (`previousLeg` records the recovery), and the existing launch flow follows. **DROP is reachable from
   ON_DECK in every Case**: Case I's NLA is DROP (TO MARSHAL beside it); Case II/III's NLA is LAUNCHED with **DROP beside
   it** (new), which stays when LAUNCHED is inhibited. The ✕ drop is unchanged.
6. **Stack effect.** TRAPPED removes the flight from its stack with a vacancy and no close-up (`REMOVE_NO_CLOSE_UP`, H28),
   as a drop of the recovery did: the flight has landed, and a later TO MARSHAL can append it again. BOLTER moves nobody.
   TRAPPED also clears the approach's HDG, SPD and ALT (as Back to stack does), so a relaunch carries none.
7. **Counting: the trap is the landing.** `CV_RECOVERY`'s `countablePreDropStates` is now empty: a recovery that is dropped
   (a divert, an error) never landed here. The trapped Strip is a launch and is counted once when it is dropped, as
   CV_LAUNCH's ON_DECK (or later) drop already is; `classifyLocality` reads a launch whose `previousLeg` is a recovery as
   having landed on the hull, and departed it too when it was dropped past ON_DECK. One Strip still makes one count
   record (ADR 0109's rule): a trap followed by a relaunch is one record with two legs.
8. **Abort to the Case II/III stack** is offered from STACK and SIGNAL_CHARLIE (no longer CV_PATTERN):
   `ABORT_TO_STACK.states`, `permission.js` `mayActBesideOwner` (the Marshal on PriFly's Strip) and `carrier-menu-rules.js`.
9. **LAUNCHED assigns a squawk when the flight has none** (`assignsCode`): a Case I jet that trapped and is launched again
   in Case II/III. A launch created in Case II/III already has one, so nothing else changes.
10. **The MARSHAL panel.** SIGNAL_CHARLIE is its own row kind (`charlie`), first in the Case I table like the flights on the
    approach; the carrier map draws it in the landing pattern (the spin rule as for CV_PATTERN). The trapped jet leaves the
    panel (a launch is never on it).

## Consequences

- `WIRE_PROTOCOL` bump: new handoff kinds, a new state, the `also` key (`wire:record`; the supervisor runs it).
- Freeze goldens holding carrier NLAs, Bays or the permission tables are re-recorded.
- A `state/` copy of `efsp-facility-carrier.json` must be deleted (it names `cv-prifly-pattern`, which implies a state
  PriFly no longer owns); carrier Strips on a persisted Board are cleared by the mission reset, as in ADR 0156.
- Open: whether the trap should be counted at the trap rather than at the drop of the launch it became (a jet trapped and
  never dropped before the mission ends is counted only if the mission reset's drop is; not checked here); whether a
  bolter count per flight is wanted.
