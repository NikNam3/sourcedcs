'use strict';

/* Tests the pure functions in discord-client.js — the parts of the
   roster-refresh/resolution logic that don't require an actual Discord
   connection. Extracted from server.js in the Phase 2 architecture pass
   (see the repo-root architecture plan). */

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store.js');
const discordClient = require('../discord-client.js');

/* ══════════════════════════════════════════════════════════
   resolvedSquadron / resolvedRole
══════════════════════════════════════════════════════════ */

test('resolvedSquadron: override wins over auto-assignment', () => {
  assert.equal(discordClient.resolvedSquadron({ squadronOverride: 'vfa-1', autoSquadron: 'vfa-2' }), 'vfa-1');
  assert.equal(discordClient.resolvedSquadron({ autoSquadron: 'vfa-2' }), 'vfa-2');
  assert.equal(discordClient.resolvedSquadron({}), '');
  assert.equal(discordClient.resolvedSquadron(null), '');
});

test('resolvedRole: override wins over auto-assignment, falls back to legacy .role', () => {
  assert.equal(discordClient.resolvedRole({ roleOverride: 'Flight Lead', autoRole: 'Pilot' }), 'Flight Lead');
  assert.equal(discordClient.resolvedRole({ autoRole: 'Pilot' }), 'Pilot');
  assert.equal(discordClient.resolvedRole({ role: 'Legacy Role' }), 'Legacy Role');
  assert.equal(discordClient.resolvedRole({}), '');
});

/* ══════════════════════════════════════════════════════════
   isCurrentlyOnVacation / validateVacationRange
══════════════════════════════════════════════════════════ */

test('isCurrentlyOnVacation: inside/outside a range, malformed entries ignored', () => {
  const now = Date.parse('2026-06-15T00:00:00Z');
  assert.equal(discordClient.isCurrentlyOnVacation([
    { from: '2026-06-01T00:00:00Z', until: '2026-06-30T00:00:00Z' },
  ], now), true);
  assert.equal(discordClient.isCurrentlyOnVacation([
    { from: '2026-07-01T00:00:00Z', until: '2026-07-30T00:00:00Z' },
  ], now), false);
  assert.equal(discordClient.isCurrentlyOnVacation([{ from: 'not-a-date', until: 'also-not' }], now), false);
  assert.equal(discordClient.isCurrentlyOnVacation(null, now), false);
});

test('validateVacationRange: rejects invalid dates and until <= from', () => {
  assert.deepEqual(discordClient.validateVacationRange('not-a-date', '2026-06-30'), { ok: false, error: 'Invalid date' });
  assert.deepEqual(
    discordClient.validateVacationRange('2026-06-30T00:00:00Z', '2026-06-01T00:00:00Z'),
    { ok: false, error: '"Until" must be after "from"' }
  );
  assert.deepEqual(discordClient.validateVacationRange('2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z'), { ok: true });
});

/* ══════════════════════════════════════════════════════════
   computeMemberStatus
══════════════════════════════════════════════════════════ */

test('computeMemberStatus: LEFT_DISCORD and ON_VACATION override the score label', () => {
  assert.equal(discordClient.computeMemberStatus({ active: false }, { current: { label: 'active' } }), 'LEFT_DISCORD');
  assert.equal(
    discordClient.computeMemberStatus(
      { active: true, vacations: [{ from: '2020-01-01T00:00:00Z', until: '2099-01-01T00:00:00Z' }] },
      { current: { label: 'active' } }
    ),
    'ON_VACATION'
  );
  assert.equal(discordClient.computeMemberStatus({ active: true }, { current: { label: 'stale' } }), 'STALE');
  assert.equal(discordClient.computeMemberStatus({ active: true }, null), 'ACTIVE');
});

/* ══════════════════════════════════════════════════════════
   findRosterEntry / findLinkedPilot (operate on store.state.members)
══════════════════════════════════════════════════════════ */

test('findRosterEntry: casdoorSub link wins over callsign/name matching', () => {
  store.state.members = {
    '1': { id: '1', casdoorSub: 'sub-a', callsign: 'VIPER', active: true },
    '2': { id: '2', callsign: 'GHOST', username: 'ghostuser', active: true },
  };
  assert.equal(discordClient.findRosterEntry({ sub: 'sub-a', callsign: 'GHOST' }).id, '1');
  assert.equal(discordClient.findRosterEntry({ callsign: 'ghost' }).id, '2');
  assert.equal(discordClient.findRosterEntry({ callsign: 'nobody' }), null);
});

test('findLinkedPilot: manual casdoorSub link reports pending if not yet registered', () => {
  store.state.pilotRegistry = { 'sub-a': { sub: 'sub-a', name: 'A Pilot', callsign: 'VIPER' } };
  assert.deepEqual(
    discordClient.findLinkedPilot({ casdoorSub: 'sub-a' }),
    { sub: 'sub-a', name: 'A Pilot', callsign: 'VIPER', manual: true }
  );
  assert.deepEqual(
    discordClient.findLinkedPilot({ casdoorSub: 'sub-unknown' }),
    { sub: 'sub-unknown', name: null, callsign: null, manual: true, pending: true }
  );
  assert.equal(discordClient.findLinkedPilot({ callsign: 'nomatch' }), null);
});
