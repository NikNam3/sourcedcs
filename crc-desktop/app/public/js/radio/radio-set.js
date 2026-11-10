'use strict';

// The radio set (docs/adr/0158 §2): the panel's radios as a pure function of four inputs, passed in, never read here:
//  - `staffed`: the Positions this session is signed on at, `[{ facilityId, positionId, observer }]` in staffing order
//    (S-RADIO-1 RQ14: Primary and Observer; an Observer's radios are receive-only and unlinked);
//  - `rows`: the frequency table rows (panels/efsp/frequency-state.js, ADR 0131/0138);
//  - the two guards, always 243.000 UHF and 121.500 VHF, each its own radio, linked to nothing by default;
//  - `manual`: the controller's manual radios `[{ id, label, mhz, modulation }]` (radio-prefs.js; AM or FM, RQ18).
// A Position's radio in a band is its first row in that band, in table order: shipped rows first, then added rows in
// the order they were added. Further rows of the band stay in the FREQUENCIES panel. A row outside both bands gets no
// radio (`rowsWithoutRadio`), nor does a Position with no row (`positionsWithoutRow`); the panel notes both in grey.
//
// SRS slots (RQ13): the engine tunes one SRS slot per distinct frequency and modulation, 11 at most. Past 11, the
// overflow radios get `conflict: NO_SLOT_CONFLICT`, in the order guards, Position radios, manual radios.
//
// The output is the contract with the radio engine (docs/parallel/radio/README.md, amended by S-RADIO-1):
// `{ radios: [{ id, kind, positionId, band, mhz, modulation, label, groupId, conflict, receiveOnly }], groups: [...] }`.

import { bandOf } from './bands.js';
import { NO_SLOT_CONFLICT, SRS_SLOTS, assignLinkGroups } from './link-groups.js';

export const MODULATIONS = Object.freeze(['AM', 'FM']);
export const GUARDS = Object.freeze([
  Object.freeze({ band: 'UHF', mhz: 243.0 }),
  Object.freeze({ band: 'VHF', mhz: 121.5 }),
]);
const BAND_ORDER = ['UHF', 'VHF'];

export function positionRadioId(positionId, band) { return `POSITION:${positionId}:${band}`; }
export function guardRadioId(band) { return `GUARD:${band}`; }
export function manualRadioId(id) { return `MANUAL:${id}`; }

/** A staffed Position's own frequency rows, in table order (shipped first, then added in the order they came). */
export function positionRowsOf(rows, { facilityId, positionId }) {
  const own = (rows || []).filter(r => r && r.kind === 'POSITION' && r.positionId === positionId && r.facilityId === facilityId);
  return [...own.filter(r => r.added !== true), ...own.filter(r => r.added === true)];
}

function positionLabel(positionId, row) {
  return row.label && row.label !== positionId ? `${positionId} ${row.label}` : positionId;
}

function uniqueStaffed(staffed) {
  const seen = new Set(); // a Position listed twice still has one radio per band
  return (staffed || []).filter(s => s && !seen.has(s.positionId) && seen.add(s.positionId));
}

/** One radio per band per staffed Position: its first row in each band. An Observer's are receive-only. */
export function positionRadios(staffed = [], rows = []) {
  const out = [];
  for (const s of uniqueStaffed(staffed)) {
    const own = positionRowsOf(rows, s);
    for (const band of BAND_ORDER) {
      const row = own.find(r => bandOf(r.mhz) === band);
      if (!row) continue;
      out.push({
        id: positionRadioId(s.positionId, band), kind: 'POSITION', positionId: s.positionId,
        band, mhz: row.mhz, modulation: 'AM', label: positionLabel(s.positionId, row), receiveOnly: !!s.observer,
      });
    }
  }
  return out;
}

/** The staffed Positions' rows outside both bands: valid in the table, but no radio. */
export function rowsWithoutRadio(staffed = [], rows = []) {
  return uniqueStaffed(staffed).flatMap(s => positionRowsOf(rows, s).filter(r => bandOf(r.mhz) === null));
}

/** The staffed Positions with no frequency row at all (RQ15): `[{ facilityId, positionId }]`. */
export function positionsWithoutRow(staffed = [], rows = []) {
  return uniqueStaffed(staffed).filter(s => positionRowsOf(rows, s).length === 0).map(s => ({ facilityId: s.facilityId, positionId: s.positionId }));
}

export function guardRadios() {
  return GUARDS.map(g => ({
    id: guardRadioId(g.band), kind: 'GUARD', positionId: null,
    band: g.band, mhz: g.mhz, modulation: 'AM', label: `GUARD ${g.band}`, receiveOnly: false,
  }));
}

/** The controller's manual radios. One outside both bands is kept, with `band` null. */
export function manualRadios(manual = []) {
  return manual.filter(m => m && m.id != null && Number.isFinite(m.mhz)).map(m => ({
    id: manualRadioId(m.id), kind: 'MANUAL', positionId: null,
    band: bandOf(m.mhz), mhz: m.mhz, modulation: MODULATIONS.includes(m.modulation) ? m.modulation : 'AM',
    label: m.label ? String(m.label) : 'MANUAL', receiveOnly: false,
  }));
}

/** The SRS slot a radio takes: one per distinct frequency (to the kHz) and modulation. */
export function slotKeyOf(radio) { return `${Math.round(radio.mhz * 1000)}/${radio.modulation}`; }

/** Sets `conflict: NO_SLOT_CONFLICT` on the radios past the 11th distinct slot, guards first, then the rest in order. */
export function assignSlots(radios, slots = SRS_SLOTS) {
  const order = [...radios.filter(r => r.kind === 'GUARD'), ...radios.filter(r => r.kind === 'POSITION'), ...radios.filter(r => r.kind !== 'GUARD' && r.kind !== 'POSITION')];
  const used = new Set();
  const refused = new Set();
  for (const r of order) {
    const key = slotKeyOf(r);
    if (used.has(key)) continue;
    if (used.size < slots) used.add(key);
    else refused.add(r.id);
  }
  return radios.map(r => ({ ...r, conflict: refused.has(r.id) ? NO_SLOT_CONFLICT : null }));
}

/**
 * The whole radio set. The radios come in the order Position radios, guards, manual radios, which is also the
 * precedence of the one-frequency-per-group rule. `groups` and `membership` are the controller's (radio-prefs.js).
 */
export function buildRadioSet({ staffed = [], rows = [], manual = [], groups = [], membership = {} } = {}) {
  const radios = assignSlots([...positionRadios(staffed, rows), ...guardRadios(), ...manualRadios(manual)]);
  return assignLinkGroups(radios, { groups, membership });
}
