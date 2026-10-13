import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { slot } from './helpers/wire-slots.mjs';

/* MARSA sorties — a tanker and its receivers walked by hand (WP6, §9.2).
 *
 * §13's WP6 acceptance criterion is one sentence and sortie 1 asserts it
 * verbatim:
 *
 *   "A heading or altitude assignment to a MARSA participant before
 *    rendezvous voids the relation, sets `voidedBy`, and alerts every
 *    participant Strip."
 *
 * The rest are the questions the lifecycle never poses because a request is
 * not a state (docs/adr/0050's lesson): what if a receiver joins late, what if
 * one breaks off, what if the tanker lands mid-AR, what if a controller tries
 * to take separation back by editing the Block, and what if crc-sync restarts
 * while an AR is joined up.
 *
 * Its own durable board, like every scenario file — Board, airspace and now
 * MARSA state all persist (docs/adr/0002), so tests in one file share a board
 * and a test that wants a particular starting state has to drive it there.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-marsa-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const {
  crew, act, mustAct, marsaAct, mustMarsaAct, airborneDeparture, DEPARTURE_FLIGHT_DATA,
  freshStrip,
} = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };

const efsp = createEfsp();
const c = crew(efsp, ATC);

/** An airborne flight parked at AP's terminus, which is where an AR starts. */
function flight(callsign) {
  return airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign });
}

function declareAr(participants, declaringCallsign) {
  return mustMarsaAct(efsp, c.AP, 'AP', null, {
    kind: 'DeclareMarsa',
    participants: participants.map(s => s.flightDataId),
    startEvent: 'TANKER_ACCEPTED',
    endCondition: 'VERTICALLY_POSITIONED',
    declaringCallsign,
  });
}

/** Re-read a Strip at its current rev, since every op bumps it. */
const fresh = (strip) => freshStrip(efsp, strip);

// ── Sortie 1 — the acceptance criterion ─────────────────────────────────────

test('sortie 1: a heading assigned to a joining receiver voids MARSA and alerts every participant', () => {
  const tanker = flight('SHELL71');
  const rx1 = flight('VIPER11');
  const rx2 = flight('VIPER12');

  const relation = declareAr([tanker, rx1, rx2], 'SHELL71');
  assert.equal(relation.state, 'ACTIVE');
  assert.equal(relation.rendezvousAt, null, 'the interlock is armed until rendezvous');
  // §4.8.3 — the separation regime genuinely changes, on every participant.
  for (const s of [tanker, rx1, rx2]) {
    assert.equal(efsp.flightDataStore.getFlightData(s.flightDataId).tofi.separationRegime, 'MARSA');
  }

  // AP turns one receiver onto a vector. Block 20 is the guide's own §6.2
  // name for the DEPARTURE heading Block.
  const ack = act(efsp, c.AP, 'AP', fresh(rx1), { kind: 'SetBlock', blockId: '20', value: '270' });
  assert.equal(ack.ok, true, 'the clearance itself goes through — the interlock voids, it does not refuse');

  // "...voids the relation, sets voidedBy..."
  const voided = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(voided.state, 'VOIDED');
  assert.equal(voided.voidedBy, 'CONTROLLER_COURSE_CHANGE');
  assert.match(voided.voidedDetail, /before rendezvous/);

  // "...and alerts every participant Strip." The alert is a field on the
  // relation, which carries every participant — so all three Strips render it
  // off one record (docs/adr/0045's shape), with no per-Strip fan-out.
  assert.deepEqual(
    voided.participants.slice().sort(),
    [tanker.flightDataId, rx1.flightDataId, rx2.flightDataId].sort(),
  );
  for (const s of [tanker, rx1, rx2]) {
    assert.equal(efsp.marsaStore.activeFor(s.flightDataId), null, `${s.stripId} is no longer under MARSA`);
    assert.equal(efsp.flightDataStore.getFlightData(s.flightDataId).tofi.separationRegime, 'ATC',
      'ATC is separating them again — the half of the void that makes the flight\'s own fields true');
  }

  // The heading actually landed. A void that quietly ate the clearance would
  // be worse than no interlock at all.
  // The heading is the flight's clearance now (docs/adr/0058), on the flight data.
  assert.equal(efsp.flightDataStore.getFlightData(rx1.flightDataId).clearance.heading.entries.find(e => e.status === 'ACTIVE').value, '270');
});

test('sortie 1a: the same holds for an altitude, with its own cause', () => {
  const tanker = flight('SHELL72');
  const rx = flight('VIPER21');
  const relation = declareAr([tanker, rx], 'SHELL72');

  // Block 21 — the guide's §6.2 "Initial altitude".
  mustAct(efsp, c.AP, 'AP', fresh(tanker), { kind: 'SetBlock', blockId: '21', value: '250' });
  const voided = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(voided.voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');
  assert.match(voided.voidedDetail, /Block 21/);
});

test('sortie 1b: amending the FILED altitude is not an assignment, and does not void', () => {
  const tanker = flight('SHELL73');
  const rx = flight('VIPER31');
  const relation = declareAr([tanker, rx], 'SHELL73');

  // Block 7 on a DEPARTURE Strip is filed.requestedAltitude — what the flight
  // asked for, not what ATC assigned it. Amending it is not "issuing an
  // altitude change", and an interlock that fired here would void an AR every
  // time somebody corrected a flight plan.
  mustAct(efsp, c.AP, 'AP', fresh(tanker), { kind: 'SetBlock', blockId: '7', value: '260' });
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE');
});

test('sortie 1c: after rendezvous the interlock is spent and an established AR survives a climb', () => {
  const tanker = flight('SHELL74');
  const rx = flight('VIPER41');
  const relation = declareAr([tanker, rx], 'SHELL74');

  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'MarkRendezvous' });
  mustAct(efsp, c.AP, 'AP', fresh(tanker), { kind: 'SetBlock', blockId: '21', value: '260' });

  const after = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(after.state, 'ACTIVE', 'voiding an established AR on every altitude change would make the relation unusable');
  assert.equal(efsp.flightDataStore.getFlightData(rx.flightDataId).tofi.separationRegime, 'MARSA');
});

// ── Sortie 2 — what a pilot asks for ────────────────────────────────────────

test('sortie 2: "SHELL75, VIPER52 is joining you" — a late receiver, mid-AR', () => {
  const tanker = flight('SHELL75');
  const rx1 = flight('VIPER51');
  const relation = declareAr([tanker, rx1], 'SHELL75');
  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'MarkRendezvous' });

  const rx2 = flight('VIPER52');
  const joined = mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'AddParticipant', flightDataId: rx2.flightDataId });

  assert.equal(joined.participants.length, 3);
  assert.equal(efsp.flightDataStore.getFlightData(rx2.flightDataId).tofi.separationRegime, 'MARSA');
  // The relation never ended, so nothing about it was lost.
  assert.equal(joined.startEvent, 'TANKER_ACCEPTED');
  assert.equal(joined.declaringCallsign, 'SHELL75');
  assert.ok(joined.rendezvousAt, 'the rendezvous that already happened still did');
});

test('sortie 3: one receiver breaks off; the AR continues until the last one leaves', () => {
  const tanker = flight('SHELL76');
  const rx1 = flight('VIPER61');
  const rx2 = flight('VIPER62');
  const relation = declareAr([tanker, rx1, rx2], 'SHELL76');

  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'RemoveParticipant', flightDataId: rx2.flightDataId });
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE');
  assert.equal(efsp.flightDataStore.getFlightData(rx2.flightDataId).tofi.separationRegime, 'ATC');
  assert.equal(efsp.flightDataStore.getFlightData(tanker.flightDataId).tofi.separationRegime, 'MARSA');

  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'RemoveParticipant', flightDataId: rx1.flightDataId });
  const ended = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(ended.state, 'ENDED');
  assert.equal(efsp.flightDataStore.getFlightData(tanker.flightDataId).tofi.separationRegime, 'ATC');
});

test('sortie 4: the tanker lands mid-AR — the relation ends, and it is not an alert', () => {
  const tanker = flight('SHELL77');
  const rx = flight('VIPER71');
  const relation = declareAr([tanker, rx], 'SHELL77');

  const result = efsp.handleMessage(c.AP.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: 'cm-drop',
    facilityId: 'INCIRLIK', actingPositionId: 'AP',
    stripId: tanker.stripId, baseRev: fresh(tanker).rev,
    op: { kind: 'DropStrip' },
  });
  assert.equal(result.ack.ok, true);
  // The relation ending has to reach the OTHER participant's controller, who
  // did nothing and is still separating — or not — on a stale badge. Same
  // docs/adr/0022 class as the interlock's own broadcast.
  assert.ok(slot(result, 'marsa'), 'the receiver\'s board hears that the AR is over');
  assert.equal(slot(result, 'marsa').marsa.updated[0].endedBy, 'PARTICIPANT_RETIRED');

  const after = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(after.state, 'ENDED');
  // A flight finishing is not an interlock firing, and must not render as one.
  assert.equal(after.endedBy, 'PARTICIPANT_RETIRED');
  assert.equal(after.voidedBy, null);
  assert.equal(efsp.flightDataStore.getFlightData(rx.flightDataId).tofi.separationRegime, 'ATC');
  assert.equal(efsp.marsaStore.activeFor(rx.flightDataId), null);
});

test('sortie 5: a controller cannot take separation back by editing the Block', () => {
  const tanker = flight('SHELL78');
  const rx = flight('VIPER81');
  const relation = declareAr([tanker, rx], 'SHELL78');

  // Two answers to "who is separating these aircraft" is the defect class, so
  // while the relation is ACTIVE it owns the field.
  const refused = act(efsp, c.AP, 'AP', fresh(rx), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /active MARSA relation declared by SHELL78/);
  assert.match(refused.detail, /end or void it/);
  assert.equal(efsp.flightDataStore.getFlightData(rx.flightDataId).tofi.separationRegime, 'MARSA');

  // The way out is the action the controller actually wanted, and it sets the
  // regime back as part of doing so.
  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'VoidMarsa', note: 'ATC resuming separation' });
  assert.equal(efsp.flightDataStore.getFlightData(rx.flightDataId).tofi.separationRegime, 'ATC');
  assert.equal(act(efsp, c.AP, 'AP', fresh(rx), { kind: 'SetBlock', blockId: 'SREG', value: 'DUE_REGARD' }).ok, true);
});

test('sortie 6: an unattributed declaration is refused — §9.2 rule 1 makes it the tanker\'s', () => {
  const tanker = flight('SHELL79');
  const rx = flight('VIPER91');
  const ack = marsaAct(efsp, c.AP, 'AP', null, {
    kind: 'DeclareMarsa', participants: [tanker.flightDataId, rx.flightDataId],
    startEvent: 'LOCAL_DECLARATION', endCondition: 'ATC_SEPARATION_ESTABLISHED',
    declaringCallsign: '',
  });
  assert.equal(ack.ok, false);
  assert.match(ack.detail, /callsign that declared it/);
  // (A range Position's refusal is by CLASS and needs no flights at all, so it
  // is asserted against permission.canDeclareMarsa in efsp-permission.test.mjs
  // rather than here — this file ships no airspaces, so the RANGES Facility
  // has no derived Positions to act as.)
});

test('sortie 6a: the interlock covers an ARRIVAL Strip — cleared altitude and radar vector', () => {
  const tanker = flight('SHELL83');
  const inbound = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'VIPER04', aircraftType: 'F16', originAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT' },
  });

  const altitudeAr = declareAr([tanker, inbound], 'SHELL83');
  // ARRIVAL's Block 7 IS the assigned altitude (annotation-routed, so it
  // carries §3.7's append-only model) — the opposite of DEPARTURE's Block 7.
  mustAct(efsp, c.AP, 'AP', fresh(inbound), { kind: 'SetBlock', blockId: '7', value: '100' });
  assert.equal(efsp.marsaStore.getRelation(altitudeAr.marsaId).voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');

  const vectorAr = declareAr([fresh(tanker), fresh(inbound)], 'SHELL83');
  mustAct(efsp, c.AP, 'AP', fresh(inbound), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '310' });
  assert.equal(efsp.marsaStore.getRelation(vectorAr.marsaId).voidedBy, 'CONTROLLER_COURSE_CHANGE');
});

test('sortie 6b: the interlock covers an OVERFLIGHT Strip, which had no assignment Block at all', () => {
  // Before docs/adr/0051 an OVERFLIGHT Strip carried no Block meaning "ATC
  // assigned this course/altitude", so a MARSA participant transiting on one
  // could be vectored or climbed with nothing voiding the relation — the
  // acceptance criterion passing on two strip types and quietly not holding on the
  // third.
  const tanker = flight('SHELL84');
  const transit = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-overflight', rackId: 'main', stripType: 'OVERFLIGHT',
    flightData: { callsign: 'VIPER05', aircraftType: 'F16', departureAirport: 'LTAC', destinationAirport: 'LTAI', route: 'DCT' },
  });

  const climbAr = declareAr([tanker, transit], 'SHELL84');
  mustAct(efsp, c.AP, 'AP', fresh(transit), { kind: 'SetBlock', blockId: '7A', value: '240' });
  assert.equal(efsp.marsaStore.getRelation(climbAr.marsaId).voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');

  const vectorAr = declareAr([fresh(tanker), fresh(transit)], 'SHELL84');
  mustAct(efsp, c.AP, 'AP', fresh(transit), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '180' });
  assert.equal(efsp.marsaStore.getRelation(vectorAr.marsaId).voidedBy, 'CONTROLLER_COURSE_CHANGE');
});

test('sortie 6c: confirming a vacated altitude issues nothing, so it voids nothing', () => {
  const tanker = flight('SHELL85');
  const inbound = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'VIPER06', aircraftType: 'F16', originAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT' },
  });
  mustAct(efsp, c.AP, 'AP', fresh(inbound), { kind: 'SetBlock', blockId: '7', value: '150' });

  const relation = declareAr([tanker, inbound], 'SHELL85');
  // §3.7 rule 3's confirmVacated carries no value and issues no instruction —
  // it records that the aircraft has LEFT an altitude assigned earlier. An
  // interlock firing here would void a live AR at the one moment nothing was
  // issued.
  mustAct(efsp, c.AP, 'AP', fresh(inbound), { kind: 'SetBlock', blockId: '7', confirmVacated: true });
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE');
});

test('sortie 7: claiming a Position you are not Primary at is refused on this path too', () => {
  const tanker = flight('SHELL80');
  const rx = flight('VIPER01');
  // docs/adr/0029 — actingPositionId is an untrusted client claim, and a new
  // dispatch path is exactly where that check gets forgotten.
  const ack = marsaAct(efsp, c.AP, 'CTR', null, {
    kind: 'DeclareMarsa', participants: [tanker.flightDataId, rx.flightDataId],
    startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL80',
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'NOT_HOLDING_POSITION');
});

test('sortie 8: the board comes back from a restart with the AR still up', () => {
  const tanker = flight('SHELL81');
  const rx = flight('VIPER02');
  const relation = declareAr([tanker, rx], 'SHELL81');
  mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'MarkRendezvous' });
  efsp.persist();

  const reborn = createEfsp();
  const restored = reborn.marsaStore.getRelation(relation.marsaId);
  assert.equal(restored.state, 'ACTIVE', 'a verbal declaration is not made untrue by a crc-sync restart');
  assert.ok(restored.rendezvousAt);
  assert.equal(reborn.flightDataStore.getFlightData(rx.flightDataId).tofi.separationRegime, 'MARSA');
  // And the interlock is still correctly DISarmed for it.
  assert.equal(reborn.marsaStore.voidForAssignment(rx.flightDataId, { cause: 'CONTROLLER_COURSE_CHANGE' }), null);
});

test('sortie 9: the void reaches every client on the same round trip as the clearance', () => {
  const tanker = flight('SHELL82');
  const rx = flight('VIPER03');
  const relation = declareAr([tanker, rx], 'SHELL82');

  // The raw handleMessage result, not the helper's ack — this is what ws-hub.js
  // broadcasts, and a correct server-side change no client ever hears about is
  // the bug docs/adr/0022 found for peer Strips.
  const result = efsp.handleMessage(c.AP.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: 'cm-broadcast',
    facilityId: 'INCIRLIK', actingPositionId: 'AP',
    stripId: rx.stripId, baseRev: fresh(rx).rev,
    op: { kind: 'SetBlock', blockId: '20', value: '090' },
  });
  assert.equal(result.ack.ok, true);
  assert.ok(slot(result, 'primary'), 'the Strip change');
  assert.ok(slot(result, 'marsa'), 'and the void, together');
  assert.equal(slot(result, 'marsa').type, 'efsp-marsa-delta');
  assert.equal(slot(result, 'marsa').marsa.updated[0].marsaId, relation.marsaId);
  assert.equal(slot(result, 'marsa').marsa.updated[0].voidedBy, 'CONTROLLER_COURSE_CHANGE');
});

test('sortie 10: a reconnecting controller still sees the relation that just voided', () => {
  // §9.2 rule 5 puts the relation on every participant Strip, and a VOIDED one
  // is precisely what the controller who just missed it needs — dropping
  // finished relations from the snapshot would make the alert disappear for
  // exactly the person it is for.
  const snapshot = efsp.snapshotFor();
  assert.ok(Array.isArray(snapshot.marsa));
  assert.ok(snapshot.marsa.some(r => r.state === 'VOIDED' && r.voidedBy === 'CONTROLLER_COURSE_CHANGE'));
  assert.ok(snapshot.marsa.some(r => r.state === 'ACTIVE'));
});

// ── Sortie 11 — a pilot request that must NOT fire the interlock ────────────

test('sortie 11: "SHELL71, VIPER11 has a hung store" does not void the AR', () => {
  // The pilot-request axis (docs/adr/0050's habit), pointed at Phase 2's two
  // new Blocks. A receiver reporting a hung store mid-join is one of the most
  // likely things to actually happen on an AR, and the controller's response
  // is to record it on the Strip — Block 3G, sitting in the 3-family right
  // beside Block 20 and 21, which DO void.
  //
  // §9.2 rule 2 fires on "any SetBlock on assigned heading or altitude", and
  // the interlock deliberately fires on any write to a tagged Block whether
  // the value changed or not (docs/adr/0051). Both of those make it cheap to
  // over-tag, and an ordnance declaration issues no instruction to anybody —
  // voiding an AR because a pilot reported a malfunction would be the
  // interlock doing the opposite of its job, at the worst possible moment.
  const tanker = flight('SHELL73');
  const rx = flight('VIPER31');
  const relation = declareAr([tanker, rx], 'SHELL73');
  assert.equal(relation.rendezvousAt, null, 'armed — this is the case that would void');

  const hung = mustAct(efsp, c.AP, 'AP', fresh(rx), { kind: 'SetBlock', blockId: '3G', value: 'HUNG' });
  assert.equal(efsp.flightDataStore.getFlightData(hung.flightDataId).military.ordnanceState, 'HUNG');
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE',
    'reporting a hung store is not ATC issuing a course or an altitude');

  // Same for the hook requirement, and on the tanker rather than the receiver.
  mustAct(efsp, c.AP, 'AP', fresh(tanker), { kind: 'SetBlock', blockId: '3F', value: true });
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE');

  // And the interlock is still live — the relation is intact because nothing
  // fired, not because it stopped working.
  mustAct(efsp, c.AP, 'AP', fresh(rx), { kind: 'SetBlock', blockId: '21', value: '210' });
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'VOIDED');
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');
});

test('sortie 12: a controller cannot declare an ordnance state the panel does not offer', () => {
  // The picker makes this unreachable from the UI; the server refuses it
  // anyway, because a dot-command, a replayed Mutation and a second client
  // all reach SetBlock without going through the picker.
  const solo = flight('VIPER32');
  const bad = act(efsp, c.AP, 'AP', solo, { kind: 'SetBlock', blockId: '3G', value: 'WINCHESTER' });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /invalid ordnance state/);
  assert.equal(efsp.flightDataStore.getFlightData(solo.flightDataId).military.ordnanceState, 'CLEAN');
});

// docs/adr/0118 (T14, H134 LT-RQ15 a): the "MARSA voided" notice stands until a controller holding one of the Strips acknowledges it.
test('sortie 13: the void notice is acknowledged once, by a controller holding one of the Strips', () => {
  const tanker = flight('SHELL77');
  const rx = flight('VIPER77');
  const relation = declareAr([tanker, rx], 'SHELL77');
  const early = marsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'AcknowledgeVoid' });
  assert.equal(early.ok, false, 'nothing to acknowledge while it is ACTIVE');
  assert.match(early.detail, /not voided/);

  mustAct(efsp, c.AP, 'AP', fresh(rx), { kind: 'SetBlock', blockId: '20', value: '090' });
  const voided = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(voided.state, 'VOIDED');
  assert.equal(voided.voidAcknowledgedAt, null, 'the notice stands');

  const stranger = marsaAct(efsp, c.CTR, 'CTR', relation.marsaId, { kind: 'AcknowledgeVoid' });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.reason, 'PERMISSION_DENIED');
  assert.match(stranger.detail, /holds none of these Strips/);

  const acked = mustMarsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'AcknowledgeVoid' });
  assert.equal(acked.voidAcknowledgedBy, 'AP');
  assert.ok(Number.isFinite(acked.voidAcknowledgedAt));
  assert.equal(acked.transitions.at(-1).reason, 'VOID_ACKNOWLEDGED');
  const again = marsaAct(efsp, c.AP, 'AP', relation.marsaId, { kind: 'AcknowledgeVoid' });
  assert.equal(again.ok, false);
  assert.match(again.detail, /already acknowledged/);
});
