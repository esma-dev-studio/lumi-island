// v29 「キャラクターの表情と 会話の反応」の検証専用の dev サーバー設定。
//
//   npx vite --config vite.face.config.mts
//
// 4つのエージェントが 同じ作業ツリーで 並行して 動いているので、
//   ・ポートを 5223 に わける(5183 は UXボット専用 / 5222 照明 / 5226 物語)
//   ・**依存のキャッシュを 分ける**(node_modules/.vite を 取りあうと 両方こわれる。
//     教訓5「worktree で node_modules を共有すると .vite キャッシュを取りあう」)
//   ・HMR を 切る(他のエージェントの 保存で フルリロードが かかると
//     走行中の window.__lumi が 消えて `Execution context was destroyed` で落ちる)
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-face',
  // host: true = IPv4 と IPv6 の両方で待つ。既定(localhost)だと この機では
  // [::1] だけに ついてしまい、127.0.0.1 でつなぐ ヘッドレスEdgeが つながらない
  server: { port: 5223, strictPort: true, hmr: false, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
