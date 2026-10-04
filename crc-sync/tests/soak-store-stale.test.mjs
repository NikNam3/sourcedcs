import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Shadow, STORE_SYNC, STORE_DELTA_TYPES, STORE_STALE_BEATS } = require('../tools/soak/shadow.js');
const { STORE_SYNC: SERVER } = require('../src/efsp/stores.js');

const snap = () => ({ storeSeqs: { correlations: 5, airspaces: 2 }, storeEpochs: { correlations: 'e1', airspaces: 'a1' } });

test('the soak shadow declares the same six stores as stores.js (ADR 0106)', () => {
  assert.deepEqual(STORE_SYNC, SERVER.map(({ key, seqKey, epochKey, gapFromDeltas }) => ({ key, seqKey, epochKey, gapFromDeltas })));
  assert.deepEqual([...STORE_DELTA_TYPES].sort(), SERVER.map(s => s.deltaType).sort());
});

test('a store that stays ahead of the shadow past the bound is flagged once, and a slice repairs it', () => {
  const sh = new Shadow(['INCIRLIK']);
  sh.adoptStoreSnapshot(snap());
  const beat = { correlations: { seq: 9, epoch: 'e1' }, airspaces: { seq: 2, epoch: 'a1' } };
  assert.deepEqual(sh.noteHeartbeat(beat), []);
  assert.ok(!sh.wantResync.has('correlations'), 'one beat is not a gap');
  sh.noteHeartbeat(beat);
  assert.ok(sh.wantResync.has('correlations'), 'two beats ask for a slice');
  let flagged = [];
  for (let i = 2; i < STORE_STALE_BEATS; i++) flagged = flagged.concat(sh.noteHeartbeat(beat));
  assert.deepEqual(flagged, ['correlations']);
  assert.deepEqual(sh.noteHeartbeat(beat), [], 'flagged once per episode');
  sh.applyStoreSlices({ correlations: { seq: 9, epoch: 'e1' } });
  assert.equal(sh.noteHeartbeat(beat).length, 0);
  assert.equal(sh.stores.get('correlations').behind, 0);
});

test('another epoch asks at once; a gap on a gapFromDeltas store asks, on another it waits for the heartbeat', () => {
  const sh = new Shadow(['INCIRLIK']);
  sh.adoptStoreSnapshot(snap());
  sh.noteStoreFrame({ correlationSeq: 8, correlationEpoch: 'e1' });
  assert.equal(sh.stores.get('correlations').seq, 5, 'a jump on correlations is not adopted');
  assert.ok(!sh.wantResync.has('correlations'));
  sh.noteStoreFrame({ airspaceSeq: 4, airspaceEpoch: 'a1' });
  assert.ok(sh.wantResync.has('airspaces'));
  sh.noteStoreFrame({ correlationSeq: 6, correlationEpoch: 'e1' });
  assert.equal(sh.stores.get('correlations').seq, 6, 'the next seq is adopted');
  sh.noteHeartbeat({ correlations: { seq: 6, epoch: 'e2' } });
  assert.ok(sh.wantResync.has('correlations'));
});

test('a snapshot replaces the positions and clears every pending request', () => {
  const sh = new Shadow(['INCIRLIK']);
  sh.adoptStoreSnapshot(snap());
  sh.noteHeartbeat({ correlations: { seq: 9, epoch: 'e1' } }); sh.noteHeartbeat({ correlations: { seq: 9, epoch: 'e1' } });
  sh.adoptStoreSnapshot({ storeSeqs: { correlations: 9 }, storeEpochs: { correlations: 'e3' } });
  assert.equal(sh.wantResync.size, 0);
  assert.equal(sh.stores.get('correlations').epoch, 'e3');
});
