# HYG — infra/env hygiene lane

## What landed (branch lane/HYGIENE-infra-env)

- `.env.example` and `infra/docker-compose.yml` now agree. Added to the example: `TAG` (commented, optional), `MYSQL_ROOT_PASSWORD`, `WIKI_DB_PASSWORD`, `CASDOOR_DB_USER`, `CASDOOR_DB_PASSWORD`, `GRADING_CHANNEL_ID`, `CRCSYNC_COALITION=3`. Removed `PORT` (compose hardcodes it per service). `CRCSYNC_CONFIG_DIR`, `CRCSYNC_STATE_DIR`, `CRCSYNC_TERRAIN_CACHE_DIR` stay as commented-out local-only entries (compose never forwards them).
- `CRCSYNC_COALITION` is wired into the crc-sync service (`${CRCSYNC_COALITION:-3}`, 3 = BLUE, 2 = RED).
- `LOG_LEVEL` (O-5) removed from the three services: nothing reads it. Verified by grep over all service code.
- `trust proxy` = 1 in atobrief, sourcedcs-web and crc-sync (`app.set`). nginx now also sends `X-Forwarded-For $proxy_add_x_forwarded_for` for the 7000/4000/3000 upstreams (it only sent X-Real-IP, so trust proxy alone would not have helped). Takes effect only after the deploy's `git pull` + `docker compose up -d`. No test added: no service has a server-level test harness that boots the real app (atobrief's usmtf-api test builds its own express app).
- `flake.nix` (O-7): atobrief and sourcedcs-web installPhase now copy the whole source tree (as the Dockerfiles do). **Not verified**: I cannot run `nix build`; `npmDepsHash` is still the all-A placeholder and needs the real hash (`nix build .#atobrief` prints it).
- sourcedcs-web `saveJSON` is atomic (temp sibling + rename, temp removed on failure); 2 tests.
- Installer pruning: `pruneReleases` in `sourcedcs-web/releases.js`, called after each successful `/api/releases/upload`. Keeps newest 3 versions per platform (exe / AppImage, numeric version compare), deletes older installers plus `.blockmap`; never deletes manifests, nor the file the latest manifest names (or its blockmap); unrecognised files untouched. 3 tests.
- `crc-desktop-release.yml`: removed the meaningless `paths` filter; uploads blockmaps before manifests (O-13).

## Concerns checked and NOT changed

- O-14 (crc-sync dispatch `--ref main`): left as is. The tag's branch is not knowable from the tag event (a tag has no branch), and deploy.yml only deploys on main/dev completions of crc-sync-docker, so `--ref main` is the only safe, intended behaviour per CLAUDE.md. Documented only.
- O-9 (data/*.json tracked in git) and the tracked `lxsrs_v2_state.json` (root and crc-desktop/): not touched. Gitignoring needs `git rm --cached` and a seed-file rename for skill-tree.json; the prod volume mount makes it a human call.
- O-10 (duplicated Casdoor exchange): auth code, out of scope by decision.
- O-4 detail "infra/.env.example does not exist": true by design (the root `.env.example` is copied to `infra/.env`); the RUNBOOK/setup.sh already say so.

## For the human (not touched)

- **MariaDB init.sh mount path.** compose mounts `./mariadb/init.sh` but the tracked file is `infra/init.sh`. The production server may hold an untracked `infra/mariadb/init.sh`. Ask before changing either side.

## Proposed CLAUDE.md edits (I did not edit it)

1. Commands, crc-sync block: replace "The soak currently **fails** on known findings owned by wave-2 lanes; see `docs/efsp-briefing.md`." with the current state once the briefing is folded (S-9); the briefing section 1 still says "Wave 1 merged ... Wave 2 is next", ADRs "0001-0067, 0078, 0079, 0084", "1565 pass", whereas wave-2 lanes are merged, ADRs reach 0091 and crc-sync has 1874 passing tests.
2. crc-sync architecture: "`public/` is currently an unused scaffold" is wrong: `crc-sync/public` does not exist (server.js still mounts the missing dir; `/js/config.js` is the only live use). Say "crc-sync has no `public/`".
3. Same section / crc-sync dirs paragraph: mention that `config/theaters.json` (shipped per-theater defaults: transition altitude, TM central meridian, magnetic override, ADR 0085) is overridable field by field by `state/theaters.json`; the "theater settings" in the lost-state list is the older `theater-settings.json`.
4. atobrief: "six sections" lists seven (`header`, `registry`, `ato`, `aco`, `spins`, `comms`, `weather`): say "seven".
5. sourcedcs-web heading: "port 7000" is compose/`PORT=7000` only; `server.js` defaults to 3000 when PORT is unset (Dockerfile ENV PORT=3000, compose sets 7000). The Commands line already passes `PORT=7000`; reword the heading to "port 7000 via PORT".
6. Env table: add `CRCSYNC_COALITION` (crc-sync; 3 = BLUE default, 2 = RED; Mode 4 key; now in `.env.example` and compose). Remove `LOG_LEVEL` if anywhere. Fix the `ATOBRIEF_USMTF_TOKEN` row (S-8): crc-sync never reads it (L14's import is paste/drop only); it is only needed by external USMTF consumers of atobrief.
7. Deploy section: add that nginx now forwards `X-Forwarded-For` and all three apps use `trust proxy 1`, and that sourcedcs-web prunes installers to the newest 3 per platform.
