'use strict';

// The runtime frequency table on the client (crc-sync docs/adr/0131, H154): the rows crc-sync sends in the snapshot's
// `frequencies` and in each `efsp-frequency-delta` (a Facility's rows, whole), and the pure model the FREQUENCIES panel
// draws. A leaf: it imports nothing, so node:test imports it directly.
//
// A row: `{ facilityId, kind: 'POSITION', positionId, label, mhz, defaultMhz, setAt, setBy }` or
// `{ facilityId, kind: 'SFA', rackId, use, mhz, defaultMhz, setAt, setBy }`. The server decides; the input check here
// mirrors crc-sync's frequency-table.js (tests/frequency-state.test.mjs holds the two to each other), so a typo is
// answered at once, before a round trip.

let _rows = [];

/** The snapshot's table replaces everything this client held. */
export function replaceFrequencyRows(rows) { _rows = Array.isArray(rows) ? rows.map(r => ({ ...r })) : []; }

/** An `efsp-frequency-delta`: that Facility's rows, whole. */
export function applyFrequencyDelta(msg) {
  if (!msg || !msg.facilityId || !Array.isArray(msg.frequencies)) return;
  _rows = [..._rows.filter(r => r.facilityId !== msg.facilityId), ...msg.frequencies.map(r => ({ ...r }))];
}

/** Every row, or one Facility's. */
export function getFrequencyRows(facilityId) {
  return facilityId ? _rows.filter(r => r.facilityId === facilityId) : [..._rows];
}

/** One row's identity inside the table. */
export function frequencyRowKey(row) {
  return row.kind === 'SFA' ? `${row.facilityId}/SFA/${row.rackId}` : `${row.facilityId}/${row.positionId}/${row.label}`;
}

/** A controller-set value (differs from the facility file's): the server keeps only those, with who set it. */
export function isFrequencySet(row) { return !!row && row.mhz !== row.defaultMhz; }

/** `275.800`. */
export function frequencyText(mhz) { return Number.isFinite(mhz) ? mhz.toFixed(3) : '--'; }

/**
 * The panel's sections, in the order rows came: one per Facility, its Position rows grouped by Position, then its SFA
 * pool. `[{ facilityId, positions: [{ positionId, rows }], sfa: [rows] }]`.
 */
export function frequencySections(rows = _rows) {
  const out = [];
  const byFacility = new Map();
  for (const r of rows) {
    let s = byFacility.get(r.facilityId);
    if (!s) { s = { facilityId: r.facilityId, positions: [], sfa: [] }; byFacility.set(r.facilityId, s); out.push(s); }
    if (r.kind === 'SFA') { s.sfa.push(r); continue; }
    let p = s.positions.find(x => x.positionId === r.positionId);
    if (!p) { p = { positionId: r.positionId, rows: [] }; s.positions.push(p); }
    p.rows.push(r);
  }
  return out;
}

/** What the row's name cell says: `GND` for a Position frequency, `freq-2 ROTATION` for an SFA one. */
export function frequencyRowName(row) {
  return row.kind === 'SFA' ? `${row.rackId} ${String(row.use).replace(/_/g, ' ')}` : row.label;
}

/** The grey note on a set row: `default 275.800 · c-GC 1432Z`. Empty on a default row. */
export function frequencySetNote(row) {
  if (!isFrequencySet(row)) return '';
  const when = Number.isFinite(row.setAt) ? new Date(row.setAt).toISOString().slice(11, 16).replace(':', '') + 'Z' : '';
  return [`default ${frequencyText(row.defaultMhz)}`, [row.setBy, when].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

// crc-sync airspace-schema.js MIN/MAX_FREQUENCY_MHZ, facility-schema.js SFA_MIN/MAX_MHZ and frequency-table.js's
// VHF airband (the 8.33 kHz channel names). Drift-tested against the server's channelProblem.
export const FREQUENCY_LIMITS = Object.freeze({ min: 30, max: 400, sfaMin: 225, sfaMax: 399.975, airbandMin: 118, airbandMax: 137 });

/** Null when `mhz` is on a channel (crc-sync frequency-table.js channelProblem), else why not. */
export function frequencyChannelProblem(mhz) {
  const khz = Math.round(mhz * 1000);
  if (Math.abs(mhz * 1000 - khz) > 1e-6) return `${mhz} is not a whole kHz`;
  const offset = khz % 25;
  if (mhz >= FREQUENCY_LIMITS.airbandMin && mhz < FREQUENCY_LIMITS.airbandMax) {
    return [0, 5, 10, 15].includes(offset) ? null : `${mhz.toFixed(3)} is not a 25 or 8.33 kHz channel`;
  }
  return offset === 0 ? null : `${mhz.toFixed(3)} is not on the 25 kHz grid`;
}

/**
 * What the controller typed, for this row: `{ mhz }` or `{ error }`. Accepts `275.8`, `275.800`, `275,8`. The SFA pool is
 * UHF and its frequencies differ from one another (the other rows of the same pool are passed in `pool`).
 */
export function parseFrequencyInput(text, row, pool = []) {
  const t = String(text == null ? '' : text).trim().replace(',', '.');
  if (!/^\d{2,3}(\.\d{1,3})?$/.test(t)) return { error: 'a frequency in MHz, e.g. 275.800' };
  const mhz = Number(t);
  const L = FREQUENCY_LIMITS;
  if (row && row.kind === 'SFA') {
    if (mhz < L.sfaMin || mhz > L.sfaMax) return { error: `an SFA frequency is UHF, ${L.sfaMin} to ${L.sfaMax} MHz` };
    const other = pool.find(p => p.rackId !== row.rackId && p.mhz === mhz);
    if (other) return { error: `${frequencyText(mhz)} is already ${other.rackId}` };
  } else if (mhz < L.min || mhz > L.max) {
    return { error: `a frequency is a number from ${L.min} to ${L.max} MHz` };
  }
  const problem = frequencyChannelProblem(mhz);
  return problem ? { error: problem } : { mhz };
}

/** The op that sets a row to `mhz` (`efsp-frequency-mutation`'s `op`). */
export function setFrequencyOp(row, mhz) {
  return row.kind === 'SFA' ? { kind: 'SetFrequency', rackId: row.rackId, mhz } : { kind: 'SetFrequency', positionId: row.positionId, label: row.label, mhz };
}

/** The op that returns a row to the facility file's value. */
export function resetFrequencyOp(row) {
  return row.kind === 'SFA' ? { kind: 'ResetFrequency', rackId: row.rackId } : { kind: 'ResetFrequency', positionId: row.positionId, label: row.label };
}

/** A Facility's Position frequencies as crc-sync's positions frames carry them: `{ <Position>: [{ label, mhz }] }`. */
export function positionFrequenciesOf(rows, facilityId) {
  const out = {};
  for (const r of rows) {
    if (r.facilityId !== facilityId || r.kind !== 'POSITION') continue;
    (out[r.positionId] || (out[r.positionId] = [])).push({ label: r.label, mhz: r.mhz });
  }
  return out;
}

/** A Facility's SFA pool as the SFA Bay descriptor carries it (`sfaPool`: `[{ rackId, mhz, use }]`), or null when it has none. */
export function sfaPoolOf(rows, facilityId) {
  const pool = rows.filter(r => r.facilityId === facilityId && r.kind === 'SFA').map(r => ({ rackId: r.rackId, mhz: r.mhz, use: r.use }));
  return pool.length ? pool : null;
}

/** Tests only. */
export function _resetFrequencyStateForTest() { _rows = []; }
