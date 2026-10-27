# U-CA-OWNER (ADR 0147, H176)

## What the guide/briefing should say
- Usage guide, conflict alert: "A CA is shown only at the Positions working one of its aircraft (holding its Strip, VFR
  strips included, both ends of a handoff until accepted); an MCI only at the tracked aircraft's Position. SUPPRESS is on
  your own aircraft's data block menu, or on the track panel's alert row; one click acknowledges it at every Position you
  are Primary at. It never suppresses it for the other controller."
- efsp-briefing: track control lives in `crc-sync/src/efsp/track-control.js`; the monitor's `_shownAt` is the one rule.

## Defaults taken
- A handoff in progress (HANDOFF/AIT INITIATED, an open `vfrHandoff`) shows the alert at both ends (briefing default;
  STARS routing not found, see the ADR).
- POINT_OUT/TRAFFIC replicas do not get the alert (they are a view of someone else's aircraft).
- The hub keeps the "both contacts in the session's picture" check on top of track control.
- Observer Positions of a session are shown the alert but a suppress from that session does not apply there, so a session
  that is Primary at A and Observer at B, both shown it, still reads "not suppressed" (`isConflictSuppressed` needs every
  shown Position). Rare; left as is.
- The client now sends one suppress frame (first target); the server expands it.

## Walks not done
- No suite, Playwright, freeze or soak was run (rule 7). `u-ca-owner.spec.js` is unrun: it relies on the fake DCS units
  being seen by AP, LC and PAR (field radars at LTAG), on `StartFlightFollowing` correlating to a real unit, and on AP
  reading LC's strip (posChar `T`). If the read scope hides LC's VFR strip from AP, the letter assertion is the one to look at.

## Findings for other lanes
- Rule 9: the suppress expansion acts at more than the one acting Position (by ruling H176, "one person, one acknowledgement").
