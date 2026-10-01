// Classic-globals bridge (ESM-1, supervisor ruling S-ESM1a): TRANSITIONAL, for the Playwright specs only.
//
// Before ESM-1 every top-level name of every client script lived in the page's one global scope, and the e2e specs
// (crc-desktop/e2e/**) read them by name inside page.evaluate (getAllEfspStrips(), efspStrips, dock, map, ...) and
// intercepted sends by assigning window.sendToSync / window.sendEfsp*. Modules have no shared global scope, so this
// file puts a live getter on window for every name a module exports. Assigning one is an error, except for the
// seven senders the specs replace, which go through the owning module's setter so every importer sees the
// replacement. A name the browser already defines on window is left alone, listed in SKIPPED and reported with
// console.error, unless it is SHADOWED (history) or an EXPECTED_SKIP (none).
//
// Remove this file when the specs move to imports or a test hook. The name list is frozen in
// crc-desktop/tests/fixtures/module-graph-exports.json (bridge), so the debt stays visible.
import * as m_sync from './sync.js';
import * as m_geo from './geo.js';
import * as m_magnetic from './magnetic.js';
import * as m_iff from './iff.js';
import * as m_track_label from './track-label.js';
import * as m_atc_scope from './atc-scope.js';
import * as m_geojson from './geojson.js';
import * as m_icons from './icons.js';
import * as m_map_setup from './map-setup.js';
import * as m_elevation from './elevation.js';
import * as m_los from './los.js';
import * as m_dock from './dock.js';
import * as m_panels_topbar from './panels/topbar.js';
import * as m_panels_settings_panel from './panels/settings-panel.js';
import * as m_panels_radar_panel from './panels/radar-panel.js';
import * as m_panels_los_panel from './panels/los-panel.js';
import * as m_panels_airport_selector from './panels/airport-selector.js';
import * as m_panels_track_panel from './panels/track-panel.js';
import * as m_panels_tools_panel from './panels/tools-panel.js';
import * as m_panels_aprt_panel from './panels/aprt-panel.js';
import * as m_panels_efsp_efsp_state from './panels/efsp/efsp-state.js';
import * as m_panels_efsp_efsp_arrivals from './panels/efsp/efsp-arrivals.js';
import * as m_panels_efsp_time_chains from './panels/efsp/time-chains.js';
import * as m_panels_efsp_strip_template from './panels/efsp/strip-template.js';
import * as m_panels_efsp_strip_drag from './panels/efsp/strip-drag.js';
import * as m_panels_efsp_efsp_nla from './panels/efsp/efsp-nla.js';
import * as m_panels_efsp_carrier_state from './panels/efsp/carrier-state.js';
import * as m_panels_efsp_sfa_state from './panels/efsp/sfa-state.js';
import * as m_panels_efsp_efsp_gestures from './panels/efsp/efsp-gestures.js';
import * as m_panels_efsp_dot_command from './panels/efsp/dot-command.js';
import * as m_panels_efsp_annotation_editor from './panels/efsp/annotation-editor.js';
import * as m_panels_efsp_efsp_ws from './panels/efsp/efsp-ws.js';
import * as m_panels_efsp_efsp_metrics_client from './panels/efsp/efsp-metrics-client.js';
import * as m_panels_efsp_correlation_highlight from './panels/efsp/correlation-highlight.js';
import * as m_panels_efsp_marsa_badge from './panels/efsp/marsa-badge.js';
import * as m_panels_efsp_pattern_board from './panels/efsp/pattern-board.js';
import * as m_panels_efsp_final_panel from './panels/efsp/final-panel.js';
import * as m_panels_efsp_ordnance_advisory from './panels/efsp/ordnance-advisory.js';
import * as m_panels_efsp_strip_fields from './panels/efsp/strip-fields.js';
import * as m_panels_efsp_carrier_panel from './panels/efsp/carrier-panel.js';
import * as m_panels_efsp_bay_views from './panels/efsp/bay-views.js';
import * as m_panels_efsp_bay_view from './panels/efsp/bay-view.js';
import * as m_panels_efsp_strip_view from './panels/efsp/strip-view.js';
import * as m_panels_efsp_efsp_flight_plan_lookup from './panels/efsp/efsp-flight-plan-lookup.js';
import * as m_panels_efsp_efsp_stereo_routes from './panels/efsp/efsp-stereo-routes.js';
import * as m_panels_efsp_scramble from './panels/efsp/scramble.js';
import * as m_panels_efsp_efsp_panel from './panels/efsp/efsp-panel.js';
import * as m_panels_efsp_ato_strip from './panels/efsp/ato-strip.js';
import * as m_panels_efsp_ato_import from './panels/efsp/ato-import.js';
import * as m_panels_efsp_airspace_panel from './panels/efsp/airspace-panel.js';
import * as m_panels_efsp_field_state_rules from './panels/efsp/field-state-rules.js';
import * as m_panels_efsp_field_state_panel from './panels/efsp/field-state-panel.js';
import * as m_panels_metrics_panel from './panels/metrics-panel.js';
import * as m_app from './app.js';
import { setSendToSync } from './sync.js';
import { setEfspSender } from './panels/efsp/efsp-ws.js';

const MODULES = [m_sync, m_geo, m_magnetic, m_iff, m_track_label, m_atc_scope, m_geojson, m_icons, m_map_setup, m_elevation, m_los, m_dock, m_panels_topbar, m_panels_settings_panel, m_panels_radar_panel, m_panels_los_panel, m_panels_airport_selector, m_panels_track_panel, m_panels_tools_panel, m_panels_aprt_panel, m_panels_efsp_efsp_state, m_panels_efsp_efsp_arrivals, m_panels_efsp_time_chains, m_panels_efsp_strip_template, m_panels_efsp_strip_drag, m_panels_efsp_efsp_nla, m_panels_efsp_carrier_state, m_panels_efsp_sfa_state, m_panels_efsp_efsp_gestures, m_panels_efsp_dot_command, m_panels_efsp_annotation_editor, m_panels_efsp_efsp_ws, m_panels_efsp_efsp_metrics_client, m_panels_efsp_correlation_highlight, m_panels_efsp_marsa_badge, m_panels_efsp_pattern_board, m_panels_efsp_final_panel, m_panels_efsp_ordnance_advisory, m_panels_efsp_strip_fields, m_panels_efsp_carrier_panel, m_panels_efsp_bay_views, m_panels_efsp_bay_view, m_panels_efsp_strip_view, m_panels_efsp_efsp_flight_plan_lookup, m_panels_efsp_efsp_stereo_routes, m_panels_efsp_scramble, m_panels_efsp_efsp_panel, m_panels_efsp_ato_strip, m_panels_efsp_ato_import, m_panels_efsp_airspace_panel, m_panels_efsp_field_state_rules, m_panels_efsp_field_state_panel, m_panels_metrics_panel, m_app];
const SETTERS = {
  sendToSync: setSendToSync,
  sendEfspMutation: (fn) => setEfspSender('sendEfspMutation', fn),
  sendEfspCreateStrip: (fn) => setEfspSender('sendEfspCreateStrip', fn),
  sendEfspSetPositions: (fn) => setEfspSender('sendEfspSetPositions', fn),
  sendEfspAirspaceMutation: (fn) => setEfspSender('sendEfspAirspaceMutation', fn),
  sendEfspCorrelationMutation: (fn) => setEfspSender('sendEfspCorrelationMutation', fn),
  sendEfspMarsaMutation: (fn) => setEfspSender('sendEfspMarsaMutation', fn),
};

// Bridged although the browser defines it: the classic page's top-level `const history` (app.js) shadowed
// window.history for every bare reference, and l22-stars-scope.spec.js calls history.set(...) (S-ESM1c). The client
// and its libraries do not use the History API (maplibre's hash handler is off), but Playwright does: replacing
// window.history outright made every click wait out its timeout for a "scheduled navigation" (measured, ESM-1).
// So `history` is the browser's History object with app.js's Map methods forwarded onto it.
const SHADOWED = new Set(['history']);
const MAP_KEYS = new Set(['get', 'set', 'has', 'delete', 'clear', 'keys', 'values', 'entries', 'forEach', 'size', Symbol.iterator]);
function shadowValue(name, ns) {
  if (name !== 'history') return () => ns[name];
  const real = window.history;
  if (!real || typeof real !== 'object') return () => ns[name]; // no browser History (the Node test stub)
  const both = new Proxy(real, {
    get(target, key) {
      const from = MAP_KEYS.has(key) ? ns.history : target;
      const v = Reflect.get(from, key, from);
      return typeof v === 'function' ? v.bind(from) : v;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
  return () => both;
}
// Browser names an export may collide with and stay unbridged. None today: a new collision is reported loudly.
const EXPECTED_SKIPS = new Set();

export const BRIDGED = [];
export const SKIPPED = [];
if (typeof window !== 'undefined') {
  for (const ns of MODULES) {
    for (const name of Object.keys(ns)) {
      if (name in window && !SHADOWED.has(name)) {
        SKIPPED.push(name);
        if (!EXPECTED_SKIPS.has(name)) console.error(`classic-globals-bridge: ${name} is already defined on window and was not bridged`);
        continue;
      }
      const set = SETTERS[name] || (() => { throw new TypeError(`classic-globals-bridge: ${name} is read-only (a module binding)`); });
      const get = SHADOWED.has(name) ? shadowValue(name, ns) : () => ns[name];
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get, set });
      BRIDGED.push(name);
    }
  }
}
