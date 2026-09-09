// v17.1「しょうごう(称号)と 立ち話の段」の検証専用の dev サーバー設定。
//
//   npx vite --config vite.w3b.config.mts
//
// 3つのエージェントが 同じ作業ツリーで 並行して 動いているので、
//   ・ポートは 5223 だけを つかう(5183 は UXボット専用)
//   ・**依存のキャッシュを 分ける**(node_modules/.vite を 取りあうと 両方こわれる。
//     教訓5「worktree で node_modules を共有すると .vite キャッシュを取りあう」)
//   ・HMR を 切る(ほかの担当の 保存で フルリロードが かかると
//     走行中の window.__lumi が 消えて `Execution context was destroyed` で落ちる)
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-w3b',
  // host: true = IPv4 と IPv6 の両方で待つ。既定(localhost)だと この機では
  // [::1] だけに ついてしまい、127.0.0.1 でつなぐ ヘッドレスEdgeが つながらない
  server: { port: 5223, strictPort: true, hmr: false, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
