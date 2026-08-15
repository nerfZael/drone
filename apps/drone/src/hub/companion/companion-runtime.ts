import crypto from 'node:crypto';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { BlipRuntimeEvent, BlipToolProvider } from '@blip/core';

import { loadRegistry } from '../../host/registry';
import { BlipAssistantHost } from '../assistant/blip-assistant-host';
import { loadBlipMcp, loadBlipTools } from '../assistant/blip-runtime-loader';
import { HubSessionRepository } from '../assistant/hub-session-repository';
import { createInProcessDroneHubMcpClient } from '../assistant/in-process-drone-hub-mcp';
import type { AssistantDroneSummary } from '../assistant/assistant-contracts';
import type { HubServices } from '../application/hub-services';
import { resolveEffectiveProviderApiKeySettings } from '../hub-settings';
import { searchActiveChatMessages } from '../transcript-store';
import {
  COMPANION_RUNTIME_CONTRACT,
  COMPANION_TOOL_SUMMARIES,
  readCompanionSettings,
  type CompanionBrowserToolName,
  type CompanionSettings,
  type CompanionToolName,
} from './companion-config';

const MAX_BROWSER_TEXT_CHARS = 1_000_000;
const MAX_DRAFT_PROMPT_CHARS = 100_000;

export type CompanionBrowserCall = (
  tool: CompanionBrowserToolName,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<any>;

type RunContext = {
  runId: string;
  settings: CompanionSettings;
  callBrowser: CompanionBrowserCall;
  snapshots: Map<string, BrowserTextSnapshot>;
};

type BrowserTextSnapshot = {
  kind: 'composer' | 'editor';
  targetId: string;
  path: string;
  content: string;
  revision: string;
  mode: string;
};

type RuntimeDependencies = {
  hubServices: HubServices;
  buildDroneSummaries(registry: any): AssistantDroneSummary[];
};

function result(data: Record<string, unknown>, text?: string) {
  return {
    content: [{ type: 'text' as const, text: text ?? JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function objectParameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false };
}

function snapshotKey(kind: BrowserTextSnapshot['kind'], targetId: string, revision: string) {
  return `${kind}\u0000${targetId}\u0000${revision}`;
}

function normalizeBrowserSnapshot(kind: BrowserTextSnapshot['kind'], value: any): BrowserTextSnapshot {
  const targetId = String(value?.targetId ?? '').trim();
  const path = String(value?.path ?? '').trim();
  const revision = String(value?.revision ?? '').trim();
  if (!targetId || !path || !revision || typeof value?.content !== 'string') {
    throw new Error(`browser returned an invalid ${kind} snapshot`);
  }
  if (value.content.length > MAX_BROWSER_TEXT_CHARS) {
    throw new Error(`${kind.toUpperCase()}_TOO_LARGE`);
  }
  return {
    kind,
    targetId,
    path,
    content: value.content,
    revision,
    mode: String(value?.mode ?? ''),
  };
}

function rememberBrowserSnapshot(
  snapshots: Map<string, BrowserTextSnapshot>,
  snapshot: BrowserTextSnapshot,
): void {
  for (const [key, existing] of snapshots) {
    if (existing.kind === snapshot.kind) snapshots.delete(key);
  }
  snapshots.set(snapshotKey(snapshot.kind, snapshot.targetId, snapshot.revision), snapshot);
}

export class CompanionRuntime {
  private readonly contexts = new Map<string, RunContext>();
  private readonly activeRunIds = new Set<string>();
  private readonly activeRunCompletions = new Map<string, Promise<void>>();
  private readonly cancelledRunIds = new Set<string>();
  private closing = false;
  private readonly repository = new HubSessionRepository({ inMemory: true });
  private readonly host: BlipAssistantHost;

  constructor(private readonly deps: RuntimeDependencies) {
    this.host = new BlipAssistantHost(
      async (threadId) => await this.configuration(threadId),
      undefined,
      this.repository,
    );
  }

  async run(input: {
    runId: string;
    prompt: string;
    callBrowser: CompanionBrowserCall;
    onEvent(event: BlipRuntimeEvent): Promise<void> | void;
  }): Promise<string> {
    const runId = String(input.runId).trim() || crypto.randomUUID();
    const threadId = `companion:${runId}`;
    if (this.closing) throw new Error('Companion is shutting down');
    if (this.activeRunIds.has(runId)) throw new Error('Companion run already exists');
    this.activeRunIds.add(runId);
    let settleRun!: () => void;
    this.activeRunCompletions.set(runId, new Promise<void>((resolve) => {
      settleRun = resolve;
    }));
    try {
      const settings = await readCompanionSettings();
      if (this.cancelledRunIds.has(runId)) throw new Error('Companion run cancelled');
      const credential = await resolveEffectiveProviderApiKeySettings(settings.provider);
      if (!credential.apiKey) {
        throw new Error(`Companion cannot start because ${settings.provider} credentials are not configured.`);
      }
      if (this.cancelledRunIds.has(runId)) throw new Error('Companion run cancelled');
      this.contexts.set(threadId, {
        runId,
        settings,
        callBrowser: input.callBrowser,
        snapshots: new Map(),
      });
      await this.host.promptThread(threadId, input.prompt, input.onEvent);
      return await this.host.latestAssistantVisibleText(threadId);
    } finally {
      this.host.abortThread(threadId);
      await this.host.deleteThread(threadId).catch(() => undefined);
      this.contexts.delete(threadId);
      this.activeRunIds.delete(runId);
      this.activeRunCompletions.delete(runId);
      this.cancelledRunIds.delete(runId);
      settleRun();
    }
  }

  cancel(runId: string): void {
    const normalizedRunId = String(runId).trim();
    if (!normalizedRunId) return;
    this.cancelledRunIds.add(normalizedRunId);
    this.host.abortThread(`companion:${normalizedRunId}`);
  }

  async close(): Promise<void> {
    this.closing = true;
    const activeCompletions = [...this.activeRunCompletions.values()];
    for (const runId of this.activeRunIds) this.cancel(runId);
    await Promise.allSettled(activeCompletions);
    await this.host.close();
    this.contexts.clear();
    this.activeRunIds.clear();
    this.activeRunCompletions.clear();
    this.cancelledRunIds.clear();
  }

  private async configuration(threadId: string) {
    const context = this.contexts.get(threadId);
    if (!context) throw new Error('Companion run context is unavailable');
    const registry = await loadRegistry();
    const drones = this.deps.buildDroneSummaries(registry);
    const refs = [...new Set(drones.flatMap((drone) => [drone.id, drone.name]).filter(Boolean))];
    const mcpClient = await createInProcessDroneHubMcpClient({
      correlationId: threadId,
      allowedDroneRefs: refs,
      allowedWriteDroneRefs: [],
      allowedDroneIds: drones.map((drone) => drone.id),
      hubServices: this.deps.hubServices,
    });
    const { createMcpToolProvider } = await loadBlipMcp();
    const mcpProvider = createMcpToolProvider({
      id: 'companion-drone-hub',
      namePrefix: 'drone_hub',
      client: mcpClient,
      correlation: () => ({ runId: context.runId }),
    });
    const mcpNames = new Set<CompanionToolName>(
      COMPANION_TOOL_SUMMARIES.filter((tool) => tool.execution === 'mcp').map(
        (tool) => tool.name,
      ),
    );
    const enabled = new Set(context.settings.enabledTools);
    const filteredMcpProvider: BlipToolProvider = {
      id: 'companion-drone-hub',
      promptSections: () => [],
      async load(blipContext) {
        return (await mcpProvider.load(blipContext))
          .map((tool) => ({ ...tool, name: tool.name.replace(/^drone_hub__/, '') }))
          .filter((tool) => mcpNames.has(tool.name as CompanionToolName) && enabled.has(tool.name as CompanionToolName));
      },
    };
    return {
      provider: context.settings.provider,
      model: context.settings.model,
      thinkingLevel: context.settings.thinkingLevel,
      systemPrompt: `${context.settings.systemPrompt}\n\n${COMPANION_RUNTIME_CONTRACT}`,
      tools: await this.customTools(context, drones),
      toolProviders: [filteredMcpProvider],
      getApiKey: async (provider: string) => {
        const normalized = provider === 'openai-codex' ? 'codex' : provider === 'google' ? 'gemini' : provider;
        if (normalized !== 'openai' && normalized !== 'codex' && normalized !== 'gemini') return undefined;
        return (await resolveEffectiveProviderApiKeySettings(normalized)).apiKey ?? undefined;
      },
      dispose: () => mcpClient.close(),
    };
  }

  private async customTools(context: RunContext, drones: AssistantDroneSummary[]): Promise<AgentTool<any>[]> {
    const enabled = new Set(context.settings.enabledTools);
    const tools: AgentTool<any>[] = [];
    const add = (
      name: CompanionToolName,
      implementation: Omit<AgentTool<any>, 'name' | 'label' | 'description'>,
    ) => {
      if (!enabled.has(name)) return;
      const metadata = COMPANION_TOOL_SUMMARIES.find((tool) => tool.name === name);
      if (!metadata) throw new Error(`Companion tool metadata is unavailable: ${name}`);
      tools.push({
        ...implementation,
        name,
        label: metadata.label,
        description: metadata.description,
      });
    };

    add('get_hub_overview', {
      parameters: objectParameters({}),
      execute: async () => {
        const [repositories, groups] = await Promise.all([
          this.deps.hubServices.repositories.list(),
          this.deps.hubServices.groups.list(undefined),
        ]);
        const repoRows = Array.isArray((repositories as any)?.repos) ? (repositories as any).repos : [];
        const groupRows = Array.isArray((groups as any)?.groups) ? (groups as any).groups : [];
        const data = {
          repositories: repoRows.length,
          drones: drones.length,
          chats: drones.reduce((total, drone) => total + Math.max(1, drone.chats.length), 0),
          groups: groupRows.length,
          busyDrones: drones.filter((drone) => drone.busy || drone.status === 'busy').length,
          errorDrones: drones.filter((drone) => /error|failed|offline/i.test(drone.status)).length,
          repositorylessDrones: drones.filter((drone) => !drone.repoPath).length,
          dronesWithMultipleChats: drones.filter((drone) => drone.chats.length > 1).length,
        };
        return result(data);
      },
    });

    add('search_chat_messages', {
      parameters: objectParameters({
        query: { type: 'string', maxLength: 500 },
        repoPath: { type: 'string', maxLength: 4096 },
        droneId: { type: 'string', maxLength: 200 },
        chatName: { type: 'string', maxLength: 200 },
        limit: { type: 'number' },
        offset: { type: 'number' },
      }, ['query']),
      execute: async (_callId, args) => {
        const input = args as Record<string, unknown>;
        const wantedRepo = String(input.repoPath ?? '').trim();
        const droneById = new Map(drones.map((drone) => [drone.id, drone]));
        const offset = Math.max(0, Math.min(5_000, Math.floor(Number(input.offset) || 0)));
        const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit) || 20)));
        const baseSearch = {
          query: String(input.query ?? ''),
          droneId: String(input.droneId ?? '').trim() || undefined,
          chatName: String(input.chatName ?? '').trim() || undefined,
        };
        const matches = searchActiveChatMessages({
          ...baseSearch,
          ...(wantedRepo
            ? {
                droneIds: drones
                  .filter((drone) => drone.repoPath === wantedRepo)
                  .map((drone) => drone.id),
              }
            : {}),
          limit,
          offset,
        }).results;
        const rows = matches.map((item) => {
          const drone = droneById.get(item.droneId);
          const repoPath = drone?.repoPath ?? '';
          const repoSegments = repoPath.split(/[\\/]/).filter(Boolean);
          return {
            ...item,
            droneName: drone?.name ?? item.droneId,
            repository: repoPath ? {
              path: repoPath,
              label: repoSegments[repoSegments.length - 1] || repoPath,
              ref: `repo:${Buffer.from(repoPath, 'utf8').toString('base64url')}`,
            } : null,
            chatRef: `${item.droneId}/${item.chatName}`,
          };
        });
        return result({ ok: true, query: input.query, count: rows.length, results: rows, limit, offset });
      },
    });

    for (const name of [
      'get_app_context',
      'read_active_composer',
      'read_open_file',
    ] as const) {
      add(name, {
        parameters: objectParameters({}),
        execute: async (_callId, _args, signal) => {
          const value = await context.callBrowser(name, {}, signal);
          if (name !== 'get_app_context') {
            const snapshot = normalizeBrowserSnapshot(name === 'read_active_composer' ? 'composer' : 'editor', value);
            rememberBrowserSnapshot(context.snapshots, snapshot);
          }
          return result(value);
        },
      });
    }

    for (const [name, kind] of [
      ['apply_composer_patch', 'composer'],
      ['apply_editor_patch', 'editor'],
    ] as const) {
      add(name, {
        parameters: objectParameters({
          targetId: { type: 'string' },
          baseRevision: { type: 'string' },
          patch: { type: 'string', maxLength: MAX_BROWSER_TEXT_CHARS },
        }, ['targetId', 'baseRevision', 'patch']),
        execute: async (_callId, args, signal) => {
          const input = args as Record<string, unknown>;
          const targetId = String(input.targetId ?? '').trim();
          const baseRevision = String(input.baseRevision ?? '').trim();
          const patch = String(input.patch ?? '');
          if (patch.length > MAX_BROWSER_TEXT_CHARS) throw new Error('PATCH_TOO_LARGE');
          const snapshot = context.snapshots.get(snapshotKey(kind, targetId, baseRevision));
          if (!snapshot) throw new Error('target snapshot is stale or was not read in this run');
          if (kind === 'editor' && snapshot.mode !== 'edit') throw new Error('EDITOR_NOT_EDITABLE');
          const { parsePatch, applyPatchHunks } = await loadBlipTools();
          const operations = parsePatch(patch);
          if (operations.length !== 1 || operations[0].type !== 'update' || operations[0].moveTo) {
            throw new Error('Companion patches must contain one Update File operation without a move');
          }
          const operation = operations[0];
          if (operation.path !== snapshot.path) throw new Error('patch path does not match the selected browser target');
          const crlf = snapshot.content.includes('\r\n');
          const nextLf = applyPatchHunks(snapshot.content.replace(/\r\n/g, '\n'), operation.hunks, snapshot.path);
          const nextContent = crlf ? nextLf.replace(/\n/g, '\r\n') : nextLf;
          if (nextContent.length > MAX_BROWSER_TEXT_CHARS) throw new Error('PATCH_RESULT_TOO_LARGE');
          const value = await context.callBrowser(name, {
            targetId,
            baseRevision,
            content: nextContent,
          }, signal);
          context.snapshots.delete(snapshotKey(kind, targetId, baseRevision));
          return result(value);
        },
      });
    }

    add('prepare_drone_draft', {
      parameters: objectParameters({
        name: { type: 'string', maxLength: 80 },
        prompt: { type: 'string', maxLength: MAX_DRAFT_PROMPT_CHARS },
        repoPath: { type: 'string', maxLength: 4096 },
        group: { type: 'string', maxLength: 64 },
      }),
      execute: async (_callId, args, signal) => result(await context.callBrowser('prepare_drone_draft', args as Record<string, unknown>, signal)),
    });

    add('highlight_drones', {
      parameters: objectParameters({
        droneIds: { type: 'array', items: { type: 'string' }, maxItems: 200 },
        durationMs: { type: 'number' },
      }, ['droneIds']),
      execute: async (_callId, args, signal) => result(await context.callBrowser('highlight_drones', args as Record<string, unknown>, signal)),
    });

    return tools;
  }
}
