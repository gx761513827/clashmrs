import { defineConfig, devices } from '@playwright/test';

/** E2E_SERVER=preview 时改为验证构建产物（pnpm build && pnpm e2e），默认验证 dev server。 */
const usePreview = process.env.E2E_SERVER === 'preview';
const port = usePreview ? 4173 : 5173;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: usePreview ? 'pnpm preview' : 'pnpm dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
