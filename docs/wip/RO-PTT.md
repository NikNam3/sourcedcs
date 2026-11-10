# RO-PTT: global push-to-talk (ADR 0161 §3, decision S-RO-1)

## Built

`crc-desktop/global-ptt/`: `index.js` (choice of listener, IPC, throttling), `ptt-gate.js` (the privacy rules),
`edge-filter.js` (repeats, X11 pairs, fuse latch, missed release), `input-allowlist.js`, `uiohook-listener.js`,
`portal-listener.js`, `portal-client.js`. Renderer: `ptt-controller.js` (sources `window`, `button`, `global`),
`radio/radio-ptt.js` (`wireGlobalPtt`), `radio/global-ptt-bridge.js`, `radio/global-ptt-setup.js`, `radio/radio-prefs.js`
(`globalPtt`), `radio/link-groups.js` (RO4). `app/preload.js` exposes `crcGlobalPtt`.

## Defaults taken

1. Blur and a hidden document release `window` **and** `button`, not `window` alone as RO14 words it. Both live in the
   window, and a mouse-up can be lost once the window is gone, which is today's behaviour. Only `global` survives.
2. Capture reports the first input at its **release**, not its press: the hook is never restarted with the chosen key
   still down, where its auto-repeat would key the radio.
3. A capture ends by itself after 15 s (120 s on the portal, a person reading a dialog).
4. An input off the allow-list ends the capture as `{ refused: true }`, without naming the input. The left button is
   ignored instead of refused, because it is how the controller clicks to cancel.
5. Delete is refused (an editing key). RO13's "navigation keys" are taken as Home, End, Page Up, Page Down and the arrows.
6. A page navigating or crashing stops the listener; the next page turns it on again through its own configure.
7. Only the main window's `webContents` may use the IPC.
8. Throttling (RO8): the toggle reads the current value when the listener starts and restores that value, so radio-only's
   permanent "off" survives, in whichever order the two lanes set it.
9. On the portal a change made in the desktop's own settings while running shows its new name at the next start
   (`ShortcutsChanged` is only read during CONFIGURE).

## For the supervisor and other lanes

- **RO-MODE:** `app.exit` skips `before-quit`, so the relaunch path must call `require('./global-ptt/index.js').shutdown()`
  directly (RO6). `/js/config.js` must define `RADIO_ONLY`.
- `build.files` lists `launch-mode.js` ahead of the file existing; a build without it still packages.
- RO12's limits are to be recorded against the ADR in `decisions.md` (S-RO-1 does).
- `tests/fixtures/module-graph-exports.json` was re-recorded here: 4 new names and 2 new files. RO-MODE will touch it too.
- `crc-desktop/README.md` says `no-window-globals` allows `crcLinks` and `crcUpdate`; `crcGlobalPtt` joins them.
- KDE's portal source (`globalshortcuts.cpp`): `CreateSession` restores known shortcuts from KGlobalAccel, and
  `BindShortcuts` opens a dialog only for new ids.

## Usage guide text

> **Global PTT.** RADIO, SETUP. Tick Global PTT and choose an input: the radio then keys from any program, while CRC is in
> the background. It is off by default in full CRC and on in radio-only, where it does nothing until an input is chosen.
> While it is on, CRC watches the keyboard and mouse for that one input; nothing else is kept, forwarded or logged.
>
> On Windows and X11, click PRESS A KEY and press the input. Function keys, Scroll Lock, Pause, Insert, the navigation
> keys, Right Ctrl and mouse buttons 3 to 5 may be used. Keys you type with may not, since they would key the radio on
> every word. Esc cancels. Other programs, DCS included, still receive the key.
>
> On Windows, a program run as administrator hides its input from CRC unless CRC is run as administrator too.
>
> On Wayland, the desktop owns the key. Click CONFIGURE and set it in the desktop's dialog. Keyboard only, and other
> programs may not receive the key.
>
> The maximum transmit time applies to Global PTT as well. After it ends a transmission, release the input and press
> again. PTT never falls back onto a guard: a guard is keyed only when you choose it.

## Manual test steps (none of this has been run: no hook and no Electron in the lane)

Common, on a packaged build (`npm run pack:linux` or `pack:win`): SETUP shows Global PTT off in full CRC; on, with "Choose
a key", in radio-only.

**Windows.** Enable, PRESS A KEY, press F13 or Mouse 4: the name shows. Try A, Space, Numpad 1: refused in grey. With
Notepad in front, hold the input: the radio keys, Notepad still receives it. Hold past the maximum transmit time: it
stops and does not re-key while still held; release and press: it keys. Disable: confirm the input no longer keys. With an
elevated program in front: expect no keying; lock the screen while holding, then unlock: the next press works.

**X11.** The same, and hold a key for 10 s: one transmission, not chopped at the repeat rate (RO14, the 15 ms hold).

**KDE Wayland.** Enable, CONFIGURE: the desktop's dialog appears; assign a key; its name shows. Hold it with another
Wayland window in front: the radio keys. Restart: no dialog, and it still keys. CONFIGURE again: the desktop's dialog for
the known shortcut. Check that the app is named sensibly in the dialog (the Registry call, `page.sourcedcs.crc`), and
whether DCS or another program receives the key (RO12). `systemctl --user restart xdg-desktop-portal`: it comes back.

**Both modes.** Same key bound window and global, CRC focused: one transmission. Hold global, click into another window:
it keeps transmitting. Hold the window key, click away: it stops. Minimized for over 5 minutes in the full app with the
listener on: the fuse still fires on time (RO8).
