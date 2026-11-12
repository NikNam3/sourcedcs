/**
 * Local static server for the app (TOLD 1.8): `/` → 302 `/f16/`, `/f16/data/…` → `data/…`, `/f16/…` → `web/…`
 * (a path ending in `/` serves its `index.html`). GET and HEAD only, a fixed MIME table, 404 for anything else,
 * 400 for a path with `..`. Port from `PORT`, default 8080.
 *
 *   node scripts/serve.ts        (npm run serve)
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** The file a URL path names, or null when it names none. */
function fileFor(path: string): string | null {
  if (path.startsWith('/f16/data/')) return join(ROOT, 'data', path.slice('/f16/data/'.length));
  if (!path.startsWith('/f16/')) return null;
  const rest = path.slice('/f16/'.length);
  return join(ROOT, 'web', rest === '' || rest.endsWith('/') ? `${rest}index.html` : rest);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method not allowed');
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    send(res, 400, 'bad path');
    return;
  }
  if (path.split(/[/\\]/).includes('..')) {
    send(res, 400, 'bad path');
    return;
  }
  if (path === '/' || path === '/f16') {
    res.writeHead(302, { location: '/f16/' }).end();
    return;
  }
  const file = fileFor(path);
  const type = file === null ? undefined : MIME[extname(file)];
  if (file === null || type === undefined || !isFile(file)) {
    send(res, 404, 'not found');
    return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  // A read failing after the stat (file removed, EACCES, web/js/ rebuilt) ends this response, not the server.
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

const server = createServer(handle);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => {
  console.log(`perf: http://localhost:${String(port)}/f16/`);
});
