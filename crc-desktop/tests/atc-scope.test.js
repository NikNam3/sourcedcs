'use strict';

/* The ATC scope in the STARS scheme (crc-sync's docs/adr/0088; decisions H41,
 * H47, H48, H50, H71). track-label.js writes the block, atc-scope.js decides
 * the controller's relation to a contact and what that shows. Both are pure
 * enough to pin here without a map.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

global.settings = { transitionAltFt: 18000 };
const L = require(path.join(__dirname, '../app/public/js/track-label.js'));
Object.assign(global, L); // atc-scope.js calls these as browser globals
const A = require(path.join(__dirname, '../app/public/js/atc-scope.js'));

const P = A.ATC_PALETTES.MAP;
const LETTERS = { TWR: 'T', APP: 'A', CTR: 'C', TAC_C2: 'M' };
const letterOf = (p) => LETTERS[p] || null;
const APP = new Set(['APP']);

function contact(over = {}) {
  return {
    id: '7', domain: 'AIR', onGround: false, scheme: 'ATC', sources: ['PRIMARY', 'SSR'],
    label: { callsign: 'VIPER11', source: 'FDR', tag: null, trackNumber: 'TN00007' },
    type: 'F16', ssr: { code: '4521', ident: false, emergency: null },
    altitude: { ft: 12000, ref: 'QNH', source: 'MODE_C' }, dl: null, iffOverride: null, ...over,
  };
}
const strip = (over = {}) => ({ stripId: 's1', fdrId: 'f1', role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'APP', coordination: null, ...over });
const env = (over = {}) => ({ palette: P, now: 1000, conflicts: [], conform: null, coast: false, ...over });
const text = (lines) => lines.map(l => l.map(s => s.text).join('')).join('\n');

test.beforeEach(() => A._resetAtcScopeForTest());

// ── The block text (track-label.js) ───────────────────────────────────────

test('ATC text: Mode C in hundreds only, speed in tens, two-letter emergencies', () => {
  assert.equal(L.atcAltitude(contact()), '120');
  assert.equal(L.atcAltitude(contact({ altitude: { ft: 25000, source: 'RADAR' } })), '', 'a STARS altitude is Mode C only');
  assert.equal(L.atcSpeed(283), '28');
  assert.equal(L.atcSpeed(45), '05');
  assert.equal(L.atcEmergencyTag(contact({ ssr: { code: '7700', emergency: 'GENERAL' } })), 'EM');
  assert.equal(L.atcEmergencyTag(contact({ ssr: { code: '7600', emergency: 'RADIO' } })), 'RF');
  assert.equal(L.atcEmergencyTag(contact({ ssr: { code: '7500', emergency: 'HIJACK' } })), 'HJ');
});

test('the assigned line carries a trend toward the assigned altitude, and the typed heading', () => {
  assert.equal(L.atcAssignedText({ altFt: 6000, hdg: 250 }, 12000), 'A060↓ H250');
  assert.equal(L.atcAssignedText({ altFt: 18000, hdg: null }, 12000), 'A180↑');
  assert.equal(L.atcAssignedText({ altFt: 6000, hdg: null }, 6100), 'A060', 'level at it: no arrow');
  assert.equal(L.atcAssignedText({ altFt: null, hdg: 5 }, null), 'H005');
  assert.equal(L.atcAssignedText(null, 1000), '');
});

test('FDB: indicators, callsign, altitude with speed / type time-share, assigned', () => {
  const v = { kind: 'FDB', line0: [{ text: 'HDG230', color: '#E0A83C' }], l1Suffix: [], recipient: '' };
  const speed = L.atcBlockLines(contact(), v, { speedKt: 283, assigned: { altFt: 6000, hdg: 250 } });
  assert.equal(text(speed), 'HDG230\nVIPER11\n120 28\nA060↓ H250');
  assert.equal(speed[0][0].color, '#E0A83C');
  const type = L.atcBlockLines(contact(), v, { speedKt: 283, typePhase: true });
  assert.equal(text(type), 'HDG230\nVIPER11\n120 F16');
});

test('FDB: the handoff recipient sits mid line 2; PO follows the callsign; CST replaces the altitude', () => {
  const v = { kind: 'FDB', line0: [], l1Suffix: [{ text: 'POA' }], recipient: 'A' };
  assert.equal(text(L.atcBlockLines(contact(), v, { speedKt: 320 })), 'VIPER11 POA\n120 A 32');
  const coast = { kind: 'FDB', line0: [], l1Suffix: [], recipient: '', coast: true };
  assert.equal(text(L.atcBlockLines(contact(), coast, { speedKt: 230 })), 'VIPER11\nCST 23');
});

test('PDB is altitude and speed; LDB is code (or tag) and altitude; NONE carries only its indicators', () => {
  assert.equal(text(L.atcBlockLines(contact(), { kind: 'PDB', line0: [] }, { speedKt: 450 })), '120 45');
  const uncorrelated = contact({ label: { callsign: null, source: null, tag: null, trackNumber: 'TN1' } });
  assert.equal(text(L.atcBlockLines(uncorrelated, { kind: 'LDB', line0: [] }, {})), '4521\n120');
  const tagged = contact({ label: { callsign: 'BANDIT', source: 'TAG', tag: 'BANDIT', trackNumber: 'TN1' } });
  assert.equal(text(L.atcBlockLines(tagged, { kind: 'LDB', line0: [] }, {})), 'BANDIT\n120');
  assert.equal(text(L.atcBlockLines(uncorrelated, { kind: 'NONE', line0: [{ text: 'SA', color: '#FFFF00' }] }, {})), 'SA');
  assert.deepEqual(L.atcBlockLines(uncorrelated, { kind: 'NONE', line0: [] }, {}), []);
});

test('ident flashes ID in place of the type/speed', () => {
  const t = contact({ ssr: { code: '4521', ident: true, emergency: null } });
  const lines = L.atcBlockLines(t, { kind: 'FDB', line0: [], l1Suffix: [] }, { speedKt: 280 });
  const id = lines[1].find(s => s.text === 'ID');
  assert.ok(id && id.blink);
});

// ── The relation (atc-scope.js) ───────────────────────────────────────────

test('uncorrelated: `*` with an LDB when squawking, `+` and no block when primary only', () => {
  const unc = contact({ label: { callsign: null, source: null, trackNumber: 'TN1' } });
  const rel = A.atcRelation(unc, [], APP, letterOf);
  assert.equal(rel.associated, false);
  let v = A.atcView(unc, rel, env());
  assert.deepEqual([v.kind, v.posChar, v.color], ['LDB', '*', P.other]);
  const prim = { ...unc, sources: ['PRIMARY'], ssr: null, altitude: null };
  v = A.atcView(prim, A.atcRelation(prim, [], APP, letterOf), env());
  assert.deepEqual([v.kind, v.posChar], ['NONE', '+']);
});

test('mine -> white FDB with my letter; someone else\'s -> green PDB with theirs', () => {
  let rel = A.atcRelation(contact(), [strip()], APP, letterOf);
  let v = A.atcView(contact(), rel, env());
  assert.deepEqual([rel.mine, v.kind, v.color, v.posChar], [true, 'FDB', P.own, 'A']);
  rel = A.atcRelation(contact(), [strip({ ownerPositionId: 'CTR' })], APP, letterOf);
  v = A.atcView(contact(), rel, env());
  assert.deepEqual([rel.mine, v.kind, v.color, v.posChar], [false, 'PDB', P.other, 'C']);
  assert.equal(v.opacity, P.otherOpacity);
});

test('a handoff to me: flashing white FDB, still the sender\'s letter; accepting it is a click on the target', () => {
  const sender = strip({ stripId: 'ctr', ownerPositionId: 'CTR', coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerPositionId: 'APP' } });
  const replica = strip({ stripId: 'app', ownerPositionId: 'APP', coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, peerPositionId: 'CTR' } });
  const rel = A.atcRelation(contact(), [sender, replica], APP, letterOf);
  const v = A.atcView(contact(), rel, env());
  assert.deepEqual([v.kind, v.color, v.blinkBlock, v.posChar], ['FDB', P.own, true, 'C']);
  const accepted = [];
  assert.equal(A.atcApplyClick(contact(), rel, 1000, { accept: s => accepted.push(s.stripId) }), 'ACCEPT_HANDOFF');
  assert.deepEqual(accepted, ['app']);
});

test('the sender side: recipient letter while proposed; after an accept it saw, a 5 s blink, then click green, click PDB', () => {
  const CTR = new Set(['CTR']);
  const proposed = strip({ stripId: 'ctr', ownerPositionId: 'CTR', coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerPositionId: 'APP' } });
  let rel = A.atcRelation(contact(), [proposed], CTR, letterOf);
  let v = A.atcView(contact(), rel, env({ now: 1000 }));
  assert.deepEqual([v.kind, v.color, v.recipient, v.posChar], ['FDB', P.own, 'A', 'C']);

  const active = { ...proposed, coordination: { ...proposed.coordination, state: 'ACTIVE' } };
  const replica = strip({ stripId: 'app', ownerPositionId: 'APP', coordination: { primitive: 'HANDOFF', state: 'ACTIVE', mintedForCoordination: true } });
  rel = A.atcRelation(contact(), [active, replica], CTR, letterOf);
  v = A.atcView(contact(), rel, env({ now: 2000 }));
  assert.deepEqual([rel.mine, v.kind, v.color, v.blinkBlock, v.posChar], [false, 'FDB', P.own, true, 'A']);
  v = A.atcView(contact(), rel, env({ now: 2000 + A.ATC_SENDER_BLINK_MS }));
  assert.deepEqual([v.kind, v.color, v.blinkBlock], ['FDB', P.own, false], 'the blink ends by itself');
  assert.equal(A.atcApplyClick(contact(), rel, 8000), 'HANDOFF_GREEN');
  assert.equal(A.atcView(contact(), rel, env({ now: 8000 })).color, P.other);
  assert.equal(A.atcApplyClick(contact(), rel, 9000), 'HANDOFF_PDB');
  assert.equal(A.atcView(contact(), rel, env({ now: 9000 })).kind, 'PDB');
});

test('an accept this scope did not see happen does not blink: a reconnect shows the settled picture', () => {
  const CTR = new Set(['CTR']);
  const active = strip({ stripId: 'ctr', ownerPositionId: 'CTR', coordination: { primitive: 'HANDOFF', state: 'ACTIVE', peerPositionId: 'APP' } });
  const replica = strip({ stripId: 'app', ownerPositionId: 'APP', coordination: { primitive: 'HANDOFF', state: 'ACTIVE', mintedForCoordination: true } });
  const v = A.atcView(contact(), A.atcRelation(contact(), [active, replica], CTR, letterOf), env());
  assert.deepEqual([v.kind, v.blinkBlock], ['PDB', false]);
});

test('a point-out to me: flashing yellow PO; accepted -> steady yellow; then green FDB; then PDB', () => {
  const owner = strip({ stripId: 'twr', ownerPositionId: 'TWR', role: 'DEPARTURE', state: 'HANDED_OFF', coordination: { primitive: 'POINT_OUT', state: 'PROPOSED', peerPositionId: 'APP' } });
  const replica = (state) => strip({ stripId: 'po', ownerPositionId: 'APP', coordination: { primitive: 'POINT_OUT', state, mintedForCoordination: true, peerPositionId: 'TWR' } });
  let rel = A.atcRelation(contact(), [owner, replica('PROPOSED')], APP, letterOf);
  let v = A.atcView(contact(), rel, env());
  assert.deepEqual([v.kind, v.color, v.blinkBlock, v.posChar, v.l1Suffix[0].text], ['FDB', P.pointout, true, 'T', 'PO'], 'the owner stays TWR');
  rel = A.atcRelation(contact(), [owner, replica('ACTIVE')], APP, letterOf);
  v = A.atcView(contact(), rel, env({ now: 2000 }));
  assert.deepEqual([v.kind, v.color, v.blinkBlock], ['FDB', P.pointout, false]);
  assert.equal(A.atcApplyClick(contact(), rel, 3000), 'POINT_OUT_GREEN');
  assert.deepEqual([A.atcView(contact(), rel, env()).kind, A.atcView(contact(), rel, env()).color], ['FDB', P.other]);
  assert.equal(A.atcApplyClick(contact(), rel, 4000), 'POINT_OUT_PDB');
  assert.equal(A.atcView(contact(), rel, env()).kind, 'PDB');
});

test('the point-out sender: PO+recipient while proposed; PO blinks after the accept; UN flashes on a refusal until clicked', () => {
  const TWR = new Set(['TWR']);
  const s = (state) => strip({ stripId: 'twr', ownerPositionId: 'TWR', coordination: { primitive: 'POINT_OUT', state, peerPositionId: 'APP' } });
  let v = A.atcView(contact(), A.atcRelation(contact(), [s('PROPOSED')], TWR, letterOf), env({ now: 1000 }));
  assert.deepEqual([v.kind, v.color, v.l1Suffix.map(x => x.text)], ['FDB', P.own, ['POA']]);
  v = A.atcView(contact(), A.atcRelation(contact(), [s('ACTIVE')], TWR, letterOf), env({ now: 2000 }));
  assert.deepEqual(v.l1Suffix.map(x => [x.text, x.blink]), [['PO', true]]);

  A._resetAtcScopeForTest();
  A.atcView(contact(), A.atcRelation(contact(), [s('PROPOSED')], TWR, letterOf), env({ now: 1000 }));
  const rel = A.atcRelation(contact(), [s('REJECTED')], TWR, letterOf);
  v = A.atcView(contact(), rel, env({ now: 2000 }));
  assert.deepEqual(v.l1Suffix.map(x => [x.text, x.blink]), [['UN', true]]);
  assert.equal(A.atcApplyClick(contact(), rel, 3000), 'ACK_UNABLE');
  assert.deepEqual(A.atcView(contact(), rel, env({ now: 3000 })).l1Suffix, []);
});

test('H48: under tactical control the owner letter is the tactical side\'s, `M`', () => {
  const atc = strip({ stripId: 'ctr', ownerPositionId: 'CTR', role: 'DEPARTURE', state: 'HANDED_OFF', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } });
  const mission = strip({ stripId: 'm', ownerPositionId: 'TAC_C2', role: 'MISSION', state: 'ON_STATION', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } });
  const rel = A.atcRelation(contact(), [atc, mission], APP, letterOf);
  const v = A.atcView(contact(), rel, env());
  assert.deepEqual([rel.tofi, v.posChar, v.kind], [true, 'M', 'PDB']);
  const exiting = A.atcRelation(contact(), [{ ...atc, tofiCoordination: { direction: 'EXIT', state: 'PROPOSED' } }, mission], APP, letterOf);
  assert.equal(exiting.ownerLetter, 'M', 'still tactical until the exit is accepted');
  const done = A.atcRelation(contact(), [{ ...atc, tofiCoordination: { direction: 'EXIT', state: 'COMPLETE' } }], APP, letterOf);
  assert.equal(done.ownerLetter, 'C');
});

test('H47: a declared hostile gets a steady yellow SA; a primary-only one gets a block of just SA', () => {
  const t = contact({ label: { callsign: null, source: null, trackNumber: 'TN31' }, sources: ['PRIMARY'], ssr: null, altitude: null, iffOverride: 'hostile' });
  const v = A.atcView(t, A.atcRelation(t, [], APP, letterOf), env());
  assert.deepEqual([v.kind, v.posChar], ['NONE', '+']);
  assert.deepEqual(v.line0, [{ text: 'SA', color: P.sa, blink: false }]);
  assert.equal(text(L.atcBlockLines(t, v, {})), 'SA');
  const bandit = { ...t, iffOverride: 'bandit' };
  assert.deepEqual(A.atcView(bandit, A.atcRelation(bandit, [], APP, letterOf), env()).line0, [], 'hostile only (H71 default)');
});

test('line 0 stacks by severity: EM, CA, SA, then the conformance tag; EM and CA force an FDB and blink until clicked', () => {
  const t = contact({ ssr: { code: '7700', ident: false, emergency: 'GENERAL' }, iffOverride: 'hostile' });
  const rel = A.atcRelation(t, [strip({ ownerPositionId: 'CTR' })], APP, letterOf);
  const conform = A.atcConformTag([{ kind: 'HEADING', actual: 72 }]);
  let v = A.atcView(t, rel, env({ conflicts: ['c1'], conform }));
  assert.deepEqual(v.line0.map(x => [x.text, x.blink]), [['EM', true], ['CA', true], ['SA', false], ['HDG072', false]]);
  assert.deepEqual([v.kind, v.color], ['FDB', P.other], 'forced, but still someone else\'s');
  assert.equal(A.atcApplyClick(t, rel, 1, { conflicts: ['c1'] }), 'ACK_EMERGENCY');
  assert.equal(A.atcApplyClick(t, rel, 2, { conflicts: ['c1'] }), 'ACK_CONFLICT');
  v = A.atcView(t, rel, env({ conflicts: ['c1'], conform }));
  assert.deepEqual(v.line0.map(x => x.blink), [false, false, false, false]);
});

test('conformance tags keep the app colours (ADR 0058, H41 S10)', () => {
  assert.deepEqual(A.atcConformTag([{ kind: 'LEVEL_BUST', deviationFt: 600 }]), { tag: 'BUST+600', color: '#FF8A4C' });
  assert.deepEqual(A.atcConformTag([{ kind: 'WRONG_WAY', fpm: -800 }]), { tag: 'ALT↓', color: '#FF8A4C' });
  assert.equal(A.atcConformTag([]), null);
});

test('a click on someone else\'s PDB opens it into an FDB, and another closes it', () => {
  const rel = A.atcRelation(contact(), [strip({ ownerPositionId: 'CTR' })], APP, letterOf);
  assert.equal(A.atcApplyClick(contact(), rel, 1), 'EXPAND');
  assert.equal(A.atcView(contact(), rel, env()).kind, 'FDB');
  assert.equal(A.atcApplyClick(contact(), rel, 2), 'COLLAPSE');
  assert.equal(A.atcView(contact(), rel, env()).kind, 'PDB');
});

test('coast: a correlated contact loses its disc; an uncorrelated one never coasts', () => {
  const rel = A.atcRelation(contact(), [strip()], APP, letterOf);
  const v = A.atcView(contact(), rel, env({ coast: true }));
  assert.deepEqual([v.coast, v.disc, v.posChar], [true, false, 'A']);
  const unc = contact({ label: { callsign: null, source: null, trackNumber: 'TN1' } });
  assert.equal(A.atcView(unc, A.atcRelation(unc, [], APP, letterOf), env({ coast: true })).disc, true);
});

test('the black scope needs the setting off AND an ATC-only session (H71 question 1)', () => {
  global.coverageDatalink = false;
  global.coverageRadars = [{ presentation: 'ATC', sweepMs: 3000 }, { presentation: 'ATC', sweepMs: 2000 }];
  settings.atcMapBackground = undefined;
  assert.equal(A.atcBlackScope(), false, 'on by default');
  settings.atcMapBackground = false;
  assert.equal(A.atcBlackScope(), true);
  assert.equal(A.atcPalette().name, 'BLACK');
  assert.equal(A.atcCoastAfterMs(), 6000, 'two of the slowest ATC radar\'s sweeps');
  global.coverageRadars = [{ presentation: 'ATC' }, { presentation: 'TACTICAL' }];
  assert.equal(A.atcBlackScope(), false, 'a mixed session keeps the map');
  global.coverageRadars = [{ presentation: 'ATC' }];
  global.coverageDatalink = true;
  assert.equal(A.atcBlackScope(), false, 'the datalink is tactical');
  delete settings.atcMapBackground;
  global.coverageRadars = []; global.coverageDatalink = false;
});

test('a same-Facility transfer (TWR -> APP, no PROPOSED step) blinks at the sender like an accepted handoff', () => {
  const TWR = new Set(['TWR']);
  let rel = A.atcNoteOwnership('7', A.atcRelation(contact(), [strip({ ownerPositionId: 'TWR' })], TWR, letterOf), 1000);
  assert.equal(A.atcView(contact(), rel, env({ now: 1000 })).color, P.own);
  rel = A.atcNoteOwnership('7', A.atcRelation(contact(), [strip({ ownerPositionId: 'APP' })], TWR, letterOf), 2000);
  let v = A.atcView(contact(), rel, env({ now: 2000 }));
  assert.deepEqual([v.kind, v.color, v.blinkBlock, v.posChar], ['FDB', P.own, true, 'A']);
  assert.equal(A.atcApplyClick(contact(), rel, 9000), 'HANDOFF_GREEN');
  assert.equal(A.atcApplyClick(contact(), rel, 9500), 'HANDOFF_PDB');
  v = A.atcView(contact(), rel, env({ now: 9600 }));
  assert.equal(v.kind, 'PDB');
  // First seen already APP's: no blink.
  A._resetAtcScopeForTest();
  rel = A.atcNoteOwnership('7', A.atcRelation(contact(), [strip({ ownerPositionId: 'APP' })], TWR, letterOf), 1000);
  assert.equal(A.atcView(contact(), rel, env()).kind, 'PDB');
});
