import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: 'npx vite dev --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 30_000,
      env: { ...process.env, VITE_API_BASE_URL: 'http://localhost:3081' },
    },
    {
      command: 'node e2e/mock-backend.mjs',
      url: 'http://localhost:3081/api/config',
      reuseExistingServer: true,
      timeout: 10_000,
    },
  ],
});
