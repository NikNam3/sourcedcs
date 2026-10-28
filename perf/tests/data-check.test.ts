import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDataset } from '../scripts/data-check.ts';

const perfDir = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string): string => join(perfDir, 'tests', 'fixtures', name);

describe('checkDataset on the fixture datasets', () => {
  test('a clean dataset has no problems', () => {
    assert.deepEqual(checkDataset(fixture('data-ok')), []);
  });

  test('a figure with an unknown key gives one problem naming the file and the key', () => {
    const problems = checkDataset(fixture('data-bad-unknown-key'));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /X1-1\.json/);
    assert.match(problems[0] ?? '', /scale_note/);
  });

  test('a figure whose hash differs from the manifest gives one problem naming the file', () => {
    const problems = checkDataset(fixture('data-bad-hash'));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /X1-1\.json/);
    assert.match(problems[0] ?? '', /sha256/);
  });

  test('a data file missing from the manifest gives one problem naming the file', () => {
    const problems = checkDataset(fixture('data-bad-unlisted'));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /X1-1\.json/);
    assert.match(problems[0] ?? '', /not in the manifest/);
  });

  test('a manifest entry with no file gives one problem naming the entry', () => {
    const problems = checkDataset(fixture('data-bad-missing'));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /X1-2\.json/);
    assert.match(problems[0] ?? '', /no such file/);
  });
});

/** Copies data-ok to a temporary dataset, lets `edit` change the figure, and rewrites its manifest hash. */
const scratch = mkdtempSync(join(tmpdir(), 'perf-data-check-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function editedDataset(name: string, edit: (figure: Record<string, unknown>) => void): string {
  const dir = join(scratch, name);
  cpSync(fixture('data-ok'), dir, { recursive: true });
  const figurePath = join(dir, 'X1-1.json');
  const figure = JSON.parse(readFileSync(figurePath, 'utf8')) as Record<string, unknown>;
  edit(figure);
  const bytes = JSON.stringify(figure) + '\n';
  writeFileSync(figurePath, bytes);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dataset: string; files: Record<string, string> };
  manifest.dataset = name;
  manifest.files['X1-1.json'] = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest) + '\n');
  return dir;
}

function firstPanel(figure: Record<string, unknown>): Record<string, unknown> {
  const panels = figure['panels'] as Record<string, unknown>[];
  const panel = panels[0];
  assert.ok(panel !== undefined);
  return panel;
}

describe('checkDataset beyond the schema', () => {
  test('an edited copy of data-ok with nothing changed is still clean', () => {
    assert.deepEqual(
      checkDataset(
        editedDataset('unchanged', () => {
          /* no change */
        }),
      ),
      [],
    );
  });

  test('an unknown key inside a panel gives one problem naming the key', () => {
    const problems = checkDataset(
      editedDataset('panel-key', (figure) => {
        firstPanel(figure)['smoothing'] = 3;
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /smoothing/);
  });

  test('a figure id that differs from its file name is a problem', () => {
    const problems = checkDataset(
      editedDataset('id', (figure) => {
        figure['id'] = 'X1-9';
      }),
    );
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.ok(problems.some((p) => /id "X1-9"/.test(p)));
    assert.ok(problems.some((p) => /image/.test(p)));
  });

  test('points out of input order are a problem naming the panel', () => {
    const problems = checkDataset(
      editedDataset('order', (figure) => {
        firstPanel(figure)['points'] = [
          [0, 1],
          [10, 2.2],
          [5, 1.5],
        ];
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /panel "main"/);
    assert.match(problems[0] ?? '', /ascending/);
  });

  test('a panel with no transform for its output is a problem', () => {
    const problems = checkDataset(
      editedDataset('axes', (figure) => {
        firstPanel(figure)['axes'] = { pressure_altitude: { page: 'x', a: 10, b: 5 } };
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /"distance"/);
  });

  const scalePanel = (range?: [number, number]): Record<string, unknown> => ({
    id: 'ab',
    type: 'scale_pair',
    from: { name: 'tof_mil', unit: '' },
    to: { name: 'tof_ab', unit: '' },
    a: 0.5563,
    b: 0.088,
    ...(range === undefined ? {} : { range }),
    axes: { tof_mil: { page: 'x', a: 56.7, b: 46.2 }, tof_ab: { page: 'x', a: 101.97, b: 102.267 } },
  });

  test('a scale pair with an ascending range is clean', () => {
    const problems = checkDataset(
      editedDataset('scale-ok', (figure) => {
        figure['panels'] = [scalePanel([0.5, 3.79])];
      }),
    );
    assert.deepEqual(problems, []);
  });

  test('a scale pair with no range is a problem (R2)', () => {
    const problems = checkDataset(
      editedDataset('scale-no-range', (figure) => {
        figure['panels'] = [scalePanel()];
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /range/);
  });

  test('a scale pair whose range is not ascending is a problem naming the panel', () => {
    const problems = checkDataset(
      editedDataset('scale-reversed', (figure) => {
        figure['panels'] = [scalePanel([3.79, 0.5])];
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /panel "ab" range \[3\.79, 0\.5\] is not ascending/);
  });

  test('a table row wider than its columns is a problem', () => {
    const problems = checkDataset(
      editedDataset('table', (figure) => {
        figure['panels'] = [
          {
            id: 'stores',
            type: 'table',
            columns: [
              { name: 'store', unit: '' },
              { name: 'drag_index', unit: '' },
            ],
            rows: [
              ['AIM-9', 0],
              ['GBU-12', 7, null],
            ],
          },
        ];
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /row 1/);
  });
});

test('types:check finds the committed types.ts up to date', () => {
  const run = spawnSync(process.execPath, ['scripts/gen-types.ts', '--check'], { cwd: perfDir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
