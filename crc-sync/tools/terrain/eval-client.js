'use strict';

// A DCS-gRPC CustomService.Eval client for the terrain commands only (docs/adr/0133): the same host the server uses
// (CRCSYNC_DCS_GRPC_HOST, else DCS_GRPC_HOST), one channel, a deadline per call. crc-sync itself never loads this file.

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { dcsHostOf, PROTO_ROOT } = require('../../src/grpc-client');

function createEvalClient(env = process.env, { timeoutMs = 60000 } = {}) {
  const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(path.join(PROTO_ROOT, 'dcs/custom/v0/custom.proto'), { keepCase: true, includeDirs: [PROTO_ROOT] }));
  const host = dcsHostOf(env);
  const client = new pkg.dcs.custom.v0.CustomService(host, grpc.credentials.createInsecure());
  return {
    host,
    evalLua(lua) {
      return new Promise((resolve, reject) => {
        client.Eval({ lua }, { deadline: Date.now() + timeoutMs }, (err, res) => {
          if (err) return reject(err);
          try { resolve(JSON.parse(JSON.parse(res.json))); } catch (e) { reject(new Error(`Eval answer is not JSON: ${e.message}`)); }
        });
      });
    },
    close() { client.close(); },
  };
}

module.exports = { createEvalClient };
