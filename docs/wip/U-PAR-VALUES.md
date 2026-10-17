# U-PAR-VALUES: lane notes (ADR 0130, decisions H153)

## What was built

- crc-sync: `SetParApproach` on `efsp-runway-status-mutation` (`runway-status-store.js`), values on the runway-status record as
  `parValues: { [runwayEnd]: { tdzeFt?, tchFt?, dhFt?, gpaDeg? } }`; owner PAR (`incirlik-military.js`, `receivesFinal`);
  ranges `surveillance/par.js` `PAR_VALUE_LIMITS` / `validateParValue`; `par-monitor.js` measures against the values in force
  (`parValuesOf`, wired in `src/app/monitors.js`); sample `approach` gains `defaults` and `set`, loses `gpaPublished`;
  `stores.js` persisted shape knows `parValues`; mission reset keeps them; restore drops stale ends / out-of-range values, an
  unknown field stops start-up. Wire surface recorded.
- crc-desktop: PAR panel header TDZE / TCH / DH / GPA editable in place, DA derived; set values marked grey; `parGpa` setting,
  `effectiveGpa` and `replot` removed; `RUNWAY_STATUS_ACTION_OWNERS.SetParApproach` mirrored; `PAR_VALUE_LIMITS` parity test.
- Tests: crc-sync `tests/efsp-par-values.test.mjs` (7), `par-monitor.test.mjs` (+3, one changed), l18 config test (PAR may
  set its values); crc-desktop `par-panel.test.mjs` (model, parse, limits parity, cells); e2e `par-panel.spec.js` 01 updated, 04
  rewritten (set / invalid / marked / Escape / Default / Settings tab of four).

## What the usage guide should say (PAR section)

> **Approach values.** The PAR panel's header shows the approach you are working: TDZE, TCH, DH and GPA, then DA (TDZE + DH).
> They start as the field's defaults. To change one, click it, type the value and press Enter; an empty field or **Default**
> puts the default back, Escape leaves it as it was. The value is held by the server for that runway end, so every PAR scope and
> the PAR sample use the same numbers, and it stays until someone changes it (a new mission keeps it). A value you set is
> underlined with a small mark; its tooltip shows the default. Ranges: TDZE −1,500 to 15,000 ft, TCH 0 to 200 ft, DH 100 to
> 1,000 ft, GPA 2.5° to 3.5°. Only the PAR Position sets them. The 0.5° lower safe limit follows the angle you set; the
> obstacle clearance it stands for was surveyed for the published angle.

The Settings → PAR tab now has four settings (Autoscale, the two elevation tolerances, the azimuth tolerance): the "Default
glideslope" setting is gone (H116 folded into the approach value).

Briefing (§ PAR): remove the "LTAG PAR plate owed" item (H153); the Incirlik `parApproaches` `[SOURCE-DEFINED]` values are now
defaults only.

## Defaults taken (P2)

1. **Where the values live:** server-held per runway end, on the runway-status record (no new store; keeps U-FREQ-EDITOR's
   `stores.js`/`app.js`/`ws-hub.js` free of my hunks except one key in the persisted shape and one line in `monitors.js`).
2. **Lifetime:** kept until changed, "Default" per value; the mission reset keeps them.
3. **H116 per-controller default glideslope:** folded into the server value and the setting removed (argued in ADR 0130 §8).
   The supervisor may want the human to confirm this one (it removes a setting H116 created).
4. **Which values:** TDZE, TCH, DH, GPA; DA shown. Threshold position and course: not now.
5. **Ranges, all ours:** TDZE −1,500..15,000 ft, TCH 0..200 ft, DH 100..1,000 ft, GPA 2.5..3.5°. DH's floor (100) is above the
   Facility schema's 50; GPA's band is narrower than the schema's 2..4.5. A Facility default outside the typed range still
   works (it is never validated against the typed range).
6. **Who:** PAR only (the `receivesFinal` Position); AP working the PAR holds PAR's hat.
7. **No baseRev from the client:** last write wins per value.
8. **Restore:** an unknown field stops start-up (H88); a stale end or an out-of-range value is dropped with a warning.
9. **UI marks:** dotted underline and a small grey superscript dot for a set value; invalid input keeps the field open with the
   range in the grey message line.

## Open questions for the human

- **Set before the first aircraft?** The header (and so the editor) exists only while a flight is on the panel. Setting values
  with an empty final needs the defaults on the client without a sample (the DCS TDZE and `par.json`'s angle are server-side):
  a small addition (the record could carry resolved defaults), not built.
- **The lower safe limit and a changed angle.** 8200.1D's 0.5° B cursor is a surveyed surface below the commissioned angle; a
  controller-set angle moves the red line with it. Keep (freedom, H153), or keep the lower limit tied to the default angle?
- **Threshold position and course** settable too? (Not now.)
- **Who else:** should AP (or OPS) also set them when PAR is unstaffed and nobody holds its hat?

## Not walked / findings

- `par-panel` **06** fails on lane 7 (the panel does not empty after sign-off); S-ARCH-68 saw 06/07 fail on lane 7 at that
  lane's base too, so it is not from this lane (not re-checked at this base). 01–05 and 07 pass.
- The sample is measured on a new DCS fix only: after a value changes, the plot on screen is re-measured on the next fix
  (≤ 1 s with DCS moving), not at once. The header shows the new value on the next sample (≤ 500 ms).
- Soak: the soak driver never sends `SetParApproach` (not needed; it is a runway-status op with no Board effect).
