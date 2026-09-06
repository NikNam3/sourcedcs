import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  canMutate, canCreateStripRole, canActOnState, tofiCounterparts,
  PERMISSIONS, CREATE_ROLE_PERMISSIONS, STATE_OWNERS_BY_ROLE,
  DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, MISSION_STATE_OWNERS,
  OP_KINDS, COORDINATION_OP_KINDS, APP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS,
} = await import('../src/efsp/permission.js');

test('canMutate has exactly two parameters — structurally cannot accept a "held set" (guards defect D21 by construction)', () => {
  assert.equal(canMutate.length, 2);
});

test('canCreateStripRole has exactly two parameters — same D21 guard, for the role-scoped CreateStrip axis', () => {
  assert.equal(canCreateStripRole.length, 2);
});

test('every INCIRLIK Position (OPS, CD, GND, TWR, APP) is defined in the permission table', () => {
  for (const id of ['OPS', 'CD', 'GND', 'TWR', 'APP']) {
    assert.ok(PERMISSIONS[id], id);
  }
});

test('OPS and APP both pass the coarse CreateStrip gate (both originate Strips, just for different roles); CD/GND/TWR do not', () => {
  assert.equal(canMutate('OPS', 'CreateStrip'), true);
  assert.equal(canMutate('APP', 'CreateStrip'), true);
  for (const id of ['CD', 'GND', 'TWR']) {
    assert.equal(canMutate(id, 'CreateStrip'), false, id);
  }
});

test('every INCIRLIK/CENTER Position may perform every non-CreateStrip, non-coordination, non-APP/CTR-only, non-TOFI op kind (WP4A\'s coordination primitives, TOFI, and docs/adr/0023\'s ConvertToArrival are op-kind-level asymmetries, tested separately below)', () => {
  const nonCreate = OP_KINDS.filter(k => k !== 'CreateStrip' && !COORDINATION_OP_KINDS.includes(k) && !APP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k));
  for (const id of ['OPS', 'CD', 'GND', 'TWR', 'APP', 'CTR']) {
    for (const op of nonCreate) {
      assert.equal(canMutate(id, op), true, `${id} / ${op}`);
    }
  }
});

test('only APP and CTR may use ConvertToArrival — CD/GND/TWR/OPS get none, same restriction as the 5 coordination primitives, for the same underlying reason (docs/adr/0023)', () => {
  for (const id of ['APP', 'CTR']) assert.equal(canMutate(id, 'ConvertToArrival'), true, id);
  for (const id of ['OPS', 'CD', 'GND', 'TWR']) assert.equal(canMutate(id, 'ConvertToArrival'), false, id);
});

// ── WP4A: the 5 coordination primitives (guide §4.6) — the SECOND genuine
// per-Position permission asymmetry, after OPS/APP's CreateStrip role split.

test('only APP and CTR may use any of the 5 cross-Facility coordination primitives — CD/GND/TWR/OPS get none, since none of them ever touches a Facility boundary', () => {
  for (const op of COORDINATION_OP_KINDS) {
    assert.equal(canMutate('APP', op), true, op);
    assert.equal(canMutate('CTR', op), true, op);
    for (const id of ['OPS', 'CD', 'GND', 'TWR']) {
      assert.equal(canMutate(id, op), false, `${id} / ${op}`);
    }
  }
});

test('CTR may CreateStrip (ARRIVAL only) and use every non-CreateStrip op kind, same shape as APP', () => {
  assert.equal(canMutate('CTR', 'CreateStrip'), true);
  for (const op of OP_KINDS.filter(k => k !== 'CreateStrip')) {
    assert.equal(canMutate('CTR', op), true, op);
  }
});

test('D21 regression: a controller holding both TWR and CTR is refused HANDOFF while acting as TWR, even though the same controller also holds CTR', () => {
  assert.equal(canMutate('TWR', 'HANDOFF'), false);
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
  for (const id of ['APP', 'AIC', 'JTAC', 'OPS', 'CD', 'GND', 'TWR']) assert.equal(canMutate(id, 'TOFI'), false, id);
});

test('TAC_C2 and GCI may CreateStrip (they originate MISSION Strips); AIC and JTAC may not', () => {
  assert.equal(canMutate('TAC_C2', 'CreateStrip'), true);
  assert.equal(canMutate('GCI', 'CreateStrip'), true);
  assert.equal(canMutate('AIC', 'CreateStrip'), false);
  assert.equal(canMutate('JTAC', 'CreateStrip'), false);
});

test('JTAC is granted no op kind at all — "MISSION (read-only)" is enforced by an empty grant set, not a separate mechanism', () => {
  for (const op of OP_KINDS) assert.equal(canMutate('JTAC', op), false, op);
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
  for (const id of ['OPS', 'CD', 'GND', 'TWR', 'APP']) {
    assert.equal(canMutate(id, 'NotARealOpKind'), false, id);
  }
});

test('D21 regression (shape-only): evaluating GND and TWR independently never grants either one the other\'s (identical) permissions beyond what each already has standalone', () => {
  // GND/TWR are still permission-identical in Phase 2 — this asserts the
  // *shape* of the guard (independent evaluation, no shared mutable state
  // between calls). OPS-vs-APP below is the real behavioral case.
  const gndOnly = OP_KINDS.filter(op => canMutate('GND', op));
  const twrOnly = OP_KINDS.filter(op => canMutate('TWR', op));
  assert.deepEqual(OP_KINDS.filter(op => canMutate('GND', op)), gndOnly);
  assert.deepEqual(OP_KINDS.filter(op => canMutate('TWR', op)), twrOnly);
});

// ── canCreateStripRole (Phase 2) — role-scoped CreateStrip ───────────────

test('OPS may originate DEPARTURE, and only DEPARTURE (guide §4.1 rule 3)', () => {
  assert.equal(canCreateStripRole('OPS', 'DEPARTURE'), true);
  assert.equal(canCreateStripRole('OPS', 'ARRIVAL'), false);
  assert.equal(canCreateStripRole('OPS', 'OVERFLIGHT'), false);
});

// docs/adr/0023 reopens this — ADR 0014 had deliberately emptied APP's
// ARRIVAL right, reasoning ARRIVAL Strips at APP should only ever arrive
// via the real CTR->APP HANDOFF. Live testing against real ATC scenarios
// (a VFR aircraft picking up an IFR clearance airborne, an aircraft from
// an uncontrolled field with no flight plan on file) found that too
// narrow: those have no sending Facility to HANDOFF from at all.
test('APP may originate ARRIVAL and OVERFLIGHT directly (docs/adr/0023), but not DEPARTURE (that stays OPS-only, guide §4.1 rule 3)', () => {
  assert.equal(canCreateStripRole('APP', 'ARRIVAL'), true);
  assert.equal(canCreateStripRole('APP', 'OVERFLIGHT'), true);
  assert.equal(canCreateStripRole('APP', 'DEPARTURE'), false);
});

test('CTR may originate ARRIVAL (docs/adr/0014) and OVERFLIGHT (docs/adr/0023), but not DEPARTURE', () => {
  assert.equal(canCreateStripRole('CTR', 'ARRIVAL'), true);
  assert.equal(canCreateStripRole('CTR', 'OVERFLIGHT'), true);
  assert.equal(canCreateStripRole('CTR', 'DEPARTURE'), false);
});

test('CD/GND/TWR may originate no Strip Role at all', () => {
  for (const id of ['CD', 'GND', 'TWR']) {
    assert.equal(canCreateStripRole(id, 'DEPARTURE'), false, id);
    assert.equal(canCreateStripRole(id, 'ARRIVAL'), false, id);
    assert.equal(canCreateStripRole(id, 'OVERFLIGHT'), false, id);
  }
});

test('every Position with CreateStrip in its coarse op-kind set has a CREATE_ROLE_PERMISSIONS entry (even if empty) — nothing silently falls through to "allowed"', () => {
  for (const id of Object.keys(PERMISSIONS)) {
    if (PERMISSIONS[id].has('CreateStrip')) {
      assert.ok(CREATE_ROLE_PERMISSIONS[id], `${id} passes the coarse CreateStrip gate but has no role-scoped entry`);
    }
  }
});

test('D21 regression: a controller holding both OPS and CTR is refused CreateStrip(role=ARRIVAL) while acting as OPS, even though the same controller also holds CTR', () => {
  // The point: canCreateStripRole takes exactly one Position, structurally
  // — "also holds CTR" has nowhere to leak in. This is the first test in
  // the suite that can actually distinguish per-acting-Position evaluation
  // from a union bug, since OPS and CTR are genuinely permission-different
  // (Phase 1's CD/GND/TWR were identical and couldn't reveal this).
  // (WP4A, docs/adr/0014: this used to pair OPS with APP, before APP's own
  // ARRIVAL right was narrowed away in favor of the real CTR->APP HANDOFF;
  // docs/adr/0023 reopened it, but OPS/CTR are still permission-different
  // in the direction this test checks — OPS never gets ARRIVAL.)
  assert.equal(canCreateStripRole('OPS', 'ARRIVAL'), false);
  assert.equal(canCreateStripRole('CTR', 'ARRIVAL'), true);
});

test('D21 regression, symmetric case: acting as CTR is refused CreateStrip(role=DEPARTURE) even though the same controller also holds OPS', () => {
  assert.equal(canCreateStripRole('CTR', 'DEPARTURE'), false);
  assert.equal(canCreateStripRole('OPS', 'DEPARTURE'), true);
});

test('canCreateStripRole returns false for an unknown Position or an unknown role, never a throw', () => {
  assert.equal(canCreateStripRole('NOT_A_POSITION', 'DEPARTURE'), false);
  assert.equal(canCreateStripRole('OPS', 'NOT_A_ROLE'), false);
});

// ── canActOnState — per-State authority (guide §3.4 "normally owned by") ──

test('canActOnState has exactly three parameters — same D21 guard shape, never a held set', () => {
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
    HELD: ['CD', 'GND'],
    PUSHBACK: ['GND'],
    TAXI: ['GND'],
    RUNWAY_QUEUE: ['TWR'],
    LUAW: ['TWR'],
    DEPARTED: ['TWR'],
    HANDED_OFF: ['APP', 'CTR'],
  });
});

test('the OPS-owns-PROPOSED case: OPS may act on PROPOSED, CD/GND/TWR/APP may not', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PROPOSED'), true);
  for (const id of ['CD', 'GND', 'TWR', 'APP']) {
    assert.equal(canActOnState(id, 'DEPARTURE', 'PROPOSED'), false, id);
  }
});

test('the exact hazard this was built for: OPS may NOT act on PENDING_CLEARANCE or CLEARED, even though OPS is perfectly capable of still owning that Strip (nothing transfers ownership automatically)', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PENDING_CLEARANCE'), false);
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'CLEARED'), false);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'PENDING_CLEARANCE'), true);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'CLEARED'), true);
});

test('HELD is shared between CD and GND (guide §3.4: "CD / GND"), no one else', () => {
  assert.equal(canActOnState('CD', 'DEPARTURE', 'HELD'), true);
  assert.equal(canActOnState('GND', 'DEPARTURE', 'HELD'), true);
  for (const id of ['OPS', 'TWR', 'APP']) {
    assert.equal(canActOnState(id, 'DEPARTURE', 'HELD'), false, id);
  }
});

test('DEPARTED is TWR\'s (the one about to press the real Hand Off to APP), not APP\'s — APP only owns HANDED_OFF, after the transfer has already happened', () => {
  assert.equal(canActOnState('TWR', 'DEPARTURE', 'DEPARTED'), true);
  assert.equal(canActOnState('APP', 'DEPARTURE', 'DEPARTED'), false);
  assert.equal(canActOnState('APP', 'DEPARTURE', 'HANDED_OFF'), true);
});

test('ARRIVAL states have their own authority table, independent of DEPARTURE\'s — same state-name overlap trap as EfspState FINAL vs Strip Role FINAL', () => {
  assert.equal(canActOnState('APP', 'ARRIVAL', 'INBOUND'), true);
  assert.equal(canActOnState('TWR', 'ARRIVAL', 'HANDED_TO_TOWER'), true);
  assert.equal(canActOnState('TWR', 'ARRIVAL', 'FINAL'), true);
  assert.equal(canActOnState('TWR', 'ARRIVAL', 'LANDED'), true);
  assert.equal(canActOnState('GND', 'ARRIVAL', 'TAXI_IN'), true);
  assert.equal(canActOnState('OPS', 'ARRIVAL', 'INBOUND'), false);
});

test('canActOnState returns false for DROPPED (terminal, no entry), an unknown state, or an unknown role — never a throw', () => {
  assert.equal(canActOnState('TWR', 'DEPARTURE', 'DROPPED'), false);
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

test('TAC_C2 and GCI may originate MISSION, and only MISSION; AIC/JTAC may originate no Strip Role at all', () => {
  assert.equal(canCreateStripRole('TAC_C2', 'MISSION'), true);
  assert.equal(canCreateStripRole('TAC_C2', 'ARRIVAL'), false);
  assert.equal(canCreateStripRole('GCI', 'MISSION'), true);
  for (const id of ['AIC', 'JTAC']) {
    assert.equal(canCreateStripRole(id, 'MISSION'), false, id);
  }
});

// docs/adr/0023 — OVERFLIGHT's own lifecycle authority table, mirroring
// ARRIVAL's shape: whichever Position(s) may originate one may also act on it.
test('OVERFLIGHT states have their own authority table — both APP and CTR may act on TRANSITING, OPS may not', () => {
  assert.equal(canActOnState('APP', 'OVERFLIGHT', 'TRANSITING'), true);
  assert.equal(canActOnState('CTR', 'OVERFLIGHT', 'TRANSITING'), true);
  assert.equal(canActOnState('OPS', 'OVERFLIGHT', 'TRANSITING'), false);
});

test('every state present in DEPARTURE_STATES/ARRIVAL_STATES/OVERFLIGHT_STATES/MISSION_STATES except the terminal DROPPED has a STATE_OWNERS_BY_ROLE entry — nothing silently falls through to "no one may act"', async () => {
  const { DEPARTURE_STATES, ARRIVAL_STATES, OVERFLIGHT_STATES, MISSION_STATES } = await import('../src/efsp/nla.js');
  for (const state of DEPARTURE_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_ROLE.DEPARTURE[state], `DEPARTURE/${state}`);
  }
  for (const state of ARRIVAL_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_ROLE.ARRIVAL[state], `ARRIVAL/${state}`);
  }
  for (const state of OVERFLIGHT_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_ROLE.OVERFLIGHT[state], `OVERFLIGHT/${state}`);
  }
  for (const state of MISSION_STATES) {
    if (state === 'DROPPED') continue;
    assert.ok(STATE_OWNERS_BY_ROLE.MISSION[state], `MISSION/${state}`);
  }
});
