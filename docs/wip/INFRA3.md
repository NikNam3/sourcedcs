# INFRA3 — settled infra decisions (H82 R3-17/34/36/37, H86 R3-67)

Branch `lane/INFRA3-settled-infra`. No push, tag or workflow run. `docker` was available locally; `actionlint` was not
(workflow YAML parsed with PyYAML only, plus a review of the `needs`/`if` logic below).

## R3-34 compose mounts `./init.sh` (done)
`infra/docker-compose.yml` mariadb: `./mariadb/init.sh:/docker-entrypoint-initdb.d/init.sh:ro` became `./init.sh:...` (INFRA2's O-3 option A;
the tracked file is `infra/init.sh`, there is no `infra/mariadb/`). Init scripts run only on an empty data dir, so a running prod DB is unaffected.
Human (optional, from INFRA2): `ls -la infra/mariadb/ infra/init.sh` on the server; if a stray `infra/mariadb/init.sh` *directory* exists
(created by docker for the old bad mount) it is harmless and can be removed.

## R3-36 nginx template + CI check (done)
INFRA2 had the template and a node diff test but no `nginx -t`. Added `infra/tests/nginx-t.sh` (renders `infra/nginx/templates` with dummy env
through the nginx image's own envsubst step, throwaway self-signed certs at the paths the template names, then `nginx -t`) and
`.github/workflows/infra-nginx-check.yml` (path-filtered to `infra/nginx/**`, `infra/docker-compose.yml`, `infra/tests/**`; runs `docker compose config`
with `.env.example`, the node render test, and `nginx-t.sh`). **Ran `infra/tests/nginx-t.sh` locally: "syntax is ok / test is successful".**
Upstreams are `set $upstream` variables, so no DNS or running stack is needed.

## R3-37 refuse release tags not on main (done)
- `crc-desktop-release.yml`: new first job `verify-main` (fetch-depth 0, `git merge-base --is-ancestor $GITHUB_SHA origin/main` on tag refs, `::error` with the fix).
  `build` has `needs: verify-main`.
- **Redeploy guarantee:** `trigger-crc-sync-release` now has `needs: [verify-main, build]` and
  `if: ${{ !cancelled() && needs.verify-main.result == 'success' }}`. A failed `build` leaves `verify-main` successful, so the redeploy still
  runs (the unconditional-on-build semantics the CLAUDE.md deadlock story needs). A refused tag makes `verify-main` fail, `build` is skipped, and
  the trigger job's condition is false, so nothing is rebuilt or redeployed. `workflow_dispatch` runs skip the check (no tag ref).
- The same guard step was added to `atobrief-docker.yml`, `sourcedcs-web-docker.yml`, `crc-sync-docker.yml` (only on `refs/tags/*`; branch pushes
  and the `--ref main` dispatch are unaffected). Those tag builds never deployed anyway (deploy.yml filters on branch main/dev).
- CLAUDE.md should gain (see integrator): "Release tags (`crc-desktop-v*`, `v*`) must be on main; the workflows refuse otherwise."

## R3-67 nix packages removed (done)
Removed from `flake.nix` (all recoverable with `git show 165a517:flake.nix`): the `let` bindings `miztoyaml`, `atobrief`, `sourcedcs-web`, `lxsrs_v2`
and the `packages = { inherit ...; default = miztoyaml; }` output, i.e. `nix build .#miztoyaml|atobrief|sourcedcs-web|lxsrs_v2|default`.
Kept untouched: `devShells.default`, `devShells.srs`, `pythonEnv`, `nodejs22`, inputs. `nix flake show` still evaluates.
No source code was deleted (only the recipes). Recipe details that exist nowhere else, in case anyone rebuilds one:
- all four were `src = ./<dir>` builds; the two npm ones used `pkgs.buildNpmPackage` with **placeholder** `npmDepsHash = sha256-AAAA...` (never filled in; see HYG.md O-7),
  `installPhase` copying the whole tree to `$out/share/<name>` (like the Dockerfile `COPY . .`) plus a `$out/bin/<name>` sh wrapper doing `cd $out/share/<name>; exec node server.js`; sourcedcs-web also made an empty `data/`.
- miztoyaml: `buildPythonApplication`, `format = "other"`, `src = ./tools`, propagated `pyyaml`, copied `miztoyaml/` to `lib/python3/site-packages/tools/` and wrote a `bin/miztoyaml` python shim calling `tools.miztoyaml.main()`.
- lxsrs_v2: `src = ./.`, propagated numpy/sounddevice/pynput/opuslib, buildInputs libopus/portaudio/libpulseaudio, `makeWrapper python3 ... --prefix PYTHONPATH --prefix LD_LIBRARY_PATH (portaudio libopus libpulseaudio) --add-flags "-m lxsrs_v2"`.
Stale text now: CLAUDE.md line "Per-service `nix build .#<name>` package definitions..." and the "Nix dev environment" note (see integrator).

## R3-17 untrack `sourcedcs-web/data` (done as a commit; needs the human's server steps first)
Compare (tracked vs what the app needs on first boot):
| tracked file | content | `store.js` fallback when absent | action |
|---|---|---|---|
| skill-tree.json (7.7 KB) | the only real content, a skill tree | empty tree | **moved** to `sourcedcs-web/data-seed/skill-tree.json` (shipped in the image; `seed.js` copies it only where absent, never overwrites) |
| discord-roles.json | `_comment` + two example entries | `{}` | untracked, not seeded (seeding would create fake mappings on a fresh volume) |
| applications.json (284 B, old VIPER27 test application), voice-activity.json (61 B) | dev leftovers | empty | untracked |
| activity-scores, events, grading-requests, pilot-registry, roster, skill-grades, squadrons (2 B each, `[]`/`{}`) | empty | empty | untracked |
`.gitignore` gained `sourcedcs-web/data/*.json`; `.dockerignore` comment corrected (`data` still excluded, `data-seed/` ships). sourcedcs-web `npm test`: 103 pass (the store test
visibly seeds skill-tree.json into the ignored `data/`).
**Risk, stated plainly.** Compose mounts the named volume `sourcedcs-web-data` at `/app/data`; no bind mount of the checkout and `data` is not in the image, so the running container never reads
the host's tracked files and the volume cannot be touched by this change. What the deploy's `git pull --ff-only` WILL do: delete those 11 files from the server checkout's working tree
(and abort the whole deploy if any of them is locally modified on the server). I cannot see the server (an untracked `docker-compose.override.yml` or a manual bind mount would change this), so:
Human, on the server BEFORE the deploy that carries this commit:
1. `cd <PATH> && git status --short sourcedcs-web/` (must be clean; if not, `git stash`/inspect the diff first) and `docker inspect main-website --format '{{json .Mounts}}'` (expect only the `sourcedcs-web-data` volume on /app/data).
2. Backup: `docker run --rm -v infra_sourcedcs-web-data:/d -v $PWD:/b alpine tar czf /b/sourcedcs-web-data-$(date +%F).tgz -C /d .` (check the real volume name with `docker volume ls`; the prefix is the compose project name).
3. `cp -a sourcedcs-web/data /root/sourcedcs-web-data-hostcopy`.
4. `docker exec main-website cat /app/data/skill-tree.json | diff - sourcedcs-web/data/skill-tree.json` (volume copy is expected to be the truth).
5. Let the deploy run. Never `docker compose down -v` / `docker volume rm`. Local dev checkouts: the same pull removes the tracked files; copies you want, keep before pulling (they are ignored afterwards).
If step 1 or 4 surprises you, stop and do not merge this commit.

## Defaults taken
- R3-34 interpreted as INFRA2's O-3 (compose path to `./init.sh`, option A); R3-37 extended to the three docker workflows' `v*` tags; discord-roles.json not seeded; `.gitignore` pattern is `data/*.json` (keeps `uploads/`, `releases/` rules as they were).

## For the integrator (edits outside my files)
- CLAUDE.md: replace the "Per-service `nix build .#<name>` ..." sentence with "`flake.nix` provides dev shells only (`nix develop`, `nix develop .#srs`); the per-service nix packages were removed (R3-67)."
- CLAUDE.md "How to build and release crc-desktop": add "The workflow refuses a `crc-desktop-v*` tag whose commit is not on `main` (`verify-main` job); tag from main."
- CLAUDE.md sourcedcs-web section: "`data/*.json` is gitignored runtime data (prod: the volume); first-boot defaults are in `data-seed/`, copied by `seed.js` only where absent."
- docs/wip/HYG.md O-7 (nix hash) is now moot.
