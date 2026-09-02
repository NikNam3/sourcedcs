'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs   = require('fs');

const config = require('./config.json');
const { computePythonPkgDir, computeRuntimeCwd, ensureLxsrsVenv } = require('./lxsrs-setup');
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

    const freqArgs = config.freqs.flatMap(f => ['--freq', f]);
    const pythonPkgDir = computePythonPkgDir(app.isPackaged, process.resourcesPath, __dirname);
    const runtimeCwd   = computeRuntimeCwd(app.isPackaged, app.getPath('userData'), __dirname);

    const proc = spawn(venvPython, [
        '-m', 'lxsrs_v2',
        ...freqArgs,
        '--tx-freq',  config.txFreq,
        '--host',     config.srsHost,
        '--port',     String(config.srsPort),
        '--play-audio',
        '--api-port', String(config.srsApiPort),
    ], {
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
    process.env.CRC_SYNC_URL       = config.crcSyncUrl || 'wss://asacs.sourcedcs.page';
    process.env.CASDOOR_CLIENT_ID  = config.casdoorClientId || '';
    process.env.CASDOOR_ENDPOINT   = config.casdoorEndpoint || '';
    process.env.SRS_RADIO_API_PORT = String(config.srsApiPort);
    process.env.WS_PORT            = String(config.wsPort);
    process.env.SOURCEDCS_WEB_URL  = config.sourcedcsWebUrl || '';

    require('./app/server.js');

    win = new BrowserWindow({
        width:  1400,
        height: 900,
        title:  `CRC v${app.getVersion()}`,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
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
        if (process.env.CASDOOR_ENDPOINT && url.startsWith(process.env.CASDOOR_ENDPOINT + '/login/oauth/authorize')) {
            return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 640, parent: win, modal: true } };
        }
        return { action: 'deny' };
    });

    let lastUpdateStatus = { state: 'idle' };
    function sendUpdateStatus(status) {
        lastUpdateStatus = status;
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