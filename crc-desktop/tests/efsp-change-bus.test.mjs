/* The EFSP change bus (DESK-GRAPH): topics, subscriber order, once-per-flush, batching, and who subscribes to what. */
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGraph } from './helpers/fresh-graph.mjs';

const BUS = 'panels/efsp/efsp-change-bus.js';

test('a mark outside a batch flushes at once; subscribers run once per flush, in order, then in subscription order', async () => {
  const bus = await freshGraph().import(BUS);
  const log = [];
  bus.onEfspChanged(['bays'], () => log.push('view-a'));
  bus.onEfspChanged(['bays', 'map'], () => log.push('bays'), { order: bus.ORDER.BAYS });
  bus.onEfspChanged(['bays'], () => log.push('resolve'), { order: bus.ORDER.RESOLVE });
  bus.onEfspChanged(['bays'], () => log.push('view-b'));
  bus.markEfspChanged('bays', 'map'); // one subscriber hears two topics: it still runs once
  assert.deepEqual(log, ['resolve', 'bays', 'view-a', 'view-b']);
});

test('a batch flushes once, at its end, after the state the handler applied', async () => {
  const bus = await freshGraph().import(BUS);
  let state = 0; const seen = [];
  bus.onEfspChanged('alerts', () => seen.push(state));
  bus.batchEfspChanges(() => {
    bus.markEfspChanged('alerts'); state = 1;
    bus.batchEfspChanges(() => { bus.markEfspChanged('alerts'); state = 2; }); // nested: no flush
    assert.deepEqual(seen, []);
  });
  assert.deepEqual(seen, [2]);
});

test('a subscriber that marks another topic is flushed in the next pass; a loop is refused', async () => {
  const bus = await freshGraph().import(BUS);
  const log = [];
  bus.onEfspChanged('correlations', () => { log.push('corr'); bus.markEfspChanged('map'); });
  bus.onEfspChanged('map', () => log.push('map'));
  bus.markEfspChanged('correlations');
  assert.deepEqual(log, ['corr', 'map']);
  const loop = await freshGraph().import(BUS);
  loop.onEfspChanged('map', () => loop.markEfspChanged('map'));
  assert.throws(() => loop.markEfspChanged('map'), /keep marking each other/);
});

test('an unknown topic cannot be marked or subscribed to', async () => {
  const bus = await freshGraph().import(BUS);
  assert.throws(() => bus.markEfspChanged('strips'), /unknown topic/);
  assert.throws(() => bus.onEfspChanged(['board', 'nope'], () => {}), /unknown topic/);
  assert.throws(() => bus.onEfspChanged([], () => {}), /at least one topic/);
});

test('dispatching a frame flushes after its handler: an alerts frame redraws the Bays, the map and the track panel once each', async () => {
  const g = freshGraph();
  const bus = await g.import(BUS);
  const registry = await g.import('panels/efsp/efsp-message-registry.js');
  registry.registerEfspMessage('test-frame', () => { bus.markEfspChanged('alerts'); bus.markEfspChanged('alerts'); });
  const calls = [];
  bus.onEfspChanged('alerts', () => calls.push('x'));
  registry.dispatchEfspMessage({ type: 'test-frame' });
  assert.deepEqual(calls, ['x']);
});

test('the shipped views subscribe to the topics they draw (the table the handlers rely on)', async () => {
  const g = freshGraph();
  for (const m of ['panels/efsp/bay-view.js', 'panels/efsp/efsp-panel.js', 'panels/efsp/correlation-highlight.js', 'panels/efsp/marsa-badge.js',
    'panels/efsp/ato-strip.js', 'geojson.js', 'panels/track-panel.js', 'panels/efsp/airspace-panel.js', 'panels/efsp/runway-status-panel.js']) await g.import(m);
  const bus = await g.import(BUS);
  const subs = bus.efspChangeSubscriptions();
  const has = (topic, order) => subs.some(s => s.topics.includes(topic) && s.order === order);
  assert.ok(has('snapshot', bus.ORDER.RESOLVE), 'the highlights resolve on a snapshot');
  assert.ok(has('correlations', bus.ORDER.RESOLVE) && has('marsa', bus.ORDER.RESOLVE));
  for (const t of ['snapshot', 'board', 'ack', 'bays', 'correlations', 'marsa', 'alerts', 'sfa']) assert.ok(has(t, bus.ORDER.BAYS), `the Bays redraw on ${t}`);
  for (const t of ['snapshot', 'board', 'panel', 'positions', 'correlations']) assert.ok(has(t, bus.ORDER.PANEL), `the panel redraws on ${t}`);
  for (const t of ['snapshot', 'correlations', 'alerts', 'map']) assert.ok(has(t, bus.ORDER.VIEW), `the map redraws on ${t}`);
});
