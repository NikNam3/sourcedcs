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
  }
}

test('server and client DEPARTURE_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance', () => {
  assertBlockMapParity('DEPARTURE', server.DEPARTURE_BLOCK_MAP, client.DEPARTURE_BLOCK_MAP);
});

test('server and client ARRIVAL_BLOCK_MAP agree on every Block ID, required flag, writability, fdr path, and provenance (Phase 2)', () => {
  assertBlockMapParity('ARRIVAL', server.ARRIVAL_BLOCK_MAP, client.ARRIVAL_BLOCK_MAP);
});
