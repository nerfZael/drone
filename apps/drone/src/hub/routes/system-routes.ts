import fs from 'node:fs/promises';

import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export interface SystemRouteDependencies {
  buildId: string;
  loadedAt: string;
  serverFilename: string;
  resolveSetupStatusResponse: ServiceFunction;
  readActiveProfileName: ServiceFunction;
  resolveHubSetupScopeKey: ServiceFunction;
  dismissWelcomeForScope: ServiceFunction;
}

export function registerSystemRoutes(apiRouter: HubRouter, deps: SystemRouteDependencies): void {
  const {
    buildId,
    loadedAt,
    serverFilename,
    resolveSetupStatusResponse,
    readActiveProfileName,
    resolveHubSetupScopeKey,
    dismissWelcomeForScope,
  } = deps;

  apiRouter.get('/api/health', ({ json }) => {
    json(200, { ok: true });
  });

  apiRouter.get('/api/version', async ({ json }) => {
    let mtime: string | null = null;
    try {
      const stat = await fs.stat(serverFilename);
      mtime = stat.mtime.toISOString();
    } catch {
      // The build file may have moved after the process started.
    }
    json(200, {
      ok: true,
      buildId,
      loadedAt,
      pid: process.pid,
      node: process.version,
      file: serverFilename,
      fileMtime: mtime,
      hasDisplay: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
      hasDbus: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
      env: {
        display: process.env.DISPLAY ?? null,
        waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
        xdgRuntimeDir: process.env.XDG_RUNTIME_DIR ?? null,
        xdgSessionType: process.env.XDG_SESSION_TYPE ?? null,
        desktopSession: process.env.DESKTOP_SESSION ?? null,
      },
    });
  });

  apiRouter.get('/api/setup/status', async ({ json }) => {
    json(200, await resolveSetupStatusResponse());
  });

  apiRouter.post('/api/setup/welcome/dismiss', async ({ json }) => {
    const activeProfile = await readActiveProfileName();
    const scopeKey = resolveHubSetupScopeKey(activeProfile);
    const next = await dismissWelcomeForScope(scopeKey);
    json(200, {
      ok: true,
      welcomeDismissedAt: next.welcomeDismissedAtByScope[scopeKey] ?? null,
    });
  });
}
