// Child entry for freeze-hub.test.mjs: node freeze-hub-runner.mjs <trace>  (FREEZE_OUT=<file>)
// Runs one trace in a fresh process (setupHostEnv patches process globals) and writes its recording.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const traces = await import(pathToFileURL(path.join(HERE, 'freeze-traces.mjs')));
const trace = traces.TRACES[name];
if (!trace) throw new Error(`unknown trace ${name}`);
const result = await trace();
fs.writeFileSync(process.env.FREEZE_OUT, JSON.stringify(result));
process.exit(0);
