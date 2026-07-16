import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatImageAttachment } from './chat-attachments';
import { ChatStateMaintenanceScheduler } from './chat-state-maintenance';
import type { AgentPermissionMode, ChatAgentConfig } from './chat-types';
import type { PendingPrompt } from './drone-pending-prompts';
import type { DroneRuntime } from '../host/runtime';
import type { ResolvedOrPendingDrone } from './drone-lifecycle-service';

type TranscriptTurn = any;

export type ChatSessionRuntimeDependencies = {
  appendPromptAutomationHistoryRows: any;
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
  getPromptAutomationLane: any;
  hubChatSessionName: any;
  hubLog: any;
  importChatFromRegistry: any;
  importDroneChatsFromRegistry: any;
  importTranscriptTurnsFromRegistry: any;
  isGeneratedChatName: any;
  listChatsFromStore: any;
  loadRegistry: any;
  migrateInMemoryChatStateForRename: any;
  normalizeAgentMessageAutoContinueTurnState: any;
  normalizeAgentPermissionMode: any;
  normalizeAgentPlan: any;
  normalizeAgentSuggestionTurnState: any;
  normalizeBuiltinAgentId: any;
  normalizeChatImageAttachmentRefs: any;
  normalizeChatModel: any;
  normalizeChatName: any;
  normalizeChatReasoning: any;
  normalizeContainerPath: any;
  normalizeDockerSnapshot: any;
  normalizeDroneIdentity: any;
  normalizePendingStartupPrompts: any;
  normalizePromptAutomationMeta: any;
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
  resolveEffectiveAgentMessageAutoContinueSettings: any;
  resolveEffectiveAgentSuggestionSettings: any;
  resolveHubAgentCommand: any;
  resolveNameSuggestionLlmSettings: any;
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
    appendPromptAutomationHistoryRows,
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
    getPromptAutomationLane,
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    importDroneChatsFromRegistry,
    importTranscriptTurnsFromRegistry,
    isGeneratedChatName,
    listChatsFromStore,
    loadRegistry,
    migrateInMemoryChatStateForRename,
    normalizeAgentMessageAutoContinueTurnState,
    normalizeAgentPermissionMode,
    normalizeAgentPlan,
    normalizeAgentSuggestionTurnState,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachmentRefs,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDockerSnapshot,
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    normalizePromptAutomationMeta,
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
    resolveEffectiveAgentMessageAutoContinueSettings,
    resolveEffectiveAgentSuggestionSettings,
    resolveHubAgentCommand,
    resolveNameSuggestionLlmSettings,
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

  function buildNewChatEntry(opts: {
    droneEntry: any;
    createdAt: string;
    sourceChatEntry?: any;
    autoContinueEnabledByDefault: boolean;
    agentSuggestionEnabledByDefault?: boolean;
  }) {
    const agent = opts.sourceChatEntry
      ? inferChatAgent(opts.sourceChatEntry, opts.droneEntry)
      : defaultChatAgentConfigForDrone(opts.droneEntry);
    const entry: any = {
      createdAt: opts.createdAt,
      agent,
      ...(opts.sourceChatEntry &&
      normalizeAgentPermissionMode(opts.sourceChatEntry?.agentPermissionMode) === 'read-only'
        ? { agentPermissionMode: 'read-only' }
        : {}),
      ...(opts.sourceChatEntry && normalizeChatModel(opts.sourceChatEntry?.model)
        ? { model: normalizeChatModel(opts.sourceChatEntry?.model) }
        : {}),
      ...(opts.sourceChatEntry && normalizeChatReasoning(opts.sourceChatEntry?.reasoning)
        ? { reasoning: normalizeChatReasoning(opts.sourceChatEntry?.reasoning) }
        : {}),
    };
    if (opts.autoContinueEnabledByDefault && agent.kind === 'builtin') {
      entry.agentMessageAutoContinueEnabled = true;
      entry.agentMessageAutoContinueEnabledAt = opts.createdAt;
    }
    if (opts.agentSuggestionEnabledByDefault && agent.kind === 'builtin') {
      entry.agentSuggestionEnabled = true;
      entry.agentSuggestionEnabledAt = opts.createdAt;
    }
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
    const autoContinueEnabledByDefault = (await resolveEffectiveAgentMessageAutoContinueSettings())
      .enabledByDefault;
    const agentSuggestionEnabledByDefault = (await resolveEffectiveAgentSuggestionSettings())
      .enabledByDefault;
    const reg: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    if (!(globalThis as any).Bun) {
      await importDroneChatsFromRegistry({ droneId, chats: d.chats });
      if (readChatFromStore({ droneId, chatName: opts.chatName }).chat) return;
      await upsertChatInStore({
        droneId,
        chatName: opts.chatName,
        chatEntry: buildNewChatEntry({
          droneEntry: d,
          createdAt: new Date().toISOString(),
          autoContinueEnabledByDefault,
          agentSuggestionEnabledByDefault,
        }),
      });
      return;
    }
    await updateRegistry((registry: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const drone = droneId ? registry?.drones?.[droneId] : null;
      if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
      drone.chats = drone.chats ?? {};
      if (!drone.chats[opts.chatName]) {
        // Child drones default to Codex; other drones keep Cursor.
        // NOTE: chatId is intentionally omitted (it is created lazily on first prompt).
        drone.chats[opts.chatName] = buildNewChatEntry({
          droneEntry: drone,
          createdAt: new Date().toISOString(),
          autoContinueEnabledByDefault,
          agentSuggestionEnabledByDefault,
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
    const autoContinueEnabledByDefault = (await resolveEffectiveAgentMessageAutoContinueSettings())
      .enabledByDefault;
    const agentSuggestionEnabledByDefault = (await resolveEffectiveAgentSuggestionSettings())
      .enabledByDefault;
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
          autoContinueEnabledByDefault,
          agentSuggestionEnabledByDefault,
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
            autoContinueEnabledByDefault,
            agentSuggestionEnabledByDefault,
          });
        } else {
          throw new Error(`unknown chat: ${copyFromChatName}`);
        }
      }
      let entry: any = buildNewChatEntry({
        droneEntry: d,
        createdAt,
        autoContinueEnabledByDefault,
        agentSuggestionEnabledByDefault,
      });
      if (copyFromChatName) {
        const source = d.chats?.[copyFromChatName];
        if (!source) throw new Error(`unknown chat: ${copyFromChatName}`);
        entry = buildNewChatEntry({
          droneEntry: d,
          createdAt,
          sourceChatEntry: source,
          autoContinueEnabledByDefault,
          agentSuggestionEnabledByDefault,
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
    if (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip')) return;
    const label = agent.kind === 'builtin' ? agent.id : agent.label || agent.id || 'custom agent';
    const error: Error & { statusCode?: number } = new Error(
      `read-only mode is currently supported for Codex and Blip chats only (selected: ${label})`,
    );
    error.statusCode = 400;
    throw error;
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
    const stored = readChatFromStore({ droneId, chatName });
    if (!stored.available || !stored.chat) return;
    const { turns, pendingPrompts: _canonicalPendingPrompts, ...canonicalMetadata } = stored.chat;
    await updateRegistry((registry: any) => {
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
    const chats = Object.fromEntries(
      listChatsFromStore({ droneId }).chats.flatMap((chatName: string) => {
        const stored = readChatFromStore({ droneId, chatName });
        return stored.available && stored.chat ? [[chatName, stored.chat]] : [];
      }),
    );
    await updateRegistry((registry: any) => {
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
    await importChatFromRegistry({ droneId, chatName, chatEntry });
    const read = readChatFromStore({ droneId, chatName });
    return read.available ? read.chat : chatEntry;
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
        selection: string;
        transcripts: any[];
        pending: PendingPrompt[];
        agent?: ChatAgentConfig;
        model: string | null;
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
    return appendPromptAutomationHistoryRows(
      (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).slice(-50),
      getPromptAutomationLane(opts.droneId, opts.chatName),
    );
  }

  function formatTranscriptRow(turnIndex: number, turn: any): any {
    const at = String(turn?.at ?? new Date().toISOString());
    const promptAt =
      typeof turn?.promptAt === 'string' && turn.promptAt.trim()
        ? String(turn.promptAt).trim()
        : undefined;
    const completedAt =
      typeof turn?.completedAt === 'string' && turn.completedAt.trim()
        ? String(turn.completedAt).trim()
        : undefined;
    const id = typeof turn?.id === 'string' && turn.id.trim() ? String(turn.id).trim() : undefined;
    const prompt = String(turn?.prompt ?? '');
    const model = normalizeChatModel((turn as any)?.model);
    const reasoning = normalizeChatReasoning((turn as any)?.reasoning);
    const attachments = normalizeChatImageAttachmentRefs((turn as any)?.attachments);
    const automation = normalizePromptAutomationMeta((turn as any)?.automation);
    const agentMessageAutoContinue = normalizeAgentMessageAutoContinueTurnState(
      (turn as any)?.agentMessageAutoContinue,
    );
    const agentSuggestion = normalizeAgentSuggestionTurnState((turn as any)?.agentSuggestion);
    const dockerSnapshot = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
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
    const output = ok ? String(turn?.output ?? '') : '';
    const error = ok ? undefined : String(turn?.error ?? 'failed');
    return {
      turn: turnIndex + 1,
      at,
      ...(promptAt ? { promptAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(id ? { id } : {}),
      prompt,
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(automation ? { automation } : {}),
      ...(agentMessageAutoContinue ? { agentMessageAutoContinue } : {}),
      ...(agentSuggestion ? { agentSuggestion } : {}),
      ...(agentPlan ? { agentPlan } : {}),
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
      return {
        ok: true,
        id: context.droneId,
        name: context.droneName,
        chat: opts.chatName,
        selection: opts.selection,
        transcripts: [],
        pending: opts.includePending
          ? await readPendingStartupPrompts({ droneId: context.droneId, chatName: opts.chatName })
          : [],
        model: normalizeChatModel((context.pendingEntry as any)?.model),
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
      selection: transcriptResult?.selection ?? opts.selection,
      transcripts: transcriptResult?.transcripts ?? [],
      pending,
      agent,
      model: normalizeChatModel((entry as any)?.model),
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
      const pending = opts.includePending
        ? normalizePendingStartupPrompts(
            (resolved.pending as any)?.startupQueuedPrompts,
            opts.chatName,
          ).map(startupPromptToPendingPrompt)
        : [];
      return {
        ok: true,
        id: resolved.id,
        name: droneName,
        chat: opts.chatName,
        selection: opts.selection,
        transcripts: [],
        pending,
        model: normalizeChatModel((resolved.pending as any)?.model),
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
    const automationLane = opts.includePending
      ? getPromptAutomationLane(resolved.id, opts.chatName)
      : null;
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
      automationLane,
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
        selection: opts.selection,
        transcripts: [],
        pending: [],
        agent,
        model: normalizeChatModel((version.chat as any)?.model),
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
      ? appendPromptAutomationHistoryRows(
          pruneCompletedPendingPrompts(rows.pending as PendingPrompt[], rows.pendingTurns, {
            keepRecentlyCompleted: true,
          }),
          automationLane,
        )
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
      selection: opts.selection,
      transcripts,
      pending,
      agent,
      model: normalizeChatModel((version.chat as any)?.model),
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
      selection: snapshot.selection,
      transcripts: snapshot.transcripts,
      pending: snapshot.pending,
      ...(snapshot.agent ? { agent: snapshot.agent } : {}),
      model: snapshot.model,
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
    setModel?: boolean;
    model?: string | null;
    setReasoning?: boolean;
    reasoning?: string | null;
    setAgentPermissionMode?: boolean;
    agentPermissionMode?: AgentPermissionMode;
    setAgentMessageAutoContinueEnabled?: boolean;
    agentMessageAutoContinueEnabled?: boolean;
    setAgentSuggestionEnabled?: boolean;
    agentSuggestionEnabled?: boolean;
    setDockerSnapshotAfterAgentMessageEnabled?: boolean;
    dockerSnapshotAfterAgentMessageEnabled?: boolean;
    setBlipClonesEnabled?: boolean;
    blipClonesEnabled?: boolean;
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
          opts.setAgentMessageAutoContinueEnabled &&
          opts.agentMessageAutoContinueEnabled &&
          effectiveAgent.kind !== 'builtin'
        ) {
          const error: Error & { statusCode?: number } = new Error(
            'agentMessageAutoContinueEnabled is only supported for builtin transcript chats',
          );
          error.statusCode = 400;
          throw error;
        }
        if (
          opts.setAgentSuggestionEnabled &&
          opts.agentSuggestionEnabled &&
          effectiveAgent.kind !== 'builtin'
        ) {
          const error: Error & { statusCode?: number } = new Error(
            'agentSuggestionEnabled is only supported for builtin transcript chats',
          );
          error.statusCode = 400;
          throw error;
        }
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
          if (normalizeAgentPermissionMode(cur.agentPermissionMode) === 'read-only') {
            try {
              assertReadOnlySupportedForAgent(opts.agent);
            } catch {
              delete cur.agentPermissionMode;
            }
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
              effectiveAgent.kind !== 'builtin' ||
              (effectiveAgent.id !== 'codex' && effectiveAgent.id !== 'blip')
            ) {
              const error: Error & { statusCode?: number } = new Error(
                'reasoning is only supported for Codex and Blip chats',
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
          if (mode === 'read-only') assertReadOnlySupportedForAgent(effectiveAgent);
          if (mode === 'read-only') cur.agentPermissionMode = 'read-only';
          else delete cur.agentPermissionMode;
        }
        if (opts.setAgentMessageAutoContinueEnabled) {
          if (opts.agentMessageAutoContinueEnabled) {
            cur.agentMessageAutoContinueEnabled = true;
            if (
              typeof cur.agentMessageAutoContinueEnabledAt !== 'string' ||
              !String(cur.agentMessageAutoContinueEnabledAt).trim()
            ) {
              cur.agentMessageAutoContinueEnabledAt = nowIso();
            }
          } else {
            delete cur.agentMessageAutoContinueEnabled;
            delete cur.agentMessageAutoContinueEnabledAt;
          }
        }
        if (opts.setAgentSuggestionEnabled) {
          if (opts.agentSuggestionEnabled) {
            cur.agentSuggestionEnabled = true;
            if (
              typeof cur.agentSuggestionEnabledAt !== 'string' ||
              !String(cur.agentSuggestionEnabledAt).trim()
            ) {
              cur.agentSuggestionEnabledAt = nowIso();
            }
          } else {
            delete cur.agentSuggestionEnabled;
            delete cur.agentSuggestionEnabledAt;
          }
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
        return cur;
      },
    });
    await projectCanonicalChatToRegistry(droneId, opts.chatName);
  }

  async function resolveChatTmuxCommand(opts: {
    droneId: string;
    chatName: string;
  }): Promise<string> {
    const { d, chat } = await getChatEntry(opts);
    const agent = inferChatAgent(chat, d);
    if (agent.kind === 'builtin') return resolveBuiltinTmuxCommand(agent.id);
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
    promptId?: string | null;
  }): Promise<string> {
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const existing =
      typeof (chat as any).chatId === 'string' ? String((chat as any).chatId).trim() : '';
    if (existing) return existing;
    let id = '';
    try {
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
      if (r.code !== 0)
        throw new Error((r.stderr || r.stdout || 'agent create-chat failed').trim());
      id = parseUuid(`${r.stdout}\n${r.stderr}`) ?? '';
      if (!id)
        throw new Error(
          `failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`,
        );
    } catch (error: any) {
      const promptId = String(opts.promptId ?? '').trim();
      if (!promptId.startsWith('agent-copilot-')) throw error;
      id = crypto.randomUUID();
      hubLog('warn', 'cursor chat id creation failed; using generated chat id', {
        droneId: opts.droneId,
        chatName: opts.chatName,
        promptId,
        runtime: opts.runtime,
        error: String(error?.message ?? error ?? 'unknown error'),
      });
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
    updateTranscriptTurnById,
  };
}
