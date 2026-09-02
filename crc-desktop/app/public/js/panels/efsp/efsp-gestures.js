'use strict';

// The four paper gestures (guide §7.3) — offset/flip/highlight/attention —
// each MUST cost exactly one input. The guide's own measured finding is
// that this is the specific thing that made the real prototype's paper-
// gesture equivalents feel unusable once they cost three taps instead of
// one, so each function below dispatches EXACTLY one Mutation via the
// injected `sendMutation(strip, op)` — kept pure/injectable so the
// one-input guarantee is mechanically testable (count dispatch calls)
// without a DOM. Each toggles: a second invocation clears the flag rather
// than stacking a second state.

function toggleOffset(strip, sendMutation) {
  sendMutation(strip, { kind: 'SetFlag', flag: 'offset', value: !strip.flags.offset });
}

function toggleFlip(strip, sendMutation) {
  sendMutation(strip, { kind: 'SetFlag', flag: 'flipped', value: !strip.flags.flipped });
}

function setHighlight(strip, color, sendMutation) {
  sendMutation(strip, { kind: 'SetFlag', flag: 'highlight', value: strip.flags.highlight === color ? null : color });
}

function setAttention(strip, color, sendMutation) {
  sendMutation(strip, { kind: 'SetFlag', flag: 'attention', value: strip.flags.attention === color ? null : color });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toggleOffset, toggleFlip, setHighlight, setAttention };
}
