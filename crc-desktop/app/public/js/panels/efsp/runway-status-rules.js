'use strict';
import { getEfspFlightData, getEfspRunwayStatus } from './efsp-state.js';

// Runway status on the client (guide §9.7, crc-sync docs/adr/0061, crc-desktop
// docs/adr/0068) — the PURE rules: which runway a Strip uses, what is wrong
// with it, whether a hook-equipped arrival has arresting gear to land on, and
// which runway-status buttons a controller is offered.
//
// Everything here is a MIRROR of crc-sync's src/efsp/runway-status.js and its
// authority tables (authority/positions/civil-atc.js), and proactive only: the server decides every op and stamps
// every NLA inhibit (`strip.nla.inhibited`). These functions exist so a
// controller sees a runway problem on a Strip before the NLA does, and is not
// offered a button that will be refused. A mirror that drifts is worse than
// none, so tests/efsp-runway-status-client.test.mjs requires the crc-sync modules
// and runs both over one table of cases.
//
// An ES module: the browser and node --test both import its named exports.
// The one function that reads client state,
// runwayStatusAlertsFor, takes its lookups as an optional argument so a test
// can pass fixtures.

// ── the mirrored tables ────────────────────────────────────────────────────

// crc-sync's RUNWAY_STATUS_OP_OWNERS (authority/positions/civil-atc.js), verbatim (the drift test
// asserts deep equality).
export const RUNWAY_STATUS_ACTION_OWNERS = {
  CloseRunway:                ['LC'],
  OpenRunway:                 ['LC'],
  BeginRunwayWorks:           ['LC'],
  CompleteRunwayWorks:        ['OPS'],
  CompleteInspection:         ['OPS'],
  RequestRunwayStatus:        ['OPS', 'CD', 'GC', 'AP'], // AP asks, never closes (H18, docs/adr/0075)
  AcceptRunwayRequest:        ['LC'],
  RejectRunwayRequest:        ['LC'],
  ProposeRunwayChange:        ['LC'],
  SelfCoordinateRunwayChange: ['LC'],
  WithdrawRunwayChange:       ['LC'],
  BeginRunwayChange:          ['LC'],
  CompleteRunwayChange:       ['LC'],
  AckRunwayChange:            ['OPS', 'AP'],
  RejectRunwayChange:         ['OPS', 'AP'],
};

// [SOURCE-DEFINED] (docs/adr/0068) — which Strips show a RWY chip
// (L1b-Q5 (a), decisions.md S-W2A; the state set is ours, mirroring runway-status.js's
// RUNWAY_GATED_STATES): every Strip
// that will still use the runway, so the controller sees the problem before
// the NLA does. FINAL is listed although its NLA (-> LANDED) is never held.
export const RUNWAY_STATUS_RUNWAY_STRIP_STATES = {
  DEPARTURE: ['CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW'],
  ARRIVAL: ['INBOUND', 'HANDED_TO_TOWER', 'TRAFFIC_PATTERN', 'FINAL'], // TRAFFIC_PATTERN: crc-sync docs/adr/0126
};

// Where rule 4 (the hook check) applies: an arrival on its way to the runway.
export const RUNWAY_STATUS_GEAR_CHECK_STATES = ['INBOUND', 'HANDED_TO_TOWER', 'TRAFFIC_PATTERN', 'FINAL'];

// [SOURCE-DEFINED] (decisions.md Q40) — the wording of these suspension labels is
// ours. The mirror of runway-status.js's SUSPENSION_LABELS (decisions.md H52: the
// generic "runway works + inspection" suspension).
const RUNWAY_STATUS_SUSPENSION_LABELS = { WORKS: 'works in progress', RUNWAY_CHANGE: 'runway change in progress' };

const RUNWAY_STATUS_GEAR_TYPE_LABELS = { BAK_12: 'BAK-12', E_5: 'E-5', OTHER: 'Gear' };

// ── runway designators and resolution (mirror of runway-status.js) ──────────

/** A runway END designator from free text, or null: '5' -> '05', 'RWY 23' -> '23'. */
export function normalizeRunwayEnd(text) {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const s = String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
  const m = /^(\d{1,2})([LRC])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 36) return null;
  return String(n).padStart(2, '0') + (m[2] || '');
}

function _fsCompactId(text) {
  return String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
}

/**
 * The read view runway-status.js's buildStatusView builds from the inventory,
 * built here from the wire record — whose runway rows carry their own ends
 * and racks (crc-sync getRunwayStatus merges the inventory in).
 */
export function runwayStatusViewOf(record) {
  if (!record) return null;
  const rackEnds = {};
  const runways = [];
  for (const row of record.runways || []) {
    for (const [end, rackId] of Object.entries(row.rackIds || {})) rackEnds[rackId] = end;
    runways.push(row);
  }
  return { activeRunway: record.activeRunway || null, rackEnds, runways };
}

function _fsRunwayOfEnd(view, end) {
  return (view.runways || []).find(r => (r.ends || []).includes(end)) || null;
}

function _fsFlightDataRunwayText(strip, flightData) {
  if (!flightData) return null;
  if (strip.stripType === 'DEPARTURE') return flightData.filed ? flightData.filed.departureRunway : null;
  if (strip.stripType === 'ARRIVAL') return flightData.assigned ? flightData.assigned.landingRunway : null;
  return null;
}

function _fsResolveText(view, text) {
  if (text === null || text === undefined || text === '') return null;
  const end = normalizeRunwayEnd(text);
  if (end) {
    const runway = _fsRunwayOfEnd(view, end);
    if (runway) return { runway, end };
  }
  const compact = _fsCompactId(text);
  const runway = (view.runways || []).find(r => _fsCompactId(r.runwayId) === compact);
  return runway ? { runway, end: null } : null;
}

/**
 * Which runway a Strip uses (decisions.md S-Q25): the target rack, its rack,
 * its flight data's 8A/8B, the Facility's active end, else null (fail open). The same
 * order, normalisation and `source` names as crc-sync's resolveRunwayForStrip,
 * plus the runway row itself so a caller need not look it up again.
 *
 * @returns {{runwayId:string, end:string|null, source:string, runway:object}|null}
 */
export function runwayForStrip(strip, flightData, record, { targetRackId } = {}) {
  const view = runwayStatusViewOf(record);
  if (!strip || !view) return null;
  if (strip.stripType !== 'DEPARTURE' && strip.stripType !== 'ARRIVAL') return null;
  const byRack = (rackId, source) => {
    const end = rackId ? view.rackEnds[rackId] : null;
    const runway = end ? _fsRunwayOfEnd(view, end) : null;
    return runway ? { runwayId: runway.runwayId, end, source, runway } : null;
  };
  const target = byRack(targetRackId, 'TARGET_RACK');
  if (target) return target;
  const rack = byRack(strip.rackId, 'RACK');
  if (rack) return rack;
  const filed = _fsResolveText(view, _fsFlightDataRunwayText(strip, flightData));
  if (filed) return { runwayId: filed.runway.runwayId, end: filed.end, source: 'FLIGHT_DATA', runway: filed.runway };
  if (view.activeRunway) {
    const runway = _fsRunwayOfEnd(view, view.activeRunway);
    if (runway) return { runwayId: runway.runwayId, end: view.activeRunway, source: 'ACTIVE_RUNWAY', runway };
  }
  return null;
}

/** runway-status.js's runwayStatusReason, verbatim: the server's inhibit wording, or null when usable. */
export function runwayStatusReasonFor(runway) {
  if (!runway) return null;
  switch (runway.status) {
    case 'SUSPENDED_WORKS': {
      const kind = runway.suspension && runway.suspension.kind;
      return `runway ${runway.runwayId} suspended — ${RUNWAY_STATUS_SUSPENSION_LABELS[kind] || 'works in progress'}`;
    }
    case 'SUSPENDED_INSPECTION':
      return `runway ${runway.runwayId} suspended — awaiting inspection`;
    case 'CLOSED':
      return `runway ${runway.runwayId} closed`;
    default:
      return null;
  }
}

/** runway-status.js's runwayAdvisoryFor (decisions.md Q30): a Strip queued for an end that is not the active one. */
export function runwayAdvisoryFor(strip, record) {
  const view = runwayStatusViewOf(record);
  if (!strip || !view || !view.activeRunway) return null;
  const end = strip.rackId ? view.rackEnds[strip.rackId] : null;
  if (!end || end === view.activeRunway) return null;
  return `queued for inactive runway ${end}`;
}

// ── rule 4: the hook check ─────────────────────────────────────────────────

function _fsGearText(gear) {
  const type = RUNWAY_STATUS_GEAR_TYPE_LABELS[gear.type] || gear.type;
  return `${type} ${gear.end} end ${String(gear.state).replace(/_/g, ' ')}`;
}

/**
 * Guide §9.7 rule 4: a hook-equipped arrival (`3F`, flightData.military.hookRequired)
 * onto a runway with no usable arresting gear. Computed, never stored: it is
 * derived from two records that already broadcast whole (the flight data and the runway
 * status), so it grows no record, alert type or message (docs/adr/0068).
 *
 * decisions.md H57 (L1b-Q1 (a)): it fires ONLY when gear is configured. No
 * inventory — Incirlik ships `arrestingGear: []` (H17: DCS simulates no wires)
 * — is no data, and no data never alerts. So on the shipped config this never
 * fires; it is correct the day gear data exists.
 *
 * [SOURCE-DEFINED]: every gear on the PAVEMENT counts (either end), and only
 * `UP` is usable (`DOWN` and `OUT_OF_SERVICE` are not). The narrower reading —
 * only gear serving the landing end — is ADR 0068's alternative.
 *
 * @returns {null | { text: 'HOOK', reason: string }}
 */
export function gearMismatchFor(flightData, runway) {
  if (!flightData || !flightData.military || flightData.military.hookRequired !== true) return null;
  if (!runway) return null;
  const gear = Array.isArray(runway.arrestingGear) ? runway.arrestingGear : [];
  if (gear.length === 0) return null;
  if (gear.some(g => g && g.state === 'UP')) return null;
  return {
    text: 'HOOK',
    reason: `Hook required: no arresting gear is rigged on runway ${runway.runwayId} (SOURCE practice). ${gear.map(_fsGearText).join(', ')}.`,
  };
}

// ── the Strip's chips ─────────────────────────────────────────────────────

function _fsRwyChipText(resolved, status) {
  const code = status === 'CLOSED' ? 'CLSD' : status === 'SUSPENDED_INSPECTION' ? 'INSP' : 'SUSP';
  return `RWY ${resolved.end || resolved.runwayId} ${code}`;
}

/** A reason SENTENCE naming the runway, what is wrong with it and what clears it. */
function _fsRwyReason(runway, strip) {
  const id = runway.runwayId;
  let sentence;
  if (runway.status === 'CLOSED') {
    sentence = `Runway ${id} is closed; it reopens when LC opens it.`;
  } else if (runway.status === 'SUSPENDED_WORKS') {
    sentence = `Runway ${id} is suspended for works; it reopens when OPS completes the works and signs off the inspection.`;
  } else {
    const after = runway.suspension && runway.suspension.kind === 'RUNWAY_CHANGE' ? ' after the runway change' : '';
    sentence = `Runway ${id} is suspended awaiting inspection${after}; it reopens when OPS signs off the inspection.`;
  }
  if (strip.stripType === 'ARRIVAL' && strip.state === 'FINAL') sentence += ' Landing is an observation and is not held.';
  return sentence;
}

/**
 * The runway-status alerts for one Strip, in strip-view.js _stripAlerts's shape
 * (`{key, text, tone, legacy, reason}`); strip-view.js calls this through the
 * wave-2 hook line and draws a chip per alert (keys `rwy`, `gear`).
 *
 * - `rwy`, tone bad: the Strip's runway is not OPEN (Q5's states).
 * - `rwy`, tone attn: the runway is OPEN but the Strip is queued for an end
 *   that is not the active one (decisions.md Q30).
 * - `gear`, tone bad: rule 4, gearMismatchFor.
 *
 * Nothing for OVERFLIGHT/MISSION, a DROPPED Strip, a Facility with no record,
 * or a runway that cannot be resolved (fail open: a false RWY on a quiet board
 * teaches controllers to ignore it). When the server's own NLA inhibit already
 * names the same runway, the chip stays but its reason is null, so the Strip
 * never says the same thing twice (the NLA's reason line says it).
 */
export function runwayStatusAlertsFor(strip, lookups) {
  const out = [];
  if (!strip || strip.state === 'DROPPED') return out;
  if (strip.stripType !== 'DEPARTURE' && strip.stripType !== 'ARRIVAL') return out;
  const runwayStatusFor = (lookups && lookups.runwayStatusFor) || getEfspRunwayStatus;
  const flightDataFor = (lookups && lookups.flightDataFor) || getEfspFlightData;
  const record = runwayStatusFor(strip.facilityId);
  if (!record) return out;
  const flightData = strip.flightDataId ? flightDataFor(strip.flightDataId) : null;
  const resolved = runwayForStrip(strip, flightData, record);
  if (!resolved) return out;
  const runway = resolved.runway;

  const chipStates = RUNWAY_STATUS_RUNWAY_STRIP_STATES[strip.stripType] || [];
  if (chipStates.includes(strip.state)) {
    if (runway.status && runway.status !== 'OPEN') {
      const inhibited = strip.nla && strip.nla.inhibited;
      const duplicate = typeof inhibited === 'string' && inhibited.includes(`runway ${runway.runwayId}`);
      out.push({
        key: 'rwy', tone: 'bad', legacy: 'efsp-rwy-indicator',
        text: _fsRwyChipText(resolved, runway.status),
        reason: duplicate ? null : _fsRwyReason(runway, strip),
      });
    } else {
      const advisory = runwayAdvisoryFor(strip, record);
      if (advisory) {
        const end = resolved.end;
        out.push({
          key: 'rwy', tone: 'attn', legacy: 'efsp-rwy-indicator',
          text: `RWY ${end} INACT`,
          reason: `Queued for inactive runway ${end}; the active runway is ${record.activeRunway}. Moving the Strip to the ${record.activeRunway} rack clears this.`,
        });
      }
    }
  }

  if (strip.stripType === 'ARRIVAL' && RUNWAY_STATUS_GEAR_CHECK_STATES.includes(strip.state)) {
    const mismatch = gearMismatchFor(flightData, runway);
    if (mismatch) out.push({ key: 'gear', tone: 'bad', legacy: 'efsp-gear-indicator', text: mismatch.text, reason: mismatch.reason });
  }
  return out;
}

/**
 * What the Strip's runway-status chips depend on, as a string for bay-view.js's
 * render signature: the Strip is rebuilt when it changes. Runway status is not
 * on the Strip, and the re-stamped `nla` board-delta reaches the client before
 * the runway-status delta, so without this the chip would lag a whole change.
 */
export function runwayStatusSignatureFor(strip) {
  const record = strip ? getEfspRunwayStatus(strip.facilityId) : null;
  // The Facility's runway facts any chip may read (status, suspension kind,
  // active end, gear), plus this Strip's own derived alerts.
  const field = record
    ? `${record.activeRunway || '-'}:` + (record.runways || []).map(r => `${r.runwayId}=${r.status}/${(r.suspension && r.suspension.kind) || ''}/${(r.arrestingGear || []).map(g => g.state).join('+')}`).join(';')
    : '';
  return field + '#' + runwayStatusAlertsFor(strip).map(a => `${a.key}/${a.tone}/${a.text}/${a.reason || ''}`).join(',');
}

// ── the panel's buttons ───────────────────────────────────────────────────

function _fsOwns(positionId, kind) {
  return (RUNWAY_STATUS_ACTION_OWNERS[kind] || []).includes(positionId);
}

function _fsOpenChange(change) {
  return !!change && ['PROPOSED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INSPECTION'].includes(change.state);
}

/**
 * The runway-status actions this controller may take, given the Positions they
 * hold at the record's Facility — airspace-panel.js's airspaceActionsFor
 * shape. One entry per (acting Position, op): an action is always sent AS one
 * Position (D21), so a controller holding OPS and AP sees one Ack for each.
 *
 * [SOURCE-DEFINED] (docs/adr/0068) — the button labels (CLOSE, WORKS, WRK DONE,
 * INSP OK, ACCEPT, REJECT, REQ CLS, REQ WRKS, REQ OPEN, CHG RWY, SELF CHG, ACK,
 * WITHDRAW, BEGIN, COMPLETE, OPEN) are ours, not the guide's.
 *
 * Mirrors RUNWAY_STATUS_OP_OWNERS (decisions.md H18/S-L1b: LC closes, opens and
 * begins works; everyone else asks) and the store's preconditions. Two config
 * values a record without `runwayChangeAcknowledgers` /
 * `inspectionAuthorityPositionId` does not carry fall back to the authority
 * table's owners (the owners-table fallback): the acknowledger set before a
 * change is proposed (AckRunwayChange's owners) and the inspection authority
 * (CompleteInspection's owners). Both equal Incirlik's config
 * (docs/wip/L1b.md, Findings). Both fields are on the wire now; dropping the
 * fallback is a later UI lane's (S-L26), not a comment change.
 *
 * @returns {{positionId:string, kind:string, label:string, title:string,
 *   runwayId?:string, action?:string, toEnds?:string[], needs?:'reason'|'toEnd'}[]}
 */
export function runwayStatusActionsFor(record, signedOnPositionIds) {
  const signedOn = [...new Set(signedOnPositionIds || [])];
  const out = [];
  if (!record || signedOn.length === 0) return out;
  const as = (kind, extra) => {
    for (const positionId of signedOn) {
      if (_fsOwns(positionId, kind)) out.push({ positionId, kind, ...extra, title: `as ${positionId} — ${extra.title}` });
    }
  };
  const holdsTower = signedOn.some(p => _fsOwns(p, 'CloseRunway'));

  for (const runway of record.runways || []) {
    const id = runway.runwayId;
    const request = runway.pendingRequest;
    if (runway.status === 'OPEN') {
      as('CloseRunway', { runwayId: id, label: 'CLOSE', needs: 'reason', title: `close runway ${id}` });
      as('BeginRunwayWorks', { runwayId: id, label: 'WORKS', title: `suspend runway ${id} for works` });
    }
    if (runway.status === 'CLOSED') as('OpenRunway', { runwayId: id, label: 'OPEN', title: `open runway ${id}` });
    if (runway.status === 'SUSPENDED_WORKS') {
      as('CompleteRunwayWorks', { runwayId: id, label: 'WRK DONE', title: `works on runway ${id} complete — it then awaits the inspection` });
    }
    if (runway.status === 'SUSPENDED_INSPECTION') {
      as('CompleteInspection', { runwayId: id, label: 'INSP OK', title: `runway ${id} inspected — reopen it` });
    }
    if (request) {
      as('AcceptRunwayRequest', { runwayId: id, label: 'ACCEPT', title: `accept ${request.requestedPositionId}'s request (${request.action}) for runway ${id}` });
      as('RejectRunwayRequest', { runwayId: id, label: 'REJECT', needs: 'reason', title: `reject ${request.requestedPositionId}'s request (${request.action}) for runway ${id}` });
    } else if (!holdsTower) {
      // Tower does it directly; asking itself would be noise.
      if (runway.status === 'OPEN') {
        as('RequestRunwayStatus', { runwayId: id, action: 'CLOSE', label: 'REQ CLS', title: `ask LC to close runway ${id}` });
        as('RequestRunwayStatus', { runwayId: id, action: 'WORKS', label: 'REQ WRKS', title: `ask LC to suspend runway ${id} for works` });
      }
      if (runway.status === 'CLOSED') {
        as('RequestRunwayStatus', { runwayId: id, action: 'OPEN', label: 'REQ OPEN', title: `ask LC to open runway ${id}` });
      }
    }
  }

  const change = record.runwayChange;
  if (!_fsOpenChange(change)) {
    const toEnds = [];
    for (const runway of record.runways || []) {
      if (runway.status === 'CLOSED') continue;
      for (const end of runway.ends || []) if (end !== record.activeRunway) toEnds.push(end);
    }
    if (toEnds.length) {
      as('ProposeRunwayChange', { label: 'CHG RWY', needs: 'toEnd', toEnds, title: 'propose a runway change' });
      const acknowledgers = RUNWAY_STATUS_ACTION_OWNERS.AckRunwayChange;
      if (holdsTower && acknowledgers.every(p => signedOn.includes(p))) {
        as('SelfCoordinateRunwayChange', { label: 'SELF CHG', needs: 'toEnd', toEnds, title: `change the runway, acknowledging as ${acknowledgers.join(' and ')} yourself` });
      }
    }
  } else {
    const acks = change.acks || {};
    const acknowledgers = change.acknowledgers || [];
    if (change.state === 'PROPOSED') {
      for (const p of acknowledgers) {
        if (signedOn.includes(p) && acks[p] === null && _fsOwns(p, 'AckRunwayChange')) {
          out.push({ positionId: p, kind: 'AckRunwayChange', label: 'ACK', title: `as ${p} — acknowledge the change to ${change.toRunwayId}` });
        }
      }
    }
    if (change.state === 'PROPOSED' || change.state === 'ACKNOWLEDGED') {
      for (const p of acknowledgers) {
        if (signedOn.includes(p) && _fsOwns(p, 'RejectRunwayChange')) {
          out.push({ positionId: p, kind: 'RejectRunwayChange', label: 'REJECT', needs: 'reason', title: `as ${p} — reject the change to ${change.toRunwayId}` });
        }
      }
      as('WithdrawRunwayChange', { label: 'WITHDRAW', title: `withdraw the change to ${change.toRunwayId}` });
    }
    if (change.state === 'ACKNOWLEDGED') as('BeginRunwayChange', { label: 'BEGIN', title: `begin the change to ${change.toRunwayId}` });
    if (change.state === 'IN_PROGRESS') as('CompleteRunwayChange', { label: 'COMPLETE', title: `complete the change to ${change.toRunwayId} — the runway then awaits inspection` });
  }
  return out;
}

/** What a runway-status refusal is about, for the refusal banner: `runway 05/23`, else the Facility. */
export function runwayStatusSubjectFor(msgOrOp) {
  const m = msgOrOp || {};
  const runwayId = m.runwayId || (m.op && m.op.runwayId);
  if (runwayId) return `runway ${runwayId}`;
  const to = m.toRunwayId || (m.op && m.op.toRunwayId);
  if (to) return `runway change to ${to}`;
  return m.facilityId ? `${m.facilityId} runway status` : 'runway status';
}
