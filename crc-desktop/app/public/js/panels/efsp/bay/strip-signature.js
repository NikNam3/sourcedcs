'use strict';
import { _resolveActingPositionId } from './dispatch.js';
import { getLatestTrack } from '../../../picture.js';
import { getEfspAirspace, getEfspCorrelationForStrip, getEfspFlightData, getEfspObligation, marsaForStrip, otherLiveStripsForFlightData, surveillanceHintsForStrip } from '../efsp-state.js';
import { getActingPositions } from '../efsp-ws.js';
import { isMarsaHighlighted } from '../marsa-badge.js';
import { arSignatureFor } from '../ato-strip.js';
import { carrierSignatureFor } from '../carrier-panel.js';
import { stereoRoutesCacheKey } from '../efsp-stereo-routes.js';
import { _stripAlerts, tofiExitSignatureFor } from '../strip-view.js';
import { efspArrivalFor } from '../efsp-arrivals.js';
import { runwayStatusSignatureFor } from '../runway-status-rules.js';
import { trackRef } from '../../../track-label.js';
import { _refusalForStrip } from './block-edit.js';

// The render signature (DESK-SPLIT, split out of bay-view.js): what the reconciler compares to decide a Strip element is stale.
// It reads strip-view.js's alerts, so it lives apart from strip-element.js (which strip-view.js imports): the Bay renderer
// stamps `el.dataset.sig` after building an element.

/**
 * Everything a Strip RENDERS that does not live on the Strip record, as one
 * short string the reconciler can compare.
 *
 * `rev` is the Strip's own optimistic-concurrency counter and it moves only
 * when a Mutation changes THAT Strip. _buildStripEl reads a great deal more
 * than that, all of it keyed somewhere else and all of it able to change while
 * `rev` stands still (lane 3's F-305, measured on six separate surfaces):
 *
 *   strip.nla      what pressing the NLA would do right now. crc-sync moves it
 *                  when Position staffing or a clock deadline changes, and
 *                  deliberately does NOT bump `rev` to say so — `rev` is
 *                  concurrency control, and bumping it outside a Mutation
 *                  would invalidate every controller's in-flight edit.
 *   flight data    every Block value, and flightData.tofi.separationRegime, which is
 *                  what the TOFI exit gate reads. A regime set on the ATC-side
 *                  Strip left the MRU's "Accept TOFI Exit" disabled forever.
 *   siblings       the +N shared-flight-data badge is computed from OTHER Strips.
 *   obligation     §4.6.1's alerts live in their own store. An OVERDUE
 *                  obligation that only appears once the controller happens to
 *                  touch that Strip is not an alarm.
 *   MARSA          the relation and rule 5's participant highlight.
 *   correlation    §6.6's badge, and the Bind… button that comes with it — so
 *                  on a fresh Strip the bind popover could not be opened at all.
 *   airspace       a range controller activates and returns an airspace
 *                  without touching any Strip.
 *   the refusal    F-103's Strip-level marker is panel chrome (efsp-panel.js's
 *                  getCurrentEfspRefusal) and moves on its own.
 *
 * The answer for client-local state was already established — selection and
 * expansion are stamped on the element so the reconciler can see them. This is
 * that answer generalized rather than a sixth special case, and it is a
 * signature rather than a full rebuild because guide §7.5.4 and defect D6
 * require keyed reconciliation: a rebuild destroys in-progress work.
 *
 * Cheap on purpose — it runs for every Strip on every board delta. Every line
 * is a field read or a Map lookup bar the sibling walk, which _buildStripEl
 * already does once per Strip anyway.
 */
export function _stripRenderSignature(strip) {
  const parts = [];

  // `undefined` (a record from a server that does not compute it) and `null`
  // (this State has no NLA at all) are different answers and must compare
  // differently.
  parts.push('nla:' + (strip.nla === undefined ? '?' : JSON.stringify(strip.nla)));
  // Which Position the controller is acting as decides which controls render.
  parts.push('act:' + (_resolveActingPositionId(strip) || ''));

  const flightData = getEfspFlightData(strip.flightDataId);
  parts.push('flightData:' + (flightData ? flightData.rev : ''));
  parts.push('stereo:' + stereoRoutesCacheKey()); // Block 9F's options (docs/adr/0073)

  const siblings = otherLiveStripsForFlightData(strip.flightDataId, strip.stripId);
  // Not just the count: the badge's title names each sibling's Facility,
  // Position and strip type, and a sibling that moves desk changes it.
  parts.push('sib:' + siblings.map(s => `${s.stripId}/${s.facilityId || '?'}/${s.ownerPositionId}/${s.stripType}`).sort().join(','));

  const obligation = getEfspObligation(strip.stripId);
  parts.push('obl:' + (obligation ? `${obligation.obligationType}/${obligation.severity}` : ''));

  const relation = marsaForStrip(strip);
  parts.push('mrs:' + (relation
    ? `${relation.marsaId}/${relation.rev}/${relation.state}/${relation.rendezvousAt ? 1 : 0}/${relation.voidedBy || ''}`
    : ''));
  parts.push('mhl:' + (isMarsaHighlighted(strip.stripId) ? 1 : 0));
  parts.push('car:' + carrierSignatureFor(strip)); // crc-sync docs/adr/0074 — a Case change moves every carrier Strip's derived fields
  parts.push('tx:' + tofiExitSignatureFor(strip)); // UI-A U8 — the mission line's state decides CTR's primary action
  parts.push('ar:' + arSignatureFor(strip)); // docs/adr/0071 — the AR join lives on OTHER flights' Strips

  const correlation = getEfspCorrelationForStrip(strip);
  if (!correlation) {
    parts.push('cor:');
  } else {
    // Whether the bound contact is inside THIS controller's coverage is part
    // of what the badge says (`TRK ··`), and coverage is per-controller
    // (crc-sync's docs/adr/0042) — so the track has to be looked at, not just
    // the record. A Map lookup, and Strips are not re-rendered on radar
    // sweeps, so this costs nothing per sweep.
    const track = correlation.trackId ? getLatestTrack(correlation.trackId) : null;
    parts.push('cor:' + [
      correlation.rev, correlation.state, correlation.trackId || '', correlation.matchedBy || '',
      correlation.binding ? 1 : 0,
      (correlation.warning && correlation.warning.kind) || '',
      ((correlation.warning && correlation.warning.candidateTrackIds) || []).join('+'),
      track ? trackRef(track) : '·',
    ].join('/'));
  }

  const entry = strip.airspaceEntry;
  const airspace = entry ? getEfspAirspace(entry.airspaceId) : null;
  parts.push('asp:' + (airspace ? `${airspace.rev}/${airspace.state}` : ''));

  const refusal = _refusalForStrip(strip);
  parts.push('ref:' + (refusal ? `${refusal.at}/${refusal.blockId || ''}` : ''));

  // Whether it carries the just-arrived edge (docs/adr/0057). Only the fact,
  // never the flash: marking the flash played must not itself rebuild the
  // Strip, or the next render would replay it.
  parts.push('arr:' + (efspArrivalFor(strip.stripId) ? 1 : 0));

  // Every alert chip (conformance, conflict, runway, ordnance, SCRAMBLE, TOFI regime, ATO, ...) is named by what
  // _stripAlerts returns, so the signature is derived from that call rather than from a hand list of its inputs: a
  // new chip is covered the moment _stripAlerts emits it (ARCH-C §3.1, B7). A conflict's countdown is in its text,
  // so a Strip in a conflict still rebuilds each second.
  parts.push('alr:' + _stripAlerts(strip).map(a => `${a.key}/${a.tone}/${a.text}/${a.reason}`).join(','));
  // Runway status (docs/adr/0068): the RWY/HOOK chips read the Facility's runway record, not the Strip.
  parts.push('fld:' + runwayStatusSignatureFor(strip));
  // Surveillance hints (docs/adr/0076) are stated by the server about this Strip, not part of its own
  // record; whether the chip can be accepted also depends on which Position the controller holds (S-L14).
  parts.push('sur:' + surveillanceHintsForStrip(strip).map(h => `${h.kind}/${h.contactPhase}/${h.since}`).join(',')
    + (getActingPositions().includes(strip.ownerPositionId) ? '/m' : ''));

  return parts.join('|');
}

/**
 * Does this already-rendered Strip element differ from what it should be?
 *
 * Every input is an argument rather than read from module state, so the rule
 * can be tested directly — the reconciler that calls it needs a Rack, a Bay
 * and a populated store, and a rule buried inside it is a rule nothing checks.
 *
 * Four ways a Strip goes stale, and only the first is the Strip's own record:
 *  - `rev` moved — somebody changed the Strip.
 *  - selection changed — client-local, does not move `rev`.
 *  - expansion changed — client-local, does not move `rev` either. This one
 *    was missing, so the expand toggle set its state, asked for a re-render,
 *    and the reconciler reused every element unchanged. The button did
 *    nothing visible at all.
 *  - something the Strip RENDERS but does not own changed — the flight data, a
 *    sibling, an obligation, a MARSA relation, a correlation, the airspace,
 *    a refusal, or `strip.nla`. See _stripRenderSignature; this was the same
 *    omission as expansion, six more times over (F-305).
 */
export function _stripElNeedsRebuild(el, wanted, selectedStripId, expandedStripId) {
  const id = el.dataset.stripId;
  if (el.dataset.rev !== String(wanted.rev)) return true;
  if (el.classList.contains('efsp-strip-selected') !== (id === selectedStripId)) return true;
  if ((el.dataset.expanded === '1') !== (id === expandedStripId)) return true;
  if (el.dataset.sig !== _stripRenderSignature(wanted)) return true;
  return false;
}

