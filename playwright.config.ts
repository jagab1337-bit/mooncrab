import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 3,
  use: { baseURL: 'http://127.0.0.1:3000', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  webServer: { command: 'npm run dev -- --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
});
