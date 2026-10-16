# U-SMALL: the small-items list (S-ARCH-69)

Branch `lane/U-SMALL`, cut from `efsp-wp5-correlation` at `d9faca35`. No ADR.

## 1. No station frequency hardcoded in the SRS bridge (H147 RQ5 / H149)

**What changed.** `lxsrs_v2/client.py` has no 251 MHz literal any more:

- `SRSClient.default_frequency_mhz` (new, optional): the frequency a radio added with **+ RADIO** tunes to, the one
  `cycle_modulation` gives a radio that has none yet, and the one a saved radio without `freq_mhz` loads with.
  Unset, the slot stays **untuned** (`UNTUNED_HZ = 1.0`, the same 1 Hz placeholder a DISABLED slot carries; it matches
  no station). The controller tunes it by clicking the frequency (the SRS panel already prompts empty for it).
- `python -m lxsrs_v2 --default-freq <MHz>` (new, optional) feeds it.
- crc-desktop: the bridge's command line moved from `main.js` into `lxsrs-setup.js` `lxsrsArgs(config)` (Electron-free,
  unit tested); it passes `--default-freq` only when `config.json` has `defaultFreq`. `config.json` gains
  `"defaultFreq": "251.000"` so behaviour is unchanged; every bridge frequency is now in `config.json`
  (`freqs`, `txFreq`, `defaultFreq`). `--tx-freq` is now also passed only when set.
- Both copies (`lxsrs_v2/lxsrs_v2/` and `crc-desktop/python-pkg/lxsrs_v2/`) re-vendored with
  `crc-desktop/scripts/sync-lxsrs.sh`; `check-lxsrs-sync.sh` reports OK. `direct_url.json` kept pointing at the main
  checkout (the script would have written the worktree path into it).

**Does anything check the two copies are identical?** Only `crc-desktop/scripts/check-lxsrs-sync.sh`, a manual
script: it is **not** wired into `npm test` or CI (the README says so: the Windows release leg has no guaranteed
bash/pip). Nothing automated stops drift. A Node test in `crc-desktop/tests` could diff the two trees' `*.py` files
without pip (finding, not done: it is outside this item's scope and would fail on every lxsrs edit that forgets the
re-vendor, which may be what the supervisor wants).

**Tests.** `lxsrs_v2/tests/test_default_frequency.py` (6: default applied, unset → untuned, cycle modulation, saved
state without a frequency, the CLI flag, and a scan of the package's `*.py` for a station literal);
`crc-desktop/tests/lxsrs-setup.test.js` +2 (`lxsrsArgs`; `config.json` names `defaultFreq` and `main.js` has no
frequency). pytest 63 → 69 (both copies).

**Frequency audit** (`command grep -rnE '2[0-9]{2}\.[0-9]{3}|[0-9]{3}_000_000'` over `crc-sync/src`,
`crc-desktop/app/public/js`, `lxsrs_v2`, plus `crc-desktop/main.js` and `lxsrs-setup.js`), after the change:

| Hit | What it is |
|---|---|
| `crc-sync/src/altimetry.js:15`, `crc-desktop/app/public/js/altimetry.js:12` | `ISA_R = 287.05287`, gas constant |
| `crc-sync/src/magnetic.js:52`, `crc-desktop/app/public/js/coords.js:107` | WGS-84 flattening `298.257223563` |
| `crc-sync/src/efsp/carrier/sun.js:20` | solar mean longitude `280.460` |
| `crc-sync/src/efsp/facility-schema.js:133` | comment: the UHF pool bounds 225.000–399.975 |
| `crc-sync/src/efsp/flight-data-store.js:1298` | comment: example "251.000" |
| `crc-desktop/app/public/js/panels/efsp/sfa-state.js:23` | JSDoc example `232.100` |
| `lxsrs_v2/lxsrs_v2/tests/*.py` | test fixtures |

No station frequency in code on the server, the client or the bridge. The values live in crc-sync
`config/comm-card.json`, the facility files and crc-desktop `config.json`.

**Docs pass.** `crc-desktop/README.md` "config.json fields" (a shared README, not edited here): add a row
``| `defaultFreq` | Frequency a radio added in the SRS panel tunes to; unset, it starts untuned |``.

## 2. Soak REFUSE memory (S-ARCH-67)

**Finding: a refused release request holds no memory of its own, and the R² drop was not caused by refusals.**

- Code: ControlRelease REFUSE (`board/handoff-control.js` `applyRelease`) only writes `coordination.releaseRequest`
  (`answer: 'REFUSED'`, `answeredAt`, `answeredBy`, `reason`) on the Strip. Nothing is keyed by the exchange elsewhere:
  the Board's applied-mutation cache and the hub replay cache (`sync/replay-cache.js`) are capped and hold every op the
  same; the ledger (`tools/soak/ledger.js`) tracks cmids, not exchanges. The record leaves with its Strip (archiver).
- Measured (smoke 20 min, `--inject leak --judge-memory`, three driver variants: **A** always GRANT as shipped,
  **B** always GRANT but with the `rng.chance(0.8)` draw the refusal needs, **C** REFUSE 20 %):

  | seed | A R² | B R² | C R² |
  |---|---|---|---|
  | 7 | 0.959 | **0.858** | **0.857** |
  | 8 | 0.991 | 0.996 | 0.996 |
  | 9 | 0.968 | 0.976 | 0.976 |
  | 11 | **0.786** | 0.972 | 0.971 |
  | 13 | 0.997 | 0.989 | 0.989 |

  B and C agree to the third decimal, with the same `strips.total` and slope: the extra RNG draw changes seed 7's whole
  traffic, refusing changes nothing measurable. A itself reads 0.786 on seed 11. Live Strips stay bounded in every
  variant (INCIRLIK end 3, CENTER end 2 on C-7): refused exchanges do not leave Strips live.
- Cause of the fragility: the smoke profile restarts the host, the fit keeps only the post-restart lifetime, which is
  about 7 heavy samples (min 11–20). Seven points of a 15 MB/h leak over DROPPED-Strip heap noise is marginal.

**What changed.** `tools/soak/traffic.js` `checkIn()` answers a release request GRANT 80 % / REFUSE 20 % again;
`tools/soak/selfcheck.mjs` runs the leak case with `--restarts 0` (11 heavy samples from min 5; seed 7 with REFUSE:
R² 0.985; across seeds 7–17 0.907–0.996, A on seed 13 0.779 is the one sub-0.9 read and that is the shipped
always-GRANT driver, so seeds other than 7 are still marginal: a longer leak case would make the proof robust, not
done since only seed 7 runs).
`soak:selfcheck` PASS (leak R² 0.985). `soak:smoke` (seed 1) PASS, 3 REFUSE and 23 GRANT applied (counted with a
temporary stderr line, removed). Freeze: the three `hub-random-seed*` goldens move (they replay the soak driver's seeded
traffic), `freeze:update` in its own commit, 57/57.

**Docs pass.** `CLAUDE.md` soak paragraph needs nothing. `docs/wip/U-RELEASE.md` finding is answered here.
