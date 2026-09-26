import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The operator panel runs on 5280 (PORT overrides it, e.g. a second checkout on 5281).
const port = Number(process.env.PORT ?? 5280);

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  // the smoke test mounts whole pages: give slow machines time
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
