// v29「島が いきている」の担当エージェント専用の dev サーバー設定。
//
// なぜ 別ファイルか(並行作業のための約束):
//   - ポートは 5225 だけを使う(既定の 5183 は UXボットと ほかのエージェントのもの)
//   - 依存の プリバンドルの置き場(cacheDir)を 分ける
//     ——共有の node_modules/.vite を 2つのプロセスが 取り合うと 両方こわれる(教訓5)
//   - HMR を切る。検証・撮影の走行中に ほかの人が src を保存しても
//     ページが 読み直されない(`Execution context was destroyed` の予防。教訓5)
//
//   npx vite --config vite.life.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-life',
  server: {
    port: 5225,
    strictPort: true,
    hmr: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
