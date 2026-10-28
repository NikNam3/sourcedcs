// ESM-GUARDS scan: typeof guards on imported bindings in crc-desktop/app/public/js.
// usage: node docs/wip/ESM-GUARDS/scan.mjs [--lines] [--json]
// Covers: named/default imports, namespace imports (typeof ns.X), typeof window.X / globalThis.X / globalThis[name]
// for names that some module exports, and reports non-import typeof targets ("other") for review.
import fs from 'node:fs';
import path from 'node:path';
const JS = path.resolve(import.meta.dirname, '../../../crc-desktop/app/public/js');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const files = walk(JS);
const KEEP_NAMES = new Set(['window', 'document', 'maplibregl', 'dockview', 'performance', 'process', 'navigator', 'localStorage', 'WebSocket', 'fetch', 'module', 'require', 'Buffer', 'setTimeout', 'requestAnimationFrame', 'ResizeObserver', 'BroadcastChannel', 'AudioContext', 'webkitAudioContext', 'Notification']);
const exported = new Set();
const src = new Map();
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8'); src.set(f, t);
  for (const m of t.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]);
  for (const m of t.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) exported.add(n); }
}
const rows = []; const other = [];
for (const f of files) {
  const t = src.get(f); const rel = path.relative(JS, f);
  const names = new Set(), ns = new Set();
  for (const m of t.matchAll(/^import\s+([^'";]*?)\s+from\s+['"][^'"]+['"]/gm)) {
    const c = m[1];
    const nm = c.match(/\*\s+as\s+([\w$]+)/); if (nm) ns.add(nm[1]);
    const br = c.match(/\{([^}]*)\}/); if (br) for (const p of br[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
    const d = c.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, '').trim(); if (d) names.add(d);
  }
  t.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/typeof\s+(?:(window|globalThis)\.|globalThis\[|([\w$]+)\.)?([\w$]+)/g)) {
      const [, glob, nsName, id] = m; const whole = m[0];
      let kind = null;
      if (/typeof\s+globalThis\[/.test(whole)) kind = 'globalThis[name]';
      else if (glob && exported.has(id)) kind = glob + '.export';
      else if (nsName && ns.has(nsName)) kind = 'ns';
      else if (!glob && !nsName && names.has(id)) kind = 'import';
      if (kind) rows.push({ file: rel, line: i + 1, kind, id: whole, text: line.trim() });
      else if (!glob && !nsName && !KEEP_NAMES.has(id) && /typeof\s+[\w$]+\s*(===|!==)\s*'(function|undefined|object)'/.test(code) && !/typeof\s+[\w$]+\s*(===|!==)\s*'(function|undefined|object)'/.test('') ) other.push({ file: rel, line: i + 1, id, text: line.trim() });
    }
  });
}
const by = {}; for (const r of rows) by[r.file] = (by[r.file] || 0) + 1;
if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, other }, null, 1)); process.exit(0); }
console.log(`guards on imported bindings: ${rows.length} in ${Object.keys(by).length} files`);
for (const [f, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f);
console.log(`\nother typeof-name checks (not imports; review): ${other.length}`);
const ob = {}; for (const r of other) (ob[r.id] ||= []).push(r.file + ':' + r.line);
for (const [id, v] of Object.entries(ob)) console.log(' ', id, v.slice(0, 4).join(' '), v.length > 4 ? `(+${v.length - 4})` : '');
if (process.argv.includes('--lines')) for (const r of rows) console.log(`${r.file}:${r.line} [${r.kind}] ${r.text.slice(0, 160)}`);
