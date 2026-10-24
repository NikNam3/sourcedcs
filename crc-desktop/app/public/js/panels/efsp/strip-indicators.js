'use strict';
import { airspaceCoordinateForStrip, airspaceInsideForStrip, getAllEfspAirspaces, getEfspAirspace, getEfspStrip, otherLiveStripsForFlightData, surveillanceHintsForStrip } from './efsp-state.js';
import { coordinateMark, transitMark, transitsOfFlight } from './transit-rules.js';
import { formatZuluHhmm } from '../../format.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { correlationBadgeFor } from './correlation-highlight.js';
import { marsaBadgeFor } from './marsa-badge.js';
import { _resolveActingPositionId, _swallowRepeatAdvance } from './bay/dispatch.js';
import { OBLIGATION_LABELS } from './control-release-rules.js';
import { arJoinFor } from './ato-strip.js';
import { _stripEl } from './strip-dom.js';
import { ALERT_SLOT_KEYS, INDICATOR_ORDER } from './strip-alerts.js';
import { divertChipFor } from './divert-rules.js';

// The indicator slots on a Strip's face (DESK-SPLIT, split out of strip-view.js): standing state, always drawn, lit or dim.

function _indicator(key, text, tone, legacy, title) {
  const node = _stripEl('span', `efsp-ind efsp-ind-${tone}${legacy ? ' ' + legacy : ''}`, text);
  node.dataset.slot = key;
  if (title) node.title = title;
  return node;
}

/**
 * The airspace badge's tone (crc-sync docs/adr/0134, H155 item 4; supersedes ADR 0119's colour rule): amber only while the
 * flight is airborne inside its approved airspace (`inside`, the server's fact) and that airspace is not ACTIVE: activation
 * decides who owns the block (JO 7110.65 para 9-3-1 c, 9-3-4), so the warning matters only while the block is worked
 * unprotected. Grey otherwise (on the ground, en route, approved early; unknown airspace record), with no title.
 */
export function airspaceBadgeTone(airspace, inside, name) {
  const amber = !!(inside && airspace && airspace.state !== 'ACTIVE');
  return { amber, title: amber ? `${name} is ${airspace.state}, not active` : '' };
}

function _litIndicator(strip, key, el, obligation, siblings) {
  if (key === 'trk') {
    const badge = correlationBadgeFor(strip);
    if (!badge) return null;
    if (badge.warned) el.classList.add('efsp-strip-correlation-warned');
    // Correlated and nothing wrong is the normal case: say nothing.
    if (/efsp-correlation-correlated/.test(badge.className) && !badge.warned) return null;
    const tone = /uncorrelated/.test(badge.className) ? 'bad' : (badge.ambiguous || badge.warned) ? 'attn' : 'on';
    return _indicator(key, badge.text, tone, badge.className, badge.title);
  }
  if (key === 'marsa') {
    const badge = marsaBadgeFor(strip);
    if (!badge) return null;
    if (badge.voided) el.classList.add('efsp-strip-marsa-voided');
    if (badge.armed) el.classList.add('efsp-strip-marsa-armed');
    const node = _indicator(key, badge.text, badge.voided ? 'bad' : badge.armed ? 'attn' : 'on', badge.className, badge.title);
    node.dataset.marsaId = badge.marsaId;
    return node;
  }
  if (key === 'tofi') {
    const tofi = strip.tofiCoordination;
    if (!tofi || (tofi.state !== 'INITIATED' && tofi.state !== 'ACTIVE')) return null;
    return _indicator(key, 'TOFI', tofi.state === 'INITIATED' ? 'attn' : 'on', 'efsp-tofi-indicator',
      `TOFI ${tofi.direction.toLowerCase()} with ${tofi.peerPositionId}: ${tofi.state}`);
  }
  if (key === 'airspace') {
    if (!strip.airspaceEntry) return null;
    const airspace = getEfspAirspace(strip.airspaceEntry.airspaceId);
    const name = (airspace && airspace.definition && airspace.definition.name) || strip.airspaceEntry.airspaceId;
    const mhz = strip.airspaceEntry.frequencyMhz;
    const block = strip.airspaceEntry.altitudeBlock;
    // The altitude restriction belongs on the Strip: two aircraft sharing one
    // block are only safe if each controller can see who is held to what.
    const text = [name, mhz ? mhz.toFixed(3) : null, block ? `${block.lowerFt}–${block.upperFt} ft` : null].filter(Boolean).join(' ');
    const { amber, title } = airspaceBadgeTone(airspace, airspaceInsideForStrip(strip), name);
    return _indicator(key, text, amber ? 'attn' : 'on',
      `efsp-airspace-badge${amber ? ' efsp-airspace-badge-unactivated' : ''}`, title);
  }
  if (key === 'timer') {
    if (!obligation) return null;
    const overdue = obligation.severity === 'OVERDUE';
    const named = OBLIGATION_LABELS[obligation.obligationType]; // docs/adr/0101: the two control-invariant obligations
    return _indicator(key, named ? named.label : obligation.obligationType.replace(/_/g, ' '), overdue ? 'bad' : 'attn',
      `efsp-obligation-badge${overdue ? ' efsp-obligation-badge-overdue' : ''}`,
      named ? `${named.title} (${obligation.obligationType} — ${obligation.severity})` : `${obligation.obligationType} — ${obligation.severity}`);
  }
  if (key === 'hint' || key === 'stale') {
    const hints = surveillanceHintsForStrip(strip);
    const h = hints.find(x => x.kind === (key === 'hint' ? 'AIRBORNE_ADVANCE' : 'STALE'));
    if (!h) return null;
    const seen = h.contactPhase === 'AIRBORNE' ? 'detected airborne' : 'detected on the ground';
    if (key === 'stale') {
      const mins = Math.max(1, Math.round((h.afterSec || 120) / 60));
      return _indicator(key, 'STALE', 'on', 'efsp-stale-indicator',
        `This Strip says ${h.stripState}, but the aircraft is ${seen}, and has been for over ${mins} min. Surveillance informs; update the Strip if it is wrong.`);
    }
    // The suggestion chip: one input, and the input is the controller's own
    // SetState — the ordinary path, every rule on it applying. Only a Position
    // that holds the Strip can accept; for anyone else it is information.
    const acting = getActingPositions();
    const mine = acting.includes(strip.ownerPositionId);
    const node = _indicator(key, 'AIRBORNE? ▸', 'attn', 'efsp-surveillance-chip',
      `Aircraft ${seen}; the Strip says ${h.stripState}. ${mine ? 'Click to advance it to Airborne.' : `${strip.ownerPositionId} holds this Strip.`}`);
    if (mine) {
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.dataset.toState = h.toState;
      const accept = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (_swallowRepeatAdvance()) return;
        const live = getEfspStrip(strip.stripId) || strip;
        const actingPositionId = _resolveActingPositionId(live);
        if (!actingPositionId) return; // handed away since the chip was drawn
        sendEfspMutation(actingPositionId, live, { kind: 'SetState', toState: h.toState, observedAirborne: true });
      };
      node.addEventListener('click', accept);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') accept(e); });
      node.addEventListener('pointerdown', (e) => e.stopPropagation()); // not the start of a drag
    }
    return node;
  }
  if (key === 'ar') {
    // The AR join (docs/adr/0071): not MARSA, never a warning — tone 'on'.
    const join = arJoinFor(strip);
    return join ? _indicator(key, join.text, 'on', 'efsp-ar-badge', join.title) : null;
  }
  if (key === 'siblings') {
    if (siblings.length === 0) return null;
    // A sortie that crosses a Facility boundary leaves several live Strips on
    // one flight. Advisory only; the title names each (crc-sync docs/adr/0054).
    return _indicator(key, `+${siblings.length}`, 'on', 'efsp-shared-flight-data-badge',
      `this flight also has ${siblings.length === 1 ? 'a Strip' : `${siblings.length} Strips`} at ${siblings.map(s => `${s.facilityId || '?'}/${s.ownerPositionId} (${s.stripType})`).join(', ')}`);
  }
  return null;
}

/** The indicator row, or null when there is nothing to say (docs/adr/0058). */
export function _buildIndicatorSlots(strip, el, obligation, alerts) {
  const slots = _stripEl('div', 'efsp-strip-slots');
  const siblings = otherLiveStripsForFlightData(strip.flightDataId, strip.stripId);
  for (const key of INDICATOR_ORDER) {
    if (ALERT_SLOT_KEYS.has(key)) {
      for (const a of alerts.filter(x => x.key === key)) slots.appendChild(_indicator(key, a.text, a.tone, a.legacy, a.reason));
      continue;
    }
    if (key === 'transit') {
      // crc-sync docs/adr/0128 (H151 MT-Q7 b): grey only, one per airspace this flight has a transit of.
      for (const { airspace, transit } of transitsOfFlight(strip.flightDataId, getAllEfspAirspaces())) {
        const mark = transitMark(airspace, transit);
        const node = _indicator(key, mark.text, 'on', `efsp-transit-mark efsp-transit-${mark.state.toLowerCase()}`, mark.title);
        node.dataset.airspaceId = airspace.airspaceId;
        slots.appendChild(node);
      }
      // crc-sync docs/adr/0136 (H156 MTB-Q3): filed through an active SUA with nothing coordinated yet. Grey, the server's fact.
      for (const airspaceId of airspaceCoordinateForStrip(strip)) {
        const mark = coordinateMark(getEfspAirspace(airspaceId), airspaceId);
        const node = _indicator(key, mark.text, 'on', 'efsp-coordinate-mark', mark.title);
        node.dataset.airspaceId = airspaceId;
        slots.appendChild(node);
      }
      continue;
    }
    const node = _litIndicator(strip, key, el, obligation, siblings);
    if (node) slots.appendChild(node);
  }
  // A return leg's archived annotations: only drawn when there are some.
  if (strip.previousLeg && Object.keys(strip.previousLeg.annotations || {}).length > 0) {
    const count = Object.keys(strip.previousLeg.annotations).length;
    slots.appendChild(_indicator('prevLeg', `${strip.previousLeg.stripType} ×${count}`, 'on', 'efsp-previous-leg-badge',
      Object.entries(strip.previousLeg.annotations)
        .map(([blockId, cell]) => `${blockId}: ${(cell.entries || []).map(e => e.value).join(' / ')}`).join('\n')));
  }
  // The latest divert: the destination it replaced struck through, the new one beside it (crc-sync docs/adr/0111 §4).
  const divert = divertChipFor(strip, formatZuluHhmm);
  if (divert) {
    const chip = _indicator('divert', '', 'on', 'efsp-divert-chip', divert.title);
    if (divert.from) chip.appendChild(_stripEl('s', 'efsp-divert-old', divert.from));
    chip.appendChild(document.createTextNode(` ${divert.to}`));
    slots.appendChild(chip);
  }
  return slots.children && slots.children.length === 0 ? null : slots;
}

// ── Reasons ────────────────────────────────────────────────────────────────
