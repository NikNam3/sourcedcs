'use strict';
import { getActingPositions, sendEfspCreateStrip } from './efsp-ws.js';
import { facilityOfPosition } from './facility-topology.js';
import { VFR_DEPARTURE_POSITIONS } from './bay/authority-mirror.js';

// The VFR departure (crc-sync docs/adr/0143, H166). One action at the Position that gives departures their code (CD):
// crc-sync makes the flight data (callsign, type, direction of flight, the runway), a discrete code and a DEPARTURE Strip
// in that Position's cleared Bay, in one Mutation. No flight-plan lookup (a VFR flight plan is a search-and-rescue record
// with Flight Service, never the controller's) and no clearance steps. The form shows the callsign and the code it got;
// what to say on the frequency is the controller's (H172: no phraseology in the tool).
//
// The model (`vfrDepartureProblem`, `buildVfrDepartureOp`, `createdText`) is pure (tests/efsp-vfr-departure-client.test.mjs);
// `buildVfrDepartureForm` is the DOM half, the toolbar's VFR form. `.vfr` is the keyboard path (panel/dot-commands.js).

/** The eight compass points (crc-sync flight-data-store.js DIRECTIONS_OF_FLIGHT; Block 9K). */
export const DIRECTIONS_OF_FLIGHT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The Position this controller would make a VFR departure at, or null. */
export function vfrDeparturePosition() {
  const acting = getActingPositions();
  return VFR_DEPARTURE_POSITIONS.find(p => acting.includes(p)) || null;
}

/** What is wrong with these fields before sending, or null. */
export function vfrDepartureProblem({ callsign, aircraftData, direction, runway } = {}) {
  if (!/^[A-Z0-9]{1,7}$/.test(String(callsign || '').trim().toUpperCase())) return 'callsign: 1 to 7 letters or digits';
  if (!String(aircraftData || '').trim()) return 'aircraft type, e.g. F16 or 2/F16';
  if (!DIRECTIONS_OF_FLIGHT.includes(String(direction || '').trim().toUpperCase())) return `direction of flight: ${DIRECTIONS_OF_FLIGHT.join(', ')}`;
  if (runway != null && String(runway).trim() !== '' && !/^(RWY|RW)?\s*\d{1,2}[LCR]?$/i.test(String(runway).trim())) return 'runway: an end such as 23, or empty for the active one';
  return null;
}

/** The CreateVfrDeparture op for these fields (checked first with vfrDepartureProblem). An empty runway is the active one. */
export function buildVfrDepartureOp({ callsign, aircraftData, direction, runway } = {}) {
  const flightData = {
    callsign: String(callsign).trim().toUpperCase(),
    aircraftData: String(aircraftData).trim().toUpperCase(),
    directionOfFlight: String(direction).trim().toUpperCase(),
  };
  const rwy = runway == null ? '' : String(runway).trim().toUpperCase();
  if (rwy) flightData.departureRunway = rwy;
  return { kind: 'CreateVfrDeparture', flightData };
}

/** What the form shows once the Strip is made: the callsign and its code (H172: the facts, never the words to say). */
export function createdText(ack) {
  const fd = ack && ack.flightData;
  const callsign = fd && fd.identity ? fd.identity.callsign : '';
  const code = fd && fd.identity ? fd.identity.beaconAssigned : '';
  return `${callsign} ${code}`;
}

/**
 * Sends CreateVfrDeparture. `onAck(ack)` gets the server's answer (a refusal is the caller's to show).
 * @returns {string|null} what is wrong before sending, or null when sent
 */
export function sendVfrDeparture(fields, onAck) {
  const positionId = vfrDeparturePosition();
  if (!positionId) return 'sign on to the Position that gives departures their code first';
  const problem = vfrDepartureProblem(fields);
  if (problem) return problem;
  sendEfspCreateStrip(positionId, buildVfrDepartureOp(fields), facilityOfPosition(positionId),
    { onAck: (ack) => { if (onAck) onAck(ack); return !ack.ok; } });
  return null;
}

// ── the DOM half ────────────────────────────────────────────────────────────────────────────────

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The toolbar's VFR form: callsign, type, direction, runway (empty = active), Create. Grey; the callsign and code after the
 * ack, orange-red only on a refusal. `prefill()` gives the callsign the toolbar holds.
 * @param {{prefill?:()=>string}} [o]
 * @returns {{el:HTMLElement, open:()=>void, close:()=>void}}
 */
export function buildVfrDepartureForm({ prefill = () => '' } = {}) {
  const el = _el('div', 'efsp-vfr-departure-form');
  el.dataset.testid = 'vfr-departure-form';
  el.hidden = true;
  const input = (field, placeholder, size) => {
    const i = document.createElement('input');
    i.type = 'text'; i.className = 'efsp-vfr-input'; i.placeholder = placeholder; i.autocomplete = 'off';
    if (size) i.size = size;
    i.dataset.field = field;
    return i;
  };
  const callsign = input('callsign', 'Callsign', 8); callsign.maxLength = 7;
  const type = input('aircraftData', 'Type', 7);
  const dir = document.createElement('select'); dir.className = 'efsp-vfr-input'; dir.dataset.field = 'direction';
  dir.appendChild(new Option('DIR', ''));
  for (const d of DIRECTIONS_OF_FLIGHT) dir.appendChild(new Option(d, d));
  const runway = input('runway', 'RWY (active)', 9);
  const create = _el('button', 'efsp-vfr-create-btn', 'Create VFR');
  const cancel = _el('button', 'efsp-vfr-cancel-btn', 'Cancel');
  const msg = _el('span', 'efsp-vfr-msg');
  el.append(callsign, type, dir, runway, create, cancel, msg);

  let pending = false;
  const fields = () => ({ callsign: callsign.value, aircraftData: type.value, direction: dir.value, runway: runway.value });
  const show = (text, bad) => { msg.textContent = text || ''; msg.classList.toggle('efsp-msg-error', !!bad); };
  const submit = () => {
    if (pending) return;
    const problem = sendVfrDeparture(fields(), (ack) => {
      pending = false;
      if (!ack.ok) { show(ack.detail || ack.reason || 'Refused.', true); return; }
      show(createdText(ack), false);
      callsign.value = ''; type.value = ''; dir.value = ''; runway.value = '';
    });
    if (problem) { show(problem, true); return; }
    pending = true;
    show('Creating…', false);
  };
  create.addEventListener('click', submit);
  for (const i of [callsign, type, runway]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
  function open() {
    el.hidden = false; show('', false);
    if (!callsign.value) callsign.value = String(prefill() || '').trim().toUpperCase();
    (callsign.value ? type : callsign).focus();
  }
  function close() { el.hidden = true; pending = false; show('', false); }
  cancel.addEventListener('click', close);
  return { el, open, close };
}
