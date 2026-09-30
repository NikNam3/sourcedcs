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

/** The data block's second line, from the track history's speed and climb. */
function infoLine_(t, hist) {
  const { speedKt } = kinematics(hist);
  return infoLine(t, speedKt, verticalFpm(hist));
}

// ── Assigned values and alerts in the data block (docs/adr/0058) ───────────
const ALERT_COLOR_BAD = '#ff8a4c';
const ALERT_COLOR_ATTN = '#e0a83c';

/** The Strip-side flight record for a track, if it is correlated to one. */
function _fdrForTrack(trackId) {
  if (typeof stripIdsForTrackId !== 'function' || typeof getEfspStrip !== 'function') return null;
  for (const stripId of stripIdsForTrackId(trackId)) {
    const strip = getEfspStrip(stripId);
    const fdr = strip && getEfspFdr(strip.fdrId);
    if (fdr) return fdr;
  }
  return null;
}

/** "A180 H050": the flight's assigned altitude (hundreds of feet) and heading, when it has them. */
function buildAssignedLine(fdr) {
  if (!fdr || !fdr.clearance) return '';
  const active = (cell) => cell && cell.entries.find(e => e.status === 'ACTIVE');
  const alt = active(fdr.clearance.altitude);
  const hdg = active(fdr.clearance.heading);
  const parts = [];
  if (alt && Number.isFinite(alt.parsed)) parts.push('A' + String(Math.round(alt.parsed / 100)).padStart(3, '0'));
  if (hdg && Number.isFinite(hdg.parsed)) parts.push('H' + String(hdg.parsed).padStart(3, '0'));
  return parts.join(' ');
}

/** The one alert tag a data block leads with: a conflict first, then conformance. */
function buildAlertTag(trackId, fdr) {
  const conflicts = typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(trackId) : [];
  if (conflicts.length) return { tag: 'STCA', color: ALERT_COLOR_BAD };
  const alerts = fdr && typeof conformanceAlertsForFdr === 'function' ? conformanceAlertsForFdr(fdr.fdrId) : [];
  const bad = alerts.find(a => a.kind !== 'HEADING');
  if (bad && bad.kind === 'LEVEL_BUST') return { tag: `BUST${bad.deviationFt > 0 ? '+' : '−'}${Math.abs(bad.deviationFt)}`, color: ALERT_COLOR_BAD };
  if (bad && bad.kind === 'WRONG_WAY') return { tag: `ALT${bad.fpm < 0 ? '↓' : '↑'}`, color: ALERT_COLOR_BAD };
  const hdg = alerts.find(a => a.kind === 'HEADING');
  if (hdg) return { tag: `HDG${String(hdg.actual).padStart(3, '0')}`, color: ALERT_COLOR_ATTN };
  return { tag: '', color: ALERT_COLOR_ATTN };
}

/**
 * Each short-term conflict drawn on the scope: both predicted paths, the line
 * between their closest points, and a marker there with the countdown.
 */
function buildStcaOverlay() {
  const features = [];
  const conflicts = typeof getAllEfspConflicts === 'function' ? getAllEfspConflicts() : [];
  const now = (id) => tracks.get(String(id)) || latestFromServer.get(String(id));
  for (const c of conflicts) {
    const a = now(c.a);
    const b = now(c.b);
    if (a) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [c.aAt.lon, c.aAt.lat]] }, properties: { kind: 'path' } });
    if (b) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[b.lon, b.lat], [c.bAt.lon, c.bAt.lat]] }, properties: { kind: 'path' } });
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[c.aAt.lon, c.aAt.lat], [c.bAt.lon, c.bAt.lat]] }, properties: { kind: 'cpa-line' } });
    const clock = `${Math.floor(c.timeToCpaSec / 60)}:${String(c.timeToCpaSec % 60).padStart(2, '0')}`;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(c.aAt.lon + c.bAt.lon) / 2, (c.aAt.lat + c.bAt.lat) / 2] },
      properties: { kind: 'cpa', label: `${clock}  ${c.minNm} NM / ${c.vertFt} ft` },
    });
  }
  return { type: 'FeatureCollection', features };
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

// ── ATC scheme (crc-sync's docs/adr/0088) ────────────────────────────────
// A contact sent with `scheme: 'ATC'` is drawn in the STARS layout. What it
// shows is atc-scope.js's; this only turns it into features. One display per
// contact per frame, shared by the dots, the block and its leader.
const ATC_MAX_SEGMENTS = 16;
const ATC_TRANSPARENT = 'rgba(0,0,0,0)';
let _atcFrame = null;

function _isAtc(t) { return !!t && t.scheme === 'ATC' && typeof atcDisplay === 'function'; }

function _atcDisplayFor(id, t) {
  const now = Date.now();
  if (!_atcFrame || now - _atcFrame.at > 50) _atcFrame = { at: now, byId: new Map() };
  let d = _atcFrame.byId.get(id);
  if (!d) { d = atcDisplay(id, t, now); _atcFrame.byId.set(id, d); }
  return d;
}

/** The block's segments as flat properties s0..sN / c0..cN, blink applied: MapLibre's `format` needs a fixed shape. */
function _atcSegmentProps(d) {
  const props = {};
  const flat = [];
  d.lines.forEach((line, i) => {
    if (i > 0) flat.push({ text: '\n', color: null, blink: false });
    for (const seg of line) flat.push(seg);
  });
  for (let i = 0; i < ATC_MAX_SEGMENTS; i++) {
    const seg = flat[i];
    props[`s${i}`] = seg ? seg.text : '';
    const color = seg && seg.color ? seg.color : d.view.color;
    props[`c${i}`] = seg && seg.blink && !_pulseBright ? ATC_TRANSPARENT : color;
  }
  return props;
}

// Track dots
function buildDots() {
  const features = [];
  const baseOp   = trackOpacity();

  for (const [id, t] of tracks) {
    if (!settings.shipsEnabled && t.domain === 'SEA') continue;
    if (settings.hideGroundUnits && t.domain === 'GROUND') continue;
    const iffState = getIff(t);
    const hist       = history.get(id) || [];
    const { heading } = kinematics(hist);
    const emType     = trackEmergency(t);
    let   opacity    = sweepOpacity(id, baseOp);
    if (_isAtc(t)) {
      const d = _atcDisplayFor(id, t);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: {
          id, scheme: 'ATC', domain: t.domain, emergency: '',
          disc: d.view.disc, targetColor: d.palette.target, targetOpacity: d.palette.targetOpacity * opacity,
          posChar: d.view.posChar, posColor: d.view.posColor, posOpacity: d.view.opacity * opacity,
          opacity,
        },
      });
      continue;
    }
    if (trackIsIdent(t)) opacity = sweepOpacity(id, baseOp) * (_pulseBright ? 1.0 : 0.3);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      properties: {
        id,
        scheme:         'TACTICAL',
        color:          trackColor(t),
        domain:         t.domain,
        iff:            iffState,
        opacity,
        onGround:       !!t.onGround,
        heading:        Math.round(heading),
        emergency:      emType || '',
        emergencyColor: emType ? emergencyColor(emType) : '',
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
    if (!settings.shipsEnabled && t.domain === 'SEA') continue;
    if (t.domain === 'GROUND') continue; // ground units have no trail
    if (t.onGround) continue; // aircraft on ground have no trail
    const hist = history.get(id);
    if (!hist || hist.length < 2) continue;
    if (_isAtc(t)) {
      // STARS history: five blues, newest to oldest, the same for every
      // track — the trail never says who it is (docs/adr/0088).
      const P = typeof atcPalette === 'function' ? atcPalette() : null;
      if (!P) continue;
      const fade = sweepOpacity(id, 1) * baseOp;
      for (let age = 1; age <= P.history.length && age < hist.length; age++) {
        const pt = hist[hist.length - 1 - age];
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
          properties: { color: P.history[age - 1], opacity: P.historyOpacity * fade },
        });
      }
      continue;
    }
    addDots(hist, t, sweepOpacity(id, 1));
  }

  return { type: 'FeatureCollection', features };
}

// PPL: projected position lines
function buildPPL() {
  if (!settings.pplEnabled) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const durS     = settings.pplDuration;

  for (const [id, t] of tracks) {
    if (!settings.shipsEnabled && t.domain === 'SEA') continue;
    if (t.domain === 'GROUND') continue; // ground units have no PPL
    if (t.onGround) continue; // aircraft on ground have no PPL
    if (_isAtc(t)) continue; // a STARS scope draws no projected line (docs/adr/0088)
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
    if (!settings.shipsEnabled && t.domain === 'SEA') continue;
    if (settings.hideGroundUnits && t.domain === 'GROUND') continue;
    if (decluttered.has(id)) continue;
    if (!shouldLabel(t)) continue;

    const relOff = labelOffsets.get(id);
    if (!relOff) continue;

    const [dLat, dLon] = relOff;
    if (Math.abs(dLat) < 1e-7 && Math.abs(dLon) < 1e-7) continue;

    // An ATC block has its own colour and may sit at a coasting position.
    const atc = _isAtc(t) ? _atcDisplayFor(id, t) : null;
    if (atc && atc.lines.length === 0) continue;
    const at = atc ? { lat: atc.lat, lon: atc.lon } : t;
    const iconPx  = map.project([at.lon, at.lat]);
    const labelPx = map.project([at.lon + dLon, at.lat + dLat]);
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
      properties: atc
        ? { color: atc.view.color, opacity: sweepOpacity(id, baseOp) * atc.view.opacity * (atc.view.blinkBlock && !_pulseBright ? 0.15 : 1) }
        : { color: trackColor(t), opacity: sweepOpacity(id, baseOp) },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Sequential squawk declutter ───────────────────────────────────────────
// Returns the Set of track IDs whose labels should be suppressed because they
// are part of a sequential-squawk formation (e.g. 1101→1102→1103) where each
// follower is within 0.5 nm horizontally and 1 000 ft vertically of the
// previous squawk in the sequence. Only labels are hidden; icons still show.
// Needs what an SSR radar gives — a code and a Mode C altitude — so it only
// ever applies to contacts that have both.

function getDeclutteredIds() {
  if (!settings.declutter) return new Set();

  const byCode = new Map(); // numeric (octal) code -> track
  for (const [, t] of tracks) {
    if (!t.ssr || !t.ssr.code || !t.altitude) continue;
    byCode.set(parseInt(t.ssr.code, 8), t);
  }

  const hidden = new Set();
  const HORIZ_M = 0.5 * 1852; // 0.5 nm in metres
  const VERT_FT = 1000;

  for (const [code, t] of byCode) {
    const prev = byCode.get(code - 1);
    if (!prev) continue;
    if (haversineM(t.lat, t.lon, prev.lat, prev.lon) > HORIZ_M) continue;
    if (Math.abs(t.altitude.ft - prev.altitude.ft) > VERT_FT) continue;
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
    if (!settings.shipsEnabled && t.domain === 'SEA') continue;
    if (settings.hideGroundUnits && t.domain === 'GROUND') continue;
    if (decluttered.has(id)) continue; // formation follower — suppress label
    const atc = _isAtc(t) ? _atcDisplayFor(id, t) : null;
    if (atc ? atc.lines.length === 0 : !shouldLabel(t)) continue; // ships and vehicles only once named; ATC: no block

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
    const textOffset = [0, 0]; // label is placed at its geo coordinate
    if (atc) {
      // docs/adr/0088: the STARS block, from atc-scope.js / track-label.js.
      const blink = atc.view.blinkBlock && !_pulseBright ? 0.15 : 1;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [atc.lon + relOff[1], atc.lat + relOff[0]] },
        properties: {
          id, scheme: 'ATC', textOffset,
          opacity: sweepOpacity(id, baseOp) * atc.view.opacity * blink,
          halo: atc.palette.halo,
          ..._atcSegmentProps(atc),
        },
      });
      continue;
    }
    const coords     = [t.lon + relOff[1], t.lat + relOff[0]];
    const color      = trackColor(t);
    const opacity    = sweepOpacity(id, baseOp);

    // The data block. Every string in it comes from track-label.js.
    const air      = isAir(t);
    const hist     = history.get(id) || [];
    const csOnly   = !air || t.onGround;
    const infoLine = csOnly ? '' : infoLine_(t, hist);
    const code     = trackCodeTag(t);

    // docs/adr/0058: what the flight was told, and anything it is doing wrong.
    const fdr = air ? _fdrForTrack(id) : null;
    const { tag: alertTag, color: alertColor } = buildAlertTag(id, fdr);
    const asgnLine = csOnly ? '' : buildAssignedLine(fdr);

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id, scheme: 'TACTICAL', callsign: trackName(t) + trackNameSuffix(t), infoLine,
        sqTag: code.text, sqColor: code.color || color,
        color, opacity, textOffset, alertTag, alertColor, asgnLine,
      },
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

// The filed route of a flight record, as points on the map: departure →
// route tokens → destination, each resolved against the mission's navpoints
// and airports by name/ICAO. Airway identifiers (e.g. "UL9") simply match
// nothing and are dropped — there is no airway geometry to plot them against.
function parseFiledRouteWaypoints(filed) {
  if (!filed) return { points: [], matched: 0, total: 0 };

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
  if (filed.departureAirport) tokens.push(filed.departureAirport);
  for (const t of String(filed.route || '').trim().split(/\s+/)) {
    if (t && t.toUpperCase() !== 'DCT') tokens.push(t);
  }
  if (filed.destinationAirport) tokens.push(filed.destinationAirport);

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
  // Only drawn for an airfield whose approach radar we are actually looking
  // through. Asked by airport rather than by radar id, because the id used to
  // be built here as `'app:' + name` and crc-sync's CVN approach radars once
  // shared that prefix (its docs/adr/0042 renamed them `cvapp:`).
  if (!coverageApproachFor(_aprtSelectedApt.name)) return { type: 'FeatureCollection', features: [] };

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

/**
 * A ring around the contact the selected Strip is correlated to (guide §6.6
 * rule 4). A near-copy of buildRefDot above, with one deliberate difference:
 * it falls back to `latestFromServer` when the contact is not in the
 * sweep-gated `tracks` map — the same fix buildRangeRing already carries.
 *
 * That matters. `tracks` only holds contacts inside the fade window, so a
 * just-appeared or between-sweeps contact would render no ring and look like a
 * broken highlight. A correlation is flight-data truth, not a radar return.
 */
function buildEfspCorrelationRing() {
  if (typeof getCorrelatedHighlightTrackId !== 'function') return { type: 'FeatureCollection', features: [] };
  const trackId = getCorrelatedHighlightTrackId();
  if (!trackId) return { type: 'FeatureCollection', features: [] };
  const t = tracks.get(trackId) || latestFromServer.get(trackId);
  if (!t) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
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
      // Rotating beam: single line in the current sweep direction. The phase
      // is the server's own (`sweepStart` in the coverage message), so the
      // drawn beam is where the beam that reveals contacts actually is — it
      // never was when every client minted its own phase.
      if (!Number.isFinite(radar.sweepStart)) continue;
      const angle = ((now - radar.sweepStart) % radar.sweepMs) / radar.sweepMs * 360;
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
      if (!Number.isFinite(radar.sweepStart)) continue;
      const halfAngle = radar.angleFromNose / 2;
      const cycleMs   = radar.sweepMs * 2;
      const phase     = ((now - radar.sweepStart) % cycleMs) / cycleMs;
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

// Datalink lock lines: a dashed line from a datalink participant to the
// contact its radar is locked on (crc-sync's docs/adr/0059). crc-sync only
// sends a lock whose target is already in this controller's picture, so both
// ends are always contacts on the scope.
function buildDatalinkLines() {
  const features = [];
  if (settings.showDatalinkLocks === false) return { type: 'FeatureCollection', features };

  const color = settings.colFriendly || '#4488cc';
  for (const [, t] of tracks) {
    const lock = t.dl && t.dl.lock;
    if (!lock) continue;
    const target = tracks.get(String(lock));
    if (!target) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[t.lon, t.lat], [target.lon, target.lat]] },
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
  map.getSource('efsp-correlation').setData(buildEfspCorrelationRing());
  if (map.getSource('stca')) map.getSource('stca').setData(buildStcaOverlay());
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
