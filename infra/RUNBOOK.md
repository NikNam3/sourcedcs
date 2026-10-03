# infra RUNBOOK

## Rotating the MapTiler key

crc-desktop ships with no MapTiler key. After login it asks crc-sync (`GET /api/client-config`, bearer token) and draws
its basemap and elevation contours with the key it gets back. The key is `CRCSYNC_MAPTILER_CLIENT_KEY`, else
`CRCSYNC_MAPTILER_KEY` (also crc-sync's own terrain-masking key). Nothing is cached on the client: it is fetched again at
every login.

The key that older crc-desktop releases shipped is in git history, so it is public. Only revoking it at MapTiler retires it.

1. In the MapTiler account, create a new key. Optionally restrict it, remembering the client loads from `http://localhost:<port>`
   (an origin allow-list that excludes localhost breaks the basemap). A second key for clients, separate from the server's
   terrain key, gets its own quota and is what `CRCSYNC_MAPTILER_CLIENT_KEY` is for.
2. Set `CRCSYNC_MAPTILER_CLIENT_KEY` (and/or `CRCSYNC_MAPTILER_KEY`) in `infra/.env` on the server. Never commit it.
3. Deploy crc-sync by re-running the **Deploy** workflow (Actions, "Deploy", Run workflow on `main`; the human approves the
   `production` environment). Do not run `docker compose pull crc-sync && docker compose up -d` by hand: that pulls whatever
   `:latest` is and bypasses the wire protocol gate. Connected clients pick the new key up at their next login (restart or re-login).
4. Check: log in with a crc-desktop of this release; the basemap and contours draw.
5. **Delete the old key in MapTiler.** Until then it still works, and it is public.

Every crc-desktop older than this change keeps the old key built in, so it loses its basemap and contours the moment step 5
is done. VERSION refuses those clients once the protocol is bumped anyway.

## Wire protocol and the deploy gate (crc-sync ADR 0103)

crc-sync and crc-desktop each compile in a wire protocol number (`crc-sync/src/wire-protocol.js`, `crc-desktop/app/public/js/wire-protocol.js`).
A client whose number differs from the server's is refused with an "Update required" overlay (close code 4426); it does not reconnect on its own.
The per-frame `version: 1` is unrelated and stays 1.

- **Bump rule.** Any lane that changes the wire runs `cd crc-sync && npm run wire:record`. `crc-sync/tests/wire-protocol.test.mjs` fails
  until it has (message types, EFSP op kinds, top-level frame keys). The script bumps both copies by one only if the last
  `crc-desktop-v*` tag already shipped the current number; a number already ahead of the release is shared by every change until the
  next release, and running the script twice never bumps twice. A tag with no `wire-protocol.js` is protocol 1. A change the scan cannot see
  (a value's meaning) is bumped by hand with `npm run wire:record -- --bump`. A crc-desktop parity test fails if only one copy moved.
- **Release order.** Merge to `main`, tag `crc-desktop-vX.Y.Z` from `main` (the release uploads the installers, then dispatches the crc-sync
  image, which deploys). Between the upload and the crc-sync deploy, updated clients see "the server must be updated first" for a few minutes.
- **The gate** (`.github/scripts/protocol-gate.sh`, the "Wire protocol gate" step of `deploy.yml`, main only; its decision table is
  `infra/tests/protocol-gate.test.js`, run by `infra nginx check`). It resolves the crc-sync image to a **digest** (`sha-<short>` of the
  commit when a crc-sync build triggered the deploy, otherwise the current `:latest`), reads that image's `org.sourcedcs.wire-protocol`
  label (stamped by `crc-sync-docker.yml`, digest also in that run's summary) and compares it with the protocol in the **newest**
  published release (`https://sourcedcs.page/api/releases/latest`, newest of the win and linux versions, then
  `git show crc-desktop-v<version>:...`). The SSH step then deploys that same digest (`CRC_SYNC_IMAGE`), never a moving tag. When they differ
  the step reports an error: **"crc-sync speaks protocol N, the published CRC vX speaks M: publish a crc-desktop release first (tag
  crc-desktop-vX.Y.Z from main) or revert the wire change."** It holds only crc-sync: the `git pull`, the other images and the rest of the stack
  still deploy, and the running crc-sync is left alone. **It fails closed**: an unreadable releases API, a newest published version with no tag
  in the repo, a tag whose `wire-protocol.js` has no readable number, or an image with no label (built before the label existed) all hold
  crc-sync, with the reason in the error. Fix the cause and re-run Deploy; `skip_protocol_gate` is the override.
- **Never recreate crc-sync by hand.** A bare `docker compose up -d` on the server (without `CRC_SYNC_IMAGE`) resolves crc-sync back to `:latest`
  and recreates it from that, past the gate. Re-run the Deploy workflow instead. If you must, run the gate first and export its image:
  `IMAGE_REPO=ghcr.io/niknam3/sourcedcs/crc-sync IMAGE_REF=latest bash .github/scripts/protocol-gate.sh` (from a checkout with all tags),
  continue only if it prints `hold=false`, then `CRC_SYNC_IMAGE=<the image= line> docker compose pull crc-sync && CRC_SYNC_IMAGE=<same> docker compose up -d crc-sync`.
- **A half-published release.** `crc-desktop-release.yml` fails a leg that builds no installer and has a `verify-published` job that turns the run red
  when the releases API does not list the tagged version for both win and linux. Re-run the failed leg (uploads are idempotent), or delete the tag.
  The gate judges by the newest published version, so a one-leg release does not hold crc-sync on the older one.
- **`skip_protocol_gate`.** A `workflow_dispatch` input on `deploy.yml`, for the human only, that recreates crc-sync despite a mismatch (every old
  client then sees "Update required" until it updates). Use it only knowingly.
- `crc-sync-docker.yml` runs both unit suites first; no image is built when one fails.
- Optional `CRCSYNC_DOWNLOAD_URL` (compose default `https://sourcedcs.page/download.html`) is the link the refusal frame carries.
- Clients installed before the handshake send no protocol: they are refused and keep reconnecting every 2 s with the topbar showing
  disconnected, until electron-updater installs the new release on their next launch. This is a one-time, accepted cost.

## 2026-10 — crc-sync / crc-desktop vocabulary and structure release: before the deploy

Every EFSP wire name changed, so **ship the client (a crc-desktop release) and the crc-sync image together**; an old
client against the new server (or the reverse) does not work. Decisions S-M-W7, S-M-BACKCOMPAT, S-M-DATA1.

1. `infra/.env`: rename `ASACS_DOMAIN` / `ASACS_URL` to `CRCSYNC_DOMAIN` / `CRCSYNC_URL` (the old names are no longer read; `.env.example`).
2. In the `crc-sync-state` volume (`/app/state`), delete: `efsp-board.json`, `efsp-mutations.jsonl`, every `efsp-facility-*.json`, and `alerting.json` if it has an `stca` key (the key is `conflictAlert` now). A state file is not migrated: an unknown key or an old shape stops start-up, with the file and the reason in the log (`checkPersistedShape`, `crc-sync/src/efsp/stores.js`). That includes a top-level `board`, a Board for a Facility that is not configured, a Strip in TRANSITING, and a facility file that is missing or invalid (`crc-sync/config/efsp-facility-*.json` are complete files; there is no merge with a copy in `state/`). The fix is always to correct or delete the named file; deleting gives a clean start.
3. Then deploy by re-running the Deploy workflow (it does the `git pull --ff-only`, `docker compose pull main-website atobrief crc-sync`, `docker compose up -d`; root `CLAUDE.md`, "How the docker-image services deploy").

## 2026-08-29 — wiki scraper incident: what's blocked and why

The droplet hit a load average of ~145 (1 vCPU) with 811 MB swap in use. Root cause,
from ~300k nginx access log lines:

1. A distributed residential-proxy scraper swarm (~66% of requests) hitting
   `Special:RecentChanges` with `tagfilter=visualeditor` (or its URL-encoded form
   inside `returntoquery`) and a randomized `from=` timestamp — each URL unique, so
   nothing caches, and each is a full MediaWiki parse + DB scan.
2. GPTBot (96,636 requests from `74.7.227.48` and `74.7.243.248`) and Amazonbot
   (26,342 requests).
3. A PluggableAuth failure loop: bots hit `Special:PluggableAuthLogin`, PluggableAuth
   redirects to Casdoor, Casdoor fails, MediaWiki renders a fatal-error login page
   containing another login link, repeat.
4. Apache's `mpm_prefork` default `MaxRequestWorkers 150` (~45MB RSS/child) demands
   ~6.75GB on a 2GB box.

### What's now blocking traffic at nginx (wiki vhost only — `infra/docker-compose.yml`, `nginx` service `command:`)

If someone reports a 403 on `wiki.sourcedcs.page`, check these in order:

| Symptom | Cause | Where |
|---|---|---|
| 403 on any URL, any UA | `deny 74.7.227.48;` / `deny 74.7.243.248;` — GPTBot's IPs at incident time | nginx wiki `server{}` block |
| 403, UA contains GPTBot/Amazonbot/MJ12bot/DotBot/Bytespider/l9scan/RootEvidence/crusader-worker/Dataprovider | `map $http_user_agent $bad_bot` + `if ($bad_bot) return 403;` | nginx http-level `map` + wiki `server{}` |
| 403 on RecentChanges/feedrecentchanges-style URLs | `map $args $scraper_sig` matching `tagfilter=visualeditor` (incl. URL-encoded) or `action=feedrecentchanges` | nginx http-level `map` + wiki `server{}` |
| 503 under rapid requests to the wiki | `limit_req_zone` — 5r/s, burst 30 on `location /`, 1r/s burst 3 on `Special:PluggableAuthLogin` | nginx wiki `server{}` |

The two `deny` IPs are a stopgap (GPTBot's IPs rotate) — the UA rule is the durable
control. The scraper-signature rule has no IP/UA fingerprint to key off (residential
proxy swarm), so it can only be stopped by the URL pattern itself; if the swarm
changes its query parameters, this rule will stop matching and needs updating.

**`$binary_remote_addr` caveat:** the bot-UA blocking and rate limiting above key off
the client's real IP. This is only correct while nginx is the public edge. If
Cloudflare or any other reverse proxy is ever placed in front of this box, every
request will appear to come from the proxy's IP, and rate limiting will then either
block everyone or no one — switch to a `real_ip`-resolved variable before that
happens.

**Fast-follow (same day):** the original `1r/s, burst 5 nodelay` on `location /`
was too tight for real browsing — `location /` catches every request from a page
load, not just the abusive endpoint, and a single page render (Citizen skin CSS/JS
bundles, icon assets, etc.) easily fires more than 5 near-simultaneous requests from
one client IP. With `nodelay`, anything past the burst gets an immediate `503`
instead of queuing, which silently broke skin icons for real users while the main
page still loaded fine (the first request within the burst succeeded). Since the
actual attack (bot UAs, scraper signature) is blocked upstream of this limiter
already, its remaining job is just a generic abuse backstop, so it was safe to
relax to `5r/s, burst 30`. `Special:PluggableAuthLogin`'s own tighter `1r/s, burst 3`
was left alone — a real user hits that endpoint at most once per login, so there's
no equivalent legitimate-burst concern there.

### robots.txt

Served directly by nginx (`location = /robots.txt` in the wiki `server{}` block, not
by MediaWiki) so it still works when the wiki container is down. Disallows GPTBot and
Amazonbot outright (they do honor robots.txt — this is what actually stops them,
versus the 403 wall above which they'll still keep hitting). Has no effect on the
residential-proxy swarm, which doesn't fetch or honor robots.txt.

### Apache worker cap

Confirmed via `docker run --rm mediawiki:1.43 apache2ctl -V`: the image runs
`mpm_prefork` (mod_php, not php-fpm), so the `mpm_prefork_module` tuning applies
directly. `infra/mediawiki/apache/zz-mpm.conf` is mounted to
`/etc/apache2/conf-enabled/zz-mpm.conf` — confirmed via
`apache2ctl -t -D DUMP_INCLUDES` to load after every other `conf-enabled` file
(alphabetical `zz-` prefix), so its values win. `ServerLimit` is set alongside
`MaxRequestWorkers` (both 8) since prefork silently clamps `MaxRequestWorkers` to
`ServerLimit`'s default otherwise.

### MediaWiki caching

`infra/mediawiki/LocalSettings.perf.php` (tracked in git — contains no secrets) sets
`$wgMiserMode = true` (disables expensive dynamic special pages — the single
highest-value MediaWiki-side change for this incident) and
`$wgMainCacheType`/`$wgParserCacheType = CACHE_ACCEL`.

**APCu is already present** in the `mediawiki:1.43` base image (verified: `php -m`
lists `apcu`, default `apc.shm_size=32M`) — no Dockerfile or php.ini change was
needed. OPcache is also already enabled by default.

**Important — `LocalSettings.perf.php` is not auto-loaded.** `LocalSettings.php`
itself is intentionally gitignored (it holds DB credentials and the Casdoor OAuth
secret — see "Secrets" below) and is not part of this repo checkout. One-time manual
step on the host, required for these settings to take effect:

```bash
echo "require_once '/var/www/html/LocalSettings.perf.php';" >> infra/mediawiki/LocalSettings.php
docker compose restart mediawiki
```

Do this once per host. `docker-compose.yml` mounts `LocalSettings.perf.php`
read-only into the container at that exact path, so nothing else needs to change on
future recreates. (An `auto_prepend_file` php.ini approach was considered instead —
rejected because MediaWiki assigns `$wgMiserMode` etc. from its own defaults
*between* php.ini auto_prepend and the point `LocalSettings.php` is required, which
would silently clobber values set any earlier. `require_once` from the end of
`LocalSettings.php` is the only load-order-safe place.)

### Stale upstream resolution (nginx → mediawiki)

Already handled in the existing config before this change — `resolver 127.0.0.11`
plus `set $upstream mediawiki; proxy_pass http://$upstream:80;` in every vhost
already forces per-request DNS re-resolution (Docker's embedded DNS), so a
`mediawiki` (or any other backend) container recreate doesn't require an nginx
restart. This PR only tightens `resolver ... valid=30s` to `valid=10s ipv6=off` for
faster pickup. No `proxy_pass` here carries a URI suffix, so the
variable-in-proxy_pass caveat (losing automatic `$request_uri` passthrough) doesn't
apply — verified by testing every vhost's config end to end (see "How this was
tested" below).

### Log rotation

`x-logging` anchor added in `docker-compose.yml`, applied to every service
(`json-file`, `max-size: 50m`, `max-file: 3`). Takes effect on next recreate of each
container — pure compose config, no host file (`/etc/docker/daemon.json`) touched.

## Secrets incident (found during this work, unrelated to the scraper issue)

`infra/mediawiki_backup_20260623_110448.tar.gz`, `infra/mediawiki-backup-20260710-1726.sql`,
and `infra/mediawiki_backup_20260623_110351/all_databases.sql` were committed to git
(commit `9c5adf2`, on `origin/main`). The `.tar.gz` bundled `.env.backup` in full —
i.e. `MYSQL_ROOT_PASSWORD`, `WIKI_DB_PASSWORD`, `CASDOOR_DB_PASSWORD`,
`CASDOOR_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `RELEASE_UPLOAD_TOKEN` — plus
`LocalSettings.php` and a full DB dump. Per the repo owner: these specific
credentials were already rotated a while ago, so the live exposure is stale, but the
values still sit in git history.

This PR removes the three files from the working tree/repo going forward and adds
gitignore patterns (`infra/mediawiki_backup_*/`, `infra/mediawiki-backup-*.sql`,
`infra/mediawiki_backup_*.tar.gz`, `infra/*.sql`) so `infra/backup_mediawiki.sh`
output can't land in the repo again. It does **not** rewrite git history — that's a
separate, more disruptive decision (force-push implications for anyone with a local
clone) left to the repo owner if/when they want it. `infra/backup_mediawiki.sh` still
bundles `.env` and `LocalSettings.php` into its output archive by design (it's meant
as a disaster-recovery bundle) — the fix here is only "don't commit the output
directory," not "stop the script from including secrets in a backup file that's
supposed to be a full restore point." Keep backup archives out of the repo and off
of anywhere with broader read access than the restore operation needs.

The `.gitignore` also had an unresolved git merge-conflict marker
(`<<<<<<< HEAD` / `=======` / `>>>>>>> aeace0d`) committed in it, and three duplicate
`infra/mediawiki/LocalSettings.php` lines. Cleaned up as part of the same touch.

## Discovery findings (from this task)

1. Compose files: everything lives in the single `infra/docker-compose.yml` — no
   separate compose files per service.
2. nginx config is generated entirely inline in `docker-compose.yml`'s `nginx`
   service `command:` (a shell heredoc writing `/etc/nginx/conf.d/default.conf`) —
   there is no standalone `nginx.conf` and no `conf.d/` include pattern beyond that
   one generated file. Both the `http{}`-level directives (`resolver`,
   `client_max_body_size`, the new `map`/`limit_req_zone` blocks) and every
   `server{}` block (including the `wiki.sourcedcs.page` one, matched via
   `server_name '$WIKI_DOMAIN'`) live in that same generated file/command block.
3. `infra/mediawiki/Dockerfile` builds `FROM mediawiki:1.43` (official image, Debian
   + Apache + mod_php) plus PluggableAuth, OpenIDConnect, and the Citizen skin.
4. `LocalSettings.php` is not in this repo checkout — it's gitignored on purpose
   (see "Secrets incident" above) and lives only on the host, volume-mounted in.
5. APCu and OPcache are both already installed and enabled in the base image (see
   "MediaWiki caching" above) — this ruled out the Dockerfile changes the spec
   anticipated as a fallback.

## How this was tested

No access to the live droplet from this environment (it's a separate host). Instead,
validated locally with real `docker compose` / `docker` / the actual
`infra/mediawiki` Dockerfile build:

- Built an isolated copy of the full compose stack (`docker compose -p wikitest`)
  with the real `nginx` service and stub backends (self-signed certs, `alpine sleep
  infinity` containers standing in for mediawiki/casdoor/main-website/atobrief/
  crc-sync/mariadb) to get the *actual* generated `/etc/nginx/conf.d/default.conf`
  and run the real `nginx -t` — this config is built via a fragile hand-escaped
  shell heredoc (`\$$`/`$$` doubling for compose variable interpolation), so
  hand-verifying the escaping by inspection was not trustworthy; every change here
  was validated against the real generated file.
- Confirmed via that harness: `nginx -t` passes; `curl -A 'GPTBot/1.4'` → 403 on the
  wiki vhost only (502, not 403, on other vhosts — confirming the bot/scraper rules
  are correctly scoped to `wiki.sourcedcs.page` and don't affect
  auth/main/atobrief/asacs); the `tagfilter=visualeditor` scraper signature → 403;
  `robots.txt` served with real newlines (the escaping needed `\\n`, not `\n`, to
  survive the heredoc — plain `\n` collapsed to a bare `n`, caught by testing);
  rapid requests to `/` and to `Special:PluggableAuthLogin` return 503 once their
  respective burst allowances are exhausted.
- Built the actual `infra/mediawiki` image locally and confirmed: `apache2ctl -V`
  reports `mpm_prefork`; `apache2ctl -t` passes with `zz-mpm.conf` mounted;
  `apache2ctl -t -D DUMP_INCLUDES` confirms it loads last among `conf-enabled`
  files; `php -l` passes on `LocalSettings.perf.php`; the container starts cleanly
  (Apache reaches "resuming normal operations") with all three new mounts
  (`LocalSettings.perf.php`, `zz-mpm.conf`, plus the existing `LocalSettings.php`
  mount) in place; confirmed `CACHE_ACCEL` is defined by MediaWiki core
  (`includes/Defines.php`) before `LocalSettings.php` is required, so the perf
  file's use of that constant resolves correctly in the real boot sequence (it
  cannot be tested via a bare `php -r` one-liner outside MediaWiki's own bootstrap,
  which is what a first attempt at this check hit and which is a test-harness
  artifact, not a real issue).
- Did not stand up a full DB-backed MediaWiki instance, so no live page load or
  `$wgMiserMode`/cache-hit behavior was exercised end-to-end — only config
  correctness and container startup.

## Deploying this on the actual droplet

```bash
git pull --ff-only
cd infra
docker exec nginx nginx -t          # confirm current config is still fine before touching anything
# apply the one-time LocalSettings.php hookup (see "MediaWiki caching" above) if not already done
docker compose up -d mediawiki      # recreate to pick up zz-mpm.conf + LocalSettings.perf.php mounts
sleep 5
docker exec nginx nginx -s reload   # or: docker compose up -d nginx to recreate with the new generated config
```

Then verify per the spec's section 5 (scraper-signature 403, bot-UA 403, normal
traffic 200, robots.txt served, worker count ≤ 9), and watch `vmstat 1` for ~10
minutes — success is `r` in single digits, `si`/`so` near zero, load average
trending back toward 1.

## Out of scope — reported, not fixed

- **PluggableAuth fatal-error loop.** The rate limit on
  `Special:PluggableAuthLogin` damps it but doesn't fix the underlying Casdoor auth
  failure. No access to the live host's logs from this environment to pull
  `docker logs mediawiki | grep -i pluggableauth` — do this on the droplet directly
  when investigating that failure.
- **Public read access** (`$wgGroupPermissions['*']['read'] = false;`) would end
  this entire problem class — scrapers would hit a login wall on every URL. This is
  a product decision (is the wiki publicly readable for recruitment purposes?), not
  a technical one — not implemented here, flagged for the repo owner to decide.
- **Host uptime / pending kernel updates.** 178 days up at incident time; a reboot
  was explicitly out of scope for this task.
- **Git history rewrite for the leaked secrets.** See "Secrets incident" above —
  credentials already rotated, so treated as a lower-urgency cleanup left to the
  repo owner rather than done unilaterally in this PR.
