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

// Global push-to-talk (docs/adr/0161 §3). The renderer hears only press and release of the one bound input.
contextBridge.exposeInMainWorld('crcGlobalPtt', {
    status:        () => ipcRenderer.invoke('global-ptt-status'),
    configure:     (cfg) => ipcRenderer.invoke('global-ptt-configure', cfg),
    capture:       () => ipcRenderer.invoke('global-ptt-capture'),
    cancelCapture: () => ipcRenderer.send('global-ptt-cancel-capture'),
    fuseFired:     () => ipcRenderer.send('global-ptt-fuse'),
    onEdge: (cb) => {
        const handler = (_event, down) => cb(down === true);
        ipcRenderer.on('global-ptt-edge', handler);
        return () => ipcRenderer.removeListener('global-ptt-edge', handler);
    },
});
