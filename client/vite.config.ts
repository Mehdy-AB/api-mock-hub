import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// During `npm run dev` the hub server must run on :3000. Open http://localhost:5173/_hub/
const hub = 'http://localhost:3000';

export default defineConfig({
  base: '/_hub/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/_hub/api': hub, // also matches /_hub/api-docs
      '/_hub/openapi.json': hub,
      '/_hub/docs': hub,
      // everything outside /_hub is a mock route
      '^/(?!_hub|@|node_modules|src).*': hub,
    },
  },
});
