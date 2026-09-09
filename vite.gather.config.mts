// v17.2「誘導中でも採取できる」の実機確認・回帰用の dev サーバー(自分専用)。
// 共用の 5183(playwright / UXボット)とぶつからないよう、ポートも Vite の
// 依存プリバンドルのキャッシュも分けてある(教訓5: cacheDir を分けないと取り合って壊れる)。
// HMR は切る = ライブ走行中に src が保存されても リロードで実行文脈が壊れない。
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite-gather',
  server: { port: 5222, strictPort: true, host: true, hmr: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
