// v30 「長く遊ぶ仕掛け 第1弾」検証専用の Playwright 設定。
//
//   npx playwright test --config playwright.w3a.config.ts
//
// 既定の playwright.config.ts は ポート 5183 を使うが、そこは UXボット専用なので
// さわれない。ポート・出力先・webServer を 自分用に わける
// (教訓5「並行作業では Playwright は自分専用 config で」)。
// 中身(testDir・timeout・ブラウザ)は 既定の設定と そろえてあるので、
// 走る e2e は 既定と 1本も かわらない。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  outputDir: '.logs/pw-w3a-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5222',
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu'] },
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx vite --config vite.w3a.config.mts',
    url: 'http://localhost:5222',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
