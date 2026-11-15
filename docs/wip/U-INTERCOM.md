# U-INTERCOM: an intercom PTT key, the intercom on by default, SRS's shared unit 100000001

ADR: `docs/adr/0166-an-intercom-ptt-key-and-the-intercom-on-by-default-on-srs-shared-unit.md`.
Branch `lane/U-INTERCOM` (cut from `cancel-ff`).

## What was built

1. **Intercom PTT key** (IC-Q1 a). RADIO → SETUP → *Intercom PTT*: PRESS A KEY / CLEAR, none until set
   (`intercomPttKey` in the radio prefs). It keys only the intercom, whatever the PTT target is. The PTT key is
   unchanged. One key is never both: the intercom key refuses the PTT key (a grey line), and setting the PTT key to the
   intercom's clears the intercom key.
   **Both held:** the first pressed transmits, and the other waits; when the first is let go with the other still held,
   the other starts at once (`radio-ptt-arbiter.js`). A key with no radio (no target, intercom removed) holds nothing back.
2. **Global intercom PTT**, with no native rebuild: the uiohook listener matches two bindings. On Wayland the portal binds a
   second shortcut, `crc_intercom`. The gate has one binding and one edge filter per channel. IPC edges are
   `(down, channel)`, and capture and fuse take a channel (preload maps anything else to `ptt`).
3. **Intercom on by default** (IC-Q2 a, IC-Q3 a). Never set (no key, or the old stored `null`) gives the intercom on the
   shared unit. A removal stores `intercom: false` and stays removed until + INTERCOM.
4. **Shared unit 100000001**: `SHARED_INTERCOM_UNIT_ID` in `app/srs/srs-session.js` (was `UNIT_ID = 1`), verified in
   the SRS source (ADR 0166 Context, file:line). The renderer's engine state no longer fakes `intercomUnitId: 1`.
   crc-sync's `RELAY_UNIT_ID = 1` is left alone (no intercom radio, never relays intercom). `srs-session.js` is not one of
   crc-sync's copied files, so there is no parity change.

## Usage guide text (radio section)

> **Intercom.** Every CRC starts with an INTERCOM row, receiving, on the shared intercom. The shared intercom is the same
> one SRS uses outside DCS (unit 100000001), so SRS-standalone GCI controllers on intercom 1 are on it too. To use
> another client's intercom, pick its unit in the row. Remove the row with ×; it stays removed until you press
> + INTERCOM.
>
> **Intercom PTT.** In SETUP, *Intercom PTT* → PRESS A KEY sets a key that keys only the intercom, whatever group
> your PTT key keys. CLEAR removes it. It cannot be your PTT key. If you hold both keys, the one you pressed first
> transmits; let it go and the other takes over while you still hold it. With Global PTT on, *Global intercom PTT* sets
> the input that keys the intercom while CRC is not focused (on Wayland the desktop asks you to approve a second
> shortcut, "CRC intercom push-to-talk").

## Release note text

- The intercom is on by default, on SRS's shared intercom (unit 100000001), so you share it with SRS-standalone
  controllers. If you removed it before, remove it once more and it stays removed.
- New: an intercom PTT key (RADIO → SETUP → Intercom PTT), also as a Global PTT input. It keys only the intercom.

## Defaults taken

- Both keys held: the first wins, and the other takes over when the first is let go (no cut-off of a call already
  going out).
- Setting the PTT key to the intercom key's clears the intercom key, and the reverse is refused.
- The portal binds every one of our shortcuts the desktop already knows plus the new one in one BindShortcuts, so a
  session never binds fewer than are already bound.
- The intercom unit picker still lists SRS clients on 100000001 by name; picking one is the same as "shared".
  Not filtered (small, cosmetic).

## Tests (only the files touched, each run alone)

srs-session 7→8, radio-prefs 9→11, radio-intercom 6→7, radio-panel 8→8 (expectations: intercom row by default),
radio-only 20→20 (intercom row), global-ptt-gate 16→20, global-ptt-listeners 28→32, global-ptt-attach 11→11,
radio-global-ptt 8→9, global-ptt-setup 9→12, radio-intercom-ptt (new) 7, module-graph 8 (fixture re-recorded:
new modules `radio/ptt-key-button.js`, `radio/radio-ptt-arbiter.js`, new prefs exports), no-window-globals 2,
radio-only-graph 4. All green.

## Walks not done / findings for other lanes

- The portal's second shortcut has not been tried on a real GNOME or KDE desktop. The supervisor or human should check
  it on Wayland: bind PTT, then the intercom, then restart; both keys should work and nothing should ask again.
- No Playwright spec touched. An e2e spec that counts radio rows, or expects + INTERCOM at first load, now sees the
  intercom row (none was found by grep).
- The old lxsrs_v2 client (`python-pkg/lxsrs_v2/client.py:101`, `srs-radio.js:588`) still uses unit 1. A controller on
  `radioClient: "lxsrs"` no longer shares the intercom with built-in-radio CRCs. That is left until lxsrs is removed (H185).
- Usage guide and release notes are not edited (shared docs): the text is above.
