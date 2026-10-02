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
});
