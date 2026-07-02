import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const apiPort = String(process.env.DRONE_HUB_API_PORT ?? '').trim();
const apiToken = String(process.env.DRONE_HUB_API_TOKEN ?? '').trim();
const sourcemapEnabled = String(process.env.DRONE_HUB_SOURCEMAP ?? '').trim() === '1';
const buildTime = new Date().toISOString();

function detectBuildId(): string {
  const explicit = String(process.env.DRONE_HUB_BUILD_ID ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? '').trim();
  if (explicit) return explicit;
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (sha) return `${sha}-${Date.now()}`;
  } catch {
    // Fall through to a timestamp-only build id for non-git build contexts.
  }
  return `local-${Date.now()}`;
}

const buildId = detectBuildId();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'drone-hub-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ buildId, buildTime })}\n`,
        });
      },
      closeBundle() {
        const swPath = resolve(__dirname, 'dist', 'pwa-sw.js');
        try {
          const source = readFileSync(swPath, 'utf8');
          const replaced = source.replaceAll('"__DRONE_HUB_BUILD_ID__"', JSON.stringify(buildId));
          if (replaced !== source) writeFileSync(swPath, replaced);
        } catch {
          // The service worker is optional in local/test builds.
        }
      },
    },
  ],
  publicDir: 'pwa',
  define: {
    __DRONE_HUB_BUILD_ID__: JSON.stringify(buildId),
    __DRONE_HUB_BUILD_TIME__: JSON.stringify(buildTime),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    sourcemap: sourcemapEnabled,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
      },
    },
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
