import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* The radar list, ported out of the renderer (docs/adr/0042).
 *
 * Nothing pinned any of this before — `_buildAllRadars` lived in app.js,
 * which has no module.exports guard and could not be required from a test at
 * all. So this is the first coverage the radar derivation has ever had, and
 * it deliberately pins the two bugs the port fixed as well as the behaviour
 * it kept.
 */

const specsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-radars-')), 'sensor-specs.json');
fs.writeFileSync(specsPath, JSON.stringify({
  radar: {
    'E-3A': { angleFromNose: 360, rangeNm: 216, sweepMs: 10000 },
    'F-16C_50': { angleFromNose: 120, rangeNm: 80, sweepMs: 4000 },
  },
  carrierRadar: {
    CVN_74: { rangeNm: 215, sweepMs: 4000 },
    LHA_Tarawa: { rangeNm: 100, sweepMs: 5000 },
  },
}));
process.env.CRCSYNC_SENSOR_SPECS_PATH = specsPath;

const {
  buildRadars, loadSensorSpecs, isRadarSite, DEFAULT_CAPS, M_PER_NM,
  AIRPORT_RADAR, APPROACH_RADAR, SHIP_RADAR_DEFAULT, AIRPORT_RADAR_HEIGHT_M,
} = await import('../src/radars.js');

const SPECS = loadSensorSpecs(specsPath);

const MISSION = {
  airports: [
    { name: 'Incirlik', icao: 'LTAG', lat: 37.002, lon: 35.426, elev: 44 },
    { name: 'Adana', icao: 'LTAF', lat: 36.982, lon: 35.280, elev: 20 },
    { name: 'H', lat: 37.5, lon: 35.5, elev: 0 },
    { name: 'FARP London', lat: 37.6, lon: 35.6, elev: 0 },
  ],
};

function byId(radars) {
  return new Map(radars.map(r => [r.id, r]));
}

test('loadSensorSpecs: a missing file degrades to empty specs rather than throwing', () => {
  const specs = loadSensorSpecs('/nonexistent/sensor-specs.json');
  assert.deepEqual(specs.radar, {});
  assert.deepEqual(specs.carrierRadar, {});
  assert.deepEqual(specs.datalink.participants, []);
  assert.deepEqual(specs.transponder.syntheticFor, ['own', 'neutral']);
  assert.deepEqual(specs.transponder.mode4For, ['own']);
});

test('every radar says what it can measure: 2D + SSR on the ground, 3D in the air (docs/adr/0059)', () => {
  const radars = byId(buildRadars({
    missionData: MISSION,
    tracks: [
      { id: 1, callsign: 'DARKSTAR', type: 'E-3A', category: 1, lat: 37.5, lon: 35.5, alt: 9000, heading: 0 },
      { id: 2, callsign: 'VIPER', type: 'F-16C_50', category: 1, lat: 37.5, lon: 35.5, alt: 6000, heading: 0 },
      { id: 3, callsign: 'CVN', type: 'CVN_74', category: 4, lat: 36.5, lon: 35.0, alt: 0, heading: 0 },
    ],
    radarSpecs: SPECS,
  }));
  assert.deepEqual(radars.get('apt:Incirlik').caps, { height: false, ssr: true, mode4: true });
  assert.deepEqual(radars.get('app:Incirlik').caps, { height: false, ssr: true, mode4: true });
  assert.deepEqual(radars.get('crc:1').caps, { height: true, ssr: true, mode4: true });
  assert.deepEqual(radars.get('crc:2').caps, { height: true, ssr: true, mode4: true });
  assert.deepEqual(radars.get('carrier:3').caps, { height: true, ssr: true, mode4: true });
  assert.deepEqual(radars.get('cvapp:3').caps, { height: false, ssr: true, mode4: true });
  assert.ok(DEFAULT_CAPS.approach);
});

test('a spec can override its kind: a fighter radar with no IFF interrogator', () => {
  const specs = { ...SPECS, radar: { ...SPECS.radar, 'F-5E-3': { angleFromNose: 60, rangeNm: 20, sweepMs: 3000, caps: { ssr: false } } } };
  const radars = byId(buildRadars({
    missionData: null,
    tracks: [{ id: 9, callsign: 'OLD', type: 'F-5E-3', category: 1, lat: 37.5, lon: 35.5, alt: 6000, heading: 0 }],
    radarSpecs: specs,
  }));
  assert.deepEqual(radars.get('crc:9').caps, { height: true, ssr: false, mode4: true });
});

test('a spec can take away the Mode 4 interrogator: a fighter with no IFF crypto (docs/adr/0066)', () => {
  const specs = { ...SPECS, radar: { ...SPECS.radar, 'F-5E-3': { angleFromNose: 60, rangeNm: 20, sweepMs: 3000, caps: { mode4: false } } } };
  const radars = byId(buildRadars({
    missionData: null,
    tracks: [{ id: 9, callsign: 'OLD', type: 'F-5E-3', category: 1, lat: 37.5, lon: 35.5, alt: 6000, heading: 0 }],
    radarSpecs: specs,
  }));
  assert.deepEqual(radars.get('crc:9').caps, { height: true, ssr: true, mode4: false });
});

test('isRadarSite: helipads, FARPs, FOBs and the bare "H" are not radar sites', () => {
  assert.equal(isRadarSite({ name: 'Incirlik', lat: 1, lon: 1 }), true);
  assert.equal(isRadarSite({ name: 'H', lat: 1, lon: 1 }), false);
  assert.equal(isRadarSite({ name: 'FARP London', lat: 1, lon: 1 }), false);
  assert.equal(isRadarSite({ name: 'Helipad Alpha', lat: 1, lon: 1 }), false);
  assert.equal(isRadarSite({ name: 'FOB Delta', lat: 1, lon: 1 }), false);
  assert.equal(isRadarSite({ name: 'Incirlik' }), false, 'no position is not a radar site');
});

test('each real airfield yields exactly one surveillance and one approach radar', () => {
  const radars = buildRadars({ missionData: MISSION, tracks: [], radarSpecs: SPECS });
  const ids = radars.map(r => r.id).sort();
  assert.deepEqual(ids, ['apt:Adana', 'apt:Incirlik', 'app:Adana', 'app:Incirlik'].sort());
});

test('the airport radar is the only one that sees ground vehicles', () => {
  const radars = byId(buildRadars({ missionData: MISSION, tracks: [], radarSpecs: SPECS }));
  assert.equal(radars.get('apt:Incirlik').seesGround, true);
  assert.equal(radars.get('apt:Incirlik').noGroundAircraft, false);
  assert.equal(radars.get('app:Incirlik').seesGround, false);
  assert.equal(radars.get('app:Incirlik').noGroundAircraft, true);
});

test('airfield radars carry their ICAO so a config selector can name them, and an assumed tower height', () => {
  const radars = byId(buildRadars({ missionData: MISSION, tracks: [], radarSpecs: SPECS }));
  const apt = radars.get('apt:Incirlik');
  assert.equal(apt.airportIcao, 'LTAG');
  assert.equal(apt.airport, 'Incirlik');
  assert.equal(apt.label, 'LTAG');
  assert.equal(radars.get('app:Incirlik').label, 'LTAG APP');
  assert.equal(apt.elevM, 44 + AIRPORT_RADAR_HEIGHT_M);
  assert.equal(apt.rangeM, AIRPORT_RADAR.rangeNm * M_PER_NM);
  assert.equal(radars.get('app:Incirlik').rangeM, APPROACH_RADAR.rangeNm * M_PER_NM);
});

test('an airfield with no ICAO falls back to its name as the label', () => {
  const radars = byId(buildRadars({
    missionData: { airports: [{ name: 'Somewhere', lat: 1, lon: 1, elev: 0 }] },
    tracks: [], radarSpecs: SPECS,
  }));
  assert.equal(radars.get('apt:Somewhere').label, 'Somewhere');
  assert.equal(radars.get('apt:Somewhere').airportIcao, null);
});

test('a 360-degree airborne dish is an awacs; a forward-looking cone is a fighter', () => {
  const tracks = [
    { id: 11, callsign: 'MAGIC', type: 'E-3A', category: 1, lat: 37.5, lon: 35.5, alt: 9000, heading: 90, coalition: 3 },
    { id: 12, callsign: 'VIPER1', type: 'F-16C_50', category: 1, lat: 37.4, lon: 35.4, alt: 6000, heading: 270, coalition: 3 },
  ];
  const radars = byId(buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS }));
  assert.equal(radars.get('crc:11').type, 'awacs');
  assert.equal(radars.get('crc:11').angleFromNose, 360);
  assert.equal(radars.get('crc:12').type, 'fighter');
  assert.equal(radars.get('crc:12').angleFromNose, 120);
  assert.equal(radars.get('crc:12').heading, 270, 'a nose radar points where the aircraft points');
  assert.equal(radars.get('crc:11').elevM, 9000, 'an airborne radar uses its own live altitude');
  assert.equal(radars.get('crc:11').coalition, 3);
});

test('an aircraft type with no radar spec contributes no radar', () => {
  const tracks = [{ id: 20, callsign: 'HERC', type: 'C-130', category: 1, lat: 37.5, lon: 35.5, alt: 5000 }];
  const radars = buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS });
  assert.equal(radars.filter(r => r.id.startsWith('crc:')).length, 0);
});

test('an airborne radar on the ground is listed but flagged, so the panel can say why it is dark', () => {
  // Inside the on-ground radius of Incirlik and below the AGL threshold.
  const tracks = [{ id: 13, callsign: 'MAGIC', type: 'E-3A', category: 1, lat: 37.002, lon: 35.426, alt: 50 }];
  const radars = byId(buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS }));
  assert.equal(radars.get('crc:13').onGround, true);
});

test('every ship gets a surface-search radar, unknown types falling back rather than being skipped', () => {
  const tracks = [
    { id: 30, callsign: 'STENNIS', type: 'CVN_74', category: 4, lat: 36.0, lon: 34.0, alt: 0 },
    { id: 31, callsign: 'SOMEBOAT', type: 'Unknown_Frigate', category: 4, lat: 36.1, lon: 34.1, alt: 0 },
  ];
  const radars = byId(buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS }));
  assert.equal(radars.get('carrier:30').rangeM, 215 * M_PER_NM);
  assert.equal(radars.get('carrier:31').rangeM, SHIP_RADAR_DEFAULT.rangeNm * M_PER_NM);
  assert.equal(radars.get('carrier:31').type, 'carrier');
});

test("a CVN's approach radar uses its own id prefix, not the airfields' — the bug the port fixed", () => {
  // `app:${track.id}` used to collide with `app:${airport.name}`, so anything
  // keying on the prefix could match a carrier for an airfield.
  const tracks = [{ id: 30, callsign: 'STENNIS', type: 'CVN_74', category: 4, lat: 36.0, lon: 34.0, alt: 0 }];
  const radars = byId(buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS }));
  assert.ok(radars.has('cvapp:30'));
  assert.ok(!radars.has('app:30'));
  assert.equal(radars.get('cvapp:30').rangeM, 50 * M_PER_NM);
  // And the airfield approach radars are untouched by it.
  assert.ok(radars.has('app:Incirlik'));
});

test('a non-CVN ship gets no second approach radar', () => {
  const tracks = [{ id: 32, callsign: 'TARAWA', type: 'LHA_Tarawa', category: 4, lat: 36.0, lon: 34.0, alt: 0 }];
  const radars = buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS });
  assert.equal(radars.filter(r => r.id.startsWith('cvapp:')).length, 0);
  assert.equal(radars.filter(r => r.id === 'carrier:32').length, 1);
});

test('no mission data yields no radars at all rather than throwing', () => {
  assert.deepEqual(buildRadars({ missionData: null, tracks: null, radarSpecs: null }), []);
});

test('an airborne radar is labelled with its own unit callsign: it is the controller’s sensor, not a contact', () => {
  const tracks = [{ id: 11, callsign: 'DARKSTAR', type: 'E-3A', category: 1, lat: 37.5, lon: 35.5, alt: 9000 }];
  const radars = byId(buildRadars({ missionData: MISSION, tracks, radarSpecs: SPECS }));
  assert.equal(radars.get('crc:11').label, 'DARKSTAR');
});
