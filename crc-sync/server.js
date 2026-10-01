'use strict';
require('dotenv').config();
require('./src/log-level').install(); // LOG_LEVEL=error|warn|info|debug, default info

const GrpcClient = require('./src/grpc-client');
const SrsClient  = require('./src/srs-client');
const { createApp } = require('./src/app');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const grpcClient = new GrpcClient();
const srsClient  = new SrsClient();
const app = createApp({ env: process.env, grpcClient, srsClient });
app.start();

app.server.listen(PORT, () => {
  console.log(`[crc-sync] http://localhost:${PORT}`);
});

grpcClient.connect();
srsClient.connect();
