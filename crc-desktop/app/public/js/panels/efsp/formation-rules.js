'use strict';

// Formation Split / Join, the pure half (crc-sync docs/adr/0099): who may, on which Strips, and the typed forms.
// No DOM and no sockets, so the popover (bay/popovers/formation.js), the `.split` / `.join` dot-commands
// (panel/dot-commands.js) and the unit tests share one set of rules.
//
// The three tables below are mirrors of crc-sync's authority registry (`formationEligibility`, the FORMATION_OP_KINDS
// grant); crc-desktop/tests/efsp-formation-rules.test.mjs holds them to the server. The server is the gate: this only
// decides what to offer and catches a typo where the controller is looking.

/** Strip types whose live Strips may split or join (H100 Q-SJ2). Never MISSION or the carrier Strips. */
export const FORMATION_STRIP_TYPES = ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'];

/** Per strip type, the states a split needs no assignment in (the Strip is on the ground, not the track). */
export const FORMATION_GROUND_STATES = {
  DEPARTURE: ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW'],
  ARRIVAL: ['LANDED', 'TAXI_IN'],
  OVERFLIGHT: [],
};

/** Every ATC Position of the civil-ATC and Incirlik-military families (H100 Q-SJ3 c). Not tactical, not carrier. */
export const FORMATION_POSITIONS = ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR', 'PAR'];

const CALLSIGN_RE = /^[A-Z0-9]{1,7}$/;

export const ASSIGNMENT_KINDS = ['HEADING', 'SPEED', 'ALTITUDE'];
export const ASSIGNMENT_LABELS = { HEADING: 'Heading', SPEED: 'Speed', ALTITUDE: 'Altitude' };

function _liveStrip(strip) {
  return !!strip && strip.state !== 'DROPPED' && FORMATION_STRIP_TYPES.includes(strip.stripType);
}

/** True when the Strip's state is one of its type's ground states: a split there needs no assignment. */
export function isGroundFormationState(strip) {
  return !!strip && (FORMATION_GROUND_STATES[strip.stripType] || []).includes(strip.state);
}

function _openExchange(strip) {
  const c = strip.coordination;
  const t = strip.tofiCoordination;
  if (c && c.state === 'INITIATED') return 'a coordination proposal is open';
  if (t && t.state === 'INITIATED') return 'a TOFI proposal is open';
  if (t && t.state === 'ACTIVE') return 'the flight is under tactical control';
  return null;
}

/** Whether the Position holds the formation grant and owns the Strip: the menu group's visibility rule. */
export function holdsFormationGrant(strip, actingPositions) {
  return !!strip && FORMATION_POSITIONS.includes(strip.ownerPositionId) && (actingPositions || []).includes(strip.ownerPositionId);
}

/**
 * @returns {{ok:boolean, reason?:string}} may this Strip be offered "Split…": a live IFR Strip, a formation of two or
 *   more aircraft, no open exchange. `reason` is the menu's disabled-because line.
 */
export function splitOffer(strip, flightData) {
  if (!_liveStrip(strip)) return { ok: false, reason: 'not on this kind of Strip' };
  const size = flightData && flightData.identity ? flightData.identity.flightSize : 1;
  if (!Number.isInteger(size) || size < 2) return { ok: false, reason: 'a single aircraft cannot be split' };
  const exchange = _openExchange(strip);
  if (exchange) return { ok: false, reason: exchange };
  return { ok: true };
}

/** The Strips that may be the lead of a join with `joiner`: this Position's, live, another flight, no open exchange. */
export function joinLeadCandidates(joiner, allStrips) {
  return (allStrips || []).filter(s => s.stripId !== joiner.stripId
    && s.facilityId === joiner.facilityId
    && s.ownerPositionId === joiner.ownerPositionId
    && s.flightDataId !== joiner.flightDataId
    && _liveStrip(s)
    && !_openExchange(s));
}

/**
 * @param {object[]} siblings the joiner flight's OTHER live Strips (a replica elsewhere, a mission line): the server
 *   refuses while any exists, so the menu says so rather than offering a control that always fails.
 */
export function joinOffer(strip, allStrips, siblings) {
  if (!_liveStrip(strip)) return { ok: false, reason: 'not on this kind of Strip' };
  const exchange = _openExchange(strip);
  if (exchange) return { ok: false, reason: exchange };
  if (siblings && siblings.length > 0) return { ok: false, reason: 'this flight has another live Strip: resolve it first' };
  if (joinLeadCandidates(strip, allStrips).length === 0) return { ok: false, reason: 'no other Strip of yours to join' };
  return { ok: true };
}

/**
 * One assignment token: `H270` heading, `S250` / `SM.80` speed (knots / Mach), `A120` / `FL240` altitude.
 * @returns {{kind:'HEADING'|'SPEED'|'ALTITUDE', value:string}|null}
 */
export function parseAssignmentToken(raw) {
  const t = String(raw == null ? '' : raw).trim().toUpperCase();
  let m = /^H(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) <= 360 ? { kind: 'HEADING', value: m[1].padStart(3, '0') } : null;
  m = /^S(M0?\.\d{1,2})$/.exec(t);
  if (m) return { kind: 'SPEED', value: m[1] };
  m = /^S(\d{2,3})$/.exec(t);
  if (m) return { kind: 'SPEED', value: m[1] };
  m = /^(FL\d{1,3}|A\d{1,3})$/.exec(t);
  if (m) return { kind: 'ALTITUDE', value: m[1] };
  return null;
}

/** A value typed into the form's one field, for the radio-selected kind. */
export function parseAssignmentValue(kind, raw) {
  const t = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return null;
  if (kind === 'HEADING') {
    const m = /^H?(\d{1,3})$/.exec(t);
    return m && Number(m[1]) <= 360 ? { kind, value: m[1].padStart(3, '0') } : null;
  }
  if (kind === 'SPEED') {
    const m = /^S?(M0?\.\d{1,2}|\d{2,3})$/.exec(t);
    return m ? { kind, value: m[1] } : null;
  }
  if (kind === 'ALTITUDE') return /^(FL\d{1,3}|A\d{1,3}|\d{1,5})$/.test(t) ? { kind, value: t } : null;
  return null;
}

/**
 * `.split <k> <CALLSIGN> [<assignment>] [MARSA]` (args after the verb).
 * @returns {{ok:true, size:number, callsign:string, assignment:object|null, marsaReturn:boolean}|{ok:false, error:string}}
 */
export function parseSplitCommand(args) {
  const usage = '.split <k> <CALLSIGN> <H270|S250|SM.80|A120|FL240> [MARSA]';
  const a = (args || []).filter(x => x !== '');
  if (a.length < 2) return { ok: false, error: `${usage}; on a ground Strip the assignment may be left off` };
  if (!/^\d+$/.test(a[0]) || Number(a[0]) < 1) return { ok: false, error: `${a[0]} is not an aircraft count — ${usage}` };
  const size = Number(a[0]);
  const callsign = a[1].toUpperCase();
  if (!CALLSIGN_RE.test(callsign)) return { ok: false, error: `${callsign} is not a valid callsign — 1-7 alphanumeric characters` };
  let rest = a.slice(2).map(x => x.toUpperCase());
  let marsaReturn = false;
  if (rest.length && rest[rest.length - 1] === 'MARSA') { marsaReturn = true; rest = rest.slice(0, -1); }
  if (rest.length > 1) return { ok: false, error: `too many words — ${usage}` };
  let assignment = null;
  if (rest.length === 1) {
    assignment = parseAssignmentToken(rest[0]);
    if (!assignment) return { ok: false, error: `${rest[0]} is not an assignment — H270 heading, S250 or SM.80 speed, A120 or FL240 altitude` };
  }
  return { ok: true, size, callsign, assignment, marsaReturn };
}

/**
 * Validates a split request against the Strip, and builds the op. The same call serves the popover and the dot-command.
 * @param {{size:number, callsign:string, assignment:?object, marsaReturn?:boolean}} req
 * @param {{strip:object, flightData:?object, liveCallsigns?:string[]}} ctx
 * @returns {{ok:true, op:object}|{ok:false, error:string}}
 */
export function buildSplitOp(req, ctx) {
  const { strip, flightData } = ctx;
  const offer = splitOffer(strip, flightData);
  if (!offer.ok) return { ok: false, error: `cannot split: ${offer.reason}` };
  const n = flightData.identity.flightSize;
  if (!Number.isInteger(req.size) || req.size < 1 || req.size >= n) {
    return { ok: false, error: `the departing part is 1 to ${n - 1} aircraft of ${n}` };
  }
  const callsign = String(req.callsign || '').trim().toUpperCase();
  if (!callsign) return { ok: false, error: 'type the departing part\'s callsign' };
  if (!CALLSIGN_RE.test(callsign)) return { ok: false, error: `${callsign} is not a valid callsign — 1-7 alphanumeric characters` };
  const lead = String((flightData.identity && flightData.identity.callsign) || '').toUpperCase();
  if (callsign === lead) return { ok: false, error: `${callsign} is the formation's own callsign` };
  if ((ctx.liveCallsigns || []).map(c => String(c).toUpperCase()).includes(callsign)) {
    return { ok: false, error: `${callsign} is already a live callsign` };
  }
  const assignment = req.assignment || null;
  if (!assignment && !isGroundFormationState(strip)) {
    return { ok: false, error: 'a heading, speed or altitude assignment is required for the departing part' };
  }
  return {
    ok: true,
    op: { kind: 'SplitFormation', size: req.size, callsign, assignment, marsaReturn: req.marsaReturn === true },
  };
}

/** The `JoinFormation` op: `strip` is the joiner (the Strip addressed), `lead` the one that grows. */
export function buildJoinOp(lead) {
  return { kind: 'JoinFormation', leadStripId: lead.stripId, leadBaseRev: lead.rev };
}

/** "of 4, 3 remain" for the stepper's caption. */
export function splitRemainderText(size, n) {
  return `of ${n}, ${n - size} remain`;
}
