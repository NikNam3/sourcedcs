// The panel's link to the relay (ADR 0158 §4, ADR 0159): after every recompute of the radio set it tells the engine
// the link groups, and asks crc-sync for the relay leases of their channels; the leases granted go to the engine. The
// leases are asked for only while this client can actually relay: the built-in radio runs (config.json radioClient
// "node") and its SRS links are up. Otherwise it claims nothing, so another controller's client takes the lease and
// the pilots are still heard.

import { relayGroupsOf, leaseKeysOf, relayingGroupIds } from './relay-groups.js';
import { wantRelayLeases, getHeldRelayLeases, onRelayLeasesChanged, initRelayLease } from './relay-lease.js';

export function createRelaySync(engine, { isNodeClient, onHeldChanged }) {
  let groups = [];
  let groupsKey = null;
  let canRelay = false;
  const claim = () => wantRelayLeases(canRelay ? leaseKeysOf(groups) : []);

  initRelayLease();
  onRelayLeasesChanged((held) => {
    if (engine.setRelayLeases) engine.setRelayLeases(held);
    if (onHeldChanged) onHeldChanged();
  });

  return {
    /** After every recompute of the set. */
    push(set) {
      const next = relayGroupsOf(set);
      const key = JSON.stringify(next);
      if (key === groupsKey) return;
      groupsKey = key;
      groups = next;
      if (engine.setLinkGroups) engine.setLinkGroups(groups);
      claim();
    },
    /** On every engine state. */
    engineState(s) {
      const next = !!(isNodeClient() && s && s.enabled !== false && s.connected && s.udpReady);
      if (next === canRelay) return;
      canRelay = next;
      claim();
    },
    /** The group ids this client holds a relay lease in (the panel's grey RELAY mark). */
    relayingGroupIds: () => relayingGroupIds(groups, getHeldRelayLeases()),
  };
}
