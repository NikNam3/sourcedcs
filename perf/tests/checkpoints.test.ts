/**
 * The hand-read checkpoints (`extraction/checkpoints/<spec id>.yaml`): values a person read off the printed chart
 * where the manual has no sample problem, each checked against the figure function within its own tolerance.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCheckpoints } from './helpers/checkpoints.ts';
import { DATASET_DIR } from './helpers/data.ts';
import { SAMPLE_RUNNERS } from './helpers/sample-runners.ts';

const perfDir = fileURLToPath(new URL('..', import.meta.url));
const fixture = (...parts: string[]): string => join(perfDir, 'tests', 'fixtures', ...parts);

const scratch = mkdtempSync(join(tmpdir(), 'perf-checkpoints-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const GOOD = `- inputs: {takeoff_factor: 3.0, gross_weight_lb: 30000, runway_ft: 8000, headwind_kt: 0, slope_pct: 0}
  expected: {refusal_rcr23_kias: 131}
  tolerance_kias: 2
  source: hand
  read_by: fixture
  date: 2026-10-30
`;

/** A directory holding one checkpoint file `X1-3.yaml` with `text`. */
function dirWith(name: string, text: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'X1-3.yaml'), text);
  return dir;
}

describe('loadCheckpoints', () => {
  test("returns the fixture's one checkpoint, keyed by the spec id from the file name", () => {
    const checkpoints = loadCheckpoints(fixture('checkpoints'));
    assert.deepEqual(
      [...checkpoints],
      [
        [
          'X1-2',
          [
            {
              inputs: { takeoff_factor: 3, gross_weight_lb: 30000, runway_ft: 8000, headwind_kt: 0, slope_pct: 0 },
              expected: { refusal_rcr23_kias: 131 },
              tolerance_kias: 2,
              source: 'hand',
              read_by: 'fixture',
              date: '2026-10-30',
            },
          ],
        ],
      ],
    );
  });

  test('reads every *.yaml, sorted by file name', () => {
    const dir = dirWith('sorted', GOOD);
    writeFileSync(join(dir, 'X1-1.sh2.yaml'), GOOD);
    writeFileSync(join(dir, 'notes.txt'), 'not a checkpoint file');
    assert.deepEqual([...loadCheckpoints(dir).keys()], ['X1-1.sh2', 'X1-3']);
  });

  test('a key outside the format throws naming the file and the key', () => {
    assert.throws(
      () => loadCheckpoints(dirWith('unknown-key', GOOD + '  remarks: read twice\n')),
      /X1-3\.yaml.*remarks/,
    );
  });

  test('a missing key throws naming the file and the key', () => {
    assert.throws(
      () => loadCheckpoints(dirWith('missing-key', GOOD.replace(/ {2}read_by.*\n/, ''))),
      /X1-3\.yaml.*read_by/,
    );
  });

  test('a non-finite value throws naming the file and the key', () => {
    assert.throws(() => loadCheckpoints(dirWith('nan', GOOD.replace('131', '.nan'))), /X1-3\.yaml.*refusal_rcr23_kias/);
    assert.throws(() => loadCheckpoints(dirWith('inf-input', GOOD.replace('8000', '.inf'))), /X1-3\.yaml.*runway_ft/);
    assert.throws(
      () => loadCheckpoints(dirWith('nan-tolerance', GOOD.replace('kias: 2', 'kias: .nan'))),
      /X1-3\.yaml.*tolerance_kias/,
    );
  });

  test('a source other than hand throws naming the file', () => {
    assert.throws(
      () => loadCheckpoints(dirWith('source', GOOD.replace('source: hand', 'source: extractor'))),
      /X1-3\.yaml.*source/,
    );
  });

  test('a date that is not YYYY-MM-DD throws naming the file', () => {
    assert.throws(() => loadCheckpoints(dirWith('date', GOOD.replace('2026-10-30', 'yesterday'))), /X1-3\.yaml.*date/);
  });

  test('a file that is not a list, or an empty one, throws naming the file', () => {
    assert.throws(() => loadCheckpoints(dirWith('mapping', 'inputs: {}\n')), /X1-3\.yaml.*list/);
    assert.throws(() => loadCheckpoints(dirWith('empty', '[]\n')), /X1-3\.yaml.*list/);
  });

  test('a missing directory gives no checkpoints', () => {
    assert.equal(loadCheckpoints(join(scratch, 'no-such-dir')).size, 0);
  });
});

describe('hand-read checkpoints', () => {
  for (const [id, checkpoints] of loadCheckpoints()) {
    checkpoints.forEach((checkpoint, index) => {
      test(`${id} checkpoint ${String(index)}: ${JSON.stringify(checkpoint.inputs)}`, (t) => {
        if (!existsSync(join(DATASET_DIR, `${id}.json`))) {
          t.todo('not extracted yet');
          return;
        }
        const runner = SAMPLE_RUNNERS[id];
        assert.ok(runner !== undefined, `${id} is extracted and has checkpoints but no runner in SAMPLE_RUNNERS`);
        const outputs = runner(checkpoint.inputs);
        for (const [key, expected] of Object.entries(checkpoint.expected)) {
          const read = outputs[key];
          assert.ok(read !== undefined, `${id} runner has no output ${key}`);
          assert.ok(read.ok, `${id} ${key}: ${read.ok ? '' : JSON.stringify(read.error)}`);
          t.diagnostic(`${key}: ${read.value.toFixed(2)} vs ${String(expected)} (read by ${checkpoint.read_by})`);
          assert.ok(
            Math.abs(read.value - expected) <= checkpoint.tolerance_kias,
            `${id} ${key}: ${String(read.value)} is more than ${String(checkpoint.tolerance_kias)} kt from ${String(expected)}`,
          );
        }
      });
    });
  }
});
