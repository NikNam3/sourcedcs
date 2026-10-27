# 0147: A conflict alert is shown only at the Positions working its aircraft

**Status.** Accepted (lane U-CA-OWNER, 2026-10-27). Ruling: decisions.md **H176** (human: "are you sure that a positoin
that is not responsible for a flight should be able to see the colision alert in the first place?", then "jup que that
after the vfr redo"). **Amends** ADR 0118 (who an alert is delivered to) and ADR 0145 (where a suppress applies; the
label menu). Builds on ADR 0146 (a VFR strip's holder is `strip.ownerPositionId`, `vfrHandoff` names who was asked).

## Context

Until now the hub sent every CA to every session at an ATC Position that had both contacts in its picture, and every MCI
to every one whose Facility let the intruder through (`ws-hub.js` `_efspAlertsMsg`, `ConflictAlertMonitor#deliverableTo`).
A tower controller saw, and could suppress, an alert between two aircraft only approach was working. S-ARCH-112 had also
opened the data block's menu for a non-owner in a suppressible CA.

FAA text (from `docs/parallel/research/live-test-faa.md` Q7, not re-read here):

- JO 7110.65BB ¶5-14-6 is written from the working controller's side: when an alert is displayed, evaluate it and act;
  "If another controller is involved in the alert, initiate coordination"; c.4: *"CA/MCI alert may not be suppressed or
  inhibited at or for another control position without being coordinated."* ¶5-13-1 c.2 (ERAM): the suppress entry
  *"constitutes acknowledgment for the alert"*.
- The exact STARS display routing (which TCWs show a CA) is in the STARS operator manuals and site adaptation, not in the
  orders. Searched (faa.gov 7110.65 ch. 5 §14, 7210.3 ch. 12 §6; no STARS manual is public): **not found**.
  `docs/parallel/research/stars.md` §2.3 records vNAS/vice behaviour as "same at every involved scope", which is what this
  ADR builds: the involved scopes are the ones working the aircraft.

## Decision

1. **Track control** (`crc-sync/src/efsp/track-control.js`, `trackControlPositions`). The Positions with track control of
   a flight are the holders of its live Strips, in every Facility:
   - a Strip with no coordination: its `ownerPositionId` (VFR strips included);
   - a coordination whose primitive moves data ownership (`COORDINATION_EFFECTS[p].dataOwnershipMoves`: HANDOFF, AIT):
     INITIATED both ends (the transferring Strip and the receiver's minted replica), ACTIVE the receiver's replica,
     otherwise (REJECTED, …) the transferring Strip;
   - any other primitive (POINT_OUT, TRAFFIC, OPERATIONAL_REQUEST): the original only, never the replica;
   - an open `vfrHandoff`: the holder and the Position it names, until ACCEPT or RECALL.
   A handoff in progress counting at both ends is **ours** (H176's default; the STARS wording was not found). It mirrors
   the client's data-block owner rule (`atc-scope.js` `owners`), plus the in-progress case.
2. **CA:** shown at an ATC Position with track control of either aircraft. **MCI:** at an ATC Position with track control
   of the tracked aircraft, and there only where its Facility's base altitude and inhibit let the intruder through
   (ADR 0118, `mciShownAt`). A formation member counts as its lead's flight. Everyone else: nothing; two untracked:
   nothing (unchanged). The hub keeps its "both contacts in the session's picture" check. `ConflictAlertMonitor#_shownAt`
   is the one rule; `deliverableTo`, `presentFor` (`shownAt`) and `setSuppressed` all use it.
3. **A works one aircraft, B the other:** both are shown it, each with the other's Position letter on the other data
   block (the coordination cue), and each suppress is at their own Position only (¶5-14-6 c.4). Suppressing at another
   controller's Position after coordination stays **not built**.
4. **One person, one acknowledgement.** A suppress or restore from a session applies at the acting Position and at every
   other Position that session is Primary at where the alert is shown (`setSuppressed(…, { alsoAt })`). An Observer
   Position is left alone (its Primary is someone else). The client sends one frame (`conflict-suppress.js`). The ack and
   the frames are unchanged: no wire change.
5. **The label menu:** SUPPRESS is offered only on the data block of a contact whose Strip the controller holds. A conflict
   alert no longer opens the menu by itself (S-ARCH-112's extension is removed); the other aircraft's block opens the
   track panel, whose alert row still suppresses and restores.

## Consequences

- A tower or approach controller with nothing to do with either aircraft no longer has a flashing CA.
- An aircraft with no live Strip of anyone's (correlated but its Strip dropped) alerts nobody; that is the H176 ruling.
- Tests: `crc-sync/tests/conflict-alert-owner.test.mjs`; `crc-desktop/tests/label-menu.test.mjs` (owner-only SUPPRESS);
  `crc-desktop/e2e/u-ca-owner.spec.js` (two sessions and a consolidated one, real server, fake DCS units);
  `crc-desktop/e2e/u-ca-suppress.spec.js` updated (no SUPPRESS on a contact with no Strip of the controller's).
