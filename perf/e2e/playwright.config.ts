/**
 * The Playwright smoke spec's config (TOLD 1.8 "Testing and CI"): Chromium only, one worker, against
 * `scripts/serve.ts` on port 8199 after `npm run build`. `npm run e2e` runs it.
 */
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const PORT = 8199;
const ROOT = join(import.meta.dirname, '..');

export default defineConfig({
  testDir: '.',
  outputDir: join(ROOT, 'test-results'),
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['github']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node scripts/serve.ts',
    cwd: ROOT,
    env: { PORT: String(PORT) },
    url: `http://localhost:${String(PORT)}/f16/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
