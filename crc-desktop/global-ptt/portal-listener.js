'use strict';

// The global PTT listener for Wayland (docs/adr/0161 §3): the org.freedesktop.portal.GlobalShortcuts portal. No hook:
// the desktop owns the key, asks the controller once to approve and assign it, and signals Activated and Deactivated
// for this one shortcut. So "capture" is the desktop's own dialog, and what comes back is the name it gives the input.
// A shortcut the desktop already knows is returned without asking; changing it is done in the desktop's shortcut
// settings, and the next start picks up the new name.

const { dictToObject, vardict } = require('./portal-client');

const SHORTCUT_ID = 'crc_ptt';
const SESSION_TOKEN = 'crc_ptt'; // stable: a desktop that cannot identify the app keys the shortcut on this
const APP_ID = 'page.sourcedcs.crc';
const DESCRIPTION = 'CRC push-to-talk';
const FALLBACK_NAME = 'Desktop shortcut';
const CAPTURE_TIMEOUT_MS = 120000; // a person reading a desktop dialog

/** @param {{connect:()=>Promise<object>}} o */
function createPortalListener({ connect }) {
  let client = null, session = null, unsubscribe = [];
  let cancelled = null; // rejects the capture in progress

  async function open() {
    client = await connect();
    await client.register(APP_ID).catch(() => {});
    const made = await client.request('CreateSession', 'a{sv}', (token) => [vardict({ handle_token: token, session_handle_token: SESSION_TOKEN })]);
    if (made.code !== 0 || !made.results.session_handle) throw new Error(`CreateSession answered ${made.code}`);
    session = made.results.session_handle;
  }

  async function bind() {
    const shortcuts = [[SHORTCUT_ID, vardict({ description: DESCRIPTION })]];
    const bound = await client.request('BindShortcuts', 'oa(sa{sv})sa{sv}', (token) => [session, shortcuts, '', vardict({ handle_token: token })]);
    if (bound.code !== 0) return null; // the controller said no
    const mine = (bound.results.shortcuts || []).find(s => s[0] === SHORTCUT_ID);
    const trigger = mine ? dictToObject(mine[1]).trigger_description : '';
    return trigger || FALLBACK_NAME;
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
      const name = await bind();
      if (!name) throw new Error('shortcut refused');
      return { name };
    } catch (err) {
      await close();
      throw err;
    }
  }

  async function capture() {
    try {
      await open();
      const name = await Promise.race([bind(), new Promise((_, reject) => { cancelled = reject; })]);
      return name ? { type: 'portal', id: SHORTCUT_ID, name } : null;
    } catch (err) {
      if (err === CANCELLED) return null;
      throw err;
    } finally {
      cancelled = null;
      await close();
    }
  }

  function cancelCapture() { if (cancelled) cancelled(CANCELLED); }

  function accepts(b) { return !!b && b.type === 'portal' && b.id === SHORTCUT_ID && typeof b.name === 'string'; }

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

const CANCELLED = new Error('cancelled');

module.exports = { createPortalListener, SHORTCUT_ID };
