'use strict';
import { getEfspFlightData } from '../panels/efsp/efsp-state.js';
import { sendEfspMutation } from '../panels/efsp/efsp-ws.js';
import { labelAssignmentForTrack } from '../panels/efsp/label-menu.js';

// Where a scope gesture's value goes (docs/adr/0164): the Strip's own heading or altitude cell, by the rule the label
// menu uses (label-assign-rules.js, docs/adr/0140): only the controller acting at the correlated Strip's owning Position,
// only a strip type with that cell. Sent as the cell's SetBlock, so the refusal banner, the Mutation log, conformance
// and the control-release attestation behave as if it was typed on the Strip.

/**
 * The cell a gesture on this contact writes, or null (no Strip, not the owner, no such cell: the gesture does nothing).
 * @param {'heading'|'altitude'} field
 * @returns {{strip:object, actingPositionId:string, blockId:string, active:object|null}|null}
 *   active: the field's ACTIVE clearance entry, what the gesture starts from or overwrites
 */
export function assignTargetFor(trackId, field) {
  const offer = labelAssignmentForTrack(trackId);
  const cell = offer && offer.cells.find(c => c.field === field);
  if (!cell) return null;
  const fd = getEfspFlightData(offer.strip.flightDataId);
  const entries = (fd && fd.clearance && fd.clearance[field] && fd.clearance[field].entries) || [];
  return { strip: offer.strip, actingPositionId: offer.actingPositionId, blockId: cell.blockId, active: entries.find(e => e.status === 'ACTIVE') || null };
}

/** Sends the value to the cell; false when there is nowhere to send it. */
export function sendAssignment(target, value) {
  if (!target) return false;
  sendEfspMutation(target.actingPositionId, target.strip, { kind: 'SetBlock', blockId: target.blockId, value: String(value) });
  return true;
}
