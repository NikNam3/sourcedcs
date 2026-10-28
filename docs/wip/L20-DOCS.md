# L20-DOCS wip

Report: see the lane's final message. Pointer check at close: every backticked file pointer in the seven docs resolves,
except (a) runtime state files and globs (`state/*.json`, `efsp-*.json*`, `config/efsp-facility-*.json`, `latest*.yml`,
`/js/config.js`), (b) history-section pointers kept with a bracketed current name (`clearance-migration.js`,
`theater-settings.js/.json`, `config/squawk-map.json`, `radar-specs.json`), (c) placeholders (`NNNN`, `<lane>`).

Defaults taken: briefing sections 3I/3J keep their dated pointers, with `[now ...]` brackets only where a symbol moved;
test counts are S-M-W7's, not re-measured; RUNBOOK gained a dated pre-deploy section (it had none for this release).
Findings: `efsp-briefing.md` table rows marked UI-B were not re-audited against UI-B's note; `permission.js` header still
says "no coordination primitives" (code comment, L20 code lanes).
