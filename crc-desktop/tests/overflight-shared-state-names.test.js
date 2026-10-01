'use strict';

// docs/adr/0087 (questions-round3 Q3-35, lane brief T1): INBOUND and HANDED_OFF
// are state names of three Roles now (ARRIVAL/OVERFLIGHT, DEPARTURE/OVERFLIGHT).
// Any code that compares a bare state without its Role is wrong for one of them.
// This pins the set of source files that name those two states and why each one
// is safe; a NEW file naming one (a scope label, a geojson layer, a conformance
// rule) fails here until someone decides it is Role-aware.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ROOTS = ['crc-sync/src', 'crc-desktop/app/public/js', 'crc-desktop/app/server.js', 'crc-desktop/main.js'];

// file -> why it is safe
const ALLOWED = {
  'crc-sync/src/efsp/nla.js': 'per-Role state tables and per-Role NLA functions',
  'crc-sync/src/efsp/permission.js': 'per-Role owner tables (STATE_OWNERS_BY_ROLE)',
  'crc-sync/src/efsp/coordination.js': 'tables keyed by Role',
  'crc-sync/src/efsp/board-store.js': 'ConvertToArrival checks the Role; REPLICA_STATE_ON_RECEIPT/SENDER_STATE_ON_ACCEPT and DEFAULT_INITIAL_STATE_BY_ROLE are keyed by Role',
  'crc-sync/src/efsp/facility-config.js': 'Bays imply a state for ARRIVAL/DEPARTURE; board-store skips implication for a Role with a holdsRole Bay',
  'crc-sync/src/efsp/traffic-count.js': 'COUNTABLE_PRE_DROP_STATES is keyed by Role',
  'crc-sync/src/efsp/surveillance-hints.js': 'EXPECTS is keyed by Role',
  'crc-sync/src/efsp/overflight-migration.js': 'the comment naming the new states; it only touches TRANSITING',
  'crc-sync/src/efsp/efsp-ws.js': 'the word INBOUND in a comment about messages',
  'crc-desktop/app/public/js/panels/efsp/sfa-state.js': 'the rotation button is offered only to role === ARRIVAL at INBOUND (the guard is on the same line)',
  'crc-sync/src/efsp/sfa.js': 'SFA_ROTATION is keyed by Role: it names role ARRIVAL with state INBOUND, and board-store _applySfaRotation refuses any other Role',
  'crc-desktop/app/public/js/panels/efsp/efsp-nla.js': 'per-Role tables',
  'crc-desktop/app/public/js/panels/efsp/field-state-rules.js': 'keyed by Role / guarded by role === ARRIVAL',
  'crc-desktop/app/public/js/panels/efsp/bay-view.js': 'guarded by role === DEPARTURE',
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
