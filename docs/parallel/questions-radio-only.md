# Questions: radio-only wave (ADR 0161)

Written by the questioner on 2026-11-10, on `main` at 96eb597d. Read-only: nothing here changed code. Sources: ADR 0161,
`docs/parallel/radio/RADIO-ONLY-README.md`, `crc-desktop/{main.js,external-link.js,package.json,tests/packaging-config.test.js}`,
`crc-desktop/app/{preload.js,server.js,srs/srs-route.js}`, `app/public/{auth-callback.html}`,
`app/public/js/{sync.js,app.js,settings.js,ptt-controller.js}`, `app/public/js/radio/*`,
`crc-sync/src/{ws-hub.js,radio/relay-wire.js,efsp/read-scope.js}`, `crc-sync/config/sign-on-grace.json`, the installed
`electron-updater`, `app-builder-lib` and `@electron/rebuild`, the source of `uiohook-napi` 1.5.5 and its bundled libuiohook,
the Electron `app` docs, and the portal and shortcut specifications. Paths are under `crc-desktop/` unless they say otherwise.

Nothing ADR 0161 or the README already settles is asked again. A fact I could not confirm from code or documentation is
marked **verify**: the lane checks it before relying on it.

## Summary

| Id | Lane | One line |
|---|---|---|
| RO1 | supervisor + MODE | A radio-only `/feed` of the same user cancels the sign-off grace, keeps the Positions held and gets the picture and the whole Board |
| RO2 | MODE | `getSyncFeedUrl()` raises the blocking login gate, and "no ticket" means both "not logged in" and "crc-sync down" |
| RO3 | MODE | The page must call `loadSettings()` first, or its first save wipes the full app's settings |
| RO4 | PTT + MODE | With no Position and no target chosen, PTT falls back to GUARD UHF: a global key would transmit on 243.000 |
| RO5 | MODE | No single-instance lock today: a second copy dies on port 3100 yet its window fights the first over `/srs` |
| RO6 | MODE | How to relaunch: `app.relaunch()` keeps `--radio-only`, breaks on AppImage, and a downloaded update installs on the same quit |
| RO7 | MODE | A logged-in controller never sees the login gate, so never sees RADIO ONLY |
| RO8 | MODE + PTT | A hidden window's timers are throttled: the transmit fuse and RX end run late |
| RO9 | supervisor | Files nobody owns or the wrong lane owns: `preload.js`, `radio-prefs.js`, `link-groups.js`, `build.files`; the README's `require` fails the packaging test |
| RO10 | PTT | electron-builder will compile `uiohook-napi` from source despite its prebuilds, and CI has no X11 headers |
| RO11 | PTT | Choosing the listener on Linux: `DISPLAY` is set on Wayland too; the `.node` needs four X libraries |
| RO12 | PTT + supervisor | The portal needs a registered app id, and it cannot do three things the ADR says: mouse, capture, not swallowing |
| RO13 | PTT | The binding's shape, which keys may be bound, and what "on by default" means with no key |
| RO14 | PTT | The PTT state machine with two sources: repeat, X11 release pairs, focus loss, the fuse and a missed release |

Most valuable first: RO1, RO4, RO6, RO10, RO12, RO14, RO3.

---

### RO1: A radio-only session is the same controller to crc-sync   [lane: supervisor, then RO-MODE]
- Context: everything in `ws-hub.js` keys on `session.controllerId`, which is the signed-in user. `_onConnect` does
  `this._pendingSignOff.delete(session.controllerId)` ("Back inside the grace: the controller never signed off"), and
  `_setCoverage(session, picture.coverageFor(controllerId))`. `_onClosed` returns early if any other socket has the same
  controllerId. The grace is 15 s (`config/sign-on-grace.json`), and a mode switch takes a few seconds. So FULL to RADIO
  ONLY, or closing CRC and starting a pinned radio-only shortcut, **cancels the sign-off**: the Positions stay held for as
  long as the radio runs, nobody is offered the hat (ADR 0110), and the Strips sit on a Position nobody is looking at. The
  same happens with full CRC on one machine and radio-only on another. The ADR's "It signs on at no Position" is
  not true on the server in those cases.
  Separately, a session with no Position reads everything: `read-scope.js` `scopeOf([])` returns `{kind: ALL}`, so a radio-only
  install is sent the whole Board and every delta, for a user who asked for a radio. Link groups themselves are fine: the hub handles
  `radio-link-groups` before EFSP and `relay-wire.js` says any connected session may send them.
- Question: How does crc-sync tell a radio-only session from a CRC session, and who changes it? Neither lane owns crc-sync.
- Options: (a) the page sends `efsp-set-positions` with `signedOn: []` per Facility on connect: fixes the relaunch, but signs
  off a real CRC of the same user on another machine; (b) the page adds `&role=radio` to the `/feed` URL and the hub
  marks `session.radioOnly`: it does not touch `_pendingSignOff`, does not count in `_onClosed`, gets empty coverage, and gets
  no picture, no EFSP snapshot and nothing through `deliverEfsp`, only `status`, `update-required` and the relay frames;
  (c) leave it and document it.
- **Recommended: (b), given to RO-MODE as a small `ws-hub.js` change with a test for each of the four rules.** It is the
  only option right for the two-machine case. A query parameter is not a frame, so it is outside the wire scan, and a new
  client on an old server only keeps today's behaviour: no protocol bump. Mind the grace test: a controller reconnecting CRC
  inside the grace must still cancel it.

### RO2: The login gate, and what "no ticket" means   [lane: RO-MODE]
- Context: `sync.js` `getSyncFeedUrl()` calls `showLoginGate()` whenever `fetchSyncTicket()` returns null: a `position:fixed;
  inset:0` overlay at z-index 99999. That breaks ADR §2's "Without a login it still works". `fetchSyncTicket()` also returns null
  on a 401, a 502 from the proxy and a network error alike, so crc-sync being down looks like a logged-out user, and
  the "no linking" grey line would give the wrong reason. `getSyncFeedUrl()` also calls `loadMaptilerKey`, which the page does
  not need. `openSyncLogin` is not exported. The login itself needs no change: `auth-callback.html` only writes the token and
  closes, and a 2 s retry picks it up.
- Question: What does the radio page call instead?
- Options: (a) `getSyncFeedUrl({ gate: false, maptiler: false })`, plus exports of `openSyncLogin` and a ticket result of
  `{ ticket } | { reason: 'no-login' | 'unreachable' }`; (b) copy the ticket and URL code into `radio-only-feed.js`;
  (c) keep the gate and style it for the small window.
- **Recommended: (a).** One ticket path, so the protocol and client parameters stay in one place, and the full app's behaviour
  does not change with the defaults. The page shows a LOG IN button and the existing `showConnWidget`, and words the grey
  line by `reason`. (c) contradicts the ADR.

### RO3: The page and the full app's settings   [lane: RO-MODE]
- Context: `settings.js` starts as `DEFAULTS`, and `saveSettings()` writes the whole object to the `crc-desktop-settings` key.
  `app.js` `startApp()` calls `loadSettings()`; `initRadioPanel` does not. A radio-only page that goes straight to
  `initRadioPanel` reads `settings.radio` as null and, at the first change, **overwrites the full app's map, colour and
  airport settings with the defaults**. Both modes are the same origin, so they share that localStorage.
- Question: Do the modes share the radio preferences?
- Options: (a) share them: `radio-only-main.js` calls `loadSettings()` before `initRadioPanel()`; (b) a separate storage key
  for radio-only, which needs a second binding in `radio-prefs-storage.js`.
- **Recommended: (a).** The devices, gains and manual radios are the same person's on the same machine, and stored memberships
  of absent Position radios are harmless (`forgetRadio` is only called for removed manual radios). Add a test
  that the page's entry calls `loadSettings` first. See RO13 for the one preference that must not be shared as a plain value.

### RO4: PTT falls back to GUARD   [lane: RO-PTT (`link-groups.js`), RO-MODE to know]
- Context: `resolvePttTarget` uses the saved target if it can transmit, else the automatic group's first radio, else
  `set.radios.find(mayTransmit)`. `buildRadioSet` orders Position radios, guards, manual, intercom. With no Position, and with a
  saved target such as `POSITION:<id>:UHF` that does not exist in this mode, the target is **`GUARD:UHF`, 243.000**.
  Radio-only is exactly that case, on first run and on every run from a full-app profile, with Global PTT on by default, so a key
  pressed in another program keys guard for the whole server.
- Question: May the fallback land on a guard?
- Options: (a) keep RQ17's fallback; (b) never fall back onto a GUARD, in either mode: the fallback is the first manual radio
  or intercom, else none, and the PTT button stays disabled as it does today with no target; (c) radio-only only.
- **Recommended: (b).** A guard is keyed only when the controller chose it; the same hazard exists in the full app with no
  Position and Global PTT on. It amends RQ17, so the existing fallback test changes with it.

### RO5: Single instance   [lane: RO-MODE]
- Context: `main.js` has no `requestSingleInstanceLock`. A second copy today: `app/server.js` `httpServer.listen` has no `error`
  handler, so `EADDRINUSE` on 3100 is an uncaught main-process exception, yet the second window still opens and loads
  `http://localhost:3100`, **served by the first copy**. Its engine opens `/srs`, which passes the Origin check; `srs-route.js`
  closes the first with 4000 "replaced"; `srs-socket.js` reconnects on any close, whatever the code. The two windows then replace each
  other every 0.5 to 5 s. The mode file makes starting a second copy more likely (a full shortcut beside a radio-only one).
- Question: What does a second launch do?
- Options: (a) take the lock as the first thing in `main.js`, before the server is required; a loser quits, and the
  winner's `second-instance` shows and focuses its window and ignores the other's mode flags; (b) a second launch in the other
  mode switches the running one; (c) allow both on separate ports (two SRS clients: every call heard twice).
- **Recommended: (a).** The ADR makes the mode a choice made by button, and silently dropping a running radio because
  someone clicked a shortcut is the worse surprise. Electron says `second-instance`'s `argv` is not the exact list, another
  reason not to act on it. Do not have `srs-socket.js` stop on 4000: within one app a reload relies on the replace.

### RO6: How to relaunch   [lane: RO-MODE]
- Context, three separate traps:
  1. Electron: "By default, the new instance will use the same working directory and command line arguments". A run started
     with `--radio-only` whose FULL CRC button calls a bare `app.relaunch()` comes straight back radio-only, whatever the file says.
     `args` replaces them, and in development must keep the `.`.
  2. AppImage: `process.execPath` is inside the FUSE mount, which goes when the process exits, so a bare relaunch fails with
     "Cannot mount AppImage" (electron-builder issues; `execPath: process.env.APPIMAGE` is the usual fix, and one report still
     hit a race with the unmount).
  3. Updates: `BaseUpdater.addQuitHandler` installs a downloaded update on `quit` with exit code 0 (`autoInstallOnAppQuit`
     defaults to true). So a mode switch after `update-downloaded`, when the dialog was answered Later, starts the installer and
     the relaunched app together, on the files being replaced. I expect `app.exit(0)` to fire `quit` as well, so it is no way out (**verify**).
- Question: What does the switch do?
- Options: (a) bare `app.relaunch(); app.quit()`; (b) a helper in `launch-mode.js` computes the args (`process.argv.slice(1)`
  without `--radio-only` and `--full`); `main.js` sets `autoUpdater.autoInstallOnAppQuit = false`, then on AppImage spawns,
  detached, `sh -c 'sleep 1; exec "$APPIMAGE" "$@"'` and calls `app.exit(0)` after its own cleanup, elsewhere `app.relaunch({ args })`
  and `app.quit()`; (c) no relaunch: `win.loadURL` the other page (against the ADR, and `RADIO_CLIENT` is fixed when the server is required).
- **Recommended: (b).** The handler reads `autoInstallOnAppQuit` when it runs, so setting it just before is enough, and the
  update is found in the cache on the next check. The sleep also covers the lock and port 3100. `app.exit` skips `before-quit`, so the
  `pyProc` kill and the hook's stop must be called directly. Run it in a packaged AppImage: `npm run release-check` only
  proves it launches. After an update's own restart the mode comes from the file, so a `--radio-only` pin holds only for
  runs the shortcut itself starts; that matches the ADR's "for that run".

### RO7: Where a logged-in controller finds RADIO ONLY   [lane: RO-MODE]
- Context: ADR §1 puts the button on the login gate. The gate shows only when there is no ticket, and the token lives in
  localStorage, so anyone already logged in, which is nearly every existing user, never sees it. The command line is their only
  way in.
- Question: Is there a second place?
- Options: (a) the gate only, as written; (b) also in Settings, Tools, beside Connection Settings (`panels/tools-panel.js`
  `initToolsTab`); (c) a topbar button.
- **Recommended: (b).** The ADR does not say "only", so it needs no amendment. A topbar button would be chrome a working
  controller never needs (dark cockpit), and one misclick drops their map.

### RO8: Timers in a hidden window   [lane: RO-MODE for the window, RO-PTT for the toggle]
- Context: the point of Global PTT is that the window is not in front. `main.js` leaves `backgroundThrottling` at its default,
  true. The maximum-transmit fuse is a renderer `setTimeout` (`ptt-controller.js`), and the end of a received call is `rx.tick()` on a
  50 ms `setInterval` (`radio-engine.js`). Chromium holds hidden pages' timers to about 1 Hz, and after five minutes to once a
  minute unless the page is audible; an idle radio is not (**verify** whether an open microphone exempts it). So on a minimized
  radio the fuse, which ADR §3 says "also covers a missed release", can be far late, on a live frequency. The worklet and the sockets are not throttled.
- Question: Who turns throttling off?
- Options: (a) `backgroundThrottling: false` in `webPreferences` in both modes; (b) `win.webContents.setBackgroundThrottling(false)`
  always in radio-only, and in the full app only while a global listener runs; (c) move the fuse to the main process
  and accept the RX lag.
- **Recommended: (b).** The full app's map would otherwise keep rendering while minimized (keep CPU low). With it off, Electron
  also keeps the page "visible", which suits §3; RO14's per-source release is still needed for `blur`.

### RO9: Files nobody owns, or the wrong lane owns   [lane: supervisor]
- Context: from the README's table:
  - `app/preload.js` is RO-PTT's, but RO-MODE needs a bridge for its two buttons (write the mode and relaunch).
  - `radio/radio-prefs.js` belongs to neither, and `normalizeRadioPrefs` returns a fixed shape, so **any new field RO-PTT does not add
    there is dropped on load**. `radio/link-groups.js` (RO4) is also unassigned.
  - `package.json` `build.files` is RO-PTT's, but `launch-mode.js`, which RO-MODE creates, must be listed there or the app dies on start.
  - `sync.js` and `app/server.js` are not listed; RO-MODE needs both.
  - The README's `require('./global-ptt')` **fails** `packaging-config.test.js`: the test tries the bare name first, which exists as
    a directory, has no `/`, and is then looked for literally in `files`, where `global-ptt/**/*` does not match.
- Question: Who writes what?
- Options: (a) RO-PTT does all of `preload.js` and `package.json` from a list RO-MODE sends; (b) each lane adds its own separate
  `contextBridge.exposeInMainWorld` block (RO-MODE: `crcMode`, RO-PTT: `crcGlobalPtt`), which merge cleanly, and RO-PTT lists
  `launch-mode.js` now, ahead of the file existing; (c) a preload per mode.
- **Recommended: (b).** RO-PTT also takes `radio-prefs.js` and `link-groups.js`; RO-MODE takes `sync.js`, `server.js`, `tools-panel.js`.
  In `main.js`, write `require('./global-ptt/index.js')`, which the test resolves to a nested path and matches against `global-ptt/**/*`.

### RO10: electron-builder compiles `uiohook-napi`   [lane: RO-PTT]
- Context: the ADR says "prebuilt N-API, so nothing compiles". True at `npm ci` (`node-gyp-build` finds the prebuild), not at
  packaging. `npmRebuild` is on by default, and `@electron/rebuild` picks every dependency with a `binding.gyp`, which this package
  ships. Its prebuildify check looks for `prebuilds/<platform>-<arch>/electron.napi.node` or `node.napi.node`; the package ships
  `uiohook-napi.node`, so it finds none and falls through to node-gyp. `crc-desktop-release.yml` installs no libx11, libxtst, libxt
  or libxrandr headers, so the Linux leg fails, or, if it compiles, ships a `build/Release` binary that `node-gyp-build` prefers.
- Question: How is it packaged?
- Options: (a) `"npmRebuild": false`, and an explicit `"asarUnpack": ["node_modules/uiohook-napi/**"]`; (b) install the headers
  in CI and let it compile; (c) vendor the `.node` files.
- **Recommended: (a).** No other production dependency has a `binding.gyp` at either package root (checked), so the rebuild has nothing else to do.
  It goes in `dependencies` at the crc-desktop root, not `app/`, since the main process requires it. Pin both keys in
  `packaging-config.test.js`, and launch a packaged build with the hook on: a wrong config still packages.

### RO11: Choosing and loading the listener on Linux   [lane: RO-PTT]
- Context: `DISPLAY` is set on a Wayland session too (XWayland), so a test for X11 by `DISPLAY` picks `uiohook`, whose `start()`
  then succeeds and hears only what the compositor hands to X clients: nothing while a Wayland window has focus. The prebuilt
  `.node` has `NEEDED` libX11, libXrandr, libXtst and libXt, so `require('uiohook-napi')` throws at load on a machine without them.
  `start()` throws on real failures (`UIOHOOK_ERROR_X_OPEN_DISPLAY`, `X_RECORD_NOT_FOUND`, `SET_WINDOWS_HOOK_EX`), so "no listener could start" is detectable.
- Question: What is the rule?
- Options: (a) X11 whenever `DISPLAY` is set; (b) Wayland if `XDG_SESSION_TYPE === 'wayland'` or `WAYLAND_DISPLAY` is set, and
  then the portal only; `uiohook` only on `win32` and a real X11 session; (c) portal, falling back to `uiohook` under XWayland.
- **Recommended: (b).** A listener that starts and half hears is worse than the ADR's grey line. Require `uiohook-napi` lazily
  inside `uiohook-listener.js`, in a `try`, never at the top of `main.js`, and report the reason to SETUP. Note for the guide: on
  Windows a low-level hook does not get input aimed at an elevated window, so DCS or LotATC run as administrator need CRC elevated too
  (**verify**); it cannot be detected, so it is a line in the guide and not in the panel.

### RO12: What the portal needs, and what it cannot do   [lane: RO-PTT, supervisor for the ruling]
- Context: an AppImage is not sandboxed, so the portal sees a host app. xdg-desktop-portal 1.21 made GlobalShortcuts "Require a valid
  AppID", and a host app with no systemd `app-*` scope has none. The human's machine has portal 1.22.1 with KDE 6.8 on Wayland, so this path is the
  one that runs here. `org.freedesktop.host.portal.Registry.Register(app_id, {})` must come before any other portal call, once. The
  renderer's `sandbox: true` does not affect the main process. The flow: Register; `CreateSession` and wait for its `Response`
  (subscribe on the Request path before calling); `ListShortcuts`; if ours is absent, `BindShortcuts` (once per session; usually a
  dialog); then `Activated` and `Deactivated`, and `ShortcutsChanged`. Re-register on `NameOwnerChanged`.
  Three lines of ADR §3 cannot hold on this path. **Mouse**: the shortcuts spec is keyboard only. **Capture** ("press your PTT
  key"): the desktop owns the trigger; the app only offers `preferred_trigger` and can open `ConfigureShortcuts` (v2). **"It does not
  swallow the key"**: a compositor global shortcut is consumed, as I recall for KWin (**verify**), so DCS may not get it.
- Question: Which app id and D-Bus library, and what is the ruling on the three limits?
- Options: (a) accept them as Wayland's limits: keyboard only there, SETUP shows the portal's `trigger_description` and a CONFIGURE
  button instead of capture, one grey line says the desktop owns the key; (b) read `/dev/input` (needs the `input` group, sees every key
  of every program); (c) no Global PTT on Wayland.
- **Recommended: (a), written into `decisions.md` since the ADR cannot be edited.** App id `page.sourcedcs.crc` (`build.appId`). The
  Registry docs want it to be able to match a `.desktop` basename, and ours is `CRC.desktop`, but `CRC` has no dot and I expect the validity check to refuse it, and
  an AppImage installs no `.desktop` anyway (**verify** on this machine). Library: `@particle/dbus-next` (pure JS, updated 2026-10; `dbus-next` stopped in 2022).
  KDE reuses a binding across runs from 6.3 on (bug 492992).

### RO13: The binding, the allowed keys and the default   [lane: RO-PTT]
- Context: `uiohook` keycodes are scancodes (`Space` 57, `F13` 91), DOM codes are strings, and mouse numbers differ: uiohook 1 left, 2
  right, 3 middle, 4 and 5 extra; DOM `button` 0 left, 1 middle, 2 right. Neither can be compared with `prefs.pttKey`. `PTT_KEY_DEFAULT` is
  `Space`, and `isTyping()` protects only CRC's own fields, so a global Space, letter or digit transmits on every word typed anywhere, DCS chat included, and is
  not swallowed. Global PTT defaults on in radio-only and off in full, but both modes share one localStorage (RO3), so a plain boolean
  written by one becomes the other's value, and a radio-only default would start a hook in the full app against the ADR's opt-in.
- Question: What is stored, and which inputs may be bound?
- Options: (a) any input, with a warning; (b) an allow-list at capture: F1 to F24, Scroll Lock, Pause, Insert and the navigation keys,
  Right Ctrl, mouse 3, 4, 5; refused, in grey: letters, digits, numpad digits, punctuation, Space, Enter, Tab, Backspace, Esc, left and right click, Shift;
  (c) require a modifier (the ADR says one key).
- **Recommended: (b).** Numpad digits go because controllers type frequencies there. Store `globalPtt: { enabled: null | boolean, uiohook:
  { type: 'key', keycode, label } | { type: 'mouse', button, label } | null, portal: { shortcutId, label } | null }`, added to
  `normalizeRadioPrefs`. `enabled: null` means the mode's default, read through `typeof RADIO_ONLY`, and is written only when
  the controller flips it. "On" with no key bound starts no hook: the first run shows one grey line asking for a key, and the hook runs for the capture step only.

### RO14: The PTT state machine with two sources   [lane: RO-PTT]
- Context: `createPttController` has one `held` flag. With a global path:
  - Same key bound both ways, window focused: keydown and hook both call `down()`, harmless, but `blur` calls `releaseAll()`, which ends a transmission the
    key is still holding globally. `visibilitychange` does the same.
  - Repeat: libuiohook has no repeat filter. On Windows a held key arrives as repeated `WM_KEYDOWN`. The DOM path filters `e.repeat`; the hook does not, so after the
    fuse fires, the next repeat calls `down()` and **re-keys at once**, defeating "lifted and pressed again".
  - X11: soft autorepeat is a release and press pair at the server, and libuiohook's `XkbSetDetectableAutoRepeat` is set on its control connection only.
    If XRecord still shows the pairs (**verify** on real X11), a held key chops the transmission at the repeat rate. The event carries `time`.
  - Missed release (a lock screen, a UAC prompt, RO11's elevated window): a listener that ignores presses while "down" is then deaf until pressed twice.
- Question: Where does this live?
- Options: (a) keep one flag and rely on no-ops; (b) sources in the controller: `down(source)` and `up(source)` for `window`, `button`, `global`; the radio
  is keyed while any source holds; `blur` and hidden release `window` only; the fuse ends all and latches until every source has let go. Debouncing in the listener: a press while down is
  dropped; on X11 a release is held about 15 ms and cancelled by a press with the same `time` or inside that window; (c) disable the window path while a global listener runs.
- **Recommended: (b).** For the missed release: when the fuse fires the renderer tells main, and the listener then ignores presses until a release or until 1 s
  with no press, so repeats stay latched and a real new press works. (c) would leave the window key dead for a controller who bound a different global key.

---

## Checked, nothing to ask

- **`/srs` Origin:** `http://localhost:<port>/radio-only.html` sends the Origin `isAllowed` accepts; `isLocalAppUrl` also accepts it. Load it by `localhost`, not `127.0.0.1`.
- **`/js/config.js`:** `radio-only.html` must load it as a classic script before the module: `sync.js` assigns `CRCSYNC_URL` bare, a `ReferenceError` in a module without the `var`. `RADIO_ONLY` needs an env var set in `main.js` before `require('./app/server.js')`.
- **lxsrs:** `main.js`'s `RADIO_CLIENT` is computed at load, so the mode must be read before it; `app.getPath('userData')` works before `ready`.
- **Import graph:** the closure of `radio-panel.js` is 60 modules, with no MapLibre, dockview or `map-handle.js`.
- **`/feed` frames:** the relay's two types are registered in `efsp-message-registry.js`, and `radio-only-feed.js` must call `_setSyncSocket(ws)` for `relay-feed.js` to work. Forward only those two types and `update-required`.
- **Auto-update and `win`:** the handlers guard or take `win` from one closure, and with one window per process nothing changes as long as RO-MODE keeps assigning the one `win`. There is no topbar dot in radio-only; the `update-downloaded` dialog still appears.
