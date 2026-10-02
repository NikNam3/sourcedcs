'use strict';

/* The specs' one way into the client's modules (BRIDGE, replacing js/classic-globals-bridge.js).
 *
 * `installAppModules(page)` puts `window.crc` on the page: one namespace object per module the specs use,
 * made with a dynamic `import()` of the same URL main.js loaded, so each is the very module record the app
 * runs (live bindings: `crc.state.efspStrips` is the Map the panel renders). Nothing in production reads or
 * writes `window.crc`, and there are no getters on `window`.
 *
 *   crc.state.getAllEfspStrips()
 *   crc.ws.setEfspSender('sendEfspMutation', fn)   // a sender is replaced through the owning module's setter,
 *   crc.sync.setSendToSync(fn)                      // never by assigning to a name
 *
 * Inside page.evaluate / waitForFunction, read `crc.<key>.<name>`. Add a module to MODULES when a spec needs it.
 */

const MODULES = {
  state: '/js/panels/efsp/efsp-state.js',
  ws: '/js/panels/efsp/efsp-ws.js',
  sync: '/js/sync.js',
  dock: '/js/dock.js', // crc.dock.dock is the dockview instance (null until initDock runs)
  app: '/js/app.js',
  bayView: '/js/panels/efsp/bay-view.js',
  carrier: '/js/panels/efsp/carrier-state.js',
  nla: '/js/panels/efsp/efsp-nla.js',
  sfa: '/js/panels/efsp/sfa-state.js',
  metricsClient: '/js/panels/efsp/efsp-metrics-client.js',
  metricsPanel: '/js/panels/metrics-panel.js',
  stereo: '/js/panels/efsp/efsp-stereo-routes.js',
  fields: '/js/panels/efsp/strip-fields.js',
  template: '/js/panels/efsp/strip-template.js',
  drag: '/js/panels/efsp/strip-drag.js',
  marsaBadge: '/js/panels/efsp/marsa-badge.js',
  geojson: '/js/geojson.js',
  geo: '/js/geo.js',
  atc: '/js/atc-scope.js',
};

/** Runs after page.goto('/'). Resolves once every module is imported and `window.crc` exists. */
async function installAppModules(page) {
  await page.evaluate(async (modules) => {
    if (window.crc) return;
    const crc = {};
    for (const [key, url] of Object.entries(modules)) crc[key] = await import(url);
    window.crc = crc;
  }, MODULES);
}

module.exports = { MODULES, installAppModules };
