'use strict';

// ── Map initialisation ────────────────────────────────────────────────────
// Sets up all MapLibre sources, layers, and event handlers.

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: '/crc-desktop-scope-style.json',
    center: [35.4258, 37.0021],
    zoom: 7,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  map.on('load', () => {
    initIcons();

    // ── Elevation contour overlay (computed from terrain-RGB DEM) ───────────
    // Toggleable via Settings → General → Map Overlays. Lines-only overlay —
    // no colored terrain fill — so it reads as reference hachures under the
    // tracks rather than a full topo basemap. MapTiler's ready-made contour
    // vector tileset only has data at zoom 9+ (its tile server 400s below
    // that), so contours are instead traced ourselves from MapTiler's
    // terrain-RGB elevation tiles (available at every zoom) — see
    // elevation.js. These two sources start empty; elevation.js populates
    // them on demand, so visibility is entirely data-driven (no
    // layout.visibility toggling needed here).
    map.addSource('elevation-contours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('elevation-contour-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'elevation-contours-lines',
      type: 'line',
      source: 'elevation-contours',
      paint: {
        'line-color': '#8a6a3a',
        'line-width':   ['case', ['get', 'isIndex'], 1.4, 0.6],
        'line-opacity': ['case', ['get', 'isIndex'], 0.75, 0.4],
      },
    });
    map.addLayer({
      id: 'elevation-contours-labels',
      type: 'symbol',
      source: 'elevation-contour-labels',
      layout: {
        'text-field': ['get', 'text'],
        'text-font': ['Roboto Medium', 'Noto Sans Regular'],
        'text-size': 10,
      },
      paint: {
        'text-color': '#8a6a3a',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });

    // ── Radar debug overlay ──────────────────────────────────────────────
    // Sweep lines / cone edges for active radars (debug mode only).
    map.addSource('radar-debug', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'radar-debug-lines', type: 'line', source: 'radar-debug',
      paint: {
        'line-color':   ['get', 'color'],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.7],
        'line-width':   1,
        'line-dasharray': [4, 3],
      },
    });

    // ── Range rings ──────────────────────────────────────────────────────
    map.addSource('range-ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'range-ring-line', type: 'line', source: 'range-ring',
      filter: ['==', ['get', 'ring'], 'range'],
      paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.4, 'line-width': 1, 'line-dasharray': [8, 6] },
    });
    map.addLayer({
      id: 'ground-ring-line', type: 'line', source: 'range-ring',
      filter: ['==', ['get', 'ring'], 'ground'],
      paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.22, 'line-width': 1, 'line-dasharray': [3, 4] },
    });

    // ── Mission drawings ─────────────────────────────────────────────────
    // Rendered below all track data so they serve as background reference.
    map.addSource('drawings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Polygon fills (closed shapes: rects, circles, etc.)
    map.addLayer({
      id: 'drawing-fills', type: 'fill', source: 'drawings',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color':   ['get', 'fillColor'],
        'fill-opacity': 1,
      },
    });
    // Outlines for all drawing features
    map.addLayer({
      id: 'drawing-lines', type: 'line', source: 'drawings',
      paint: {
        'line-color':   ['get', 'color'],
        'line-width':   1.2,
        'line-opacity': 0.85,
      },
    });

    // ── DCS mission-editor text marks (TextBox drawings) ───────────────────
    map.addSource('text-marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'text-marks-labels', type: 'symbol', source: 'text-marks',
      layout: {
        'text-field':            ['get', 'text'],
        'text-font':             ['Roboto Regular', 'Noto Sans Regular'],
        'text-size':             10,
        'text-anchor':           'left',
        'text-offset':           [0.4, 0],
        'text-allow-overlap':    false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color':      ['get', 'color'],
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });

    // ── Filed route overlay (from the track panel's FPL section) ───────────
    map.addSource('filed-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'filed-route-line', type: 'line', source: 'filed-route',
      paint: {
        'line-color':     '#cc66cc',
        'line-width':     1.5,
        'line-opacity':   0.85,
      },
    });

    // ── Nav/waypoints ─────────────────────────────────────────────────────
    map.addSource('navpoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'navpt-icons', type: 'symbol', source: 'navpoints',
      layout: {
        'icon-image':            'navpt',
        'icon-allow-overlap':    true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.85 },
    });
    map.addLayer({
      id: 'navpt-labels', type: 'symbol', source: 'navpoints',
      layout: {
        'text-field':            ['get', 'name'],
        'text-font':             ['Roboto Regular', 'Noto Sans Regular'],
        'text-size':             9,
        'text-anchor':           'top',
        'text-offset':           [0, 0.7],
        'text-allow-overlap':    false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color':   '#3a5a3a',
        'text-opacity': 0.9,
      },
    });

    // ── Selection ring around reference track ────────────────────────────
    map.addSource('ref-dot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ref-dot-ring', type: 'circle', source: 'ref-dot',
      paint: {
        'circle-radius': 10, 'circle-color': 'transparent',
        'circle-stroke-color': '#8aaa6a', 'circle-stroke-width': 1.5,
        'circle-opacity': 0, 'circle-stroke-opacity': 0.85,
      },
    });

    // ── Airport labels ───────────────────────────────────────────────────
    map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'airport-labels', type: 'symbol', source: 'airports',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': 9, 'text-anchor': 'top', 'text-offset': [0, 0.4],
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#3a5a3a', 'text-halo-color': '#000', 'text-halo-width': 1 },
    });

    // ── Bullseye symbols ─────────────────────────────────────────────────
    map.addSource('bullseye', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'bullseye-icons', type: 'symbol', source: 'bullseye',
      layout: {
        'icon-image': ['match', ['get', 'coalition'], 'blue', 'be-blue', 'red', 'be-red', 'be-blue'],
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1,
      },
      paint: { 'icon-opacity': 0.8 },
    });

    // ── Trail dots ───────────────────────────────────────────────────────
    map.addSource('trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'trail-dots', type: 'circle', source: 'trails',
      paint: { 'circle-radius': 1.5, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-stroke-width': 0 },
    });

    // ── PPL (projected position line) ─────────────────────────────────────
    map.addSource('ppl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ppl-lines', type: 'line', source: 'ppl',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.45, 'line-width': 1 },
    });

    // ── Datalink radar lock lines ────────────────────────────────────────────
    // Dashed line from each friendly player unit to its active radar lock target.
    map.addSource('datalink-locks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'datalink-lock-lines', type: 'line', source: 'datalink-locks',
      paint: {
        'line-color':     ['get', 'color'],
        'line-opacity':   0.8,
        'line-width':     1.5,
        'line-dasharray': [4, 3],
      },
    });

    // ── Approach vector ───────────────────────────────────────────────────
    map.addSource('approach-vec', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'approach-vec-line', type: 'line', source: 'approach-vec',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
    });

    // ── Extended centerline (APP-radar control, APRT-panel-driven) ────────
    map.addSource('ext-centerline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ext-centerline-line', type: 'line', source: 'ext-centerline',
      filter: ['==', ['get', 'kind'], 'centerline'],
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
    });
    // Distance ticks — solid (not dashed) so they read as clear crossbars
    // rather than blending into the dashed centerline's own dash pattern.
    map.addLayer({
      id: 'ext-centerline-ticks', type: 'line', source: 'ext-centerline',
      filter: ['==', ['get', 'kind'], 'tick'],
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5 },
    });

    // ── Measure line ─────────────────────────────────────────────────────
    map.addSource('measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'measure-line', type: 'line', source: 'measure',
      filter: ['==', ['get', 'kind'], 'line'],
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': 1, 'line-dasharray': [6, 4] },
    });
    map.addLayer({
      id: 'measure-label', type: 'symbol', source: 'measure',
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': 11, 'text-anchor': 'center',
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5, 'text-opacity': 0.9 },
    });

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
      layout: {
        'icon-image': [
          'case',
          // BANDIT / HOSTILE → filled triangle regardless of category
          ['==', ['get', 'iff'], 'bandit'],  'tri-iff-bandit',
          ['==', ['get', 'iff'], 'hostile'], 'tri-iff-hostile',
          // Ground vehicles
          ['==', ['get', 'category'], 3],
          ['match', ['get', 'iff'], 'friendly','gnd-iff-friendly', 'bogey','gnd-iff-bogey', 'gnd-iff-neutral'],
          // Ships
          ['==', ['get', 'category'], 4],
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
      filter: ['!=', ['get', 'emergency'], ''],
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

    // ── Labels ───────────────────────────────────────────────────────────
    // text-offset is data-driven: default labels use TEXT_OFFSET_EM (em-based,
    // pixel-stable); dragged labels are placed at their geographic position
    // with offset [0,0] so they stay in the same map location across zoom levels.
    map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Single label layer — no emergency text halo; emergency is shown via the
    // blinking square icon layer above.
    map.addLayer({
      id: 'unit-labels', type: 'symbol', source: 'labels',
      layout: {
        'text-field': ['format',
          ['get', 'callsign'], {},
          // Add '\n' after callsign only when there's something on subsequent lines
          ['case', ['any', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
          ['get', 'infoLine'], {},
          // Add '\n' between info and sqTag only when both are present
          ['case', ['all', ['!=', ['get', 'infoLine'], ''], ['!=', ['get', 'sqTag'], '']], '\n', ''], {},
          ['get', 'sqTag'], {'text-color': ['get', 'sqColor']},
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

    // ── Carrier Control Area (CCA) & Control Zone (CCZ) ─────────────────────
    map.addSource('carrier-zones', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Zone Boundary Lines
    map.addLayer({
      id: 'carrier-zones-lines',
      type: 'line',
      source: 'carrier-zones',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'zone'], 'CCZ'], '#ff4444', // Red for 5 NM CCZ
          '#ffaa00'                                  // Amber/Orange for 50 NM CCA
        ],
        'line-width': 1.5,
        'line-dasharray': [6, 4],
        'line-opacity': 0.8,
      },
    });

    // Zone Text Labels
    map.addLayer({
      id: 'carrier-zones-labels',
      type: 'symbol',
      source: 'carrier-zones',
      filter: ['==', ['get', 'type'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Roboto Regular', 'Noto Sans Regular'],
        'text-size': 10,
        'symbol-placement': 'point',
        'text-anchor': 'bottom', // Anchors text right above the edge of the circle line
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['case', ['==', ['get', 'zone'], 'CCZ'], '#ff4444', '#ffaa00'],
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });

    // ── Cursor ───────────────────────────────────────────────────────────
    map.getCanvas().style.cursor = 'crosshair';

    // ── Label drag / click ────────────────────────────────────────────────
    // Labels are dragged to reposition them; a click (no real movement) opens
    // the track panel.  We do NOT preventDefault on mousedown so that the
    // browser still fires the click event — the click handler uses a flag to
    // distinguish a real click from a drag.
    let _labelDragged = false;

    map.on('mousedown', 'unit-labels', (e) => {
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
      _drag = {
        id, startX: e.point.x, startY: e.point.y,
        startMouseLat: startMouse.lat, startMouseLon: startMouse.lng,
        startRelLat, startRelLon, moved: false,
      };
      map.dragPan.disable();
    });

    // Click on a label — open track panel unless the mouse was dragged.
    // e.preventDefault() stops the map-level click from closing the panel.
    map.on('click', 'unit-labels', (e) => {
      if (bullseyePickTarget) return;
      e.preventDefault();
      if (_labelDragged) { _labelDragged = false; return; }
      const id = String(e.features[0].properties.id);
      showTrackPanel(id);
    });

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

    // ── Left-click on track icon ─────────────────────────────────────────
    // Aircraft (cat 1/2) + ships (cat 4) → track info panel
    // Ground vehicles (cat 3) → ground label popup
    map.on('click', 'unit-squares', (e) => {
      if (bullseyePickTarget) return;
      const feat = e.features && e.features[0];
      if (!feat) return;
      e.preventDefault();
      const id  = String(feat.properties.id);
      const cat = feat.properties.category;
      if (cat === 3) {
        showGroundLabelPopup(id, e.originalEvent.clientX, e.originalEvent.clientY);
      } else {
        showTrackPanel(id);
      }
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

    map.getCanvas().addEventListener('mouseup', () => {
      if (!_drag) return;
      _drag = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = 'crosshair';
    });

    // ── Right-click measure line ─────────────────────────────────────────
    map.getCanvas().addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const rect   = map.getCanvas().getBoundingClientRect();
      const point  = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      _measure = { startLng: point.lng, startLat: point.lat };
      map.dragPan.disable();
    });

    map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());

    map.getCanvas().addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !_measure) return;
      _measure = null;
      map.dragPan.enable();
      map.getSource('measure').setData({ type: 'FeatureCollection', features: [] });
    });

    mapReady = true;
    applyScale();
    applyMapTheme();
    initElevationContours();
    if (missionData) {
      map.getSource('airports').setData(buildAirports());
      map.getSource('bullseye').setData(buildBullseye());
      map.getSource('navpoints').setData(buildNavpoints());
      map.getSource('drawings').setData(buildDrawings());
      map.getSource('text-marks').setData(buildTextMarks());
    }
  });
}

// ── Colour application ────────────────────────────────────────────────────
// Called whenever colour settings change (colour-picker input events).
// Re-registers all colour-sensitive icon images and updates layer paint props.

function applyColors() {
  if (!mapReady) return;
  const ring = settings.colRangeRing || '#8aaa6a';
  const nav  = settings.colNavpoint  || '#3a5a3a';

  // Range rings and selection ring
  map.setPaintProperty('range-ring-line',  'line-color',          ring);
  map.setPaintProperty('ground-ring-line', 'line-color',          ring);
  map.setPaintProperty('ref-dot-ring',     'circle-stroke-color', ring);

  // Navpoints
  map.updateImage('navpt', createNavpointIcon(nav));
  map.setPaintProperty('navpt-labels',   'text-color', nav);
  map.setPaintProperty('airport-labels', 'text-color', nav);

  // IFF + emergency icon images
  updateIffIcons();

  // Rebuild GeoJSON so label colours and trail colours update immediately
  updateMap();
}

// ── Map theme ─────────────────────────────────────────────────────────────
// Switches base-layer colors between dark (radar scope) and light without
// reloading the style (which would destroy all custom GeoJSON layers).

function applyMapTheme() {
  if (!mapReady) return;
  const light = settings.lightMode;

  // Background (land)
  map.setPaintProperty('Background', 'background-color', light ? '#f4f3f0' : '#141414');

  // Water — in dark mode use a distinct dark blue-grey so land/water are easy to tell apart
  map.setPaintProperty('Water', 'fill-color', light ? '#c0d8e8' : '#07111a');

  // Rivers
  map.setPaintProperty('River', 'line-color', light ? '#a0c0d8' : '#0f0f0f');

  // Country borders
  map.setPaintProperty('Country border', 'line-color', light ? '#9a9690' : '#2a2a2a');

  // Airport zone fill
  map.setPaintProperty('Airport zone', 'fill-color', light ? '#e8e6e2' : '#111111');

  // Aeroway lines (runway / taxiway)
  map.setPaintProperty('Aeroway', 'line-color', light
    ? ['match', ['get', 'class'], 'runway', '#8a9a8a', 'taxiway', '#aabaa8', '#9aaa98']
    : ['match', ['get', 'class'], 'runway', '#4a5a4a', 'taxiway', '#2a3a2a', '#1a2a1a']);

  // Elevation contour lines + height labels
  const contourColor = light ? '#8a6a3a' : '#a08050';
  map.setPaintProperty('elevation-contours-lines',  'line-color', contourColor);
  map.setPaintProperty('elevation-contours-labels', 'text-color', contourColor);
  map.setPaintProperty('elevation-contours-labels', 'text-halo-color', light ? '#ffffff' : '#000000');

  // Text labels — halo flips so text stays readable
  const labelPaint = light
    ? { color: '#3a3a3a', halo: '#ffffff' }
    : { color: '#5a6a5a', halo: '#000000' };

  map.setPaintProperty('Taxiway labels', 'text-color',      labelPaint.color);
  map.setPaintProperty('Taxiway labels', 'text-halo-color', labelPaint.halo);
  map.setPaintProperty('Airport gate',  'text-color',      labelPaint.color);
  map.setPaintProperty('Airport gate',  'text-halo-color', labelPaint.halo);

  const placePaint = light
    ? { color: '#2a2a2a', halo: '#ffffff' }
    : { color: '#404040', halo: '#000000' };

  map.setPaintProperty('Country labels',  'text-color',      placePaint.color);
  map.setPaintProperty('Country labels',  'text-halo-color', placePaint.halo);

  // Airport labels — halo only needed in dark mode for contrast
  map.setPaintProperty('airport-labels', 'text-halo-width', light ? 0 : 1);
  map.setPaintProperty('airport-labels', 'text-halo-color', light ? '#ffffff' : '#000000');

  // Measure line + label
  const measureColor = light ? '#333333' : '#ffffff';
  map.setPaintProperty('measure-line',  'line-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-halo-color', light ? '#ffffff' : '#000000');
  map.setPaintProperty('measure-label', 'text-halo-width', light ? 0 : 1.5);
  // Rebuild drawings so line color (white vs dark) updates
  if (missionData) map.getSource('drawings').setData(buildDrawings());
  map.setPaintProperty('text-marks-labels', 'text-halo-color', light ? '#ffffff' : '#000000');
  if (missionData) map.getSource('text-marks').setData(buildTextMarks());
  // Re-register coalition icons with theme-correct colors
  updateIcons(light);
}

// Helper to generate circle polygon points in GeoJSON format
function createCirclePolygon(centerLng, centerLat, radiusNM, points = 64) {
  const km = radiusNM * 1.852;
  const coordinates = [];
  const distanceX = km / (111.320 * Math.cos((centerLat * Math.PI) / 180));
  const distanceY = km / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coordinates.push([centerLng + x, centerLat + y]);
  }
  coordinates.push(coordinates[0]);

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

// Scans active tracks for carriers (ship category = 4) and draws CCZ/CCA rings
function updateCarrierZones() {
  if (!mapReady) return;

  if (settings.ccacczEnabled === false) {
      map.getSource('carrier-zones').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

  const features = [];

  for (const [id, track] of tracks.entries()) {
    const isCarrier = track.category === 4 &&
      (track.type?.includes('CVN') || track.typeName?.includes('CVN') || track.isCarrier);

    if (isCarrier) {
      // ── Define callsign from track object ──────────────────────────
      const callsign = track.callsign || track.name || 'CVN';

      // 1. Polygon geometries (Lines)
      features.push({
        ...createCirclePolygon(track.lon, track.lat, 5),
        properties: { type: 'geometry', zone: 'CCZ' }
      });
      features.push({
        ...createCirclePolygon(track.lon, track.lat, 50),
        properties: { type: 'geometry', zone: 'CCA' }
      });

      // 2. Point geometries (Labels)
      const latOffset5NM = 5 / 60;
      const latOffset50NM = 50 / 60;

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [track.lon, track.lat + latOffset5NM] },
        properties: { type: 'label', zone: 'CCZ', label: `CCZ 5NM (${callsign})` }
      });

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [track.lon, track.lat + latOffset50NM] },
        properties: { type: 'label', zone: 'CCA', label: `CCA 50NM (${callsign})` }
      });
    }
  }

  map.getSource('carrier-zones').setData({
    type: 'FeatureCollection',
    features: features
  });
}
