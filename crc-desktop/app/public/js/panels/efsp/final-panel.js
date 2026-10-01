'use strict';

// The FINAL component, shared by PAR and the carrier Final lane (EFSPImplementationGuide.md §7.10,
// docs/adr/0075, built on docs/adr/0064's Role FINAL).
//
// "PAR and the carrier Final controller are the same job." The controller is talking continuously, so
// the Strip is minimal and glanceable and MUST NOT need data entry during the approach. Everything
// here is therefore derived from a sample the caller hands in; there is not one input element, and
// a test asserts that on the rendered tree.
//
// WHAT THE CADENCE BAR IS, AND IS NOT. A talk-down call is voice, which this panel cannot observe, and
// a tap per call would be the data entry §7.10 forbids. So the bar is a free-running 5 s metronome off
// the injected mission clock (H11: never Date.now()), a cue for the rhythm. The calls that are
// REQUIRED (every mile, glidepath interception, decision altitude, trend deviation) are prompted from
// the track's own movement, and clear themselves.
//
// THE TERMINAL EVENT. ADR 0064 left PAR's terminal state to L18: reuse the FINAL Role's own states
// under neutral labels rather than add a state (nla.js is L17's). "Ball" and "Landing assured" both
// end the talk-down and go to BALL; "Waveoff" and "Missed approach" both go to BOLTER_WAVEOFF.
//
// Pure model first, renderer second, so the model is unit-testable with no DOM and the renderer with
// the stub in tests/helpers/dom-stub.js.

const FINAL_CADENCE_S = 5;           // §7.10: "approximately every 5 seconds"
const FINAL_PROMPT_HOLD_S = 4;       // a due call stays on screen this long, then clears itself
const FINAL_GLIDEPATH_TOL_DEG = 0.3; // [SOURCE-DEFINED] inside this is "on glidepath"
const FINAL_TREND_STEP_DEG = 0.1;    // [SOURCE-DEFINED] drifting further out by this much between samples is a trend

// Highest priority first: when two fall due in one sample the controller sees the more urgent one.
const FINAL_CALL_PRIORITY = ['DECISION_ALTITUDE', 'TREND_DEVIATION', 'GLIDEPATH_INTERCEPT', 'MILE'];

const FINAL_TERMINALS = {
  PAR: [
    { id: 'ASSURED', label: 'Landing assured', toState: 'BALL' },
    { id: 'MISSED', label: 'Missed approach', toState: 'BOLTER_WAVEOFF' },
  ],
  CARRIER: [
    { id: 'BALL', label: 'Ball', toState: 'BALL' },
    { id: 'WAVEOFF', label: 'Waveoff', toState: 'BOLTER_WAVEOFF' },
  ],
};

const _fpFinite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Required calls that fall due between two samples.
 *
 * Both samples are `{ distanceNm, altitudeFt?, glidepathDevDeg? }` (deviation positive = above the
 * glidepath). With no previous sample nothing is due: a call is a crossing, and one sample has not
 * crossed anything. A missing field means its call cannot fall due, never that it did.
 *
 * @returns {Array<{kind: string, miles?: number}>} in FINAL_CALL_PRIORITY order
 */
function finalCallsDue(prev, cur, opts = {}) {
  if (!prev || !cur) return [];
  const tol = _fpFinite(opts.glidepathTolDeg) ? opts.glidepathTolDeg : FINAL_GLIDEPATH_TOL_DEG;
  const step = _fpFinite(opts.trendStepDeg) ? opts.trendStepDeg : FINAL_TREND_STEP_DEG;
  const due = [];

  if (_fpFinite(cur.altitudeFt) && _fpFinite(prev.altitudeFt) && _fpFinite(opts.decisionAltFt)
      && prev.altitudeFt > opts.decisionAltFt && cur.altitudeFt <= opts.decisionAltFt) {
    due.push({ kind: 'DECISION_ALTITUDE' });
  }
  if (_fpFinite(cur.glidepathDevDeg) && _fpFinite(prev.glidepathDevDeg)) {
    const was = Math.abs(prev.glidepathDevDeg);
    const now = Math.abs(cur.glidepathDevDeg);
    if (now > tol && now >= was + step) due.push({ kind: 'TREND_DEVIATION' });
    if (was > tol && now <= tol) due.push({ kind: 'GLIDEPATH_INTERCEPT' });
  }
  if (_fpFinite(cur.distanceNm) && _fpFinite(prev.distanceNm)) {
    const crossed = Math.floor(prev.distanceNm);
    if (crossed >= 1 && Math.floor(cur.distanceNm) < crossed) due.push({ kind: 'MILE', miles: crossed });
  }
  return due.sort((a, b) => FINAL_CALL_PRIORITY.indexOf(a.kind) - FINAL_CALL_PRIORITY.indexOf(b.kind));
}

function promptText(call) {
  switch (call.kind) {
    case 'DECISION_ALTITUDE': return 'DECISION ALTITUDE';
    case 'TREND_DEVIATION': return 'Trend: deviating';
    case 'GLIDEPATH_INTERCEPT': return 'Glidepath: intercepting';
    case 'MILE': return `Mile call: ${call.miles} ${call.miles === 1 ? 'mile' : 'miles'}`;
    default: return call.kind;
  }
}

function formatDistance(nm) {
  return _fpFinite(nm) ? `${Math.max(0, nm).toFixed(1)} nm` : '--';
}

function formatDeviation(dev, tol = FINAL_GLIDEPATH_TOL_DEG) {
  if (!_fpFinite(dev)) return '--';
  const mag = Math.abs(dev).toFixed(1);
  if (Math.abs(dev) <= tol) return `ON (${dev >= 0 ? '+' : '-'}${mag}°)`;
  return `${dev > 0 ? 'ABOVE' : 'BELOW'} ${mag}°`;
}

/**
 * Seconds from the cadence origin to the next 5 s beat, and how far through the beat we are.
 * Both read the injected mission clock; a clock that has not started gives a stalled bar, not NaN.
 */
function cadenceAt(nowS, originS) {
  if (!_fpFinite(nowS)) return { phase: 0, nextInS: FINAL_CADENCE_S };
  const t = _fpFinite(originS) ? nowS - originS : nowS;
  const into = ((t % FINAL_CADENCE_S) + FINAL_CADENCE_S) % FINAL_CADENCE_S;
  return { phase: into / FINAL_CADENCE_S, nextInS: FINAL_CADENCE_S - into };
}

/** The two terminal actions for a kind ('PAR' | 'CARRIER'), as plain data. */
function terminalActionsFor(kind) {
  return (FINAL_TERMINALS[kind] || FINAL_TERMINALS.PAR).map(a => ({ ...a }));
}

/**
 * Holds the one piece of state the component has: the previous sample and the prompt on screen.
 * `update(sample)` is the whole interface; it returns the view model.
 *
 * sample: { kind, callsign, stripId, runway, decisionAltFt, distanceNm, altitudeFt?,
 *           glidepathDevDeg?, nowS, cadenceOriginS? }
 */
function createFinalTracker(opts = {}) {
  let prev = null;
  let prompt = null; // { kind, text, untilS }
  return {
    update(sample) {
      const s = sample || {};
      const calls = finalCallsDue(prev, s, { ...opts, decisionAltFt: s.decisionAltFt });
      if (calls.length && _fpFinite(s.nowS)) {
        prompt = { kind: calls[0].kind, text: promptText(calls[0]), untilS: s.nowS + FINAL_PROMPT_HOLD_S };
      } else if (prompt && _fpFinite(s.nowS) && s.nowS >= prompt.untilS) {
        prompt = null;
      }
      prev = s;
      return finalViewModel(s, prompt);
    },
    reset() { prev = null; prompt = null; },
  };
}

function finalViewModel(sample, prompt) {
  const s = sample || {};
  const cad = cadenceAt(s.nowS, s.cadenceOriginS);
  return {
    kind: s.kind === 'CARRIER' ? 'CARRIER' : 'PAR',
    stripId: s.stripId || null,
    callsign: s.callsign || '',
    runway: s.runway || '--',
    decisionAlt: _fpFinite(s.decisionAltFt) ? Math.round(s.decisionAltFt).toLocaleString('en-US') : '--',
    distance: formatDistance(s.distanceNm),
    deviation: formatDeviation(s.glidepathDevDeg),
    cadencePhase: cad.phase,
    nextBeatInS: cad.nextInS,
    prompt: prompt ? { kind: prompt.kind, text: prompt.text } : null,
    terminals: terminalActionsFor(s.kind),
  };
}

function _fpEl(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Renders a view model. No input, select or textarea is ever created (§7.10). The only gestures are
 * the two terminal buttons; `onTerminal({ stripId, id, toState })` receives the tap.
 */
function renderFinalPanel(vm, { doc, onTerminal } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const root = _fpEl(d, 'div', 'efsp-final');
  const head = _fpEl(d, 'div', 'efsp-final-head');
  head.appendChild(_fpEl(d, 'b', '', vm.kind === 'CARRIER' ? 'FINAL' : 'PAR'));
  head.appendChild(_fpEl(d, 'span', 'efsp-final-callsign', vm.callsign));
  root.appendChild(head);

  const figs = _fpEl(d, 'div', 'efsp-final-figures');
  [[vm.kind === 'CARRIER' ? 'Deck' : 'Runway', vm.runway], ['Decision alt', vm.decisionAlt], ['To touchdown', vm.distance]]
    .forEach(([k, v]) => {
      const cell = _fpEl(d, 'div', 'efsp-final-cell');
      cell.appendChild(_fpEl(d, 'div', 'efsp-final-k', k));
      cell.appendChild(_fpEl(d, 'div', 'efsp-final-v', v));
      figs.appendChild(cell);
    });
  root.appendChild(figs);

  const dev = _fpEl(d, 'div', 'efsp-final-cell efsp-final-dev');
  dev.appendChild(_fpEl(d, 'div', 'efsp-final-k', 'Glidepath'));
  dev.appendChild(_fpEl(d, 'div', 'efsp-final-v efsp-final-dev-v', vm.deviation));
  root.appendChild(dev);

  const bar = _fpEl(d, 'div', 'efsp-final-cadence');
  const fill = _fpEl(d, 'i', 'efsp-final-cadence-fill');
  fill.style.width = `${Math.round(vm.cadencePhase * 100)}%`;
  bar.appendChild(fill);
  root.appendChild(bar);

  root.appendChild(_fpEl(d, 'div', vm.prompt ? 'efsp-final-prompt' : 'efsp-final-prompt efsp-final-prompt-none',
    vm.prompt ? vm.prompt.text : 'No call due'));

  const term = _fpEl(d, 'div', 'efsp-final-terminals');
  vm.terminals.forEach((a, i) => {
    const b = _fpEl(d, 'button', `efsp-final-terminal ${i === 0 ? 'efsp-final-ok' : 'efsp-final-go'}`, a.label);
    b.dataset.terminal = a.id;
    b.addEventListener('click', () => { if (onTerminal) onTerminal({ stripId: vm.stripId, id: a.id, toState: a.toState }); });
    term.appendChild(b);
  });
  root.appendChild(term);
  return root;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FINAL_CADENCE_S, FINAL_PROMPT_HOLD_S, FINAL_GLIDEPATH_TOL_DEG, FINAL_TREND_STEP_DEG,
    FINAL_CALL_PRIORITY, FINAL_TERMINALS,
    finalCallsDue, promptText, formatDistance, formatDeviation, cadenceAt,
    terminalActionsFor, createFinalTracker, finalViewModel, renderFinalPanel,
  };
}
