# RO-MODE: radio-only launch mode (ADR 0161 §1, §2)

## What was built

- `crc-desktop/launch-mode.js`: reads and writes `userData/launch-mode.json`, applies `--radio-only` and `--full` (the last
  flag wins), picks the radio client and the window, builds `app.relaunch`'s options.
- `main.js`: the mode decides the window (640 x 480 on `/radio-only.html`), the radio client (always `node` in radio mode,
  so lxsrs never starts) and `CRC_RADIO_ONLY`. IPC `launch-mode-switch` stores the mode and relaunches. Auto-update and the
  navigation and Casdoor guards are unchanged: `isLocalAppUrl` compares origins, so the new page passes.
- `/js/config.js`: `var RADIO_ONLY = true|false`, for RO-PTT.
- `app/preload.js`: one block, `crcLaunch.switchTo(mode)`.
- The page: `radio-only.html`, `css/radio-only.css`, `js/radio-only-main.js`, `js/radio/radio-only-feed.js` (/feed),
  `js/radio/radio-only-bar.js` (top line), `js/radio/frequency-picks.js` (+ RADIO picks).
- Panel differences (`initRadioPanel({ radioOnly: true })`): SRS name `CRC RADIO`, set before the socket opens; an empty
  POSITIONS group is neither drawn nor offered in the link menu; picks in + RADIO.
- Two splits so the page's graph stays clean: `sync-connection.js` out of `sync.js` (which was at 298 lines), and
  `panels/efsp/signed-on-state.js` out of `efsp-ws.js` (`radio-inputs.js` used to pull in `efsp-ws.js`, and with it
  `efsp-state.js` and the Board's stores). `efsp-ws.js` re-exports the three getters, so its importers are unchanged.
  `loadMaptilerKey` moved from `sync.js` to `app.js`'s `connect()`, so `sync.js` no longer touches the map key.

## Follow-up from S-RO-1 (questions-radio-only.md)

- **RO1.** The page's `/feed` URL carries `&role=radio`. `crc-sync/src/radio/radio-session.js` recognises it; `ws-hub.js`
  gives such a session its own connect (`_onRadioOnlyConnect`) and leaves it out of every controller loop
  (`_controllerSessions()`). It never touches `_pendingSignOff`, does not count in `_onClosed`, has empty coverage, gets no
  tick, picture, snapshot, alerts, PAR or directed frame, and only its link groups are heard from it.
  Broadcasts reach it only for `status` and `efsp-frequency-delta` (`mayReceive`).
- **The picks stay.** The rows go out as the existing `efsp-frequency-delta`, one per Facility on connect
  (`frequencyFrames()`), so no new frame type and no wire surface change (`tests/wire-protocol.test.mjs` passes, `wire:record` not
  run). The role is a query parameter, outside the scan.
- **RO3.** `tests/radio-only-graph.test.mjs` pins `loadSettings()` before `initRadioPanel()`.
- **RO4.** `resolvePttTarget`: the chosen radio, else the automatic group's first, else none. The button reads `NO PTT RADIO`,
  disabled, until a radio or group is selected.
- **RO5.** `requestSingleInstanceLock()` before the server is required; a second launch only restores and focuses.
- **RO6.** `switchLaunchMode` in `launch-mode.js`: sets `autoInstallOnAppQuit = false` first. Elsewhere `app.relaunch` + `app.quit`.
  AppImage: a detached `sh -c 'sleep 1; exec "$0" "$@"'`, then the `before-quit` listeners by `app.emit` (`app.exit` skips
  them, and this also picks up RO-PTT's `shutdown()` with no merge coupling), then `app.exit(0)`. Double clicks are guarded.
- **RO7.** RADIO ONLY in Settings, under CONNECTION SETTINGS (Electron only).
- **RO8.** `setBackgroundThrottling(false)` on the radio-only window only.

## Packaging: must change, RO-PTT or the supervisor

`crc-desktop/package.json` `build.files` lists root files one by one and does not list `launch-mode.js`. **Add
`"launch-mode.js"`.** Until then `tests/packaging-config.test.js` ("every local require in main.js is covered by
build.files") fails, and a packaged build crashes on launch with `Cannot find module './launch-mode'`. The page itself
needs nothing: `app/**/*` covers it.

## Defaults taken

1. `update-required` draws the same full-window overlay as the full app (ADR: "the same way"), so it covers the panel
   although SRS keeps running under it. RETRY and CONNECTION SETTINGS work. If the radio should stay usable against a
   mismatched crc-sync, the overlay needs a smaller form on this page.
2. (RO4) The briefing says "with no chosen target it keys nothing"; the question's option (b) would still fall back to the
   first manual radio. Taken the stricter one: no manual or intercom fallback. The automatic group stays as the default in
   the full app (those are the radios the controller signed on for).
3. Picks fill the + RADIO form and the controller presses ADD; they do not add at once. They are offered in radio-only only,
   list VHF and UHF rows, one per frequency, and leave out what is already tuned.
4. A login that yields no ticket (expired, or crc-sync down) reads `no connection to crc-sync: no linking`; no token reads
   `not logged in: no linking`. LOG IN and CONNECTION show in both, and neither with the link up.
5. Local link groups stay usable without a login (PTT keys the whole group); only crc-sync's relay is missing.
6. Prefs are shared between the modes (same localStorage origin). A guard the controller moved into POSITIONS in the full
   app makes that group non-empty, so it is drawn in radio-only until unlinked.
7. No light mode on this page: `applyLightMode` lives in `panels/settings-panel.js`, outside the page's graph.
8. A relaunch drops `--radio-only` and `--full` from its arguments, or a pinned shortcut would undo the switch. An AppImage
   relaunches through `$APPIMAGE`.

## Findings

- The SRS address still comes only from `config.json` (`srsHost`, `srsPort`), as in the full app; CONNECTION covers
  crc-sync and Casdoor only.
- For RO-PTT at merge: `tests/no-window-globals.test.mjs`'s `BRIDGED` line and `app/preload.js` are touched by both lanes;
  the window is still created at the same place in `main.js`.

## Not verified

Not run in Electron or a real browser (no Chrome on this machine for the Playwright tool, and Electron is off limits in a
lane): layout, audio, the Casdoor popup, `app.relaunch`, the single-instance lock and the AppImage relaunch are unobserved. The
AppImage path in particular needs one run in a packaged build. `radio-only-main.js` was evaluated once under
the Node DOM stub and drew the bar and the panel.

## Text for the docs

**Usage guide.** *Radio only.* CRC can start as the radio alone, for controllers working in another tool. Press RADIO ONLY
on the login screen; FULL CRC in the radio window goes back. CRC remembers the choice. A shortcut can pin one with
`--radio-only` or `--full`. The window has the guards, the intercom and your manual radios, and needs no login. Without a
login a grey line says there is no linking: duplicates are still dropped, but crc-sync relays nothing. Log in to link
frequencies. When logged in, + RADIO offers the frequency table. Select what PTT transmits on first: it never keys a guard
by itself. RADIO ONLY is also in Settings. A radio window does not keep your Positions: they are released as if you had closed CRC.

**`crc-desktop/README.md` "Client modules" and `CLAUDE.md`.** Two page roots now, `main.js` and `radio-only-main.js`;
`crcLaunch` joins the preload's names; `tests/radio-only-graph.test.mjs` pins the small page's graph; `tests/launch-mode.test.js`
makes nine CommonJS tests; new leaves `sync-connection.js`, `panels/efsp/signed-on-state.js`.

## Manual test steps

1. `npm start` with no `launch-mode.json`: the full app. Log out (clear the token): the gate shows RADIO ONLY.
2. RADIO ONLY: the app relaunches in a small window, `launch-mode.json` holds `{"mode":"radio"}`, no lxsrs process, no
   requests to unpkg or jsdelivr.
3. With no login: one grey line, LOG IN, CONNECTION; guards listed, no POSITIONS section; the SRS client list shows `CRC RADIO`.
4. LOG IN through the popup: the line clears within 2 s. + RADIO shows the TABLE menu; a pick fills the form.
5. Add two radios to a group: RELAYING appears.
6. Point CONNECTION at a server with another wire protocol: the overlay shows; its CONNECTION SETTINGS opens over it.
7. FULL CRC: relaunches into the full app. Start with `--radio-only`, press FULL CRC: full app, and the flag is gone.
8. Logged in, Settings shows RADIO ONLY. Holding a Position, switch to radio-only: the Position is released after the 15 s grace.
9. Start a second copy: the first window comes forward, no second window, no `/srs` flapping.
10. Packaged AppImage: switch modes both ways. With an update downloaded and answered Later, a switch must not install it.
11. First run in radio-only: the button reads NO PTT RADIO; select a radio or group, then it keys.
