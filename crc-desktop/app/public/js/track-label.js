// What a contact is called and how its data block reads (crc-sync's
// docs/adr/0059).
//
// crc-sync sends a contact as its controller's sensors know it: a position,
// and only if a sensor could know them, a transponder code, an altitude, a
// datalink report, and who it is (its flight, a tag, or its track number).
// This file is the ONLY place that turns that into text. The map's data
// block, the track panel, the bind picker and the correlation badge all ask
// here, so a change to how a contact is named is one change.
//
// Wire shape (crc-sync/src/surveillance/presentation.js):
//   { id, lat, lon, domain: 'AIR'|'SEA'|'GROUND', onGround, illuminatedAt, sources,
//     iffState, iffOverride,
//     label: { callsign, source: 'FDR'|'FDR_PROVISIONAL'|'DATALINK'|'TAG'|null, tag, trackNumber },
//     type, ssr: { code, ident, emergency } | null,
//     altitude: { ft, ref: 'QNH'|'STD', source: 'MODE_C'|'RADAR'|'DATALINK' } | null,
//     dl: { lock } | null }

const EMERGENCY_TAG = { HIJACK: 'HIJ', RADIO: 'RDF', GENERAL: 'EMR' };

function _settings() {
  return (typeof settings !== 'undefined' && settings) || {};
}

/** Emergency colours, from the user's settings. */
function emergencyColor(kind) {
  const s = _settings();
  if (kind === 'HIJACK')  return s.colEmergHijack || '#cc6600';
  if (kind === 'RADIO')   return s.colEmergRadio  || '#b8a000';
  if (kind === 'GENERAL') return s.colEmergGen    || '#cc2222';
  return '';
}

function isAir(t)    { return !!t && t.domain === 'AIR'; }
function isSea(t)    { return !!t && t.domain === 'SEA'; }
function isGround(t) { return !!t && t.domain === 'GROUND'; }

/** The contact's name: its flight, datalink name or tag; else its code; else its track number. */
function trackName(t) {
  if (!t) return '';
  const label = t.label || {};
  return label.callsign || (t.ssr && t.ssr.code) || label.trackNumber || '';
}

/** `?` after a name that came from a provisional correlation, so doubt still looks like doubt. */
function trackNameSuffix(t) {
  return t && t.label && t.label.source === 'FDR_PROVISIONAL' ? '?' : '';
}

/** The contact's own reference, never its flight's callsign: its code, else its track number. */
function trackRef(t) {
  if (!t) return '';
  return (t.ssr && t.ssr.code) || (t.label && t.label.trackNumber) || String(t.id);
}

function trackEmergency(t) { return (t && t.ssr && t.ssr.emergency) || null; }
function trackIsIdent(t)   { return !!(t && t.ssr && t.ssr.ident); }

/**
 * The code line of the data block: an emergency always; otherwise the code,
 * but only when a callsign already names the contact (else the code IS the
 * name, on the first line).
 * @returns {{text:string, color:string|null}}
 */
function trackCodeTag(t) {
  const em = trackEmergency(t);
  if (em) return { text: EMERGENCY_TAG[em], color: emergencyColor(em) };
  if (t && t.ssr && t.ssr.code && t.label && t.label.callsign) return { text: t.ssr.code, color: null };
  return { text: '', color: null };
}

// An altitude a transponder did not report is marked, so a controller can
// tell a radar's height estimate or a datalink report from Mode C.
const ALT_MARK = { MODE_C: '', RADAR: '*', DATALINK: 'L' };
const ALT_SOURCE_WORD = { MODE_C: 'Mode C', RADAR: 'radar height', DATALINK: 'datalink' };

/** '180' — hundreds of feet, as a data block writes it. '' when no sensor gives one. */
function altitudeShort(t) {
  const a = t && t.altitude;
  if (!a) return '';
  return String(Math.round(a.ft / 100)).padStart(3, '0') + ALT_MARK[a.source];
}

/** 'FL180' or '4,500 ft', for the track panel. */
function altitudeText(ft, ref) {
  if (!Number.isFinite(ft)) return '—';
  return ref === 'STD'
    ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}`
    : `${Math.round(ft).toLocaleString('en-US')} ft`;
}

/** The track panel's altitude: value and where it came from, or '—'. */
function altitudeLong(t) {
  const a = t && t.altitude;
  if (!a) return '—';
  const word = ALT_SOURCE_WORD[a.source];
  return a.source === 'MODE_C' ? altitudeText(a.ft, a.ref) : `${altitudeText(a.ft, a.ref)} (${word})`;
}

/** An assigned altitude (feet) as a controller writes it: FL above transition, feet below. */
function assignedAltText(ft) {
  const ta = _settings().transitionAltFt ?? 18000;
  return ft >= ta ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : Number(ft).toLocaleString('en-US');
}

/** The type the contact is known as (its flight plan's, or the datalink's), with its display label. */
function typeText(t) {
  if (!t || !t.type) return '';
  const spec = typeof aircraftTypes !== 'undefined' && aircraftTypes && aircraftTypes[t.type];
  return (spec && spec.label) || t.type;
}

/**
 * The data block's second line: altitude with climb/descent rate, when an
 * altitude is known, and ground speed from the track history.
 * @param {number} speedKt  from kinematics()
 * @param {number|null} fpm from verticalFpm(); null when no altitude history
 */
function infoLine(t, speedKt, fpm) {
  const gs = `G${String(Math.round(speedKt || 0)).padStart(3, '0')}`;
  const alt = altitudeShort(t);
  if (!alt) return gs;
  if (fpm != null && Math.abs(fpm) > 100) {
    const vv = String(Math.min(99, Math.round(Math.abs(fpm) / 100))).padStart(2, '0');
    return `${alt}${fpm > 0 ? '↑' : '↓'}${vv} ${gs}`;
  }
  return `${alt} ${gs}`;
}

/**
 * One row of a contact picker: name, code, altitude and track number —
 * enough to tell two contacts apart when they share a code, which is exactly
 * when a controller is asked to pick.
 */
function pickerText(t) {
  if (!t) return '';
  const name = trackName(t);
  const code = t.ssr && t.ssr.code;
  const tn = t.label && t.label.trackNumber;
  return [name + trackNameSuffix(t), code !== name && code, altitudeShort(t), tn !== name && tn]
    .filter(Boolean).join(' · ');
}

/** Whether the contact gets a data block at all: aircraft always; ships and vehicles once named. */
function shouldLabel(t) {
  if (!t) return false;
  if (isAir(t)) return true;
  return !!(t.label && t.label.callsign);
}

/** A tag can name a contact only while nothing better does. */
function tagEditable(t) {
  const source = t && t.label && t.label.source;
  return !source || source === 'TAG';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAir, isSea, isGround, trackName, trackNameSuffix, trackRef, trackEmergency, trackIsIdent,
    trackCodeTag, altitudeShort, altitudeLong, altitudeText, assignedAltText, typeText, infoLine,
    pickerText, shouldLabel, tagEditable, emergencyColor,
  };
}
