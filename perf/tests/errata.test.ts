import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { applyErrata, checkErrataAgainstSpecs, loadErrata, type Erratum } from './helpers/errata.ts';
import { loadSpecs, type ChartSpec } from './helpers/specs.ts';

const perfDir = fileURLToPath(new URL('..', import.meta.url));
const errataPath = join(perfDir, 'extraction', 'manual-errata.yaml');
const fixture = (...parts: string[]): string => join(perfDir, 'tests', 'fixtures', ...parts);

const ERRATUM_KEYS = ['affects', 'correct', 'figure', 'printed', 'reason', 'sheet', 'where'];

const scratch = mkdtempSync(join(tmpdir(), 'perf-errata-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('manual-errata.yaml', () => {
  test('the file parses to a list', () => {
    const raw: unknown = parse(readFileSync(errataPath, 'utf8'));
    assert.ok(Array.isArray(raw));
    assert.ok(raw.length > 0);
  });

  test('it holds the B7-2 sheet 2 sample problem entry', () => {
    const entry = loadErrata().find((e) => e.figure === 'B7-2' && e.sheet === 2);
    assert.deepEqual(entry, {
      figure: 'B7-2',
      sheet: 2,
      where: 'sample problem text',
      printed: 'SEC 3,902 ft',
      correct: 'PRI 3,902 ft',
      reason: "3,902 ft is sheet 1's PRI distance; the SEC distance is 4,058 ft (x1.04)",
      affects: null,
    });
  });

  test('every entry has the seven keys and non-empty strings', () => {
    const raw = parse(readFileSync(errataPath, 'utf8')) as Record<string, unknown>[];
    for (const [i, entry] of raw.entries()) {
      assert.deepEqual(Object.keys(entry).sort(), ERRATUM_KEYS, `entry ${String(i)}`);
      for (const key of ['figure', 'where', 'printed', 'correct', 'reason']) {
        const value = entry[key];
        assert.ok(typeof value === 'string' && value.trim() !== '', `entry ${String(i)} ${key}`);
      }
    }
  });

  test('every erratum with affects names the spec of its figure and sheet and changes its value', (t) => {
    const { problems, pending } = checkErrataAgainstSpecs(loadErrata(), loadSpecs());
    // An erratum whose spec is not extracted yet is skipped until it is (R14).
    for (const line of pending) t.diagnostic(`skipped: ${line}`);
    assert.deepEqual(problems, []);
  });
});

describe('checkErrataAgainstSpecs on the fixture specs', () => {
  const errata = loadErrata(fixture('errata', 'affects.yaml'));
  const specs = loadSpecs(fixture('specs'));
  const check = (i: number): { problems: string[]; pending: string[] } => {
    const erratum = errata[i];
    assert.ok(erratum !== undefined);
    return checkErrataAgainstSpecs([erratum], specs);
  };

  test('a right affects.spec that changes the value passes', () => {
    assert.deepEqual(check(0), { problems: [], pending: [] });
  });

  test('a typo in affects.spec fails once the spec for that figure and sheet exists', () => {
    const { problems, pending } = check(1);
    assert.deepEqual(pending, []);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /X1-2sh2.*X1-2/);
  });

  test('an affects.spec naming another figure’s spec fails', () => {
    const { problems } = check(2);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /X1-1.*another figure or sheet/);
  });

  test('an erratum whose value is already the printed one fails', () => {
    const { problems } = check(3);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /does not change X1-2 sample 0 distance_ft/);
  });

  test('an erratum whose figure and sheet have no spec yet is pending, not a problem', () => {
    const { problems, pending } = check(4);
    assert.deepEqual(problems, []);
    assert.equal(pending.length, 1);
    assert.match(pending[0] ?? '', /X7-7\.sh1 not extracted yet/);
  });
});

describe('loadErrata', () => {
  test('an entry missing a key throws naming the entry and the key', () => {
    assert.throws(() => loadErrata(fixture('errata', 'missing-key.yaml')), /entry 0.*reason/);
  });

  test('an empty string throws naming the entry and the key', () => {
    assert.throws(() => loadErrata(fixture('errata', 'empty-string.yaml')), /entry 0.*printed/);
  });

  test('sheet 0 throws: a sheet is null or a positive integer', () => {
    assert.throws(() => loadErrata(fixture('errata', 'sheet-zero.yaml')), /entry 0.*sheet/);
  });

  test('a .nan affects.value throws', () => {
    assert.throws(() => loadErrata(fixture('errata', 'value-nan.yaml')), /entry 0.*affects\.value/);
  });
});

describe('loadSpecs', () => {
  test('reads every *.yaml in the directory, sorted by file name', () => {
    const specs = loadSpecs(fixture('specs'));
    assert.deepEqual(
      specs.map((s) => s.id),
      ['X1-1', 'X1-2'],
    );
    const [first, second] = specs;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.sheet, null);
    assert.equal(first.sample_problems, undefined);
    assert.equal(second.sheet, 2);
  });

  test('parses with the core schema: true is a boolean, 0 is a number', () => {
    const problems = loadSpecs(fixture('specs'))[1]?.sample_problems;
    assert.deepEqual(problems, [
      { inputs: { gross_weight_lb: 30000, pitch_8deg: true }, expected: { distance_ft: 4000, speed_kt: 150 } },
      { inputs: { gross_weight_lb: 0 }, expected: { distance_ft: 0 } },
    ]);
  });

  test('an empty directory gives no specs', () => {
    assert.deepEqual(loadSpecs(scratch), []);
  });

  test('an id that is not the file name throws naming the file', () => {
    assert.throws(() => loadSpecs(fixture('specs-bad-id')), /X1-3\.yaml.*id/);
  });

  test('a sheet that is not a positive integer throws naming the file', () => {
    assert.throws(() => loadSpecs(fixture('specs-bad-sheet')), /X1-3\.yaml.*sheet/);
  });

  test('an .inf input throws naming the file and the key', () => {
    assert.throws(() => loadSpecs(fixture('specs-nan')), /X1-3\.yaml.*inputs\.gross_weight_lb/);
  });

  test('a missing directory gives no specs', () => {
    assert.deepEqual(loadSpecs(join(scratch, 'no-such-dir')), []);
  });

  test('the default directory loads without throwing', () => {
    assert.ok(Array.isArray(loadSpecs()));
  });
});

describe('applyErrata', () => {
  const spec = (): ChartSpec => ({
    id: 'X9-1',
    figure: 'X9-1',
    sheet: null,
    sample_problems: [
      { inputs: { gross_weight_lb: 30000 }, expected: { distance_ft: 4000, speed_kt: 150 } },
      { inputs: { gross_weight_lb: 40000, pitch_8deg: true }, expected: { distance_ft: 5000, speed_kt: 170 } },
    ],
  });
  const erratum = (affects: Erratum['affects']): Erratum => ({
    figure: 'X9-1',
    sheet: null,
    where: 'sample problem text',
    printed: '5,000 ft',
    correct: '5,200 ft',
    reason: 'fixture',
    affects,
  });

  test('replaces exactly the named expected value and leaves the input spec unchanged', () => {
    const input = spec();
    const result = applyErrata(input, [erratum({ spec: 'X9-1', sample: 1, key: 'distance_ft', value: 5200 })]);
    assert.deepEqual(result, [
      { inputs: { gross_weight_lb: 30000 }, expected: { distance_ft: 4000, speed_kt: 150 } },
      { inputs: { gross_weight_lb: 40000, pitch_8deg: true }, expected: { distance_ft: 5200, speed_kt: 170 } },
    ]);
    assert.deepEqual(input, spec());
    assert.notEqual(result[0], input.sample_problems?.[0]);
    assert.notEqual(result[0]?.inputs, input.sample_problems?.[0]?.inputs);
  });

  test('ignores errata with no affects and errata for another spec', () => {
    const result = applyErrata(spec(), [
      erratum(null),
      erratum({ spec: 'X9-2', sample: 0, key: 'distance_ft', value: 1 }),
    ]);
    assert.deepEqual(result, spec().sample_problems);
  });

  test('a spec with no sample problems gives an empty list', () => {
    assert.deepEqual(applyErrata({ id: 'X9-1', figure: 'X9-1', sheet: null }, []), []);
  });

  test('an affects naming a missing sample throws', () => {
    assert.throws(
      () => applyErrata(spec(), [erratum({ spec: 'X9-1', sample: 2, key: 'distance_ft', value: 5200 })]),
      /X9-1.*sample 2/,
    );
  });

  test('an affects naming a key not in that sample’s expected throws', () => {
    assert.throws(
      () => applyErrata(spec(), [erratum({ spec: 'X9-1', sample: 1, key: 'distnace_ft', value: 5200 })]),
      /X9-1.*sample 1.*distnace_ft/,
    );
  });

  test('an affects key inherited from Object.prototype is not an expected key', () => {
    assert.throws(
      () => applyErrata(spec(), [erratum({ spec: 'X9-1', sample: 1, key: 'toString', value: 5200 })]),
      /X9-1.*sample 1.*toString/,
    );
  });
});
