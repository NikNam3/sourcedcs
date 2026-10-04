import { test } from 'node:test';
import assert from 'node:assert/strict';
import GrpcClient from '../src/grpc-client.js';
import SrsClient from '../src/srs-client.js';

// The DCS-gRPC and SRS upstreams come from the injected env: the root `.env` name wins (compose passes it straight
// through, no rename), the bare name still works for a local run, and neither is read at require time.

test('DCS-gRPC host: CRCSYNC_DCS_GRPC_HOST, then DCS_GRPC_HOST, then the squadron default', () => {
  assert.equal(GrpcClient.dcsHostOf({ CRCSYNC_DCS_GRPC_HOST: 'a:1', DCS_GRPC_HOST: 'b:2' }), 'a:1');
  assert.equal(GrpcClient.dcsHostOf({ DCS_GRPC_HOST: 'b:2' }), 'b:2');
  assert.equal(GrpcClient.dcsHostOf({ CRCSYNC_DCS_GRPC_HOST: '', DCS_GRPC_HOST: 'b:2' }), 'b:2');
  assert.equal(GrpcClient.dcsHostOf({}), 'server.sourcedcs.page:50051');
});

test('StreamUnits options: floor 1, backoff never below the poll rate', () => {
  assert.deepEqual(GrpcClient.streamOptions({}), { poll_rate: 1, max_backoff: 5 });
  assert.deepEqual(GrpcClient.streamOptions({ DCS_GRPC_POLL_RATE: '0' }), { poll_rate: 1, max_backoff: 5 });
  assert.deepEqual(GrpcClient.streamOptions({ DCS_GRPC_POLL_RATE: '8', DCS_GRPC_MAX_BACKOFF: '3' }), { poll_rate: 8, max_backoff: 8 });
});

test('SRS endpoint: CRCSYNC_SRS_* then SRS_*, then the squadron default', () => {
  assert.deepEqual(SrsClient.endpointOf({ CRCSYNC_SRS_HOST: 'h', CRCSYNC_SRS_PORT: '9', SRS_HOST: 'x', SRS_PORT: '1' }), { host: 'h', port: 9 });
  assert.deepEqual(SrsClient.endpointOf({ SRS_HOST: 'x', SRS_PORT: '1' }), { host: 'x', port: 1 });
  assert.deepEqual(SrsClient.endpointOf({}), { host: 'server.sourcedcs.page', port: 5002 });
});

test('a client reads its injected env, not process.env', () => {
  assert.equal(new SrsClient({ env: { SRS_HOST: 'injected' } })._env.SRS_HOST, 'injected');
  assert.equal(new GrpcClient({ env: { DCS_GRPC_HOST: 'injected:1' } })._env.DCS_GRPC_HOST, 'injected:1');
});
