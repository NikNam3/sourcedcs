'use strict';

// `npm run terrain:build` (docs/adr/0133): samples DCS's land.getHeight on a regular lat/lon grid over a theater and
// writes the cache file src/terrain-grid.js reads. Run by a human against a DCS server they chose; never by crc-sync.
//
//   resumable     the partial file holds every finished row and a progress file says which row is next; a re-run with
//                 the same theater and spacing continues there (a different grid is refused, naming what to delete)
//   rate-limited  one Eval per chunk of whole rows (`chunkPoints`, default 4,000 samples), then `pauseMs`
//   measured      each chunk's round trip and, where the mission environment has os.clock, its time inside DCS
//   --dry-run     one probe Eval (the theater check and the map corners, no heights), then the plan: grid, Evals, file
//                 size, the time the pauses alone take; no file is written
//   --max-chunks  a probe run: stops cleanly after n chunks, leaving a partial file the same command resumes
//
// Everything that touches the outside world is injected (evalLua, sleep, the clock, print), so the tests drive it with
// a fake Eval over a synthetic terrain.

const fs = require('fs');
const path = require('path');
const {
  planGrid, encodeGrid, decodeGrid, dataOffset, cacheFileName, FORMAT, UNSAMPLED,
} = require('../../src/terrain-grid');
const { probeLua, parseProbe, heightsLua, parseHeights } = require('./lua');

const DEFAULTS = { spacingM: 500, chunkPoints: 4000, pauseMs: 500, retries: 3, retryBaseMs: 5000 };
const PLAN_KEYS = ['format', 'theater', 'spacingM', 'latMin', 'lonMin', 'latStep', 'lonStep', 'rows', 'cols'];

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** Probes DCS: checks the theater and returns the lat/lon box of the theater's map rectangle. */
async function probe(evalLua, theater, extent) {
  const p = parseProbe(await evalLua(probeLua(extent)));
  if (p.theatre !== theater) throw new Error(`DCS is running ${JSON.stringify(p.theatre)}, not ${theater}: load a mission on ${theater} first`);
  return p;
}

/**
 * @param {object} o
 * @param {(lua:string)=>Promise<any>} o.evalLua
 * @param {string} o.theater
 * @param {{xMin:number, xMax:number, zMin:number, zMax:number}|undefined} o.extent theaters.json terrainExtent
 * @param {string} o.outDir
 * @param {number} [o.spacingM] @param {number} [o.chunkPoints] @param {number} [o.pauseMs]
 * @param {(ms:number)=>Promise<void>} [o.sleep] @param {()=>number} [o.now] wall clock, ms
 * @param {(line:string)=>void} [o.print]
 * @param {number} [o.maxChunks] stop cleanly after this many chunks (`--max-chunks`; resumable)
 * @param {boolean} [o.dryRun] probe and print the plan only, no heights asked and no file written (`--dry-run`)
 * @returns {Promise<{done:boolean, file:string, chunks:number, rows:number, cols:number, dryRun?:boolean}>}
 */
async function buildTerrain(o) {
  const spacingM = o.spacingM ?? DEFAULTS.spacingM;
  const chunkPoints = o.chunkPoints ?? DEFAULTS.chunkPoints;
  const pauseMs = o.pauseMs ?? DEFAULTS.pauseMs;
  const retries = o.retries ?? DEFAULTS.retries;
  const retryBaseMs = o.retryBaseMs ?? DEFAULTS.retryBaseMs;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || (() => Date.now());
  const print = o.print || ((l) => process.stdout.write(`${l}\n`));
  const { evalLua, theater, extent, outDir } = o;

  if (!extent) throw new Error(`config/theaters.json has no terrainExtent for ${theater}: add the map rectangle first (see its _comment)`);
  if (!(Number.isInteger(spacingM) && spacingM >= 50)) throw new Error('--spacing must be a whole number of metres, at least 50');
  if (!(Number.isInteger(chunkPoints) && chunkPoints >= 1)) throw new Error('--chunk must be a positive whole number of samples');

  if (o.maxChunks != null && !(Number.isInteger(o.maxChunks) && o.maxChunks >= 1)) throw new Error('--max-chunks must be a positive whole number');

  if (o.dryRun) return dryRun(o, { evalLua, theater, extent, outDir, spacingM, chunkPoints, pauseMs, print });

  fs.mkdirSync(outDir, { recursive: true });
  const finalFile = path.join(outDir, cacheFileName(theater, spacingM));
  const partialFile = `${finalFile}.partial`;
  const progressFile = `${finalFile}.progress.json`;
  if (fs.existsSync(finalFile)) {
    print(`${finalFile} already exists: nothing to do (delete it to build again)`);
    return { done: true, file: finalFile, chunks: 0 };
  }

  const p = await probe(evalLua, theater, extent);
  const plan = planGrid(p.bbox, spacingM);

  let progress = null;
  if (fs.existsSync(progressFile)) {
    progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    const same = PLAN_KEYS.every((k) => progress.header[k] === ({ format: FORMAT, theater, spacingM, ...plan })[k]);
    if (!same || !fs.existsSync(partialFile)) {
      throw new Error(`${progressFile} is for a different grid (or its partial file is gone): delete ${progressFile} and ${partialFile} to start again`);
    }
    print(`resuming at row ${progress.nextRow} of ${plan.rows}`);
  } else {
    const header = { format: FORMAT, theater, spacingM, ...plan, builtAt: new Date(now()).toISOString(), dcsVersion: p.version };
    fs.writeFileSync(partialFile, encodeGrid(header, new Int16Array(plan.rows * plan.cols).fill(UNSAMPLED)));
    progress = { header, nextRow: 0 };
    writeAtomic(progressFile, JSON.stringify(progress));
  }

  const { header } = progress;
  const { rows, cols } = header;
  const total = rows * cols;
  const rowsPerChunk = Math.max(1, Math.floor(chunkPoints / cols));
  const offset = dataOffset(header);
  print(`${theater} at ${spacingM} m: ${rows} x ${cols} = ${total} samples, ${rowsPerChunk * cols} per Eval, ${pauseMs} ms between`);

  const started = now();
  const startRow = progress.nextRow;
  let chunks = 0, luaMsSum = 0, luaMsCount = 0, rttMsSum = 0;
  const fd = fs.openSync(partialFile, 'r+');
  try {
    while (progress.nextRow < rows) {
      if (o.maxChunks != null && chunks >= o.maxChunks) {
        print(`stopped after ${chunks} chunk${chunks === 1 ? '' : 's'} (--max-chunks) at row ${progress.nextRow} of ${rows}: re-run without it to continue, or delete ${partialFile} and ${progressFile}`);
        return { done: false, file: partialFile, chunks, rows, cols };
      }
      const row0 = progress.nextRow;
      const n = Math.min(rowsPerChunk, rows - row0);
      const lua = heightsLua(header, row0, n);
      let answer, attempt = 0;
      const t0 = now();
      for (;;) {
        try { answer = parseHeights(await evalLua(lua), { theater, row0, rows: n, cols }); break; } catch (e) {
          if (/not \S+: stopped/.test(e.message) || attempt >= retries) throw new Error(`${e.message} (row ${row0}; re-run the same command to continue)`);
          const wait = retryBaseMs * 2 ** attempt++;
          print(`chunk at row ${row0} failed (${e.message}); retry ${attempt} of ${retries} in ${fmtDuration(wait)}`);
          await sleep(wait);
        }
      }
      rttMsSum += now() - t0;
      if (answer.ms >= 0) { luaMsSum += answer.ms; luaMsCount += 1; }

      const bytes = Buffer.alloc(answer.heights.length * 2);
      for (let i = 0; i < answer.heights.length; i++) bytes.writeInt16LE(answer.heights[i], i * 2);
      fs.writeSync(fd, bytes, 0, bytes.length, offset + row0 * cols * 2);
      fs.fsyncSync(fd);
      progress.nextRow = row0 + n;
      writeAtomic(progressFile, JSON.stringify(progress));
      chunks += 1;

      const done = progress.nextRow * cols;
      const elapsed = now() - started;
      const rate = (progress.nextRow - startRow) / Math.max(1, elapsed);
      const eta = rate > 0 ? (rows - progress.nextRow) / rate : 0;
      const dcs = luaMsCount ? `, ${(luaMsSum / luaMsCount).toFixed(1)} ms in DCS per Eval` : '';
      print(`${done}/${total} (${((100 * done) / total).toFixed(1)}%), ${(rttMsSum / chunks).toFixed(0)} ms round trip${dcs}, ETA ${fmtDuration(eta)}`);
      if (progress.nextRow < rows && pauseMs > 0) await sleep(pauseMs);
    }
  } finally {
    fs.closeSync(fd);
  }

  // Read back strictly before it becomes the cache: a hole or a bad header is caught here, not in the server.
  const grid = decodeGrid(fs.readFileSync(partialFile), { theater });
  let min = Infinity, max = -Infinity;
  for (const v of grid.heights) { if (v < min) min = v; if (v > max) max = v; }
  fs.renameSync(partialFile, finalFile);
  fs.rmSync(progressFile, { force: true });
  const perPoint = luaMsCount ? `; ${((1000 * luaMsSum) / (luaMsCount * rowsPerChunk * cols)).toFixed(2)} us per sample inside DCS` : '; DCS time not measurable (no os.clock in the mission environment)';
  print(`done: ${finalFile} (${fs.statSync(finalFile).size} bytes, heights ${min}..${max} m) in ${fmtDuration(now() - started)}${perPoint}`);
  return { done: true, file: finalFile, chunks, rows, cols };
}

/** `--dry-run`: the one probe Eval, then what a build would do. Writes nothing. */
async function dryRun(o, { evalLua, theater, extent, outDir, spacingM, chunkPoints, pauseMs, print }) {
  const finalFile = path.join(outDir, cacheFileName(theater, spacingM));
  const progressFile = `${finalFile}.progress.json`;
  const p = await probe(evalLua, theater, extent);
  const plan = planGrid(p.bbox, spacingM);
  const { rows, cols } = plan;
  const rowsPerChunk = Math.max(1, Math.floor(chunkPoints / cols));
  const evals = Math.ceil(rows / rowsPerChunk);
  const header = { format: FORMAT, theater, spacingM, ...plan, builtAt: new Date(0).toISOString(), dcsVersion: p.version };
  const bytes = dataOffset(header) + rows * cols * 2;
  print(`dry run, nothing written. DCS is running ${theater} (${p.version || 'version unknown'})`);
  print(`${theater} at ${spacingM} m: ${rows} x ${cols} = ${rows * cols} samples, ${rowsPerChunk * cols} per Eval, ${evals} Evals`);
  print(`cache file ${finalFile}, about ${(bytes / 1e6).toFixed(1)} MB`);
  print(`the ${pauseMs} ms pauses alone take ${fmtDuration((evals - 1) * pauseMs)}; add each Eval's round trip (try --max-chunks 3 to measure it)`);
  if (fs.existsSync(finalFile)) print(`${finalFile} already exists: a build would do nothing`);
  else if (fs.existsSync(progressFile)) print(`${progressFile} exists: a build would resume it (if it is for this grid)`);
  return { done: false, dryRun: true, file: finalFile, chunks: 0, rows, cols, evals, bytes };
}

module.exports = { buildTerrain, probe, DEFAULTS, fmtDuration };
