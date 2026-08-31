'use strict';

// ── GeoJSON builders ───────────────────────────────────────────────────────
// All functions return FeatureCollections ready for MapLibre setData().

function trackOpacity() {
  if (grpcStatus === 'disconnected') return 0.25;
  if (grpcStatus === 'reconnecting' && lastUpdateMs != null && Date.now() - lastUpdateMs > STALE_MS) return 0.5;
  return 1.0;
}

function trackColor(track) {
  return iffColor(getIff(track));
}

function buildInfo(track, hist) {
  const { speedKt } = kinematics(hist);
  const fpm         = verticalFpm(hist);
  const fl          = Math.round(indicatedAltFt(track.alt) / 100).toString().padStart(3, '0');
  const gs          = Math.round(speedKt).toString().padStart(3, '0');
  let line;
  if (Math.abs(fpm) > 100) {
    const arrow = fpm > 0 ? '↑' : '↓';
    const vv    = Math.min(99, Math.round(Math.abs(fpm) / 100)).toString().padStart(2, '0');
    line = `${fl}${arrow}${vv} G${gs}`;
  } else {
    line = `${fl} G${gs}`;
  }
  return line;
}

// Fade opacity for a track based on time since last radar sweep hit,
// or since the track first registered 0 kt airborne (stale DCS ghost tracks).
function sweepOpacity(id, baseOp) {
  const now     = Date.now();
  const grace   = settings.fadeGraceMs ?? 10000;
  const elapsed = Math.max(0, now - (lastSweepMs.get(id) || 0));

  const zeroSince   = zeroSpeedSinceMs.get(id);
  const zeroElapsed = zeroSince ? Math.max(0, now - zeroSince) : 0;

  const effective = Math.max(elapsed, zeroElapsed);
  if (effective <= grace) return baseOp;
  return baseOp * Math.max(0, 1 - (effective - grace) / FADE_DURATION_MS);
}

// Track dots
function buildDots() {
  const features = [];
  const baseOp   = trackOpacity();

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (settings.hideGroundUnits && t.category === 3) continue;
    const iffState = getIff(t);
    if (iffState === 'invisible') continue;
    const hist       = history.get(id) || [];
    const { heading } = kinematics(hist);
    const onGround   = checkOnGround(t);
    const emType     = squawkEmergency(t.squawk);
    const isIdent    = t.squawkStatus === 2;
    let   opacity    = sweepOpacity(id, baseOp);
    if (isIdent) opacity = sweepOpacity(id, baseOp) * (_pulseBright ? 1.0 : 0.3);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      properties: {
        id,
        callsign:       resolveCallsign(t),
        color:          trackColor(t),
        coalition:      t.coalition,
        category:       t.category,
        iff:            iffState,
        opacity,
        onGround,
        heading:        Math.round(heading),
        emergency:      emType || '',
        emergencyColor: emType ? EMERGENCY_COLOR[emType] : '',
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Trail dots
function buildTrails() {
  if (!settings.trailEnabled) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const baseOp   = trackOpacity();

  const addDots = (hist, t, extraScale) => {
    const color = trackColor(t);
    for (let i = 0; i < hist.length - 1; i++) {
      const age     = hist.length - 1 - i;
      const trailMax = (settings.trailLength ?? HISTORY_MAX) || 1;
      const opacity = (1 - age / trailMax) * 0.55 * baseOp * extraScale;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [hist[i].lon, hist[i].lat] },
        properties: { color, opacity: Math.max(0, opacity) },
      });
    }
  };

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (getIff(t) === 'invisible') continue;
    if (t.category === 3) continue; // ground units have no trail
    if (checkOnGround(t)) continue; // aircraft on ground have no trail
    const hist = history.get(id);
    if (hist && hist.length > 1) addDots(hist, t, sweepOpacity(id, 1));
  }

  return { type: 'FeatureCollection', features };
}

// PPL: projected position lines
function buildPPL() {
  if (!settings.pplEnabled) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const durS     = settings.pplDuration;

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (getIff(t) === 'invisible') continue;
    if (t.category === 3) continue; // ground units have no PPL
    if (checkOnGround(t)) continue; // aircraft on ground have no PPL
    const hist = history.get(id) || [];
    const { heading, speedMs, speedKt } = kinematics(hist);
    if (speedKt < MIN_SPD_KT_PPL) continue;
    const [lat2, lon2] = projectPos(t.lat, t.lon, heading, speedMs * durS);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[t.lon, t.lat], [lon2, lat2]] },
      properties: { color: trackColor(t) },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Leader lines — pixel-space clipping so gaps are screen-stable at any zoom.
// Start: LEADER_ICON_GAP px from the track icon.
// End:   LABEL_HALF_W px from the label anchor (clears the text).
function buildLeaders() {
  if (!mapReady) return { type: 'FeatureCollection', features: [] };
  const features  = [];
  const baseOp    = trackOpacity();
  const iconGapPx = getLeaderIconGap();
  const labelGapPx = getLabelHalfW() + LABEL_EDGE_MARGIN;

  const decluttered = getDeclutteredIds();

  for (const [id, t] of tracks) {
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (settings.hideGroundUnits && t.category === 3) continue;
    if (getIff(t) === 'invisible') continue;
    if (decluttered.has(id)) continue;
    if ((t.category === 3 || t.category === 4) && !groundLabels.has(id)) continue;

    const relOff = labelOffsets.get(id);
    if (!relOff) continue;

    const [dLat, dLon] = relOff;
    if (Math.abs(dLat) < 1e-7 && Math.abs(dLon) < 1e-7) continue;

    const iconPx  = map.project([t.lon, t.lat]);
    const labelPx = map.project([t.lon + dLon, t.lat + dLat]);
    const dx  = labelPx.x - iconPx.x;
    const dy  = labelPx.y - iconPx.y;
    const len = Math.hypot(dx, dy);
    if (len < iconGapPx + labelGapPx + 2) continue; // too close to draw

    const ux = dx / len, uy = dy / len;
    const startPx = [iconPx.x  + ux * iconGapPx,  iconPx.y  + uy * iconGapPx];
    const endPx   = [labelPx.x - ux * labelGapPx, labelPx.y - uy * labelGapPx];

    const start = map.unproject(startPx);
    const end   = map.unproject(endPx);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
      },
      properties: { color: trackColor(t), opacity: sweepOpacity(id, baseOp) },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Sequential squawk declutter ───────────────────────────────────────────
// Returns the Set of track IDs whose labels should be suppressed because they
// are part of a sequential-squawk formation (e.g. 1101→1102→1103) where each
// follower is within 0.5 nm horizontally and 1 000 ft vertically of the
// previous squawk in the sequence.  Only labels are hidden; icons still show.

function getDeclutteredIds() {
  if (!settings.declutter) return new Set();

  // Build a map of squawk → track for all currently visible tracks
  const bySquawk = new Map();
  for (const [, t] of tracks) {
    if (t.squawk == null) continue;
    const sq = Number(t.squawk);
    if (Number.isFinite(sq) && sq >= 0 && sq <= 7777) bySquawk.set(sq, t);
  }

  const hidden = new Set();
  const HORIZ_M = 0.5 * 1852;   // 0.5 nm in metres
  const VERT_M  = 304.8;        // 1 000 ft in metres

  for (const [sq, t] of bySquawk) {
    const prev = bySquawk.get(sq - 1);
    if (!prev) continue;
    if (haversineM(t.lat, t.lon, prev.lat, prev.lon) > HORIZ_M) continue;
    if (Math.abs((t.alt || 0) - (prev.alt || 0))    > VERT_M)  continue;
    hidden.add(String(t.id));
  }

  return hidden;
}

// Labels.
// All labels use geo-anchored positions so leader lines are zoom-stable.
// Non-dragged tracks: geo offset computed from em-offset at first render, stored in labelOffsets.
// Dragged tracks: labelOffsets already holds the geo offset set by the drag interaction.
// The rendered text uses textOffset [0,0] so MapLibre places it at the geo coordinate directly.
function buildLabels() {
  if (!mapReady) return { type: 'FeatureCollection', features: [] };
  const features    = [];
  const baseOp      = trackOpacity();
  const textSizePx  = getTextSizePx();
  const decluttered = getDeclutteredIds();

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (settings.hideGroundUnits && t.category === 3) continue;
    if (getIff(t) === 'invisible') continue;
    if (decluttered.has(id)) continue; // formation follower — suppress label

    // Ensure every track has a stored geo offset (compute from em-offset if not yet set)
    if (!labelOffsets.has(id)) {
      const iconPx  = map.project([t.lon, t.lat]);
      const labelPx = [
        iconPx.x + TEXT_OFFSET_EM[0] * textSizePx,
        iconPx.y + TEXT_OFFSET_EM[1] * textSizePx,
      ];
      const labelGeo = map.unproject(labelPx);
      labelOffsets.set(id, [labelGeo.lat - t.lat, labelGeo.lng - t.lon]);
    }

    const relOff     = labelOffsets.get(id);
    const coords     = [t.lon + relOff[1], t.lat + relOff[0]];
    const textOffset = [0, 0]; // label is placed at its geo coordinate
    const color      = trackColor(t);
    const opacity    = sweepOpacity(id, baseOp);

    // Ground vehicles and ships: only render if the user has assigned a label
    if (t.category === 3 || t.category === 4) {
      const customLabel = groundLabels.get(id);
      if (!customLabel) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { id, callsign: customLabel, infoLine: '', sqTag: '', sqColor: color, color, opacity, textOffset },
      });
      continue;
    }

    const hist     = history.get(id) || [];
    const csOnly   = checkOnGround(t);
    const infoLine = csOnly ? '' : buildInfo(t, hist);

    // Squawk tag — shown on its own line below the info line.
    // Suppressed when the squawk already resolves to a known callsign via squawkMap/squawkSeq.
    const emType = squawkEmergency(t.squawk);
    let sqTag = '', sqColor = color;
    if (emType === 'hijack')     { sqTag = 'HIJ'; sqColor = settings.colEmergHijack || '#cc6600'; }
    else if (emType === 'radio') { sqTag = 'RDF'; sqColor = settings.colEmergRadio  || '#b8a000'; }
    else if (emType === 'gen')   { sqTag = 'EMR'; sqColor = settings.colEmergGen    || '#cc2222'; }
    else if (t.squawk != null && Number(t.squawk) !== 0) {
      // Only show raw squawk if it isn't already mapped to a callsign
      const sq = Number(t.squawk);
      const mappedByExact = settings.squawkMap && settings.squawkMap[String(sq)];
      const mappedBySeq   = !mappedByExact && settings.squawkSeq &&
        Object.entries(settings.squawkSeq).some(([base]) => {
          const off = sq - parseInt(base, 10);
          return off >= 0 && off <= 98;
        });
      if (!mappedByExact && !mappedBySeq) sqTag = String(t.squawk).padStart(4, '0');
    }

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { id, callsign: resolveCallsign(t), infoLine, sqTag, sqColor, color, opacity, textOffset },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Navpoints ─────────────────────────────────────────────────────────────

function buildNavpoints() {
  if (!missionData || !missionData.waypoints || !missionData.waypoints.length)
    return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: missionData.waypoints
      .filter(w => {
        if (!w.lat || !w.lon) return false;
        if (settings.navDeclutter  && /\d/.test(w.name || '')) return false;
        if (settings.navDeclutter5 && (w.name || '').length !== 5) return false;
        return true;
      })
      .map(w => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
        properties: { name: w.name || '' },
      })),
  };
}

// ── Drawings ──────────────────────────────────────────────────────────────

// DCS colorString is "0xAARRGGBB" (alpha first); returns CSS rgba() or null if transparent.
function dcsColorToCss(colorStr) {
  if (!colorStr) return null;
  const hex = colorStr.replace(/^0x/i, '').padStart(8, '0');
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  const r = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const b = parseInt(hex.slice(6, 8), 16);
  if (a < 0.01) return null;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function buildDrawings() {
  if (!missionData || !missionData.drawings || !missionData.drawings.length)
    return { type: 'FeatureCollection', features: [] };

  const features = [];

  for (const d of missionData.drawings) {
    if (d.primitiveType === 'TextBox') continue; // rendered by buildTextMarks() instead

    const color     = settings.lightMode ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.75)';
    const fillColor = 'rgba(0,0,0,0)';
    const props     = { color, fillColor };

    if (d.polygonMode === 'circle' && d.lat != null && d.radius) {
      // Approximate circle as closed polygon
      const coords = [];
      for (let i = 0; i <= 64; i++) {
        const [lat, lon] = projectPos(d.lat, d.lon, (i / 64) * 360, d.radius);
        coords.push([lon, lat]);
      }
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: props });

    } else if (d.points && d.points.length >= 2) {
      const coords = d.points.map(p => [p.lon, p.lat]);
      // Closed if explicitly flagged or it's a polygon primitive (not a plain line)
      const closed = d.closed || d.primitiveType === 'Polygon';

      if (closed && coords.length >= 3) {
        const ring = [...coords];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push(ring[0]);
        }
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props });
      } else {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

// Parses an ICAO-style FPL message built by sourcedcs-web's form1801.js:
//   line 2 (index 2): "-<DEP ICAO><HHMM>"                     e.g. "-UGKO1630"
//   line 3 (index 3): "-<speed><level> <ROUTE>"               e.g. "-N0450F350 DCT DEVOL UL9 KONAN DCT"
//   line 4 (index 4): "-<DEST ICAO><EET>[ <ALTN1>][ <ALTN2>]" e.g. "-UGTB0130"
// The full filed route is dep → route waypoints → dest, not just field 15's
// enroute string — a route of "DCT ERGEP DCT" is genuinely just one enroute
// fix, but the plotted line still needs to start/end at the filed airports.
// Each token is resolved against the mission's navpoints/airports by
// name/ICAO; airway identifiers (e.g. "UL9") simply won't match anything and
// are dropped — no special casing needed since there's no airway geometry to
// plot them against.
function parseFiledRouteWaypoints(fplMessage) {
  if (!fplMessage) return { points: [], matched: 0, total: 0 };
  const lines = fplMessage.split('\n');

  const byName = new Map();
  for (const w of (missionData && missionData.waypoints) || []) {
    if (w.name) byName.set(w.name.toUpperCase(), w);
  }
  for (const a of (missionData && missionData.airports) || []) {
    if (a.icao) byName.set(a.icao.toUpperCase(), a);
    if (a.name) byName.set(a.name.toUpperCase(), a);
  }

  const resolve = (tok) => {
    const hit = byName.get(tok.toUpperCase());
    return hit && hit.lat != null && hit.lon != null ? { lat: hit.lat, lon: hit.lon } : null;
  };

  const tokens = [];
  // Dep/dest lines are "-<ICAO letters><digits...>" with no separator —
  // the ICAO is the leading run of letters.
  const depMatch  = (lines[2] || '').match(/^-([A-Za-z]+)/);
  const destMatch = (lines[4] || '').match(/^-([A-Za-z]+)/);
  if (depMatch) tokens.push(depMatch[1]);

  const routeMatch = (lines[3] || '').match(/^-\S+\s+(.*)$/);
  if (routeMatch) {
    for (const t of routeMatch[1].trim().split(/\s+/)) {
      if (t && t.toUpperCase() !== 'DCT') tokens.push(t);
    }
  }
  if (destMatch) tokens.push(destMatch[1]);

  const points = [];
  for (const tok of tokens) {
    const p = resolve(tok);
    if (p) points.push(p);
  }
  return { points, matched: points.length, total: tokens.length };
}

function buildFiledRoute(points) {
  if (!points || points.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) },
      properties: {},
    }],
  };
}

// DCS mission-editor "Text" objects (primitiveType TextBox). Kept as its own
// source/layer rather than folded into buildDrawings() so it can be toggled
// independently of shape drawings.
function buildTextMarks() {
  if (!settings.textMarksEnabled || !missionData || !missionData.drawings || !missionData.drawings.length)
    return { type: 'FeatureCollection', features: [] };

  const color = settings.lightMode ? 'rgba(40,40,40,0.9)' : 'rgba(255,255,255,0.85)';
  const features = [];

  for (const d of missionData.drawings) {
    if (d.primitiveType !== 'TextBox' || !d.text || d.lat == null || d.lon == null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: { text: d.text, color },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Approach vector: 15 nm extended centreline from FAF to threshold.
// Shown whenever an airport is selected and a runway course has been entered.
function buildApproachVector() {
  if (!selectedApt || approachRwyCourse == null)
    return { type: 'FeatureCollection', features: [] };

  const course     = approachRwyCourse;                    // aircraft heading TO runway
  const reciprocal = (course + 180) % 360;                 // outbound from threshold
  const FAF_M      = 15 * 1852;

  const [fafLat, fafLon] = projectPos(selectedApt.lat, selectedApt.lon, reciprocal, FAF_M);

  const color = settings.lightMode ? 'rgba(40,40,40,0.7)' : 'rgba(255,255,255,0.5)';

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[fafLon, fafLat], [selectedApt.lon, selectedApt.lat]] },
        properties: { color },
      },
    ],
  };
}

// Extended centerline for APP-control: independent of the topbar-driven
// buildApproachVector() above (different airport-selection state — the APRT
// panel's _aprtSelectedApt, not the topbar's selectedApt/approachRwyCourse —
// and no real runway geometry exists to unify them on). Only drawn when an
// APP radar for the APRT panel's airport is enabled and a runway heading has
// been entered there.
// Distance-tick spacing in nm, coarser at low zoom so ticks don't merge into
// noise once the centerline's whole length is only a few screen pixels long.
// majorNm is always a multiple of minorNm, marking the round-number distances
// (5, 10, ...) with a longer crossbar than the fine in-between ticks.
function _extCenterlineTickPlan(zoom) {
  if (zoom >= 11) return { minorNm: 1, majorNm: 5 };
  if (zoom >= 9)  return { minorNm: 2, majorNm: 10 };
  if (zoom >= 7)  return { minorNm: 5, majorNm: 10 };
  return { minorNm: 10, majorNm: 20 };
}

function buildExtendedCenterline() {
  if (!_aprtSelectedApt || _aprtRwyHeading == null) return { type: 'FeatureCollection', features: [] };
  if (!enabledRadarIds.has('app:' + _aprtSelectedApt.name)) return { type: 'FeatureCollection', features: [] };

  // The runway number is a magnetic heading (real-world convention) — the
  // map's geometry math (projectPos/bearingDeg) is all true-bearing, so it
  // needs the reverse of the chain the BRA readout uses (ui.js: displayed
  // = grid + hdgCorrection, where grid = true - gridConvergenceDeg):
  // magnetic -> grid (subtract hdgCorrection) -> true (add convergence back).
  const hdgCorrection = settings.hdgCorrection || 0;
  const gridHeading = ((_aprtRwyHeading - hdgCorrection) % 360 + 360) % 360;
  const conv        = gridConvergenceDeg(_aprtSelectedApt.lat, _aprtSelectedApt.lon);
  const trueHeading = ((gridHeading + conv) % 360 + 360) % 360;
  const reciprocal  = (trueHeading + 180) % 360;

  const lengthNm = settings.extCenterlineNm || 25;
  const lengthM  = lengthNm * 1852;
  const [startLat, startLon] = projectPos(_aprtSelectedApt.lat, _aprtSelectedApt.lon, reciprocal, lengthM);
  const color = settings.lightMode ? 'rgba(40,40,40,0.7)' : 'rgba(255,255,255,0.5)';

  const features = [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[startLon, startLat], [_aprtSelectedApt.lon, _aprtSelectedApt.lat]] },
    properties: { color, kind: 'centerline' },
  }];

  const zoom = (typeof map !== 'undefined' && map.getZoom) ? map.getZoom() : 8;
  const { minorNm, majorNm } = _extCenterlineTickPlan(zoom);
  const MINOR_HALF_WIDTH_M = 350; // ~0.19 nm each side — fine in-between ticks
  const MAJOR_HALF_WIDTH_M = 700; // ~0.38 nm each side — round-number ticks (5, 10, ...)

  for (let i = 1; i * minorNm < lengthNm; i++) {
    const d       = i * minorNm;
    const isMajor = (i * minorNm) % majorNm === 0; // majorNm is always a multiple of minorNm
    const halfWidthM = isMajor ? MAJOR_HALF_WIDTH_M : MINOR_HALF_WIDTH_M;
    const [tLat, tLon] = projectPos(_aprtSelectedApt.lat, _aprtSelectedApt.lon, reciprocal, d * 1852);
    const [aLat, aLon] = projectPos(tLat, tLon, (trueHeading + 90) % 360, halfWidthM);
    const [bLat, bLon] = projectPos(tLat, tLon, (trueHeading + 270) % 360, halfWidthM);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[aLon, aLat], [bLon, bLat]] },
      properties: { color, kind: 'tick' },
    });
  }

  return { type: 'FeatureCollection', features };
}

function _makeRing(lat, lon, radiusM, ringType) {
  const coords = [];
  for (let i = 0; i <= 72; i++) {
    const [rlat, rlon] = projectPos(lat, lon, (i / 72) * 360, radiusM);
    coords.push([rlon, rlat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { ring: ringType },
  };
}

// Range ring — shown for the selected reference track or airport.
// Ring size for an airport is determined by the largest active radar for that airport.
function buildRangeRing() {
  const features = [];

  // Reference range ring (CRC/AWACS style)
  if (selectedRef) {
    const ref = tracks.get(selectedRef) || latestFromServer.get(selectedRef);
    if (ref) features.push(_makeRing(ref.lat, ref.lon, CRC_RANGE_M, 'range'));
  }

  // Airport range ring — pick size from largest active radar for this airport
  if (selectedApt) {
    const active = getActiveRadars();
    const hasApp = active.some(r => r.id === `app:${selectedApt.name}`);
    const hasApt = active.some(r => r.id === `apt:${selectedApt.name}`);
    if (hasApp) {
      features.push(_makeRing(selectedApt.lat, selectedApt.lon, 80 * 1852, 'range'));
    } else if (hasApt) {
      features.push(_makeRing(selectedApt.lat, selectedApt.lon, 20 * 1852, 'range'));
      features.push(_makeRing(selectedApt.lat, selectedApt.lon,  2 * 1852, 'ground'));
    } else {
      // Airport selected but no radar active: show small reference ring
      features.push(_makeRing(selectedApt.lat, selectedApt.lon, 20 * 1852, 'range'));
    }
  }

  return { type: 'FeatureCollection', features };
}

// Small selection ring around the reference track icon
function buildRefDot() {
  if (!selectedRef) return { type: 'FeatureCollection', features: [] };
  const ref = tracks.get(selectedRef);
  if (!ref) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ref.lon, ref.lat] },
      properties: {},
    }],
  };
}

function buildAirports() {
  if (!missionData || !missionData.airports) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: missionData.airports
      .filter(a => a.lat && a.lon)
      .map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { label: a.icao || a.name },
      })),
  };
}

function buildBullseye() {
  const features = [];
  const be = getBullseye();
  if (!be.blue && !be.red) return { type: 'FeatureCollection', features };
  if (be.blue && be.blue.lat && be.blue.lon) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [be.blue.lon, be.blue.lat] }, properties: { coalition: 'blue' } });
  }
  if (be.red && be.red.lat && be.red.lon) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [be.red.lon, be.red.lat] }, properties: { coalition: 'red' } });
  }
  return { type: 'FeatureCollection', features };
}

// ── Radar debug overlay ────────────────────────────────────────────────────
// Draws a sweep beam for each active radar when debug mode is on.
// 360° radars: single rotating line.
// Nose radars: animated beam + faint cone edges as reference.
function buildRadarDebug(radars) {
  if (!settings.radarDebug || !radars) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const now = Date.now();

  for (const radar of radars) {
    const isApt = radar.id.startsWith('apt:');
    const isApp = radar.id.startsWith('app:');
    const color = isApt ? '#aa8833' : isApp ? '#3388aa' : '#33aa55';

    if (radar.angleFromNose === 360) {
      // Rotating beam: single line in current sweep direction
      if (!radarSweepStart.has(radar.id)) continue;
      const angle = ((now - radarSweepStart.get(radar.id)) % radar.sweepMs) / radar.sweepMs * 360;
      const visibleM = losVisibleRangeM(radar, angle, radar.rangeM);
      const [vLat, vLon] = projectPos(radar.lat, radar.lon, angle, visibleM);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[radar.lon, radar.lat], [vLon, vLat]] },
        properties: { color, opacity: 0.75 },
      });
      if (visibleM < radar.rangeM - 1) {
        // Faint continuation showing where the beam would nominally reach
        // if terrain weren't blocking it — makes the amount of masking legible.
        const [endLat, endLon] = projectPos(radar.lat, radar.lon, angle, radar.rangeM);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[vLon, vLat], [endLon, endLat]] },
          properties: { color, opacity: 0.15 },
        });
      }
    } else {
      // Nose radar: animated sweep beam + faint static cone edges
      if (!radarSweepStart.has(radar.id)) continue;
      const halfAngle = radar.angleFromNose / 2;
      const cycleMs   = radar.sweepMs * 2;
      const phase     = ((now - radarSweepStart.get(radar.id)) % cycleMs) / cycleMs;
      const tNorm     = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const beamAngle = (radar.heading - halfAngle + tNorm * radar.angleFromNose + 360) % 360;

      // Current beam line (bright)
      const beamVisibleM = losVisibleRangeM(radar, beamAngle, radar.rangeM);
      const [bLat, bLon] = projectPos(radar.lat, radar.lon, beamAngle, beamVisibleM);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[radar.lon, radar.lat], [bLon, bLat]] },
        properties: { color, opacity: 0.75 },
      });
      if (beamVisibleM < radar.rangeM - 1) {
        const [endLat, endLon] = projectPos(radar.lat, radar.lon, beamAngle, radar.rangeM);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[bLon, bLat], [endLon, endLat]] },
          properties: { color, opacity: 0.15 },
        });
      }

      // Left and right cone edge lines (faint reference)
      const [l1, o1] = projectPos(radar.lat, radar.lon, (radar.heading - halfAngle + 360) % 360, radar.rangeM);
      const [l2, o2] = projectPos(radar.lat, radar.lon, (radar.heading + halfAngle) % 360, radar.rangeM);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[radar.lon, radar.lat], [o1, l1]] },
        properties: { color, opacity: 0.25 },
      });
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[radar.lon, radar.lat], [o2, l2]] },
        properties: { color, opacity: 0.25 },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// Datalink lock lines: dashed line from each friendly player unit to its radar lock.
// Only drawn when settings.datalink is enabled.
function buildDatalinkLines() {
  const features = [];
  if (!settings.datalink || radarLocks.size === 0) return { type: 'FeatureCollection', features };

  const color = settings.colFriendly || '#4488cc';

  for (const [unitId, lock] of radarLocks) {
    const track = latestFromServer.get(unitId);
    if (!track || !track.player) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [track.lon, track.lat],
          [lock.targetLon, lock.targetLat],
        ],
      },
      properties: { color },
    });
  }

  return { type: 'FeatureCollection', features };
}

let _mapRafId = null;

function updateMap() {
  if (_mapRafId !== null) return;
  _mapRafId = requestAnimationFrame(() => {
    _mapRafId = null;
    _doUpdateMap();
  });
}

function _doUpdateMap() {
  if (!mapReady) return;
  map.getSource('range-ring').setData(buildRangeRing());
  map.getSource('ref-dot').setData(buildRefDot());
  map.getSource('trails').setData(buildTrails());
  map.getSource('ppl').setData(buildPPL());
  // buildLabels first — it populates labelOffsets which buildLeaders depends on
  map.getSource('labels').setData(buildLabels());
  map.getSource('leaders').setData(buildLeaders());
  map.getSource('units').setData(buildDots());
  map.getSource('bullseye').setData(buildBullseye());
  map.getSource('approach-vec').setData(buildApproachVector());
  map.getSource('ext-centerline').setData(buildExtendedCenterline());
  map.getSource('datalink-locks').setData(buildDatalinkLines());
  if (!settings.radarDebug) {
    map.getSource('radar-debug').setData({ type: 'FeatureCollection', features: [] });
  }
  updateZoomLimits();
  updateTopbarUI();
  updateRadarBadge();
  if (typeof updateTrackPanel === 'function') updateTrackPanel();
}
