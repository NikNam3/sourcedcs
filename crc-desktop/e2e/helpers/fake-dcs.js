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

async function startFakeDcs(port, { theatre = 'Syria' } = {}) {
  const grpc = syncRequire('@grpc/grpc-js');
  const protoLoader = syncRequire('@grpc/proto-loader');
  const root = process.env.DCS_GRPC_PROTO_PATH || path.join(SYNC_DIR, 'protos');
  const def = protoLoader.loadSync(path.join(root, 'dcs/world/v0/world.proto'), { keepCase: true, includeDirs: [root] });
  const world = grpc.loadPackageDefinition(def).dcs.world.v0.WorldService;
  const server = new grpc.Server();
  server.addService(world.service, {
    GetTheatre: (_call, cb) => cb(null, { theatre }),
    GetAirbases: (_call, cb) => cb(null, { airbases: [{
      name: 'Incirlik', display_name: 'Incirlik', category: 'AIRBASE_CATEGORY_AIRDROME', coalition: 'COALITION_BLUE',
      position: { lat: 37.0, lon: 35.42, alt: 70 },
    }] }),
  });
  await new Promise((resolve, reject) => server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve())));
  return { stop: () => new Promise((resolve) => server.tryShutdown(() => resolve())) };
}

module.exports = { startFakeDcs, fakeDcsPort };
