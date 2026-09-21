# 0048 — Runtime state lives in `state/`, shipped defaults in `config/`, and a read falls back from one to the other

## Context

`docs/adr/0042` recorded, as a found-but-unfixed problem, that the `crc-sync` service has no volume for `config/` — so a `docker compose up -d` that recreated the container discarded the EFSP Board snapshot and the Mutation log, despite `docs/adr/0002` making the Board durable and `docs/adr/0041` going to some trouble to make `_persist` atomic.

Looking at it properly to fix it, **the problem was larger than those two files and worse in kind.** Seven separate things were being written into a directory baked into the image with nothing behind it:

| file | written by | what a deploy discarded |
|---|---|---|
| `efsp-board.json` | `efsp/index.js`'s `_persist` | the whole Board — Strips, FDRs, airspace state, correlation |
| `efsp-mutations.jsonl` | `mutation-log.js` | the entire audit trail (§11.3's append-only record) |
| `squawk-map.json` | `resolve.js`'s `setSquawkMapping` | squadron squawk→callsign edits, **made live from any client** |
| `theater-settings.json` | `theater-settings.js` | transition altitude, heading correction, game-time offset |
| `apt-config.json` | `apt-config.js` | per-airport ATIS frequency, runway, info letter, manual weather |
| `efsp-facility-*.json` | `facility-config.js`'s `setFacilityConfig` | facility config edits |
| `efsp-airspaces.json` | `airspace-config.js`'s `setAirspaces` | the MOA and range definitions — squadron data |

The squawk map and the ATIS config are edited live over the WebSocket by any connected controller (`ws-hub.js`'s `squawkMapSet` and `aptConfigSet`), and `CLAUDE.md` documents that a deploy runs `docker compose up -d` on every merge to `main`. So squadron-wide settings were being reset by unrelated deploys, and nobody had connected the two.

**And two of them were committed to git.** `config/efsp-board.json` carried 8.5 KB of real Strips; `config/efsp-mutations.jsonl` carried 107 KB of real audit trail. That is worse than losing them: a recreated container restored *that* snapshot, so a deploy silently reverted controllers to somebody else's old board rather than starting empty. A silent revert is a nastier failure than an obvious reset, and an append-only audit log in version control grows forever.

The obvious fix — mount a volume at `/app/config` — does not work. A named volume starts empty, so it would shadow the facility, airspace, squawk-map and radar-spec files baked into the image and present as every one of them having reset to defaults. `docs/adr/0042` had already noted that trap when adding the DEM cache volume, and sidestepped it rather than solving it.

## Decision

**Two directories, and a read rule.**

```
config/   shipped defaults. Baked into the image, read-only in practice.
data/     everything written at runtime. A volume in the compose stack.
```

`src/state-paths.js` holds the whole of it:

- **A write always goes to `state/`.**
- **A read prefers `state/` and falls back to the shipped default in `config/`.**
- **An explicit env override wins for both**, so every `CRCSYNC_*_PATH` variable the tests rely on behaves exactly as before.

That gives three properties, and the third is the one worth having:

1. First boot in a fresh container reads the shipped default and writes to the volume.
2. Later boots read the volume.
3. **An image update that adds a new default file lands with no migration**, because a file not yet present in the volume still falls back to the image.

Property 3 is `docs/adr/0041`'s question — *"what happens to this the next time the code grows?"* — asked of the deployment instead of a config list. Resolve the fallback once at module load and it breaks in a subtler way: a file written during a session would keep being read from the image until the next restart. So `readPath` resolves per call.

`Dockerfile` creates `/app/state` and chowns it to `node` **before** dropping privileges — `COPY` runs as root, so `/app` is root-owned and the service could not otherwise write its own snapshot. Without a volume it is just a directory in the container, which is the pre-existing behaviour and keeps a plain `docker run` working.

**The two committed files are untracked and gitignored.** They are runtime state, not configuration. A fresh clone now starts with an empty Board, which is what a fresh install should do.

**`radar-specs.json` stays purely in `config/`** — nothing writes it, so it needs no live copy. Being in `config/` is now a statement that a file is read-only, which it was not before.

## Alternatives considered

- **Mount a volume at `/app/config`.** Rejected: an empty named volume shadows the image's config files, so every shipped default would read as reset. `docs/adr/0042` already named this trap.
- **An entrypoint that seeds the volume from the image on first run** (`cp -n /app/config-defaults/* /app/state/`). The standard pattern, and it would work — rejected because it moves the logic into a shell script that no test can see, and it seeds *once*: a default added by a later image update never reaches an already-seeded volume. Property 3 above is exactly what it gives up, and property 3 is the one that stops this recurring.
- **Bind-mount a host directory over `config/`** and copy the shipped files in by hand on first deploy. Rejected: it makes correct deployment a manual step somebody has to remember, and the failure mode of forgetting is silent.
- **Leave the read path alone and only move the two EFSP files**, as `docs/adr/0042` had scoped it. Rejected once the audit showed seven writers: fixing two and leaving five would have left the squawk map and ATIS config still resetting on deploy, and the next person to look would have to re-derive the whole problem.
- **Keep the committed Board snapshot as a shipped default.** Rejected: a snapshot of somebody's old strips is not a useful default for anyone. The fallback still reads it if present, which is deliberate — it is what lets an operator seed the volume from the current live board if they want to — but it is not carried in git.
- **Keep the mutation log in `config/` and rotate it.** Rejected: rotation is WP8's (§11.3), and the file's problem is not its size but that it was in the image and in git.

## Consequences

- **`tests/state-paths.test.mjs` pins the read fallback in both directions**, including the case that matters on an image update: a volume full of live files plus a brand-new shipped default, where the new default must still be read. It also asserts that all nine runtime-written filenames resolve under `state/` — the assertion that would have caught the original bug, and the place to add a line if a tenth writer appears.
- **Verified by running it, not only by test.** From a deleted `state/`, `createEfsp()` restored 2 Strips from the shipped `config/efsp-board.json` fallback and `persist()` then wrote `state/efsp-board.json`, leaving `config/` untouched.
- **The live server's current Board will not carry over by itself.** It exists only inside the running container, as it always has. To keep it, copy it into the volume before the next deploy:
  ```bash
  docker cp crc-sync:/app/config/efsp-board.json - \
    | docker run --rm -i -v crc-sync-state:/state alpine tar x -C /state
  ```
  Doing nothing starts the Board empty, which is the honest default and is what happens on any deploy today.
- **`config/` now means "read-only shipped default".** Anything that writes into it in future is a bug, and `state-paths.js`'s header says so.
- **`docs/adr/0042`'s Consequences entry describing this as unfixed is now superseded**, and the EFSP briefing's "smaller, known, non-blocking" list loses its highest-value item. Neither earlier document is rewritten — `docs/adr/0022`'s precedent is to correct in new prose rather than edit an ADR after the fact.
- One thing this does **not** fix: `sourcedcs-web`'s `store.js` still does a plain `fs.writeFileSync` with no tmp-and-rename, so it has `docs/adr/0041`'s non-atomic-write problem that crc-sync's `_persist` does not. Different service, different change, noted here because the audit walked past it.
