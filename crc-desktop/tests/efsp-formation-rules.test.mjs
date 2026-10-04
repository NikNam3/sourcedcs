// Formation Split / Join, client rules (crc-sync docs/adr/0099): parity with the server tables, the dot-command
// parser, the form validation, the menu offers and the SPLIT chip. Pure: no DOM.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as F from '../app/public/js/panels/efsp/formation-rules.js';
import * as serverConfig from "./helpers/server-config.mjs";

const require = createRequire(import.meta.url);
const authority = require('../../crc-sync/src/efsp/authority/index.js');
const permission = serverConfig.permission;

test('the eligibility and ground-state mirrors equal the server registry', () => {
  for (const type of authority.stripTypeNames()) {
    const server = authority.formationEligibility(type);
    if (F.FORMATION_STRIP_TYPES.includes(type)) {
      assert.deepEqual(F.FORMATION_GROUND_STATES[type], server.ground, type);
      assert.ok(server.split.length > 0 && !server.split.includes('DROPPED'), type);
      assert.deepEqual(server.join, server.split, type);
    } else {
      assert.deepEqual(server.split, [], `${type} is not eligible`);
    }
  }
});

test('FORMATION_POSITIONS are exactly the Positions the server grants the ops', () => {
  const holders = Object.keys(permission.PERMISSIONS).filter((id) => {
    const v = permission.PERMISSIONS[id];
    return (v.has ? v.has('SplitFormation') : v.includes('SplitFormation'));
  });
  assert.deepEqual([...F.FORMATION_POSITIONS].sort(), holders.sort());
});

test('.split parser: heading, speed, Mach, altitude, MARSA, ground form', () => {
  const p = (s) => F.parseSplitCommand(s.split(' '));
  assert.deepEqual(p('2 viper3 H270'), { ok: true, size: 2, callsign: 'VIPER3', assignment: { kind: 'HEADING', value: '270' }, marsaReturn: false });
  assert.deepEqual(p('1 VIPER2 H270 MARSA'), { ok: true, size: 1, callsign: 'VIPER2', assignment: { kind: 'HEADING', value: '270' }, marsaReturn: true });
  assert.deepEqual(p('1 VIPER2').assignment, null);
  assert.deepEqual(p('1 VIPER2 S250').assignment, { kind: 'SPEED', value: '250' });
  assert.deepEqual(p('1 VIPER2 SM.80').assignment, { kind: 'SPEED', value: 'M.80' });
  assert.deepEqual(p('1 VIPER2 A120').assignment, { kind: 'ALTITUDE', value: 'A120' });
  assert.deepEqual(p('1 VIPER2 FL240').assignment, { kind: 'ALTITUDE', value: 'FL240' });
  assert.deepEqual(p('1 VIPER2 H90').assignment, { kind: 'HEADING', value: '090' });
});

test('.split parser: bad input', () => {
  const p = (s) => F.parseSplitCommand(s.split(' '));
  for (const bad of ['', '2', 'x VIPER3 H270', '0 VIPER3 H270', '1 TOOLONGCS H270', '1 VIPER3 H400', '1 VIPER3 banana', '1 VIPER3 H270 S250', '1 VIPER3 MARSA extra']) {
    const r = p(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error.length > 0);
  }
});

const strip = (over = {}) => ({ stripId: 's1', rev: 3, stripType: 'DEPARTURE', state: 'DEPARTED', ownerPositionId: 'AP', facilityId: 'INCIRLIK', flightDataId: 'f1', coordination: null, tofiCoordination: null, ...over });
const fd = (size = 4, callsign = 'VIPER1') => ({ identity: { flightSize: size, callsign } });

test('buildSplitOp: assignment required in the air, not on the ground, MARSA relaxes nothing', () => {
  const air = F.buildSplitOp({ size: 2, callsign: 'viper3', assignment: null }, { strip: strip(), flightData: fd() });
  assert.equal(air.ok, false);
  assert.match(air.error, /assignment/);
  const marsa = F.buildSplitOp({ size: 2, callsign: 'VIPER3', assignment: null, marsaReturn: true }, { strip: strip(), flightData: fd() });
  assert.equal(marsa.ok, false);
  const ground = F.buildSplitOp({ size: 2, callsign: 'viper3', assignment: null }, { strip: strip({ state: 'TAXI' }), flightData: fd() });
  assert.deepEqual(ground.op, { kind: 'SplitFormation', size: 2, callsign: 'VIPER3', assignment: null, marsaReturn: false });
  const ok = F.buildSplitOp({ size: 3, callsign: 'VIPER3', assignment: { kind: 'SPEED', value: '250' }, marsaReturn: true }, { strip: strip(), flightData: fd() });
  assert.equal(ok.op.marsaReturn, true);
  assert.deepEqual(ok.op.assignment, { kind: 'SPEED', value: '250' });
});

test('buildSplitOp refusals: k out of range, no callsign, lead callsign, single, ineligible', () => {
  const ctx = { strip: strip(), flightData: fd() };
  const a = { kind: 'HEADING', value: '270' };
  assert.equal(F.buildSplitOp({ size: 0, callsign: 'X1', assignment: a }, ctx).ok, false);
  assert.equal(F.buildSplitOp({ size: 4, callsign: 'X1', assignment: a }, ctx).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: '', assignment: a }, ctx).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: 'viper1', assignment: a }, ctx).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: 'X1', assignment: a }, { strip: strip(), flightData: fd(1) }).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: 'X1', assignment: a }, { strip: strip({ stripType: 'MISSION' }), flightData: fd() }).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: 'X1', assignment: a }, { strip: strip({ state: 'DROPPED' }), flightData: fd() }).ok, false);
  assert.equal(F.buildSplitOp({ size: 1, callsign: 'X1', assignment: a }, { strip: strip({ coordination: { state: 'INITIATED' } }), flightData: fd() }).ok, false);
});

test('form value parsing per kind', () => {
  assert.deepEqual(F.parseAssignmentValue('HEADING', '270'), { kind: 'HEADING', value: '270' });
  assert.equal(F.parseAssignmentValue('HEADING', '361'), null);
  assert.deepEqual(F.parseAssignmentValue('SPEED', 'M.85'), { kind: 'SPEED', value: 'M.85' });
  assert.deepEqual(F.parseAssignmentValue('SPEED', '250'), { kind: 'SPEED', value: '250' });
  assert.deepEqual(F.parseAssignmentValue('ALTITUDE', 'fl240'), { kind: 'ALTITUDE', value: 'FL240' });
  assert.equal(F.parseAssignmentValue('ALTITUDE', 'high'), null);
  assert.equal(F.splitRemainderText(1, 4), 'of 4, 3 remain');
});

test('menu offers and join candidates', () => {
  assert.ok(F.holdsFormationGrant(strip(), ['AP']));
  assert.equal(F.holdsFormationGrant(strip(), ['CTR']), false, 'a Position that does not own the Strip');
  assert.equal(F.holdsFormationGrant(strip({ ownerPositionId: 'TAC_C2' }), ['TAC_C2']), false);
  assert.equal(F.splitOffer(strip(), fd(1)).ok, false);
  assert.ok(F.splitOffer(strip(), fd()).ok);
  const other = strip({ stripId: 's2', flightDataId: 'f2' });
  const foreign = strip({ stripId: 's3', flightDataId: 'f3', ownerPositionId: 'CTR' });
  const dropped = strip({ stripId: 's4', flightDataId: 'f4', state: 'DROPPED' });
  const mission = strip({ stripId: 's5', flightDataId: 'f5', stripType: 'MISSION' });
  const all = [strip(), other, foreign, dropped, mission];
  assert.deepEqual(F.joinLeadCandidates(strip(), all).map(s => s.stripId), ['s2']);
  assert.ok(F.joinOffer(strip(), all, []).ok);
  assert.equal(F.joinOffer(strip(), all, [{}]).ok, false);
  assert.equal(F.joinOffer(strip(), [strip()], []).ok, false);
  assert.deepEqual(F.buildJoinOp(other), { kind: 'JoinFormation', leadStripId: 's2', leadBaseRev: 3 });
});

test('SPLIT chip carries the lineage', () => {
  assert.equal(F.splitChipFor(strip(), null, null, null), null);
  const part = strip({ splitFrom: { stripId: 's1', flightDataId: 'f1', at: 123, actionId: null } });
  const chip = F.splitChipFor(part, () => null, () => fd(), () => '1432');
  assert.deepEqual(chip, { text: 'SPLIT', title: 'split from VIPER1 at 1432Z' });
});
