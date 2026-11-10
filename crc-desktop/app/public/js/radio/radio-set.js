'use strict';

// The radio set (docs/adr/0158 §2): the panel's radios as a pure function of four inputs, passed in, never read here:
//  - `staffed`: the Positions this session staffs, `[{ facilityId, positionId }]` in the order they are shown;
//  - `rows`: the frequency table rows (panels/efsp/frequency-state.js, ADR 0131/0138);
//  - the two guards, always 243.000 UHF and 121.500 VHF, each its own radio, linked to nothing by default;
//  - `manual`: the controller's manual radios `[{ id, label, mhz }]` (radio-prefs.js).
// A Position's radio in a band is its first row in that band, in table order: shipped rows first, then added rows in
// the order they were added. Further rows of the band stay in the FREQUENCIES panel. A row outside both bands gets no
// radio (`rowsWithoutRadio` lists them for the panel's note). The groups come from link-groups.js.
//
// The output is the contract with the radio engine (docs/parallel/radio/README.md):
// `{ radios: [{ id, kind, positionId, band, mhz, modulation, label, groupId, conflict }], groups: [...] }`.

import { bandOf } from './bands.js';
import { assignLinkGroups } from './link-groups.js';

export const MODULATION = 'AM';
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

/** One radio per band per staffed Position: its first row in each band. */
export function positionRadios(staffed = [], rows = []) {
  const out = [];
  const seen = new Set(); // a Position listed twice still has one radio per band
  for (const s of staffed) {
    if (seen.has(s.positionId)) continue;
    seen.add(s.positionId);
    const own = positionRowsOf(rows, s);
    for (const band of BAND_ORDER) {
      const row = own.find(r => bandOf(r.mhz) === band);
      if (!row) continue;
      out.push({
        id: positionRadioId(s.positionId, band), kind: 'POSITION', positionId: s.positionId,
        band, mhz: row.mhz, modulation: MODULATION, label: positionLabel(s.positionId, row),
      });
    }
  }
  return out;
}

/** The staffed Positions' rows outside both bands: valid in the table, but no radio. The panel notes them in grey. */
export function rowsWithoutRadio(staffed = [], rows = []) {
  return staffed.flatMap(s => positionRowsOf(rows, s).filter(r => bandOf(r.mhz) === null));
}

export function guardRadios() {
  return GUARDS.map(g => ({
    id: guardRadioId(g.band), kind: 'GUARD', positionId: null,
    band: g.band, mhz: g.mhz, modulation: MODULATION, label: `GUARD ${g.band}`,
  }));
}

/** The controller's manual radios. One outside both bands is kept, with `band` null. */
export function manualRadios(manual = []) {
  return manual.filter(m => m && m.id != null && Number.isFinite(m.mhz)).map(m => ({
    id: manualRadioId(m.id), kind: 'MANUAL', positionId: null,
    band: bandOf(m.mhz), mhz: m.mhz, modulation: MODULATION, label: m.label ? String(m.label) : 'MANUAL',
  }));
}

/**
 * The whole radio set. Precedence for the one-frequency-per-group rule is this order: Position radios, guards, manual
 * radios. `groups` and `membership` are the controller's (radio-prefs.js).
 */
export function buildRadioSet({ staffed = [], rows = [], manual = [], groups = [], membership = {} } = {}) {
  const radios = [...positionRadios(staffed, rows), ...guardRadios(), ...manualRadios(manual)];
  return assignLinkGroups(radios, { groups, membership });
}
