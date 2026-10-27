# U-VQ-AB: conflict alert suppress (H173 VQ-A) and no invented Class E (H173 VQ-B)

Lane U-VQ-AB, 2026-10-27. ADR 0145. H174 (VFR redo) respected: nothing in `vfr-departure.js`, `CreateVfrDeparture` or
flight following was touched; the suppress is about a pair of tracks, never a Strip.

## What the usage guide should say (Conflict Alert section)

- A conflict alert (CA or MCI) can be **suppressed** for that pair at your Position: click the contact's data block and
  pick `SUPPRESS CA <other>` (any contact in the alert, your Strip or not), or click `SUPPRESS` on the alert row of the
  track panel. One click, no dialog. The suppress is also the acknowledgement (JO 7110.65BB ¶5-13-1 c.2).
- Suppressed is not hidden: the flashing stops, the full data block is no longer forced, the CA path lines go, and a
  grey `CA` stays on both labels, on the Strip and on the track panel row ("Suppressed."). `RESTORE` on that row brings
  it back.
- It holds for that pair only, at your Position only (other Positions still see it, ¶5-14-6 c.4), and ends by itself
  when the pair stops alerting or either track drops. A later alert between the same two aircraft is a new one.
- You must be Primary at the Position; an Observer cannot suppress.

## What the briefing should say

- `efsp-conflict-suppress` / `-ack` (not a store op, no replay); `conflict-alert.js` `setSuppressed` / `presentFor`;
  conflict records carry `shownAt` and `suppressedAt` per session. Client: `panels/efsp/conflict-suppress.js`.
- CENTER's fallback (`jurisdiction.js` `FALLBACK_AIRSPACE_CLASS = null`, `FALLBACK_VFR_SERVICE = 'ADVISORY'`) and
  `CVN-72-CCA` are unclassified with VFR advisories.

## Deploy note (VQ-B)

The deployed Board imported `CVN-72-CCA` as Class E once (standing areas import once), like LTAG-RAPCON's old "Class C".
On the live server: AP edits it in the airspace panel's Jurisdiction section (CLASS none, VFR SERVICE advisory), or a
Board reset re-imports it. CENTER's fallback needs nothing: it is code.

## Defaults taken (P2)

1. Briefing defaults all taken: one click from the label menu and the track panel row, ends with the alert or a track
   drop, scope the acting Position, grey CA stays. The FAA text agrees (¶5-14-6 c.1 "a specific CA/MCI alert", ¶5-13-1
   c.1(a) "between specific aircraft for a specific alert"); neither order gives a time limit.
2. MCI gets the same action (same monitor, no extra cost).
3. The client counts an alert suppressed only when every one of the controller's Positions it is shown at suppressed it;
   with two Positions, one click suppresses at each Position it is shown at and not yet suppressed.
4. A label click on a contact in a suppressible CA now opens the label menu (SUPPRESS + TRACK) even with no owned Strip,
   so the track panel is one input away (TRACK, or Shift+click) for those contacts, as for owned ones (ADR 0140).
5. RESTORE only on the track panel row; the label menu offers nothing for an already suppressed alert.
6. Suppressions are in memory; a crc-sync restart forgets them, like the alerts.
7. Client test fixtures that use a synthetic `airspaceClass: 'E'` CCA (`airspace-layer.test.mjs`,
   `jurisdiction-section.test.mjs`) were left: they test class rendering generically, not the shipped file.

## Walks not done

- A real server CA through the e2e rig (the rig has no DCS units for a tracked pair): `e2e/u-ca-suppress.spec.js`
  injects the alert and reads the sent frame; the server half is `crc-sync/tests/conflict-alert-suppress.test.mjs`.

## Findings for other lanes

- Coordinated suppression for another Position (¶5-14-6 c.4, ¶5-13-1 c.3 "without being coordinated") is not built.
- U-VFR-REDO (H174 "cancellable collision warnings"): this is that action; it needs no Strip, so a VFR tag-only track
  gets it as soon as it is in a CA pair.
