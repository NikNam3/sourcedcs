# 0145: A controller suppresses one conflict alert at their Position

**Status.** Accepted (lane U-VQ-AB, 2026-10-27). Ruling: decisions.md **H173** VQ-A a (keep the FAA definition: CA fires
on every tracked pair, IFR or VFR), with the human's note "but an option for the controller to cancell the ca so its not
blinking in its face the whole time". **Amends** ADR 0058/0118 (a conflict record the hub delivers carries `shownAt` and,
when suppressed, `suppressedAt`). H174 (VFR to be redone) leaves this untouched: the suppress is about a pair of tracks,
never a Strip, so it works on any tracked pair whatever VFR becomes.

## Context

ADR 0118 keeps a conflict alert off only by standing rules: one formation, active MARSA, a Position's MCI inhibit. Nothing
let a controller stop an alert they have seen and are handling. A VFR pair the controller has already called traffic to
flashes until the geometry ends.

The FAA text (quoted in `docs/parallel/research/live-test-faa.md`, Q7):

- JO 7110.65BB ¶5-14-6 c (STARS): *"1. The suppress function may be used to suppress the display of a specific CA/MCI
  alert. [...] 4. CA/MCI alert may not be suppressed or inhibited at or for another control position without being
  coordinated."*
- ¶5-13-1 c (ERAM): *"1. [...] (a) The Conflict Suppress (CO) function may be used to suppress the CA/MCI display between
  specific aircraft for a specific alert. [...] 2. The computer entry of a message suppressing a CA/MCI alert constitutes
  acknowledgment for the alert [...] 3. The CA/MCI alert may not be suppressed or inhibited at or for another control
  position without being coordinated."*
- JO 7210.3EE ¶12-6-7 b / ¶8-2-4 b are about a facility manager inhibiting CA at positions (standing, ADR 0118), not a
  controller's suppress. Neither order gives a time limit; "for a specific alert" is the limit.

## Decision

1. **The action.** A new message `efsp-conflict-suppress { conflictId, actingPositionId, suppress: true|false,
   clientMutationId }`, answered by `efsp-conflict-suppress-ack { clientMutationId, conflictId, suppress, ok, reason?,
   detail? }` (`wire/frames.js` `conflictSuppressAck`). Not a store op: nothing is persisted, nothing replays after a
   reconnect. The hub (`ws-hub.js` `_conflictSuppress`) refuses when the session is not Primary at the acting Position
   (`NOT_HOLDING_POSITION`), when either track is not in the session's picture or the alert has ended (`NOT_FOUND`), when
   the Position is not an ATC one (`PERMISSION_DENIED`) or the message is malformed (`VALIDATION_ERROR`); every code was
   already in `REFUSAL_CODES`. On success every session is sent its alerts again at once.
2. **One alert, one pair, one Position.** The monitor (`conflict-alert.js` `setSuppressed`) keeps the suppression per
   conflict id (the pair) and per acting Position, stamped by the mission clock (docs/adr/0079). It never extends to a
   third aircraft, and other Positions still see the alert in full (¶5-14-6 c.4, ¶5-13-1 c.3). The alert must be shown at
   that Position (`deliverableTo`), so an MCI inhibited there cannot be suppressed there.
3. **It lasts as long as the alert.** The tick that no longer finds the pair (it stopped alerting, or a track dropped)
   forgets the suppression, so the next alert between the same two aircraft is new and shown in full. No timer.
4. **What the session is told.** Each delivered conflict carries `shownAt`, the session's own ATC Positions it is shown
   at (where a suppress can be made), and `suppressedAt`, those of them where it is suppressed (`presentFor`). A
   suppression at a Position the session does not hold is never sent.
5. **Suppressed is not hidden (dark cockpit).** The client counts an alert suppressed when every one of its Positions it
   is shown at suppressed it. Then it stops flashing (the suppress is the acknowledgement, ¶5-13-1 c.2), no longer
   forces the full data block, draws no CA path, and a grey steady `CA` (or `MCI`) stays on both labels, on the Strip
   (grey indicator) and on the track panel's alert row. A second, live alert on the same track still flashes.
6. **Where it is clicked.** The track label's menu (ADR 0140) offers `SUPPRESS CA <other>` for every alert on the
   contact suppressible at one of the controller's Positions, Strip or not, owner or not; one click, the menu closes, no
   dialog. The track panel's alert row has `SUPPRESS`, and `RESTORE` on a suppressed one. The client names no Position:
   the targets are `shownAt` intersected with the controller's acting Positions.
7. **MCI.** The same action, since an MCI is a conflict record of the same monitor (ADR 0118); nothing extra.

## Consequences

- Wire: one client and one server message type (`tests/fixtures/wire-surface.json`); `shownAt`/`suppressedAt` are record
  contents, unscanned. The tree already carries protocol 2 against the last release's 1, so no further bump.
- The suppress is forgotten on a crc-sync restart, like the alert itself.
- Coordinated suppression for another Position (¶5-14-6 c.4 "without being coordinated") is not built: a controller
  suppresses only where they are Primary.
