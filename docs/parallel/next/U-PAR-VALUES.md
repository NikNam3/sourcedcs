# Briefing: U-PAR-VALUES (server + client): the controller sets the PAR approach values, ADR 0130

Written 2026-10-17 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-PAR-VALUES`, branch `lane/U-PAR-VALUES`, `E2E_LANE=7`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0130** (yours).

Running beside you: **U-CLOCK** (mission-clock, mission-session, grpc-client, feed-handlers, topbar clock),
**U-FREQ-EDITOR** (a frequency editor; may add a store), **U-SMALL2** (tests/soak only). Stay out of their files. If you
add a synced store, `stores.js`, `app.js`, `ws-hub.js` and the wire record will conflict with U-FREQ-EDITOR: keep your
hunks small and self-contained; the supervisor merges and re-runs `wire:record`.

## Why

**H153** (read it in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`): *"there is not one number
depending on the situation and weather the controller wants freedom here"*. The PAR approach's TDZE, threshold crossing
height, decision height / DA and glidepath angle become **controller-set at run time**; `config/par.json` and the
Incirlik facility's PAR approaches (`efsp-facility-incirlik.json`, the `[SOURCE-DEFINED]` block) stay the defaults. No
LTAG plate is owed any more. Also ADR 0112, 0116, 0117, 0123 (PAR), H116 (today's per-controller default glidepath),
H128 (FAA model: cite JO 7110.65 Ch. 5 Sec. 12 where it bears on who sets what), dark cockpit H115–H119.

## Design questions (take the recommended default, log it, P2)

1. **Where the values live.** Recommended: **server-held per approach** (per runway end), so every PAR scope and
   `par-monitor.js` agree; set by the Position working the PAR (and AP, if the facility gives it the PAR); persisted
   under `state/` per mission or until reset? Recommended: kept until changed, a "reset to default" per value; the
   mission reset (ADR 0108) does not clear them (they are field data, not traffic). The H116 per-controller glidepath
   default: folded into the server value (one number per approach), or kept as the fallback for an approach with none:
   decide and argue.
2. **Which values.** TDZE, TCH, decision height (show DA = TDZE + DH), glidepath angle; threshold position and course
   only if cheap (recommended: not now; list it).
3. **UI.** On the PAR panel (where the controller works), grey, editable in place, a value that differs from the
   default marked as set (grey, not amber). Validation: sensible ranges (glidepath e.g. 2.5–3.5°, cite where a limit
   comes from or label it ours).
4. **Audit and wire.** Changes are audited (Mutation log, mission clock); wire through an existing family if one fits,
   else a small new one; `npm run wire:record`.

## Tests, gates

Unit tests for the store/op, rights, validation, monitor using the set value, persistence/restore, client model
(`par-model.js`). e2e: only PAR specs you change (`par-panel*`), `E2E_LANE=7`. Before the report: both unit suites,
`npm run walk`, `npm run freeze`, `soak:selfcheck` if Board/wire/hub moved, `wire:record`, module-graph fixture if
exports change.

## Output

Commits; ADR 0130; `docs/wip/U-PAR-VALUES.md` (guide wording, defaults taken, open questions for the human); final
message per rule 8.
