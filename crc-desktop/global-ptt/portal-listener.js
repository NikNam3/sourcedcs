'use strict';

// The global PTT listener for Wayland (docs/adr/0161 §3, S-RO-1 RO12): the org.freedesktop.portal.GlobalShortcuts
// portal. No hook: the desktop owns the key, keyboard only, and signals Activated and Deactivated for this one shortcut.
// So "capture" is the desktop's own dialog (a first bind, or ConfigureShortcuts for one it knows), and what comes back
// is the name the desktop gives the input.

const { unwrap } = require('./portal-client');

const SHORTCUT_ID = 'crc_ptt';
const SESSION_TOKEN = 'crc_ptt'; // stable: a desktop that cannot identify the app keys the shortcut on this
const APP_ID = 'page.sourcedcs.crc'; // build.appId
const DESCRIPTION = 'CRC push-to-talk';
const FALLBACK_LABEL = 'Desktop shortcut';
const CAPTURE_TIMEOUT_MS = 120000; // a person reading a desktop dialog
const CANCELLED = new Error('cancelled');

const findMine = (shortcuts) => (shortcuts || []).find(s => s[0] === SHORTCUT_ID);
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

  async function listed() {
    const answer = await client.request('ListShortcuts', 'oa{sv}', (options) => [session, options]);
    return answer.code === 0 ? findMine(answer.results.shortcuts) : undefined;
  }

  /** Once per session. @returns the label, or null if the controller said no */
  async function bind() {
    const shortcuts = [[SHORTCUT_ID, client.describe({ description: DESCRIPTION })]];
    const bound = await client.request('BindShortcuts', 'oa(sa{sv})sa{sv}', (options) => [session, shortcuts, '', options]);
    return bound.code === 0 ? labelOf(findMine(bound.results.shortcuts)) : null;
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

  async function start(binding, onEdge) {
    try {
      await open();
      const edge = (down) => (args) => { if (args[0] === session && args[1] === SHORTCUT_ID) onEdge(down); };
      unsubscribe.push(await client.onSignal('Activated', edge(true)));
      unsubscribe.push(await client.onSignal('Deactivated', edge(false)));
      await client.onPortalRestart(() => {
        onEdge(false);
        close().then(() => start(binding, onEdge)).catch(() => {});
      });
      const known = await listed();
      const label = known ? labelOf(known) : await bind();
      if (!label) throw new Error('shortcut refused');
      return { label };
    } catch (err) {
      await close();
      throw err;
    }
  }

  // A shortcut the desktop already knows is changed in its own dialog, and its answer is ShortcutsChanged. A cancel or
  // the timeout leaves it as it was, so the current one is still the answer.
  async function reconfigure(known) {
    if (!(await client.version() >= 2)) return labelOf(known);
    const changed = new Promise((resolve) => {
      client.onSignal('ShortcutsChanged', (args) => { if (args[0] === session) resolve(labelOf(findMine(args[1]))); })
        .then((off) => { unsubscribe.push(off); return client.configureShortcuts(session); })
        .catch(() => resolve(labelOf(known)));
    });
    return Promise.race([changed, new Promise((resolve) => { cancelled = () => resolve(labelOf(known)); })]);
  }

  async function capture() {
    try {
      await open();
      const known = await listed();
      const label = known
        ? await reconfigure(known)
        : await Promise.race([bind(), new Promise((_, reject) => { cancelled = () => reject(CANCELLED); })]);
      return label ? { shortcutId: SHORTCUT_ID, label } : null;
    } catch (err) {
      if (err === CANCELLED) return null;
      throw err;
    } finally {
      cancelled = null;
      await close();
    }
  }

  function cancelCapture() { if (cancelled) cancelled(); }

  function accepts(b) { return !!b && b.shortcutId === SHORTCUT_ID && typeof b.label === 'string'; }

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

module.exports = { createPortalListener, SHORTCUT_ID };
