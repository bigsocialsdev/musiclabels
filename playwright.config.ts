import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 180_000, // one test walks many pages, and a dev server compiles each on first visit
  webServer: { command: 'npm run dev', url: baseURL, reuseExistingServer: true },
  // E2E_CHANNEL=chrome drives an installed Chrome instead of Playwright's own download.
  use: { baseURL, channel: process.env.E2E_CHANNEL },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
