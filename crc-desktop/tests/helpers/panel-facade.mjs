/* The names efsp-panel.js used to re-export (DESK-SPLIT: it keeps only init and refresh now), as one namespace-like
 * object for the tests that mount the panel: a read finds the name in efsp-panel.js or in the panel/ module that owns it. */
const MODULES = [
  'panels/efsp/efsp-panel.js', 'panels/efsp/panel/state.js', 'panels/efsp/panel/staleness.js', 'panels/efsp/panel/tabs.js',
  'panels/efsp/panel/arrivals.js', 'panels/efsp/panel/create-strip.js', 'panels/efsp/panel/refusal.js', 'panels/efsp/panel/dot-commands.js',
];

export async function panelFacade(g) {
  const namespaces = [];
  for (const m of MODULES) namespaces.push(await g.import(m));
  const owner = (name) => namespaces.find(ns => name in ns);
  return new Proxy({}, {
    get(_, name) { const ns = owner(name); return ns ? ns[name] : undefined; },
    has(_, name) { return !!owner(name); },
    ownKeys() { return [...new Set(namespaces.flatMap(ns => Object.keys(ns)))]; },
    getOwnPropertyDescriptor(_, name) { const ns = owner(name); return ns ? { enumerable: true, configurable: true, value: ns[name] } : undefined; },
  });
}
