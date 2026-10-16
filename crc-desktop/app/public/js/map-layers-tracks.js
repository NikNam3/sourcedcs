'use strict';
import { ATC_MAX_SEGMENTS } from './geojson.js';
import { TEXT_SIZE_PX } from './scope-constants.js';
import { map } from './map-handle.js';

// The scope's track sources and layers (DESK-SPLIT, split out of map-setup.js's initMap): leader lines, track icons, the emergency
// square, ATC targets, labels and ATC data blocks. Run once, from the map's 'load', after the overlays.
export function addTrackLayers() {
  // ── Leader lines ─────────────────────────────────────────────────────
  map.addSource('leaders', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'leader-lines', type: 'line', source: 'leaders',
    paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': 0.75 },
  });

  // ── Track icons ──────────────────────────────────────────────────────
  map.addSource('units', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'unit-squares', type: 'symbol', source: 'units',
    filter: ['!=', ['get', 'scheme'], 'ATC'],
    layout: {
      'icon-image': [
        'case',
        // BANDIT / HOSTILE → filled triangle regardless of category
        ['==', ['get', 'iff'], 'bandit'],  'tri-iff-bandit',
        ['==', ['get', 'iff'], 'hostile'], 'tri-iff-hostile',
        // Ships
        ['==', ['get', 'domain'], 'SEA'],
        ['match', ['get', 'iff'], 'friendly','ship-iff-friendly', 'bogey','ship-iff-bogey', 'ship-iff-neutral'],
        // Aircraft on ground
        ['get', 'onGround'],
        ['match', ['get', 'iff'], 'friendly','ac-iff-friendly', 'bogey','ac-iff-bogey', 'ac-iff-neutral'],
        // Airborne
        ['match', ['get', 'iff'], 'friendly','sq-iff-friendly', 'bogey','sq-iff-bogey', 'sq-iff-neutral'],
      ],
      'icon-rotate':             ['case', ['get', 'onGround'], ['get', 'heading'], 0],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap':      true,
      'icon-ignore-placement':   true,
      'icon-size':               1,
    },
    paint: { 'icon-opacity': ['get', 'opacity'] },
  });

  // ── Emergency blinking square — rendered over the track icon ─────────
  // Uses the units source (which has emergency + emergencyColor properties).
  // Opacity is toggled globally via setPaintProperty() on each 500 ms pulse tick;
  // no per-frame source rebuild required.
  map.addLayer({
    id: 'unit-emerg-square', type: 'symbol', source: 'units',
    filter: ['all', ['!=', ['get', 'emergency'], ''], ['!=', ['get', 'scheme'], 'ATC']],
    layout: {
      'icon-image': ['match', ['get', 'emergency'],
        'gen',    'emerg-gen',
        'radio',  'emerg-radio',
        'hijack', 'emerg-hijack',
        'emerg-gen',
      ],
      'icon-allow-overlap':    true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.9 },
  });

  // ── ATC targets (crc-sync's docs/adr/0088) ───────────────────────────
  // STARS draws every track as a blue fused-target disc with one character
  // on it: the owner's letter, `*` for an uncorrelated beacon, `+` for
  // primary only. A coasting track keeps the character and loses the disc.
  map.addLayer({
    id: 'atc-targets', type: 'circle', source: 'units',
    filter: ['all', ['==', ['get', 'scheme'], 'ATC'], ['get', 'disc']],
    paint: {
      'circle-radius': 6, 'circle-color': ['get', 'targetColor'],
      'circle-opacity': ['get', 'targetOpacity'], 'circle-stroke-width': 0,
    },
  });
  map.addLayer({
    id: 'atc-symbols', type: 'symbol', source: 'units',
    filter: ['==', ['get', 'scheme'], 'ATC'],
    layout: {
      'text-field': ['get', 'posChar'],
      'text-font': ['Roboto Mono Medium', 'Noto Sans Regular'],
      'text-size': TEXT_SIZE_PX, 'text-anchor': 'center',
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': ['get', 'posColor'], 'text-opacity': ['get', 'posOpacity'] },
  });

  // ── Labels ───────────────────────────────────────────────────────────
  // text-offset is data-driven: default labels use TEXT_OFFSET_EM (em-based,
  // pixel-stable); dragged labels are placed at their geographic position
  // with offset [0,0] so they stay in the same map location across zoom levels.
  map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Single label layer — no emergency text halo; emergency is shown via the
  // blinking square icon layer above.
  map.addLayer({
    id: 'unit-labels', type: 'symbol', source: 'labels',
    filter: ['!=', ['get', 'scheme'], 'ATC'],
    layout: {
      'text-field': ['format',
        // docs/adr/0058: a conflict or conformance tag leads, in its own colour.
        ['get', 'alertTag'], {'text-color': ['get', 'alertColor']},
        ['case', ['!=', ['get', 'alertTag'], ''], ' ', ''], {},
        ['get', 'callsign'], {},
        // Add '\n' after callsign only when there's something on subsequent lines
        ['case', ['any', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
        ['get', 'infoLine'], {},
        // Add '\n' between info and sqTag only when both are present
        ['case', ['all', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
        ['get', 'sqTag'], {'text-color': ['get', 'sqColor']},
        // The assigned values, on their own line: "A180 H050".
        ['case', ['!=', ['get', 'asgnLine'], ''], '\n', ''], {},
        ['get', 'asgnLine'], {},
      ],
      'text-font': ['Roboto Regular', 'Noto Sans Regular'],
      'text-size': TEXT_SIZE_PX, 'text-anchor': 'center', 'text-justify': 'left',
      'text-offset': ['get', 'textOffset'],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: {
      'text-color':   ['get', 'color'],
      'text-opacity': ['get', 'opacity'],
    },
  });

  // ── ATC data blocks (crc-sync's docs/adr/0088) ───────────────────────
  // Monospace, because a STARS block is read in fixed columns. Its text
  // arrives as up to ATC_MAX_SEGMENTS coloured pieces (geojson.js
  // _atcSegmentProps), which lets one line carry `EM` in red beside a
  // conformance tag in amber, and a blinking piece go transparent.
  const atcFormat = ['format'];
  for (let i = 0; i < ATC_MAX_SEGMENTS; i++) {
    atcFormat.push(['get', `s${i}`], { 'text-color': ['get', `c${i}`] });
  }
  map.addLayer({
    id: 'atc-labels', type: 'symbol', source: 'labels',
    filter: ['==', ['get', 'scheme'], 'ATC'],
    layout: {
      'text-field': atcFormat,
      'text-font': ['Roboto Mono Regular', 'Noto Sans Regular'],
      'text-size': TEXT_SIZE_PX, 'text-anchor': 'center', 'text-justify': 'left',
      'text-offset': ['get', 'textOffset'],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: {
      'text-opacity': ['get', 'opacity'],
      'text-halo-color': '#000000',
      'text-halo-width': ['get', 'halo'],
    },
  });
}
