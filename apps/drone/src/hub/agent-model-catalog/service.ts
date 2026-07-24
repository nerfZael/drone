import path from 'node:path';

import { agentModelCatalogAdapter, modelListCommands } from './adapters';
import { parseAgentModelList, parseCodexModelCache } from './parsers';
import type {
  AgentModelCatalogCacheEntry,
  AgentModelCatalogRequest,
  AgentModelCatalogResult,
  AgentModelCatalogRuntime,
  AgentModelCatalogStore,
} from './types';

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 2;

function cacheKey(request: AgentModelCatalogRequest): string {
  const installation =
    String(request.target.installationKey ?? '').trim() || request.target.runtime;
  return `v${CACHE_SCHEMA_VERSION}:${installation}:${request.agentId}`;
}

function resultFromEntry(
  entry: AgentModelCatalogCacheEntry,
  source: 'cache' | 'live' | 'none',
  stale = false,
): AgentModelCatalogResult {
  return {
    models: entry.models,
    source,
    discoveredAt: entry.discoveredAt,
    ...(stale ? { stale: true } : {}),
    ...(entry.installationFingerprint
      ? { installationFingerprint: entry.installationFingerprint }
      : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function commandOutput(result: { stdout?: string; stderr?: string }): string {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

export class AgentModelCatalogService {
  private readonly memory = new Map<string, AgentModelCatalogCacheEntry>();
  private readonly inFlight = new Map<string, Promise<AgentModelCatalogResult>>();
  private readonly failedRefreshes = new Map<string, { atMs: number; error: string }>();

  constructor(
    private readonly runtime: AgentModelCatalogRuntime,
    private readonly store: AgentModelCatalogStore | null = null,
  ) {}

  async get(request: AgentModelCatalogRequest): Promise<AgentModelCatalogResult> {
    const key = cacheKey(request);
    const cached = this.readCache(key);
    const now = this.runtime.now?.() ?? Date.now();
    const age = cached ? now - Date.parse(cached.discoveredAt) : Number.POSITIVE_INFINITY;
    const ttl = cached?.models.length ? SUCCESS_TTL_MS : FAILURE_TTL_MS;

    if (!request.forceRefresh && cached && Number.isFinite(age) && age < ttl) {
      return resultFromEntry(cached, 'cache');
    }
    const failedRefresh = this.failedRefreshes.get(key);
    if (
      !request.forceRefresh &&
      cached?.models.length &&
      failedRefresh &&
      now - failedRefresh.atMs < FAILURE_TTL_MS
    ) {
      return {
        ...resultFromEntry(cached, 'cache', true),
        error: failedRefresh.error,
      };
    }
    if (
      !request.forceRefresh &&
      cached?.models.length &&
      Number.isFinite(age) &&
      age < MAX_STALE_MS
    ) {
      void this.refresh(key, request, cached).catch(() => undefined);
      return resultFromEntry(cached, 'cache', true);
    }
    return this.refresh(key, request, cached);
  }

  private readCache(key: string): AgentModelCatalogCacheEntry | null {
    const memoryEntry = this.memory.get(key);
    if (memoryEntry) return memoryEntry;
    const stored = this.store?.read(key) ?? null;
    if (stored) this.memory.set(key, stored);
    return stored;
  }

  private refresh(
    key: string,
    request: AgentModelCatalogRequest,
    fallback: AgentModelCatalogCacheEntry | null,
  ): Promise<AgentModelCatalogResult> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const refresh = this.probe(key, request, fallback).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, refresh);
    return refresh;
  }

  private async probe(
    key: string,
    request: AgentModelCatalogRequest,
    fallback: AgentModelCatalogCacheEntry | null,
  ): Promise<AgentModelCatalogResult> {
    const discoveredAt = new Date(this.runtime.now?.() ?? Date.now()).toISOString();
    try {
      const probed = await this.probeTarget(request);
      const entry: AgentModelCatalogCacheEntry = {
        key,
        agentId: request.agentId,
        runtime: request.target.runtime,
        models: probed.models,
        discoveredAt,
        ...(probed.installationFingerprint
          ? { installationFingerprint: probed.installationFingerprint }
          : {}),
        ...(probed.error ? { error: probed.error } : {}),
      };
      if (entry.models.length > 0) {
        this.failedRefreshes.delete(key);
        await this.remember(entry);
        return resultFromEntry(entry, 'live');
      }
      if (fallback?.models.length) {
        const error = entry.error ?? 'Model discovery did not return any models.';
        this.failedRefreshes.set(key, {
          atMs: this.runtime.now?.() ?? Date.now(),
          error,
        });
        return {
          ...resultFromEntry(fallback, 'cache', true),
          error,
        };
      }
      await this.remember(entry);
      return resultFromEntry(entry, entry.models.length > 0 ? 'live' : 'none');
    } catch (error: any) {
      const message = String(error?.message ?? error ?? 'Model discovery failed.').trim();
      if (fallback?.models.length) {
        this.failedRefreshes.set(key, {
          atMs: this.runtime.now?.() ?? Date.now(),
          error: message,
        });
        return { ...resultFromEntry(fallback, 'cache', true), error: message };
      }
      const entry: AgentModelCatalogCacheEntry = {
        key,
        agentId: request.agentId,
        runtime: request.target.runtime,
        models: [],
        discoveredAt,
        error: message,
      };
      await this.remember(entry);
      return resultFromEntry(entry, 'none');
    }
  }

  private async remember(entry: AgentModelCatalogCacheEntry): Promise<void> {
    this.memory.set(entry.key, entry);
    try {
      await this.store?.write(entry);
    } catch {
      // Persistence is best-effort; the in-memory catalog remains usable.
    }
  }

  private async probeTarget(request: AgentModelCatalogRequest): Promise<{
    models: AgentModelCatalogResult['models'];
    installationFingerprint?: string;
    error?: string;
  }> {
    const adapter = agentModelCatalogAdapter(request.agentId);
    const timeoutMs = this.runtime.timeoutMs();
    if (request.target.runtime === 'host') {
      if (!adapter.hostSupported) {
        return {
          models: [],
          error: `${adapter.binary} model discovery is not supported for host runtime`,
        };
      }
      const command = this.runtime.hostModelListCommand(request.agentId);
      if (!command) {
        return { models: [], error: `No host model command is configured for ${request.agentId}` };
      }
      const result = await this.runtime.runHost(command, timeoutMs);
      const models = result.code === 0 ? parseAgentModelList(commandOutput(result)) : [];
      return {
        models,
        installationFingerprint: `host:${request.agentId}`,
        ...(models.length > 0
          ? {}
          : { error: commandOutput(result) || `No models discovered for ${request.agentId}` }),
      };
    }

    const containerName = String(request.target.containerName ?? '').trim();
    if (!containerName) {
      return { models: [], error: 'No container is available for model discovery.' };
    }
    let installed = await this.runtime.runContainer(
      containerName,
      `command -v ${adapter.binary} >/dev/null 2>&1`,
      timeoutMs,
    );
    if (installed.code !== 0 && this.runtime.ensureContainerAgent) {
      await this.runtime.ensureContainerAgent(request.agentId, request.target);
      installed = await this.runtime.runContainer(
        containerName,
        `command -v ${adapter.binary} >/dev/null 2>&1`,
        timeoutMs,
      );
    }
    if (installed.code !== 0) {
      return { models: [], error: `${adapter.binary} is not installed in the catalog probe` };
    }

    const [help, version] = await Promise.all([
      this.runtime.runContainer(containerName, `${adapter.binary} --help`, timeoutMs),
      this.runtime.runContainer(containerName, `${adapter.binary} --version`, timeoutMs),
    ]);
    const versionText = commandOutput(version).replace(/\s+/g, ' ').slice(0, 200);
    const installationFingerprint = `container:${request.agentId}:${versionText || 'unknown-version'}`;
    const commands = modelListCommands(request.agentId, commandOutput(help));
    for (const command of commands) {
      const result = await this.runtime.runContainer(containerName, command, timeoutMs);
      if (result.code !== 0) continue;
      const models = parseAgentModelList(commandOutput(result));
      if (models.length > 0) return { models, installationFingerprint };
    }

    if (adapter.containerCacheCommand) {
      const result = await this.runtime.runContainer(
        containerName,
        adapter.containerCacheCommand,
        timeoutMs,
      );
      if (result.code === 0) {
        const models = parseCodexModelCache(String(result.stdout ?? ''));
        if (models.length > 0) return { models, installationFingerprint };
      }
    }

    if (request.agentId === 'codex') {
      const candidates = Array.from(
        new Set([
          path.join(this.runtime.hostHomeDirectory(), '.codex', 'models_cache.json'),
          '/root/.codex/models_cache.json',
        ]),
      );
      for (const candidate of candidates) {
        try {
          const models = parseCodexModelCache(await this.runtime.readHostFile(candidate));
          if (models.length > 0) return { models, installationFingerprint };
        } catch {
          // Continue through the small, explicit fallback list.
        }
      }
    }

    return {
      models: [],
      installationFingerprint,
      error:
        commands.length > 0
          ? `No models discovered for ${request.agentId} (${commands.length} commands tried)`
          : `No model discovery command is available for ${request.agentId}`,
    };
  }
}
