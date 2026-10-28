'use strict';

/* A DCS-gRPC stand-in that is just enough for crc-sync to load a mission: GetTheatre and one airdrome. Every other RPC is
 * left unimplemented, which crc-sync already treats as "not available" (navpoints, drawings and bullseye resolve empty, the
 * unit and event streams retry). The harness points crc-sync's DCS_GRPC_HOST at `fakeDcsPort(syncPort)`, where nothing listens
 * until a spec calls `startFakeDcs`; that is the same hermetic "no DCS" as before for every other spec.
 *
 * Why it exists: crc-sync scopes the airspace registry to the loaded mission's theater (its docs/adr/0098 §2), and a panel
 * Create/Edit/Delete with no mission is refused "no mission loaded". With a theater loaded, the airspace specs that need the
 * server's real answer (airspace-server.spec.js) get one.
 */

const path = require('path');
const { createRequire } = require('module');

const SYNC_DIR = path.join(__dirname, '..', '..', '..', 'crc-sync');
const syncRequire = createRequire(path.join(SYNC_DIR, 'package.json'));

/** Where the harness's crc-sync looks for DCS-gRPC: next to its own port, so every lane has its own. */
const fakeDcsPort = (syncPort) => syncPort + 200;

/**
 * `units: true` also serves MissionService.StreamUnits (crc-sync docs/adr/0122's e2e: an aircraft crossing an airspace
 * boundary): `setUnit({id, lat, lon, altM, ...})` sends a unit to every open stream and to every stream opened later. Off by
 * default, so every other spec keeps the "no units" rig.
 */
async function startFakeDcs(port, { theatre = 'Syria', units = false } = {}) {
  const grpc = syncRequire('@grpc/grpc-js');
  const protoLoader = syncRequire('@grpc/proto-loader');
  const root = process.env.DCS_GRPC_PROTO_PATH || path.join(SYNC_DIR, 'protos');
  const def = protoLoader.loadSync(path.join(root, 'dcs/world/v0/world.proto'), { keepCase: true, includeDirs: [root] });
  const world = grpc.loadPackageDefinition(def).dcs.world.v0.WorldService;
  const server = new grpc.Server();
  const live = new Map(); // unit id -> the StreamUnitsResponse last sent for it
  const streams = new Set();
  if (units) {
    const mdef = protoLoader.loadSync(path.join(root, 'dcs/mission/v0/mission.proto'), { keepCase: true, includeDirs: [root] });
    const mission = grpc.loadPackageDefinition(mdef).dcs.mission.v0.MissionService;
    server.addService(mission.service, {
      StreamUnits: (call) => {
        streams.add(call);
        for (const msg of live.values()) call.write(msg);
        const drop = () => streams.delete(call);
        call.on('cancelled', drop);
        call.on('close', drop);
        call.on('error', drop);
      },
    });
  }
  server.addService(world.service, {
    GetTheatre: (_call, cb) => cb(null, { theatre }),
    GetAirbases: (_call, cb) => cb(null, { airbases: [{
      name: 'Incirlik', display_name: 'Incirlik', category: 'AIRBASE_CATEGORY_AIRDROME', coalition: 'COALITION_BLUE',
      position: { lat: 37.0, lon: 35.42, alt: 70 },
    }] }),
  });
  await new Promise((resolve, reject) => server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve())));
  const setUnit = ({ id, name = `UNIT${id}`, callsign = name, type = 'F-16C_50', lat, lon, altM, heading = 0, speed = 150 }) => {
    const msg = { time: 0, unit: {
      id, name, callsign, coalition: 'COALITION_BLUE', type,
      position: { lat, lon, alt: altM, u: 0, v: 0 },
      orientation: { heading, yaw: heading, pitch: 0, roll: 0 },
      velocity: { heading, speed, velocity: { x: 0, y: 0, z: 0 } },
      group: { id, name: `G-${name}`, coalition: 'COALITION_BLUE', category: 'GROUP_CATEGORY_AIRPLANE' },
      number_in_group: 1,
    } };
    live.set(id, msg);
    for (const call of streams) call.write(msg);
  };
  return {
    setUnit,
    streams: () => streams.size,
    stop: () => new Promise((resolve) => {
      for (const call of streams) { try { call.end(); } catch (_) { /* gone */ } }
      server.tryShutdown(() => resolve());
    }),
  };
}

module.exports = { startFakeDcs, fakeDcsPort };
