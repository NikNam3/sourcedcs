'use strict';

// The global PTT listener for Wayland (docs/adr/0161 §3, S-RO-1 RO12): the org.freedesktop.portal.GlobalShortcuts
// portal. No hook: the desktop owns the key, keyboard only, and signals Activated and Deactivated for our shortcuts:
// one per channel (`crc_ptt`, and `crc_intercom` for the intercom PTT, docs/adr/0166 §1). So "capture" is the desktop's
// own dialog (a first bind, or ConfigureShortcuts for one it knows), and what comes back is the name the desktop gives
// the input. A bind names every shortcut of ours the desktop already knows besides the new one, so a session's set is
// never smaller than what is bound.

const { unwrap } = require('./portal-client');

const SHORTCUT_ID = 'crc_ptt';
const SHORTCUTS = Object.freeze({
  ptt: { id: SHORTCUT_ID, description: 'CRC push-to-talk' },
  intercom: { id: 'crc_intercom', description: 'CRC intercom push-to-talk' },
});
const CHANNELS = Object.keys(SHORTCUTS);
const SESSION_TOKEN = 'crc_ptt'; // stable: a desktop that cannot identify the app keys the shortcut on this
const APP_ID = 'page.sourcedcs.crc'; // build.appId
const FALLBACK_LABEL = 'Desktop shortcut';
const CAPTURE_TIMEOUT_MS = 120000; // a person reading a desktop dialog
const CANCELLED = new Error('cancelled');

const channelOf = (c) => (c === 'intercom' ? 'intercom' : 'ptt');
const findMine = (shortcuts, channel = 'ptt') => (shortcuts || []).find(s => s[0] === SHORTCUTS[channel].id);
const labelOf = (entry) => (entry && unwrap(entry[1].trigger_description)) || FALLBACK_LABEL;

/** @param {{connect:()=>Promise<object>}} o */
function createPortalListener({ connect }) {
  let client = null, session = null, unsubscribe = [];
  let cancelled = null; // rejects the capture in progress

  async function open() {
    client = await connect();
    await client.register(APP_ID).catch(() => {});
    const made = await client.request('CreateSession', 'a{sv}', (options) => [options], { session_handle_token: SESSION_TOKEN });
    if (made.code !== 0 || !made.results.session_handle) throw new Error(`CreateSession answered ${made.code}`);
    session = made.results.session_handle;
  }

  /** The desktop's shortcuts of ours, by channel (an entry, or undefined). */
  async function listed() {
    const answer = await client.request('ListShortcuts', 'oa{sv}', (options) => [session, options]);
    const out = {};
    if (answer.code === 0) for (const c of CHANNELS) out[c] = findMine(answer.results.shortcuts, c);
    return out;
  }

  /** Once per session. @returns the label per channel bound, or null if the controller said no */
  async function bind(channels) {
    const shortcuts = channels.map(c => [SHORTCUTS[c].id, client.describe({ description: SHORTCUTS[c].description })]);
    const bound = await client.request('BindShortcuts', 'oa(sa{sv})sa{sv}', (options) => [session, shortcuts, '', options]);
    if (bound.code !== 0) return null;
    const labels = {};
    for (const c of channels) labels[c] = labelOf(findMine(bound.results.shortcuts, c));
    return labels;
  }

  async function close() {
    for (const off of unsubscribe) off();
    unsubscribe = [];
    const c = client, s = session;
    client = null; session = null;
    if (!c) return;
    if (s) await c.closeSession(s).catch(() => {});
    c.close();
  }

  // `bindings`: `{ ptt, intercom }`, a binding or null each; an edge names the channel it is for.
  async function start(bindings, onEdge) {
    const wanted = CHANNELS.filter(c => bindings[c]);
    try {
      await open();
      const edge = (down) => (args) => {
        if (args[0] !== session) return;
        const c = wanted.find(x => SHORTCUTS[x].id === args[1]);
        if (c) onEdge(c, down);
      };
      unsubscribe.push(await client.onSignal('Activated', edge(true)));
      unsubscribe.push(await client.onSignal('Deactivated', edge(false)));
      await client.onPortalRestart(() => {
        for (const c of wanted) onEdge(c, false);
        close().then(() => start(bindings, onEdge)).catch(() => {});
      });
      const known = await listed();
      let labels = {};
      for (const c of wanted) if (known[c]) labels[c] = labelOf(known[c]);
      if (wanted.some(c => !known[c])) {
        labels = await bind(CHANNELS.filter(c => wanted.includes(c) || known[c]));
        if (!labels) throw new Error('shortcut refused');
      }
      return { labels };
    } catch (err) {
      await close();
      throw err;
    }
  }

  // A shortcut the desktop already knows is changed in its own dialog, and its answer is ShortcutsChanged. A cancel or
  // the timeout leaves it as it was, so the current one is still the answer.
  async function reconfigure(known, channel) {
    if (!(await client.version() >= 2)) return labelOf(known);
    const changed = new Promise((resolve) => {
      client.onSignal('ShortcutsChanged', (args) => { if (args[0] === session) resolve(labelOf(findMine(args[1], channel) || known)); })
        .then((off) => { unsubscribe.push(off); return client.configureShortcuts(session); })
        .catch(() => resolve(labelOf(known)));
    });
    return Promise.race([changed, new Promise((resolve) => { cancelled = () => resolve(labelOf(known)); })]);
  }

  async function capture(channel) {
    const c = channelOf(channel);
    try {
      await open();
      const known = await listed();
      const label = known[c]
        ? await reconfigure(known[c], c)
        : await Promise.race([
          bind(CHANNELS.filter(x => x === c || known[x])).then(labels => labels && labels[c]),
          new Promise((_, reject) => { cancelled = () => reject(CANCELLED); }),
        ]);
      return label ? { shortcutId: SHORTCUTS[c].id, label } : null;
    } catch (err) {
      if (err === CANCELLED) return null;
      throw err;
    } finally {
      cancelled = null;
      await close();
    }
  }

  function cancelCapture() { if (cancelled) cancelled(); }

  function accepts(b, channel) { return !!b && b.shortcutId === SHORTCUTS[channelOf(channel)].id && typeof b.label === 'string'; }

  /** Asks the portal whether it has GlobalShortcuts; touches no shortcut. Throws if not. */
  async function probe() {
    const c = await connect();
    try {
      const v = await c.version();
      if (!(v >= 1)) throw new Error('no GlobalShortcuts portal');
    } finally {
      c.close();
    }
  }

  return { kind: 'portal', captureTimeoutMs: CAPTURE_TIMEOUT_MS, probe, start, stop: close, capture, cancelCapture, accepts };
}

module.exports = { createPortalListener, SHORTCUT_ID, SHORTCUTS };
