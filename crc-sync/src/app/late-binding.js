'use strict';

// The two real cycles in the composition root (ARCH-S #9), each closed through one named late binding.
//
//   wsHub            WsHub is built from the EFSP facade, the radar picture and the monitors, while the producers of
//                    server-originated frames (the NLA sweep, the correlation reconciler, the carrier tick, the TOFI regime
//                    monitor, the archiver, the airspace service) must deliver through the hub. They hold `hubLink`
//                    from the start and call it only after `createApp` has bound it, which is before any socket exists.
//   surveillanceHints  the Boards ask the hint monitor whether a Strip is observed airborne, and the monitor reads the Boards.
//
// Everything else the old createApp closed with a `set...` call is a plain constructor dependency now. A link that is
// used before it is bound, or bound twice, throws naming itself: the old `regimeLocation` answered "unknown" forever.

/**
 * @param {string} name what the link carries, for the error
 * @returns {{bind: (value: any) => void, get: () => any, isBound: boolean}}
 */
function lateBinding(name) {
  let value;
  let bound = false;
  return {
    /** Binds the link, once. `null` is a value (the soak has no hint monitor). */
    bind(v) {
      if (bound) throw new Error(`late binding "${name}" is already bound`);
      value = v;
      bound = true;
    },
    get() {
      if (!bound) throw new Error(`late binding "${name}" was used before it was bound`);
      return value;
    },
    get isBound() { return bound; },
  };
}

module.exports = { lateBinding };
