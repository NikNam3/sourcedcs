// docs/adr/0087 (questions-round3 Q3-35, lane brief T1): INBOUND and HANDED_OFF
// are state names of three Roles now (ARRIVAL/OVERFLIGHT, DEPARTURE/OVERFLIGHT).
// Any code that compares a bare state without its Role is wrong for one of them.
// This pins the set of source files that name those two states and why each one
// is safe; a NEW file naming one (a scope label, a geojson layer, a conformance
// rule) fails here until someone decides it is Role-aware.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO = path.join(__dirname, '..', '..');
const ROOTS = ['crc-sync/src', 'crc-desktop/app/public/js', 'crc-desktop/app/server.js', 'crc-desktop/main.js'];

// file -> why it is safe
const ALLOWED = {
  'crc-sync/src/efsp/nla.js': 'per-Role state tables and per-Role NLA functions',
  'crc-sync/src/efsp/authority/index.js': 'comments on the Role-keyed COORDINATION_/TOFI_ELIGIBLE_STATES, composed from the Role families',
  'crc-sync/src/efsp/authority/op-kinds.js': 'a comment: ConvertToArrival is a DEPARTURE Strip at HANDED_OFF (Role named)',
  'crc-sync/src/efsp/authority/roles/departure.js': 'the DEPARTURE Role family: its own states, owners and NLA',
  'crc-sync/src/efsp/authority/roles/arrival.js': 'the ARRIVAL Role family: its own states, owners and NLA',
  'crc-sync/src/efsp/authority/roles/overflight.js': 'the OVERFLIGHT Role family: its own states, owners, NLA and replica/sender states',
  'crc-sync/src/efsp/authority/positions/incirlik-military.js': 'ownsStates is keyed by Role ({ ARRIVAL: [\'INBOUND\'] })',
  'crc-sync/src/efsp/board/ops/invoke-nla.js': 'comments only (moved from board-store.js); the transitions come from the Role family tables',
  'crc-sync/src/efsp/board/ops/sfa-rotation.js': 'comments only (moved from board-store.js); SFA rotation is keyed by Role',
  'crc-sync/src/efsp/board/strip-ops.js': 'comments only (moved from board-store.js)',
  'crc-sync/src/efsp/board/ops/create-strip.js': 'a comment only (the old ARRIVAL-or-PROPOSED binary); the initial state comes from the Role family (moved from board-store.js)',
  'crc-sync/src/efsp/board/ops/convert-to-arrival.js': 'ConvertToArrival checks the Role (moved from board-store.js)',
  'crc-sync/src/efsp/board/placement.js': 'comments only (the nlaCtx context and roleBayFor\'s Role Bay rule); roleBayFor keeps an OVERFLIGHT out of ARRIVAL\'s Bays by Role',
  'crc-sync/src/efsp/board/coordination.js': 'a comment only (the replica carries the sender\'s Role/EfspState); the tables it reads are passed in, keyed by Role',
  'crc-sync/src/efsp/surveillance-hints.js': 'EXPECTS is keyed by Role',
  'crc-sync/src/efsp/wire/skeleton.js': 'the word INBOUND in a comment about messages',
  'crc-desktop/app/public/js/panels/efsp/sfa-state.js': 'the rotation button is offered only to role === ARRIVAL at INBOUND (the guard is on the same line)',
  'crc-sync/src/efsp/sfa.js': 'SFA_ROTATION is keyed by Role: it names role ARRIVAL with state INBOUND, and board-store _applySfaRotation refuses any other Role',
  'crc-desktop/app/public/js/panels/efsp/efsp-nla.js': 'per-Role tables',
  'crc-desktop/app/public/js/panels/efsp/field-state-rules.js': 'keyed by Role / guarded by role === ARRIVAL',
  'crc-desktop/app/public/js/panels/efsp/bay/popovers/airspace-entry.js': 'guarded by role === DEPARTURE (moved from bay-view.js)',
};

function* walk(p) {
  const abs = path.join(REPO, p);
  if (fs.statSync(abs).isFile()) { yield p; return; }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const rel = path.join(p, e.name);
    if (e.isDirectory()) yield* walk(rel);
    else if (e.name.endsWith('.js')) yield rel;
  }
}

test('only the audited source files name a bare INBOUND or HANDED_OFF state', () => {
  const found = [];
  for (const root of ROOTS) for (const f of walk(root)) {
    if (/\b(INBOUND|HANDED_OFF)\b/.test(fs.readFileSync(path.join(REPO, f), 'utf8'))) found.push(f);
  }
  for (const f of found) assert.ok(ALLOWED[f], `${f} names INBOUND/HANDED_OFF, which an OVERFLIGHT now shares with ARRIVAL/DEPARTURE; make it Role-aware and add it to ALLOWED with the reason`);
  for (const f of Object.keys(ALLOWED)) assert.ok(found.includes(f), `${f} no longer names them; drop it from ALLOWED`);
});

test('a scope/label/stripe consumer never reads strip.state at all (so a shared state name cannot be mistaken for ARRIVAL\'s)', () => {
  for (const f of ['track-label.js', 'geojson.js', 'conformance.js', 'stca.js']) {
    const abs = path.join(REPO, 'crc-desktop/app/public/js', f);
    if (!fs.existsSync(abs)) continue;
    assert.ok(!/\.state\s*(===|!==|==)\s*['"](INBOUND|HANDED_OFF)['"]/.test(fs.readFileSync(abs, 'utf8')), f);
  }
});
