// Proves the tracked nginx template renders to the same config the old inline
// docker-compose `command:` string produced. Run: node --test infra/tests/*.test.js
// No docker needed: the old string is emulated (compose `$$`, shell quoting) and the
// new file is rendered the way the nginx image's envsubst step does it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ENV = {
  WIKI_DOMAIN: 'wiki.example.org', AUTH_DOMAIN: 'auth.example.org', DOMAIN: 'example.org',
  ATOBRIEF_DOMAIN: 'ato.example.org', CRCSYNC_DOMAIN: 'asacs.example.org',
};
const root = path.join(__dirname, '..');
const norm = (s) => s.replace(/#[^\n]*\n/g, '\n').replace(/\s+/g, ' ').trim();

function renderOld() {
  const y = fs.readFileSync(path.join(__dirname, 'fixtures/old-inline-nginx-compose.yml'), 'utf8');
  const a = y.indexOf("echo 'resolver") + 6;
  const b = y.indexOf("' > /etc/nginx/conf.d/default.conf");
  let t = y.slice(a, b);
  t = t.replace(/\\\$\$/g, '$').replace(/\$\$/g, '$')   // compose interpolation + sh-quote unescape
    .replace(/\\"/g, '"').replace(/\\\\n/g, '\\n');
  // '$VAR' = shell closes the single quote, expands the variable, reopens it
  t = t.replace(/'\$([A-Z_]+)'/g, (_, v) => (v === 'ASACS_DOMAIN' ? ENV.CRCSYNC_DOMAIN : ENV[v]));
  return t;
}

function renderNew() {
  let t = fs.readFileSync(path.join(root, 'nginx/templates/default.conf.template'), 'utf8');
  t = t.replace(/\$\{([A-Z_]+)\}/g, (m, v) => (v in ENV ? ENV[v] : m));
  t = t.replace(/include \/etc\/nginx\/snippets\/([\w.-]+);/g,
    (_, f) => fs.readFileSync(path.join(root, 'nginx/snippets', f), 'utf8'));
  return t;
}

// The one deliberate difference since the inline config: the crc-sync vhost denies the registry API (S-DES1 F6).
const REGISTRY_DENY = '# The airspace registry API is for sourcedcs-web inside the stack only (http://crc-sync:3000); never public.\n  location /api/airspace-registry { return 404; }\n';

test('new template renders identically to the old inline config (bar the registry deny)', () => {
  assert.ok(renderNew().includes(REGISTRY_DENY), 'registry deny present');
  assert.strictEqual(norm(renderNew().replace(REGISTRY_DENY, '')), norm(renderOld()));
});

test('the registry deny sits in the crc-sync vhost only, ahead of the catch-all', () => {
  const t = renderNew();
  assert.strictEqual((t.match(/location \/api\/airspace-registry/g) || []).length, 1);
  const vhost = t.slice(t.indexOf('server_name ' + ENV.CRCSYNC_DOMAIN + ';', t.indexOf('listen 443', t.indexOf('server_name ' + ENV.CRCSYNC_DOMAIN))));
  assert.ok(vhost.indexOf('/api/airspace-registry') < vhost.indexOf('location / {'));
});

test('client_max_body_size stays 350M and bot IPs live in the include', () => {
  const tpl = fs.readFileSync(path.join(root, 'nginx/templates/default.conf.template'), 'utf8');
  assert.match(tpl, /client_max_body_size 350M;/);
  assert.doesNotMatch(tpl, /deny \d/);
  assert.match(fs.readFileSync(path.join(root, 'nginx/snippets/wiki-denied-bot-ips.conf'), 'utf8'), /deny 74\.7\.227\.48;/);
});

test('compose mounts the template + snippets read-only and has no inline config', () => {
  const y = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.match(y, /\.\/nginx\/templates:\/etc\/nginx\/templates:ro/);
  assert.match(y, /\.\/nginx\/snippets:\/etc\/nginx\/snippets:ro/);
  assert.doesNotMatch(y, /client_max_body_size/);
  assert.match(y, /CRCSYNC_DOMAIN=\$\{CRCSYNC_DOMAIN\}/);
  assert.doesNotMatch(y, /ASACS_/);
});

test('LOG_LEVEL reaches the three services and CRCSYNC_URL has no ASACS_URL fallback (R3-35)', () => {
  const y = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.strictEqual((y.match(/LOG_LEVEL=\$\{LOG_LEVEL:-info\}/g) || []).length, 3);
  assert.match(y, /CRCSYNC_URL=\$\{CRCSYNC_URL\}/);
  assert.doesNotMatch(y, /ASACS_/);
});

test('AIRSPACE_SERVICE_TOKEN reaches main-website and crc-sync; the web reaches crc-sync inside the stack', () => {
  const y = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.strictEqual((y.match(/AIRSPACE_SERVICE_TOKEN=\$\{AIRSPACE_SERVICE_TOKEN\}/g) || []).length, 2);
  assert.match(y, /SOURCEDCS_CRCSYNC_URL=http:\/\/crc-sync:3000/);
  assert.match(y, /CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL=\$\{CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL/);
});
