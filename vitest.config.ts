import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@deck26/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@deck26/ui': path.resolve(__dirname, 'packages/ui/src/index.tsx')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    server: {
      deps: {
        external: [/^node:/, 'sqlite']
      }
    }
  }
});
