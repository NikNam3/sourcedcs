'use strict';

// The buttons a Strip offers beside its NLA (docs/adr/0157). A strip type's `computeNla` may return `also`: a list of
// further next actions, each either a carrier handoff (`carrierHandoff`, the row in carrier/handoffs.js, recorded by the
// CarrierHandoff op) or the drop (`toState: 'DROPPED'` and nothing else, the DropStrip op). The NLA stays the one primary
// action (guide §3.5 rule 1); these are its siblings, so a TRAPPED that is inhibited still leaves BOLTER live. The list is
// what the wire carries as `strip.nla.also`, and every press is still decided by the op it names: this is advisory, like
// the rest of nlaStatusFor.
//
// Shape on the wire: `[{ toState, carrierHandoff?, transferTo?, inhibited? }]`, never empty (absent instead).

const TOFI_DROP_REFUSAL = 'cannot drop a Strip under active tactical control — complete a TOFI exit first';

/**
 * @param {object} result  computeNla's answer (may be an inhibited one: its `also` still stands)
 * @param {object} strip
 * @returns {object[]|undefined}
 */
function alsoStatus(result, strip) {
  const list = result && Array.isArray(result.also) ? result.also : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a.toState !== 'string') continue;
    const item = { toState: a.toState };
    if (a.carrierHandoff) item.carrierHandoff = a.carrierHandoff;
    if (a.transferTo) item.transferTo = a.transferTo;
    if (a.inhibited) item.inhibited = a.inhibited;
    else if (!a.carrierHandoff && a.toState === 'DROPPED' && strip && strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
      item.inhibited = TOFI_DROP_REFUSAL;
    }
    out.push(item);
  }
  return out.length ? out : undefined;
}

/** A stable text for change detection (nla-status-monitor.js): what each sibling does and whether it is inhibited. */
function alsoKey(also) {
  return (also || []).map((a) => `${a.carrierHandoff || ''}>${a.toState}${a.inhibited ? `!${a.inhibited}` : ''}`).join(',');
}

/** The sibling handoff whose state a Bay implies, for placement's "use the button" refusal, or null. */
function alsoHandoffInto(result, impliedState) {
  const list = result && Array.isArray(result.also) ? result.also : [];
  return list.find((a) => a && a.carrierHandoff && a.toState === impliedState) || null;
}

module.exports = { alsoStatus, alsoKey, alsoHandoffInto };
