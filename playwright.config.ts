import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const desktop = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 180_000, // one test walks many pages, and a dev server compiles each on first visit
  webServer: { command: 'npm run dev', url: baseURL, reuseExistingServer: true },
  // E2E_CHANNEL=chrome drives an installed Chrome instead of Playwright's own download.
  use: { baseURL, channel: process.env.E2E_CHANNEL },
  projects: [
    // Buys a license through the real flow; the page specs then find it, like any existing data.
    { name: 'golden-path', testMatch: /golden-path\.spec\.ts/, use: desktop },
    { name: 'desktop', testIgnore: /golden-path/, dependencies: ['golden-path'], use: desktop },
    { name: 'mobile', testIgnore: /golden-path/, dependencies: ['golden-path'], use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
