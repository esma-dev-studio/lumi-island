// v17「小さな磨き3件」担当エージェント専用の dev サーバー設定。
//
// 約束(vite.life.config.ts と同じ考え方。並行作業のため):
//   - ポートは 5225 だけ(既定の 5183 は ほかのエージェントのもの)
//   - cacheDir を 自分専用に 分ける ——共有の node_modules/.vite を 2つのプロセスが
//     取り合うと 両方こわれる(教訓5)
//   - HMR を切る。撮影・検証の走行中に ほかの人が src を保存しても ページが
//     読み直されない(`Execution context was destroyed` の予防)
//
//   npx vite --config vite.w3c.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-w3c',
  server: {
    port: 5225,
    strictPort: true,
    host: true,
    hmr: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
