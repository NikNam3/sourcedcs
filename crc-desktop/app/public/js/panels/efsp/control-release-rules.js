'use strict';
// Communications, ControlRelease and transfer of control on an interfacility HANDOFF (crc-sync docs/adr/0101).
// Pure: what the Strip says and which steps it offers. The server decides (and refuses); this keeps no authority table
// and no copy of the Block Map's control axis — the attestation prompt is driven by the server's own refusal.
import { formatZuluHhmm } from './strip-template.js';

export const RELEASE_SCOPES = ['TURNS', 'CLIMB', 'DESCENT', 'FULL'];
export const RELEASE_SCOPE_LABELS = { TURNS: 'Turns', CLIMB: 'Climb', DESCENT: 'Descent', FULL: 'Full' };

// The two obligations the control invariant raises (forwarding-obligations.js); the Strip's badge uses the label.
export const OBLIGATION_LABELS = {
  CONTROL_UNCOVERED: { label: 'NO CONTROL HOLDER', title: 'Nobody staffed holds control or communications of this HANDOFF: sign on at the Position that should' },
  CONTROL_REPAIRED: { label: 'CONTROL MOVED', title: 'The system moved communications or control back to a live Position (see the Strip)' },
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

/** "Turns + Climb ≤ 24000 ft · from 1230Z · until the boundary" */
export function releaseSummary(release) {
  if (!release) return '';
  const parts = [release.scopes.map(s => RELEASE_SCOPE_LABELS[s] || s).join(' + ')];
  if (release.climbLimitFt != null) parts[0] += ` ≤ ${release.climbLimitFt} ft`;
  if (release.descentLimitFt != null) parts[0] += ` ≥ ${release.descentLimitFt} ft`;
  if (release.effectiveAt != null) parts.push(`from ${_zulu(release.effectiveAt)}`);
  if (release.condition) parts.push(release.condition);
  return parts.join(' · ');
}

export function requestSummary(req) {
  if (!req) return '';
  const base = req.scopes.map(s => RELEASE_SCOPE_LABELS[s] || s).join(' + ');
  return req.note ? `${base} · ${req.note}` : base;
}

/**
 * The standing lines a HANDOFF row carries after ACCEPT, as `{key, text, title, tone, held}`; `held` means the Position
 * of this Strip holds it. Empty when this is not an ACTIVE HANDOFF.
 */
export function handoffChips(strip) {
  if (!isStepsHandoff(strip)) return [];
  const co = strip.coordination;
  const me = strip.ownerPositionId;
  const chips = [];
  const comms = commsHolderPosition(strip);
  const control = controlHolderPosition(strip);
  chips.push({ key: 'comms', text: `COMMS: ${comms}`, held: comms === me, tone: 'on',
    title: co.comms.transferred ? `communications with ${comms}${co.comms.at ? ` since ${_zulu(co.comms.at)}` : ''}${co.comms.trigger ? ` (${co.comms.trigger})` : ''}` : `${comms} is still on the frequency` });
  chips.push({ key: 'control', text: `CTRL: ${control}`, held: control === me, tone: 'on',
    title: controlMoved(co) ? `control with ${control}${co.control.at ? ` since ${_zulu(co.control.at)}` : ''}` : `${control} still has control: instructions outside a release need coordinating` });
  if (!controlMoved(co)) {
    const rel = co.release;
    if (rel && rel.withdrawnAt) {
      chips.push({ key: 'release', text: 'RELEASE WITHDRAWN', tone: 'dim', title: `${releaseSummary(rel)} — withdrawn ${_zulu(rel.withdrawnAt)}` });
    } else if (rel) {
      chips.push({ key: 'release', text: `RELEASE: ${releaseSummary(rel)}`, tone: 'on', title: `${rel.grantedByPositionId || 'the transferring Position'} released ${releaseSummary(rel)}` });
    }
    const req = co.releaseRequest;
    if (req && req.answer == null) {
      chips.push({ key: 'request', text: `RELEASE REQUESTED: ${requestSummary(req)}`, tone: 'attn', title: `${req.requestedByPositionId || 'the receiver'} asked for a ControlRelease at ${_zulu(req.requestedAt)}` });
    } else if (req && req.answer === 'REFUSED') {
      chips.push({ key: 'request', text: `RELEASE REFUSED${req.reason ? `: ${req.reason}` : ''}`, tone: 'attn', title: `request for ${requestSummary(req)} refused` });
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
 * Each: `{key, label, title, enabled, reason, form?}` — `form` names the dialog (release / request / refuse), none is one click.
 */
export function handoffSteps(strip, acting) {
  if (!isStepsHandoff(strip) || !acting) return [];
  const co = strip.coordination;
  const side = handoffSideOf(strip);
  const p = handoffPositions(strip);
  const steps = [];
  if (!co.comms.transferred) {
    steps.push({ key: 'TRANSFER_COMMS', label: `Comms to ${p.receiving}`, enabled: true,
      title: side === 'TRANSFERRING' ? `${p.receiving} has the frequency (the aircraft was told to call them)` : `the aircraft has checked in with you: you have the frequency` });
  }
  if (!controlMoved(co)) {
    steps.push({ key: 'TRANSFER_CONTROL', label: `Control to ${p.receiving}`, enabled: true,
      title: 'mark transfer of control (the boundary or an agreed point)' });
    const req = co.releaseRequest;
    const open = !!req && req.answer == null;
    if (side === 'TRANSFERRING') {
      steps.push({ key: 'GRANT', label: 'Release…', enabled: true, form: 'release',
        title: `ControlRelease: let ${p.receiving} turn, climb or descend the aircraft before control transfers` });
      if (open) steps.push({ key: 'REFUSE', label: 'Unable', enabled: true, form: 'refuse', title: `refuse ${p.receiving}'s release request` });
      if (co.release && !co.release.withdrawnAt) steps.push({ key: 'WITHDRAW', label: 'Withdraw release', enabled: true, title: 'take the ControlRelease back (only before control transfers)' });
    } else {
      steps.push({ key: 'REQUEST', label: 'Request release…', enabled: !open, form: 'request',
        reason: open ? 'a request is already open' : '',
        title: `ask ${p.transferring} for a ControlRelease` });
    }
  }
  return steps;
}

/** The op for a one-click step. */
export function buildStepOp(key) {
  if (key === 'TRANSFER_COMMS' || key === 'TRANSFER_CONTROL') return { kind: 'HANDOFF', action: key };
  return { kind: 'ControlRelease', action: key };
}

/** "1230" (or "12:30") as a mission-clock time on the day of `nowMs`; null on a malformed string. A time well in the past means tomorrow's. */
export function parseEffectiveAt(text, nowMs) {
  const m = /^\s*(\d{1,2}):?(\d{2})\s*z?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const day = Math.floor(nowMs / 86400000) * 86400000;
  let at = day + (h * 60 + min) * 60000;
  if (at < nowMs - 12 * 3600000) at += 86400000;
  return at;
}

function _feet(text) {
  if (text == null || String(text).trim() === '') return { value: null };
  const n = Number(String(text).trim());
  return Number.isFinite(n) && n >= 0 ? { value: Math.round(n) } : { error: `"${text}" is not a number of feet` };
}

/**
 * The GRANT op from the form: `{scopes, climbLimit, descentLimit, condition, effectiveAt}` (strings).
 * @returns {{op?:object, error?:string}}
 */
export function buildGrantOp(form, nowMs) {
  const scopes = RELEASE_SCOPES.filter(s => (form.scopes || []).includes(s));
  if (scopes.length === 0) return { error: 'pick what is released' };
  const op = { kind: 'ControlRelease', action: 'GRANT', scopes: scopes.includes('FULL') ? ['FULL'] : scopes };
  if (!op.scopes.includes('FULL')) {
    for (const [field, scope, key] of [['climbLimit', 'CLIMB', 'climbLimitFt'], ['descentLimit', 'DESCENT', 'descentLimitFt']]) {
      if (!op.scopes.includes(scope)) continue;
      const f = _feet(form[field]);
      if (f.error) return { error: f.error };
      if (f.value != null) op[key] = f.value;
    }
  }
  if (form.condition && form.condition.trim()) op.condition = form.condition.trim();
  if (form.effectiveAt && form.effectiveAt.trim()) {
    const at = parseEffectiveAt(form.effectiveAt, nowMs);
    if (at == null) return { error: 'effective time is HHMM Zulu' };
    op.effectiveAt = at;
  }
  return { op };
}

export function buildRequestOp(form) {
  const scopes = RELEASE_SCOPES.filter(s => (form.scopes || []).includes(s));
  if (scopes.length === 0) return { error: 'pick what you are asking for' };
  const op = { kind: 'ControlRelease', action: 'REQUEST', scopes: scopes.includes('FULL') ? ['FULL'] : scopes };
  if (form.note && form.note.trim()) op.note = form.note.trim();
  return { op };
}

export function buildRefuseOp(reason) {
  const op = { kind: 'ControlRelease', action: 'REFUSE' };
  if (reason && reason.trim()) op.reason = reason.trim();
  return op;
}

/**
 * Is this refusal the server asking for "coordinated with"? (crc-sync handoff-control.js `checkControlAxis`: a
 * VALIDATION_ERROR on a SetBlock whose detail ends in "(coordinatedWith)".) -> `{with, needs}` or null.
 */
export function attestationRequest(reason, detail, op) {
  if (reason !== 'VALIDATION_ERROR' || !op || op.kind !== 'SetBlock' || op.coordinatedWith) return null;
  const m = /^(.+?) is a control instruction and .*coordinate with (\S+) and say so \(coordinatedWith\)$/.exec(String(detail || ''));
  if (!m) return null;
  return { needs: m[1], with: m[2], detail };
}
