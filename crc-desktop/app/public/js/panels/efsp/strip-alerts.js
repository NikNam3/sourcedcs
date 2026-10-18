'use strict';
import { conformanceAlertsForFlightData, tofiRegimeAlertForFlightData, correlatedTrackIdForStrip, conflictAlertsForTrack, conflictName, conflictTag, refuelingAlertText, airspaceEntryAlertsForFlightData, airspaceEntryText } from './efsp-state.js';
import { ordnanceAlertsFor } from './ordnance-advisory.js';
import { scrambleAlertsFor } from './scramble.js';
import { atoAlertsFor } from './ato-strip.js';
import { runwayStatusAlertsFor } from './runway-status-rules.js';
import { settings } from '../../settings.js';

// What a Strip warns about (DESK-SPLIT, split out of strip-view.js): the indicator order and the alert chips _stripAlerts derives.

// docs/adr/0058: nothing is drawn for what is normal. An indicator appears only
// when it has something to say — a warning, or a situation that currently
// applies (MARSA, TOFI, an airspace, other Strips on the flight). A quiet Strip
// has no indicator row at all. Warnings first, so they are always in the same
// place: the left end of the row.
export const INDICATOR_ORDER = ['conflictAlert', 'conf', 'rwy', 'gear', 'ord', 'scram', 'tofiRegime', 'airspaceAlert', 'trk', 'marsa', 'tofi', 'airspace', 'transit', 'timer', 'siblings'];

// Keys whose chips come from _stripAlerts (warnings first, left end of the row). rwy/gear:
// Runway status (docs/adr/0068); ord: hung ordnance (0069); scram: alert/scramble (0070).
export const ALERT_SLOT_KEYS = new Set(['conflictAlert', 'conf', 'rwy', 'gear', 'ord', 'scram', 'tofiRegime', 'airspaceAlert']);

const _pad3 = (n) => String(Math.round(n)).padStart(3, '0');

/** An altitude the way a controller reads it: a flight level at and above transition, feet below. */
function _fmtAlt(ft) {
  const ta = settings.transitionAltFt;
  return ft >= ta ? `FL${_pad3(ft / 100)}` : `${Math.round(ft).toLocaleString('en-US')} ft`;
}

const _fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** This Strip's conformance alerts and conflicts, each as { key, text, tone, reason }. */
export function _stripAlerts(strip) {
  const out = [];
  const trackId = correlatedTrackIdForStrip(strip);
  for (const c of conflictAlertsForTrack(trackId)) {
    // crc-sync names the other aircraft the way it is labelled: its flight's
    // callsign when correlated, else its tag or track number (docs/adr/0059).
    const other = c.otherCallsign;
    // crc-sync's docs/adr/0118: CA between two tracked aircraft, MCI against an untracked one reporting altitude.
    out.push({
      key: 'conflictAlert', tone: 'bad', legacy: `efsp-conflict-alert-indicator efsp-conflict-${conflictTag(c).toLowerCase()}`,
      text: `${conflictName(c)} ${other} ${_fmtClock(c.timeToCpaSec)}`,
      reason: `${c.kind === 'MCI' ? 'Mode C intruder' : 'Conflict'} with ${other} in ${_fmtClock(c.timeToCpaSec)}: closest ${c.minNm} NM / ${c.vertFt} ft.`,
    });
  }
  out.push(...atoAlertsFor(strip)); // docs/adr/0071, §3.10.3 rule 3
  for (const a of conformanceAlertsForFlightData(strip.flightDataId)) {
    // crc-sync's docs/adr/0118: a receiver under MARSA is checked against the refueling block around its tanker.
    if (a.tanker !== undefined) {
      const ar = refuelingAlertText(a);
      if (ar) out.push({ key: 'conf', tone: 'bad', legacy: 'efsp-conf-indicator efsp-conf-refueling', text: ar.text, reason: ar.reason });
      continue;
    }
    if (a.kind === 'HEADING') {
      out.push({ key: 'conf', tone: 'attn', legacy: 'efsp-conf-indicator', text: `HDG ${_pad3(a.actual)}`,
        reason: `Assigned heading ${_pad3(a.assigned)}, tracking ${_pad3(a.actual)}.` });
    } else if (a.kind === 'WRONG_WAY') {
      const down = a.fpm < 0;
      out.push({ key: 'conf', tone: 'bad', legacy: 'efsp-conf-indicator', text: `ALT ${down ? '↓' : '↑'}`,
        reason: `Assigned ${_fmtAlt(a.assigned)}, ${down ? 'descending' : 'climbing'} through ${_fmtAlt(a.altFt)} at ${Math.abs(a.fpm).toLocaleString('en-US')} ft/min.` });
    } else if (a.kind === 'LEVEL_BUST') {
      out.push({ key: 'conf', tone: 'bad', legacy: 'efsp-conf-indicator', text: `BUST ${a.deviationFt > 0 ? '+' : '−'}${Math.abs(a.deviationFt)}`,
        reason: `Reached ${_fmtAlt(a.assigned)}, now at ${_fmtAlt(a.altFt)}.` });
    }
  }
  // docs/adr/0102: the regime waits for the airspace; leaving it or an unknown geometry is said here, never acted on.
  const regimeAlert = tofiRegimeAlertForFlightData(strip.flightDataId);
  if (regimeAlert) {
    const outside = regimeAlert.kind === 'REGIME_OUTSIDE_AIRSPACE';
    out.push({ key: 'tofiRegime', tone: 'attn', legacy: 'efsp-tofi-regime-alert',
      text: outside ? 'OUTSIDE AIRSPACE' : 'ENTRY UNKNOWN',
      reason: outside
        ? 'The flight has left the airspace its separation regime applies in. The regime is unchanged; the MRU decides.'
        : 'The airspace or the contact cannot be placed, so entry is not detected automatically. Mark the flight entered by hand.' });
  }
  // crc-sync docs/adr/0119: inside an ACTIVE airspace with no approved entry. Retracts on leaving or on approval.
  for (const a of airspaceEntryAlertsForFlightData(strip.flightDataId)) {
    out.push({ key: 'airspaceAlert', tone: 'attn', legacy: 'efsp-airspace-entry-alert', text: airspaceEntryText(a),
      reason: `Inside ${a.airspaceName || a.airspaceId} (${a.airspaceType}, active) with no approved entry.` });
  }
  // Wave-2 advisories, each defined in its own file (docs/adr/0068, 0069, 0070).
  out.push(...runwayStatusAlertsFor(strip));
  out.push(...ordnanceAlertsFor(strip));
  out.push(...scrambleAlertsFor(strip));
  return out;
}

// WP7 (crc-sync docs/adr/0071, ato-strip.js): the ATO's Mode 3 conflict is an
// alert chip after the wave-2 advisories; the AR join a quiet badge after MARSA.
INDICATOR_ORDER.splice(INDICATOR_ORDER.indexOf('trk'), 0, 'ato');
INDICATOR_ORDER.splice(INDICATOR_ORDER.indexOf('marsa') + 1, 0, 'ar');
// docs/adr/0076 (guide §10.3, §10.4): surveillance informs, the controller advances.
// 'hint' is the suggestion chip, 'stale' the low-severity staleness indication.
// Both are quiet badges beside the correlation one, not alert chips: neither
// raises the Strip's attention styling or a reason line, and neither moves it.
INDICATOR_ORDER.splice(INDICATOR_ORDER.indexOf('trk') + 1, 0, 'hint', 'stale');
ALERT_SLOT_KEYS.add('ato');
