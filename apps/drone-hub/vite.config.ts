import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = String(process.env.DRONE_HUB_API_PORT ?? '').trim();
const apiToken = String(process.env.DRONE_HUB_API_TOKEN ?? '').trim();
const sourcemapEnabled = String(process.env.DRONE_HUB_SOURCEMAP ?? '').trim() === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    sourcemap: sourcemapEnabled,
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
