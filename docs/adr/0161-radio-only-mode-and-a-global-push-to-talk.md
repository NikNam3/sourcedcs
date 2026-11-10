# 0161: Radio-only mode of crc-desktop, and a global push-to-talk

**Status.** Proposed (2026-11-10). [SOURCE-DEFINED]: the human's request of 2026-11-10 in session: controllers who use
another tool (LotATC and the like) should get our radio without CRC. Keyboard and mouse only; joystick buttons are not
supported, by ruling.

## Context

A controller on stock SRS who tunes two frequencies of a linked network hears themselves and everyone else double, and
cannot create links (ADR 0160). crc-desktop's radio fixes both, but it comes with the map and the strips, and its PTT
works only while the CRC window has focus, which is useless to someone working in another program.

## Decision

### 1. One installer, two launch modes

Radio-only is a mode of crc-desktop, not a separate app: same installer, same auto-update.

- The mode is kept in `userData/launch-mode.json` (`{ "mode": "full" | "radio" }`, default `full`). `--radio-only` and
  `--full` on the command line override it for that run, so a shortcut can pin either.
- The login gate of the full app offers RADIO ONLY; the radio-only window offers FULL CRC. Each writes the file and
  relaunches. No installer change.
- Radio-only always runs the built-in radio, never lxsrs.

### 2. A separate, small page

`app/public/radio-only.html` loads `js/radio-only-main.js`, which imports the radio panel and what it needs, and nothing
of the map, the dock or the strips: no MapLibre, no dockview. A small window (about 640 x 480).

- It logs in with the existing Casdoor flow and opens `/feed` with a ticket, as the full app does, handling
  `update-required` the same way. Link groups travel on `/feed` (ADR 0160).
- **Without a login** it still works as an SRS client that drops duplicates, with no linking; one grey line says so.
- It signs on at no Position. Its radios are the guards, the intercom and manual radios. The empty POSITIONS section is
  not drawn. Any radio can still go into a link group.
- The SRS name is `CRC RADIO`.

### 3. Global push-to-talk

Available in both modes, built-in radio only.

- **Listeners**, in the main process, chosen at run time: `uiohook-napi` on Windows and X11; the XDG GlobalShortcuts
  portal over D-Bus on Wayland, which reports press and release (the desktop asks once to approve the shortcut). If no
  listener can start, SETUP says so in grey and PTT stays window-focused.
- **Opt-in.** A hook sees every key, so it starts only when the controller enables Global PTT in SETUP (default off in
  the full app, on in radio-only). It forwards only press and release of the one configured key or mouse button, never
  other input, and never logs keys. The one exception is the capture step ("press your PTT key"), which reports a single
  input and then stops.
- It does not swallow the key: DCS still receives it.
- `ptt-controller.js` gains a global path. Losing window focus releases a window-held PTT as today, but not a globally
  held one. The maximum transmit time applies to both, which also covers a missed release.
- The binding is stored by the listener's own code, beside the existing window PTT key.

### 4. Module layout (no god files)

| File | Job |
|---|---|
| `crc-desktop/launch-mode.js` | read, write and override the mode (Electron-free, unit-tested) |
| `crc-desktop/global-ptt/index.js` | choose a listener, the IPC to the renderer |
| `crc-desktop/global-ptt/uiohook-listener.js` | Windows and X11 |
| `crc-desktop/global-ptt/portal-listener.js` | Wayland |
| `app/public/radio-only.html`, `js/radio-only-main.js` | the small page's entry |
| `app/public/js/radio/radio-only-feed.js` | the small page's `/feed` connection |
| `app/public/js/radio/global-ptt-setup.js` | the SETUP section |

## Consequences

- Controllers on other tools get duplicate removal and linking. Pilots stay on stock SRS (they need its cockpit
  integration), so a pilot on two linked frequencies still hears double.
- crc-desktop gains a native dependency, prebuilt N-API, so nothing compiles on the user's machine. The package config
  must keep it outside the asar.
- Global PTT on GNOME needs a version with the portal; otherwise PTT stays window-focused.
