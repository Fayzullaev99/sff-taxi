import { defineConfig } from 'vitest/config';

// Unit tests cover the pure logic in src/lib (no React Native imports there).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
