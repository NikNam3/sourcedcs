'use strict';

// A small client for the XDG desktop portal on the session bus, the D-Bus half of portal-listener.js. Pure JS
// (`@homebridge/dbus-native`), loaded on first use. Requests follow the portal's pattern: subscribe to the Response
// signal on the predicted request path, then call the method.

const DEST = 'org.freedesktop.portal.Desktop';
const PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST = 'org.freedesktop.portal.Request';
const SESSION = 'org.freedesktop.portal.Session';
const REGISTRY = 'org.freedesktop.host.portal.Registry';

const callback = (resolve, reject) => (err, ...out) => { if (err) reject(new Error(err.message || err.name || 'D-Bus error')); else resolve(out); };

/** A D-Bus `a{sv}` as dbus-native unmarshals it, as a plain object. */
function dictToObject(dict) {
  const out = {};
  for (const [key, variant] of dict || []) out[key] = variant[1][0];
  return out;
}

const vardict = (obj) => Object.entries(obj).map(([k, v]) => [k, ['s', v]]);

function busAddress(env) {
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  return env.XDG_RUNTIME_DIR ? `unix:path=${env.XDG_RUNTIME_DIR}/bus` : null;
}

/** @param {{env:object, load?:()=>object}} o  @returns {Promise<object>} the client */
async function connectPortal({ env, load }) {
  const address = busAddress(env);
  if (!address) throw new Error('no session bus');
  const dbus = load ? load() : require('@homebridge/dbus-native');
  const bus = dbus.sessionBus({ busAddress: address });
  // Before anything else: an 'error' with no listener is thrown, and would take the app down.
  let onLost = () => {};
  bus.connection.on('error', (err) => onLost(err));
  bus.connection.on('end', () => onLost(new Error('session bus closed')));

  const invoke = (msg) => new Promise((resolve, reject) => bus.invoke(msg, callback(resolve, reject)));
  const addMatch = (m) => new Promise((resolve, reject) => bus.addMatch(m, callback(resolve, reject)));
  const removeMatch = (m) => new Promise((resolve, reject) => bus.removeMatch(m, callback(resolve, reject)));
  const matchOf = (iface, member, path) => `type='signal',sender='${DEST}',interface='${iface}',member='${member}',path='${path}'`;

  // Replies arrive in order, so this one also proves Hello finished and `bus.name` is set.
  await new Promise((resolve, reject) => {
    onLost = reject;
    bus.invokeDbus({ member: 'GetId' }, callback(resolve, reject));
  });
  onLost = () => {};
  const sender = String(bus.name).replace(/^:/, '').replace(/\./g, '_');
  let tokens = 0;

  /** Calls a method that answers through a Request; `body(token)` builds its arguments. @returns {{code:number, results:object}} */
  async function request(member, signature, body) {
    const token = `crc_ptt_${process.pid}_${++tokens}`;
    const path = `${PATH}/request/${sender}/${token}`;
    const match = matchOf(REQUEST, 'Response', path);
    const key = bus.mangle(path, REQUEST, 'Response');
    await addMatch(match);
    try {
      return await new Promise((resolve, reject) => {
        onLost = reject;
        bus.signals.once(key, (args) => resolve({ code: args[0], results: dictToObject(args[1]) }));
        invoke({ destination: DEST, path: PATH, interface: SHORTCUTS, member, signature, body: body(token) }).catch(reject);
      });
    } finally {
      onLost = () => {};
      bus.signals.removeAllListeners(key);
      removeMatch(match).catch(() => {});
    }
  }

  /** `fn(args)` on a GlobalShortcuts signal. @returns the unsubscribe */
  async function onSignal(member, fn) {
    const match = matchOf(SHORTCUTS, member, PATH);
    const key = bus.mangle(PATH, SHORTCUTS, member);
    const handler = (args) => fn(args);
    bus.signals.on(key, handler);
    await addMatch(match);
    return () => { bus.signals.removeListener(key, handler); removeMatch(match).catch(() => {}); };
  }

  async function version() {
    const [value] = await invoke({
      destination: DEST, path: PATH, interface: 'org.freedesktop.DBus.Properties', member: 'Get', signature: 'ss', body: [SHORTCUTS, 'version'],
    });
    return value[1][0];
  }

  /** Names this app to the portal; must come before any other portal call. Refused on an older portal, which is fine. */
  async function register(appId) {
    await invoke({ destination: DEST, path: PATH, interface: REGISTRY, member: 'Register', signature: 'sa{sv}', body: [appId, []] });
  }

  const closeSession = (session) => invoke({ destination: DEST, path: session, interface: SESSION, member: 'Close' });

  return { request, onSignal, version, register, closeSession, close: () => bus.connection.end() };
}

module.exports = { connectPortal, dictToObject, vardict };
