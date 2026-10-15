'use strict';
// Check-in, release and transfer of control on an interfacility HANDOFF (crc-sync docs/adr/0122, replacing ADR 0101's
// release model; H142). Pure: what the Strip says and which steps it offers. The server decides (and refuses); this keeps
// no authority table and no copy of the Block Map's control axis — the attestation prompt is driven by the server's own
// refusal.
import { formatZuluHhmm } from '../../format.js';

// The obligations a HANDOFF raises (forwarding-obligations.js); the Strip's badge uses the label. Dark cockpit (H142 §7):
// only what needs the controller — nobody holding the exchange, a system move, a receiver that has not marked the
// aircraft checked in after a while, and a not-released aircraft already in the receiver's airspace but not checked in.
export const OBLIGATION_LABELS = {
  CONTROL_UNCOVERED: { label: 'NO CONTROL HOLDER', title: 'Nobody staffed holds control or communications of this HANDOFF: sign on at the Position that should' },
  CONTROL_REPAIRED: { label: 'CONTROL MOVED', title: 'The system moved communications or control back to a live Position (see the Strip)' },
  NOT_CHECKED_IN: { label: 'NOT CHECKED IN', title: 'Accepted a while ago and not marked checked in: has the pilot called you?' },
  IN_AIRSPACE_NOT_CHECKED_IN: { label: 'IN AIRSPACE · NOT CHECKED IN', title: 'The aircraft is inside the receiver\'s airspace but has not checked in, so control cannot move' },
};

/** A HANDOFF whose communications and control move in steps: live and past ACCEPT. */
export function isStepsHandoff(strip) {
  const co = strip && strip.coordination;
  return !!co && co.primitive === 'HANDOFF' && co.state === 'ACTIVE' && !!co.control && !!co.comms;
}

/** Which side of the exchange this Strip is (the receiver's is the replica the proposal minted). */
export function handoffSideOf(strip) {
  return strip.coordination.mintedForCoordination ? 'RECEIVING' : 'TRANSFERRING';
}

/** The two Positions of the exchange, by role. */
export function handoffPositions(strip) {
  const co = strip.coordination;
  return handoffSideOf(strip) === 'RECEIVING'
    ? { transferring: co.peerPositionId, receiving: strip.ownerPositionId }
    : { transferring: strip.ownerPositionId, receiving: co.peerPositionId };
}

export function controlMoved(co) { return !!co.control && co.control.holder === 'RECEIVING'; }

export function commsHolderPosition(strip) {
  const p = handoffPositions(strip);
  return strip.coordination.comms.transferred ? p.receiving : p.transferring;
}

export function controlHolderPosition(strip) {
  const co = strip.coordination;
  if (co.separationResponsibilityRef && co.separationResponsibilityRef.positionId) return co.separationResponsibilityRef.positionId;
  const p = handoffPositions(strip);
  return controlMoved(co) ? p.receiving : p.transferring;
}

const _zulu = (ms) => (ms == null ? '' : `${formatZuluHhmm(ms)}Z`);

/**
 * The standing lines a HANDOFF row carries after ACCEPT, as `{key, text, title, tone, mine}`; `mine` means the Position
 * of this Strip holds it. Empty when this is not an ACTIVE HANDOFF.
 * COMMS and CTRL are `quiet` (grey text, no background, decisions.md H138 U3): who holds them is no problem, so it
 * takes no colour (dark cockpit, H115-H119). Until control moves the receiver's Strip says RELEASED or NOT RELEASED in
 * the same grey (ADR 0122); a release request open asks the handing-off station (`attn`), a refused one the receiver.
 * Once control has moved nothing is added: there is no "release complete" (H142 §7).
 */
export function handoffChips(strip) {
  if (!isStepsHandoff(strip)) return [];
  const co = strip.coordination;
  const me = strip.ownerPositionId;
  const side = handoffSideOf(strip);
  const p = handoffPositions(strip);
  const chips = [];
  const comms = commsHolderPosition(strip);
  const control = controlHolderPosition(strip);
  chips.push({ key: 'comms', text: `COMMS: ${comms}`, mine: comms === me, tone: 'quiet',
    title: co.comms.transferred ? `checked in with ${comms}${co.comms.at ? ` at ${_zulu(co.comms.at)}` : ''}` : `not checked in with ${p.receiving} yet: ${comms} is still on the frequency` });
  chips.push({ key: 'control', text: `CTRL: ${control}`, mine: control === me, tone: 'quiet',
    title: controlMoved(co) ? `control with ${control}${co.control.at ? ` since ${_zulu(co.control.at)}` : ''}` : `${control} still has control: a heading or altitude needs coordinating with it` });
  if (!controlMoved(co)) {
    if (side === 'RECEIVING') {
      chips.push({ key: 'released', text: co.released ? 'RELEASED' : 'NOT RELEASED', tone: 'quiet',
        title: co.released ? 'control moves to you when you mark the aircraft checked in'
          : 'control moves to you once the aircraft has checked in and is inside your airspace' });
    }
    const req = co.releaseRequest;
    if (req && req.answer == null) {
      chips.push({ key: 'request', text: 'RELEASE REQUESTED', tone: side === 'TRANSFERRING' ? 'attn' : 'quiet',
        title: `${req.requestedByPositionId || p.receiving} asked for a release at ${_zulu(req.requestedAt)}${req.note ? `: ${req.note}` : ''}` });
    } else if (req && req.answer === 'REFUSED' && !co.released && side === 'RECEIVING') {
      chips.push({ key: 'request', text: `RELEASE REFUSED${req.reason ? `: ${req.reason}` : ''}`, tone: 'attn',
        title: `${p.transferring} refused the release at ${_zulu(req.answeredAt)}: control waits for your airspace` });
    }
  }
  if (co.repair) {
    const r = co.repair;
    chips.push({ key: 'repair', text: `${String(r.axis || 'CONTROL').toUpperCase()} MOVED BY THE SYSTEM`, tone: 'bad',
      title: `${r.why || 'a holder was no longer live and staffed'}${r.at ? ` (${_zulu(r.at)})` : ''}` });
  }
  return chips;
}

/**
 * The steps this Strip offers right now. `acting` is the Position the controller acts as on it (or null).
 * Each: `{key, label, title, enabled, reason, form?}` — `form` names the dialog (request / refuse), none is one click.
 * The receiver: "Checked in" until the pilot has called, and on a not-released handoff "Request release…" until control
 * moves. The handing-off station: "Release" / "Unable" while a request is open. Nobody takes control by hand (H142 §5);
 * nothing is offered on a released handoff or after control moved (U8).
 */
export function handoffSteps(strip, acting) {
  if (!isStepsHandoff(strip) || !acting) return [];
  const co = strip.coordination;
  const side = handoffSideOf(strip);
  const p = handoffPositions(strip);
  const steps = [];
  const moved = controlMoved(co);
  const req = co.releaseRequest;
  const open = !!req && req.answer == null;
  if (side === 'RECEIVING') {
    if (!co.comms.transferred) {
      steps.push({ key: 'CHECKED_IN', label: 'Checked in', enabled: true,
        title: co.released ? 'the pilot has called you: control moves to you now'
          : 'the pilot has called you: control moves to you once the aircraft is inside your airspace' });
    }
    if (!moved && !co.released) {
      steps.push({ key: 'REQUEST', label: 'Request release…', enabled: !open, form: 'request',
        reason: open ? 'a request is already open' : '',
        title: `ask ${p.transferring} to release the handoff` });
    }
  } else if (!moved && !co.released && open) {
    steps.push({ key: 'GRANT', label: 'Release', enabled: true,
      title: `release the handoff to ${p.receiving}: control moves ${co.comms.transferred ? 'now' : 'when the aircraft checks in'}` });
    steps.push({ key: 'REFUSE', label: 'Unable', enabled: true, form: 'refuse', title: `refuse ${p.receiving}'s release request` });
  }
  return steps;
}

/** The op for a one-click step. */
export function buildStepOp(key) {
  if (key === 'CHECKED_IN') return { kind: 'HANDOFF', action: key };
  return { kind: 'ControlRelease', action: key };
}

export function buildRequestOp(form) {
  const op = { kind: 'ControlRelease', action: 'REQUEST' };
  if (form && form.note && form.note.trim()) op.note = form.note.trim();
  return { op };
}

export function buildRefuseOp(reason) {
  const op = { kind: 'ControlRelease', action: 'REFUSE' };
  if (reason && reason.trim()) op.reason = reason.trim();
  return op;
}

/**
 * Is this refusal the server asking for "coordinated with"? The ack carries `attestation: {with, needs:[axis…]}` (crc-sync
 * handoff-control.js `checkControlAxis`); only a SetBlock that has not already attested can be answered by one.
 * -> `{with, needs}` (needs as the words a controller reads, "CLIMB and DESCENT") or null.
 */
export function attestationRequest(attestation, op) {
  if (!attestation || !op || op.kind !== 'SetBlock' || op.coordinatedWith) return null;
  if (typeof attestation.with !== 'string' || !Array.isArray(attestation.needs) || !attestation.needs.length) return null;
  return { needs: attestation.needs.join(' and '), with: attestation.with };
}
