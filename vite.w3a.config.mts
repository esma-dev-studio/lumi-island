// v30 「長く遊ぶ仕掛け 第1弾」(きょうの おすすめ・てがみの受信箱・ずかんのコンプ率)の
// 検証専用の dev サーバー設定。
//
//   npx vite --config vite.w3a.config.mts
//
// 3つのエージェントが 同じ作業ツリーで 並行して 動いているので、
//   ・ポートを 5222 に わける(5183 は UXボット専用・5225 は 別のエージェント)
//   ・**依存のキャッシュを 分ける**(node_modules/.vite を 取りあうと 両方こわれる。
//     教訓5「worktree で node_modules を共有すると .vite キャッシュを取りあう」)
//   ・HMR を 切る(他のエージェントの 保存で フルリロードが かかると
//     走行中の window.__lumi が 消えて `Execution context was destroyed` で落ちる)
//   ・host を true に(撮影ハーネスの ヘッドレスEdgeから つなぐ)
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-w3a',
  server: { port: 5222, strictPort: true, hmr: false, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
