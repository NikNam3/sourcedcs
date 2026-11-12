/**
 * The figure view's frames table (`src/web/figure/frames.ts`) is a copy of the extraction specs' panel frames and axis
 * edges: it must stay equal to them, figure by figure, for every figure a TOLD chain reads.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

import { FRAMES } from '../src/web/figure/frames.ts';

const SPECS = new URL('../extraction/specs/', import.meta.url);

interface Spec {
  id: string;
  axes: Record<string, { edge?: string }>;
  panels: { id: string; frame: { x: number[]; y: number[] } }[];
}

const specs = readdirSync(SPECS)
  .filter((name) => name.endsWith('.yaml') && !name.startsWith('B1-1'))
  .map((name) => parse(readFileSync(new URL(name, SPECS), 'utf8')) as Spec);

test('the table holds exactly the chart specs (B1-1 is tables only)', () => {
  assert.deepEqual(Object.keys(FRAMES).sort(), specs.map((s) => s.id).sort());
});

for (const spec of specs) {
  test(`${spec.id}: frames and edges equal the spec`, () => {
    const entry = FRAMES[spec.id];
    assert.ok(entry !== undefined);
    const edges = Object.fromEntries(
      Object.entries(spec.axes).flatMap(([name, axis]) => (axis.edge === undefined ? [] : [[name, axis.edge]])),
    );
    assert.deepEqual(entry.edges, edges);
    const panels = Object.fromEntries(spec.panels.map((p) => [p.id, { x: p.frame.x, y: p.frame.y }]));
    assert.deepEqual(entry.panels, panels);
  });
}
