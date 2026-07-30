import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'], // e2e(Playwright)はvitestの対象外
    environment: 'node',
  },
});
