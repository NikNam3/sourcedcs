'use strict';

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const LONG_ROUTE = 'DCT KEMER DCT ERGEP/D1+00 ERGEP DCT KEMER DCT DAN DCT MANAZ DCT MUT DCT TARSU DCT LTAG';

test('probe', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('RTE');
  const strip = await seedStrip(page, { callsign, flightData: { route: LONG_ROUTE } });
  await page.screenshot({ path: test.info().outputPath('probe.png') });
  const info = await strip.evaluate((el) => [...el.querySelectorAll('.efsp-field')].map(f => {
    const r = f.getBoundingClientRect(); const b = f.querySelector('.efsp-block'); const br = b.getBoundingClientRect();
    return { id: b.dataset.block, x: Math.round(r.x), w: Math.round(r.width), bx: Math.round(br.x), bw: Math.round(br.width), sw: b.scrollWidth, cls: b.className, disp: getComputedStyle(b).display };
  }));
  console.log(JSON.stringify(info, null, 1));
});
