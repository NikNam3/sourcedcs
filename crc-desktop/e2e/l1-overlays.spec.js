'use strict';

/* The two window-level overlays: what they say, and whether it can be read.
 *
 * F-106 in docs/ui-findings/lane1.md, fixed — both messages now measure over
 * 4.5:1 and these are ordinary passing tests.
 *
 * Scope was walked too and is NOT a finding: #no-awacs-overlay is adopted into
 * #map (dock.js) and covers only the map; #disc-overlay covers the whole
 * window, but crc-sync only reports gRPC `disconnected` before its first
 * report or on a proto-load failure — a live crc-sync with DCS down reports
 * `reconnecting`, which does not show it. In practice it appears when the
 * crc-sync socket itself closes (app.js ws.onclose), when the Strip panel is
 * dead too, so covering everything is defensible.
 */

const { test, expect } = require('@playwright/test');
const { openPanel } = require('./helpers/app');

/** WCAG 2 contrast ratio of an element's text against its own (composited-on-black) background. */
async function contrastOf(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const rgba = (s) => s.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const cs = getComputedStyle(el);
    const [fr, fg, fb] = rgba(cs.color);
    const [br, bg, bb, ba = 1] = rgba(cs.backgroundColor);
    // Composited over black: the overlay behind it is itself rgba(0,0,0,.5)
    // over a dark UI, so black is the kindest assumption, not the harshest.
    const back = [br * ba, bg * ba, bb * ba];
    const [a, b] = [lum([fr, fg, fb]), lum(back)].sort((x, y) => y - x);
    return { ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, color: cs.color, background: cs.backgroundColor, text: el.textContent.trim() };
  });
}

for (const [selector, what] of [['#disc-msg', 'the disconnect message'], ['#no-awacs-msg', 'the no-coverage message']]) {
  test(`${what} is legible — at least 4.5:1`, async ({ page }) => {
    await openPanel(page, { held: ['OPS'] });
    const c = await contrastOf(page, selector);
    console.log(`${selector}: ${JSON.stringify(c)}`);
    expect(c.ratio, `${what} "${c.text}" is ${c.color} on ${c.background}`).toBeGreaterThanOrEqual(4.5);
  });
}
