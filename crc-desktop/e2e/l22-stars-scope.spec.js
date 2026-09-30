'use strict';

/* L22 — the ATC scope in the STARS scheme (crc-sync's docs/adr/0088), in the
 * real app: the four scenes of the approved mockup (docs/wip/L22-mockup.html,
 * H71), drawn by the product code and photographed into docs/wip/L22/.
 *
 * The rig has no DCS, so the picture is injected the way the wire would
 * deliver it: a coverage message, an EFSP snapshot (Strips, FDRs,
 * correlations, position letters), a track snapshot with each contact's
 * `scheme`, and the conformance/STCA alerts. Everything after that — the
 * relation, the blocks, the colours, the black scope — is the app's own.
 */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const OUT = path.join(__dirname, '..', '..', 'docs', 'wip', 'L22');
fs.mkdirSync(OUT, { recursive: true });

// LTAG, and the mockup's layout: 100 px = 10 NM, (430, 330) = the field.
const LTAG = { lat: 37.002, lon: 35.426 };
const at = (x, y) => ({ lat: LTAG.lat - (y - 330) * 0.1 / 60, lon: LTAG.lon + (x - 430) * 0.1 / 47.9 });

const APP_RADAR = { id: 'app:Incirlik', type: 'approach', presentation: 'ATC', label: 'LTAG APP', airport: 'Incirlik', ...LTAG, elevM: 60, rangeM: 80 * 1852, sweepMs: 3000, caps: { ssr: true } };
const E3_RADAR = { id: 'crc:99', type: 'awacs', presentation: 'TACTICAL', label: 'DARKSTAR', ...at(150, 110), elevM: 9000, rangeM: 216 * 1852, sweepMs: 10000, caps: { ssr: true, height: true, mode4: true } };

const FDR = (fdrId, callsign, type, clearance) => ({
  fdrId, identity: { callsign, aircraftType: type, beaconAssigned: null }, filed: {}, clearance: clearance || {},
});
const ASSIGNED = (altFt, hdg) => ({
  altitude: { entries: [{ status: 'ACTIVE', parsed: altFt }] },
  heading: { entries: [{ status: 'ACTIVE', parsed: hdg }] },
});
const S = (stripId, fdrId, ownerPositionId, over = {}) => ({
  stripId, fdrId, ownerPositionId, facilityId: 'INCIRLIK', role: 'ARRIVAL', state: 'INBOUND',
  bayId: 'none', rackId: 'main', orderKey: 'a', rev: 1, annotations: {}, flags: {}, coordination: null, ...over,
});

/** One contact on the wire, as presentation.js would send it. */
function wire(c) {
  const squawk = c.code ? { code: c.code, ident: false, emergency: c.emergency || null } : null;
  const sources = ['PRIMARY'];
  if (squawk) sources.push('SSR');
  if (c.height) sources.push('HEIGHT');
  return {
    id: c.id, ...at(c.x, c.y), domain: 'AIR', onGround: false, illuminatedAt: 0,
    sources, iffState: c.iff || 'neutral', iffOverride: c.override || null,
    label: { callsign: c.callsign || null, source: c.callsign ? 'FDR' : null, tag: null, trackNumber: c.tn || `TN000${c.id.length}` },
    type: c.type || null, ssr: squawk,
    altitude: c.alt ? { ft: c.alt, ref: 'QNH', source: c.altSource || (squawk ? 'MODE_C' : 'RADAR') } : null,
    dl: null, scheme: c.scheme || 'ATC', _h: c.h, _kt: c.kt, _stale: c.stale || 0,
  };
}

/** Puts a scene on the page: coverage, Board, tracks with trails, alerts, view. */
async function inject(page, scene) {
  await page.evaluate((sc) => {
    applyCoverage({ radars: sc.radars, heldPositions: sc.held, datalink: !!sc.datalink });
    applyEfspSnapshot({
      boardSeq: getEfspBoardSeq(), facility: getEfspFacility(), bays: getEfspBays(), positions: getAllEfspPositions(),
      strips: sc.strips, fdrs: sc.fdrs, correlations: sc.correlations,
      positionLetters: {
        INCIRLIK: { OPS: 'O', CD: 'D', GND: 'G', TWR: 'T', APP: 'A' }, CENTER: { CTR: 'C' },
        TACTICAL: { TAC_C2: 'M', AIC: 'M', GCI: 'M', JTAC: 'M' },
      },
    });
    const now = Date.now();
    const list = sc.tracks.map((t) => {
      const w = { ...t, illuminatedAt: now - t._stale };
      delete w._h; delete w._kt; delete w._stale;
      return w;
    });
    applySnapshot(list);
    // Trails and speed: six earlier returns along the track's heading.
    for (const t of sc.tracks) {
      const ms = t._kt * 0.5144;
      const pts = [];
      for (let i = 6; i >= 0; i--) {
        const [lat, lon] = projectPos(t.lat, t.lon, (t._h + 180) % 360, ms * 5 * i);
        pts.push({ lat, lon, altFt: t.altitude ? t.altitude.ft : null, timestamp: now - t._stale - i * 5000 });
      }
      history.set(t.id, pts);
    }
    applyEfspAlerts(sc.alerts);
    labelOffsets.clear();
    map.jumpTo({ center: [sc.center.lon, sc.center.lat], zoom: sc.zoom });
    updateMap();
  }, scene);
}

async function snap(page, name) {
  await page.waitForTimeout(1500); // tiles and glyphs
  await page.locator('#map').screenshot({ path: path.join(OUT, name), animations: 'disabled' });
}

async function openScope(page, held) {
  const facilities = Object.keys(held);
  await openPanel(page, { held: held[facilities[0]], facilityId: facilities[0], controller: `l22-${facilities.join('-')}-${Date.now()}` });
  for (const f of facilities.slice(1)) await page.evaluate(([fac, h]) => window.sendEfspSetPositions(fac, h), [f, held[f]]);
  await page.evaluate(() => window.toggleDockPanel && window.toggleDockPanel('efsp', false));
  await page.waitForFunction(() => typeof mapReady !== 'undefined' && mapReady);
  await page.evaluate(() => map.resize());
}

// ── Scene 1 / 4: an APP-only scope ─────────────────────────────────────────

function appScene() {
  const c = [
    { id: 'viper', x: 640, y: 250, h: 230, kt: 280, callsign: 'VIPER11', type: 'F16', code: '4521', alt: 12000 },
    { id: 'sq', x: 210, y: 120, h: 90, kt: 160, code: '6123', alt: 4200, tn: 'TN00002' },
    { id: 'prim', x: 150, y: 330, h: 45, kt: 250, tn: 'TN00003' },
    { id: 'colt', x: 690, y: 92, h: 250, kt: 320, callsign: 'COLT31', type: 'F18', code: '4532', alt: 15000 },
    { id: 'snake', x: 330, y: 420, h: 40, kt: 220, callsign: 'SNAKE21', type: 'F16', code: '4561', alt: 2500 },
    { id: 'enf', x: 590, y: 470, h: 20, kt: 250, callsign: 'ENFLD11', type: 'C130', code: '7700', emergency: 'GENERAL', alt: 9000 },
    { id: 'dude', x: 380, y: 170, h: 100, kt: 240, callsign: 'DUDE41', type: 'F16', code: '4512', alt: 7000 },
    { id: 'hawg', x: 490, y: 185, h: 280, kt: 210, callsign: 'HAWG61', type: 'A10', code: '4513', alt: 6500 },
    { id: 'rage', x: 120, y: 490, h: 200, kt: 230, callsign: 'RAGE51', type: 'F16', code: '4570', alt: 23000, stale: 8000 },
    { id: 'boar', x: 805, y: 320, h: 350, kt: 450, callsign: 'BOAR05', type: 'F15', code: '4610', alt: 21000 },
    { id: 'mojo', x: 790, y: 200, h: 60, kt: 420, callsign: 'MOJO21', type: 'F16', code: '4633', alt: 18000 },
    { id: 'bad', x: 270, y: 255, h: 110, kt: 480, tn: 'TN00031', override: 'hostile' },
  ];
  const fdrs = [
    FDR('f-viper', 'VIPER11', 'F16', ASSIGNED(6000, 250)), FDR('f-colt', 'COLT31', 'F18'), FDR('f-snake', 'SNAKE21', 'F16'),
    FDR('f-enf', 'ENFLD11', 'C130'), FDR('f-dude', 'DUDE41', 'F16'), FDR('f-hawg', 'HAWG61', 'A10'),
    FDR('f-rage', 'RAGE51', 'F16'), FDR('f-boar', 'BOAR05', 'F15'), FDR('f-mojo', 'MOJO21', 'F16'),
  ];
  const strips = [
    S('s-viper', 'f-viper', 'APP'),
    S('s-colt-ctr', 'f-colt', 'CTR', { facilityId: 'CENTER', coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerPositionId: 'APP', peerFacilityId: 'INCIRLIK' } }),
    S('s-colt-app', 'f-colt', 'APP', { coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, peerPositionId: 'CTR', peerFacilityId: 'CENTER' } }),
    S('s-snake-twr', 'f-snake', 'TWR', { role: 'DEPARTURE', state: 'HANDED_OFF', coordination: { primitive: 'POINT_OUT', state: 'PROPOSED', peerPositionId: 'APP' } }),
    S('s-snake-app', 'f-snake', 'APP', { role: 'DEPARTURE', state: 'HANDED_OFF', coordination: { primitive: 'POINT_OUT', state: 'PROPOSED', mintedForCoordination: true, peerPositionId: 'TWR' } }),
    S('s-enf', 'f-enf', 'CTR', { facilityId: 'CENTER' }),
    S('s-dude', 'f-dude', 'APP'),
    S('s-hawg', 'f-hawg', 'TWR'),
    S('s-rage', 'f-rage', 'APP'),
    S('s-boar', 'f-boar', 'CTR', { facilityId: 'CENTER', role: 'OVERFLIGHT' }),
    S('s-mojo-ctr', 'f-mojo', 'CTR', { facilityId: 'CENTER', role: 'DEPARTURE', state: 'HANDED_OFF', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } }),
    S('s-mojo-m', 'f-mojo', 'TAC_C2', { facilityId: 'TACTICAL', role: 'MISSION', state: 'ON_STATION', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } }),
  ];
  const correlations = fdrs.map(f => ({ fdrId: f.fdrId, trackId: f.fdrId.slice(2), state: 'CORRELATED' }));
  const d = at(380, 170); const h = at(490, 185);
  const alerts = {
    conformance: [{ fdrId: 'f-viper', alerts: [{ kind: 'HEADING', actual: 230, assigned: 250 }] }],
    stca: [{ id: 'dude|hawg', a: 'dude', b: 'hawg', aCallsign: 'DUDE41', bCallsign: 'HAWG61', timeToCpaSec: 55, minNm: 1.8, vertFt: 500,
      aAt: at(429, 179), bAt: at(436, 176) }],
    obligations: [],
  };
  void d; void h;
  return {
    radars: [APP_RADAR], held: [{ facilityId: 'INCIRLIK', positionId: 'APP', isPrimary: true }],
    strips, fdrs, correlations, alerts, tracks: c.map(wire), center: at(460, 285), zoom: 8.3,
  };
}

test('scene 1: an APP-only scope, map background on', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['APP'] });
  await page.evaluate(() => { settings.atcMapBackground = true; });
  await inject(page, appScene());
  const labels = await page.evaluate(() => buildLabels().features.filter(f => f.properties.scheme === 'ATC').length);
  expect(labels).toBeGreaterThan(5);
  await snap(page, 'scene1-app-scope.png');
});

test('scene 4: "ATC map background" off — the black strict-STARS scope', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['APP'] });
  await page.evaluate(() => { settings.atcMapBackground = false; });
  await inject(page, appScene());
  await page.waitForFunction(() => map.getPaintProperty('Background', 'background-color') === '#000000');
  await snap(page, 'scene4-black-scope.png');
});

// ── Scene 2: the two ends of a handoff and a point-out ────────────────────

test('scene 2: the sender ends — CTR handing COLT31 to APP, TWR pointing SNAKE21 out', async ({ page }) => {
  await openScope(page, { CENTER: ['CTR'], INCIRLIK: ['TWR'] });
  const sc = appScene();
  sc.held = [{ facilityId: 'CENTER', positionId: 'CTR' }, { facilityId: 'INCIRLIK', positionId: 'TWR' }];
  sc.radars = [{ ...APP_RADAR, id: 'app:x' }];
  sc.tracks = sc.tracks.filter(t => ['colt', 'snake', 'enf', 'boar', 'hawg', 'sq'].includes(t.id));
  sc.alerts = { conformance: [], stca: [], obligations: [] };
  await inject(page, sc);
  await snap(page, 'scene2-senders-ctr-twr.png');
});

test('scene 2b: the receiver end, after a point-out was accepted and a handoff taken', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['APP'] });
  const sc = appScene();
  sc.tracks = sc.tracks.filter(t => ['colt', 'snake'].includes(t.id));
  sc.alerts = { conformance: [], stca: [], obligations: [] };
  await inject(page, sc);
  // Accept both, the STARS way: a click on the target sends the ACCEPT
  // mutation. Here the Board is injected, so the server refuses it; flip the
  // two replicas to ACTIVE locally, as its ack would.
  const clicked = await page.evaluate(() => [atcTargetClick('colt'), atcTargetClick('snake')]);
  expect(clicked).toEqual(['ACCEPT_HANDOFF', 'ACCEPT_POINT_OUT']);
  await page.evaluate(() => {
    for (const id of ['s-colt-app', 's-snake-app']) {
      const s = getEfspStrip(id);
      applyEfspDelta({ strips: { updated: [{ ...s, coordination: { ...s.coordination, state: 'ACTIVE' } }] } });
    }
    updateMap();
  });
  await snap(page, 'scene2b-receiver-after-accept.png');
});

// ── Scene 3: TAC_C2 + APP ─────────────────────────────────────────────────

test('scene 3: a mixed TAC_C2 + APP session — the tactical scheme wins where the E-3 sees a track', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['APP'], TACTICAL: ['TAC_C2'] });
  const c = [
    { id: 'viper', x: 470, y: 200, h: 250, kt: 280, callsign: 'VIPER11', type: 'F16', code: '4521', alt: 12000, scheme: 'TACTICAL', iff: 'friendly', height: true },
    { id: 'mojo', x: 260, y: 130, h: 60, kt: 420, callsign: 'MOJO21', type: 'F16', code: '4633', alt: 18000, scheme: 'TACTICAL', iff: 'friendly', height: true },
    { id: 'bad', x: 150, y: 250, h: 100, kt: 480, tn: 'TN00031', alt: 25000, altSource: 'RADAR', height: true, scheme: 'TACTICAL', iff: 'hostile', override: 'hostile' },
    { id: 'snake', x: 545, y: 95, h: 70, kt: 300, callsign: 'SNAKE21', type: 'F16', code: '4561', alt: 8000, scheme: 'TACTICAL', iff: 'friendly' },
    { id: 'colt', x: 770, y: 300, h: 280, kt: 320, callsign: 'COLT31', type: 'F18', code: '4532', alt: 15000 },
    { id: 'sq', x: 700, y: 420, h: 330, kt: 160, code: '6123', alt: 4200, tn: 'TN00002' },
    { id: 'x36', x: 820, y: 170, h: 250, kt: 450, tn: 'TN00036', override: 'hostile' },
  ];
  const fdrs = [FDR('f-viper', 'VIPER11', 'F16', ASSIGNED(6000, 250)), FDR('f-mojo', 'MOJO21', 'F16'), FDR('f-snake', 'SNAKE21', 'F16'), FDR('f-colt', 'COLT31', 'F18', ASSIGNED(8000, 280))];
  const strips = [S('s-viper', 'f-viper', 'APP'), S('s-mojo-m', 'f-mojo', 'TAC_C2', { facilityId: 'TACTICAL', role: 'MISSION' }), S('s-snake', 'f-snake', 'APP'), S('s-colt', 'f-colt', 'APP')];
  await inject(page, {
    radars: [APP_RADAR, E3_RADAR], datalink: true,
    held: [{ facilityId: 'INCIRLIK', positionId: 'APP' }, { facilityId: 'TACTICAL', positionId: 'TAC_C2' }],
    strips, fdrs, correlations: fdrs.map(f => ({ fdrId: f.fdrId, trackId: f.fdrId.slice(2), state: 'CORRELATED' })),
    alerts: { conformance: [], stca: [], obligations: [] },
    tracks: c.map(wire), center: at(480, 250), zoom: 8.3,
  });
  const schemes = await page.evaluate(() => {
    const out = {};
    for (const f of buildDots().features) out[f.properties.id] = f.properties.scheme;
    return out;
  });
  expect(schemes.viper).toBe('TACTICAL');
  expect(schemes.colt).toBe('ATC');
  await snap(page, 'scene3-mixed-tac-app.png');
});
