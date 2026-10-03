# DESK-RENDER

## Code as found
- B7: `bay-view.js` `_stripRenderSignature` (l.532-612) is a hand-kept list of `parts`. The alert chips from
  `strip-view.js` `_stripAlerts` are only partly covered: `alr:` (conformance + conflict) and `fld:` (runway). The
  SCRAMBLE chip on other Strips' ground traffic (`scrambleAlertsFor`, reads all live Strips) and the TOFI regime chip
  (`tofiRegimeAlertForFlightData`) are not in it. `_stripAlerts` is not exported.
- B8: `srs-radio.js:418-425`: keydown ignored while `_isTyping()`, keyup likewise; no blur/visibility handling, no
  max transmit time; the 400 ms `/ptt/start` re-send runs until a keyup.
- B9: `undo-slot.js` `_render()` does `replaceChildren()` and builds a new button on every 250 ms tick;
  `airspace-panel.js` rebuilds every card on any update (Delay note text lost).
- `tofi-regime.spec.js:60` screenshot path in a session scratchpad.
