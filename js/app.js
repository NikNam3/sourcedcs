// ═══════════════════════════════════════════════════════════
// app.js — State, routing, shared utilities
// ═══════════════════════════════════════════════════════════

'use strict';

// ── State ────────────────────────────────────────────────────
const STATE = {
  pkg:          null,   // loaded package object {ato, aco, spins, comms}
  selectedIdx:  -1,
  currentTab:   'ato',
  theme:        'pro',
  display: {
    timeMode:  'Z',   // 'Z' = Zulu, 'L' = local (uses ato.local_offset_hours)
    coordMode: 'dm',  // 'dm' = decimal minutes, 'dms' = deg/min/sec, 'mgrs'
  },
};

// ── Shared helpers ───────────────────────────────────────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Build a DOM element from a tagged template literal.
// Lets you write declarative HTML trees instead of el()+appendChild() chains:
//
//   const card = html`
//     <div class="mission-card">
//       <div class="card-callsign">${m.callsign}</div>
//     </div>`;
//
// Returns the first element child of the parsed template.
// Values are coerced to strings; no sanitisation is applied.
function html(strings, ...values) {
  const raw = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
  const t = document.createElement('template');
  t.innerHTML = raw.trim();
  return t.content.firstElementChild;
}

function toMins(v) {
  if (!v) return null;
  const s = String(v).replace(/[ZL]/i, '').padStart(4, '0');
  return parseInt(s.slice(0, 2)) * 60 + parseInt(s.slice(2, 4));
}

// Wrap a minute value into the 0–1439 range (24-hour clock).
function wrapMins(m) { return ((m % 1440) + 1440) % 1440; }
// current display time mode. In 'Z' mode returns '2040Z'; in 'L' mode adds
// the ATO's local_offset_hours and returns e.g. '0040L'.
function fmtTime(v) {
  if (!v) return '—';
  const mins = toMins(v);
  if (mins === null) return String(v);
  if (STATE.display.timeMode === 'L') {
    const off = (STATE.pkg?.ato?.local_offset_hours || 0) * 60;
    const lm  = wrapMins(mins + off);
    return String(Math.floor(lm / 60)).padStart(2, '0') +
           String(lm % 60).padStart(2, '0') + 'L';
  }
  return String(v).replace(/[ZL]/i, '').padStart(4, '0') + 'Z';
}

// ── Coordinate parsing ────────────────────────────────────────
// Shared source for the NATO coord pattern (DM / DMS, N/S…E/W prefix).
// Used both by parseCoord() and reformatCoordsInText() so they stay in sync.
const COORD_RE_SRC = String.raw`([NS])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″\s]*)?\s*([EW])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″]?)?`;

// Accepts DMS / DM / decimal-degree strings in any of the usual
// military notations (deg / °d / deg keyword).  Returns {lat, lon}
// or null when the string cannot be parsed.
function parseCoord(str) {
  if (!str) return null;
  const m = String(str).match(new RegExp(COORD_RE_SRC, 'i'));
  if (!m) return null;
  const lat = (m[1].toUpperCase() === 'N' ? 1 : -1) * (+m[2] + +m[3] / 60 + +(m[4] || 0) / 3600);
  const lon = (m[5].toUpperCase() === 'E' ? 1 : -1) * (+m[6] + +m[7] / 60 + +(m[8] || 0) / 3600);
  return (isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

// ── Coordinate formatters ─────────────────────────────────────
// Decimal minutes: N26°51.319' E056°21.616'
function fmtCoordDM(lat, lon) {
  function fmt(d, pos, neg) {
    const sign = d >= 0;
    const ab = Math.abs(d);
    const deg = Math.floor(ab);
    const min = (ab - deg) * 60;
    return `${sign ? pos : neg}${String(deg).padStart(2, '0')}°${min.toFixed(3).padStart(6, '0')}'`;
  }
  return `${fmt(lat, 'N', 'S')} ${fmt(lon, 'E', 'W')}`;
}

// Degrees-minutes-seconds: N26°51'19.1" E056°21'36.9"
function fmtCoordDMS(lat, lon) {
  function fmt(d, pos, neg) {
    const sign = d >= 0;
    const ab = Math.abs(d);
    const deg = Math.floor(ab);
    const mf  = (ab - deg) * 60;
    const min = Math.floor(mf);
    const sec = ((mf - min) * 60).toFixed(1);
    return `${sign ? pos : neg}${String(deg).padStart(2, '0')}°${String(min).padStart(2, '0')}'${String(sec).padStart(4, '0')}"`;
  }
  return `${fmt(lat, 'N', 'S')} ${fmt(lon, 'E', 'W')}`;
}

// MGRS (WGS-84) using the standard NATO formula.
// Covers 80°S – 84°N; falls back to DM for polar regions.
function latLonToMGRS(lat, lon) {
  if (lat < -80 || lat > 84) return fmtCoordDM(lat, lon);

  // WGS-84 ellipsoid parameters
  const WGS84_SEMI_MAJOR = 6378137;          // semi-major axis (m)
  const WGS84_ECC_SQ     = 0.00669437999014; // eccentricity squared (e²)
  const UTM_SCALE        = 0.9996;           // UTM central meridian scale factor

  // UTM zone with Norway / Svalbard exceptions
  let zoneNum = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3  && lon < 12) zoneNum = 32;
  if (lat >= 72 && lat < 84) {
    if      (lon >=  0 && lon <  9) zoneNum = 31;
    else if (lon >=  9 && lon < 21) zoneNum = 33;
    else if (lon >= 21 && lon < 33) zoneNum = 35;
    else if (lon >= 33 && lon < 42) zoneNum = 37;
  }

  const latR  = lat * Math.PI / 180;
  const lonR  = lon * Math.PI / 180;
  const lon0R = ((zoneNum - 1) * 6 - 180 + 3) * Math.PI / 180;

  const e2 = WGS84_ECC_SQ;
  const e4 = e2 * e2, e6 = e4 * e2;
  const N  = WGS84_SEMI_MAJOR / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const t  = Math.tan(latR);
  const c  = (e2 / (1 - e2)) * Math.cos(latR) ** 2;
  const ag = Math.cos(latR) * (lonR - lon0R);

  const M = WGS84_SEMI_MAJOR * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256)  * latR
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latR)
    + (15 * e4 / 256 + 45 * e6 / 1024)             * Math.sin(4 * latR)
    - (35 * e6 / 3072)                              * Math.sin(6 * latR)
  );

  const easting = UTM_SCALE * N * (
    ag
    + (1 - t * t + c) * ag ** 3 / 6
    + (5 - 18 * t * t + t ** 4 + 72 * c - 58 * e2 / (1 - e2)) * ag ** 5 / 120
  ) + 500000;

  let northing = UTM_SCALE * (M + N * Math.tan(latR) * (
    ag ** 2 / 2
    + (5 - t * t + 9 * c + 4 * c * c)                                        * ag ** 4 / 24
    + (61 - 58 * t * t + t ** 4 + 600 * c - 330 * e2 / (1 - e2))            * ag ** 6 / 720
  ));
  if (lat < 0) northing += 10000000;

  // MGRS band letter (C–X, no I or O)
  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const band = BANDS[Math.min(Math.floor((lat + 80) / 8), 19)];

  // 100 km column letter (A-H / J-R / S-Z cycling by zone mod 3)
  const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const colIdx   = Math.floor(easting / 100000) - 1;   // 0–7
  const colLetter = (COL_SETS[(zoneNum - 1) % 3] || '')[colIdx] || '?';

  // 100 km row letter (A–V no I/O, cycling; even zones start at F)
  const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV'; // 20 letters
  const rowOffset   = zoneNum % 2 === 0 ? 5 : 0;
  const rowIdx      = (Math.floor(northing / 100000) % 20 + rowOffset + 20) % 20;
  const rowLetter   = ROW_LETTERS[rowIdx];

  const e5 = String(Math.floor(easting  % 100000)).padStart(5, '0');
  const n5 = String(Math.floor(northing % 100000)).padStart(5, '0');

  return `${zoneNum}${band} ${colLetter}${rowLetter} ${e5} ${n5}`;
}

// Dispatch to the formatter selected by STATE.display.coordMode.
// Called from map-ui.js (popup coords) and view-ato.js (bullseye / aim points).
function fmtCoord(lat, lon) {
  if (STATE.display.coordMode === 'dms')  return fmtCoordDMS(lat, lon);
  if (STATE.display.coordMode === 'mgrs') return latLonToMGRS(lat, lon);
  return fmtCoordDM(lat, lon);
}

// Scan a free-text string for embedded coordinate patterns and reformat
// each one according to the current coord display mode.  Non-coord text
// is returned unchanged.  Used by ACO geometry strings and SPINS entries
// so that changing the coord mode updates those views too.
function reformatCoordsInText(text) {
  if (!text) return text;
  const re = new RegExp(COORD_RE_SRC, 'gi');
  return String(text).replace(re, match => {
    // Preserve any trailing whitespace consumed by ['\s]* in the regex
    const trimmed  = match.trimEnd();
    const trailing = match.slice(trimmed.length);
    const p = parseCoord(trimmed);
    return p ? fmtCoord(p.lat, p.lon) + trailing : match;
  });
}

// Convert a time value that is natively in local time to Zulu,
// so fmtTime() (which assumes Zulu input) can process it correctly.
function localToZuluTime(v) {
  const mins = toMins(v);
  if (mins == null) return v;
  const off = (STATE.pkg?.ato?.local_offset_hours || 0) * 60;
  const zuluMins = wrapMins(mins - off);
  return String(Math.floor(zuluMins / 60)).padStart(2, '0') +
         String(zuluMins % 60).padStart(2, '0');
}

const KNOWN_TYPES = ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE'];
function typeKey(t) {
  return KNOWN_TYPES.includes((t || '').toUpperCase()) ? t.toUpperCase() : 'OTHER';
}

const TYPE_COLORS_PRO = {
  CAP: '#1a5c2e', BAI: '#7c3500', CAS: '#003d6b',
  SEAD: '#4a1a6b', STRIKE: '#6b0f1a', OTHER: '#3d3400',
};
const TYPE_COLORS_MFD = {
  CAP: '#39ff7a', BAI: '#ff8c00', CAS: '#4fc3f7',
  SEAD: '#c084fc', STRIKE: '#ff4444', OTHER: '#ffb020',
};
function typeColor(t) {
  return (STATE.theme === 'movie' ? TYPE_COLORS_MFD : TYPE_COLORS_PRO)[typeKey(t)];
}

// ── Theme ────────────────────────────────────────────────────
function setTheme(t) {
  STATE.theme = t;
  const root = document.documentElement;
  if (t === 'movie') {
    root.classList.add('movie');
  } else {
    root.classList.remove('movie');
  }
  document.querySelectorAll('[data-theme]').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
  // Re-render views that use theme-dependent colors
  if (STATE.pkg) {
    if (STATE.pkg.ato) {
      renderATO(STATE.pkg.ato);
      renderMAP(STATE.pkg.ato);
    }
  }
}

// ── Display mode: time (Z / L) ────────────────────────────────
function setTimeMode(m) {
  STATE.display.timeMode = m;
  document.querySelectorAll('[data-time]').forEach(b => {
    b.classList.toggle('active', b.dataset.time === m);
  });
  if (STATE.pkg?.ato) {
    renderHeader(STATE.pkg.ato);
    renderATO(STATE.pkg.ato);
  }
  if (STATE.pkg?.aco)     renderACO(STATE.pkg.aco);
  if (STATE.pkg?.spins)   renderSPINS(STATE.pkg.spins);
  if (STATE.pkg?.weather) renderWEATHER(STATE.pkg.weather);
  mapRefreshPopup(); // refresh open map popup with new time format
}

// ── Display mode: coordinates (dm / dms / mgrs) ───────────────
function setCoordMode(m) {
  STATE.display.coordMode = m;
  document.querySelectorAll('[data-coord]').forEach(b => {
    b.classList.toggle('active', b.dataset.coord === m);
  });
  if (STATE.pkg?.ato)   renderATO(STATE.pkg.ato);
  if (STATE.pkg?.aco)   renderACO(STATE.pkg.aco);
  if (STATE.pkg?.spins) renderSPINS(STATE.pkg.spins);
  mapRefreshPopup(); // refresh open map popup with new coord format
}

// ── Tab routing ───────────────────────────────────────────────
function showTab(name) {
  // If coord pick is active and user navigates away from map, cancel pick
  // and restore the editor overlay
  if (typeof EDITOR !== 'undefined' && typeof EDITOR._coordPickCb === 'function' &&
      name !== 'map' && STATE.currentTab === 'map') {
    EDITOR._coordPickCb = null;
    var overlay = document.getElementById('editorOverlay');
    if (overlay) overlay.style.display = 'flex';
  }

  STATE.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + name);
  });
}

// ── Package loading ───────────────────────────────────────────
function loadPackage(yamlText) {
  let data;
  try {
    data = jsyaml.load(yamlText);
  } catch (e) {
    alert('YAML parse error: ' + e.message);
    return;
  }
  loadPackage_obj(data);
}

function loadPackage_obj(data) {
  // Accept a full package {ato, aco, spins, comms} — any subset is fine
  const pkg = {};
  if (data.ato)     pkg.ato     = data.ato;
  if (data.aco)     pkg.aco     = data.aco;
  if (data.spins)   pkg.spins   = data.spins;
  if (data.comms)   pkg.comms   = data.comms;
  if (data.weather) pkg.weather = data.weather;

  // Preserve top-level metadata
  if (data.schema_version) pkg.schema_version = data.schema_version;
  if (data.header)         pkg.header         = data.header;
  if (data.registry)       pkg.registry       = data.registry;

  if (!pkg.ato && !pkg.aco && !pkg.spins && !pkg.comms && !pkg.weather) {
    alert('Unrecognised file — expected top-level keys: ato, aco, spins, comms, and/or weather');
    return;
  }

  STATE.pkg = pkg;

  // ── Propagate header fields to sections that lack them ───
  // header uses ato_date (YYYY-MM-DD); sections expect ato_day for display
  if (pkg.header) {
    const h = pkg.header;
    ['ato', 'aco', 'spins', 'comms', 'weather'].forEach(key => {
      if (!pkg[key]) return;
      if (!pkg[key].operation && h.operation) pkg[key].operation = h.operation;
      if (!pkg[key].ato_day   && h.ato_date)  pkg[key].ato_day   = h.ato_date;
    });
    if (pkg.ato && !pkg.ato.classification && h.classification)
      pkg.ato.classification = h.classification;
    if (pkg.aco && !pkg.aco.classification && h.classification)
      pkg.aco.classification = h.classification;
    if (pkg.spins && !pkg.spins.classification && h.classification)
      pkg.spins.classification = h.classification;
    if (pkg.comms && !pkg.comms.classification && h.classification)
      pkg.comms.classification = h.classification;
  }

  // ── Resolve registry airfields into ato.airfields ────────
  if (pkg.registry?.airfields && pkg.ato?.airfields) {
    pkg.ato.airfields.forEach(af => {
      const reg = pkg.registry.airfields[af.icao];
      if (reg) {
        if (reg.name != null)          af.name          = reg.name;
        if (reg.coords != null)        af.coords        = reg.coords;
        if (reg.elevation_ft != null)  af.elevation_ft  = reg.elevation_ft;
      }
    });
  }

  // ── Resolve registry carriers into ato.carriers ─────────
  if (pkg.registry?.carriers && pkg.ato?.carriers) {
    pkg.ato.carriers.forEach(cv => {
      const reg = pkg.registry.carriers[cv.id];
      if (reg) {
        if (reg.name != null)            cv.name            = reg.name;
        if (reg.callsign != null)        cv.callsign        = reg.callsign;
        if (reg.deploy_coords != null)   cv.deploy_coords   = reg.deploy_coords;
        if (reg.recovery_coords != null) cv.recovery_coords = reg.recovery_coords;
      }
    });
  }

  // ── Resolve registry tankers into ato.tankers ───────────
  if (pkg.registry?.tankers && pkg.ato) {
    if (!pkg.ato.tankers || pkg.ato.tankers.length === 0) {
      // Build tanker list from registry
      pkg.ato.tankers = [];
      Object.entries(pkg.registry.tankers).forEach(([id, t]) => {
        pkg.ato.tankers.push({ id, ...t });
      });
    } else {
      // Resolve existing tanker references — registry always wins
      pkg.ato.tankers.forEach(t => {
        const reg = pkg.registry.tankers[t.id];
        if (reg) {
          if (reg.callsign != null) t.callsign = reg.callsign;
          if (reg.ar_track != null) t.ar_track = reg.ar_track;
          if (reg.altitude != null) t.altitude = reg.altitude;
        }
      });
    }
  }

  // ── Resolve registry targets into ato.targets ───────────
  if (pkg.registry?.targets && pkg.ato) {
    // Always rebuild from registry so edits are reflected
    pkg.ato.targets = [];
    Object.entries(pkg.registry.targets).forEach(([id, t]) => {
      pkg.ato.targets.push({ id, ...t });
    });
  }

  // ── Resolve registry reference_points: bullseye + marshal_points ─
  if (pkg.registry?.reference_points && pkg.ato) {
    // Resolve bullseye if it's a string reference
    const gc = pkg.ato.global_control;
    if (gc && typeof gc.bullseye === 'string') {
      const ref = pkg.registry.reference_points[gc.bullseye];
      if (ref) {
        gc.bullseye = { name: ref.name || gc.bullseye, coords: ref.coords };
      }
    }

    // Always rebuild marshal_points from registry so edits are reflected
    pkg.ato.marshal_points = [];
    Object.entries(pkg.registry.reference_points).forEach(([id, rp]) => {
      if (rp.type === 'marshal') {
        pkg.ato.marshal_points.push({ id, name: rp.name, coords: rp.coords, altitude: rp.altitude });
      }
    });
  }

  // ── Resolve registry control_agencies into global_control + mission control ─
  if (pkg.registry?.control_agencies && pkg.ato) {
    const gc = pkg.ato.global_control;
    if (gc?.agency_id) {
      const ag = pkg.registry.control_agencies[gc.agency_id];
      if (ag) {
        if (ag.callsign != null)         gc.controlling_unit  = ag.callsign;
        if (ag.platform != null)         gc.aircraft_type     = ag.platform;
        if (ag.primary_freq_mhz != null) gc.primary_freq_mhz = ag.primary_freq_mhz;
        gc._agency = ag;
      }
    }

    (pkg.ato.missions || []).forEach(m => {
      if (m.control?.agency_id) {
        const ag = pkg.registry.control_agencies[m.control.agency_id];
        if (ag) {
          if (ag.primary_freq_mhz != null)   m.control.primary_freq_mhz   = ag.primary_freq_mhz;
          if (ag.secondary_freq_mhz != null) m.control.secondary_freq_mhz = ag.secondary_freq_mhz;
          if (ag.callsign != null)           m.control.net_name            = ag.callsign;
          m.control._agency = ag;
        }
      }
    });
  }

  // ── Normalize ingame start time (v1.0 uses ingame_start_time in Zulu) ─
  if (pkg.ato?.ingame_start_time && !pkg.ato.ingame_start_local) {
    pkg.ato.ingame_start_local = pkg.ato.ingame_start_time;
    pkg.ato._ingame_is_zulu = true;
  }

  // ── Resolve tanker references in mission refuel blocks ───
  if (pkg.ato?.tankers && pkg.ato?.missions) {
    const tankerMap = {};
    pkg.ato.tankers.forEach(t => { if (t.id) tankerMap[t.id] = t; });

    pkg.ato.missions.forEach(m => {
      if (m.refuel?.tanker_id && tankerMap[m.refuel.tanker_id]) {
        const t = tankerMap[m.refuel.tanker_id];
        if (!m.refuel.tanker_callsign) m.refuel.tanker_callsign = t.callsign;
        if (!m.refuel.ar_track)        m.refuel.ar_track        = t.ar_track;
        if (!m.refuel.altitude)        m.refuel.altitude        = t.altitude;
      }
    });
  }

  // Resolve target references in aim_points
  if (pkg.ato?.targets && pkg.ato?.missions) {
    const tgtMap = {};
    pkg.ato.targets.forEach(t => { if (t.id) tgtMap[t.id] = t; });

    pkg.ato.missions.forEach(m => {
      // Resolve target_id: pull aim_points from the referenced registry target
      if (m.target?.target_id && tgtMap[m.target.target_id]) {
        const ref = tgtMap[m.target.target_id];
        if (!m.target.aim_points && ref.aim_points) {
          // No explicit aim_points — pull all from the target
          m.target.aim_points = ref.aim_points.map(ap => ({
            coords: ap.coords, name: ap.name || ap.id, elevation: ap.elevation,
            _resolved_target: ref,
          }));
        } else if (m.target.aim_points && ref.aim_points) {
          // Explicit aim_points — resolve aim_point_id references
          const apMap = {};
          ref.aim_points.forEach(ap => { if (ap.id) apMap[ap.id] = ap; });
          m.target.aim_points = m.target.aim_points.map(ap => {
            if (ap.aim_point_id && apMap[ap.aim_point_id]) {
              const resolved = apMap[ap.aim_point_id];
              return {
                coords: ap.coords || resolved.coords,
                name: ap.name || resolved.name || resolved.id,
                elevation: ap.elevation || resolved.elevation,
                _resolved_target: ref,
              };
            }
            return ap;
          });
        }
      }

      // Resolve legacy target_ref in individual aim_points
      (m.target?.aim_points || []).forEach((ap, i, arr) => {
        if (typeof ap === 'object' && ap.target_ref && tgtMap[ap.target_ref]) {
          const ref = tgtMap[ap.target_ref];
          if (!ap.coords)    ap.coords    = ref.coords;
          if (!ap.elevation) ap.elevation = ref.elevation;
          if (!ap.name)      ap.name      = ref.name || ref.id;
          ap._resolved_target = ref;  // full target metadata for the UI
          arr[i] = ap;
        }
      });
    });
  }

  STATE.selectedIdx = -1;

  // Show main content, hide upload screen
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('main-content').style.display  = 'flex';

  // Populate compact header (IRL + Ingame in one place only)
  renderHeader(pkg.ato || null);

  // Enable/disable tabs
  ['ato', 'aco', 'spins', 'comms', 'map', 'weather'].forEach(tab => {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    const available = tab === 'map' ? !!pkg.ato : !!pkg[tab];
    if (btn) btn.disabled = !available;
  });

  // Render whatever we have
  if (pkg.ato)     renderATO(pkg.ato);
  if (pkg.aco)     renderACO(pkg.aco);
  if (pkg.spins)   renderSPINS(pkg.spins);
  if (pkg.comms)   renderCOMMS(pkg.comms);
  if (pkg.weather) renderWEATHER(pkg.weather);
  if (pkg.ato)     renderMAP(pkg.ato); // map uses ATO coordinate data

  // Navigate to first available tab
  const first = ['ato', 'aco', 'spins', 'comms', 'weather'].find(t => pkg[t]);
  if (first) showTab(first);
}

// ── Header population ─────────────────────────────────────────
// Only shows high-level package info. IRL/Ingame times live in
// the ATO intel strip (view-ato.js) to avoid duplication.
function renderHeader(ato) {
  const meta = document.getElementById('header-meta');
  if (!ato) { meta.innerHTML = ''; return; }

  // IRL time is always displayed in Zulu — it's a real-world reference
  const irlTimeRaw = ato.irl_time_zulu ? String(ato.irl_time_zulu).replace(/[ZL]/i, '').padStart(4, '0') + 'Z' : null;
  const irl = [ato.irl_date, irlTimeRaw].filter(Boolean).join(' ') || '—';
  // ingame_start_time (v1.0) is already Zulu; ingame_start_local (legacy) needs conversion
  const ingame = ato._ingame_is_zulu
    ? fmtTime(ato.ingame_start_time)
    : fmtTime(localToZuluTime(ato.ingame_start_local)) || '—';
  const items = [];
  // Prepend operation and ATO day if available
  if (ato.operation) items.push(['OPERATION', ato.operation, '']);
  if (ato.ato_day)   items.push(['ATO DAY', ato.ato_day, '']);
  items.push(['IRL START',    irl,    '']);
  items.push(['INGAME START', ingame, 'ingame']);

  // Header shows: operation, ato day, irl/ingame times.
  // Full detail (AWACS, freq, bullseye, etc.) is in the ATO intel strip.
  meta.innerHTML = '';
  items.forEach(([lbl, val, cls]) => {
    const block = el('div', 'meta-block');
    block.appendChild(el('div', 'meta-label', lbl));
    block.appendChild(el('div', `meta-value${cls ? ' ' + cls : ''}`, val));
    meta.appendChild(block);
  });
}

// ── File input wiring ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const dropZone  = document.getElementById('dropZone');

  fileInput.addEventListener('change', function () {
    const f = this.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => loadPackage(e.target.result);
    r.readAsText(f);
  });

  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => loadPackage(ev.target.result);
    r.readAsText(f);
  });

  // Re-render ATO timeline on window resize so tick spacing adapts
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (STATE.pkg?.ato) renderTimeline(STATE.pkg.ato.missions || []);
    }, 150);
  });
});
