import { defineConfig, devices } from '@playwright/test';

/**
 * 默认验证本地 dev server；E2E_SERVER=preview 验证本地构建产物；
 * E2E_BASE_URL=https://... 则直接打线上部署（此时不启动本地服务器）。
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const usePreview = process.env.E2E_SERVER === 'preview';
const port = usePreview ? 4173 : 5173;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // 少数网络环境（例如 Clash fake-ip）需要显式给浏览器指定代理：
    // E2E_PROXY=http://127.0.0.1:7890 pnpm e2e
    proxy: process.env.E2E_PROXY === undefined ? undefined : { server: process.env.E2E_PROXY },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer:
    externalBaseUrl !== undefined
      ? undefined
      : {
          command: usePreview ? 'pnpm preview' : 'pnpm dev',
          url: `http://127.0.0.1:${port}`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
});
