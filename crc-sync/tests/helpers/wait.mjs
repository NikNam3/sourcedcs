// Waits for the tests that poll real I/O (ARCH-S 5d). Prefer a stepped clock where the code has a clock to inject.

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Polls `pred` every 10 ms until it is true, or throws after `ms` (a bound for a hang, not a timing assertion). */
export async function until(pred, ms = 4000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}
