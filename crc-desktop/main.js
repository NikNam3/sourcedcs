'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs   = require('fs');

const config = require('./config.json');
const { computePythonPkgDir, computeRuntimeCwd, ensureLxsrsVenv, lxsrsArgs } = require('./lxsrs-setup');
const { createExternalLinkGate, isCasdoorLoginUrl, isLocalAppUrl, CASDOOR_POPUP_WEB_PREFERENCES } = require('./external-link');
const { writePendingPatchNotes, readAndClearPendingPatchNotes, readLastPatchNotes } = require('./patch-notes');

const IS_LINUX = process.platform === 'linux';
const IS_WIN   = process.platform === 'win32';

let nodeProc = null;
let pyProc   = null;
let win      = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function logLines(prefix, stream) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        chunk.split('\n').filter(Boolean).forEach(line => console.log(`[${prefix}] ${line}`));
    });
}

// ── Process launchers ─────────────────────────────────────────────────────

async function spawnLxsrs() {
    const venvDir = path.join(app.getPath('userData'), 'lxsrs-venv');
    const venvPython = await ensureLxsrsVenv(venvDir, line => console.log('[lxsrs-setup]', line));
    if (!venvPython) return null;

    const pythonPkgDir = computePythonPkgDir(app.isPackaged, process.resourcesPath, __dirname);
    const runtimeCwd   = computeRuntimeCwd(app.isPackaged, app.getPath('userData'), __dirname);

    const proc = spawn(venvPython, lxsrsArgs(config), {
        cwd: runtimeCwd,
        env: {
            ...process.env,
            PYTHONPATH: pythonPkgDir,
        },
    });

    logLines('lxsrs', proc.stdout);
    logLines('lxsrs', proc.stderr);
    proc.on('exit', code => console.log(`[lxsrs] exited (${code})`));
    return proc;
}


// ── App lifecycle ─────────────────────────────────────────────────────────

app.on('ready', async () => {
    console.log(`[crc] CRC v${app.getVersion()} starting (${process.platform})`);

    const patchNotesPath     = path.join(app.getPath('userData'), 'pending-patch-notes.json');
    // Unlike patchNotesPath above (cleared the moment it's shown, at most once
    // per update), this copy persists indefinitely so a "what's new" button
    // in the UI can re-show the last update's notes on demand — see
    // patch-notes.js's readLastPatchNotes.
    const lastPatchNotesPath = path.join(app.getPath('userData'), 'last-patch-notes.json');

    if (IS_LINUX) {
        // Not awaited: first-run venv setup (network pip install) can take
        // a while and must not block the window from appearing. SRS radio
        // simply becomes available a little later than the rest of the app.
        spawnLxsrs()
            .then(proc => { pyProc = proc; })
            .catch(err => console.error('[lxsrs] unexpected error:', err.message));
    }

    // set env vars that server.js reads
    // DCS_GRPC_*/SRS_HOST/SRS_PORT are gone — crc-sync is now the sole
    // gRPC/SRS-transponder client (see crc-sync/server.js); this local
    // server only proxies a handful of on-demand RPCs to it.
    process.env.CRCSYNC_URL       = config.crcSyncUrl || 'wss://asacs.sourcedcs.page';
    process.env.CASDOOR_CLIENT_ID  = config.casdoorClientId || '';
    process.env.CASDOOR_ENDPOINT   = config.casdoorEndpoint || '';
    process.env.SRS_RADIO_API_PORT = String(config.srsApiPort);
    process.env.WS_PORT            = String(config.wsPort);

    const localServer = require('./app/server.js');

    win = new BrowserWindow({
        width:  1400,
        height: 900,
        title:  `CRC v${app.getVersion()}`,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'app', 'preload.js'),
        },
    });

    // Dev-only: auto-open DevTools so a renderer-side error (e.g. a
    // SyntaxError from a global-scope naming collision, or a rejected EFSP
    // Mutation) shows up immediately instead of failing with no visible
    // trace. Gated on !app.isPackaged so this never fires in a released
    // build — a real user should never see a DevTools window pop up.
    if (!app.isPackaged) {
        win.webContents.once('did-finish-load', () => win.webContents.openDevTools({ mode: 'right' }));
    }

    // Allow the renderer to pop up a Casdoor login window (app/public/js/sync.js
    // calls window.open on the Casdoor authorize URL) — everything else stays
    // blocked, matching Electron's secure-by-default posture.
    win.webContents.setWindowOpenHandler(({ url }) => {
        // The endpoint is read live from the local server: the connection widget changes it at runtime.
        if (isCasdoorLoginUrl(url, localServer.getSyncConfig().casdoorEndpoint)) {
            return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 640, parent: win, modal: true, webPreferences: { ...CASDOOR_POPUP_WEB_PREFERENCES } } };
        }
        // The one link that leaves the app (S-2PA0): the airspace booking page, and only on the origin crc-sync named.
        if (externalLinks.canOpen(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    // The main window never leaves the local server (a redirect or a link would otherwise load a remote page next to the
    // preload bridge); anything else that wants to navigate is dropped, and external pages open only via the gate above.
    win.webContents.on('will-navigate', (event, url) => {
        if (!isLocalAppUrl(url, config.wsPort)) event.preventDefault();
    });
    win.webContents.on('will-redirect', (event, url) => {
        if (!isLocalAppUrl(url, config.wsPort)) event.preventDefault();
    });

    let lastUpdateStatus = { state: 'idle' };
    function sendUpdateStatus(status) {
        lastUpdateStatus = status;
        updateInFlight = status.state === 'checking' || status.state === 'downloading';
        if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
    }

    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS('* { outline: none !important; }');
        // Replay current status so a renderer that attaches its listener
        // after checkForUpdates() already fired (or after a page reload)
        // doesn't miss whatever state we're already in.
        sendUpdateStatus(lastUpdateStatus);
    });

    win.loadURL(`http://localhost:${config.wsPort}`);
    win.on('closed', () => { win = null; });

    // ── "What's new" — shown once, on the first launch after an autoupdate
    // actually lands (see patch-notes.js for why this can't happen at
    // download time: the process that downloaded the update isn't the one
    // running the new version).
    try {
        const pendingPatchNotes = readAndClearPendingPatchNotes(patchNotesPath, app.getVersion());
        if (pendingPatchNotes) {
            dialog.showMessageBox(win, {
                type: 'info',
                title: `What's New in CRC v${pendingPatchNotes.version}`,
                message: `CRC has been updated to v${pendingPatchNotes.version}.`,
                detail: pendingPatchNotes.notes,
                buttons: ['OK'],
            });
        }
    } catch (err) {
        console.error('[patch-notes] failed to read pending patch notes:', err.message);
    }

    // ── Autoupdate ────────────────────────────────────────────────────────
    // publish config (package.json's build.publish) points electron-updater
    // at sourcedcs-web's generic-provider /downloads endpoint. Errors are
    // swallowed to a console log only — a failed update check must never
    // block using the app.
    autoUpdater.on('error', err => {
        console.error('[autoupdate] error:', err.message);
        sendUpdateStatus({ state: 'idle' });
    });
    autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
    // update-available maps to the same 'checking' UI state rather than its
    // own visual state — download-progress events start firing almost
    // immediately after, so a distinct state here would just be a flash.
    autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'checking', version: info.version }));
    autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'idle' }));
    autoUpdater.on('download-progress', (progress) => {
        sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatus({ state: 'ready', version: info.version });
        try {
            writePendingPatchNotes(patchNotesPath, { version: info.version, notes: info.releaseNotes });
            writePendingPatchNotes(lastPatchNotesPath, { version: info.version, notes: info.releaseNotes });
        } catch (err) {
            console.error('[patch-notes] failed to persist pending patch notes:', err.message);
        }
        dialog.showMessageBox(win, {
            type: 'info',
            title: 'CRC Update Ready',
            message: `A new version (${info.version}) has been downloaded.`,
            detail: 'Restart CRC now to install it, or it will install automatically on next launch.',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall();
        });
    });
    // checkForUpdates() rather than checkForUpdatesAndNotify() — the
    // update-downloaded handler above already shows a dialog, no need for
    // electron-updater's own OS-notification on top of it.
    autoUpdater.checkForUpdates().catch(err => console.error('[autoupdate] check failed:', err.message));

});

// Renderer's topbar update dot calls this directly when clicked while in
// the 'ready' state — the click itself is the restart confirmation.
ipcMain.on('update-restart-now', () => autoUpdater.quitAndInstall());

// crc-sync refused this client's wire protocol and the "Update required" overlay asked for the release now (crc-sync
// docs/adr/0103). Idempotent while a check or download is running; unpackaged there is no updater to ask. The outcome
// reaches the overlay through the existing 'update-status' stream, so this only reports whether it started something.
let updateInFlight = false;
ipcMain.handle('update-check-now', async () => {
    if (!app.isPackaged) return { state: 'idle' };
    if (updateInFlight) return { state: 'checking' };
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.error('[autoupdate] check failed:', err.message);
        return { state: 'idle' };
    }
    return { state: updateInFlight ? 'checking' : 'idle' };
});
// The renderer reports the booking page crc-sync sent (efsp-airspace-calendar.bookingUrl); only that origin may open.
const externalLinks = createExternalLinkGate();
ipcMain.on('external-link-allow', (_event, bookingUrl) => { externalLinks.allow(bookingUrl); });
ipcMain.on('external-link-allow-download', (_event, downloadUrl) => { externalLinks.allowDownload(downloadUrl); });
ipcMain.handle('get-app-version', () => app.getVersion());

// Backs the "what's new" button in the topbar — returns { version, notes }
// for the most recent update, or null if none has ever landed on this
// install. Path is only known inside this 'ready' handler's closure, so
// re-derive it the same way rather than hoisting a shared variable.
ipcMain.handle('get-last-patch-notes', () => {
    return readLastPatchNotes(path.join(app.getPath('userData'), 'last-patch-notes.json'));
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    pyProc?.kill();
});