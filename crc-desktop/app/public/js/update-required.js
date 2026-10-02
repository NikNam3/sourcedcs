// The "Update required" overlay (crc-sync docs/adr/0103). crc-sync refuses a client whose wire protocol differs from its own
// with one `update-required` frame and close code 4426; app.js stops reconnecting and shows this. Built in the style of
// sync.js's login gate. The decision (what to say, which button) is `viewFor`, a pure function, so it is tested as a table.

import { WIRE_PROTOCOL } from './wire-protocol.js';

export const UPDATE_REQUIRED_CLOSE = 4426;

const NO_UPDATE = 'No update is published yet. Ask the server admin.';

/**
 * @param {object} s
 * @param {number|null} s.serverProtocol  the server's protocol, from the frame; null when only the close code arrived
 * @param {number} [s.clientProtocol]     this client's protocol (default: the compiled-in one)
 * @param {boolean} s.hasUpdater          window.crcUpdate with checkNow exists (packaged Electron)
 * @param {'idle'|'checking'|'downloading'|'ready'|'none'} s.phase  idle: not asked yet; none: the updater found nothing
 * @param {number} [s.percent]
 * @param {string} [s.downloadUrl]
 * @returns {{ kind: 'older'|'newer', text: string, button: 'check'|'restart'|null, showLink: boolean, retry: boolean }}
 */
export function viewFor({ serverProtocol, clientProtocol = WIRE_PROTOCOL, hasUpdater, phase, percent = 0, downloadUrl }) {
  const nums = serverProtocol == null ? '' : ` (server ${serverProtocol}, CRC ${clientProtocol})`;
  if (serverProtocol != null && serverProtocol < clientProtocol) {
    return { kind: 'newer', text: `This CRC is newer than the server${nums}. The server must be updated first.`, button: null, showLink: false, retry: true };
  }
  const head = `Update required. This crc-sync speaks a newer protocol${nums}.`;
  if (!hasUpdater || phase === 'none') {
    return { kind: 'older', text: `${head} ${NO_UPDATE}`, button: null, showLink: !!downloadUrl, retry: true };
  }
  if (phase === 'checking') return { kind: 'older', text: `${head} Checking for an update...`, button: null, showLink: false, retry: true };
  if (phase === 'downloading') return { kind: 'older', text: `${head} Downloading the update (${percent}%).`, button: null, showLink: false, retry: true };
  if (phase === 'ready') return { kind: 'older', text: `${head} The update is downloaded.`, button: 'restart', showLink: false, retry: true };
  return { kind: 'older', text: head, button: 'check', showLink: !!downloadUrl, retry: true };
}

let state = null; // { frame, phase, percent, onRetry }
let listening = false;

const ID = 'crc-update-required';
const BTN = 'padding:10px 26px;background:#132313;color:#39ff7a;border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:2px;font-size:12px;';
const BTN2 = 'padding:6px 16px;background:transparent;color:#5a7a5a;border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:1.5px;font-size:10px;';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render() {
  if (!state) return;
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.style.cssText = 'position:fixed;inset:0;background:#0a0e0a;color:#8aab8a;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
      'z-index:99999;font-family:"Courier New",monospace;letter-spacing:1px;text-align:center;padding:24px;';
    document.body.appendChild(el);
  }
  const f = state.frame;
  const v = viewFor({
    serverProtocol: f.serverProtocol ?? null, hasUpdater: !!(window.crcUpdate && window.crcUpdate.checkNow),
    phase: state.phase, percent: state.percent, downloadUrl: f.downloadUrl,
  });
  const link = v.showLink && /^https?:\/\//.test(f.downloadUrl || '') ? `<a id="crc-update-link" href="${esc(f.downloadUrl)}" target="_blank" rel="noopener" style="color:#39ff7a;font-size:11px;">${esc(f.downloadUrl)}</a>` : '';
  el.dataset.kind = v.kind;
  el.innerHTML =
    '<div style="font-size:14px;letter-spacing:3px;color:#39ff7a;">CRC SYNC</div>' +
    '<div style="font-size:11px;letter-spacing:1.5px;" id="crc-update-text">' + esc(v.text) + '</div>' + link +
    (v.button === 'check' ? `<button id="crc-update-check" style="${BTN}">CHECK FOR UPDATE</button>` : '') +
    (v.button === 'restart' ? `<button id="crc-update-restart" style="${BTN}">RESTART TO UPDATE</button>` : '') +
    (v.retry ? `<button id="crc-update-retry" style="${BTN2}">RETRY</button>` : '');
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('crc-update-check', () => {
    state.phase = 'checking';
    render();
    Promise.resolve(window.crcUpdate.checkNow()).then((r) => {
      // 'idle' means nothing is running: not packaged, the check already found nothing, or it failed. The stream may not say so.
      if (state && state.phase === 'checking' && r && r.state === 'idle') { state.phase = 'none'; render(); }
    }, () => { if (state) { state.phase = 'none'; render(); } });
  });
  on('crc-update-restart', () => window.crcUpdate.restartNow());
  on('crc-update-retry', () => { const cb = state.onRetry; hideUpdateRequired(); if (cb) cb(); });
}

function onUpdaterStatus(status) {
  if (!state || !status) return;
  const s = status.state;
  if (s === 'checking') state.phase = 'checking';
  else if (s === 'downloading') { state.phase = 'downloading'; state.percent = status.percent ?? 0; }
  else if (s === 'ready') state.phase = 'ready';
  else if (s === 'idle') {
    // idle comes back as update-not-available (or an updater error): only meaningful once the user asked.
    if (state.phase === 'checking' || state.phase === 'downloading') state.phase = 'none';
    else return;
  }
  render();
}

/** @param {object} frame the update-required frame ({ serverProtocol, clientProtocol, downloadUrl? }) or {} when only the close code arrived */
export function showUpdateRequired(frame, { onRetry } = {}) {
  state = { frame: frame || {}, phase: 'idle', percent: 0, onRetry };
  if (!listening && window.crcUpdate && window.crcUpdate.onStatus) {
    listening = true;
    window.crcUpdate.onStatus(onUpdaterStatus);
  }
  render();
}

export function isUpdateRequiredShown() {
  return !!state;
}

export function hideUpdateRequired() {
  state = null;
  const el = document.getElementById(ID);
  if (el) el.remove();
}
