// v17.1「しょうごう(称号)と 立ち話の段」の E2E 用の設定。
//
//   npx playwright test --config playwright.w3b.config.ts
//
// 既定の playwright.config.ts は ポート5183(UXボット専用)を つかうので、
// 3つのエージェントが 同じ作業ツリーで 動いているあいだは 取りあいになる。
// ここでは 自分の dev サーバー(5223 / cacheDir を分けた vite.w3b.config.mts)を つかう。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5223',
    channel: 'msedge', // インストール済みEdgeを使用(ブラウザDL不要)
    headless: true,
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu'], protocolTimeout: 300000 },
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx vite --config vite.w3b.config.mts',
    url: 'http://localhost:5223',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
