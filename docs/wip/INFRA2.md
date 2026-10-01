# INFRA2 — concerns queue (infra + sourcedcs-web)

Branch `lane/INFRA2-queue`. No docker was run; nothing touched a running stack.

## O-5 LOG_LEVEL (implemented)

Single definition, to be used verbatim by crc-sync (lane QAS) and in the CLAUDE.md env table:

> `LOG_LEVEL` = `error` | `warn` | `info` | `debug`, default `info`, case-insensitive; an unknown value falls back to `info`.
> Levels are cumulative (`debug` prints everything, `error` only errors). Read by atobrief, sourcedcs-web, crc-sync.

atobrief and sourcedcs-web: `logger.js` (thin wrapper over `console`, no dependency; `console.log` calls became `log.info`,
`console.debug` became `log.debug`). `createLogger(level, sink)` is exported for tests. `scripts/backfill-activity-scores.js`
keeps plain `console` (CLI output). Note: existing `console.debug` lines in sourcedcs-web's Discord client are now hidden at
the default level (previously always printed); set `LOG_LEVEL=debug` to get them. `.env.example` has `LOG_LEVEL=info`; compose
passes `LOG_LEVEL=${LOG_LEVEL:-info}` to main-website, atobrief and crc-sync (crc-sync ignores it until QAS lands).
Proposed CLAUDE.md env-table row: `| LOG_LEVEL | atobrief, sourcedcs-web, crc-sync (error/warn/info/debug, default info) |`.

## O-15 nginx config out of docker-compose.yml (implemented)

- `infra/nginx/templates/default.conf.template` (rendered by the nginx image's own envsubst step into `conf.d/default.conf`;
  only `${WIKI_DOMAIN} ${AUTH_DOMAIN} ${DOMAIN} ${ATOBRIEF_DOMAIN} ${CRCSYNC_DOMAIN}` are substituted, nginx `$vars` untouched).
- `infra/nginx/snippets/wiki-denied-bot-ips.conf`: the two GPTBot `deny` IPs, included from the wiki server block.
  (The user-agent bot map stays in the template.)
- Compose: `command:` removed, both dirs mounted `:ro`. `client_max_body_size 350M` kept.
- Proof: `node --test infra/tests/*.test.js` emulates the old inline string (compose `$$`, shell quoting; frozen copy in
  `infra/tests/fixtures/old-inline-nginx-compose.yml`) and diffs it, whitespace-normalised, against the new template with
  the include expanded. Identical. Not verified: an actual `nginx -t` (no docker here).
- Human check before/after deploy (touches no running service): `cd infra && docker compose config | grep -A12 nginx`, then
  `docker run --rm --env-file .env -e CRCSYNC_DOMAIN=$ASACS_DOMAIN -v $PWD/nginx/templates:/etc/nginx/templates:ro -v $PWD/nginx/snippets:/etc/nginx/snippets:ro nginx:alpine sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh && nginx -t'`
  (`nginx -t` will complain about missing certs under /etc/letsencrypt; that is expected off-server.)
- Caveat: takes effect only after the deploy's `git pull` + `docker compose up -d`, as with every nginx change.

## O-16 ASACS_DOMAIN / asacs naming (implemented, backward compatible)

- Compose: `CRCSYNC_DOMAIN=${CRCSYNC_DOMAIN:-${ASACS_DOMAIN}}` for nginx. An existing `infra/.env` with only `ASACS_DOMAIN`
  renders the same vhost. `.env.example` documents `CRCSYNC_DOMAIN` and the commented legacy name.
- `ASACS_URL` (site link, sourcedcs-web): `CRCSYNC_URL` is read first, then `ASACS_URL`, then the default. Compose forwards
  `CRCSYNC_URL=${CRCSYNC_URL:-${ASACS_URL}}`.
- Unchanged on purpose: default endpoint `wss://asacs.sourcedcs.page` and the `asacs.$DOMAIN` DNS name/certificate in
  `infra/setup.sh` (it is the real hostname). Only the setup.sh echo label was renamed.

## O-9 tracked `sourcedcs-web/data/*.json` — VERDICT: do NOT untrack now; safe procedure below

Facts (read from the code):
- Prod data lives in the named volume `sourcedcs-web-data` mounted at `/app/data` (compose). It is not a bind mount of the
  repo checkout, and nothing in compose references `sourcedcs-web/data` on the host.
- `.dockerignore` contains `data`, so the tracked files are NOT baked into the image; they are not a seed today either.
  A fresh volume starts empty and `store.js` falls back to `[]`/empty skill tree.
- The tracked files are tiny dev leftovers: nine are `[]`/`{}`-sized (2 bytes) or <500 bytes (an old VIPER27 test
  application, `discord-roles.json`); the only substantive one is `skill-tree.json` (7.7 KB, 3 commits).
- `deploy.yml` runs `git pull --ff-only` in the host checkout. If a commit removes tracked files, that pull deletes them
  from the host working tree (volume untouched). If a tracked data file has local modifications on the server, the pull
  aborts and so does the whole deploy.
So untracking cannot touch the volume. What it can do: delete host-checkout copies (harmless unless someone uses them as a
manual seed source) or break the deploy if the checkout is dirty. Not provable from here because the server may carry an
untracked `docker-compose.override.yml` or a manual copy; hence no tracking change was made.

Safest procedure (human, on the server):
1. `cd <PATH> && git status --short sourcedcs-web/ ; docker volume inspect infra_sourcedcs-web-data` (confirm it exists; note the project prefix).
2. Back up the live data: `docker run --rm -v infra_sourcedcs-web-data:/d -v $PWD:/b alpine tar czf /b/sourcedcs-web-data-$(date +%F).tgz -C /d .`
3. `cp -a sourcedcs-web/data /root/sourcedcs-web-data-hostcopy` (so the host copies survive the pull).
4. Compare `skill-tree.json`: `docker exec main-website cat /app/data/skill-tree.json | diff - sourcedcs-web/data/skill-tree.json`.
   If the volume copy is the newer truth (expected) the repo copy is only history.
5. Then in the repo: `git rm --cached sourcedcs-web/data/*.json` + a `.gitignore` entry for `sourcedcs-web/data/*.json`.
   Optionally move `skill-tree.json` to `sourcedcs-web/data-seed/` (rename). `store.js` already calls
   `seedDataDir(data, data-seed)` (new, `sourcedcs-web/seed.js`, tested): copies seed files only where the target is absent,
   never overwrites or deletes, no-op while `data-seed/` does not exist. The seed dir ships in the image (`.dockerignore`
   excludes only `data`), so a brand-new volume gets a skill tree while the prod volume keeps its own.
6. Never `docker compose down -v`, never `docker volume rm`.
Same question for `lxsrs_v2_state.json` (root and `crc-desktop/`): not a server file; untracking affects nothing on prod.

## O-3 MariaDB init.sh mount path — NOT changed

Compose mounts `./mariadb/init.sh:/docker-entrypoint-initdb.d/init.sh:ro`, but the tracked file is `infra/init.sh`
(there is no `infra/mariadb/`). Init scripts only run on an empty data dir, so a running prod DB is unaffected either way;
on a fresh install the mount would create a directory named `init.sh` and skip DB/user creation.
Check the human must run on the server: `ls -la infra/mariadb/ infra/init.sh; docker inspect mariadb --format '{{json .Mounts}}'`.
- Option A (fix compose): change the mount to `./init.sh:/docker-entrypoint-initdb.d/init.sh:ro`. Correct if the server has no `infra/mariadb/init.sh`.
- Option B (move file): `git mv infra/init.sh infra/mariadb/init.sh`, compose unchanged. Correct if the server's compose/RUNBOOK already assume `mariadb/`.
Pick whichever matches what the server actually has; do not change both.

## O-14 crc-sync redeploy always `--ref main` — NOT changed

`crc-desktop-release.yml` ends with `gh workflow run crc-sync-docker.yml --ref main`, so a tag release always rebuilds main's
crc-sync even when the tag commit is not on main (or main has moved). Options:
1. Keep (status quo): simple; client and server may differ by whatever landed on main since the tag. Matches "latest server for latest client".
2. `--ref ${{ github.ref_name }}` (the tag): crc-sync built from exactly the released commit; but `deploy.yml` only deploys builds on `main`/`dev`, so a tag build would be pushed to GHCR and never deployed.
3. Dispatch on main but pass the tag SHA as an input and make `crc-sync-docker.yml` checkout it: needs both workflows edited and deploy.yml's branch filter reconsidered.
Recommendation: keep option 1 until releases are cut from branches other than main.

## Defaults taken / not done
- No change to tracked data files (O-9), compose mariadb mount (O-3), release workflow (O-14).
- Test counts: atobrief 77 -> 82, sourcedcs-web 95 -> 103 (logger and seed tests), infra render tests 0 -> 4 (`node --test infra/tests/*.test.js`, not in any npm test).
- Findings: the single `console.debug` usage in sourcedcs-web now silent at default level (above); `RUNBOOK.md` line 185 still says "asacs" as a vhost name (left, it is the hostname).
