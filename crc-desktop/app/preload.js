'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crcUpdate', {
    onStatus:       (cb) => ipcRenderer.on('update-status', (_event, status) => cb(status)),
    restartNow:     () => ipcRenderer.send('update-restart-now'),
    getPatchNotes:  () => ipcRenderer.invoke('get-last-patch-notes'),
    getAppVersion:  () => ipcRenderer.invoke('get-app-version'),
    checkNow:       () => ipcRenderer.invoke('update-check-now'),
});

contextBridge.exposeInMainWorld('crcLinks', {
    // The booking page's URL, as crc-sync sent it (main.js lets only that origin open in the user's browser).
    allowBookingUrl: (url) => ipcRenderer.send('external-link-allow', url),
    // The update-required frame's download page (CRCSYNC_DOWNLOAD_URL); only its origin may open.
    allowDownloadUrl: (url) => ipcRenderer.send('external-link-allow-download', url),
});

contextBridge.exposeInMainWorld('crcLaunch', {
    // Store the launch mode ('full' | 'radio') and relaunch in it (docs/adr/0161 §1, main.js).
    switchTo: (mode) => ipcRenderer.send('launch-mode-switch', mode),
});

// Global push-to-talk (docs/adr/0161 §3). The renderer hears only press and release of the bound inputs, one per
// channel (the PTT and the intercom PTT, docs/adr/0166 §1).
contextBridge.exposeInMainWorld('crcGlobalPtt', {
    status:        () => ipcRenderer.invoke('global-ptt-status'),
    configure:     (cfg) => ipcRenderer.invoke('global-ptt-configure', cfg),
    // channel: 'ptt' or 'intercom' (docs/adr/0166 §1); anything else is 'ptt'
    capture:       (channel) => ipcRenderer.invoke('global-ptt-capture', channel === 'intercom' ? 'intercom' : 'ptt'),
    cancelCapture: () => ipcRenderer.send('global-ptt-cancel-capture'),
    fuseFired:     (channel) => ipcRenderer.send('global-ptt-fuse', channel === 'intercom' ? 'intercom' : 'ptt'),
    onEdge: (cb) => {
        const handler = (_event, down, channel) => cb(down === true, channel === 'intercom' ? 'intercom' : 'ptt');
        ipcRenderer.on('global-ptt-edge', handler);
        return () => ipcRenderer.removeListener('global-ptt-edge', handler);
    },
});
