# SETTINGS-TABS (lane wip)

The Settings panel was already tabbed (static HTML panes); it now also draws tabs that panels register.

## API for later lanes (`crc-desktop/app/public/js/settings-registry.js`, a leaf importing only `settings.js`)

```js
import { registerSettingsTab, getSetting } from '../settings-registry.js';   // path relative to the panel module

registerSettingsTab('par', [
  { key: 'parAutoscale', type: 'toggle', label: 'Autoscale', default: true },
  { key: 'parGpa', type: 'number', label: 'Default glideslope', unit: '°', default: 3.06, min: 2, max: 4, step: 0.01 },
  { key: 'parTolEl', type: 'number', label: 'Elevation tolerance ±', unit: '°', default: 1, min: 0.1, max: 3, step: 0.1 },
  { key: 'parMode', type: 'select', label: 'Mode', default: 'a', options: [['a', 'A'], ['b', 'B']] },
], { label: 'PAR' });          // call at module load; the tab appears before SRS

getSetting('parGpa');          // the controller's value or the default; read it where it is used
```
- Field types: `toggle`, `number` (min/max/step/unit, clamped; garbage keeps the old value), `select` (`options` as values or `[value, label]`). Optional `onChange(value)`.
- Field `key` is global (stored in the one `settings` object): prefix with the panel name. A clashing key or bad field throws at registration; registering the same tab id again replaces it.
- Persisted per controller in localStorage `crc-desktop-settings` (same place as every other setting, never synced). `setSetting(key, v)` validates and saves.
- The panel re-renders on `onSettingsTabsChanged`, so registering after the Settings panel mounted works.
- Rendered control ids are `set-<key>`; tab button `.stab[data-pane=<id>]`, pane `#stab-<id>`. Specs register via `crc.settingsRegistry.registerSettingsTab` (added to `e2e/helpers/modules.js`).
- Needed for the PAR tab (H116): autoscale, default glideslope 3.06, elevation and azimuth tolerance 1.0. Marshal (mockup): low-state margin 1.0 k lb, fuel report old after 10 min, mark changed clearances (toggle).

## What moved
No setting changed tab or key; the static tabs were renamed: DECLTR -> RADAR (pane `stab-radar`: declutter, navpoints, track visibility, extended centerline, debug), RADIO -> SRS (`stab-srs`). GENERAL, COLOURS, TOOLS unchanged. `srs-radio.js` selector updated. There are no EFSP settings today, so no EFSP tab exists yet (an EFSP lane registers `efsp`).

## Defaults taken
- Registered tabs sit before SRS; the 5 existing static tabs stay as HTML (not rewritten through the registry).
- No empty PAR/Marshal/Carrier tabs.

## Usage guide wording
"Settings has one tab per panel (General, Colours, Radar, SRS, Tools, and one for each panel that has its own settings). Values are yours and are kept on this computer."

## Findings
- The Radar pane's content label "Debug" and the Colours pane could move to General/Radar later; left alone to keep specs stable.
- No existing e2e spec referenced the renamed tab ids.
