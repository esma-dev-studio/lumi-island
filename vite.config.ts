import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5183, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
