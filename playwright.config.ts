import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', viewport: { width: 1440, height: 1000 }, acceptDownloads: true, trace: 'retain-on-failure' },
  webServer: { command: process.env.STUDIO_PREVIEW ? 'npm run preview -- --port 1420' : 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI, timeout: 90000 },
});
