import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Wrangler's local R2/Rate Limiter proxy can exit when browser projects hit it concurrently.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && wrangler dev --port 4173', port: 4173, reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
})
