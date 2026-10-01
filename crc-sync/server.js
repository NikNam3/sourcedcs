'use strict';
require('dotenv').config();
const log = require('./src/log');
log.installConsole(); // LOG_LEVEL gates the console.* calls LOG-2 has not converted yet

const GrpcClient = require('./src/grpc-client');
const SrsClient  = require('./src/srs-client');
const { createApp } = require('./src/app');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const grpcClient = new GrpcClient();
const srsClient  = new SrsClient();
const app = createApp({ env: process.env, grpcClient, srsClient });
app.start();

app.server.listen(PORT, () => {
  log.logger('server').info('listening', { url: `http://localhost:${PORT}` });
});

grpcClient.connect();
srsClient.connect();
