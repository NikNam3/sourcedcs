'use strict';

// The `radio-relay` wire family (docs/adr/0158 §4, docs/adr/0159): a client claims the relay leases of its link groups'
// frequencies, and is told which it holds. Not an EFSP store family (no seq, no snapshot, no audit, no replay: the
// table is in memory and a reconnecting client claims again), so it is not in efsp/wire/families/ and is bound into
// the hub as `radioRelay` instead.
//
//   client -> server  {type:'radio-relay-claim', clientMutationId, channels:['251000:AM', ...]}   every channel it
//                     wants now; a channel it no longer names is released (unlink, Position left, retune). [] releases all.
//   server -> client  {type:'radio-relay-ack', clientMutationId, ok, reason?, detail?}              to the claimant
//                     {type:'radio-relay-leases', held:[...]}   to the claimant after every claim, and to every other
//                     session whose leases the claim or a close moved (a lease passed on to it, the grant; or taken)
//
// The frames are built in efsp/wire/frames.js. They are directed at single sessions, so they leave through the hub's
// `_sendRadioRelay`, not `deliverEfsp` (a broadcast through the read scope and the obligation re-check, neither of
// which applies to a lease; the conflict-suppress ack and the PAR samples go out directly for the same reason).
// Any connected session may claim: a link group can hold guards and manual radios, which no Position gates.

const { createRelayLeases, claimProblem } = require('./relay-leases');
const { relayClaimAck, relayLeasesFrame } = require('../efsp/wire/frames');

const CLAIM = 'radio-relay-claim';

/**
 * @param {{leases?: ReturnType<typeof createRelayLeases>}} [o]
 * @returns {{handles:(type:string)=>boolean, handle:Function, close:Function, leases:object}}
 */
function createRadioRelayWire(o = {}) {
  const leases = o.leases || createRelayLeases();
  const leaseFrames = (holders) => holders.map(h => ({ session: h, frame: relayLeasesFrame(leases.heldBy(h)) }));

  return {
    leases,
    handles: (type) => type === CLAIM,
    /** @returns {Array<{session:object, frame:object}>} the frames to send, the claimant's ack first */
    handle(session, msg) {
      const problem = claimProblem(msg.channels);
      if (problem) return [{ session, frame: relayClaimAck(msg, { ok: false, reason: 'VALIDATION_ERROR', detail: problem }) }];
      const changed = leases.claim(session, [...new Set(msg.channels)]);
      const others = changed.filter(h => h !== session);
      return [{ session, frame: relayClaimAck(msg, { ok: true }) }, ...leaseFrames([session, ...others])];
    },
    /** A session closed: its leases pass on. The frames for the sessions that gained one. */
    close(session) {
      return leaseFrames(leases.release(session).filter(h => h !== session));
    },
  };
}

module.exports = { createRadioRelayWire, CLAIM };
