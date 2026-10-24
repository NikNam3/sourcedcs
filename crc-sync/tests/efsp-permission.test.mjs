import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  canCreateStripType, canActOnState, tofiCounterparts,
  CREATE_STRIP_TYPE_PERMISSIONS, STATE_OWNERS_BY_STRIP_TYPE,
  DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, MISSION_STATE_OWNERS,
  OP_KINDS, COORDINATION_OP_KINDS, AP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS,
  NO_STRIP_OP_CLASSES,
  TACTICAL_CAPABILITIES, READ_SCOPES, handBackTargetsFor, tofiAnswererFor, readScopeFor,
} = await import('../src/efsp/permission.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { PERMISSIONS, canMutate, canCorrelate, canDeclareMarsa } = (await import('./helpers/permission.mjs')).classPermission(facilityConfig);

test('canMutate has exactly two parameters — structurally cannot accept a "signed-on set" (guards defect D21 by construction)', () => {
  assert.equal(canMutate.length, 2);
});

test('canCreateStripType has exactly two parameters — same D21 guard, for the role-scoped CreateStrip axis', () => {
  assert.equal(canCreateStripType.length, 2);
});

test('every INCIRLIK Position (OPS, CD, GC, LC, AP) is defined in the permission table', () => {
  for (const id of ['OPS', 'CD', 'GC', 'LC', 'AP']) {
    assert.ok(PERMISSIONS[id], id);
  }
});

test('OPS, CD and AP pass the coarse CreateStrip gate (they originate Strips, for different roles; CD since H164 FT-Q2); GC/LC do not', () => {
  assert.equal(canMutate('OPS', 'CreateStrip'), true);
  assert.equal(canMutate('CD', 'CreateStrip'), true);
  assert.equal(canMutate('AP', 'CreateStrip'), true);
  for (const id of ['GC', 'LC']) {
    assert.equal(canMutate(id, 'CreateStrip'), false, id);
  }
});

test('every INCIRLIK/CENTER Position may perform every non-CreateStrip, non-coordination, non-AP/CTR-only, non-TOFI op kind (WP4A\'s coordination primitives, TOFI, and docs/adr/0023\'s ConvertToArrival are op-kind-level asymmetries, tested separately below)', () => {
  const nonCreate = OP_KINDS.filter(k => k !== 'CreateStrip' && !COORDINATION_OP_KINDS.includes(k) && k !== 'ControlRelease' && !AP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k) && !AIRSPACE_ENTRY_OP_KINDS.includes(k));
  for (const id of ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR']) {
    for (const op of nonCreate) {
      assert.equal(canMutate(id, op), true, `${id} / ${op}`);
    }
  }
});

test('ControlRelease (docs/adr/0101) goes where a HANDOFF goes: AP and CTR, never OPS/CD/GC/LC', () => {
  for (const id of ['AP', 'CTR']) assert.equal(canMutate(id, 'ControlRelease'), true, id);
  for (const id of ['OPS', 'CD', 'GC', 'LC']) assert.equal(canMutate(id, 'ControlRelease'), false, id);
});

test('only AP and CTR may use ConvertToArrival — CD/GC/LC/OPS get none, same restriction as the 5 coordination primitives, for the same underlying reason (docs/adr/0023)', () => {
  for (const id of ['AP', 'CTR']) assert.equal(canMutate(id, 'ConvertToArrival'), true, id);
  for (const id of ['OPS', 'CD', 'GC', 'LC']) assert.equal(canMutate(id, 'ConvertToArrival'), false, id);
});

// ── WP4A: the 5 coordination primitives (guide §4.6) — the SECOND genuine
// per-Position permission asymmetry, after OPS/AP's CreateStrip role split.

test('only AP and CTR may use any of the 5 cross-Facility coordination primitives — CD/GC/LC/OPS get none, since none of them ever touches a Facility boundary', () => {
  for (const op of COORDINATION_OP_KINDS) {
    assert.equal(canMutate('AP', op), true, op);
    assert.equal(canMutate('CTR', op), true, op);
    for (const id of ['OPS', 'CD', 'GC', 'LC']) {
      assert.equal(canMutate(id, op), false, `${id} / ${op}`);
    }
  }
});

test('CTR may CreateStrip (ARRIVAL only) and use every non-CreateStrip op kind, same shape as AP', () => {
  assert.equal(canMutate('CTR', 'CreateStrip'), true);
  for (const op of OP_KINDS.filter(k => k !== 'CreateStrip')) {
    assert.equal(canMutate('CTR', op), true, op);
  }
});

test('D21 regression: a controller holding both LC and CTR is refused HANDOFF while acting as LC, even though the same controller also holds CTR', () => {
  assert.equal(canMutate('LC', 'HANDOFF'), false);
  assert.equal(canMutate('CTR', 'HANDOFF'), true);
});

// ── WP4A second slice: TOFI (guide §4.6.3) and D12's MRU-refusal audit ───

test('every MRU/non-ATC Position (TAC_C2, AIC, GCI, JTAC) is defined in the permission table', () => {
  for (const id of ['TAC_C2', 'AIC', 'GCI', 'JTAC']) {
    assert.ok(PERMISSIONS[id], id);
  }
});

test('D12 audit, exhaustive: none of TAC_C2/AIC/GCI/JTAC may EVER use any of the 5 cross-Facility ATC coordination primitives (guide §4.1 rule 1) — a Military Radar Unit must never be offered ATC service', () => {
  for (const id of ['TAC_C2', 'AIC', 'GCI', 'JTAC']) {
    for (const op of COORDINATION_OP_KINDS) {
      assert.equal(canMutate(id, op), false, `${id} / ${op}`);
    }
  }
});

test('guide\'s own named D21 acceptance test (§13, line 1294): a HANDOFF attempted on a TAC_C2-owned Strip is refused, even though the same controller also holds CTR — evaluated per acting Position, never a union', () => {
  assert.equal(canMutate('TAC_C2', 'HANDOFF'), false);
  assert.equal(canMutate('CTR', 'HANDOFF'), true);
});

test('TOFI is granted only to CTR, TAC_C2 and GCI (guide §4.1\'s own Position table) — not APP (excluded even though it otherwise gets the full OP_KINDS set), not AIC ("works under TAC_C2\'s TOFI", never independently), not JTAC ("MISSION (read-only)")', () => {
  for (const id of ['CTR', 'TAC_C2', 'GCI']) assert.equal(canMutate(id, 'TOFI'), true, id);
  for (const id of ['AP', 'AIC', 'JTAC', 'OPS', 'CD', 'GC', 'LC']) assert.equal(canMutate(id, 'TOFI'), false, id);
});

test('TAC_C2 and GCI may CreateStrip (they originate MISSION Strips); AIC and JTAC may not', () => {
  assert.equal(canMutate('TAC_C2', 'CreateStrip'), true);
  assert.equal(canMutate('GCI', 'CreateStrip'), true);
  assert.equal(canMutate('AIC', 'CreateStrip'), false);
  assert.equal(canMutate('JTAC', 'CreateStrip'), false);
});

test('JTAC is granted exactly one op kind, TransferStrip (H40, docs/adr/0080): it hands a line back and does nothing else', () => {
  for (const op of OP_KINDS) assert.equal(canMutate('JTAC', op), op === 'TransferStrip', op);
});

test('tofiCounterparts resolves CTR to both TAC_C2 and GCI, and each of those back to CTR only', () => {
  assert.deepEqual(tofiCounterparts('CTR'), [
    { facilityId: 'TACTICAL', positionId: 'TAC_C2' },
    { facilityId: 'TACTICAL', positionId: 'GCI' },
  ]);
  assert.deepEqual(tofiCounterparts('TAC_C2'), [{ facilityId: 'CENTER', positionId: 'CTR' }]);
  assert.deepEqual(tofiCounterparts('GCI'), [{ facilityId: 'CENTER', positionId: 'CTR' }]);
  assert.deepEqual(tofiCounterparts('AIC'), []);
  assert.deepEqual(tofiCounterparts('NOT_A_POSITION'), []);
});

test('an unknown Position is denied every op kind', () => {
  for (const op of OP_KINDS) {
    assert.equal(canMutate('NOT_A_REAL_POSITION', op), false, op);
  }
});

test('an unknown op kind is denied for every known Position', () => {
  for (const id of ['OPS', 'CD', 'GC', 'LC', 'AP']) {
    assert.equal(canMutate(id, 'NotARealOpKind'), false, id);
  }
});

test('D21 regression (shape-only): evaluating GC and LC independently never grants either one the other\'s (identical) permissions beyond what each already has standalone', () => {
  // GC/LC are still permission-identical in Phase 2 — this asserts the
  // *shape* of the guard (independent evaluation, no shared mutable state
  // between calls). OPS-vs-AP below is the real behavioral case.
  const gcOnly = OP_KINDS.filter(op => canMutate('GC', op));
  const lcOnly = OP_KINDS.filter(op => canMutate('LC', op));
  assert.deepEqual(OP_KINDS.filter(op => canMutate('GC', op)), gcOnly);
  assert.deepEqual(OP_KINDS.filter(op => canMutate('LC', op)), lcOnly);
});

// ── canCreateStripType (Phase 2) — role-scoped CreateStrip ───────────────

test('OPS may originate DEPARTURE, and only DEPARTURE (guide §4.1 rule 3)', () => {
  assert.equal(canCreateStripType('OPS', 'DEPARTURE'), true);
  assert.equal(canCreateStripType('OPS', 'ARRIVAL'), false);
  assert.equal(canCreateStripType('OPS', 'OVERFLIGHT'), false);
});

// docs/adr/0023 reopens this — ADR 0014 had deliberately emptied AP's
// ARRIVAL right, reasoning ARRIVAL Strips at AP should only ever arrive
// via the real CTR->AP HANDOFF. Live testing against real ATC scenarios
// (a VFR aircraft picking up an IFR clearance airborne, an aircraft from
// an uncontrolled field with no flight plan on file) found that too
// narrow: those have no sending Facility to HANDOFF from at all.
test('AP may originate ARRIVAL and OVERFLIGHT directly (docs/adr/0023), but not DEPARTURE (that stays OPS-only, guide §4.1 rule 3)', () => {
  assert.equal(canCreateStripType('AP', 'ARRIVAL'), true);
  assert.equal(canCreateStripType('AP', 'OVERFLIGHT'), true);
  assert.equal(canCreateStripType('AP', 'DEPARTURE'), false);
});

test('CTR may originate ARRIVAL (docs/adr/0014) and OVERFLIGHT (docs/adr/0023), but not DEPARTURE', () => {
  assert.equal(canCreateStripType('CTR', 'ARRIVAL'), true);
  assert.equal(canCreateStripType('CTR', 'OVERFLIGHT'), true);
  assert.equal(canCreateStripType('CTR', 'DEPARTURE'), false);
});

test('CD may originate a DEPARTURE only (H164 FT-Q2 a)', () => {
  assert.equal(canCreateStripType('CD', 'DEPARTURE'), true);
  assert.equal(canCreateStripType('CD', 'ARRIVAL'), false);
  assert.equal(canCreateStripType('CD', 'OVERFLIGHT'), false);
});

test('GC/LC may originate no strip type at all', () => {
  for (const id of ['GC', 'LC']) {
    assert.equal(canCreateStripType(id, 'DEPARTURE'), false, id);
    assert.equal(canCreateStripType(id, 'ARRIVAL'), false, id);
    assert.equal(canCreateStripType(id, 'OVERFLIGHT'), false, id);
  }
});

test('every Position with CreateStrip in its coarse op-kind set has a CREATE_STRIP_TYPE_PERMISSIONS entry (even if empty) — nothing silently falls through to "allowed"', () => {
  for (const id of Object.keys(PERMISSIONS)) {
    if (PERMISSIONS[id].has('CreateStrip')) {
      assert.ok(CREATE_STRIP_TYPE_PERMISSIONS[id], `${id} passes the coarse CreateStrip gate but has no role-scoped entry`);
    }
  }
});

test('D21 regression: a controller holding both OPS and CTR is refused CreateStrip(stripType=ARRIVAL) while acting as OPS, even though the same controller also holds CTR', () => {
  // The point: canCreateStripType takes exactly one Position, structurally
  // — "also holds CTR" has nowhere to leak in. This is the first test in
  // the suite that can actually distinguish per-acting-Position evaluation
  // from a union bug, since OPS and CTR are genuinely permission-different
  // (Phase 1's CD/GC/LC were identical and couldn't reveal this).
  // (WP4A, docs/adr/0014: this used to pair OPS with AP, before AP's own
  // ARRIVAL right was narrowed away in favor of the real CTR->AP HANDOFF;
  // docs/adr/0023 reopened it, but OPS/CTR are still permission-different
  // in the direction this test checks — OPS never gets ARRIVAL.)
  assert.equal(canCreateStripType('OPS', 'ARRIVAL'), false);
  assert.equal(canCreateStripType('CTR', 'ARRIVAL'), true);
});

test('D21 regression, symmetric case: acting as CTR is refused CreateStrip(stripType=DEPARTURE) even though the same controller also holds OPS', () => {
  assert.equal(canCreateStripType('CTR', 'DEPARTURE'), false);
  assert.equal(canCreateStripType('OPS', 'DEPARTURE'), true);
});

test('canCreateStripType returns false for an unknown Position or an unknown stripType, never a throw', () => {
  assert.equal(canCreateStripType('NOT_A_POSITION', 'DEPARTURE'), false);
  assert.equal(canCreateStripType('OPS', 'NOT_A_STRIP_TYPE'), false);
});

// ── canActOnState — per-State authority (guide §3.4 "normally owned by") ──

test('canActOnState has exactly three parameters — same D21 guard shape, never a signed-on set', () => {
  assert.equal(canActOnState.length, 3);
});

// docs/adr/0022 bug fix — HANDED_OFF gained CTR, a deliberate deviation
// from guide §3.4's literal published column (which predates WP4A's
// cross-Facility replicas entirely and never anticipated a second
// Facility holding its own HANDED_OFF copy). Every other row still
// matches the guide exactly. Same precedent ARRIVAL_STATE_OWNERS.INBOUND
// already set for the reverse direction (docs/adr/0014).
test('DEPARTURE_STATE_OWNERS matches guide §3.4\'s "normally owned by" column, except HANDED_OFF\'s documented WP4A extension', () => {
  assert.deepEqual(DEPARTURE_STATE_OWNERS, {
    PROPOSED: ['OPS'],
    PENDING_CLEARANCE: ['CD'],
    CLEARED: ['CD'],
    HELD: ['CD', 'GC'],
    PUSHBACK: ['GC'],
    TAXI: ['GC'],
    RUNWAY_QUEUE: ['LC'],
    LUAW: ['LC'],
    DEPARTED: ['LC'],
    HANDED_OFF: ['AP', 'CTR'],
  });
});

test('the OPS-owns-PROPOSED case: OPS may act on PROPOSED, CD/GC/LC/AP may not', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PROPOSED'), true);
  for (const id of ['CD', 'GC', 'LC', 'AP']) {
    assert.equal(canActOnState(id, 'DEPARTURE', 'PROPOSED'), false, id);
  }
});

test('the exact hazard this was built for: OPS may NOT act on PENDING_CLEARANCE or CLEARED, even though OPS is perfectly capable of still owning that Strip (nothing transfers ownership automatically)', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PENDING_CLEARANCE'), false);
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'CLEARED'), false);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'PENDING_CLEARANCE'), true);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'CLEARED'), true);
});

test('HELD is shared between CD and GC (guide §3.4: "CD / GC"), no one else', () => {
  assert.equal(canActOnState('CD', 'DEPARTURE', 'HELD'), true);
  assert.equal(canActOnState('GC', 'DEPARTURE', 'HELD'), true);
  for (const id of ['OPS', 'LC', 'AP']) {
    assert.equal(canActOnState(id, 'DEPARTURE', 'HELD'), false, id);
  }
});

test('DEPARTED is LC\'s (the one about to press the real Hand Off to AP), not AP\'s — AP only owns HANDED_OFF, after the transfer has already happened', () => {
  assert.equal(canActOnState('LC', 'DEPARTURE', 'DEPARTED'), true);
  assert.equal(canActOnState('AP', 'DEPARTURE', 'DEPARTED'), false);
  assert.equal(canActOnState('AP', 'DEPARTURE', 'HANDED_OFF'), true);
});

test('ARRIVAL states have their own authority table, independent of DEPARTURE\'s — same state-name overlap trap as EfspState FINAL vs Strip Role FINAL', () => {
  assert.equal(canActOnState('AP', 'ARRIVAL', 'INBOUND'), true);
  assert.equal(canActOnState('LC', 'ARRIVAL', 'HANDED_TO_TOWER'), true);
  assert.equal(canActOnState('LC', 'ARRIVAL', 'FINAL'), true);
  assert.equal(canActOnState('LC', 'ARRIVAL', 'LANDED'), true);
  assert.equal(canActOnState('GC', 'ARRIVAL', 'TAXI_IN'), true);
  assert.equal(canActOnState('OPS', 'ARRIVAL', 'INBOUND'), false);
});

test('canActOnState returns false for DROPPED (terminal, no entry), an unknown state, or an unknown role — never a throw', () => {
  assert.equal(canActOnState('LC', 'DEPARTURE', 'DROPPED'), false);
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'NOT_A_STATE'), false);
  assert.equal(canActOnState('OPS', 'OVERFLIGHT', 'PROPOSED'), false); // OVERFLIGHT is a real role (docs/adr/0023), but PROPOSED isn't one of its states
  assert.equal(canActOnState('OPS', 'MISSION', 'TASKED'), false); // MISSION is a real role (WP4A second slice) but OPS never owns any of its states
  assert.equal(canActOnState('TAC_C2', 'MISSION', 'ANYTHING'), false); // ANYTHING isn't a real MISSION state
});

// WP4A second slice — MISSION's own lifecycle authority table, mirroring
// OVERFLIGHT's "self-originator owns it" precedent.
test('MISSION states have their own authority table — both TAC_C2 and GCI may act on every state, AIC/JTAC/OPS may not', () => {
  for (const state of ['TASKED', 'AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB']) {
    assert.equal(canActOnState('TAC_C2', 'MISSION', state), true, state);
    assert.equal(canActOnState('GCI', 'MISSION', state), true, state);
    assert.equal(canActOnState('AIC', 'MISSION', state), false, state);
    assert.equal(canActOnState('JTAC', 'MISSION', state), false, state);
  }
  assert.equal(canActOnState('OPS', 'MISSION', 'TASKED'), false);
});

test('TAC_C2 and GCI may originate MISSION, and only MISSION; AIC/JTAC may originate no strip type at all', () => {
  assert.equal(canCreateStripType('TAC_C2', 'MISSION'), true);
  assert.equal(canCreateStripType('TAC_C2', 'ARRIVAL'), false);
  assert.equal(canCreateStripType('GCI', 'MISSION'), true);
  for (const id of ['AIC', 'JTAC']) {
    assert.equal(canCreateStripType(id, 'MISSION'), false, id);
  }
});

// docs/adr/0023 — OVERFLIGHT's own lifecycle authority table, mirroring
// ARRIVAL's shape: whichever Position(s) may originate one may also act on it.
test('OVERFLIGHT states have their own authority table — both AP and CTR may act on every live state, OPS may not', () => {
  for (const state of ['INBOUND', 'IN_SECTOR', 'HANDED_OFF']) {
    assert.equal(canActOnState('AP', 'OVERFLIGHT', state), true, state);
    assert.equal(canActOnState('CTR', 'OVERFLIGHT', state), true, state);
    assert.equal(canActOnState('OPS', 'OVERFLIGHT', state), false, state);
  }
  assert.equal(canActOnState('CTR', 'OVERFLIGHT', 'TRANSITING'), false);
});

test('every state present in DEPARTURE_STATES/ARRIVAL_STATES/OVERFLIGHT_STATES/MISSION_STATES except the terminal DROPPED has a STATE_OWNERS_BY_STRIP_TYPE entry — nothing silently falls through to "no one may act"', async () => {
  const { DEPARTURE_STATES, ARRIVAL_STATES, OVERFLIGHT_STATES, MISSION_STATES } = await import('../src/efsp/nla.js');
  for (const state of DEPARTURE_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_STRIP_TYPE.DEPARTURE[state], `DEPARTURE/${state}`);
  }
  for (const state of ARRIVAL_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_STRIP_TYPE.ARRIVAL[state], `ARRIVAL/${state}`);
  }
  for (const state of OVERFLIGHT_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_STRIP_TYPE.OVERFLIGHT[state], `OVERFLIGHT/${state}`);
  }
  for (const state of MISSION_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_STRIP_TYPE.MISSION[state], `MISSION/${state}`);
  }
});


// ── the RANGE slice ──────────────────────────────────────────────────────

test('only AP and CTR may approve a flight into an airspace — the Positions that hold an airborne flight', () => {
  for (const opKind of AIRSPACE_ENTRY_OP_KINDS) {
    assert.equal(canMutate('AP', opKind), true, opKind);
    assert.equal(canMutate('CTR', opKind), true, opKind);
    for (const id of ['OPS', 'CD', 'GC', 'LC']) {
      assert.equal(canMutate(id, opKind), false, `${id} ${opKind}`);
    }
  }
});

test('a range Position works no Strips at all — refused every op kind by class, not by being absent from the table', () => {
  // Guide §4.1's RANGE row: Class "Using agency", Primitives "no strip
  // primitives — owns airspace state", Strip Roles "none". The refusal has
  // to be a rule rather than a side effect of PERMISSIONS having no entry,
  // because the RANGES Facility's Positions are derived from the airspace
  // config and so are never hand-listed there.
  assert.ok(NO_STRIP_OP_CLASSES.has('USING_AGENCY'));
});


// ── WP6: MARSA (§9.2, docs/adr/0051) ─────────────────────────────────────

test('canDeclareMarsa has exactly one parameter — the same D21 guard canMutate has', () => {
  assert.equal(canDeclareMarsa.length, 1);
});

test('a range Position declares no MARSA, for the same reason it correlates nothing', () => {
  // Refused by CLASS, not by omission from a table — the RANGES Facility's
  // Positions are derived from the airspace config (docs/adr/0035) and are
  // never hand-listed, so there is no entry to leave out. A Position that
  // works no Strips has no flights to put into a relation.
  // This file configures no airspaces, so the RANGES Facility has no derived
  // Positions to name here. What IS assertable, and is the whole of the rule:
  // whatever canCorrelate refuses by class, canDeclareMarsa refuses
  // identically — both gate on _worksNoStrips and nothing else, so a Position
  // of class USING_AGENCY is refused by both wherever one exists.
  for (const id of ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR', 'TAC_C2', 'GCI', 'AIC', 'JTAC']) {
    assert.equal(canDeclareMarsa(id), canCorrelate(id), id);
  }
});

test('an MRU may declare MARSA — D12 is about ATC service, and MARSA is its opposite', () => {
  // D12 refuses TAC_C2/GCI/AIC/JTAC the 5 coordination primitives because an
  // MRU must never be asked to provide ATC SERVICE. MARSA is the military
  // authority saying it will separate its OWN aircraft, which is precisely the
  // MRU's assertion to make — and §9.2 rule 1 puts the declaration with the
  // tanker, verbally, so whichever Position takes that call records it.
  for (const id of ['TAC_C2', 'GCI', 'AIC']) {
    assert.equal(canDeclareMarsa(id), true, id);
    for (const opKind of COORDINATION_OP_KINDS) {
      assert.equal(canMutate(id, opKind), false, `${id} must still be refused ${opKind}`);
    }
  }
});

test('MARSA is NOT in OP_KINDS — a new op kind there would be picked up silently by every filtered grant', () => {
  // PERMISSIONS' entries for OPS/AP/CTR are built with .filter() over
  // OP_KINDS, so anything added there lands in them without a line being
  // written. That is the maximally-permissive trap the module comment warns
  // about, which is why MARSA has its own predicate instead.
  for (const kind of OP_KINDS) {
    assert.ok(!/Marsa/i.test(kind), `${kind} should not be a Strip Mutation op kind`);
  }
});

// ── runway status (guide §9.7, docs/adr/0061) ─────────────────────────────────

const { canActOnRunwayStatus, RUNWAY_STATUS_OP_OWNERS } = await import('../src/efsp/permission.js');

test('canActOnRunwayStatus has exactly two parameters — never a signed-on set (D21 by construction)', () => {
  assert.equal(canActOnRunwayStatus.length, 2);
});

test('no runway-status op kind is in OP_KINDS — a new kind there would be picked up by every filtered grant', () => {
  for (const kind of Object.keys(RUNWAY_STATUS_OP_OWNERS)) {
    assert.ok(!OP_KINDS.includes(kind), `${kind} must not be a Strip Mutation op kind`);
    for (const positionId of Object.keys(PERMISSIONS)) {
      assert.equal(canMutate(positionId, kind), false, `${positionId} must not get ${kind} through canMutate`);
    }
  }
});

test('RUNWAY_STATUS_OP_OWNERS: LC alone closes, opens and suspends; OPS completes and inspects; LC runs a runway change; OPS and AP acknowledge', () => {
  for (const kind of ['CloseRunway', 'OpenRunway', 'BeginRunwayWorks', 'AcceptRunwayRequest', 'RejectRunwayRequest',
    'ProposeRunwayChange', 'SelfCoordinateRunwayChange', 'WithdrawRunwayChange', 'BeginRunwayChange', 'CompleteRunwayChange']) {
    assert.deepEqual(RUNWAY_STATUS_OP_OWNERS[kind], ['LC'], kind);
  }
  assert.deepEqual(RUNWAY_STATUS_OP_OWNERS.CompleteRunwayWorks, ['OPS']);
  assert.deepEqual(RUNWAY_STATUS_OP_OWNERS.CompleteInspection, ['OPS']);
  assert.deepEqual(RUNWAY_STATUS_OP_OWNERS.AckRunwayChange, ['OPS', 'AP']);
  assert.deepEqual(RUNWAY_STATUS_OP_OWNERS.RejectRunwayChange, ['OPS', 'AP']);
  // Everyone at the field but tower ASKS (decisions.md H18).
  // AP asks too (L18, ADR 0075) but, like everyone, never closes or opens. No RSU (docs/adr/0126).
  assert.deepEqual(RUNWAY_STATUS_OP_OWNERS.RequestRunwayStatus, ['OPS', 'CD', 'GC', 'AP']);
});

test('a range Position, an MRU, CTR and an unknown Position are refused every runway-status op', () => {
  for (const positionId of ['RANGE', 'R-2301', 'TAC_C2', 'GCI', 'AIC', 'JTAC', 'CTR', 'NOBODY', undefined]) {
    for (const kind of Object.keys(RUNWAY_STATUS_OP_OWNERS)) {
      assert.equal(canActOnRunwayStatus(positionId, kind), false, `${positionId} / ${kind}`);
    }
  }
  assert.equal(canActOnRunwayStatus('LC', 'toString'), false);
  assert.equal(canActOnRunwayStatus('LC', 'PaintRunway'), false);
});

test('D21 regression: a controller holding both LC and AP cannot satisfy BeginRunwayChange from one acting Position', () => {
  // Evaluated per acting Position, never a union of what is held: an
  // acknowledgement sent as LC never counts as AP's (decisions.md S-Q24).
  assert.equal(canActOnRunwayStatus('LC', 'AckRunwayChange'), false);
  assert.equal(canActOnRunwayStatus('AP', 'BeginRunwayChange'), false);
  assert.equal(canActOnRunwayStatus('AP', 'AckRunwayChange'), true);
  assert.equal(canActOnRunwayStatus('LC', 'BeginRunwayChange'), true);
});

// ── L23: the tactical capability table and B5 (docs/adr/0080) ───────────────

test('TACTICAL_CAPABILITIES: every row names a Position of TACTICAL, values are in their enums, hand-back targets are TACTICAL Positions', () => {
  const tactical = new Set(facilityConfig.getPositionSet('TACTICAL'));
  for (const [positionId, row] of Object.entries(TACTICAL_CAPABILITIES)) {
    assert.ok(tactical.has(positionId), `${positionId} is a TACTICAL Position`);
    assert.ok(READ_SCOPES.includes(row.readScope), `${positionId} readScope`);
    for (const target of row.handBackTo) assert.ok(tactical.has(target), `${positionId} hands back to ${target}`);
    if (row.tofiAnsweredBy) assert.ok(tactical.has(row.tofiAnsweredBy), `${positionId} tofiAnsweredBy`);
  }
});

test('the accessors read the table; a Position with no row gets the defaults', () => {
  assert.deepEqual(handBackTargetsFor('JTAC'), ['TAC_C2']);
  assert.deepEqual(handBackTargetsFor('AIC'), ['TAC_C2']);
  assert.equal(handBackTargetsFor('TAC_C2'), null);
  assert.equal(handBackTargetsFor('OPS'), null);
  assert.equal(tofiAnswererFor('AIC'), 'TAC_C2');
  assert.equal(tofiAnswererFor('JTAC'), null);
  assert.equal(tofiAnswererFor('GCI'), null, 'GCI has its own TOFI grant and no row');
  assert.equal(readScopeFor('JTAC'), 'OWNED');
  for (const id of ['AIC', 'TAC_C2', 'GCI', 'OPS', 'CTR', 'NOBODY']) assert.equal(readScopeFor(id), 'ALL', id);
});

test('B5: a JTAC has no scope, so it correlates nothing and declares no MARSA; every other Position is unchanged', () => {
  assert.equal(canCorrelate('JTAC'), false);
  assert.equal(canDeclareMarsa('JTAC'), false);
  for (const id of ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR', 'TAC_C2', 'GCI', 'AIC']) {
    assert.equal(canCorrelate(id), true, id);
    assert.equal(canDeclareMarsa(id), true, id);
  }
  assert.equal(canCorrelate.length, 1);
  assert.equal(canDeclareMarsa.length, 1);
});
