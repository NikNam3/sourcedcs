'use strict';
import { BLOCK_MAPS, isBlockEditable } from './strip-template.js';

// The track-label menu's rule (H164 FT-Q4 a, docs/adr/0140): who is offered heading, speed and altitude from a
// contact's data block, and which of the Strip's own cells they write. Pure (no DOM, no state reads): the caller
// passes the contact's live Strips and the Positions this controller acts at, per Facility, so a test can run it with
// any number of Facilities.
//
// The rule names the ONE acting Position (ADR 0132): the menu is offered to a controller acting at the Strip's
// owning Position in the Strip's own Facility. Never "holds any Position with a role", never an id. crc-sync's
// owner gate (strip-ops.js, NOT_OWNER) is the authority; this only decides what is offered.

/** The three assignments, in the order the menu lists them. */
export const LABEL_ASSIGN_FIELDS = Object.freeze(['heading', 'speed', 'altitude']);

/**
 * The Strip's own assignment cells for heading, speed and altitude: the Blocks of this strip type whose target is the
 * flight's clearance cell of that field and that this Facility may type (a carrier FINAL's HDG/ALT are not).
 * Read from the Block Map, so a new strip type with such cells gets the menu with no edit here.
 * @returns {{field:string, blockId:string, label:string}[]} in LABEL_ASSIGN_FIELDS order, one per field at most
 */
export function assignmentCellsFor(stripType, facilityId) {
  const map = BLOCK_MAPS[stripType];
  if (!map) return [];
  const out = [];
  for (const field of LABEL_ASSIGN_FIELDS) {
    const blockId = Object.keys(map).find(id => map[id].target && map[id].target.kind === 'clearance' && map[id].target.field === field);
    if (blockId && isBlockEditable(blockId, stripType, facilityId)) out.push({ field, blockId, label: map[blockId].label });
  }
  return out;
}

/**
 * What a click on a contact's data block offers.
 *
 * @param {object[]} strips the contact's correlated Strips (any Facility)
 * @param {(facilityId:string) => string[]} actingAt the Positions this controller acts at (Primary) in that Facility
 * @param {{prefer?:(strip:object) => boolean}} [opts] a tie-break when the controller owns several of the
 *   flight's Strips (one per Facility): the first preferred one (the caller: its Bay is open), else the first
 * @returns {{strip:object, actingPositionId:string, cells:{field:string, blockId:string, label:string}[]}|null}
 *   null: no Strip, not the owner, or a Strip with none of the three cells — the caller keeps today's click
 */
export function labelAssignmentFor(strips, actingAt, { prefer } = {}) {
  const owned = [];
  for (const strip of strips || []) {
    if (!strip || strip.state === 'DROPPED' || !strip.ownerPositionId || !strip.facilityId) continue;
    if (!(actingAt(strip.facilityId) || []).includes(strip.ownerPositionId)) continue;
    const cells = assignmentCellsFor(strip.stripType, strip.facilityId);
    if (cells.length) owned.push({ strip, actingPositionId: strip.ownerPositionId, cells });
  }
  if (!owned.length) return null;
  return (prefer && owned.find(o => prefer(o.strip))) || owned[0];
}

/**
 * The SetBlock ops an Enter sends: one per cell whose typed text differs from what it showed, in menu order.
 * A cell left as it was sends nothing, so a menu opened and closed with Enter sends nothing either.
 * @param {{blockId:string, before:string, typed:string}[]} entries
 */
export function labelAssignOps(entries) {
  return entries
    .map(e => ({ blockId: e.blockId, value: String(e.typed == null ? '' : e.typed).trim(), before: String(e.before == null ? '' : e.before) }))
    .filter(e => e.value !== e.before)
    .map(e => ({ kind: 'SetBlock', blockId: e.blockId, value: e.value }));
}
