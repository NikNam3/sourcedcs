'use strict';

// A small client for the XDG desktop portal on the session bus, the D-Bus half of portal-listener.js. Pure JS
// (`@particle/dbus-next`), loaded on first use. Requests follow the portal's pattern: subscribe to the Response signal
// on the predicted request path, then call the method.

const DEST = 'org.freedesktop.portal.Desktop';
const PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST = 'org.freedesktop.portal.Request';
const SESSION = 'org.freedesktop.portal.Session';
const REGISTRY = 'org.freedesktop.host.portal.Registry';
const DBUS = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';

function busAddress(env) {
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  return env.XDG_RUNTIME_DIR ? `unix:path=${env.XDG_RUNTIME_DIR}/bus` : null;
}

/** A variant's value, however deep the caller needs it. */
const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

/** @param {{env:object, load?:()=>object}} o  @returns {Promise<object>} the client */
async function connectPortal({ env, load }) {
  const address = busAddress(env);
  if (!address) throw new Error('no session bus');
  const dbus = load ? load() : require('@particle/dbus-next');
  const { Message, Variant } = dbus;
  const bus = dbus.sessionBus({ busAddress: address });
  const str = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, new Variant('s', v)]));

  // Before anything else: an 'error' with no listener is thrown, and would take the app down.
  let onLost = () => {};
  bus.on('error', (err) => onLost(err));

  await new Promise((resolve, reject) => {
    onLost = reject;
    bus.once('connect', resolve);
  });
  onLost = () => {};

  const call = async (msg) => (await bus.call(new Message(msg))).body;
  const toBus = (member, match) => call({ destination: DBUS, path: DBUS_PATH, interface: DBUS, member, signature: 's', body: [match] });
  const matchOf = (sender, iface, member, path) => `type='signal',sender='${sender}',interface='${iface}',member='${member}',path='${path}'`;

  // One dispatcher: `${path}|${interface}|${member}` to its handlers.
  const handlers = new Map();
  bus.on('message', (msg) => {
    if (msg.type !== dbus.MessageType.SIGNAL) return;
    const fn = handlers.get(`${msg.path}|${msg.interface}|${msg.member}`);
    if (fn) fn(msg.body);
  });

  async function subscribe(sender, iface, member, path, fn) {
    const key = `${path}|${iface}|${member}`, match = matchOf(sender, iface, member, path);
    handlers.set(key, fn);
    await toBus('AddMatch', match);
    return () => { handlers.delete(key); toBus('RemoveMatch', match).catch(() => {}); };
  }

  const sender = String(bus.name).replace(/^:/, '').replace(/\./g, '_');
  let tokens = 0;

  /** Calls a method that answers through a Request. `body(options)` builds its arguments, given the options variant dict. */
  async function request(member, signature, body, extra = {}) {
    const token = `crc_ptt_${process.pid}_${++tokens}`;
    const path = `${PATH}/request/${sender}/${token}`;
    let off = () => {};
    try {
      return await new Promise((resolve, reject) => {
        onLost = reject;
        subscribe(DEST, REQUEST, 'Response', path, ([code, results]) => {
          resolve({ code, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, unwrap(v)])) });
        }).then((unsub) => {
          off = unsub;
          return call({ destination: DEST, path: PATH, interface: SHORTCUTS, member, signature, body: body(str({ handle_token: token, ...extra })) });
        }).catch(reject);
      });
    } finally {
      onLost = () => {};
      off();
    }
  }

  /** `fn(args)` on a GlobalShortcuts signal. @returns the unsubscribe */
  const onSignal = (member, fn) => subscribe(DEST, SHORTCUTS, member, PATH, fn);

  /** `fn()` when the portal comes back after going away: its sessions and its registration are gone. */
  function onPortalRestart(fn) {
    const match = `type='signal',sender='${DBUS}',interface='${DBUS}',member='NameOwnerChanged',path='${DBUS_PATH}',arg0='${DEST}'`;
    handlers.set(`${DBUS_PATH}|${DBUS}|NameOwnerChanged`, ([name, , owner]) => { if (name === DEST && owner) fn(); });
    return toBus('AddMatch', match);
  }

  async function version() {
    const [value] = await call({
      destination: DEST, path: PATH, interface: 'org.freedesktop.DBus.Properties', member: 'Get', signature: 'ss', body: [SHORTCUTS, 'version'],
    });
    return unwrap(value);
  }

  /** Names this app to the portal; must come before any other portal call. Refused on an older portal, which is fine. */
  const register = (appId) => call({ destination: DEST, path: PATH, interface: REGISTRY, member: 'Register', signature: 'sa{sv}', body: [appId, {}] });

  /** Opens the desktop's dialog for this session's shortcuts (portal version 2); answers through ShortcutsChanged. */
  const configureShortcuts = (session) => call({ destination: DEST, path: PATH, interface: SHORTCUTS, member: 'ConfigureShortcuts', signature: 'osa{sv}', body: [session, '', {}] });

  const closeSession = (session) => call({ destination: DEST, path: session, interface: SESSION, member: 'Close' });

  return {
    request, onSignal, onPortalRestart, version, register, configureShortcuts, closeSession, describe: str,
    close: () => bus.disconnect(),
  };
}

module.exports = { connectPortal, unwrap };
