import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = String(process.env.DRONE_HUB_API_PORT ?? '').trim();
const apiToken = String(process.env.DRONE_HUB_API_TOKEN ?? '').trim();

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: apiPort
      ? {
          '/api': {
            target: `http://127.0.0.1:${apiPort}`,
            changeOrigin: true,
            ws: true,
            headers: apiToken ? { authorization: `Bearer ${apiToken}` } : undefined,
          },
        }
      : undefined,
  }
});
