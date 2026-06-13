import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = String(process.env.VOICE_STREAM_NEXT_API_PORT ?? process.env.PORT ?? '3299').trim();
const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const webEnv = {
    ...process.env,
    ...loadPublicEnv(appRoot, mode),
    ...loadPublicEnv(path.join(appRoot, 'server'), mode),
  };

  return {
    plugins: [react()],
    root: 'web',
    define: {
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(webEnv.VITE_CLERK_PUBLISHABLE_KEY ?? ''),
    },
    build: {
      outDir: '../dist/web',
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: false,
          ws: true,
          xfwd: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
              const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']) || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
              if (forwardedHost) proxyReq.setHeader('x-forwarded-host', forwardedHost);
              if (forwardedProto) proxyReq.setHeader('x-forwarded-proto', forwardedProto);
            });
          },
        },
      },
    },
  };
});

function firstHeaderValue(raw: string | string[] | undefined): string {
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',')[0].trim();
}

function loadPublicEnv(dir: string, mode: string): Record<string, string> {
  const names = ['.env', `.env.local`, `.env.${mode}`, `.env.${mode}.local`];
  const values: Record<string, string> = {};
  for (const name of names) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      if (!key.startsWith('VITE_')) continue;
      const rawValue = trimmed.slice(index + 1).trim();
      values[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}
