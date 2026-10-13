import { defineConfig, devices } from '@playwright/test';

// Uses the locally installed Microsoft Edge (channel: 'msedge') so no browser
// binaries have to be downloaded. Runs against the production build (vite preview).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4931',
    channel: 'msedge',
  },
  webServer: {
    command: 'npx vite preview --port 4931 --strictPort',
    url: 'http://localhost:4931',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], channel: 'msedge', defaultBrowserType: 'chromium' },
    },
  ],
});
