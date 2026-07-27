/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Baked into the bundle so a served page can tell whether it is the build the
// server is currently publishing. Same source write-build-info.cjs uses.
const buildSha =
  process.env.ATLAS_GIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown';

export default defineConfig({
  plugins: [react()],
  define: {
    __ATLAS_BUILD_SHA__: JSON.stringify(buildSha),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
