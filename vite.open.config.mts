// v17.3 「どの誘導段階でも やれることを塞がない」の検証専用の dev サーバー設定。
//
//   npx vite --config vite.open.config.mts
//
// ねらいは vite.w3a.config.mts と まったく同じ(教訓5):
//   ・ポートを 5222 に わける(5183 は UXボット・Playwright 専用)
//   ・**依存のキャッシュを 分ける**(node_modules/.vite を 取りあうと 両方こわれる)
//   ・HMR を 切る(走行中の 保存で フルリロードが かかると
//     window.__lumi が 消えて `Execution context was destroyed` で落ちる)
//   ・host を true に(撮影ハーネスの ヘッドレスEdgeから つなぐ)
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-open',
  server: { port: 5222, strictPort: true, hmr: false, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
