/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages sub-path (/abyss-hollow-crown/).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600, // Phaser alone is ~1.2 MB minified; it is split into its own chunk.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          return undefined;
        },
      },
    },
  },
  server: { port: 4930 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
