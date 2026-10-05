# ARCHIVE-12H (ADR 0107, H107)

`ARCHIVE_AFTER_MS` 2 h -> 12 h. ADR `0107-finished-flights-are-archived-after-twelve-hours.md`.

Changed: `archiver.js` (constant + comments), `app/archive.js` comment, `efsp/index.js` (`archiveRetentionMs` -> `Archiver.retentionMs`),
`app.js` (`deps.archiveRetentionMs`, soak only), `tools/soak/retention.js` (new: 2 h soak retention, `CRCSYNC_SOAK_RETENTION_MIN`),
`host-core.js`, `run.js` (`--retention-min`), `report.js` (`memoryPolicy({ retentionMin })`, report line "soak retention 2 h (production 12 h)",
`memory.retention`). Tests: `efsp-archiver` (12 h, new 1b 8 h/12 h test, offsets 3 h -> 13 h), `soak-memory-policy`, freeze trace waits
12 h + 1 s (golden `hub-monitors.json` regenerated, times and one correlation hash only). CLAUDE.md soak paragraph, usage guide (3 places + §8J), briefing (4 places) edited.

## Defaults taken
- P2: soak keeps 2 h through an explicit host-side `retentionMs`, printed in the report; `--retention-min` overrides.
- Retention reaches the forked host by environment variable, not argv.
- Memory estimate in the ADR: 26-37 KB/Strip at ~42/h gives 13-19 MB at soak rate; the scaling cost is the whole-snapshot `_persist`.

## Findings
- No crc-desktop client text or constant mentions the archive window; nothing changed there.
- `docs/wip/SOAK.md`/`SOAKW.md` and ADR 0082 still say 2 h (history; not edited).
- Usage guide row "Instrumentation and archiving ... tunable in config" was already inaccurate for the archive constant (it is a constant); left.
- The production 12 h constant is exercised by no soak run; only the unit tests pin it.
