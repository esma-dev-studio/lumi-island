// v29 「物語の入口と出口」検証専用の Playwright 設定。
//
//   npx playwright test --config playwright.story.config.ts
//
// 既定の playwright.config.ts は ポート 5183 を使うが、そこは UXボット専用なので
// さわれない。ポート・出力先・webServer を 自分用に わける
// (教訓5「並行作業では Playwright は自分専用 config で」)。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180000,
  fullyParallel: false,
  workers: 1,
  outputDir: '.logs/pw-story-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5226',
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu'] },
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx vite --config vite.story.config.mts',
    url: 'http://localhost:5226',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
