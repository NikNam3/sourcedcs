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
import { createLabelDragGate } from './label-drag-gate.js';
import { _drag, _measure, _setDrag, _setMeasure, map } from './map-handle.js';
import { bullseyePickTarget } from './view-state.js';
import { coverageAtc, labelOffsets, missionData, tracks } from './picture.js';

// The scope's pointer handling (DESK-SPLIT, split out of map-setup.js's initMap): label drag and click, ATC target clicks, airport
// and track clicks, the combined mouse-move (BRA, label drag, measure line) and the right-click measure line. Run once, from 'load'.
export function wireMapInteractions() {
  // ── Cursor ───────────────────────────────────────────────────────────
  map.getCanvas().style.cursor = 'crosshair';

  // ── Label drag / click ────────────────────────────────────────────────
  // Labels are dragged to reposition them; a click (no real movement) opens
  // the track panel.  We do NOT preventDefault on mousedown so that the
  // browser still fires the click event — the click handler uses a flag to
  // distinguish a real click from a drag (label-drag-gate.js, which starts
  // every press clean so a drag released off the label eats no later click).
  const _labelGate = createLabelDragGate();

  const _onLabelMouseDown = (e) => {
    if (e.originalEvent.button !== 0) return;
    // No e.preventDefault() here — we need the click event to fire later.
    _labelGate.down();

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

  // A click on a contact (its label, its target or its tactical square). The controller who owns the contact's
  // correlated Strip gets the assignment menu (HDG / SPEED / ALT, docs/adr/0140), with SUPPRESS for its conflict alerts
  // (crc-sync's docs/adr/0145, 0147), the VFR actions and the tag (docs/adr/0146). The track info panel is the tactical
  // controller's (H71 default 7): an ATC controller (signed on to an ATC Position) never gets it, not as a fallback, not
  // on Shift+click, not as the menu's TRACK item; a tactical one gets it where there is no menu, on Shift+click, and as
  // TRACK.
  const _openContact = (id, ev) => {
    const trackPanel = !coverageAtc;
    if (ev && !(ev.shiftKey && trackPanel)
      && openLabelMenu(id, ev.clientX, ev.clientY, trackPanel ? { onTrackInfo: () => showTrackPanel(id) } : {})) return;
    if (trackPanel) showTrackPanel(id);
  };

  // Click on a label, unless the mouse was dragged.
  // e.preventDefault() stops the map-level click from closing the panel.
  const _onLabelClick = (e) => {
    if (bullseyePickTarget) return;
    e.preventDefault();
    if (!_labelGate.takeClick()) return;
    const id = String(e.features[0].properties.id);
    _selectStripForTrackIfAny(id);
    _openContact(id, e.originalEvent);
  };
  // An ATC block drags and clicks exactly like a tactical one.
  for (const layer of ['unit-labels', 'atc-labels']) {
    map.on('mousedown', layer, _onLabelMouseDown);
    map.on('click', layer, _onLabelClick);
  }

  // A click on an ATC TARGET is STARS's own gesture (docs/adr/0088): accept
  // a handoff or point-out offered to me, acknowledge what blinks, step a
  // finished exchange down, else open a PDB into an FDB and back. It then
  // does what a label click does (_openContact).
  // The disc and its character are two layers; one click is one gesture.
  let _atcLastClick = null;
  const _onAtcTargetClick = (e) => {
    if (bullseyePickTarget) return;
    const feat = e.features && e.features[0];
    if (!feat) return;
    e.preventDefault();
    if (_atcLastClick === e.originalEvent) return;
    _atcLastClick = e.originalEvent;
    const id = String(feat.properties.id);
    atcTargetClick(id);
    // The target (disc, or `+` for primary only) then jumps to the Strip and opens what a label click opens
    // (docs/wip/STRIP-JUMP.md). After the STARS gesture, so an accepted handoff lands on its Strip and its menu.
    _selectStripForTrackIfAny(id);
    _openContact(id, e.originalEvent);
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
  // Aircraft and ships: as a label click (_openContact)
  map.on('click', 'unit-squares', (e) => {
    if (bullseyePickTarget) return;
    const feat = e.features && e.features[0];
    if (!feat) return;
    e.preventDefault();
    const id  = String(feat.properties.id);
    _selectStripForTrackIfAny(id);
    _openContact(id, e.originalEvent);
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
      // Only move the label once the mouse has travelled LABEL_DRAG_THRESHOLD_PX
      const dist  = Math.hypot(px - _drag.startX, py - _drag.startY);
      if (!_labelGate.move(dist)) return;
      _drag.moved    = true;
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
