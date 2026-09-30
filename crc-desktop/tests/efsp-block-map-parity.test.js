'use strict';

// Cross-package parity check between crc-sync's server-side block-map.js
// and crc-desktop's client-side strip-template.js — the two "identical"
// Block Map copies ADR 0001 deliberately keeps as literal duplicates
// rather than a shared import (crc-sync/crc-desktop are separately
// deployed packages). Nothing *compiles* these two objects against each
// other, so nothing catches drift except a test explicitly comparing them
// — this is that test. Requiring across the package boundary is fine here
// (test-only, not production code — ADR 0001's "no import" rule is about
// the runtime wire path, not test tooling).
//
// Deliberately NOT a byte-for-byte object comparison: the two sides have
// legitimately different needs for non-fdr/non-annotation Blocks (system,
// flag, composite, nla) — the server only ever needs to know "is this
// directly SetBlock-writable" (fdr/annotation, everything else routes
// through a dedicated mechanism and returns null from resolveBlockTarget
// regardless of the exact kind string), while the client's resolveBlockValue
// branches on the specific kind (system/flag/composite/nla) to know how to
// *read* a display value, and carries extra kind-specific keys (`field`,
// `flag`) the server has no use for. Asserting those extra keys match would
// manufacture false failures out of a real, intentional asymmetry.
//
// What DOES have to match exactly, because a mismatch here is a genuine
// cross-service data-contract bug (the wrong field gets read or written):
//   - `required` — governs both the facility-config validator (server) and
//     what the UI marks required (client); a mismatch means one side thinks
//     a Block is optional that the other treats as mandatory.
//   - whether a Block is fdr/annotation-routed at all — if one side thinks a
//     Block is directly writable and the other doesn't, SetBlock either
//     silently no-ops or writes to a field the other side never reads.
//   - for fdr-routed Blocks: `target.path` (which FDR field) and `provenance`
//     (the pre-edit provenance default — see strip-template.test.js's own
//     "Block 9 defaults to COMPUTER_GENERATED" test, which this mirrors).
//   - `interlock` (docs/adr/0051) — which Blocks §9.2's MARSA void interlock
//     watches. Added in WP6: this test compared only the four things above,
//     so the server could tag a Block and the client would never know, which
//     is fine while the client's only use is a tooltip it composes itself and
//     wrong the moment it needs to warn per-Block. The briefing listed this
//     as a known gap; it is one line, so it is closed rather than carried.
//   - for the `military` kind (docs/adr/0052) — `target.field`, i.e. WHICH key
//     of fdr.military this Block writes. Same class of bug as a mismatched fdr
//     path, and not covered by isWritableKind, which lumps every dedicated
//     kind together as "not directly SetBlock-writable". `tofi` gets the same
//     check for the same reason.

const test = require('node:test');
const assert = require('node:assert/strict');

const server = require('../../crc-sync/src/efsp/block-map.js');
const client = require('../app/public/js/panels/efsp/strip-template.js');

function isWritableKind(kind) {
  return kind === 'fdr' || kind === 'annotation';
}

function assertBlockMapParity(role, serverMap, clientMap) {
  const allIds = new Set([...Object.keys(serverMap), ...Object.keys(clientMap)]);

  for (const id of allIds) {
    const s = serverMap[id];
    const c = clientMap[id];
    assert.ok(s, `[${role}] Block ${id} exists on the client but not the server`);
    assert.ok(c, `[${role}] Block ${id} exists on the server but not the client`);

    assert.equal(s.required, c.required, `[${role}] Block ${id}: required flag differs (server=${s.required}, client=${c.required})`);

    const sWritable = isWritableKind(s.target.kind);
    const cWritable = isWritableKind(c.target.kind);
    assert.equal(sWritable, cWritable, `[${role}] Block ${id}: one side treats this as directly SetBlock-writable (fdr/annotation) and the other doesn't (server.kind=${s.target.kind}, client.kind=${c.target.kind})`);

    if (sWritable) {
      assert.equal(s.target.kind, c.target.kind, `[${role}] Block ${id}: writable-kind mismatch`);
      if (s.target.kind === 'fdr') {
        assert.equal(s.target.path, c.target.path, `[${role}] Block ${id}: fdr path differs`);
      }
      assert.equal(s.provenance, c.provenance, `[${role}] Block ${id}: provenance default differs (server=${s.provenance}, client=${c.provenance})`);
    }

    assert.equal(s.interlock, c.interlock, `[${role}] Block ${id}: MARSA interlock tag differs (server=${s.interlock}, client=${c.interlock}) — §9.2 rule 2 keys on this`);

    // The two dedicated kinds where several Blocks share one kind and `field`
    // says which key of one sub-object each writes. A mismatch here sends the
    // controller's edit to the wrong field of the right object, which is
    // exactly as silent as a wrong fdr path and not caught above.
    if (s.target.kind === 'tofi' || s.target.kind === 'military') {
      assert.equal(s.target.kind, c.target.kind, `[${role}] Block ${id}: dedicated target kind differs (server=${s.target.kind}, client=${c.target.kind})`);
      assert.equal(s.target.field, c.target.field, `[${role}] Block ${id}: ${s.target.kind} field differs (server=${s.target.field}, client=${c.target.field})`);
    }
  }
}

test('server and client DEPARTURE_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance', () => {
  assertBlockMapParity('DEPARTURE', server.DEPARTURE_BLOCK_MAP, client.DEPARTURE_BLOCK_MAP);
});

test('server and client ARRIVAL_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance (Phase 2)', () => {
  assertBlockMapParity('ARRIVAL', server.ARRIVAL_BLOCK_MAP, client.ARRIVAL_BLOCK_MAP);
});

test('server and client OVERFLIGHT_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance (docs/adr/0023)', () => {
  assertBlockMapParity('OVERFLIGHT', server.OVERFLIGHT_BLOCK_MAP, client.OVERFLIGHT_BLOCK_MAP);
});

test('server and client MISSION_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance (WP4A second slice)', () => {
  assertBlockMapParity('MISSION', server.MISSION_BLOCK_MAP, client.MISSION_BLOCK_MAP);
});

// §9.4 MTR fields (crc-sync's docs/adr/0062) — held explicitly rather than
// trusted to the per-Role sweeps above: six new Blocks on three Roles is
// eighteen places for a path to be mistyped on one side only.
test('the six MTR Blocks are on all three ATC Roles on both sides, with identical paths, and on neither MISSION map', () => {
  const MTR = {
    '9G-MTR': 'military.mtr.designator', '9G-ENTRY': 'military.mtr.entryFix', '9G-TIME': 'military.mtr.entryTimeUtc',
    '9H-EXIT': 'military.mtr.exitFix', '9H-TIME': 'military.mtr.exitEstimateUtc', '9H-ALT': 'military.mtr.requestedAltitudeAfterExit',
  };
  for (const role of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT']) {
    for (const [id, path] of Object.entries(MTR)) {
      assert.deepEqual(server.BLOCK_MAPS[role][id].target, { kind: 'fdr', path }, `server ${role}/${id}`);
      assert.deepEqual(client.BLOCK_MAPS[role][id].target, { kind: 'fdr', path }, `client ${role}/${id}`);
    }
  }
  for (const id of Object.keys(MTR)) {
    assert.equal(server.MISSION_BLOCK_MAP[id], undefined, `server MISSION/${id}`);
    assert.equal(client.MISSION_BLOCK_MAP[id], undefined, `client MISSION/${id}`);
  }
});

// decisions.md H55 (crc-sync's docs/adr/0069): ordnance state is recorded by
// whoever the pilot is talking to, tactical Positions included, so Block 3G is
// on every Role — MISSION too — on both sides, onto the one FDR field. The hook
// (3F) stays on the three ATC Roles only.
test('Block 3G is on all four Roles on both sides, onto military.ordnanceState, and 3F never on MISSION', () => {
  for (const role of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT', 'MISSION']) {
    assert.deepEqual(server.BLOCK_MAPS[role]['3G'].target, { kind: 'military', field: 'ordnanceState' }, `server ${role}/3G`);
    assert.deepEqual(client.BLOCK_MAPS[role]['3G'].target, { kind: 'military', field: 'ordnanceState' }, `client ${role}/3G`);
    assert.equal(server.BLOCK_MAPS[role]['3G'].required, false, `server ${role}/3G`);
    assert.equal(client.BLOCK_MAPS[role]['3G'].required, false, `client ${role}/3G`);
  }
  assert.equal(server.MISSION_BLOCK_MAP['3F'], undefined);
  assert.equal(client.MISSION_BLOCK_MAP['3F'], undefined);
});

// §9.6 alert status (crc-sync's docs/adr/0070): one Block, DEPARTURE only.
test('14E is the alert status on DEPARTURE on both sides, and on no other Role', () => {
  assert.deepEqual(server.DEPARTURE_BLOCK_MAP['14E'].target, { kind: 'military', field: 'alertStatus' });
  assert.deepEqual(client.DEPARTURE_BLOCK_MAP['14E'].target, { kind: 'military', field: 'alertStatus' });
  assert.equal(server.DEPARTURE_BLOCK_MAP['14E'].required, client.DEPARTURE_BLOCK_MAP['14E'].required);
  for (const role of ['ARRIVAL', 'OVERFLIGHT', 'MISSION']) {
    assert.equal(server.BLOCK_MAPS[role]['14E'], undefined, `server ${role}`);
    assert.equal(client.BLOCK_MAPS[role]['14E'], undefined, `client ${role}`);
  }
});
