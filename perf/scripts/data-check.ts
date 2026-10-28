/**
 * Checks chart datasets: every figure file against the schema and the Data contract, and the
 * manifest against the files on disk.
 *
 *   node scripts/data-check.ts           checks every dataset under data/ (npm run data:check)
 *   node scripts/data-check.ts <dir>...  checks the named dataset directories
 *
 * Exits 1 on any problem.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

import type { FigureFile, Manifest, Panel, Pt } from '../src/core/data/types.ts';

const schemaPath = fileURLToPath(new URL('../schema/charts.schema.json', import.meta.url));
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const MANIFEST = 'manifest.json';

interface Validators {
  figure: ValidateFunction<FigureFile>;
  manifest: ValidateFunction<Manifest>;
}

let validators: Validators | undefined;

function getValidators(): Validators {
  if (validators === undefined) {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $id: string };
    const ajv = new Ajv({ allErrors: true, discriminator: true, strict: true, allowUnionTypes: true });
    ajv.addSchema(schema);
    validators = {
      figure: ajv.getSchema<FigureFile>(`${schema.$id}#/definitions/FigureFile`) as ValidateFunction<FigureFile>,
      manifest: ajv.getSchema<Manifest>(`${schema.$id}#/definitions/Manifest`) as ValidateFunction<Manifest>,
    };
  }
  return validators;
}

function describeError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '/' : error.instancePath;
  if (error.keyword === 'additionalProperties') {
    const key = (error.params as { additionalProperty: string }).additionalProperty;
    return `${where} has unknown key "${key}"`;
  }
  return `${where} ${error.message ?? error.keyword}`;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Reads and parses a JSON file; a problem string when it cannot. */
function readJson(path: string): { value: unknown } | { problem: string } {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

function isAscending(values: readonly number[]): boolean {
  return values.every((value, i) => i === 0 || value >= (values[i - 1] ?? value));
}

const inputs = (points: readonly Pt[]): number[] => points.map((point) => point[0]);

/** The Data contract's rules the schema cannot express, for one panel. */
function panelProblems(panel: Panel): string[] {
  const problems: string[] = [];
  const name = `panel "${panel.id}"`;
  const needAxes = (axes: Record<string, unknown>, quantities: string[]): void => {
    for (const quantity of quantities) {
      if (!Object.hasOwn(axes, quantity)) problems.push(`${name} has no axes transform for "${quantity}"`);
    }
  };
  switch (panel.type) {
    case 'curve_family':
      needAxes(panel.axes, [panel.input.name, panel.output.name]);
      if (!isAscending(panel.curves.map((curve) => curve.param))) {
        problems.push(`${name} curves are not in ascending param order`);
      }
      for (const curve of panel.curves) {
        if (!isAscending(inputs(curve.points))) {
          problems.push(`${name} curve ${String(curve.param)} points are not in ascending input order`);
        }
      }
      break;
    case 'single_curve':
      needAxes(panel.axes, [panel.input.name, panel.output.name]);
      if (!isAscending(inputs(panel.points))) problems.push(`${name} points are not in ascending input order`);
      break;
    case 'guideline_panel':
      needAxes(panel.axes, [panel.input.name, panel.output.name]);
      for (const [family, lines] of Object.entries(panel.families)) {
        lines.forEach((line, i) => {
          if (!isAscending(inputs(line))) {
            problems.push(`${name} family "${family}" line ${String(i)} is not in ascending param order`);
          }
        });
      }
      break;
    case 'scale_pair':
      needAxes(panel.axes, [panel.from.name, panel.to.name]);
      break;
    case 'table':
      panel.rows.forEach((row, i) => {
        if (row.length !== panel.columns.length) {
          problems.push(
            `${name} row ${String(i)} has ${String(row.length)} cells for ${String(panel.columns.length)} columns`,
          );
        }
      });
      break;
  }
  return problems;
}

function figureProblems(dir: string, file: string): string[] {
  const read = readJson(join(dir, file));
  if ('problem' in read) return [read.problem];
  const validate = getValidators().figure;
  if (!validate(read.value)) return (validate.errors ?? []).map(describeError);
  const figure = read.value;
  const problems: string[] = [];
  const stem = file.slice(0, -'.json'.length);
  if (figure.id !== stem) problems.push(`id "${figure.id}" differs from the file name`);
  const image = `pages/${figure.id}.png`;
  if (figure.image.file !== image) problems.push(`image.file "${figure.image.file}" is not "${image}"`);
  else if (!existsSync(join(dir, image))) problems.push(`image.file "${image}": no such file`);
  for (const panel of figure.panels) problems.push(...panelProblems(panel));
  return problems;
}

/** The data files on disk: every .json but the manifest, and every pages/*.png. */
function dataFiles(dir: string): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== MANIFEST);
  const pages = join(dir, 'pages');
  if (existsSync(pages)) {
    files.push(
      ...readdirSync(pages)
        .filter((f) => f.endsWith('.png'))
        .map((f) => `pages/${f}`),
    );
  }
  return files.sort();
}

/** Problems with one dataset directory; empty when it is clean. Each problem names the file it is about. */
export function checkDataset(dir: string): string[] {
  const dataset = basename(dir);
  const problems: string[] = [];
  const report = (file: string, problem: string): void => {
    problems.push(`${dataset}/${file}: ${problem}`);
  };
  const files = dataFiles(dir);

  let listed: Record<string, string> | undefined;
  if (!existsSync(join(dir, MANIFEST))) {
    report(MANIFEST, 'no such file');
  } else {
    const read = readJson(join(dir, MANIFEST));
    const validate = getValidators().manifest;
    if ('problem' in read) {
      report(MANIFEST, read.problem);
    } else if (!validate(read.value)) {
      for (const error of validate.errors ?? []) report(MANIFEST, describeError(error));
    } else {
      listed = read.value.files;
      if (read.value.dataset !== dataset) {
        report(MANIFEST, `dataset "${read.value.dataset}" differs from the directory name "${dataset}"`);
      }
    }
  }

  if (listed !== undefined) {
    for (const file of files) {
      const hash = listed[file];
      if (hash === undefined) report(file, 'not in the manifest');
      else if (hash !== sha256(join(dir, file))) report(file, 'sha256 differs from the manifest');
    }
    for (const file of Object.keys(listed).sort()) {
      if (!files.includes(file)) report(file, 'listed in the manifest, but no such file');
    }
  }

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    for (const problem of figureProblems(dir, file)) report(file, problem);
  }
  return problems;
}

function main(args: string[]): number {
  const dirs =
    args.length > 0
      ? args
      : existsSync(dataDir)
        ? readdirSync(dataDir)
            .map((name) => join(dataDir, name))
            .filter((path) => statSync(path).isDirectory())
            .sort()
        : [];
  if (dirs.length === 0) {
    console.log('data:check: no datasets under data/');
    return 0;
  }
  let count = 0;
  for (const dir of dirs) {
    const problems = checkDataset(dir);
    for (const problem of problems) console.error(problem);
    count += problems.length;
  }
  console.log(`data:check: ${String(dirs.length)} dataset(s), ${String(count)} problem(s)`);
  return count === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
