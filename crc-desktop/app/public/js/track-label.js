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

/** An assigned altitude block ({lowFt, highFt}, docs/adr/0091) as 'FL220-FL240'. */
function assignedBlockText(block) {
  return `${assignedAltText(block.lowFt)}-${assignedAltText(block.highFt)}`;
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

// ── The ATC (STARS) data block — crc-sync's docs/adr/0088 ────────────────
//
// A contact crc-sync sends with `scheme: 'ATC'` is drawn in the STARS layout:
// what it says depends on the controller's relation to it (atc-scope.js
// works that out), and the text itself is written here, like every other
// string a contact is shown with. Differences from the tactical block, all
// deliberate (STARS's own conventions):
//   - altitude is Mode C only, three digits, with no `*`/`L` mark and no climb
//     digits (a STARS `*` means pilot-reported);
//   - ground speed is in tens of knots (`28`, not `G280`), time-shared with
//     the aircraft type;
//   - emergencies are two letters (`EM`/`RF`/`HJ`);
//   - an assigned altitude carries a trend arrow toward it: `A060↓ H250`.

const ATC_EMERGENCY_TAG = { HIJACK: 'HJ', RADIO: 'RF', GENERAL: 'EM' };

/** The ATC scheme's emergency text for a contact, or '' (two letters, red on line 0). */
function atcEmergencyTag(t) {
  const em = trackEmergency(t);
  return em ? ATC_EMERGENCY_TAG[em] || '' : '';
}

/** '120' — Mode C in hundreds of feet. '' for anything a transponder did not report. */
function atcAltitude(t) {
  const a = t && t.altitude;
  if (!a || a.source !== 'MODE_C' || !Number.isFinite(a.ft)) return '';
  return String(Math.max(0, Math.round(a.ft / 100))).padStart(3, '0');
}

/** '28' — ground speed in tens of knots. */
function atcSpeed(speedKt) {
  return String(Math.max(0, Math.round((speedKt || 0) / 10))).padStart(2, '0');
}

/**
 * 'A060↓ H250' — the flight's assigned altitude, with a trend arrow from its
 * current altitude toward it (7110.65 §5-14-4d), and its assigned heading.
 * The heading is what the controller typed, already magnetic; nothing here
 * converts a bearing. '' when nothing is assigned.
 * @param {{altFt:number|null, hdg:number|null}} assigned
 * @param {number|null} currentFt
 */
function atcAssignedText(assigned, currentFt) {
  if (!assigned) return '';
  const parts = [];
  if (assigned.altBlock) {
    const { lowFt, highFt } = assigned.altBlock;
    let trend = '';
    if (Number.isFinite(currentFt)) {
      if (currentFt < lowFt - 200) trend = '↑';
      else if (currentFt > highFt + 200) trend = '↓';
    }
    parts.push(`A${String(Math.round(lowFt / 100)).padStart(3, '0')}B${String(Math.round(highFt / 100)).padStart(3, '0')}${trend}`);
  } else if (Number.isFinite(assigned.altFt)) {
    let trend = '';
    if (Number.isFinite(currentFt) && Math.abs(assigned.altFt - currentFt) > 200) trend = assigned.altFt > currentFt ? '↑' : '↓';
    parts.push('A' + String(Math.round(assigned.altFt / 100)).padStart(3, '0') + trend);
  }
  if (Number.isFinite(assigned.hdg)) parts.push('H' + String(Math.round(assigned.hdg) % 360).padStart(3, '0'));
  return parts.join(' ');
}

/** The type as a STARS block writes it: the flight plan's own designator (`F16`), never a display label. */
function atcType(t) {
  return (t && t.type) || '';
}

/**
 * The lines of an ATC data block, each a list of segments `{text, color, blink}`.
 * `color: null` means the block's own colour. The caller (geojson.js) flattens
 * them into the map layer; nothing here knows about MapLibre.
 *
 * @param {object} t  the wire track
 * @param {object} v  atc-scope.js's view: { kind: 'FDB'|'PDB'|'LDB'|'NONE',
 *   line0: [{text,color,blink}], l1Suffix: [{text,color,blink}], recipient: string, coast: boolean }
 * @param {{speedKt:number, assigned?:object, typePhase?:boolean}} info
 *   typePhase: the half of the time-share that shows the type instead of the speed
 * @returns {Array<Array<{text:string,color:string|null,blink:boolean}>>}
 */
function atcBlockLines(t, v, info = {}) {
  const seg = (text, color = null, blink = false) => ({ text, color, blink });
  const lines = [];
  const line0 = [];
  for (const item of v.line0 || []) {
    if (line0.length) line0.push(seg(' '));
    line0.push(seg(item.text, item.color || null, !!item.blink));
  }
  if (line0.length) lines.push(line0);
  if (v.kind === 'NONE') return lines;

  const ident = trackIsIdent(t);
  const alt = v.coast ? 'CST' : atcAltitude(t);
  const gs = atcSpeed(info.speedKt);

  if (v.kind === 'LDB') {
    const label = t.label || {};
    const first = label.source === 'TAG' && label.tag ? label.tag : ((t.ssr && t.ssr.code) || '');
    const l1 = [seg(first)];
    if (ident) l1.push(seg(' '), seg('ID', null, true));
    lines.push(l1);
    if (alt) lines.push([seg(alt)]);
    return lines;
  }

  if (v.kind === 'PDB') {
    const l = [seg(`${alt || '   '} ${gs}`)];
    if (ident) l.push(seg(' '), seg('ID', null, true));
    lines.push(l);
    return lines;
  }

  // FDB
  const l1 = [seg(trackName(t) + trackNameSuffix(t))];
  for (const item of v.l1Suffix || []) l1.push(seg(' '), seg(item.text, item.color || null, !!item.blink));
  lines.push(l1);
  const l2 = [seg(`${alt || '   '} `)];
  if (v.recipient) l2.push(seg(`${v.recipient} `));
  const type = atcType(t);
  if (ident) l2.push(seg('ID', null, true));
  else l2.push(seg(info.typePhase && type ? type : gs));
  lines.push(l2);
  const currentFt = t.altitude && t.altitude.source === 'MODE_C' ? t.altitude.ft : null;
  const asg = atcAssignedText(info.assigned, currentFt);
  if (asg) lines.push([seg(asg)]);
  return lines;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAir, isSea, isGround, trackName, trackNameSuffix, trackRef, trackEmergency, trackIsIdent,
    trackCodeTag, altitudeShort, altitudeLong, altitudeText, assignedAltText, assignedBlockText, typeText, infoLine,
    pickerText, shouldLabel, tagEditable, emergencyColor,
    ATC_EMERGENCY_TAG, atcEmergencyTag, atcAltitude, atcSpeed, atcAssignedText, atcType, atcBlockLines,
  };
}
