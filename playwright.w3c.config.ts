// v17「小さな磨き3件」担当エージェント専用の Playwright 設定(並行作業のための切りわけ)。
//
//   - baseURL は 5225(自分の dev サーバーだけを見る)
//   - outputDir も 分ける(失敗の証拠が ほかのエージェントの走行と まざらない)
//   - webServer は 立てない。5225 は 自分で `npx vite --config vite.w3c.config.ts` で
//     上げてから走らせる(reuseExistingServer で 他人のサーバーを つかまない)
//
//   npx playwright test --config=playwright.w3c.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  outputDir: '.logs/pw-w3c-results',
  use: {
    baseURL: 'http://localhost:5225',
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu'] },
    viewport: { width: 1280, height: 720 },
  },
});
