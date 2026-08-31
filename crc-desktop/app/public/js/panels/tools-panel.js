'use strict';

// ── Tools tab: DCS altitude calculator ────────────────────────────────────
// Split out of the former ui.js "god file" — see panels/topbar.js for why
// this stays a plain script rather than an IIFE.
//
// The barometric-pressure formula here used to be a second, hand-copied
// implementation of app.js's `_pressureAtAlt` (with a comment admitting it
// "must mirror app.js"). It now calls app.js's actual `_pressureAtAlt` and
// its `ISA_L`/`ISA_INV`/`T_REF_ALT` constants directly — both are plain
// top-level declarations in a classic (non-module) script, so they're
// already visible here without any explicit export. `indicatedToApi`'s
// bisection search has no app.js equivalent (nothing else in the app needs
// indicated→true altitude, only true→indicated for track display), so it
// stays local.

function initToolsTab() {
  // Was a small floating "SYNC ⚙" tab pinned above the SRS radio bar
  // (sync.js's _initConnTab) — moved here now that both panels involved
  // are normal dockview panels rather than fixed-position divs with a
  // hand-tracked height relationship between them.
  const btnConn = document.getElementById('set-conn-settings');
  if (btnConn) btnConn.addEventListener('click', showConnWidget);

  const btnCalc = document.getElementById('tool-alt-calc');
  const result  = document.getElementById('tool-alt-result');

  const INHG_TO_PA = 3386.389;
  const FT_TO_M = 0.3048;

  // api altitude (ft) -> indicated altitude (ft) for given conditions
  function apiToIndicated(apiFt, seaPa, T0) {
    const P = _pressureAtAlt(apiFt * FT_TO_M, seaPa, T0);
    return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / seaPa, ISA_INV))) / FT_TO_M;
  }

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
