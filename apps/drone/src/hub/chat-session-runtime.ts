import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentRunFileChanges } from '@blip/protocol';
import { normalizeMcpChatAccessScope } from './mcp-chat-access';
import { settleAgentRunActivity } from './builtin-agent-activity';

import type { ChatImageAttachment } from './chat-attachments';
import { ChatStateMaintenanceScheduler } from './chat-state-maintenance';
import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from './chat-types';
import type { PendingPrompt } from './drone-pending-prompts';
import type { DroneRuntime } from '../host/runtime';
import type { ResolvedOrPendingDrone } from './drone-lifecycle-service';
import { normalizeSilentCompletion } from '../host/silent-completion';

type TranscriptTurn = any;

export async function resolveStoredChatEntry(input: {
  droneId: string;
  chatName: string;
  registryChatEntry: any;
  readChatFromStore: (opts: { droneId: string; chatName: string }) => {
    available: boolean;
    chat: any | null;
  };
  importChatFromRegistry: (opts: {
    droneId: string;
    chatName: string;
    chatEntry: any;
  }) => Promise<unknown>;
}): Promise<any> {
  const stored = input.readChatFromStore({
    droneId: input.droneId,
    chatName: input.chatName,
  });
  if (stored.available && stored.chat) return stored.chat;
  await input.importChatFromRegistry({
    droneId: input.droneId,
    chatName: input.chatName,
    chatEntry: input.registryChatEntry,
  });
  const imported = input.readChatFromStore({
    droneId: input.droneId,
    chatName: input.chatName,
  });
  return imported.available ? imported.chat : input.registryChatEntry;
}

function normalizeAgentRunFileChanges(raw: unknown): AgentRunFileChanges | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as Partial<AgentRunFileChanges>;
  if (candidate.version !== 1 && candidate.version !== 2) return undefined;
  if (!Array.isArray(candidate.workspaces)) return undefined;
  if (
    Number(candidate.counts?.changed) <= 0 &&
    !(candidate.version === 2 && candidate.attribution === 'unavailable')
  )
    return undefined;
  return raw as AgentRunFileChanges;
}

export type ChatSessionRuntimeDependencies = {
  applyChatReconciliationInStore: any;
  assertChatAgentSupportedForDrone: any;
  bashQuote: any;
  buildAutoRenamedChatCandidate: any;
  buildContainerManagedEnvLines: any;
  buildEnvExportLines: any;
  chatHasActiveDockerSnapshot: any;
  chatHasReconcilablePendingPrompts: any;
  countTranscriptTurnsFromStore: any;
  defaultChatAgentConfigForDrone: any;
  defaultSeedBootstrapTimeoutMs: any;
  droneRuntime: any;
  dvmExec: any;
  dvmSessionStart: any;
  enqueueReconcile: any;
  ensureDaemonPromptEventSubscription: any;
  failStaleDockerSnapshotsForChat: any;
  hubChatSessionName: any;
  hubLog: any;
  importChatFromRegistry: any;
  importDroneChatsFromRegistry: any;
  importTranscriptTurnsFromRegistry: any;
  isGeneratedChatName: any;
  listChatsFromStore: any;
  loadRegistry: any;
  migrateInMemoryChatStateForRename: any;
  normalizeAgentPermissionMode: any;
  normalizeAgentPlan: any;
  normalizeBuiltinAgentId: any;
  normalizeChatImageAttachmentRefs: any;
  normalizeChatModel: any;
  normalizeChatName: any;
  normalizeChatReasoning: any;
  normalizeContainerPath: any;
  normalizeDockerSnapshot: any;
  normalizeDroneIdentity: any;
  normalizePendingStartupPrompts: any;
  nowIso: any;
  parseChatNameForMutation: any;
  patchChatMetadataInStore: any;
  pruneCompletedPendingPrompts: any;
  readChatFromStore: any;
  readChatRowsFromStore: any;
  readChatVersionFromStore: any;
  readPendingPrompts: any;
  readPendingStartupPrompts: any;
  readTranscriptTurnsFromStore: any;
  renameChatInStore: any;
  resolveBuiltinTmuxCommand: any;
  resolveCanonicalDroneOrPendingForReadRef: any;
  resolveContainerTerminalShellCommand: any;
  resolveDroneOrPendingForReadRef: any;
  resolveHubAgentCommand: any;
  resolveNameSuggestionLlmSettings: any;
  resolvePendingCodexApprovalsForNeverAsk: any;
  runHostCommand: any;
  sanitizeTmuxSessionName: any;
  stableResponseFingerprint: any;
  startupPromptToPendingPrompt: any;
  suggestDroneNameFromMessage: any;
  transcriptTurnsSourceHash: any;
  updateChatInStore: any;
  updateRegistry: any;
  updateTranscriptTurnInStore: any;
  upsertChatInStore: any;
};

export function createChatSessionRuntime(dependencies: ChatSessionRuntimeDependencies) {
  const {
    applyChatReconciliationInStore,
    assertChatAgentSupportedForDrone,
    bashQuote,
    buildAutoRenamedChatCandidate,
    buildContainerManagedEnvLines,
    buildEnvExportLines,
    chatHasActiveDockerSnapshot,
    chatHasReconcilablePendingPrompts,
    countTranscriptTurnsFromStore,
    defaultChatAgentConfigForDrone,
    defaultSeedBootstrapTimeoutMs,
    droneRuntime,
    dvmExec,
    dvmSessionStart,
    enqueueReconcile,
    ensureDaemonPromptEventSubscription,
    failStaleDockerSnapshotsForChat,
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    importDroneChatsFromRegistry,
    importTranscriptTurnsFromRegistry,
    isGeneratedChatName,
    listChatsFromStore,
    loadRegistry,
    migrateInMemoryChatStateForRename,
    normalizeAgentPermissionMode,
    normalizeAgentPlan,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachmentRefs,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDockerSnapshot,
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    nowIso,
    parseChatNameForMutation,
    patchChatMetadataInStore,
    pruneCompletedPendingPrompts,
    readChatFromStore,
    readChatRowsFromStore,
    readChatVersionFromStore,
    readPendingPrompts,
    readPendingStartupPrompts,
    readTranscriptTurnsFromStore,
    renameChatInStore,
    resolveBuiltinTmuxCommand,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveContainerTerminalShellCommand,
    resolveDroneOrPendingForReadRef,
    resolveHubAgentCommand,
    resolveNameSuggestionLlmSettings,
    resolvePendingCodexApprovalsForNeverAsk,
    runHostCommand,
    sanitizeTmuxSessionName,
    stableResponseFingerprint,
    startupPromptToPendingPrompt,
    suggestDroneNameFromMessage,
    transcriptTurnsSourceHash,
    updateChatInStore,
    updateRegistry,
    updateTranscriptTurnInStore,
    upsertChatInStore,
  } = dependencies;

  function pendingSnapshotPrompts(
    pendingEntry: any,
    droneId: string,
    chatName: string,
    startupPrompts: PendingPrompt[],
  ): PendingPrompt[] {
    const prompts = [...startupPrompts];
    const seed = pendingEntry?.seed;
    const seedPrompt = String(seed?.prompt ?? '').trim();
    const seedChatName = normalizeChatName(seed?.chatName ?? 'default');
    if (!seedPrompt || seedChatName !== chatName) return prompts;

    const seedId = String(seed?.promptId ?? '').trim() || `seed-${droneId}-${seedChatName}`;
    const alreadyProjected = prompts.some(
      (prompt) => prompt.id === seedId || String(prompt.prompt ?? '').trim() === seedPrompt,
    );
    if (alreadyProjected) return prompts;

    const failed = String(pendingEntry?.phase ?? '') === 'error';
    const at =
      String(seed?.submittedAt ?? pendingEntry?.createdAt ?? pendingEntry?.updatedAt ?? '').trim() ||
      nowIso();
    prompts.push({
      id: seedId,
      at,
      prompt: seedPrompt,
      ...(typeof seed?.model === 'string' && seed.model.trim()
        ? { model: seed.model.trim() }
        : {}),
      ...(typeof seed?.cwd === 'string' ? { cwd: seed.cwd } : {}),
      state: failed ? 'failed' : 'queued',
      ...(failed
        ? {
            error:
              String(pendingEntry?.error ?? '').trim() || 'Drone failed before the prompt was sent.',
          }
        : {}),
      updatedAt: String(pendingEntry?.updatedAt ?? at),
    });
    return prompts.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  }

  function buildNewChatEntry(opts: { droneEntry: any; createdAt: string; sourceChatEntry?: any }) {
    const agent = opts.sourceChatEntry
      ? inferChatAgent(opts.sourceChatEntry, opts.droneEntry)
      : defaultChatAgentConfigForDrone(opts.droneEntry);
    const sourceAgentPermissionMode = opts.sourceChatEntry
      ? normalizeAgentPermissionMode(opts.sourceChatEntry.agentPermissionMode)
      : 'execute';
    const sourceApprovalPolicy: AgentApprovalPolicy =
      opts.sourceChatEntry?.approvalPolicy === 'auto' ||
      opts.sourceChatEntry?.approvalPolicy === 'none'
        ? opts.sourceChatEntry.approvalPolicy
        : 'ask';
    const entry: any = {
      id: crypto.randomUUID(),
      createdAt: opts.createdAt,
      agent,
      ...(opts.sourceChatEntry && sourceAgentPermissionMode !== 'execute'
        ? { agentPermissionMode: sourceAgentPermissionMode }
        : {}),
      ...(opts.sourceChatEntry && sourceApprovalPolicy !== 'ask'
        ? { approvalPolicy: sourceApprovalPolicy }
        : {}),
      ...(opts.sourceChatEntry && normalizeChatModel(opts.sourceChatEntry?.model)
        ? { model: normalizeChatModel(opts.sourceChatEntry?.model) }
        : {}),
      ...(opts.sourceChatEntry && normalizeChatReasoning(opts.sourceChatEntry?.reasoning)
        ? { reasoning: normalizeChatReasoning(opts.sourceChatEntry?.reasoning) }
        : {}),
      ...(opts.sourceChatEntry && typeof opts.sourceChatEntry?.nativeProvider === 'string'
        ? { nativeProvider: String(opts.sourceChatEntry.nativeProvider).trim() }
        : {}),
      droneHubMcpAccessScope: normalizeMcpChatAccessScope(
        opts.sourceChatEntry?.droneHubMcpAccessScope,
        opts.droneEntry?.id,
      ),
    };
    return entry;
  }

  const HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES = 300;
  const HUB_WEB_TERMINAL_MAX_TAIL_LINES = 1000;
  const HUB_WEB_TERMINAL_MAX_BYTES = 200_000;

  function clampInt(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return Math.floor(n);
  }

  function parseOptionalNonNegativeInt(raw: string | null): number | undefined {
    if (raw == null) return undefined;
    const v = Number(String(raw).trim());
    if (!Number.isFinite(v) || v < 0) return undefined;
    return Math.floor(v);
  }

  function clampIntParam(
    raw: string | null,
    defaultValue: number,
    min: number,
    max: number,
  ): number {
    const parsed = parseOptionalNonNegativeInt(raw);
    return clampInt(parsed ?? defaultValue, min, max);
  }

  function buildHubSessionShell(opts: {
    command: string;
    cwd: string;
    envVars?: Record<string, string> | null;
  }): string {
    const cmd =
      String(opts.command || '').trim() || resolveContainerTerminalShellCommand(process.env);
    const cwd = normalizeContainerPath(String(opts.cwd ?? '').trim() || '/dvm-data');
    const baseEnv = ['export TERM=xterm-256color', 'export COLORTERM=truecolor'].join('; ');
    const managedEnv = buildEnvExportLines(opts.envVars).join('; ');
    return [
      'set -e',
      baseEnv,
      managedEnv,
      `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
      `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data`,
      cmd,
    ]
      .filter((part) => Boolean(String(part).trim()))
      .join('; ');
  }

  async function ensureHubSessionRunning(opts: {
    containerName: string;
    sessionName: string;
    command: string;
    cwd?: string | null;
    envVars?: Record<string, string> | null;
  }) {
    const sessionName = sanitizeTmuxSessionName(opts.sessionName || 'default');
    // If a tmux session exists but its pane is dead (e.g. shell got terminated),
    // kill and recreate it so the web terminal always attaches to a live shell.
    try {
      const deadCheckScript = [
        'set -euo pipefail',
        `s=${bashQuote(sessionName)}`,
        'tmux has-session -t "$s" 2>/dev/null || exit 0',
        'dead="$(tmux display-message -p -t "$s:0.0" \'#{pane_dead}\' 2>/dev/null || echo 0)"',
        '[ "$dead" = "1" ] && tmux kill-session -t "$s" 2>/dev/null || true',
      ].join('\n');
      await dvmExec(opts.containerName, 'bash', ['-lc', deadCheckScript]);
    } catch {
      // Best-effort safety check; continue with normal start logic.
    }
    const shell = buildHubSessionShell({
      command: opts.command,
      cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
      envVars: opts.envVars ?? null,
    });
    try {
      await dvmSessionStart(opts.containerName, sessionName, 'bash', ['-lc', shell], true);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // `--reuse` should avoid duplicates, but there can still be a small TOCTOU race.
      if (/duplicate session:/i.test(msg) || /Session already exists:/i.test(msg)) {
        // Treat as success; the session is running (or is being created).
      } else {
        throw e;
      }
    }
    return { sessionName };
  }

  async function ensureChatEntry(opts: { droneId: string; chatName: string }): Promise<void> {
    const reg: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    if (!(globalThis as any).Bun) {
      await importDroneChatsFromRegistry({ droneId, chats: d.chats });
      const stored = readChatFromStore({ droneId, chatName: opts.chatName }).chat;
      if (stored) {
        if (typeof stored.id !== 'string' || !stored.id.trim()) {
          await updateChatInStore({
            droneId,
            chatName: opts.chatName,
            update: (current: any) => ({ ...current, id: crypto.randomUUID() }),
          });
        }
        return;
      }
      await upsertChatInStore({
        droneId,
        chatName: opts.chatName,
        chatEntry: buildNewChatEntry({
          droneEntry: d,
          createdAt: new Date().toISOString(),
        }),
      });
      return;
    }
    await updateRegistry((registry: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const drone = droneId ? registry?.drones?.[droneId] : null;
      if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
      drone.chats = drone.chats ?? {};
      if (drone.chats[opts.chatName]) {
        if (
          typeof drone.chats[opts.chatName].id !== 'string' ||
          !drone.chats[opts.chatName].id.trim()
        ) {
          drone.chats[opts.chatName].id = crypto.randomUUID();
        }
      } else {
        // Child drones default to Codex; other drones keep Cursor.
        // NOTE: chatId is intentionally omitted (it is created lazily on first prompt).
        drone.chats[opts.chatName] = buildNewChatEntry({
          droneEntry: drone,
          createdAt: new Date().toISOString(),
        }) as any;
        registry.drones = registry.drones ?? {};
        registry.drones[droneId] = drone;
      }
    });
  }

  async function ensureChatEntryCopiedFromChat(opts: {
    droneId: string;
    chatName: string;
    copyFromChatName: string;
  }): Promise<void> {
    if (!(globalThis as any).Bun) {
      const registry: any = await loadRegistry();
      const droneId = normalizeDroneIdentity(opts.droneId);
      const chatName = parseChatNameForMutation(opts.chatName, 'chat name');
      const copyFromChatName = normalizeChatName(opts.copyFromChatName);
      const drone = droneId ? registry?.drones?.[droneId] : null;
      if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
      await importDroneChatsFromRegistry({ droneId, chats: drone.chats });
      if (readChatFromStore({ droneId, chatName }).chat) return;
      const createdAt = nowIso();
      const source = copyFromChatName
        ? readChatFromStore({ droneId, chatName: copyFromChatName }).chat
        : null;
      if (
        copyFromChatName &&
        !source &&
        !(copyFromChatName === 'default' && listChatsFromStore({ droneId }).chats.length === 0)
      ) {
        throw new Error(`unknown chat: ${copyFromChatName}`);
      }
      await upsertChatInStore({
        droneId,
        chatName,
        chatEntry: buildNewChatEntry({
          droneEntry: drone,
          createdAt,
          ...(source ? { sourceChatEntry: source } : {}),
        }),
      });
      return;
    }
    let syncedDroneId = '';
    let syncedChats: any = null;
    await updateRegistry((reg: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const chatName = parseChatNameForMutation(opts.chatName, 'chat name');
      const copyFromChatName = normalizeChatName(opts.copyFromChatName);
      const d = droneId ? reg?.drones?.[droneId] : null;
      if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
      syncedDroneId = droneId;
      d.chats = d.chats ?? {};
      if (d.chats[chatName]) {
        syncedChats = d.chats;
        return;
      }
      const createdAt = nowIso();
      if (copyFromChatName && !d.chats[copyFromChatName]) {
        if (copyFromChatName === 'default' && Object.keys(d.chats).length === 0) {
          d.chats.default = buildNewChatEntry({
            droneEntry: d,
            createdAt,
          });
        } else {
          throw new Error(`unknown chat: ${copyFromChatName}`);
        }
      }
      let entry: any = buildNewChatEntry({
        droneEntry: d,
        createdAt,
      });
      if (copyFromChatName) {
        const source = d.chats?.[copyFromChatName];
        if (!source) throw new Error(`unknown chat: ${copyFromChatName}`);
        entry = buildNewChatEntry({
          droneEntry: d,
          createdAt,
          sourceChatEntry: source,
        });
      }
      d.chats[chatName] = entry;
      reg.drones = reg.drones ?? {};
      reg.drones[droneId] = d;
      syncedChats = d.chats;
    });
    if (syncedDroneId && syncedChats)
      await importDroneChatsFromRegistry({ droneId: syncedDroneId, chats: syncedChats });
  }

  function inferChatAgent(entry: any, droneEntry?: any): ChatAgentConfig {
    const agent = entry?.agent as ChatAgentConfig | undefined;
    if (agent && agent.kind === 'native') return { kind: 'native' };
    if (agent && agent.kind === 'builtin') {
      const builtinId = normalizeBuiltinAgentId(agent.id);
      if (builtinId) return { kind: 'builtin', id: builtinId };
    }
    if (agent && agent.kind === 'custom') {
      const id = String((agent as any).id ?? '').trim();
      const label = String((agent as any).label ?? '').trim() || id || 'Custom';
      const command = String((agent as any).command ?? '').trim() || resolveHubAgentCommand();
      return { kind: 'custom', id: id || 'custom', label, command };
    }
    return defaultChatAgentConfigForDrone(droneEntry);
  }

  function assertReadOnlySupportedForAgent(agent: ChatAgentConfig): void {
    if (agent.kind === 'native') return;
    if (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip')) return;
    const label = agent.kind === 'builtin' ? agent.id : agent.label || agent.id || 'custom agent';
    const error: Error & { statusCode?: number } = new Error(
      `agent access controls are currently supported for native, Codex, and Blip chats only (selected: ${label})`,
    );
    error.statusCode = 400;
    throw error;
  }

  function supportsApprovalPolicy(agent: ChatAgentConfig): boolean {
    return agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex');
  }

  function assertApprovalPolicySupportedForAgent(
    policy: AgentApprovalPolicy,
    agent: ChatAgentConfig,
  ): void {
    if (!supportsApprovalPolicy(agent)) {
      const label =
        agent.kind === 'builtin' ? agent.id : agent.kind === 'native' ? 'native' : agent.label;
      const error: Error & { statusCode?: number } = new Error(
        `approval policies are currently supported for native and Codex chats only (selected: ${label})`,
      );
      error.statusCode = 400;
      throw error;
    }
    if (policy === 'auto' && !(agent.kind === 'builtin' && agent.id === 'codex')) {
      const error: Error & { statusCode?: number } = new Error(
        'auto approval policy is only available for Codex chats',
      );
      error.statusCode = 400;
      throw error;
    }
  }

  async function getChatEntry(opts: { droneId: string; chatName: string }) {
    if (!(globalThis as any).Bun) {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const resolved = droneId ? await resolveCanonicalDroneOrPendingForReadRef(droneId) : null;
      if (resolved?.kind !== 'real') throw new Error(`unknown drone: ${opts.droneId}`);
      const stored = readChatFromStore({ droneId, chatName: opts.chatName });
      if (!stored.available || !stored.chat) throw new Error(`unknown chat: ${opts.chatName}`);
      return { reg: null, d: resolved.drone, chat: stored.chat, droneId };
    }
    const reg = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? (reg as any).drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    const chat = d.chats?.[opts.chatName];
    if (!chat) throw new Error(`unknown chat: ${opts.chatName}`);
    await importChatFromRegistry({ droneId, chatName: opts.chatName, chatEntry: chat });
    const read = readChatFromStore({ droneId, chatName: opts.chatName });
    return { reg, d, chat: read.available && read.chat ? read.chat : chat, droneId };
  }

  async function projectCanonicalChatToRegistry(
    droneIdRaw: string,
    chatNameRaw: string,
  ): Promise<void> {
    if (!(globalThis as any).Bun) return;
    const droneId = normalizeDroneIdentity(droneIdRaw);
    const chatName = normalizeChatName(chatNameRaw);
    await updateRegistry((registry: any) => {
      // Read canonical state only after the registry update has acquired its
      // serialization lock. Otherwise an older projection can finish last and
      // overwrite a newer additive update.
      const stored = readChatFromStore({ droneId, chatName });
      if (!stored.available || !stored.chat) return;
      const { turns, pendingPrompts: _canonicalPendingPrompts, ...canonicalMetadata } = stored.chat;
      const drone = registry?.drones?.[droneId];
      const current = drone?.chats?.[chatName];
      if (!drone || !current) return;
      drone.chats[chatName] = {
        ...canonicalMetadata,
        turns: Array.isArray(turns) ? turns : [],
        // PromptQueueRepository remains authoritative; retain this field only as
        // a compatibility projection for older registry readers.
        pendingPrompts: Array.isArray(current.pendingPrompts) ? current.pendingPrompts : [],
      };
    });
  }

  async function projectCanonicalChatsToRegistry(droneIdRaw: string): Promise<void> {
    if (!(globalThis as any).Bun) return;
    const droneId = normalizeDroneIdentity(droneIdRaw);
    await updateRegistry((registry: any) => {
      const chats = Object.fromEntries(
        listChatsFromStore({ droneId }).chats.flatMap((chatName: string) => {
          const stored = readChatFromStore({ droneId, chatName });
          return stored.available && stored.chat ? [[chatName, stored.chat]] : [];
        }),
      );
      const drone = registry?.drones?.[droneId];
      if (!drone) return;
      drone.chats = chats;
    });
  }

  const CHAT_AUTO_RENAME_IN_FLIGHT = new Set<string>();
  const CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD = 'firstMessageNameSuggestionAttemptedAt';

  async function shouldAutoRenameChatOnPrompt(opts: {
    droneId: string;
    chatName: string;
    chatEntry: any;
  }): Promise<boolean> {
    if (!isGeneratedChatName(opts.chatName)) return false;
    try {
      await importResolvedChatToStore(opts.droneId, opts.chatName, opts.chatEntry);
      const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
      if (String(stored.chat?.[CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD] ?? '').trim()) return false;
      const transcript = countTranscriptTurnsFromStore({
        droneId: opts.droneId,
        chatName: opts.chatName,
      });
      const pending = await readPendingPrompts({
        droneId: opts.droneId,
        chatName: opts.chatName,
      });
      return transcript.count === 0 && pending.length === 0;
    } catch (error: any) {
      hubLog('warn', 'chat auto-rename first-message check failed', {
        droneId: opts.droneId,
        chatName: opts.chatName,
        error: error?.message ?? String(error),
      });
      return false;
    }
  }

  async function claimChatAutoRenameFromFirstPrompt(opts: {
    droneId: string;
    chatName: string;
  }): Promise<boolean> {
    try {
      const attemptedAt = nowIso();
      const patched = await patchChatMetadataInStore({
        droneId: opts.droneId,
        chatName: opts.chatName,
        patch: {
          setIfMissing: {
            [CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD]: attemptedAt,
          },
        },
      });
      if (!patched.changed) return false;
      await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
      return true;
    } catch (error: any) {
      hubLog('warn', 'chat auto-rename first-message claim failed', {
        droneId: opts.droneId,
        chatName: opts.chatName,
        error: error?.message ?? String(error),
      });
      return false;
    }
  }

  async function autoRenameGeneratedChatFromFirstPrompt(opts: {
    droneId: string;
    chatName: string;
    prompt: string;
    expectedCreatedAt: string;
  }): Promise<void> {
    if (!isGeneratedChatName(opts.chatName)) return;
    const key = `${opts.droneId}\u0000${opts.chatName}`;
    if (CHAT_AUTO_RENAME_IN_FLIGHT.has(key)) return;
    CHAT_AUTO_RENAME_IN_FLIGHT.add(key);

    try {
      const llm = await resolveNameSuggestionLlmSettings();
      if (!llm.apiKey) {
        hubLog('warn', 'chat auto-rename skipped: missing Codex connection and OpenAI key', {
          droneId: opts.droneId,
          chatName: opts.chatName,
        });
        return;
      }

      const base = await suggestDroneNameFromMessage(opts.prompt, {
        provider: llm.provider,
        apiKey: llm.apiKey,
      });
      const current = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
      if (!current.chat || String(current.chat?.createdAt ?? '') !== opts.expectedCreatedAt) return;

      const existing = new Set(listChatsFromStore({ droneId: opts.droneId }).chats);
      let candidate = '';
      let renamed = false;
      for (let attempt = 1; attempt <= 100; attempt += 1) {
        const next = buildAutoRenamedChatCandidate(base, attempt);
        if (!next || next === opts.chatName || existing.has(next)) continue;
        try {
          renamed = await renameChatInStore({
            droneId: opts.droneId,
            chatName: opts.chatName,
            newChatName: next,
          });
          candidate = next;
          break;
        } catch (error: any) {
          const message = String(error?.message ?? error ?? '');
          if (/already exists/i.test(message)) {
            existing.add(next);
            continue;
          }
          if (/unknown chat/i.test(message)) return;
          throw error;
        }
      }
      if (!candidate) throw new Error('could not find an available suggested chat name');
      if (!renamed) return;
      migrateInMemoryChatStateForRename({
        droneId: opts.droneId,
        fromChatName: opts.chatName,
        toChatName: candidate,
      });
      await projectCanonicalChatsToRegistry(opts.droneId);
      hubLog('info', 'chat auto-renamed from first message', {
        droneId: opts.droneId,
        oldChatName: opts.chatName,
        chatName: candidate,
        provider: llm.provider,
      });
    } catch (error: any) {
      hubLog('warn', 'chat auto-rename failed', {
        droneId: opts.droneId,
        chatName: opts.chatName,
        error: error?.message ?? String(error),
      });
    } finally {
      CHAT_AUTO_RENAME_IN_FLIGHT.delete(key);
    }
  }

  async function importResolvedDroneChatsToStore(
    droneId: string,
    droneEntry: any,
  ): Promise<string[]> {
    const chats = droneEntry?.chats && typeof droneEntry.chats === 'object' ? droneEntry.chats : {};
    const imported = await importDroneChatsFromRegistry({ droneId, chats });
    if (imported.available) return imported.chats;
    return Object.keys(chats);
  }

  async function importResolvedChatToStore(
    droneId: string,
    chatName: string,
    chatEntry: any,
  ): Promise<any> {
    return await resolveStoredChatEntry({
      droneId,
      chatName,
      registryChatEntry: chatEntry,
      readChatFromStore,
      importChatFromRegistry,
    });
  }

  type ChatStateContext =
    | {
        kind: 'pending';
        droneId: string;
        droneName: string;
        chatName: string;
        pendingEntry: any;
      }
    | {
        kind: 'real';
        droneId: string;
        droneName: string;
        chatName: string;
        droneEntry: any;
        projectedChatEntry: any;
      };

  async function buildChatStateContext(opts: {
    droneRef: string;
    chatName: string;
    resolved: ResolvedOrPendingDrone;
  }): Promise<ChatStateContext | { kind: 'missing-chat'; droneId: string; chatName: string }> {
    if (opts.resolved.kind === 'pending') {
      const droneName =
        String(opts.resolved.pending?.name ?? opts.droneRef).trim() || opts.droneRef;
      return {
        kind: 'pending',
        droneId: opts.resolved.id,
        droneName,
        chatName: opts.chatName,
        pendingEntry: opts.resolved.pending,
      };
    }

    const droneId = opts.resolved.id;
    const droneEntry = opts.resolved.drone;
    const registryChatEntry = (droneEntry as any)?.chats?.[opts.chatName] ?? null;
    if (!registryChatEntry) return { kind: 'missing-chat', droneId, chatName: opts.chatName };
    const droneName = String(droneEntry?.name ?? opts.droneRef).trim() || opts.droneRef;
    const projectedChatEntry =
      (await importResolvedChatToStore(droneId, opts.chatName, registryChatEntry)) ??
      registryChatEntry;
    return {
      kind: 'real',
      droneId,
      droneName,
      chatName: opts.chatName,
      droneEntry,
      projectedChatEntry,
    };
  }

  type BuiltChatTranscriptRows =
    | {
        ok: true;
        selection: string;
        transcripts: any[];
        agent: ChatAgentConfig;
        turnCount: number;
        etag: string;
      }
    | {
        ok: false;
        statusCode: 410;
        error: string;
        agent: ChatAgentConfig;
      };

  type ChatSnapshotRead =
    | {
        ok: true;
        id: string;
        name: string;
        chat: string;
        chatId: string | null;
        selection: string;
        transcripts: any[];
        pending: PendingPrompt[];
        agent?: ChatAgentConfig;
        model: string | null;
        reasoning: string | null;
        agentPermissionMode: AgentPermissionMode;
        approvalPolicy: AgentApprovalPolicy;
        turnCount: number;
        transcriptEtag: string | null;
        responseEtag?: string;
        notModified?: boolean;
      }
    | {
        ok: false;
        statusCode: number;
        error: string;
        agent?: ChatAgentConfig;
      };

  type ChatSnapshotMaintenance = 'none' | 'run' | 'schedule';

  function chatSnapshotConfig(chat: any) {
    const approvalPolicy =
      chat?.approvalPolicy === 'auto' || chat?.approvalPolicy === 'none'
        ? chat.approvalPolicy
        : 'ask';
    return {
      reasoning: normalizeChatReasoning(chat?.reasoning),
      agentPermissionMode: normalizeAgentPermissionMode(chat?.agentPermissionMode),
      approvalPolicy: approvalPolicy as AgentApprovalPolicy,
    };
  }

  function runChatReadMaintenance(opts: {
    droneId: string;
    chatName: string;
    chatEntry: any;
    includeDockerSnapshotMaintenance?: boolean;
  }): void {
    if (chatHasReconcilablePendingPrompts(opts.chatEntry)) {
      ensureDaemonPromptEventSubscription(opts.droneId);
      enqueueReconcile(opts.droneId, opts.chatName);
    }
    if (
      opts.includeDockerSnapshotMaintenance === true &&
      chatHasActiveDockerSnapshot(opts.chatEntry)
    ) {
      void failStaleDockerSnapshotsForChat({
        droneId: opts.droneId,
        chatName: opts.chatName,
      }).catch((error: any) => {
        hubLog('warn', 'failed stale docker snapshot maintenance after transcript read', {
          droneId: opts.droneId,
          chatName: opts.chatName,
          error: String(error?.message ?? error ?? 'unknown error'),
        });
      });
    }
  }

  const chatStateMaintenanceScheduler = new ChatStateMaintenanceScheduler({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    run: runChatReadMaintenance,
    logError: ({ droneId, chatName, error }) => {
      hubLog('warn', 'failed scheduled chat state read maintenance', {
        droneId,
        chatName,
        error: String((error as any)?.message ?? error ?? 'unknown error'),
      });
    },
  });

  function scheduleChatStateReadMaintenance(
    opts: Parameters<typeof runChatReadMaintenance>[0],
  ): void {
    chatStateMaintenanceScheduler.schedule(opts);
  }

  async function buildPendingRowsForChat(opts: {
    droneId: string;
    chatName: string;
  }): Promise<PendingPrompt[]> {
    return (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).slice(
      -50,
    );
  }

  function formatTranscriptRow(turnIndex: number, turn: any): any {
    const at = String(turn?.at ?? new Date().toISOString());
    const promptAt =
      typeof turn?.promptAt === 'string' && turn.promptAt.trim()
        ? String(turn.promptAt).trim()
        : undefined;
    const startedAt =
      typeof turn?.startedAt === 'string' && turn.startedAt.trim()
        ? String(turn.startedAt).trim()
        : undefined;
    const completedAt =
      typeof turn?.completedAt === 'string' && turn.completedAt.trim()
        ? String(turn.completedAt).trim()
        : undefined;
    const id = typeof turn?.id === 'string' && turn.id.trim() ? String(turn.id).trim() : undefined;
    const prompt = String(turn?.prompt ?? '');
    const model = normalizeChatModel((turn as any)?.model);
    const reasoning = normalizeChatReasoning((turn as any)?.reasoning);
    const activity = settleAgentRunActivity((turn as any)?.activity);
    const attachments = normalizeChatImageAttachmentRefs((turn as any)?.attachments);
    const dockerSnapshot = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
    const fileChanges = normalizeAgentRunFileChanges((turn as any)?.fileChanges);
    const agentPlanRaw = (turn as any)?.agentPlan;
    const agentPlanSource = String(agentPlanRaw?.source ?? '').trim();
    const agentPlan =
      agentPlanSource === 'cursor' ||
      agentPlanSource === 'codex' ||
      agentPlanSource === 'claude' ||
      agentPlanSource === 'opencode'
        ? normalizeAgentPlan(agentPlanRaw, agentPlanSource, String(agentPlanRaw?.updatedAt ?? ''))
        : undefined;
    const ok = Boolean(turn?.ok);
    const { output, silentCompletion } = normalizeSilentCompletion(ok, turn?.output, {
      explicitlySilent: (turn as any)?.silentCompletion === true,
      prompt,
      promptId: id,
    });
    const error = ok ? undefined : String(turn?.error ?? 'failed');
    return {
      turn: turnIndex + 1,
      at,
      ...(promptAt ? { promptAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(id ? { id } : {}),
      prompt,
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(activity ? { activity } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(agentPlan ? { agentPlan } : {}),
      ...(fileChanges ? { fileChanges } : {}),
      ...(dockerSnapshot
        ? {
            dockerSnapshot: {
              id: dockerSnapshot.id,
              status: dockerSnapshot.status,
              createdAt: dockerSnapshot.createdAt,
              ...(dockerSnapshot.readyAt ? { readyAt: dockerSnapshot.readyAt } : {}),
              ...(dockerSnapshot.restoredAt ? { restoredAt: dockerSnapshot.restoredAt } : {}),
              ...(dockerSnapshot.error ? { error: dockerSnapshot.error } : {}),
              ...(typeof dockerSnapshot.sizeBytes === 'number'
                ? { sizeBytes: dockerSnapshot.sizeBytes }
                : {}),
            },
          }
        : {}),
      ...((turn as any)?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
      ok,
      ...(silentCompletion ? { silentCompletion: true } : {}),
      ...(ok ? { output } : { output: '', error }),
    };
  }

  async function buildTranscriptRowsForChat(opts: {
    droneId: string;
    droneName: string;
    chatName: string;
    chatEntry: any;
    droneEntry: any;
    selection: string;
    tailRaw?: string | null;
  }): Promise<BuiltChatTranscriptRows> {
    const agent = inferChatAgent(opts.chatEntry as any, opts.droneEntry);
    if (agent.kind === 'custom') {
      return {
        ok: false,
        statusCode: 410,
        error:
          'transcript is only available for builtin agents (cursor/codex/claude/opencode/pi/blip). Use /output for custom agents.',
        agent,
      };
    }

    const turns = (opts.chatEntry as any).turns as TranscriptTurn[] | undefined;
    const rawList = Array.isArray(turns) ? turns : [];
    const sourceHash = transcriptTurnsSourceHash(rawList);
    const imported = await importTranscriptTurnsFromRegistry({
      droneId: opts.droneId,
      chatName: opts.chatName,
      turns: rawList,
      sourceHash,
    });
    // Sort by prompt time (promptAt/at) so "last" means most recent chronologically,
    // even if reconciliation appends older completions later.
    const list = rawList
      .map((t, idx) => ({ t, idx }))
      .sort((a, b) => {
        const aIso = String((a.t as any)?.promptAt ?? (a.t as any)?.at ?? '');
        const bIso = String((b.t as any)?.promptAt ?? (b.t as any)?.at ?? '');
        const aMs = new Date(aIso).getTime();
        const bMs = new Date(bIso).getTime();
        const aa = Number.isFinite(aMs) ? aMs : 0;
        const bb = Number.isFinite(bMs) ? bMs : 0;
        if (aa !== bb) return aa - bb;
        return a.idx - b.idx;
      })
      .map((x) => x.t);
    const storeCount = imported.available
      ? countTranscriptTurnsFromStore({ droneId: opts.droneId, chatName: opts.chatName })
      : {
          available: false as const,
          count: list.length,
          transcriptVersion: imported.transcriptVersion,
          sourceHash,
        };
    const effectiveTurnCount = storeCount.available ? storeCount.count : list.length;
    const effectiveSourceHash = storeCount.available
      ? storeCount.sourceHash
      : imported.sourceHash || sourceHash;
    const effectiveTranscriptVersion = storeCount.available
      ? storeCount.transcriptVersion
      : imported.transcriptVersion;
    const idxs = parseTurnSelection(opts.selection, effectiveTurnCount, opts.tailRaw);
    const etagSeed = stableResponseFingerprint({
      droneId: opts.droneId,
      droneName: opts.droneName,
      chatName: opts.chatName,
      selection: opts.selection,
      tail: opts.tailRaw ?? '',
      sourceHash: effectiveSourceHash,
      transcriptVersion: effectiveTranscriptVersion,
      agent,
    });
    const etag = `"transcript-${etagSeed}"`;

    const storeRead = imported.available
      ? readTranscriptTurnsFromStore({
          droneId: opts.droneId,
          chatName: opts.chatName,
          indexes: idxs,
        })
      : { available: false as const, turns: [] };
    const selectedTurns = storeRead.available
      ? storeRead.turns.map((item: any) => ({ i: item.index, t: item.turn as any }))
      : idxs.map((i) => ({ i, t: list[i] as any }));

    const transcripts: any[] = [];
    for (const item of selectedTurns) {
      transcripts.push(formatTranscriptRow(item.i, item.t));
    }

    return {
      ok: true,
      selection: opts.selection,
      transcripts,
      agent,
      turnCount: effectiveTurnCount,
      etag,
    };
  }

  async function readChatSnapshot(opts: {
    droneRef: string;
    chatName: string;
    selection: string;
    tailRaw?: string | null;
    includeTranscript: boolean;
    includePending: boolean;
    maintenance?: ChatSnapshotMaintenance;
    includeDockerSnapshotMaintenance?: boolean;
    ifNoneMatch?: string;
    mark?: (name: string) => void;
  }): Promise<ChatSnapshotRead> {
    if (!(globalThis as any).Bun) return await readCanonicalChatSnapshot(opts);

    const resolved = await resolveDroneOrPendingForReadRef(opts.droneRef);
    if (!resolved) {
      return { ok: false, statusCode: 404, error: `unknown drone: ${opts.droneRef}` };
    }

    const context = await buildChatStateContext({
      droneRef: opts.droneRef,
      chatName: opts.chatName,
      resolved,
    });
    if (context.kind === 'pending') {
      const startupPrompts = opts.includePending
        ? await readPendingStartupPrompts({
            droneId: context.droneId,
            chatName: opts.chatName,
          })
        : [];
      return {
        ok: true,
        id: context.droneId,
        name: context.droneName,
        chat: opts.chatName,
        chatId: null,
        selection: opts.selection,
        transcripts: [],
        pending: opts.includePending
          ? pendingSnapshotPrompts(
              context.pendingEntry,
              context.droneId,
              opts.chatName,
              startupPrompts,
            )
          : [],
        model: normalizeChatModel((context.pendingEntry as any)?.model),
        ...chatSnapshotConfig(context.pendingEntry),
        turnCount: 0,
        transcriptEtag: null,
      };
    }
    if (context.kind === 'missing-chat') {
      return { ok: false, statusCode: 404, error: `unknown chat: ${opts.chatName}` };
    }

    const droneId = context.droneId;
    const entry = context.projectedChatEntry;
    const transcriptResult = opts.includeTranscript
      ? await buildTranscriptRowsForChat({
          droneId,
          droneName: context.droneName,
          chatName: opts.chatName,
          chatEntry: entry,
          droneEntry: context.droneEntry,
          selection: opts.selection,
          tailRaw: opts.tailRaw,
        })
      : null;
    if (transcriptResult && !transcriptResult.ok) return transcriptResult;

    if (opts.maintenance === 'run') {
      runChatReadMaintenance({
        droneId,
        chatName: opts.chatName,
        chatEntry: entry,
        includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
      });
    } else if (opts.maintenance === 'schedule') {
      scheduleChatStateReadMaintenance({
        droneId,
        chatName: opts.chatName,
        chatEntry: entry,
        includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
      });
    }

    const agent = transcriptResult?.agent ?? inferChatAgent(entry as any, context.droneEntry);
    const pending = opts.includePending
      ? await buildPendingRowsForChat({ droneId, chatName: opts.chatName })
      : [];
    return {
      ok: true,
      id: droneId,
      name: context.droneName,
      chat: opts.chatName,
      chatId: String((entry as any)?.id ?? '').trim() || null,
      selection: transcriptResult?.selection ?? opts.selection,
      transcripts: transcriptResult?.transcripts ?? [],
      pending,
      agent,
      model: normalizeChatModel((entry as any)?.model),
      ...chatSnapshotConfig(entry),
      turnCount: transcriptResult?.turnCount ?? 0,
      transcriptEtag: transcriptResult?.etag ?? null,
    };
  }

  async function readCanonicalChatSnapshot(opts: {
    droneRef: string;
    chatName: string;
    selection: string;
    tailRaw?: string | null;
    includeTranscript: boolean;
    includePending: boolean;
    maintenance?: ChatSnapshotMaintenance;
    includeDockerSnapshotMaintenance?: boolean;
    ifNoneMatch?: string;
    mark?: (name: string) => void;
  }): Promise<ChatSnapshotRead> {
    const resolved = await resolveCanonicalDroneOrPendingForReadRef(opts.droneRef);
    opts.mark?.('lifecycle');
    if (!resolved) return { ok: false, statusCode: 404, error: `unknown drone: ${opts.droneRef}` };
    const droneName =
      String(
        (resolved.kind === 'real' ? resolved.drone : resolved.pending)?.name ?? opts.droneRef,
      ).trim() || opts.droneRef;
    if (resolved.kind === 'pending') {
      const startupPrompts = opts.includePending
        ? normalizePendingStartupPrompts(
            (resolved.pending as any)?.startupQueuedPrompts,
            opts.chatName,
          ).map(startupPromptToPendingPrompt)
        : [];
      const pending = opts.includePending
        ? pendingSnapshotPrompts(resolved.pending, resolved.id, opts.chatName, startupPrompts)
        : [];
      return {
        ok: true,
        id: resolved.id,
        name: droneName,
        chat: opts.chatName,
        chatId: null,
        selection: opts.selection,
        transcripts: [],
        pending,
        model: normalizeChatModel((resolved.pending as any)?.model),
        ...chatSnapshotConfig(resolved.pending),
        turnCount: 0,
        transcriptEtag: null,
      };
    }

    const version = readChatVersionFromStore({
      droneId: resolved.id,
      chatName: opts.chatName,
      includePending: opts.includePending,
    });
    opts.mark?.('version');
    if (!version.chat)
      return { ok: false, statusCode: 404, error: `unknown chat: ${opts.chatName}` };
    const agent = inferChatAgent(version.chat, resolved.drone);
    if (opts.includeTranscript && agent.kind === 'custom') {
      return {
        ok: false,
        statusCode: 410,
        error:
          'transcript is only available for builtin agents (cursor/codex/claude/opencode/pi/blip). Use /output for custom agents.',
        agent,
      };
    }
    const indexes = opts.includeTranscript
      ? parseTurnSelection(opts.selection, version.turnCount, opts.tailRaw)
      : [];
    const responseEtag = `"sha256-${stableResponseFingerprint({
      droneId: resolved.id,
      droneName,
      chatName: opts.chatName,
      selection: opts.selection,
      tail: opts.tailRaw ?? '',
      includeTranscript: opts.includeTranscript,
      includePending: opts.includePending,
      chatSourceHash: version.chatSourceHash,
      transcriptVersion: version.transcriptVersion,
      transcriptSourceHash: version.transcriptSourceHash,
      pendingVersion: version.pendingVersion,
    })}"`;
    const requestedEtags = String(opts.ifNoneMatch ?? '')
      .split(',')
      .map((item) => item.trim());
    if (requestedEtags.includes(responseEtag) || requestedEtags.includes('*')) {
      opts.mark?.('conditional');
      return {
        ok: true,
        id: resolved.id,
        name: droneName,
        chat: opts.chatName,
        chatId: String((version.chat as any)?.id ?? '').trim() || null,
        selection: opts.selection,
        transcripts: [],
        pending: [],
        agent,
        model: normalizeChatModel((version.chat as any)?.model),
        ...chatSnapshotConfig(version.chat),
        turnCount: version.turnCount,
        transcriptEtag: responseEtag,
        responseEtag,
        notModified: true,
      };
    }

    const rows = readChatRowsFromStore({
      droneId: resolved.id,
      chatName: opts.chatName,
      indexes,
      includePending: opts.includePending,
    });
    opts.mark?.('rows');
    const transcripts = rows.turns.map((item: any) => formatTranscriptRow(item.index, item.turn));
    const pending = opts.includePending
      ? pruneCompletedPendingPrompts(rows.pending as PendingPrompt[], rows.pendingTurns, {
          keepRecentlyCompleted: true,
        })
      : [];
    opts.mark?.('format');
    const maintenanceEntry = { ...version.chat, pendingPrompts: pending };
    if (opts.maintenance === 'run') {
      runChatReadMaintenance({
        droneId: resolved.id,
        chatName: opts.chatName,
        chatEntry: maintenanceEntry,
        includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
      });
    } else if (opts.maintenance === 'schedule') {
      scheduleChatStateReadMaintenance({
        droneId: resolved.id,
        chatName: opts.chatName,
        chatEntry: maintenanceEntry,
        includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
      });
    }
    return {
      ok: true,
      id: resolved.id,
      name: droneName,
      chat: opts.chatName,
      chatId: String((version.chat as any)?.id ?? '').trim() || null,
      selection: opts.selection,
      transcripts,
      pending,
      agent,
      model: normalizeChatModel((version.chat as any)?.model),
      ...chatSnapshotConfig(version.chat),
      turnCount: version.turnCount,
      transcriptEtag: responseEtag,
      responseEtag,
    };
  }

  function chatSnapshotResponseBody(
    snapshot: Extract<ChatSnapshotRead, { ok: true }>,
    opts?: { includeTranscriptMeta?: boolean },
  ) {
    return {
      ok: true,
      id: snapshot.id,
      name: snapshot.name,
      chat: snapshot.chat,
      chatId: snapshot.chatId,
      selection: snapshot.selection,
      transcripts: snapshot.transcripts,
      pending: snapshot.pending,
      ...(snapshot.agent ? { agent: snapshot.agent } : {}),
      model: snapshot.model,
      reasoning: snapshot.reasoning,
      agentPermissionMode: snapshot.agentPermissionMode,
      approvalPolicy: snapshot.approvalPolicy,
      ...(opts?.includeTranscriptMeta
        ? {
            transcript: {
              selection: snapshot.selection,
              total: snapshot.turnCount,
              etag: snapshot.transcriptEtag,
              items: snapshot.transcripts,
            },
            pendingPrompts: {
              items: snapshot.pending,
            },
          }
        : {}),
    };
  }

  async function setChatAgentConfig(opts: {
    droneId: string;
    chatName: string;
    agent?: ChatAgentConfig;
    setProvider?: boolean;
    provider?: string | null;
    setModel?: boolean;
    model?: string | null;
    setReasoning?: boolean;
    reasoning?: string | null;
    setAgentPermissionMode?: boolean;
    agentPermissionMode?: AgentPermissionMode;
    setApprovalPolicy?: boolean;
    approvalPolicy?: AgentApprovalPolicy;
    setDockerSnapshotAfterAgentMessageEnabled?: boolean;
    dockerSnapshotAfterAgentMessageEnabled?: boolean;
    setBlipClonesEnabled?: boolean;
    blipClonesEnabled?: boolean;
    setDroneHubMcpAccessScope?: boolean;
    droneHubMcpAccessScope?: unknown;
    addDroneHubMcpAccessDroneIds?: string[];
  }) {
    const registry: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? registry?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    await importDroneChatsFromRegistry({ droneId, chats: d.chats });
    await updateChatInStore({
      droneId,
      chatName: opts.chatName,
      update: (current: any) => {
        const cur = { ...current };
        const effectiveAgent = opts.agent ?? inferChatAgent(cur, d);
        if (
          opts.setDockerSnapshotAfterAgentMessageEnabled &&
          opts.dockerSnapshotAfterAgentMessageEnabled
        ) {
          if (droneRuntime(d) === 'host') {
            const error: Error & { statusCode?: number } = new Error(
              'Docker snapshots are only supported for container drones',
            );
            error.statusCode = 400;
            throw error;
          }
          if (d?.persistVolume !== false) {
            const error: Error & { statusCode?: number } = new Error(
              'Docker snapshots require this drone to be created with Persist volume off',
            );
            error.statusCode = 400;
            throw error;
          }
          if (effectiveAgent.kind !== 'builtin') {
            const error: Error & { statusCode?: number } = new Error(
              'Docker snapshots are only supported for builtin transcript chats',
            );
            error.statusCode = 400;
            throw error;
          }
        }
        if (opts.agent) {
          assertChatAgentSupportedForDrone(d, opts.agent);
          cur.agent = opts.agent as any;
          if (normalizeAgentPermissionMode(cur.agentPermissionMode) !== 'execute') {
            try {
              assertReadOnlySupportedForAgent(opts.agent);
            } catch {
              delete cur.agentPermissionMode;
            }
          }
          const storedApprovalPolicy: AgentApprovalPolicy =
            cur.approvalPolicy === 'auto' || cur.approvalPolicy === 'none'
              ? cur.approvalPolicy
              : 'ask';
          if (
            !supportsApprovalPolicy(opts.agent) ||
            (storedApprovalPolicy === 'auto' &&
              !(opts.agent.kind === 'builtin' && opts.agent.id === 'codex'))
          ) {
            delete cur.approvalPolicy;
          }
        }
        if (opts.setProvider) {
          if (effectiveAgent.kind !== 'native') {
            const error: Error & { statusCode?: number } = new Error(
              'provider is only supported for Built-in chats',
            );
            error.statusCode = 400;
            throw error;
          }
          const provider = String(opts.provider ?? '').trim().toLowerCase();
          if (provider === 'openai' || provider === 'codex' || provider === 'gemini') {
            cur.nativeProvider = provider;
          } else {
            delete cur.nativeProvider;
          }
        }
        if (opts.setModel) {
          if (opts.model) cur.model = opts.model;
          else delete cur.model;
        }
        if (opts.setReasoning) {
          const reasoning = normalizeChatReasoning(opts.reasoning);
          if (reasoning) {
            if (
              effectiveAgent.kind !== 'native' &&
              (effectiveAgent.kind !== 'builtin' ||
                (effectiveAgent.id !== 'codex' && effectiveAgent.id !== 'blip'))
            ) {
              const error: Error & { statusCode?: number } = new Error(
                'reasoning is only supported for Built-in, Codex, and Blip chats',
              );
              error.statusCode = 400;
              throw error;
            }
            cur.reasoning = reasoning;
          } else {
            delete cur.reasoning;
          }
        }
        if (opts.setAgentPermissionMode) {
          const mode = normalizeAgentPermissionMode(opts.agentPermissionMode);
          if (mode !== 'execute') assertReadOnlySupportedForAgent(effectiveAgent);
          if (mode !== 'execute') cur.agentPermissionMode = mode;
          else delete cur.agentPermissionMode;
        }
        if (opts.setApprovalPolicy) {
          const policy =
            opts.approvalPolicy === 'auto' || opts.approvalPolicy === 'none'
              ? opts.approvalPolicy
              : 'ask';
          assertApprovalPolicySupportedForAgent(policy, effectiveAgent);
          if (policy !== 'ask') cur.approvalPolicy = policy;
          else delete cur.approvalPolicy;
        }
        if (opts.setDockerSnapshotAfterAgentMessageEnabled) {
          if (opts.dockerSnapshotAfterAgentMessageEnabled) {
            cur.dockerSnapshotAfterAgentMessageEnabled = true;
            if (
              typeof cur.dockerSnapshotAfterAgentMessageEnabledAt !== 'string' ||
              !String(cur.dockerSnapshotAfterAgentMessageEnabledAt).trim()
            ) {
              cur.dockerSnapshotAfterAgentMessageEnabledAt = nowIso();
            }
          } else {
            cur.dockerSnapshotAfterAgentMessageEnabled = false;
            delete cur.dockerSnapshotAfterAgentMessageEnabledAt;
          }
        }
        if (opts.setBlipClonesEnabled) {
          cur.blipClonesEnabled = opts.blipClonesEnabled !== false;
        }
        if (
          opts.setDroneHubMcpAccessScope ||
          (opts.addDroneHubMcpAccessDroneIds?.length ?? 0) > 0
        ) {
          if (typeof cur.id !== 'string' || !cur.id.trim()) cur.id = crypto.randomUUID();
          const currentScope = normalizeMcpChatAccessScope(cur.droneHubMcpAccessScope, droneId);
          cur.droneHubMcpAccessScope =
            (opts.addDroneHubMcpAccessDroneIds?.length ?? 0) > 0
              ? normalizeMcpChatAccessScope(
                  {
                    ...currentScope,
                    droneIds: [
                      ...currentScope.droneIds,
                      ...(opts.addDroneHubMcpAccessDroneIds ?? []),
                    ],
                    updatedAt: nowIso(),
                  },
                  droneId,
                )
              : normalizeMcpChatAccessScope(opts.droneHubMcpAccessScope, droneId);
        }
        return cur;
      },
    });
    await projectCanonicalChatToRegistry(droneId, opts.chatName);
    const updatedChat = readChatFromStore({ droneId, chatName: opts.chatName }).chat;
    const updatedAgent = inferChatAgent(updatedChat, d);
    if (
      opts.setApprovalPolicy &&
      opts.approvalPolicy === 'none' &&
      updatedChat?.approvalPolicy === 'none' &&
      updatedAgent.kind === 'builtin' &&
      updatedAgent.id === 'codex'
    ) {
      // The next turn will launch Codex with approvalPolicy=never. Also release
      // approvals from the current turn, which was launched with its old policy.
      await resolvePendingCodexApprovalsForNeverAsk({ droneId, chatName: opts.chatName });
      // Catch an approval that exists in the daemon but has not reached the Hub's
      // pending projection yet. Reconciliation applies the same never-ask rule.
      enqueueReconcile(droneId, opts.chatName);
    }
  }

  async function resolveChatTmuxCommand(opts: {
    droneId: string;
    chatName: string;
  }): Promise<string> {
    const { d, chat } = await getChatEntry(opts);
    const agent = inferChatAgent(chat, d);
    if (agent.kind === 'builtin') return resolveBuiltinTmuxCommand(agent.id);
    if (agent.kind === 'native') throw new Error('native chats do not use tmux sessions');
    return agent.command || resolveHubAgentCommand();
  }

  async function ensureHubChatSessionRunning(opts: {
    containerName: string;
    chatName: string;
    command: string;
    cwd?: string | null;
    envVars?: Record<string, string> | null;
  }) {
    const sessionName = hubChatSessionName(opts.chatName || 'default');
    const agentCmd = String(opts.command || '').trim() || resolveHubAgentCommand();
    return await ensureHubSessionRunning({
      containerName: opts.containerName,
      sessionName,
      command: agentCmd,
      cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
      envVars: opts.envVars ?? null,
    });
  }

  async function copyChatAttachmentsToHost(opts: {
    hostDir: string;
    attachments: ChatImageAttachment[];
  }): Promise<void> {
    const list = Array.isArray(opts.attachments) ? opts.attachments : [];
    if (list.length === 0) return;
    const dir = path.resolve(String(opts.hostDir ?? '').trim() || os.homedir());
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const a of list) {
      const filePath = path.join(
        dir,
        path.basename(String(a.fileName ?? '').trim() || 'attachment.bin'),
      );
      const buf = Buffer.from(String(a.dataBase64 ?? ''), 'base64');
      if (!buf || buf.length === 0) throw new Error('attachment decode failed');
      await fs.writeFile(filePath, buf, { mode: 0o600 });
    }
  }

  function parseTurnSelection(selRaw: string, turnsLen: number, tailRaw?: string | null): number[] {
    const tailText = String(tailRaw ?? '').trim();
    if (tailText) {
      const tail = Number(tailText);
      if (!Number.isFinite(tail) || tail < 1 || Math.floor(tail) !== tail) {
        throw new Error('invalid tail (expected positive integer)');
      }
      const start = Math.max(0, turnsLen - tail);
      return Array.from({ length: turnsLen - start }, (_, i) => start + i);
    }
    const sel = String(selRaw || 'last')
      .trim()
      .toLowerCase();
    if (sel.startsWith('page:')) {
      const [, beforeText = '', limitText = '100'] = sel.split(':');
      const before = beforeText ? Number(beforeText) : turnsLen;
      const limit = Number(limitText);
      if (!Number.isSafeInteger(before) || before < 0) {
        throw new Error('invalid before cursor (expected non-negative integer)');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('invalid page limit (expected integer from 1 to 100)');
      }
      const end = Math.min(before, turnsLen);
      const start = Math.max(0, end - limit);
      return Array.from({ length: end - start }, (_, index) => start + index);
    }
    if (sel === 'all') return Array.from({ length: turnsLen }, (_, i) => i);
    if (sel === 'last') return turnsLen > 0 ? [turnsLen - 1] : [];
    const n = Number(sel);
    if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n)
      throw new Error('invalid turn (expected 1-based integer, last, or all)');
    if (n > turnsLen) throw new Error(`turn out of range (max ${turnsLen})`);
    return [n - 1];
  }

  function parseUuid(text: string): string | null {
    const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
  }

  function openCodeSessionTitle(droneName: string, chatName: string): string {
    const d = sanitizeTmuxSessionName(droneName || 'drone');
    const c = sanitizeTmuxSessionName(chatName || 'default');
    return `drone-hub-${d}-${c}`;
  }

  async function ensureCursorChatId(opts: {
    droneId: string;
    containerName: string;
    chatName: string;
    runtime: DroneRuntime;
    cwd?: string | null;
  }): Promise<string> {
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const existing =
      typeof (chat as any).chatId === 'string' ? String((chat as any).chatId).trim() : '';
    if (existing) return existing;
    const r =
      opts.runtime === 'host'
        ? await runHostCommand('bash', ['-lc', 'agent create-chat'], {
            cwd: String(opts.cwd ?? '').trim() || undefined,
            timeoutMs: defaultSeedBootstrapTimeoutMs(),
          })
        : await dvmExec(
            opts.containerName,
            'bash',
            [
              '-lc',
              [
                ...buildContainerManagedEnvLines({ runtime: 'container', cwd: opts.cwd ?? null }),
                'agent create-chat',
              ].join('\n'),
            ],
            {
              timeoutMs: defaultSeedBootstrapTimeoutMs(),
            },
          );
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'agent create-chat failed').trim());
    const id = parseUuid(`${r.stdout}\n${r.stderr}`) ?? '';
    if (!id) {
      throw new Error(
        `failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`,
      );
    }
    const patched = await patchChatMetadataInStore({
      droneId: normalizeDroneIdentity(opts.droneId),
      chatName: opts.chatName,
      patch: { setIfMissing: { chatId: id } },
    });
    await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
    return String(patched.metadata?.chatId ?? id).trim() || id;
  }

  async function ensureClaudeSessionId(opts: {
    droneId: string;
    chatName: string;
  }): Promise<string> {
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const existing =
      typeof (chat as any).claudeSessionId === 'string'
        ? String((chat as any).claudeSessionId).trim()
        : '';
    if (existing) return existing;
    const id = crypto.randomUUID();
    const patched = await patchChatMetadataInStore({
      droneId: normalizeDroneIdentity(opts.droneId),
      chatName: opts.chatName,
      patch: { setIfMissing: { claudeSessionId: id } },
    });
    await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
    return String(patched.metadata?.claudeSessionId ?? id).trim() || id;
  }

  function parseOpenCodeSessionList(stdout: string, preferredTitle?: string | null): string | null {
    let parsed: any = null;
    try {
      parsed = JSON.parse(String(stdout ?? ''));
    } catch {
      return null;
    }
    const pick = (v: any): { id: string | null; title: string | null } => {
      const id = String(v?.id ?? v?.sessionId ?? v?.sessionID ?? v?.session_id ?? '').trim();
      const title = String(v?.title ?? v?.name ?? '').trim();
      return { id: id || null, title: title || null };
    };
    const preferred = String(preferredTitle ?? '')
      .trim()
      .toLowerCase();
    const all: Array<{ id: string | null; title: string | null }> = [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        all.push(pick(item));
      }
    } else if (Array.isArray(parsed?.sessions)) {
      for (const item of parsed.sessions) {
        all.push(pick(item));
      }
    } else if (Array.isArray(parsed?.items)) {
      for (const item of parsed.items) {
        all.push(pick(item));
      }
    } else {
      all.push(pick(parsed));
    }

    if (preferred) {
      for (const item of all) {
        if (!item.id) continue;
        if (
          String(item.title ?? '')
            .trim()
            .toLowerCase() === preferred
        ) {
          return item.id;
        }
      }
    }

    for (const item of all) {
      if (item.id) return item.id;
    }
    return null;
  }

  function parseOpenCodeSessionIdFromListOutputs(opts: {
    stdout: string;
    stderr: string;
    preferredTitle?: string | null;
  }): string | null {
    const { stdout, stderr, preferredTitle } = opts;
    const candidates = [
      parseOpenCodeSessionList(String(stdout ?? '').trim(), preferredTitle),
      parseOpenCodeSessionList(String(stderr ?? '').trim(), preferredTitle),
    ];
    for (const id of candidates) {
      if (id) return id;
    }
    if (preferredTitle) {
      for (const id of [
        parseOpenCodeSessionList(String(stdout ?? '').trim()),
        parseOpenCodeSessionList(String(stderr ?? '').trim()),
      ]) {
        if (id) return id;
      }
    }
    return null;
  }

  async function ensureOpenCodeSessionId(opts: {
    droneId: string;
    droneLabel?: string | null;
    containerName: string;
    chatName: string;
  }): Promise<string | null> {
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const existing =
      typeof (chat as any).openCodeSessionId === 'string'
        ? String((chat as any).openCodeSessionId).trim()
        : '';
    if (existing) return existing;

    const preferredTitle = openCodeSessionTitle(
      String(opts.droneLabel ?? opts.droneId),
      opts.chatName,
    );
    const listCmd = 'opencode session list --max-count 30 --format json';
    const r = await dvmExec(opts.containerName, 'bash', ['-lc', listCmd], {
      timeoutMs: defaultSeedBootstrapTimeoutMs(),
    });
    if (r.code !== 0) return null;
    const id = parseOpenCodeSessionIdFromListOutputs({
      stdout: String(r.stdout ?? ''),
      stderr: String(r.stderr ?? ''),
      preferredTitle,
    });
    if (!id) return null;

    const patched = await patchChatMetadataInStore({
      droneId: normalizeDroneIdentity(opts.droneId),
      chatName: opts.chatName,
      patch: { setIfMissing: { openCodeSessionId: id } },
    });
    await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
    return String(patched.metadata?.openCodeSessionId ?? id).trim() || id;
  }

  async function recordTranscriptTurn(opts: {
    droneName: string;
    chatName: string;
    turn: { at: string; id?: string; prompt: string; ok: boolean; output: string; error?: string };
    agentPatch?: Partial<{
      codexThreadId: string;
      claudeSessionId: string;
      openCodeSessionId: string;
      piSessionId: string;
      blipSessionId: string;
    }>;
  }): Promise<void> {
    const reg = await loadRegistry();
    const d = (reg as any)?.drones?.[opts.droneName];
    if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
    const droneId = String(d?.id ?? opts.droneName).trim() || opts.droneName;
    await applyChatReconciliationInStore({
      droneId,
      chatName: opts.chatName,
      metadataPatch: opts.agentPatch ? { set: opts.agentPatch } : undefined,
      turns: [opts.turn],
    });
    await projectCanonicalChatToRegistry(droneId, opts.chatName);
  }

  async function updateTranscriptTurnById(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    update: (turn: TranscriptTurn) => TranscriptTurn;
  }): Promise<boolean> {
    const result = await updateTranscriptTurnInStore({
      droneId: normalizeDroneIdentity(opts.droneId),
      chatName: normalizeChatName(opts.chatName),
      turnId: opts.promptId,
      update: (turn: any) => opts.update(turn as TranscriptTurn),
    });
    if (result.changed) await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
    return result.changed;
  }

  return {
    HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
    HUB_WEB_TERMINAL_MAX_BYTES,
    HUB_WEB_TERMINAL_MAX_TAIL_LINES,
    assertReadOnlySupportedForAgent,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    clampInt,
    clampIntParam,
    close: () => chatStateMaintenanceScheduler.close(),
    copyChatAttachmentsToHost,
    ensureChatEntry,
    ensureChatEntryCopiedFromChat,
    ensureClaudeSessionId,
    ensureCursorChatId,
    ensureHubChatSessionRunning,
    ensureHubSessionRunning,
    ensureOpenCodeSessionId,
    getChatEntry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    openCodeSessionTitle,
    parseOptionalNonNegativeInt,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    readChatSnapshot,
    resolveChatTmuxCommand,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
    start: () => chatStateMaintenanceScheduler.start(),
    updateTranscriptTurnById,
  };
}
