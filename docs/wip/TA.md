# Lane TA: per-theater transition altitude

Branch `lane/TA-transition-altitude`. No ADR taken (0092 unused): it applies the already-decided ADR 0085 / H62
setting to the places that still hard-coded 18,000.

## What changed
- crc-sync `FdrStore` takes `transitionAltFt: () => number` beside `clock` (`createEfsp({ clock, transitionAltFt })`,
  `server.js` passes `() => theaterContext.transitionAltFt()`). It is read when a block's text is written, so a
  mission/theater change applies to the next entry. `formatAltitudeBlock(band, taFt)` and
  `normalizeMtrValue(path, value, nowMs, taFt)` take it explicitly; `BLOCK_FL_FROM_FT` is gone.
- Parsing needs no transition altitude: `FL100` is 10,000 ft and `100` is 10,000 ft in every theater. Stored values
  (`parsed`, `block`, `lowFt/highFt`) are feet; only the canonical text (`value`) changed.
- One constant, `DEFAULT_TRANSITION_ALT_FT` (18000) in `src/theaters.js`, used by `theater-context.js` (unlisted
  theater), `FdrStore` and `surveillance/index.js` (fixtures that inject nothing). `altimetry.indicatedAltFt` no longer
  has a default: callers must pass the theater's.
- crc-desktop already received `transitionAltFt` on the `theater` message (`app.js` sets `settings.transitionAltFt`).
  Removed the duplicate `?? 18000` / `|| 18000` fallbacks in `aprt-panel.js` (3), `track-label.js`, `strip-view.js`
  (one line). `app.js` keeps 18000 as the placeholder until the first `theater` message, now commented as such.

## Defaults taken
- Block text already stored on a Strip is not rewritten when the theater changes (an audit-style text, as typed/entered).
- Fixtures/tests that inject no theater get 18,000, the pre-H62 behaviour.
- Placeholder 18000 in `app.js` kept rather than null (a null would need every consumer to handle unknown).

## For the guide/briefing/CLAUDE.md (L20)
- Canonical block text switches to FL at the theater's transition altitude (Syria 10,000): `FL100-FL120`, `8000-FL100`.
  Single typed altitudes are stored as typed. The U6/ADR 0091 "fixed 18,000" note is superseded in behaviour.
- Remaining 18000 literals are config data (`theaters.json` for non-Syria theaters) and the placeholders above.

## Not done
- Entries already stored in a snapshot keep their old text. No e2e run.
