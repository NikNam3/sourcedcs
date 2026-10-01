// The CRC client entry point (ESM-1, H87: native ES modules, no bundler). index.html loads the CDN scripts
// (maplibregl, dockview) and the local server's /js/config.js as classic scripts first, then this one module.
//
// Every module is imported once, in the order index.html listed the classic scripts. ESM evaluates in dependency
// order, not in this order, so nothing here relies on it: the start-up calls that used to run at script-execution
// time are made below, after every module has been evaluated (docs/wip/ESM-1.md, step 4).
import './sync.js';
import './geo.js';
import './magnetic.js';
import './iff.js';
import './track-label.js';
import './atc-scope.js';
import './geojson.js';
import './icons.js';
import './map-setup.js';
import './elevation.js';
import './los.js';
import './dock.js';
import './panels/topbar.js';
import './panels/settings-panel.js';
import './panels/radar-panel.js';
import './panels/los-panel.js';
import './panels/airport-selector.js';
import './panels/track-panel.js';
import './panels/tools-panel.js';
import './panels/aprt-panel.js';
import './panels/efsp/efsp-state.js';
import './panels/efsp/efsp-arrivals.js';
import './panels/efsp/time-chains.js';
import './panels/efsp/strip-template.js';
import './panels/efsp/strip-drag.js';
import './panels/efsp/efsp-nla.js';
import './panels/efsp/carrier-state.js';
import './panels/efsp/sfa-state.js';
import './panels/efsp/efsp-gestures.js';
import './panels/efsp/dot-command.js';
import './panels/efsp/annotation-editor.js';
import './panels/efsp/efsp-ws.js';
import './panels/efsp/efsp-metrics-client.js';
import './panels/efsp/correlation-highlight.js';
import './panels/efsp/marsa-badge.js';
import './panels/efsp/pattern-board.js';
import './panels/efsp/final-panel.js';
import './panels/efsp/ordnance-advisory.js';
import './panels/efsp/strip-fields.js';
import './panels/efsp/carrier-panel.js';
import './panels/efsp/bay-views.js';
import './panels/efsp/bay-view.js';
import './panels/efsp/strip-view.js';
import './panels/efsp/efsp-flight-plan-lookup.js';
import './panels/efsp/efsp-stereo-routes.js';
import './panels/efsp/scramble.js';
import './panels/efsp/efsp-panel.js';
import './panels/efsp/ato-strip.js';
import './panels/efsp/ato-import.js';
import './panels/efsp/airspace-panel.js';
import './panels/efsp/field-state-rules.js';
import './panels/efsp/field-state-panel.js';
import './panels/metrics-panel.js';
import './app.js';
import './classic-globals-bridge.js'; // last: for the Playwright specs only (see its header)
import { atcTick } from './atc-scope.js';
import { startApp } from './app.js';

// atc-scope.js started its beat when it loaded (before app.js booted).
setInterval(atcTick, 500);
// app.js's boot sequence (it ran last among the "provider" scripts).
startApp();
// srs-radio.js ran after app.js; it is self-contained (its own DOM elements by id).
await import('./srs-radio.js');
