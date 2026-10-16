'use strict';

// SRS radio bridge launch logic, pulled out of main.js so it can be unit
// tested without Electron — `require('electron')` outside a running
// Electron process just returns a path string, not the app/BrowserWindow
// API, so any of this logic that touched `app.isPackaged`/`app.getPath()`
// directly couldn't be exercised by a plain `node --test` run. Every
// Electron-derived value (isPackaged, resourcesPath, userDataPath, dirname)
// is passed in explicitly instead.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// lxsrs_v2's third-party deps (numpy, opuslib, ...) include compiled C
// extensions tied to the exact CPython ABI they were built against —
// bundling pre-built wheels at package time can't work reliably since we
// don't know which Python version an end user's system will have (Fedora,
// Ubuntu, Arch, ... all ship different ones, and none match whatever CI's
// runner happens to have). Instead, on first run we create a venv against
// whichever `python3` is actually on this machine and pip-install into
// that, so the compiled wheels pip resolves are always ABI-correct for the
// system that's about to run them. lxsrs_v2 itself stays PYTHONPATH-loaded
// from the bundled python-pkg source (see computePythonPkgDir) — only its
// third-party dependencies need the venv.
//
// pynput is deliberately NOT here: it's only used for the alternate
// --ptt-mode pynput (hold-to-talk) path, which we never pass (we use the
// default stdin/Enter-toggle PTT), and lxsrs_v2's client.py already
// lazy-imports it itself with its own error handling for that path. On
// Linux pynput hard-requires evdev, which has no prebuilt wheel on PyPI —
// every install would need a C compiler + matching kernel headers, which
// most end-user desktops don't have. Skipping it avoids that failure mode
// entirely for a dependency we don't use.
const LXSRS_VENV_DEPS = ['numpy', 'sounddevice', 'opuslib'];

// extraResources (see package.json's build.linux.extraResources) puts
// python-pkg under resourcesPath in a packaged app, not next to main.js
// inside the asar — only the dev (unpackaged) run has it at dirname/python-pkg.
function computePythonPkgDir(isPackaged, resourcesPath, dirname) {
    return isPackaged
        ? path.join(resourcesPath, 'python-pkg')
        : path.join(dirname, 'python-pkg');
}

// dirname resolves inside app.asar when packaged, which is a single file on
// disk (not a real directory) -- spawn()'s cwd can't chdir into it
// (ENOTDIR, regression covered by tests/lxsrs-setup.test.js). userData is
// also where lxsrs can actually write its log/state files; resourcesPath is
// read-only inside the AppImage mount.
function computeRuntimeCwd(isPackaged, userDataPath, dirname) {
    return isPackaged ? userDataPath : path.join(dirname);
}

function venvPaths(venvDir) {
    return {
        venvPython: path.join(venvDir, 'bin', 'python3'),
        // Written only after pip install actually succeeds — venvPython
        // alone existing isn't proof setup finished (e.g. the app quit or
        // lost network mid pip-install on a previous run); checking just
        // for that would silently reuse a half-installed venv missing its
        // deps forever (regression covered by tests/lxsrs-setup.test.js).
        completeMarker: path.join(venvDir, '.setup-complete'),
    };
}

function isVenvReady(venvDir) {
    return fs.existsSync(venvPaths(venvDir).completeMarker);
}

function runCmd(cmd, args, opts, onOutputLine) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, opts);
        const relay = (stream) => {
            stream.setEncoding('utf8');
            stream.on('data', chunk => {
                chunk.split('\n').filter(Boolean).forEach(line => onOutputLine && onOutputLine(line));
            });
        };
        relay(proc.stdout);
        relay(proc.stderr);
        proc.on('error', reject);
        proc.on('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
    });
}

// Returns the venv's python3 path once its deps are installed, or null if
// setup failed (in which case the SRS radio feature is skipped rather than
// crashing the app). `log` defaults to a no-op so tests stay quiet.
async function ensureLxsrsVenv(venvDir, log = () => {}) {
    const { venvPython, completeMarker } = venvPaths(venvDir);

    if (isVenvReady(venvDir)) return venvPython;

    log('setting up a Python environment for the SRS radio bridge...');
    try {
        await runCmd('python3', ['-m', 'venv', venvDir], undefined, log);
        await runCmd(venvPython, ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', ...LXSRS_VENV_DEPS], undefined, log);
        fs.writeFileSync(completeMarker, new Date().toISOString());
        log('done.');
        return venvPython;
    } catch (err) {
        log(
            `failed to set up the SRS radio Python environment: ${err.message}` +
            ` — SRS radio will be unavailable this session. To fix manually, run:\n` +
            `  python3 -m venv "${venvDir}" && "${venvPython}" -m pip install ${LXSRS_VENV_DEPS.join(' ')}`
        );
        return null;
    }
}

// The bridge's command line from config.json. Every frequency comes from
// config (H147 RQ5: no station frequency in code): `freqs`/`txFreq` are the
// radios it starts with, `defaultFreq` the one a radio added later tunes to.
// Without `defaultFreq` the bridge leaves an added radio untuned.
function lxsrsArgs(config) {
    const args = ['-m', 'lxsrs_v2', ...config.freqs.flatMap(f => ['--freq', String(f)])];
    if (config.txFreq != null && config.txFreq !== '') args.push('--tx-freq', String(config.txFreq));
    if (config.defaultFreq != null && config.defaultFreq !== '') args.push('--default-freq', String(config.defaultFreq));
    args.push(
        '--host',     config.srsHost,
        '--port',     String(config.srsPort),
        '--play-audio',
        '--api-port', String(config.srsApiPort),
    );
    return args;
}

module.exports = {
    LXSRS_VENV_DEPS,
    lxsrsArgs,
    computePythonPkgDir,
    computeRuntimeCwd,
    venvPaths,
    isVenvReady,
    runCmd,
    ensureLxsrsVenv,
};
