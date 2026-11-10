// The panel's link to crc-sync's relay (docs/adr/0160): after every recompute of the radio set it sends the link groups
// on /feed, and it keeps what the relay answered for the panel (the grey RELAYING mark, the amber "relay down" line).
// The relay runs in crc-sync whichever radio client this crc-desktop uses, so the groups are always sent.

import { relayGroupsOf, relayingGroupIds, relayDownNote } from './relay-groups.js';
import { sendLinkGroups, getRelayStatus, onRelayStatusChanged, initRelayFeed } from './relay-feed.js';

export function createRelaySync({ onStatusChanged }) {
  let groups = [];
  let groupsKey = null;

  initRelayFeed();
  onRelayStatusChanged(() => { if (onStatusChanged) onStatusChanged(); });

  return {
    /** After every recompute of the set. */
    push(set) {
      const next = relayGroupsOf(set);
      const key = JSON.stringify(next);
      if (key === groupsKey) return;
      groupsKey = key;
      groups = next;
      sendLinkGroups(groups);
    },
    /** The group ids crc-sync relays (the panel's grey RELAYING mark). */
    relayingGroupIds: () => relayingGroupIds(groups, getRelayStatus()),
    /** The one amber line, or null. */
    downNote: () => relayDownNote(getRelayStatus()),
  };
}
