'use strict';
import { atcTargetClick } from './atc-scope.js';
import { updateMap } from './geojson.js';
import { hideBullseyeCursor, updateBullseyeCursor, updateMeasureLine } from './panels/topbar.js';
import { applyBullseyePick } from './panels/settings-panel.js';
import { closeAptWeatherPanel, showAptWeatherPanel } from './panels/airport-selector.js';
import { closeTrackPanel, showTrackPanel } from './panels/track-panel.js';
import { selectStripForTrack } from './panels/efsp/correlation-highlight.js';
import { openLabelMenu } from './panels/efsp/label-menu.js';
import { getTextSizePx, TEXT_OFFSET_EM } from './scope-constants.js';
import { _drag, _measure, _setDrag, _setMeasure, map } from './map-handle.js';
import { bullseyePickTarget } from './view-state.js';
import { labelOffsets, missionData, tracks } from './picture.js';

// The scope's pointer handling (DESK-SPLIT, split out of map-setup.js's initMap): label drag and click, ATC target clicks, airport
// and track clicks, the combined mouse-move (BRA, label drag, measure line) and the right-click measure line. Run once, from 'load'.
export function wireMapInteractions() {
  // ── Cursor ───────────────────────────────────────────────────────────
  map.getCanvas().style.cursor = 'crosshair';

  // ── Label drag / click ────────────────────────────────────────────────
  // Labels are dragged to reposition them; a click (no real movement) opens
  // the track panel.  We do NOT preventDefault on mousedown so that the
  // browser still fires the click event — the click handler uses a flag to
  // distinguish a real click from a drag.
  let _labelDragged = false;

  const _onLabelMouseDown = (e) => {
    if (e.originalEvent.button !== 0) return;
    // No e.preventDefault() here — we need the click event to fire later.

    const id    = String(e.features[0].properties.id);
    const track = tracks.get(id);
    if (!track) return;

    let startRelLat, startRelLon;
    const relOff = labelOffsets.get(id);
    if (relOff) {
      [startRelLat, startRelLon] = relOff;
    } else {
      const iconPx   = map.project([track.lon, track.lat]);
      const labelPx  = [
        iconPx.x + TEXT_OFFSET_EM[0] * getTextSizePx(),
        iconPx.y + TEXT_OFFSET_EM[1] * getTextSizePx(),
      ];
      const labelGeo = map.unproject(labelPx);
      startRelLat    = labelGeo.lat - track.lat;
      startRelLon    = labelGeo.lng - track.lon;
    }

    const startMouse = map.unproject([e.point.x, e.point.y]);
    _setDrag({
      id, startX: e.point.x, startY: e.point.y,
      startMouseLat: startMouse.lat, startMouseLon: startMouse.lng,
      startRelLat, startRelLon, moved: false,
    });
    map.dragPan.disable();
  };

  // Click on a label, unless the mouse was dragged. The controller who owns the
  // contact's correlated Strip gets the assignment menu (HDG / SPEED / ALT,
  // docs/adr/0140), and a contact in a conflict alert shown at one of the
  // controller's Positions offers SUPPRESS (crc-sync's docs/adr/0145); everyone
  // else, and a Shift+click, gets the track panel as before (H71 default 7),
  // which is also the menu's TRACK item.
  // e.preventDefault() stops the map-level click from closing the panel.
  const _onLabelClick = (e) => {
    if (bullseyePickTarget) return;
    e.preventDefault();
    if (_labelDragged) { _labelDragged = false; return; }
    const id = String(e.features[0].properties.id);
    _selectStripForTrackIfAny(id);
    const ev = e.originalEvent;
    if (ev && !ev.shiftKey && openLabelMenu(id, ev.clientX, ev.clientY, { onTrackInfo: () => showTrackPanel(id) })) return;
    showTrackPanel(id);
  };
  // An ATC block drags and opens the track panel exactly like a tactical one.
  for (const layer of ['unit-labels', 'atc-labels']) {
    map.on('mousedown', layer, _onLabelMouseDown);
    map.on('click', layer, _onLabelClick);
  }

  // A click on an ATC TARGET is STARS's own gesture (docs/adr/0088): accept
  // a handoff or point-out offered to me, acknowledge what blinks, step a
  // finished exchange down, else open a PDB into an FDB and back.
  // The disc and its character are two layers; one click is one gesture.
  let _atcLastClick = null;
  const _onAtcTargetClick = (e) => {
    if (bullseyePickTarget) return;
    const feat = e.features && e.features[0];
    if (!feat) return;
    e.preventDefault();
    if (_atcLastClick === e.originalEvent) return;
    _atcLastClick = e.originalEvent;
    atcTargetClick(String(feat.properties.id));
    updateMap();
  };
  map.on('click', 'atc-targets', _onAtcTargetClick);
  map.on('click', 'atc-symbols', _onAtcTargetClick);

  // ── Left-click on airport label → weather panel ──────────────────────
  map.on('click', 'airport-labels', (e) => {
    if (bullseyePickTarget) return;
    e.preventDefault();
    const feat = e.features && e.features[0];
    if (!feat) return;
    const coords = feat.geometry.coordinates;
    const label  = feat.properties.label;
    const apt    = missionData && missionData.airports &&
      missionData.airports.find(a => (a.icao || a.name) === label);
    showAptWeatherPanel(label, coords[1], coords[0], apt ? apt.elev : 0,
                        e.originalEvent.clientX, e.originalEvent.clientY);
  });

  // Contact -> Strip, the other half of guide §6.6 rule 4's coupled
  // selection. A contact with no Strip deliberately leaves the current Strip
  // selection alone rather than clearing it — see
  // correlation-highlight.js's selectStripForTrack.
  // eslint-disable-next-line no-inner-declarations
  function _selectStripForTrackIfAny(id) {
    selectStripForTrack(id);
  }

  // ── Left-click on track icon ─────────────────────────────────────────
  // Aircraft and ships → track info panel
  map.on('click', 'unit-squares', (e) => {
    if (bullseyePickTarget) return;
    const feat = e.features && e.features[0];
    if (!feat) return;
    e.preventDefault();
    const id  = String(feat.properties.id);
    showTrackPanel(id);
    _selectStripForTrackIfAny(id);
  });

  // Refreshes the extended centerline's zoom-dependent tick spacing as soon
  // as a zoom gesture settles, rather than waiting for the next track tick.
  map.on('zoomend', () => updateMap());

  // Click on empty map → close track panel + weather panel
  // (or, in bullseye pick mode, set the target coalition's override position)
  map.on('click', (e) => {
    if (bullseyePickTarget) {
      applyBullseyePick(bullseyePickTarget, e.lngLat.lat, e.lngLat.lng);
      return;
    }
    if (!e.defaultPrevented) {
      closeTrackPanel();
      closeAptWeatherPanel();
    }
  });

  // ── Combined mousemove: BRA + label drag + measure line ───────────────
  map.getCanvas().addEventListener('mousemove', (e) => {
    updateBullseyeCursor(e);

    if (_drag) {
      const rect  = map.getCanvas().getBoundingClientRect();
      const px    = e.clientX - rect.left;
      const py    = e.clientY - rect.top;
      // Only move the label once the mouse has travelled more than 5 px
      const dist  = Math.hypot(px - _drag.startX, py - _drag.startY);
      if (dist < 5) return;
      _drag.moved    = true;
      _labelDragged  = true;
      const mouse = map.unproject([px, py]);
      const dLat  = mouse.lat - _drag.startMouseLat;
      const dLon  = mouse.lng - _drag.startMouseLon;
      labelOffsets.set(_drag.id, [_drag.startRelLat + dLat, _drag.startRelLon + dLon]);
      updateMap();
    }

    if (_measure) {
      const rect  = map.getCanvas().getBoundingClientRect();
      const point = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      updateMeasureLine(_measure.startLng, _measure.startLat, point.lng, point.lat);
    }
  });

  // Off the map, the readout is blank: leaving the canvas, including onto a panel over it (H163).
  map.getCanvas().addEventListener('mouseleave', () => hideBullseyeCursor());

  map.getCanvas().addEventListener('mouseup', () => {
    if (!_drag) return;
    _setDrag(null);
    map.dragPan.enable();
    map.getCanvas().style.cursor = 'crosshair';
  });

  // ── Right-click measure line ─────────────────────────────────────────
  map.getCanvas().addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    const rect   = map.getCanvas().getBoundingClientRect();
    const point  = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    _setMeasure({ startLng: point.lng, startLat: point.lat });
    map.dragPan.disable();
  });

  map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());

  map.getCanvas().addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !_measure) return;
    _setMeasure(null);
    map.dragPan.enable();
    map.getSource('measure').setData({ type: 'FeatureCollection', features: [] });
  });
}
