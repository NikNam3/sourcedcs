// The renderer's half of the relay (ADR 0158 §4, ADR 0159): which channels a link group may relay (relay-groups.js),
// the lease claim on /feed (relay-lease.js) and the panel's link (radio-relay-sync.js).
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { channelKey, relayGroupsOf, leaseKeysOf, relayingGroupIds } from '../app/public/js/radio/relay-groups.js';
import { wantRelayLeases, getHeldRelayLeases, initRelayLease, _resetRelayLeaseForTest, CLAIM_TYPE } from '../app/public/js/radio/relay-lease.js';
import { createRelaySync } from '../app/public/js/radio/radio-relay-sync.js';
import { setSendToSync, setIsSyncOpen } from '../app/public/js/sync.js';
import { dispatchEfspMessage } from '../app/public/js/panels/efsp/efsp-message-registry.js';

const require = createRequire(import.meta.url);
const nodePath = require('../app/srs/relay-path.js');

const radio = (id, mhz, groupId, extra = {}) => ({ id, mhz, modulation: 'AM', groupId, ...extra });
const SET = {
  radios: [
    radio('POSITION:P1:UHF', 251, 'AUTO'), radio('POSITION:P1:VHF', 122.1, 'AUTO'), radio('POSITION:P2:UHF', 251, 'AUTO'),
    radio('GUARD:UHF', 243, null), radio('GUARD:VHF', 121.5, 'G1'), radio('MANUAL:a', 305.5, 'G1'),
    radio('INTERCOM', null, null, { modulation: 'INTERCOM' }), radio('MANUAL:solo', 260, 'G2'),
  ],
  groups: [{ id: 'AUTO', radioIds: [] }, { id: 'G1', radioIds: [] }, { id: 'G2', radioIds: [] }],
};

test('channel keys are the same on both sides of /srs', () => {
  for (const [mhz, mod] of [[251, 'AM'], [122.105, 'AM'], [30.025, 'FM'], [100, 'INTERCOM'], [0, 'AM'], [251, undefined]]) {
    assert.equal(channelKey(mhz, mod), nodePath.channelKey(mhz, mod), `${mhz} ${mod}`);
  }
});

test('the groups as relay channels: one per frequency, a group needs two, the intercom never', () => {
  const g = relayGroupsOf(SET);
  assert.deepEqual(g.map(x => [x.id, x.channels.map(c => c.key)]), [['AUTO', ['251000:AM', '122100:AM']], ['G1', ['121500:AM', '305500:AM']]]);
  assert.deepEqual(leaseKeysOf(g), ['121500:AM', '122100:AM', '251000:AM', '305500:AM']);
  assert.deepEqual(relayingGroupIds(g, ['305500:AM']), ['G1']);
  assert.deepEqual(relayingGroupIds(g, []), []);
});

test('a channel an Observer radio has is marked receive-only and its lease is not asked for', () => {
  const set = { ...SET, radios: [...SET.radios, radio('POSITION:P9:UHF', 122.1, null, { receiveOnly: true })] };
  const g = relayGroupsOf(set);
  assert.equal(g[0].channels.find(c => c.key === '122100:AM').receiveOnly, true);
  assert.ok(!leaseKeysOf(g).includes('122100:AM'));
});

function feed() {
  const sent = [];
  let open = true;
  let tick = null;
  setSendToSync((m) => sent.push(m));
  setIsSyncOpen(() => open);
  _resetRelayLeaseForTest();
  return { sent, setOpen: (v) => { open = v; }, every: (fn) => { tick = fn; return {}; }, tick: () => tick() };
}

test('a claim names every channel wanted, is sent only when that changes, and is sent again after a reconnect', () => {
  const f = feed();
  initRelayLease({ setInterval: f.every });
  f.tick();
  wantRelayLeases(['251000:AM', '122100:AM']);
  wantRelayLeases(['122100:AM', '251000:AM']);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, CLAIM_TYPE);
  assert.deepEqual(f.sent[0].channels, ['122100:AM', '251000:AM']);
  dispatchEfspMessage({ version: 1, type: 'radio-relay-leases', held: ['251000:AM'] });
  assert.deepEqual(getHeldRelayLeases(), ['251000:AM']);
  f.setOpen(false); f.tick();
  assert.deepEqual(getHeldRelayLeases(), [], 'crc-sync dropped them with the socket');
  f.setOpen(true); f.tick();
  assert.equal(f.sent.length, 2, 'claimed again');
  wantRelayLeases([]);
  assert.deepEqual(f.sent.at(-1).channels, [], 'an empty claim releases all');
});

test('the panel link claims only while the built-in radio can relay, and hands the grants to the engine', () => {
  const f = feed();
  const told = { groups: null, leases: null };
  const engine = { setLinkGroups: (g) => { told.groups = g; }, setRelayLeases: (k) => { told.leases = k; } };
  let node = true;
  const sync = createRelaySync(engine, { isNodeClient: () => node });
  sync.push(SET);
  assert.equal(told.groups.length, 2);
  assert.deepEqual(f.sent.at(-1).channels, [], 'nothing claimed before the SRS links are up');
  sync.engineState({ enabled: true, connected: true, udpReady: true });
  assert.deepEqual(f.sent.at(-1).channels, ['121500:AM', '122100:AM', '251000:AM', '305500:AM']);
  dispatchEfspMessage({ version: 1, type: 'radio-relay-leases', held: ['121500:AM'] });
  assert.deepEqual(told.leases, ['121500:AM']);
  assert.deepEqual(sync.relayingGroupIds(), ['G1']);
  sync.engineState({ enabled: true, connected: false, udpReady: false });
  assert.deepEqual(f.sent.at(-1).channels, [], 'SRS down: the leases go to someone who can relay');
  node = false;
  sync.engineState({ enabled: true, connected: true, udpReady: true });
  assert.deepEqual(f.sent.at(-1).channels, [], 'lxsrs does not relay, so it claims nothing');
});
