// Hand-mirrored server tables with no parity test before this file
// (docs/wip/PARITY.md has the full inventory and which test holds which).
// Same pattern as efsp-block-map-parity.test.js: require the crc-sync module
// across the package boundary (test-only; ADR 0001's "no import" rule is
// about the runtime path) and compare the data the client actually ships.
//
// Everything here READS the current server data, so a deliberate change to
// nla.js / permission.js / block-map.js (lane L17) shows up as a failure that
// names the table to update, not as a stale copy of the old answer.

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { readClient, readServer, constLiteral } from './helpers/mirror-source.mjs';
import * as clientNla from '../app/public/js/panels/efsp/efsp-nla.js';
import * as rules from '../app/public/js/panels/efsp/runway-status-rules.js';
import { formatZuluHhmm } from '../app/public/js/panels/efsp/strip-template.js';
import { COMPACT_BLOCKS_BY_POSITION } from '../app/public/js/panels/efsp/strip-fields.js';
import { haversineM } from '../app/public/js/geo.js';

const require = createRequire(import.meta.url);

const serverIff = require('../../crc-sync/src/surveillance/iff.js');
const serverNla = require('../../crc-sync/src/efsp/nla.js');
const serverFieldState = require('../../crc-sync/src/efsp/runway-status.js');
const serverPermission = require('../../crc-sync/src/efsp/permission.js');
const serverFacilities = require('../../crc-sync/src/efsp/facility-config.js');
const serverZulu = require('../../crc-sync/src/efsp/zulu-time.js');
const serverGeo = require('../../crc-sync/src/geo.js');

const EFSP = 'panels/efsp/';

// ── IFF (S-6) ───────────────────────────────────────────────────────────────

test('S-6: the client IFF_STATES is the server\'s, in the same order (the client gates declare mutations with it)', () => {
  assert.deepEqual(constLiteral(readClient('iff.js'), 'IFF_STATES', 'iff.js'), serverIff.IFF_STATES);
});

test('S-6: every IFF state the server can classify has a client fallback colour, and nothing else does', () => {
  const colours = constLiteral(readClient('iff.js'), 'IFF_COLOR_DEFAULTS', 'iff.js');
  assert.deepEqual(Object.keys(colours).sort(), [...serverIff.IFF_STATES].sort());
  // classifyIff() only ever answers one of IFF_STATES
  for (const args of [{}, { mode3: true }, { mode4: true }, { datalink: true }, { declared: 'hostile' }]) {
    assert.ok(serverIff.IFF_STATES.includes(serverIff.classifyIff(args)));
  }
});

// ── NLA button labels (D-9) ─────────────────────────────────────────────────
// efsp-nla.js NLA_LABELS says it "mirrors nla.js's STATES_BY_STRIP_TYPE/computeNla": the
// label is the verb for leaving a state, so every live (non-DROPPED) state of a Role has one.

const { NLA_LABELS, DOUBLE_TAP_MS, UNDO_WINDOW_MS, DEFAULT_STALE_THRESHOLD_SECONDS } = clientNla;

test('D-9: NLA_LABELS has a label for every non-terminal state of every Role in nla.js STATES_BY_STRIP_TYPE, and none for a state nla.js lacks', () => {
  assert.deepEqual(Object.keys(NLA_LABELS).sort(), Object.keys(serverNla.STATES_BY_STRIP_TYPE).sort(), 'Roles differ');
  for (const [stripType, states] of Object.entries(serverNla.STATES_BY_STRIP_TYPE)) {
    const live = states.filter(s => s !== 'DROPPED');
    assert.deepEqual(Object.keys(NLA_LABELS[stripType]).sort(), [...live].sort(), `${stripType}: label keys vs nla.js states`);
    for (const s of live) assert.ok(NLA_LABELS[stripType][s], `${stripType}.${s} has an empty label`);
  }
});

test('D-9: the client owner tables name exactly the states nla.js has for each Role (no state without an owner, no owner for a missing state)', () => {
  const { STATE_OWNERS_BY_STRIP_TYPE } = clientNla;
  for (const [stripType, states] of Object.entries(serverNla.STATES_BY_STRIP_TYPE)) {
    const live = states.filter(s => s !== 'DROPPED');
    assert.deepEqual(Object.keys(STATE_OWNERS_BY_STRIP_TYPE[stripType]).sort(), [...live].sort(), stripType);
  }
});

test('the 400 ms double-tap guard and the 30 s Undo window equal board/ops/invoke-nla.js\'s literals', () => {
  const src = readServer('efsp/board/ops/invoke-nla.js');
  assert.match(src, new RegExp(`wallNow - lastInvoke\\.invokedAt < ${DOUBLE_TAP_MS}\\b`), 'board-store double-tap guard differs from DOUBLE_TAP_MS');
  assert.match(src, new RegExp(`expiresAt: wallNow \\+ ${UNDO_WINDOW_MS}\\b`), 'board-store undo window differs from UNDO_WINDOW_MS');
});

test('the client stale-board threshold outlasts several of the server\'s heartbeats', () => {
  const tick = Number(/const TICK_MS\s*=\s*(\d+)/.exec(readServer('ws-hub.js'))[1]);
  assert.ok(DEFAULT_STALE_THRESHOLD_SECONDS * 1000 >= 4 * tick, `a ${DEFAULT_STALE_THRESHOLD_SECONDS}s threshold vs a ${tick}ms heartbeat would flap`);
});

// ── runway-status-rules.js tables the existing drift tests do not touch ───────

const fsSrc = readClient(EFSP + 'runway-status-rules.js');

test('D-9: the strips that show a RWY chip are real states of their Role, and cover the state BEFORE every state the server gates on a runway', () => {
  // RUNWAY_GATED_STATES lists the states whose ENTRY uses the runway; the chip is shown one step
  // earlier, on the Strip whose next NLA step the inhibit would refuse (the client comment's
  // "so the controller sees the problem before the NLA does").
  for (const [stripType, states] of Object.entries(rules.FIELD_STATE_RUNWAY_STRIP_STATES)) {
    for (const s of states) assert.ok(serverNla.STATES_BY_STRIP_TYPE[stripType].includes(s), `${stripType}.${s} is not a state in nla.js`);
    const order = serverNla.STATES_BY_STRIP_TYPE[stripType];
    for (const g of serverFieldState.RUNWAY_GATED_STATES[stripType] || []) {
      const before = order[order.indexOf(g) - 1];
      assert.ok(states.includes(before), `server gates entry to ${stripType}.${g}, but the client shows no RWY chip on ${before}`);
    }
  }
  assert.deepEqual(Object.keys(rules.FIELD_STATE_RUNWAY_STRIP_STATES).sort(), Object.keys(serverFieldState.RUNWAY_GATED_STATES).sort());
});

test('D-9: the hook-check states are ARRIVAL states, and a subset of the RWY-chip states', () => {
  for (const s of rules.FIELD_STATE_GEAR_CHECK_STATES) {
    assert.ok(serverNla.ARRIVAL_STATES.includes(s), s);
    assert.ok(rules.FIELD_STATE_RUNWAY_STRIP_STATES.ARRIVAL.includes(s), s);
  }
});

test('D-9: the suspension-kind labels are runway-status.js\'s, verbatim', () => {
  // NOTE (PARITY finding, not client drift): SUSPENSION_KINDS also has RUNWAY_CHANGE but
  // SUSPENSION_LABELS does not, so the server words a change-suspension "works in progress"
  // by fallback. Both sides agree; see docs/wip/PARITY.md.
  assert.deepEqual(constLiteral(fsSrc, 'FIELD_STATE_SUSPENSION_LABELS', 'runway-status-rules.js'), serverFieldState.SUSPENSION_LABELS);
});

test('D-9: the gear-type labels cover exactly the server GEAR_TYPES', () => {
  const client = constLiteral(fsSrc, 'FIELD_STATE_GEAR_TYPE_LABELS', 'runway-status-rules.js');
  assert.deepEqual(Object.keys(client).sort(), [...serverFieldState.GEAR_TYPES].sort());
});

test('D-9: every Position a client authority table names is a Position some Facility actually has', () => {
  const real = new Set(serverFacilities.getFacilityIds().flatMap(f => serverFacilities.getPositionSet(f)));
  const named = new Map();
  const note = (where, ids) => { for (const id of ids) named.set(id, where); };
  for (const owners of Object.values(rules.FIELD_STATE_ACTION_OWNERS)) note('FIELD_STATE_ACTION_OWNERS', owners);
  for (const byState of Object.values(clientNla.STATE_OWNERS_BY_STRIP_TYPE)) for (const owners of Object.values(byState)) note('STATE_OWNERS_BY_STRIP_TYPE', owners);
  const bay = readClient(EFSP + 'bay/authority-mirror.js');
  for (const name of ['AIRSPACE_ENTRY_POSITIONS', 'CONVERT_TO_ARRIVAL_POSITIONS']) note(name, constLiteral(bay, name, 'authority-mirror.js'));
  const handBack = constLiteral(bay, 'HAND_BACK_TO', 'authority-mirror.js');
  note('HAND_BACK_TO keys', Object.keys(handBack));
  for (const v of Object.values(handBack)) note('HAND_BACK_TO', v);
  const answered = constLiteral(bay, 'TOFI_ANSWERED_BY', 'authority-mirror.js');
  note('TOFI_ANSWERED_BY', [...Object.keys(answered), ...Object.values(answered)]);
  for (const byPos of Object.values(COMPACT_BLOCKS_BY_POSITION)) note('COMPACT_BLOCKS_BY_POSITION', Object.keys(byPos));
  for (const [id, where] of named) assert.ok(real.has(id), `${where} names Position ${id}, which no Facility in facility-config.js has`);
});

// ── Position lists and Facility ids (radar-panel.js, efsp-ws.js) ────────────

test('D-9: EFSP_FACILITY_POSITIONS is facility-config.js\'s Position set for every Facility it lists', () => {
  const client = constLiteral(readClient('panels/radar-panel.js'), 'EFSP_FACILITY_POSITIONS', 'radar-panel.js');
  for (const [facilityId, positions] of Object.entries(client)) {
    assert.deepEqual(positions, serverFacilities.getPositionSet(facilityId), `Facility ${facilityId}`);
  }
});

test('D-9: the only Facility radar-panel.js does not list is the one whose Positions are derived from airspace config', () => {
  const client = constLiteral(readClient('panels/radar-panel.js'), 'EFSP_FACILITY_POSITIONS', 'radar-panel.js');
  const unlisted = serverFacilities.getFacilityIds().filter(f => !(f in client));
  assert.deepEqual(unlisted, ['RANGES'], `a new Facility (${unlisted}) has no "acting as" checkboxes until it is listed or derived`);
});

test('D-9: efsp-ws.js tracks held Positions for every server Facility, and its default Facility is the server\'s', () => {
  const src = readClient(EFSP + 'efsp-ws.js');
  const signedOn = constLiteral(src, '_actingPositionsByFacility', 'efsp-ws.js');
  assert.deepEqual(Object.keys(signedOn).sort(), [...serverFacilities.getFacilityIds()].sort());
  assert.equal(/const DEFAULT_EFSP_FACILITY_ID = '([A-Z]+)'/.exec(src)[1], serverFacilities.DEFAULT_FACILITY_ID);
});

// ── pure helpers copied across (geo.js, strip-template.js, bay-view.js) ─────

test('D-9: formatZuluHhmm answers as crc-sync zulu-time.js does', () => {
  for (const ms of [0, Date.UTC(2026, 8, 30, 14, 32), Date.UTC(2026, 0, 1, 0, 5), Date.UTC(2026, 11, 31, 23, 59, 59), null, undefined, '', 'x', NaN]) {
    assert.equal(formatZuluHhmm(ms), serverZulu.formatZuluHhmm(ms), String(ms));
  }
});

test('D-9: the client haversineM (geo.js) agrees with crc-sync geo.js', () => {
  for (const [a, b, c, d] of [[37, 35.43, 33.41, 36.52], [0, 0, 0, 0], [-33.9, 151.2, 51.5, -0.12], [89, 10, -89, 170]]) {
    const got = haversineM(a, b, c, d);
    assert.ok(Math.abs(got - serverGeo.haversineM(a, b, c, d)) < 1e-6, `${a},${b} -> ${c},${d}`);
  }
});

test('D-9: the TOFI accept picker offers exactly the server\'s SEPARATION_REGIMES', () => {
  const server = /const SEPARATION_REGIMES = new Set\((\[[^\]]*\])\)/.exec(readServer('efsp/flight-data-store.js'));
  assert.ok(server, 'flight-data-store.js SEPARATION_REGIMES moved');
  const regimes = new Function(`return ${server[1]}`)();
  assert.deepEqual([...constLiteral(readClient(EFSP + 'bay/popovers/tofi.js'), 'TOFI_ACCEPT_REGIMES', 'tofi.js')].sort(), [...regimes].sort());
});

// ── held by other files already (listed so the inventory stays honest) ──────
test('the permission tables the older tests hold are still exported under the names they read', () => {
  for (const k of ['STATE_OWNERS_BY_STRIP_TYPE', 'RUNWAY_STATUS_OP_OWNERS', 'TACTICAL_CAPABILITIES', 'COORDINATION_OP_KINDS', 'TOFI_OP_KINDS', 'AIRSPACE_ENTRY_OP_KINDS']) {
    assert.ok(serverPermission[k], `permission.js no longer exports ${k}: efsp-nla-client / coordination / reachability parity tests need it`);
  }
});
