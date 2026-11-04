import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@deck26/contracts', replacement: path.resolve(__dirname, '../../packages/contracts/src/index.ts') },
      { find: '@deck26/ui/tokens.css', replacement: path.resolve(__dirname, '../../packages/ui/src/tokens.css') },
      { find: '@deck26/ui', replacement: path.resolve(__dirname, '../../packages/ui/src/index.tsx') }
    ]
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    strictPort: true
  }
});
