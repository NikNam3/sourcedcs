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

/**
 * Copies data-ok to a temporary dataset, lets `edit` change the figure, rewrites its manifest hash, then lets
 * `editManifest` change the manifest.
 */
const scratch = mkdtempSync(join(tmpdir(), 'perf-data-check-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function editedDataset(
  name: string,
  edit: (figure: Record<string, unknown>) => void,
  editManifest: (manifest: Record<string, unknown>) => void = () => undefined,
): string {
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
  editManifest(manifest);
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

describe('checkDataset: the PDF pin and empty or malformed panels', () => {
  const noChange = (): void => undefined;
  const only = (name: string, edit: (figure: Record<string, unknown>) => void, pattern: RegExp): void => {
    const problems = checkDataset(editedDataset(name, edit));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', pattern);
  };

  test('a manifest whose pdfSha256 is not the pinned manual is a problem naming the manifest', () => {
    const problems = checkDataset(
      editedDataset('pdf-pin', noChange, (manifest) => {
        manifest['pdfSha256'] = '0'.repeat(64);
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /manifest\.json: pdfSha256 "0{64}" is not the pinned manual/);
  });

  test('a single curve with no points is a problem', () => {
    only(
      'no-points',
      (figure) => {
        firstPanel(figure)['points'] = [];
      },
      /panel "main" has no points/,
    );
  });

  const familyPanel = (curves: unknown[]): Record<string, unknown> => ({
    id: 'gw',
    type: 'curve_family',
    input: { name: 'takeoff_factor', unit: '' },
    output: { name: 'distance', unit: '1000 ft' },
    param: { name: 'gross_weight', unit: '1000 lb' },
    curves,
    axes: { takeoff_factor: { page: 'y', a: -1, b: 400 }, distance: { page: 'x', a: 40, b: 95 } },
  });

  test('a curve family with no curves is a problem', () => {
    only(
      'no-curves',
      (figure) => {
        figure['panels'] = [familyPanel([])];
      },
      /panel "gw" has no curves/,
    );
  });

  test('a curve with no points is a problem naming the curve', () => {
    only(
      'curve-no-points',
      (figure) => {
        figure['panels'] = [
          familyPanel([
            {
              param: 20,
              points: [
                [1, 2],
                [2, 3],
              ],
            },
            { param: 22, points: [] },
          ]),
        ];
      },
      /panel "gw" curve 22 has no points/,
    );
  });

  const guidelinePanel = (families: Record<string, unknown>): Record<string, unknown> => ({
    id: 'slope',
    type: 'guideline_panel',
    input: { name: 'slope', unit: '%' },
    output: { name: 'distance', unit: '1000 ft' },
    baseline: 0,
    families,
    axes: { slope: { page: 'x', a: 20, b: 300 }, distance: { page: 'x', a: 40, b: 95 } },
  });
  const line = (output: number): number[][] => [
    [0, output],
    [2, output + 0.2],
  ];

  test('a guideline panel with ascending magnitudes is clean', () => {
    const problems = checkDataset(
      editedDataset('guideline-ok', (figure) => {
        figure['panels'] = [guidelinePanel({ uphill: [line(1), line(2)], downhill: [line(1)] })];
      }),
    );
    assert.deepEqual(problems, []);
  });

  test('a guideline param below 0 is a problem (params are magnitudes, R8)', () => {
    only(
      'guideline-negative',
      (figure) => {
        figure['panels'] = [
          guidelinePanel({
            uphill: [line(1)],
            downhill: [
              [
                [-2, 1.2],
                [0, 1],
              ],
            ],
          }),
        ];
      },
      /panel "slope" family "downhill" line 0 has a negative param/,
    );
  });

  test('a guideline panel with no families is a problem', () => {
    only(
      'guideline-no-families',
      (figure) => {
        figure['panels'] = [guidelinePanel({})];
      },
      /panel "slope" has no families/,
    );
  });

  test('a guideline family with no lines is a problem naming the family', () => {
    only(
      'guideline-no-lines',
      (figure) => {
        figure['panels'] = [guidelinePanel({ uphill: [line(1)], downhill: [] })];
      },
      /panel "slope" family "downhill" has no lines/,
    );
  });

  test('a guideline line with no points is a problem naming the line', () => {
    only(
      'guideline-empty-line',
      (figure) => {
        figure['panels'] = [guidelinePanel({ uphill: [line(1), []] })];
      },
      /panel "slope" family "uphill" line 1 has no points/,
    );
  });

  const tablePanel = (names: string[], rows: unknown[][]): Record<string, unknown> => ({
    id: 'stores',
    type: 'table',
    columns: names.map((name) => ({ name, unit: '' })),
    rows,
  });

  test('a table with no rows is a problem', () => {
    only(
      'table-no-rows',
      (figure) => {
        figure['panels'] = [tablePanel(['store', 'drag_index'], [])];
      },
      /panel "stores" has no rows/,
    );
  });

  test('a table with a column name twice is a problem naming the column', () => {
    only(
      'table-duplicate-column',
      (figure) => {
        figure['panels'] = [tablePanel(['store', 'drag_index', 'store'], [['AIM-9', 0, 'x']])];
      },
      /panel "stores" has column "store" more than once/,
    );
  });
});

test('types:check finds the committed types.ts up to date', () => {
  const run = spawnSync(process.execPath, ['scripts/gen-types.ts', '--check'], { cwd: perfDir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
