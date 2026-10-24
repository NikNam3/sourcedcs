'use strict';

/* L22 — the ATC scope in the STARS scheme (crc-sync's docs/adr/0088), in the
 * real app: the four scenes of the approved mockup (docs/wip/L22-mockup.html,
 * H71), drawn by the product code and photographed into the test output directory.
 *
 * The rig has no DCS, so the picture is injected the way the wire would
 * deliver it: a coverage message, an EFSP snapshot (Strips, flight-data records,
 * correlations, position letters), a track snapshot with each contact's
 * `scheme`, and the conformance/CA alerts. Everything after that — the
 * relation, the blocks, the colours, the black scope — is the app's own.
 */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('./helpers/test');
const { openPanel, frames } = require('./helpers/app');


// LTAG, and the mockup's layout: 100 px = 10 NM, (430, 330) = the field.
const LTAG = { lat: 37.002, lon: 35.426 };
const at = (x, y) => ({ lat: LTAG.lat - (y - 330) * 0.1 / 60, lon: LTAG.lon + (x - 430) * 0.1 / 47.9 });

const APP_RADAR = { id: 'app:Incirlik', type: 'approach', presentation: 'ATC', label: 'LTAG APP', airport: 'Incirlik', ...LTAG, elevM: 60, rangeM: 80 * 1852, sweepMs: 3000, caps: { ssr: true } };
const E3_RADAR = { id: 'crc:99', type: 'awacs', presentation: 'TACTICAL', label: 'DARKSTAR', ...at(150, 110), elevM: 9000, rangeM: 216 * 1852, sweepMs: 10000, caps: { ssr: true, height: true, mode4: true } };

const mkFlightData = (flightDataId, callsign, type, clearance) => ({
  flightDataId, identity: { callsign, aircraftType: type, beaconAssigned: null }, filed: {}, clearance: clearance || {},
});
const ASSIGNED = (altFt, hdg) => ({
  altitude: { entries: [{ status: 'ACTIVE', parsed: altFt }] },
  heading: { entries: [{ status: 'ACTIVE', parsed: hdg }] },
});
const S = (stripId, flightDataId, ownerPositionId, over = {}) => ({
  stripId, flightDataId, ownerPositionId, facilityId: 'INCIRLIK', stripType: 'ARRIVAL', state: 'INBOUND',
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
    label: { callsign: c.callsign || null, source: c.callsign ? 'FLIGHT_DATA' : null, tag: null, trackNumber: c.tn || `TN000${c.id.length}` },
    type: c.type || null, ssr: squawk,
    altitude: c.alt ? { ft: c.alt, ref: 'QNH', source: c.altSource || (squawk ? 'MODE_C' : 'RADAR') } : null,
    dl: null, scheme: c.scheme || 'ATC', _h: c.h, _kt: c.kt, _stale: c.stale || 0,
  };
}

/** Puts a scene on the page: coverage, Board, tracks with trails, alerts, view. */
async function inject(page, scene) {
  await page.evaluate((sc) => {
    crc.app.applyCoverage({ radars: sc.radars, signedOnPositions: sc.signedOn, datalink: !!sc.datalink });
    crc.state.applyEfspSnapshot({
      boardSeq: crc.state.efspResyncPositionFor(crc.state.getEfspFacility()).lastBoardSeq, facility: crc.state.getEfspFacility(), bays: crc.state.getEfspBays(), positions: crc.state.getAllEfspPositions(),
      strips: sc.strips, flightDataList: sc.flightDataList, correlations: sc.correlations,
      positionLetters: {
        INCIRLIK: { OPS: 'O', CD: 'D', GC: 'G', LC: 'T', AP: 'A' }, CENTER: { CTR: 'C' },
        TACTICAL: { TAC_C2: 'M', AIC: 'M', GCI: 'M', JTAC: 'M' },
      },
    });
    const now = Date.now();
    const list = sc.tracks.map((t) => {
      const w = { ...t, illuminatedAt: now - t._stale };
      delete w._h; delete w._kt; delete w._stale;
      return w;
    });
    crc.app.applySnapshot(list);
    // Trails and speed: six earlier returns along the track's heading.
    for (const t of sc.tracks) {
      const ms = t._kt * 0.5144;
      const pts = [];
      for (let i = 6; i >= 0; i--) {
        const [lat, lon] = crc.geo.projectPos(t.lat, t.lon, (t._h + 180) % 360, ms * 5 * i);
        pts.push({ lat, lon, altFt: t.altitude ? t.altitude.ft : null, timestamp: now - t._stale - i * 5000 });
      }
      crc.picture.history.set(t.id, pts);
    }
    crc.state.applyEfspAlerts(sc.alerts);
    crc.picture.labelOffsets.clear();
    crc.mapHandle.map.jumpTo({ center: [sc.center.lon, sc.center.lat], zoom: sc.zoom });
    crc.geojson.updateMap();
  }, scene);
}

async function snap(page, name) {
  await page.waitForFunction(() => crc.mapHandle.map.loaded()); // tiles and glyphs (the key-less tile requests answer 403, which is loaded)
  await frames(page, 3);
  await page.locator('#map').screenshot({ path: test.info().outputPath(name), animations: 'disabled' });
}

async function openScope(page, signedOn) {
  const facilities = Object.keys(signedOn);
  await openPanel(page, { signedOn: signedOn[facilities[0]], facilityId: facilities[0], controller: `l22-${facilities.join('-')}-${Date.now()}` });
  for (const f of facilities.slice(1)) await page.evaluate(([fac, h]) => crc.ws.sendEfspSetPositions(fac, h), [f, signedOn[f]]);
  await page.evaluate(() => crc.dock.toggleDockPanel && crc.dock.toggleDockPanel('efsp', false));
  await page.waitForFunction(() => typeof crc.mapHandle.mapReady !== 'undefined' && crc.mapHandle.mapReady);
  await page.evaluate(() => crc.mapHandle.map.resize());
}

// ── Scene 1 / 4: an AP-only scope ─────────────────────────────────────────

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
  const flightDataList = [
    mkFlightData('f-viper', 'VIPER11', 'F16', ASSIGNED(6000, 250)), mkFlightData('f-colt', 'COLT31', 'F18'), mkFlightData('f-snake', 'SNAKE21', 'F16'),
    mkFlightData('f-enf', 'ENFLD11', 'C130'), mkFlightData('f-dude', 'DUDE41', 'F16'), mkFlightData('f-hawg', 'HAWG61', 'A10'),
    mkFlightData('f-rage', 'RAGE51', 'F16'), mkFlightData('f-boar', 'BOAR05', 'F15'), mkFlightData('f-mojo', 'MOJO21', 'F16'),
  ];
  const strips = [
    S('s-viper', 'f-viper', 'AP'),
    S('s-colt-ctr', 'f-colt', 'CTR', { facilityId: 'CENTER', coordination: { primitive: 'HANDOFF', state: 'INITIATED', peerPositionId: 'AP', peerFacilityId: 'INCIRLIK' } }),
    S('s-colt-app', 'f-colt', 'AP', { coordination: { primitive: 'HANDOFF', state: 'INITIATED', mintedForCoordination: true, peerPositionId: 'CTR', peerFacilityId: 'CENTER' } }),
    S('s-snake-lc', 'f-snake', 'LC', { stripType: 'DEPARTURE', state: 'HANDED_OFF', coordination: { primitive: 'POINT_OUT', state: 'INITIATED', peerPositionId: 'AP' } }),
    S('s-snake-app', 'f-snake', 'AP', { stripType: 'DEPARTURE', state: 'HANDED_OFF', coordination: { primitive: 'POINT_OUT', state: 'INITIATED', mintedForCoordination: true, peerPositionId: 'LC' } }),
    S('s-enf', 'f-enf', 'CTR', { facilityId: 'CENTER' }),
    S('s-dude', 'f-dude', 'AP'),
    S('s-hawg', 'f-hawg', 'LC'),
    S('s-rage', 'f-rage', 'AP'),
    S('s-boar', 'f-boar', 'CTR', { facilityId: 'CENTER', stripType: 'OVERFLIGHT' }),
    S('s-mojo-ctr', 'f-mojo', 'CTR', { facilityId: 'CENTER', stripType: 'DEPARTURE', state: 'HANDED_OFF', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } }),
    S('s-mojo-m', 'f-mojo', 'TAC_C2', { facilityId: 'TACTICAL', stripType: 'MISSION', state: 'ON_STATION', tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE' } }),
  ];
  const correlations = flightDataList.map(f => ({ flightDataId: f.flightDataId, trackId: f.flightDataId.slice(2), state: 'CORRELATED' }));
  const d = at(380, 170); const h = at(490, 185);
  const alerts = {
    conformance: [{ flightDataId: 'f-viper', alerts: [{ kind: 'HEADING', actual: 230, assigned: 250 }] }],
    conflictAlert: [{ id: 'dude|hawg', a: 'dude', b: 'hawg', aCallsign: 'DUDE41', bCallsign: 'HAWG61', timeToCpaSec: 55, minNm: 1.8, vertFt: 500,
      aAt: at(429, 179), bAt: at(436, 176) }],
    obligations: [],
  };
  void d; void h;
  return {
    radars: [APP_RADAR], signedOn: [{ facilityId: 'INCIRLIK', positionId: 'AP', isPrimary: true }],
    strips, flightDataList, correlations, alerts, tracks: c.map(wire), center: at(460, 285), zoom: 8.3,
  };
}

test('scene 1: an AP-only scope, map background on', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['AP'] });
  await page.evaluate(() => { crc.settings.settings.atcMapBackground = true; });
  await inject(page, appScene());
  const labels = await page.evaluate(() => crc.geojson.buildLabels().features.filter(f => f.properties.scheme === 'ATC').length);
  expect(labels).toBeGreaterThan(5);
  await snap(page, 'scene1-app-scope.png');
});

test('scene 4: "ATC map background" off — the black strict-STARS scope', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['AP'] });
  await page.evaluate(() => { crc.settings.settings.atcMapBackground = false; });
  await inject(page, appScene());
  await page.waitForFunction(() => crc.mapHandle.map.getPaintProperty('Background', 'background-color') === '#000000');
  await snap(page, 'scene4-black-scope.png');
});

// ── Scene 2: the two ends of a handoff and a point-out ────────────────────

test('scene 2: the sender ends — CTR handing COLT31 to AP, LC pointing SNAKE21 out', async ({ page }) => {
  await openScope(page, { CENTER: ['CTR'], INCIRLIK: ['LC'] });
  const sc = appScene();
  sc.signedOn = [{ facilityId: 'CENTER', positionId: 'CTR' }, { facilityId: 'INCIRLIK', positionId: 'LC' }];
  sc.radars = [{ ...APP_RADAR, id: 'app:x' }];
  sc.tracks = sc.tracks.filter(t => ['colt', 'snake', 'enf', 'boar', 'hawg', 'sq'].includes(t.id));
  sc.alerts = { conformance: [], conflictAlert: [], obligations: [] };
  await inject(page, sc);
  await snap(page, 'scene2-senders-ctr-twr.png');
});

test('scene 2b: the receiver end, after a point-out was accepted and a handoff taken', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['AP'] });
  const sc = appScene();
  sc.tracks = sc.tracks.filter(t => ['colt', 'snake'].includes(t.id));
  sc.alerts = { conformance: [], conflictAlert: [], obligations: [] };
  await inject(page, sc);
  // Accept both, the STARS way: a click on the target sends the ACCEPT
  // mutation. Here the Board is injected, so the server refuses it; flip the
  // two replicas to ACTIVE locally, as its ack would.
  const clicked = await page.evaluate(() => [crc.atc.atcTargetClick('colt'), crc.atc.atcTargetClick('snake')]);
  expect(clicked).toEqual(['ACCEPT_HANDOFF', 'ACCEPT_POINT_OUT']);
  await page.evaluate(() => {
    for (const id of ['s-colt-app', 's-snake-app']) {
      const s = crc.state.getEfspStrip(id);
      crc.state.applyEfspDelta({ strips: { updated: [{ ...s, coordination: { ...s.coordination, state: 'ACTIVE' } }] } });
    }
    crc.geojson.updateMap();
  });
  await snap(page, 'scene2b-receiver-after-accept.png');
});

// ── Scene 3: TAC_C2 + AP ─────────────────────────────────────────────────

test('scene 3: a mixed TAC_C2 + AP session — the tactical scheme wins where the E-3 sees a track', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['AP'], TACTICAL: ['TAC_C2'] });
  const c = [
    { id: 'viper', x: 470, y: 200, h: 250, kt: 280, callsign: 'VIPER11', type: 'F16', code: '4521', alt: 12000, scheme: 'TACTICAL', iff: 'friendly', height: true },
    { id: 'mojo', x: 260, y: 130, h: 60, kt: 420, callsign: 'MOJO21', type: 'F16', code: '4633', alt: 18000, scheme: 'TACTICAL', iff: 'friendly', height: true },
    { id: 'bad', x: 150, y: 250, h: 100, kt: 480, tn: 'TN00031', alt: 25000, altSource: 'RADAR', height: true, scheme: 'TACTICAL', iff: 'hostile', override: 'hostile' },
    { id: 'snake', x: 545, y: 95, h: 70, kt: 300, callsign: 'SNAKE21', type: 'F16', code: '4561', alt: 8000, scheme: 'TACTICAL', iff: 'friendly' },
    { id: 'colt', x: 770, y: 300, h: 280, kt: 320, callsign: 'COLT31', type: 'F18', code: '4532', alt: 15000 },
    { id: 'sq', x: 700, y: 420, h: 330, kt: 160, code: '6123', alt: 4200, tn: 'TN00002' },
    { id: 'x36', x: 820, y: 170, h: 250, kt: 450, tn: 'TN00036', override: 'hostile' },
  ];
  const flightDataList = [mkFlightData('f-viper', 'VIPER11', 'F16', ASSIGNED(6000, 250)), mkFlightData('f-mojo', 'MOJO21', 'F16'), mkFlightData('f-snake', 'SNAKE21', 'F16'), mkFlightData('f-colt', 'COLT31', 'F18', ASSIGNED(8000, 280))];
  const strips = [S('s-viper', 'f-viper', 'AP'), S('s-mojo-m', 'f-mojo', 'TAC_C2', { facilityId: 'TACTICAL', stripType: 'MISSION' }), S('s-snake', 'f-snake', 'AP'), S('s-colt', 'f-colt', 'AP')];
  await inject(page, {
    radars: [APP_RADAR, E3_RADAR], datalink: true,
    signedOn: [{ facilityId: 'INCIRLIK', positionId: 'AP' }, { facilityId: 'TACTICAL', positionId: 'TAC_C2' }],
    strips, flightDataList, correlations: flightDataList.map(f => ({ flightDataId: f.flightDataId, trackId: f.flightDataId.slice(2), state: 'CORRELATED' })),
    alerts: { conformance: [], conflictAlert: [], obligations: [] },
    tracks: c.map(wire), center: at(480, 250), zoom: 8.3,
  });
  const schemes = await page.evaluate(() => {
    const out = {};
    for (const f of crc.geojson.buildDots().features) out[f.properties.id] = f.properties.scheme;
    return out;
  });
  expect(schemes.viper).toBe('TACTICAL');
  expect(schemes.colt).toBe('ATC');
  await snap(page, 'scene3-mixed-tac-app.png');
});

// ── The letter sits centred on its disc (H163) ───────────────────────────

/**
 * Each disc's centre and its character's ink centre, in screen pixels: two screenshots of the black scope, one with
 * only the discs drawn and one with only the characters, decoded in the page and split into blobs near each target.
 */
async function letterOffsets(page, { scale = 1 } = {}) {
  const shot = async (only) => {
    await page.evaluate(([keep, s]) => {
      const m = crc.mapHandle.map;
      for (const l of m.getStyle().layers) if (l.id !== 'Background') m.setLayoutProperty(l.id, 'visibility', l.id === keep ? 'visible' : 'none');
      m.setPaintProperty('atc-targets', 'circle-radius', 6 * s);
      m.setLayoutProperty('atc-symbols', 'text-size', 11 * s);
    }, [only, scale]);
    await frames(page, 3);
    return (await page.locator('#map').screenshot({ animations: 'disabled' })).toString('base64');
  };
  const discs = await shot('atc-targets');
  const chars = await shot('atc-symbols');
  return page.evaluate(async ([d, c, s]) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    };
    const [D, C] = [await load(d), await load(c)];
    const m = crc.mapHandle.map;
    const r = Math.ceil(9 * s);
    const box = (im, cx, cy) => {
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (let y = Math.max(0, cy - r); y <= Math.min(im.height - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(im.width - 1, cx + r); x++) {
          const i = (y * im.width + x) * 4;
          if (im.data[i] + im.data[i + 1] + im.data[i + 2] > 150) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
      }
      return x1 < 0 ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    };
    const out = [];
    for (const f of crc.geojson.buildDots().features) {
      const p = f.properties;
      if (p.scheme !== 'ATC' || !p.disc || !/^[A-Z]$/.test(p.posChar)) continue;
      const px = m.project(f.geometry.coordinates);
      const cx = Math.round(px.x); const cy = Math.round(px.y);
      const a = box(D, cx, cy); const b = box(C, cx, cy);
      if (a && b) out.push({ id: p.id, ch: p.posChar, dx: b.x - a.x, dy: b.y - a.y });
    }
    return out;
  }, [discs, chars, scale]);
}

test('the position letter is centred on its disc, at the scope size and enlarged (H163)', async ({ page }) => {
  await openScope(page, { INCIRLIK: ['AP'] });
  await page.evaluate(() => { crc.settings.settings.atcMapBackground = false; });
  await inject(page, appScene());
  await page.waitForFunction(() => crc.mapHandle.map.getPaintProperty('Background', 'background-color') === '#000000');
  await page.waitForFunction(() => crc.mapHandle.map.loaded());
  const all = {};
  for (const scale of [1, 4]) all[scale] = await letterOffsets(page, { scale });
  console.log('letter offsets (px, ink centre minus disc centre):', JSON.stringify(all));
  for (const scale of [1, 4]) {
    const offs = all[scale];
    expect(offs.length).toBeGreaterThan(3);
    for (const o of offs) {
      expect(Math.abs(o.dx), `${o.ch} dx at scale ${scale}`).toBeLessThanOrEqual(scale === 1 ? 1 : 2);
      expect(Math.abs(o.dy), `${o.ch} dy at scale ${scale}`).toBeLessThanOrEqual(scale === 1 ? 1 : 2);
    }
  }
});
