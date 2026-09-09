// v17 「絵づくり(ライティング)」の検証専用の dev サーバー設定。
//
//   npx vite --config vite.light.config.mts
//
// 4つのエージェントが 同じ作業ツリーで 並行して 動いているので、
//   ・ポートを 5222 に わける(5183 は 別のエージェントの UXボット専用)
//   ・**依存のキャッシュを 分ける**(node_modules/.vite を 取りあうと 両方こわれる。
//     教訓5「worktree で node_modules を共有すると .vite キャッシュを取りあう」)
//   ・HMR を 切る(他のエージェントの 保存で フルリロードが かかると
//     走行中の window.__lumi が 消えて `Execution context was destroyed` で落ちる)
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-light',
  server: { port: 5222, strictPort: true, hmr: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
