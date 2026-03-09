// ═══════════════════════════════════════════════════════════
// map-data.js — Collect plottable data from the ATO
// ═══════════════════════════════════════════════════════════

'use strict';

// Orbit/anchor airspaces closer than this threshold are merged into one
const ORBIT_MERGE_NM = 2.0;

/** Approximate great-circle distance in NM between two lat/lon points */
function _distNm(lat1, lon1, lat2, lon2) {
  const dlat = (lat1 - lat2) * 60;
  const dlon = (lon1 - lon2) * 60 * Math.cos((lat1 + lat2) * Math.PI / 180 / 2);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// ── Collect all plottable data ─────────────────────────────
function collectData(ato, aco) {
  const points = [];
  const routes = []; // [{msnKey, callsign, msnNumber, color, pts:[{lat,lon,kind}]}]
  const airspaces = []; // [{kind:'airspace', shape, ...}]
  const missions = ato.missions || [];

  // ── Phase 1: Build named location map ─────────────────────
  // Maps a string key → {lat, lon} for any named, locatable object.
  // Resolution order in routes: namedLocs lookup → coord parse.
  //   Airfields  keyed by ICAO (e.g. 'OMAM')
  //   Carriers   keyed by callsign (e.g. 'ROUGH RIDER')
  //   Marshal pts keyed by name (e.g. 'ALPHA')
  const namedLocs = {};

  // Separate map for carrier recovery positions (keyed by carrier id / callsign).
  // Used in step 4 so the recovery route endpoint lands at the carrier's projected
  // recovery position rather than the deploy position stored in namedLocs.
  const carrierRecoveryLocs = {};

  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p && af.icao) namedLocs[af.icao.trim().toUpperCase()] = p;
  });
  (ato.carriers || []).forEach(cv => {
    if (cv.deploy_coords) {
      const p = parseCoord(cv.deploy_coords);
      if (p) {
        // Key by callsign AND by registry id so both "ROUGH RIDER" and "CVN-71" resolve
        if (cv.callsign) namedLocs[cv.callsign.trim().toUpperCase()] = p;
        if (cv.id)       namedLocs[cv.id.trim().toUpperCase()]       = p;
      }
    }
    if (cv.recovery_coords) {
      const rp = parseCoord(cv.recovery_coords);
      if (rp) {
        if (cv.callsign) carrierRecoveryLocs[cv.callsign.trim().toUpperCase()] = rp;
        if (cv.id)       carrierRecoveryLocs[cv.id.trim().toUpperCase()]       = rp;
      }
    }
  });
  (ato.marshal_points || []).forEach(mp => {
    if (mp.name && mp.coords) {
      const p = parseCoord(mp.coords);
      if (p) namedLocs[mp.name.trim().toUpperCase()] = p;
    }
  });

  // Resolve a location string: named lookup first, then coord parse.
  // resolve() is defined here, after namedLocs is fully populated in Phase 1,
  // so all named markers (airfields, carriers, marshal points) are available
  // when it is called during Phase 3 mission processing.
  const resolve = str => {
    if (!str) return null;
    const up = str.trim().toUpperCase();
    if (namedLocs[up]) return namedLocs[up];
    return parseCoord(str);
  };

  // ── Phase 1b: Build takeoffs/recoveries-by-location key maps ─
  // Maps a deploy/recovery key (ICAO, carrier callsign, or carrier id) →
  // list of mission summaries used by the airfield and carrier popups.
  const takeoffsByKey = {};
  const recoveriesByKey = {};
  missions.forEach(m => {
    const depKey = (m.deploy_location_icao || '').trim().toUpperCase();
    if (depKey) {
      if (!takeoffsByKey[depKey]) takeoffsByKey[depKey] = [];
      takeoffsByKey[depKey].push({
        callsign: m.callsign || '?',
        msnNum: m.mission_number || '',
        time: m.takeoff_time || null,
      });
    }
    const recKey = (m.aar_location_icao || '').trim().toUpperCase();
    if (recKey) {
      if (!recoveriesByKey[recKey]) recoveriesByKey[recKey] = [];
      recoveriesByKey[recKey].push({
        callsign: m.callsign || '?',
        msnNum: m.mission_number || '',
        time: m.recovery_time || null,
      });
    }
  });

  // ── Phase 2: Static map markers ───────────────────────────

  // Bullseye
  const bs = ato.global_control?.bullseye;
  if (bs?.coords) {
    const p = parseCoord(bs.coords);
    if (p) points.push({ ...p, kind: 'bullseye', label: bs.name || 'BULLSEYE', sub: '' });
  }

  // Airfields
  (ato.airfields || []).forEach(af => {
    const p = parseCoord(af.coords);
    if (p) {
      const icao = (af.icao || '').trim().toUpperCase();
      points.push({
        ...p, kind: 'airfield',
        label: af.icao || af.name || '?',
        sub: [af.role, af.elevation_ft != null ? af.elevation_ft + 'ft' : null].filter(Boolean).join(' · '),
        name: af.name,
        role: af.role || null,
        elevation_ft: af.elevation_ft ?? null,
        runways: af.runways ?? null,
        takeoffs: takeoffsByKey[icao] || [],
      });
    }
  });

  // ── Helper: merge entries from multiple location keys, deduplicating ──
  // Returns a flat list of entries from `map` for all given `keys`,
  // with duplicates (same callsign + msnNum) filtered out.
  function mergeByKeys(map, keys) {
    const seen = new Set();
    return keys.flatMap(k => map[k] || []).filter(entry => {
      const dedupeKey = `${entry.callsign}|${entry.msnNum}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }

  // Carriers
  (ato.carriers || []).forEach(cv => {
    // Collect all keys this carrier is known by (callsign + id, both uppercased)
    const cvKeys = [cv.callsign, cv.id]
      .filter(Boolean).map(k => k.trim().toUpperCase());

    if (cv.deploy_coords) {
      const p = parseCoord(cv.deploy_coords);
      if (p) points.push({
        ...p, kind: 'carrier',
        label: cv.name || cv.callsign || 'CVN',
        sub: 'DEPLOY EST',
        callsign: cv.callsign,
        takeoffs: mergeByKeys(takeoffsByKey, cvKeys),
      });
    }
    if (cv.recovery_coords) {
      const p = parseCoord(cv.recovery_coords);
      if (p) points.push({
        ...p, kind: 'carrier',
        label: cv.name || cv.callsign || 'CVN',
        sub: 'RECOVERY EST',
        callsign: cv.callsign,
        recoveries: mergeByKeys(recoveriesByKey, cvKeys),
      });
    }
  });

  // Marshal points
  (ato.marshal_points || []).forEach(mp => {
    if (!mp.coords) return;
    const p = parseCoord(mp.coords);
    if (!p) return;
    points.push({
      ...p, kind: 'marshal',
      label: mp.name || 'MARSHAL',
      altitude: mp.altitude || null,
      time_on_station: mp.time_on_station || null,
      time_off_station: mp.time_off_station || null,
    });
  });

  // Threats (SAM / EWR / etc.)
  (ato.targets || []).forEach(tgt => {
    if (!tgt.coords) return;
    const p = parseCoord(tgt.coords);
    if (!p) return;
    points.push({
      ...p,
      kind: 'threat',
      label: tgt.name || tgt.id || '?',
      sub: [tgt.type, tgt.elevation, tgt.engagement_range_nm ? `ER ${tgt.engagement_range_nm}nm` : null].filter(Boolean).join(' · '),
      threatType: tgt.type,
      engagementRange: tgt.engagement_range_nm,
      maxAlt: tgt.max_alt_ft,
      elevation: tgt.elevation ?? null,
    });
  });

  // ── Phase 3: Per-mission routes + mission-linked markers ───
  missions.forEach(m => {
    const color    = typeColor(m.mission_type);
    const callsign = m.callsign || '?';
    const msnNum   = m.mission_number || '';
    const msnKey   = msnNum || callsign;
    const route    = { msnKey, callsign, msnNum, color, pts: [] };

    // 1. Deploy location
    const deployLoc = resolve(m.deploy_location_icao);
    if (deployLoc) route.pts.push({ ...deployLoc, kind: 'route-node' });

    // 2. Steer points — all waypoints contribute to the flight-path line.
    //    Only IP and EP special waypoints (special_type:'ip'/'ep') are drawn with
    //    an icon and label.  Marshal waypoints already have their own diamond marker
    //    (from ato.marshal_points) so no additional icon is added for them.
    //    Target waypoints (aim_point_id) drive the target-approach leg style on the
    //    line and are labelled by the separate aim-point diamond markers in step 3.
    //    Shared steerpoints (shared_steerpoint_id) are drawn by their own
    //    'shared-steerpoint' markers added in Phase 4b; only the route node is
    //    needed here to keep the flight-path line continuous.
    //    Orbit blocks add a racetrack airspace shape to the map.
    (m.steer_points || []).forEach((sp, i) => {
      // Handle shared steerpoint references — route line only; SSP has its own marker.
      const sspId = typeof sp === 'object' ? sp.shared_steerpoint_id : null;
      if (sspId) {
        if (sharedSteerpointMap[sspId]) {
          const ssp = sharedSteerpointMap[sspId];
          route.pts.push({ lat: ssp.lat, lon: ssp.lon, kind: 'route-node' });
        }
        return;
      }

      const nameRef     = typeof sp === 'object' ? sp.name_ref : null;
      const raw         = typeof sp === 'string' ? sp : sp.coords;
      const label       = (typeof sp === 'object' && sp.name) ? sp.name : null;
      const apId        = typeof sp === 'object' ? sp.aim_point_id : null;
      const altFt       = (typeof sp === 'object' && sp.altitude_ft != null) ? sp.altitude_ft : null;
      const specialType = typeof sp === 'object' ? sp.special_type : null;
      const p           = (nameRef ? resolve(nameRef) : null) || parseCoord(raw);
      if (!p) return;

      // Always add to route for the flight-path line
      route.pts.push({ ...p, kind: apId ? 'target-node' : 'route-node' });

      // Only IP and EP waypoints get an icon + label on the map.
      // Marshal waypoints have their own dedicated diamond markers.
      // All other waypoints (named or unnamed) are route-shaping only.
      if (specialType === 'ip' || specialType === 'ep') {
        points.push({
          ...p, kind: 'steer',
          label: `${callsign}${msnNum ? ' · ' + msnNum : ''}`,
          sub: label || specialType.toUpperCase(),
          color, msnType: m.mission_type, mission: m,
          altitude_ft: altFt,
        });
      }

      // Orbit/anchor track: render a racetrack on the map.
      // Skip if a near-identical orbit has already been pushed (proximity dedup).
      if (typeof sp === 'object' && sp.orbit) {
        const orb = sp.orbit;
        const alreadyDrawn = airspaces.some(
          a => a.shape === 'anchor' && _distNm(p.lat, p.lon, a.lat, a.lon) < ORBIT_MERGE_NM
        );
        if (!alreadyDrawn) {
          airspaces.push({
            kind: 'airspace',
            name: label || `${callsign} ORBIT`,
            type: m.mission_type === 'TANKER' ? 'REFUEL' : 'ORBIT',
            altLower: orb.alt_ft != null ? Math.round(orb.alt_ft / 100) * 100 + 'ft' : null,
            altUpper: null,
            lat: p.lat, lon: p.lon,
            shape: 'anchor',
            anchorPt: p,
            headingDeg: orb.heading_deg || 0,
            legLengthNm: orb.leg_nm || 10,
            widthNm: orb.width_nm || 5,
            direction: (orb.direction || 'ccw').toLowerCase(),
            speedKts: orb.speed_kts,
            missions: [msnNum].filter(Boolean),
          });
        }
      }
    });

    // 3. Target aim-point markers.
    //    IMPORTANT: we do NOT push any route.pts nodes here — adding target nodes
    //    after all steer_points would cause the route line to detour to the targets
    //    again after the egress waypoints, before the recovery.
    (m.targets || []).forEach(target => {
      (target.aim_points || []).forEach((ap, i) => {
        const raw  = typeof ap === 'string' ? ap : ap.coords;
        const name = (typeof ap === 'object' && ap.name) ? ap.name : `AIM ${i + 1}`;
        const p    = parseCoord(raw);
        if (p) {
          points.push({ ...p, kind: 'target', label: callsign, sub: name, color, msnType: m.mission_type, mission: m });
        }
      });
    });

    // 4. Recovery location — carriers use their projected recovery position,
    //    not the deploy position stored in namedLocs.
    const aarKey = (m.aar_location_icao || '').trim().toUpperCase();
    const recLoc = carrierRecoveryLocs[aarKey]
                || resolve(m.aar_location_icao)
                || resolve(m.deploy_location_icao);
    if (recLoc) route.pts.push({ ...recLoc, kind: 'route-node' });

    if (route.pts.length >= 2) routes.push(route);
  });

  // ── Phase 4: Tanker orbit anchors ─────────────────────────
  const tankerList = Array.isArray(ato.tankers) ? ato.tankers : Object.values(ato.tankers || {});
  tankerList.forEach(t => {
    if (!t.orbit_anchor_coords) return;
    const anchorPt = parseCoord(t.orbit_anchor_coords);
    if (!anchorPt) return;
    airspaces.push({
      kind: 'airspace',
      name: t.callsign || 'TANKER',
      type: 'REFUEL',
      altLower: t.altitude || null,
      altUpper: null,
      lat: anchorPt.lat, lon: anchorPt.lon,
      shape: 'anchor',
      anchorPt,
      headingDeg: t.orbit_heading_deg || 0,
      legLengthNm: t.orbit_leg_nm || 10,
      widthNm: t.orbit_width_nm || 5,
      direction: (t.orbit_direction || 'ccw').toLowerCase(),
      speedKts: t.speed_kts,
    });
  });

  // ── Phase 4b: Shared steerpoints ──────────────────────────
  const sharedSteerpointMap = {};
  (ato.shared_steerpoints || []).forEach(ssp => {
    if (!ssp.id || !ssp.coords) return;
    const p = parseCoord(ssp.coords);
    if (!p) return;
    sharedSteerpointMap[ssp.id] = { ...ssp, ...p };
    const typeLabel = (ssp.type || '').toUpperCase();
    const nameLabel = ssp.name ? `${typeLabel} ${ssp.name}` : typeLabel;
    const flightsLabel = (ssp.flights || []).join(', ');
    points.push({
      ...p, kind: 'shared-steerpoint',
      label: nameLabel,
      sub: flightsLabel,
      specialType: ssp.type,
      flights: ssp.flights || [],
      altitude_ft: ssp.altitude_ft ?? null,
      sspId: ssp.id,
    });
  });

  // ── Phase 4c: Support flights ─────────────────────────────
  (ato.support_flights || []).forEach(sf => {
    const callsign = sf.callsign || '?';
    const sfKey = `SUPPORT-${callsign}`;
    const color = typeColor(sf.type);
    const route = { msnKey: sfKey, callsign, msnNum: '', color, pts: [] };

    (sf.route || []).forEach(wp => {
      const p = parseCoord(wp.coords);
      if (p) route.pts.push({ ...p, kind: 'route-node' });
    });
    if (route.pts.length >= 2) routes.push(route);

    if (sf.orbit && sf.orbit.anchor_point) {
      const anchorPt = parseCoord(sf.orbit.anchor_point);
      if (anchorPt) {
        const orb = sf.orbit;
        airspaces.push({
          kind: 'airspace',
          name: callsign,
          type: sf.type === 'TANKER' ? 'REFUEL' : 'ORBIT',
          altLower: orb.altitude_ft != null ? Math.round(orb.altitude_ft / 100) * 100 + 'ft' : null,
          altUpper: null,
          lat: anchorPt.lat, lon: anchorPt.lon,
          shape: 'anchor',
          anchorPt,
          headingDeg: orb.heading_deg || 0,
          legLengthNm: orb.leg_nm || 10,
          widthNm: orb.width_nm || 5,
          direction: (orb.direction || 'ccw').toLowerCase(),
          speedKts: orb.speed_kts,
        });
      }
    }
  });

  // ── Phase 5: ACO airspace measures ────────────────────────
  (aco?.acms || []).forEach(acm => {
    const geo = acm.geometry || {};
    const acmBase = {
      kind: 'airspace',
      name: acm.name, type: acm.type,
      altLower: acm.alt_lower, altUpper: acm.alt_upper,
      timeFrom: acm.time_from, timeTo: acm.time_to,
      agency: acm.control_agency, freq: acm.control_freq_mhz,
      notes: acm.notes, missions: acm.missions,
    };

    if (geo.anchor_point) {
      const anchor = parseCoord(geo.anchor_point);
      if (anchor) {
        airspaces.push({
          ...acmBase,
          lat: anchor.lat, lon: anchor.lon,
          shape: 'anchor',
          anchorPt: anchor,
          headingDeg: geo.heading_deg || 0,
          legLengthNm: geo.leg_length_nm || 10,
          direction: (geo.direction || 'cw').toLowerCase(),
        });
      }
    } else if (geo.center) {
      const center = parseCoord(geo.center);
      if (center) {
        airspaces.push({ ...acmBase, ...center, shape: 'circle', radiusNm: geo.radius_nm || 5 });
      }
    }
    if (geo.boundary?.length) {
      const pts = geo.boundary.map(c => parseCoord(c)).filter(Boolean);
      if (pts.length >= 3) {
        airspaces.push({
          ...acmBase,
          lat: pts.reduce((s, pt) => s + pt.lat, 0) / pts.length,
          lon: pts.reduce((s, pt) => s + pt.lon, 0) / pts.length,
          shape: 'polygon',
          boundary: pts,
        });
      }
    }
  });

  return { points, routes, airspaces };
}

