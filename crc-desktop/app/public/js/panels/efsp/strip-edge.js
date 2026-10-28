'use strict';
import { OBLIGATION_LABELS } from './control-release-rules.js';

// What the Strip's left edge is saying (H168). The edge is a border, and seven
// classes paint it; a controller saw a bright yellow bar (their own Highlight)
// and nothing said what it was. The answer is a tooltip on a narrow hit area
// over the edge (bay/strip-element.js's _appendEdgeTip): nothing new is drawn.
//
// EDGE_PRECEDENCE is the CSS cascade of efsp-panel.css, highest first: the
// alert edge is `.efsp-strip.efsp-strip-alert` (two classes, wins over all);
// the others are one class each, so the later rule wins (MARSA voided, MARSA
// armed, contact lost, obligation overdue, obligation due), and the Highlight
// colour is the base `.efsp-strip` rule's `var(--efsp-highlight)`, which any
// of them replaces. tests/efsp-strip-edge.test.mjs reads the stylesheet and
// holds this order to it.
export const EDGE_PRECEDENCE = [
  'efsp-strip-alert',
  'efsp-strip-marsa-voided',
  'efsp-strip-marsa-armed',
  'efsp-strip-correlation-warned',
  'efsp-strip-obligation-overdue',
  'efsp-strip-obligation-due',
  'highlight',
];

function _sentence(s) {
  const t = String(s || '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
}

function _obligationText(obligation, overdue) {
  const named = obligation && OBLIGATION_LABELS[obligation.obligationType];
  const what = named ? named.label : obligation ? obligation.obligationType.replace(/_/g, ' ') : 'forwarding obligation';
  const head = overdue ? `Obligation overdue: ${what}.` : `Obligation due: ${what}.`;
  return `${head} ${named ? _sentence(named.title) : 'Do what the chip on the Strip names; the edge clears when it is done.'}`;
}

/**
 * The markers on a Strip's left edge, the one actually drawn first.
 *
 * @param {object} p
 * @param {Iterable<string>} p.classes — the Strip element's classes (what the CSS sees)
 * @param {string|null} [p.highlight] — strip.flags.highlight
 * @param {{obligationType:string, severity:string}|null} [p.obligation]
 * @param {string} [p.marsaTitle] — marsaBadgeFor(strip).title
 * @param {string} [p.correlationTitle] — correlationBadgeFor(strip).title
 * @param {string[]} [p.alertReasons] — the 'bad' alerts' reason lines
 * @returns {{key:string, text:string}[]}
 */
export function stripEdgeMarkers({ classes, highlight = null, obligation = null, marsaTitle = '', correlationTitle = '', alertReasons = [] }) {
  const has = new Set(classes || []);
  const out = [];
  for (const key of EDGE_PRECEDENCE) {
    if (key === 'highlight') {
      if (highlight) out.push({ key, text: `Highlight: ${highlight} (your marker). Right-click to change, Ctrl+click cycles (yellow, cyan, lime, off).` });
      continue;
    }
    if (!has.has(key)) continue;
    // The overdue Strip carries both obligation classes; it is one marker.
    if (key === 'efsp-strip-obligation-due' && has.has('efsp-strip-obligation-overdue')) continue;
    if (key === 'efsp-strip-alert') {
      const why = alertReasons.map(_sentence).filter(Boolean).join(' ');
      out.push({ key, text: `Alert: ${why || 'see the warning on the Strip.'} The edge clears by itself when the condition does.` });
    } else if (key === 'efsp-strip-marsa-voided') {
      out.push({ key, text: `MARSA voided: ${_sentence(marsaTitle) || 'ATC is separating these aircraft again.'} Press Acknowledge on the Strip.` });
    } else if (key === 'efsp-strip-marsa-armed') {
      out.push({ key, text: `MARSA armed: ${_sentence(marsaTitle) || 'assigning a heading or altitude before rendezvous voids it.'}` });
    } else if (key === 'efsp-strip-correlation-warned') {
      out.push({ key, text: `Contact lost: ${_sentence(correlationTitle) || 'no surveillance contact matches this flight.'} Find the aircraft and bind it, or check its code.` });
    } else {
      out.push({ key, text: _obligationText(obligation, key === 'efsp-strip-obligation-overdue') });
    }
  }
  return out;
}

/** The tooltip: the drawn marker, then the others under "Also:". Empty when the edge shows nothing. */
export function stripEdgeTitle(markers) {
  if (!markers.length) return '';
  const [drawn, ...rest] = markers;
  return rest.length ? `${drawn.text}\nAlso:\n${rest.map(m => `- ${m.text}`).join('\n')}` : drawn.text;
}
