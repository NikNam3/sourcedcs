'use strict';
import { showConnWidget } from '../sync.js';
import { apiToIndicated } from '../altimetry.js';

// ── Tools tab: DCS altitude calculator ────────────────────────────────────
// Split out of the former ui.js "god file" (history).
//
// The barometric-pressure arithmetic is altimetry.js, a hand copy of crc-sync's. `indicatedToApi`'s
// bisection search has no app.js equivalent (nothing else in the app needs
// indicated→true altitude, only true→indicated for track display), so it
// stays local.

export function initToolsTab() {
  // Was a small floating "SYNC ⚙" tab pinned above the SRS radio bar
  // (removed; the Connection button now lives here) — both panels involved
  // are normal dockview panels rather than fixed-position divs with a
  // hand-tracked height relationship between them.
  const btnConn = document.getElementById('set-conn-settings');
  if (btnConn) btnConn.addEventListener('click', showConnWidget);

  const btnCalc = document.getElementById('tool-alt-calc');
  const result  = document.getElementById('tool-alt-result');

  const INHG_TO_PA = 3386.389;

  // bisect to find api altitude that yields the desired indicated altitude
  function indicatedToApi(indFt, seaPa, T0) {
    let lo = indFt - Math.max(2000, Math.abs(indFt) * 0.5);
    let hi = indFt + Math.max(2000, Math.abs(indFt) * 0.5);
    let fLo = apiToIndicated(lo, seaPa, T0) - indFt;
    let fHi = apiToIndicated(hi, seaPa, T0) - indFt;
    for (let i = 0; i < 20 && fLo * fHi > 0; i++) {
      lo -= 5000; hi += 5000;
      fLo = apiToIndicated(lo, seaPa, T0) - indFt;
      fHi = apiToIndicated(hi, seaPa, T0) - indFt;
    }
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      const fMid = apiToIndicated(mid, seaPa, T0) - indFt;
      if (Math.abs(fMid) < 0.001) return mid;
      if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return 0.5 * (lo + hi);
  }

  function calculate() {
    const tempC = parseFloat(document.getElementById('tool-alt-temp').value);
    const qnhInhg = parseFloat(document.getElementById('tool-alt-qnh').value);
    const indFt = parseFloat(document.getElementById('tool-alt-ind').value);
    if (isNaN(tempC) || isNaN(qnhInhg) || isNaN(indFt)) {
      result.textContent = 'ERR';
      return;
    }
    const T0 = tempC + 273.15;
    const seaPa = qnhInhg * INHG_TO_PA;
    const apiFt = indicatedToApi(indFt, seaPa, T0);
    result.textContent = Math.round(apiFt).toLocaleString() + ' ft';
  }

  btnCalc.addEventListener('click', calculate);
  document.getElementById('tool-alt-ind').addEventListener('keydown', e => {
    if (e.key === 'Enter') calculate();
  });
}
