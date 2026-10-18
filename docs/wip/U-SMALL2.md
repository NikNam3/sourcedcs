# U-SMALL2: lxsrs copies test, soak leak case (S-ARCH-71)

Branch `lane/U-SMALL2`, cut from `efsp-wp5-correlation` at `b46bfab6`. No ADR. Commits `dc10c201` (item 1),
`692512ad` (supervisor's wip checkpoint of item 2), `694aa04c` (item 2, finished).

## 1. A Node test diffing the two `lxsrs_v2` copies

`crc-desktop/tests/lxsrs-copies-identical.test.mjs` (ESM, picked up by `npm test`'s `tests/*.test.{js,mjs}` glob and
the sharded runner): walks `lxsrs_v2/lxsrs_v2/` and `crc-desktop/python-pkg/lxsrs_v2/`, ignores `__pycache__`/`.pyc`,
and fails naming every file present in only one copy or with different bytes. No python/pip, so it runs on the
windows release leg too. 2 tests, both pass.

**`check-lxsrs-sync.sh` stays** (default taken). It checks something the Node test does not: it pip-installs
`lxsrs_v2` into a scratch dir and diffs that, so it also catches a packaging change (a file the build would add or
leave out) that a plain tree diff cannot. It stays manual (needs bash/python3/pip3).

**For the docs pass:** `crc-desktop/README.md` line 111 says neither script is wired into CI or `npm test`; the
copies are now checked by `npm test` (this test), so that sentence should say the Node test is the automated gate and
`check-lxsrs-sync.sh` the deeper manual check.

## 2. The soak leak case

**R² was the wrong test; a longer case was not needed.** Measured on seeds 1-30, smoke, 20 min, `--restarts 0`,
`--judge-memory`:

- The clean run (no leak) already fails `memory.slope` on 29 of 30 seeds: the heap is still filling at 20 minutes,
  from 0.97 MB/h (seed 30) to 21.8 MB/h (seed 8). Shortening the retention (`--retention-min 2`, with or without
  `--warmup-min 8`) does not remove it (seeds 1, 4, 8 still 14-20 MB/h), so the fill is the traffic, not retention.
- R² measures how straight the line is, not the leak: the leak run reads 0.822 (seed 15) to 0.997, and a clean run
  can read 0.99 (seed 8) with no leak at all. "memory FAIL with R² > 0.9" could neither prove nor disprove the
  detector, and fails on seeds 15, 25, 26, 30.
- What is stable is the difference: leak slope minus clean-twin slope is 14.89-15.23 MB/h on all 30 seeds (the
  injected rate is 256 KB/min = 15 MB/h).

So the leak case now runs a **clean twin** (same seed and flags, no `--inject`) and passes when the leak run fails
`memory.slope` **and** adds 15 MB/h ± 20% over the twin. A silent detector (or a leak lever that does not leak)
reads ≈ 0 added.

Fixed in the wip checkpoint: it had `if (inject.leakFrom === null || true) return;` in `host-core.js tickLeak`, a
debugging leftover that disabled the injected leak; removed.

Kept from the wip checkpoint: `--no-flush-bytecode` on the forked soak host (`host-client.js`). Measured without
it, seed 3's leak run read 9.59 MB/h one time and 19.67 the next (V8 drops idle functions' bytecode on a wall-time
schedule, about 2 MB at a random point of the run); with it, repeats agree within 0.25 MB/h. It applies to every soak
run, including the 4-hour one; bytecode is a bounded one-off, not a slope.

**Runtime:** the selfcheck is now seven runs (the twin added), run concurrently instead of one after another:
15-22 s wall across seeds on this 22-core machine (seed 7: 15 s). The same seven runs serially take 74 s (the old
five-run serial selfcheck was about 53 s). On a machine with few cores the concurrent runs approach the serial time.
`--seed n` picks the seed (`npm run soak:selfcheck -- --seed 15`); default 7.

**Proof across seeds:** `soak:selfcheck` on seeds 1-30: the leak case passes on all 30.

## Finding for another lane: `skip-shadow-client` is seed-fragile

The selfcheck **fails on seeds 15, 16, 23, 26** (26 of 30 pass; seed 7, the default, passes), always the same
case: `skip-shadow-client  dropped 1, silentStaleness (not H1) = 0`. Pre-existing: seed 15 fails the same way without
this lane's harness change. The drop does land (`broadcastMissing` is counted), but on seed 15 it is a `gone` for a
Strip being dropped (`DropStrip`, t=187.8 s), and by the next minute checkpoint the shadow no longer holds that Strip
either (instrumented run: shadow `HANDED_OFF` at 180 s, absent at 240 s), so there is nothing stale to find. The
case picks the first eligible `gone` after 3 minutes; it should pick a delta whose loss cannot be repaired by a later
one (an `updated` Strip that stays live, or a `gone` checked before the next delta for that Strip), in
`tools/soak/driver.js` near line 201. Not fixed here (not this lane's item; `driver.js` untouched).

## Defaults taken

- `check-lxsrs-sync.sh` kept as the deeper manual check (above).
- Leak tolerance 20% (observed spread ±1.6%).
- Concurrent selfcheck runs (no `--serial` switch).

## Gates (on `694aa04c`)

crc-sync `npm test` 2809/2809; crc-desktop `npm test` 1378/1378 (1376 + the 2 new); `npm run walk` 24/24;
`npm run freeze` 57/57; `soak:selfcheck` PASS on seeds 1-14, 17-22, 24, 25, 27-30, FAIL only on
`skip-shadow-client` for 15, 16, 23, 26 (above). Wire unchanged (harness only).
