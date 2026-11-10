'use strict';
import { CARRIER_HANDOFFS } from './efsp-nla.js';

// The buttons beside a Strip's NLA (crc-sync docs/adr/0157, efsp/nla-also.js): the server's `strip.nla.also`, a list of
// next actions that are each either a carrier handoff (the CarrierHandoff op) or the drop (the DropStrip op). Pure: the
// Strip's life block (carrier-panel.js) and the MARSHAL panel's row both draw what this returns, so the two always offer
// the same buttons. A sibling stays offered when the NLA itself is inhibited (BOLTER beside a TRAPPED with no PriFly).

/**
 * @param {object} strip
 * @returns {{key:string, label:string, op:object, inhibited:string|null, handoff:string|null}[]}
 */
export function nlaAlsoActions(strip) {
  const list = strip && strip.nla && Array.isArray(strip.nla.also) ? strip.nla.also : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a.toState !== 'string') continue;
    if (a.carrierHandoff) {
      const row = CARRIER_HANDOFFS[a.carrierHandoff];
      if (!row) continue; // a handoff this client does not know: no button rather than a wrong one
      const op = { kind: 'CarrierHandoff', transfer: a.carrierHandoff, ...(a.transferTo ? { toPositionId: a.transferTo } : {}) };
      out.push({ key: a.carrierHandoff, label: row.label, op, inhibited: a.inhibited || null, handoff: a.carrierHandoff });
    } else if (a.toState === 'DROPPED') {
      out.push({ key: 'DROP', label: 'DROP', op: { kind: 'DropStrip', reason: 'dropped from the Strip' }, inhibited: a.inhibited || null, handoff: null });
    }
  }
  return out;
}

/** A signature of the siblings, for a keyed row reconciler. */
export function nlaAlsoSignature(strip) {
  return nlaAlsoActions(strip).map((a) => `${a.key}${a.inhibited ? '!' : ''}`).join(',');
}
