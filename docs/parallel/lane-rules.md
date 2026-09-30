# Rules every lane agent follows (wave 2 onward)

1. Work ONLY in your own worktree `/home/nklx/dev/personal/sourcedcs-<LANE>` on branch `lane/<LANE>-…`
   (already created, cut from `efsp-wp5-correlation` after the wave-1 merge). Use absolute paths
   under it and `cd` into it for every command. The main checkout `/home/nklx/dev/personal/sourcedcs`
   is read-only for you, except that you READ `docs/parallel/decisions.md` there by absolute path
   (it changes mid-wave; it overrides your briefing; re-read it whenever the supervisor says so).
2. Never touch the crc-sync on :3000 (the human's live testing). **Never stop processes by pattern
   (`pkill -f`, `killall`)**: stop only processes you started, by PID (P7).
3. Never edit shared docs (`docs/efsp-briefing.md`, `docs/efsp-usage-guide.md`, `CLAUDE.md`, READMEs)
   unless your briefing says you own them. Write `docs/wip/<LANE>.md` instead: what the guide/briefing
   should say, defaults taken, walks not done, findings for other lanes.
4. Commit on your own branch only, each message ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge, rebase or push.
   **Commit often: at every green step, and at least every ~15 minutes of work.** If the work isn't
   green yet, make a checkpoint commit titled `wip(<LANE>): …` rather than carry an hour of edits
   uncommitted; a network or machine loss must never cost more than a few minutes. (The supervisor
   also snapshots every worktree every 10 min into `refs/checkpoints/<branch>`, but that is a safety
   net, not a substitute.)
5. ADRs are never edited once committed (P4); take only the ADR number you were given. Tuning files
   are read once at startup and never written by code (P5). No backwards compatibility. EFSP times
   come from the injected mission clock, never `Date.now()` (H11). Headings are magnetic (H15, H69).
6. P2: on an unanswered question take your briefing's recommended default, log it under "Defaults
   taken" in `docs/wip/<LANE>.md`, and carry on. Stop only if the default could destroy work or cross
   another lane's files; then SendMessage "main" briefly and continue with other work.
7. Only your assigned `E2E_LANE` number (if any). Install first:
   `(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)` as needed.
8. Final message = your report: branch + commit range, test counts before/after, ADR, wip summary,
   defaults taken, findings for other lanes, anything the supervisor must decide.
