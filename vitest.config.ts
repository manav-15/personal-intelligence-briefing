import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers':
        '/Users/manav/sideHustles/cloudflare-assignment/src/test/cloudflare-workers.ts',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    clearMocks: true,
  },
});
