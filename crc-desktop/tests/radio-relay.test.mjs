// The renderer's half of crc-sync's relay (docs/adr/0160): which channels a link group sends (relay-groups.js), the
// groups and the status on /feed (relay-feed.js), and the panel's link (radio-relay-sync.js).
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { channelKey, relayGroupsOf, relayingGroupIds, relayDownNote } from '../app/public/js/radio/relay-groups.js';
import { sendLinkGroups, getRelayStatus, initRelayFeed, _resetRelayFeedForTest, LINK_GROUPS_TYPE } from '../app/public/js/radio/relay-feed.js';
import { createRelaySync } from '../app/public/js/radio/radio-relay-sync.js';
import { setSendToSync, setIsSyncOpen } from '../app/public/js/sync.js';
import { dispatchEfspMessage } from '../app/public/js/panels/efsp/efsp-message-registry.js';

const require = createRequire(import.meta.url);
const { isChannelKey } = require('../../crc-sync/src/radio/link-networks.js');
const { segmentKey } = require('../../crc-sync/src/radio/relay-decision.js');

const radio = (id, mhz, groupId, extra = {}) => ({ id, mhz, modulation: 'AM', groupId, ...extra });
const SET = {
  radios: [
    radio('POSITION:P1:UHF', 251, 'AUTO'), radio('POSITION:P1:VHF', 122.1, 'AUTO'), radio('POSITION:P2:UHF', 251, 'AUTO'),
    radio('GUARD:UHF', 243, null), radio('GUARD:VHF', 121.5, 'G1'), radio('MANUAL:a', 305.5, 'G1'),
    radio('INTERCOM', null, null, { modulation: 'INTERCOM' }), radio('MANUAL:solo', 260, 'G2'),
  ],
  groups: [{ id: 'AUTO', radioIds: [] }, { id: 'G1', radioIds: [] }, { id: 'G2', radioIds: [] }],
};

test('channel keys are the ones crc-sync accepts and derives from a packet', () => {
  for (const [mhz, mod] of [[251, 'AM'], [122.105, 'AM'], [30.025, 'FM'], [399.975, 'AM']]) {
    const key = channelKey(mhz, mod);
    assert.ok(isChannelKey(key), key);
    assert.equal(segmentKey(Math.round(mhz * 1e6), mod === 'FM' ? 1 : 0), key);
  }
  assert.equal(channelKey(100, 'INTERCOM'), null);
  assert.equal(channelKey(0, 'AM'), null);
});

test('the groups as channel keys: one per frequency, a group needs two, the intercom and unlinked radios never', () => {
  assert.deepEqual(relayGroupsOf(SET), [{ id: 'AUTO', channels: ['122100:AM', '251000:AM'] }, { id: 'G1', channels: ['121500:AM', '305500:AM'] }]);
});

test('a channel an Observer radio has is left out', () => {
  const set = { ...SET, radios: [...SET.radios, radio('POSITION:P9:UHF', 122.1, null, { receiveOnly: true })] };
  assert.deepEqual(relayGroupsOf(set).map(g => g.id), ['G1'], 'AUTO is left with one channel');
});

test('RELAYING and the amber line follow the status', () => {
  const g = relayGroupsOf(SET);
  const networks = [{ channels: ['121500:AM', '305500:AM', '260000:AM'] }];
  assert.deepEqual(relayingGroupIds(g, { networks, connected: true }), ['G1']);
  assert.deepEqual(relayingGroupIds(g, { networks, connected: false }), []);
  assert.deepEqual(relayingGroupIds(g, null), []);
  assert.equal(relayDownNote({ networks, connected: false, error: 'SRS h:5002: ECONNREFUSED' }), 'relay down: SRS h:5002: ECONNREFUSED');
  assert.equal(relayDownNote({ networks, connected: false }), 'relay down: not connected to SRS');
  assert.equal(relayDownNote({ networks: [], connected: false }), null, 'no network, nothing to say');
  assert.equal(relayDownNote({ networks, connected: true }), null);
});

function feed() {
  const sent = [];
  let open = true;
  let tick = null;
  setSendToSync((m) => sent.push(m));
  setIsSyncOpen(() => open);
  _resetRelayFeedForTest();
  return { sent, setOpen: (v) => { open = v; }, every: (fn) => { tick = fn; return {}; }, tick: () => tick() };
}

test('the groups go whole, only when they change, and again after a /feed reconnect; the status is kept', () => {
  const f = feed();
  initRelayFeed({ setInterval: f.every });
  f.tick();
  const groups = [{ id: 'G1', channels: ['121500:AM', '305500:AM'] }];
  sendLinkGroups(groups);
  sendLinkGroups(JSON.parse(JSON.stringify(groups)));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, LINK_GROUPS_TYPE);
  assert.deepEqual(f.sent[0].groups, groups);
  dispatchEfspMessage({ version: 1, type: 'radio-relay-status', networks: [{ channels: groups[0].channels }], connected: true });
  assert.deepEqual(getRelayStatus(), { networks: [{ channels: groups[0].channels }], connected: true, error: null });
  f.setOpen(false); f.tick();
  assert.equal(getRelayStatus(), null, 'crc-sync dropped the groups with the socket');
  f.setOpen(true); f.tick();
  assert.equal(f.sent.length, 2, 'sent again');
  sendLinkGroups([]);
  assert.deepEqual(f.sent.at(-1).groups, [], 'an empty list withdraws them');
});

test('the panel link sends the set\'s groups and reports the status back', () => {
  const f = feed();
  let changed = 0;
  const sync = createRelaySync({ onStatusChanged: () => { changed++; } });
  sync.push(SET);
  sync.push(SET);
  assert.equal(f.sent.filter(m => m.type === LINK_GROUPS_TYPE).length, 1);
  dispatchEfspMessage({ version: 1, type: 'radio-relay-status', networks: [{ channels: ['121500:AM', '305500:AM'] }], connected: false, error: 'boom' });
  assert.ok(changed >= 1);
  assert.deepEqual(sync.relayingGroupIds(), []);
  assert.equal(sync.downNote(), 'relay down: boom');
  dispatchEfspMessage({ version: 1, type: 'radio-relay-status', networks: [{ channels: ['121500:AM', '305500:AM'] }], connected: true });
  assert.deepEqual(sync.relayingGroupIds(), ['G1']);
  assert.equal(sync.downNote(), null);
});
