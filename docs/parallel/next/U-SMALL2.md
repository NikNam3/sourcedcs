# Briefing: U-SMALL2 (tests + soak): two small items

Written 2026-10-17 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-SMALL2`, branch `lane/U-SMALL2`, `E2E_LANE=3`, which you should not need).
**Commit at every green step; one commit per item.** No ADR number.

Running beside you: **U-CLOCK**, **U-PAR-VALUES**, **U-FREQ-EDITOR** (server + client code). You touch only the files
below; anything else goes in your wip note.

## Items

1. **A Node test diffing the two `lxsrs_v2` copies** (S-ARCH-71): `lxsrs_v2/lxsrs_v2/` and `crc-desktop/python-pkg/
   lxsrs_v2/` must be identical; today only the manual `check-lxsrs-sync.sh` checks. Add a test in
   `crc-desktop/tests/` (CommonJS or ESM like its neighbours; mind the sharded runner and `npm test`'s glob) that fails
   with the differing file names; decide whether `check-lxsrs-sync.sh` stays (say so).
2. **A longer soak leak case** (S-ARCH-71): the selfcheck `leak` case reads R² 0.986 on seed 7 with `--restarts 0`,
   but other seeds can read < 0.9. Make the leak detector's selfcheck robust across seeds (a longer leak case, or a
   detector fix if R² is the wrong test: find out which, `crc-sync/tools/soak/`, `docs/wip/SOAK.md`, `SOAKW.md`), and
   prove it on several seeds. Keep `soak:selfcheck` under about a minute if you can; say what it costs.

## Gates

Both unit suites, `soak:selfcheck` (several seeds for item 2), `npm run walk` and `npm run freeze` once. Output:
`docs/wip/U-SMALL2.md`; final message per rule 8.
