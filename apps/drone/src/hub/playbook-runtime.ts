import path from 'node:path';

import type { FleetWorkflowStore } from '../host/fleet-workflow-store';
import type { DroneRuntime } from '../host/runtime';
import type { CatalogPlaybookRecord } from '../host/catalog-store';
import type { ChatAgentConfig } from './chat-types';

type PlaybookMessageDefinition = {
  id: string;
  name: string | null;
  prompt: string;
};

type PlaybookDefinition = {
  id: string;
  label: string;
  agent: ChatAgentConfig;
  model?: string | null;
  messages: PlaybookMessageDefinition[];
  artifacts: string[];
  actions: Array<{
    id: string;
    label: string;
    messages: string[];
  }>;
  createdAt: string;
  updatedAt?: string;
};

type PlaybookRunStatus = 'starting' | 'running' | 'completed' | 'failed';
type PlaybookRunQueueState = 'queued' | 'waiting' | 'launching' | 'error';

type PlaybookRunQueueItem = {
  id: string;
  playbookId: string;
  playbookLabel: string;
  repoPath: string;
  requestedCount: number;
  launchedCount: number;
  inFlightCount: number;
  serializeFirstMessageGroup: boolean;
  pullHostBranchBeforeCreate: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type PlaybookRunQueueGate = {
  queueItemId: string;
  playbookId: string;
  chatName: string;
  initialPromptIds: string[];
  releasedAt?: string;
};

type PlaybookRuntimeDependencyName =
  | 'allocateUntitledDisplayName'
  | 'busyChatNamesForDrone'
  | 'commitDroneMetadataPatch'
  | 'deriveCanonicalCreatedDroneEnvironmentConfig'
  | 'enqueueProvisioning'
  | 'fileExists'
  | 'getCatalogStore'
  | 'getFleetWorkflowStore'
  | 'gitPullHostBranchBeforeCreate'
  | 'hubLog'
  | 'loadRegistry'
  | 'loadRegistryCompatibilityBase'
  | 'normalizeChatModel'
  | 'normalizeChatName'
  | 'normalizePendingStartupPrompts'
  | 'nowIso'
  | 'parseSeedAgent'
  | 'pendingPromptsFromChatEntry'
  | 'readCanonicalActiveDroneModel'
  | 'resolveDroneCliPath'
  | 'startupPromptToPendingPrompt'
  | 'transcriptTurnIdsFromEntry'
  | 'updateRegistry'
  | 'upsertCanonicalDroneLifecycle';

export type PlaybookRuntimeDependencies = {
  [Key in PlaybookRuntimeDependencyName]: any;
};

export function createPlaybookRuntime(dependencies: PlaybookRuntimeDependencies) {
  const {
    allocateUntitledDisplayName,
    busyChatNamesForDrone,
    commitDroneMetadataPatch,
    deriveCanonicalCreatedDroneEnvironmentConfig,
    enqueueProvisioning,
    fileExists,
    getCatalogStore,
    getFleetWorkflowStore,
    gitPullHostBranchBeforeCreate,
    hubLog,
    loadRegistry,
    loadRegistryCompatibilityBase,
    normalizeChatModel,
    normalizeChatName,
    normalizePendingStartupPrompts,
    nowIso,
    parseSeedAgent,
    pendingPromptsFromChatEntry,
    readCanonicalActiveDroneModel,
    resolveDroneCliPath,
    startupPromptToPendingPrompt,
    transcriptTurnIdsFromEntry,
    updateRegistry,
    upsertCanonicalDroneLifecycle,
  } = dependencies;

  const PLAYBOOK_RUN_QUEUE_INTERVAL_MS = 1500;
  let playbookRunQueueInterval: ReturnType<typeof setInterval> | null = null;
  let playbookRunQueueBusy = false;

  async function workflowStoreOrCompatibility(): Promise<FleetWorkflowStore | null> {
    try {
      return await getFleetWorkflowStore();
    } catch (error) {
      if ((globalThis as any).Bun) return null;
      throw error;
    }
  }

  async function runPlaybookRunQueueCycle(): Promise<void> {
    if (playbookRunQueueBusy) return;
    playbookRunQueueBusy = true;
    try {
      await drainPlaybookRunLaunchQueue();
    } finally {
      playbookRunQueueBusy = false;
    }
  }

  function schedulePlaybookRunQueueCycle(): void {
    void runPlaybookRunQueueCycle().catch((error: unknown) => {
      hubLog('warn', 'playbook run queue cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function startPlaybookRunQueueScheduler(): void {
    if (!playbookRunQueueInterval) {
      playbookRunQueueInterval = setInterval(
        schedulePlaybookRunQueueCycle,
        PLAYBOOK_RUN_QUEUE_INTERVAL_MS,
      );
      playbookRunQueueInterval.unref?.();
    }
    schedulePlaybookRunQueueCycle();
  }

  function closePlaybookRuntime(): void {
    if (playbookRunQueueInterval) clearInterval(playbookRunQueueInterval);
    playbookRunQueueInterval = null;
  }

  const PLAYBOOK_LABEL_MAX_CHARS = 72;
  const PLAYBOOK_ACTION_LABEL_MAX_CHARS = 40;
  const PLAYBOOK_MESSAGE_NAME_MAX_CHARS = 80;
  const PLAYBOOK_MESSAGE_MAX_CHARS = 8_000;
  const PLAYBOOK_MAX_MESSAGES = 20;
  const PLAYBOOK_MAX_ACTIONS = 12;
  const PLAYBOOK_MAX_ITEMS = 60;

  function normalizeDroneEntryKind(raw: unknown): 'standard' | 'playbook-run' {
    return String(raw ?? '')
      .trim()
      .toLowerCase() === 'playbook-run'
      ? 'playbook-run'
      : 'standard';
  }

  function normalizeDroneEntryVisibility(raw: unknown): 'visible' | 'hidden' {
    return String(raw ?? '')
      .trim()
      .toLowerCase() === 'hidden'
      ? 'hidden'
      : 'visible';
  }

  function playbookMetaFromEntry(raw: unknown): {
    id: string;
    label: string;
    messageCount: number;
    chatName: string;
    artifacts: string[];
    actions: Array<{ id: string; label: string; messages: string[] }>;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = String((raw as any).id ?? '').trim();
    if (!id) return null;
    const label = String((raw as any).label ?? '').trim() || id;
    const messageCountRaw = Number((raw as any).messageCount);
    const messageCount =
      Number.isFinite(messageCountRaw) && messageCountRaw > 0 ? Math.floor(messageCountRaw) : 1;
    const chatName = normalizeChatName((raw as any).chatName ?? 'default');
    const artifacts = normalizePlaybookArtifacts((raw as any).artifacts);
    const actions = normalizePlaybookActions((raw as any).actions);
    return { id, label, messageCount, chatName, artifacts, actions };
  }

  function normalizePlaybookLabel(raw: unknown): string {
    return String(raw ?? '')
      .trim()
      .slice(0, PLAYBOOK_LABEL_MAX_CHARS);
  }

  function normalizePlaybookActionLabel(raw: unknown): string {
    return String(raw ?? '')
      .trim()
      .slice(0, PLAYBOOK_ACTION_LABEL_MAX_CHARS);
  }

  function normalizePlaybookMessageId(raw: unknown, fallbackIndex: number): string {
    const id = String(raw ?? '').trim();
    return id || `message-${fallbackIndex + 1}`;
  }

  function normalizePlaybookMessageName(raw: unknown): string | null {
    const name = String(raw ?? '')
      .trim()
      .slice(0, PLAYBOOK_MESSAGE_NAME_MAX_CHARS);
    return name || null;
  }

  function normalizePlaybookMessages(raw: unknown): PlaybookMessageDefinition[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: PlaybookMessageDefinition[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const prompt =
        item && typeof item === 'object' && !Array.isArray(item)
          ? String((item as any).prompt ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS)
          : String(item ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
      if (!prompt.trim()) continue;
      out.push({
        id:
          item && typeof item === 'object' && !Array.isArray(item)
            ? normalizePlaybookMessageId((item as any).id, index)
            : normalizePlaybookMessageId('', index),
        name:
          item && typeof item === 'object' && !Array.isArray(item)
            ? normalizePlaybookMessageName((item as any).name ?? '')
            : null,
        prompt,
      });
      if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
    }
    return out;
  }

  function normalizePlaybookActionMessages(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: string[] = [];
    for (const item of list) {
      const message =
        item && typeof item === 'object' && !Array.isArray(item)
          ? String((item as any).prompt ?? (item as any).message ?? '').slice(
              0,
              PLAYBOOK_MESSAGE_MAX_CHARS,
            )
          : String(item ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
      if (!message.trim()) continue;
      out.push(message);
      if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
    }
    return out;
  }

  function normalizePlaybookArtifacts(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: string[] = [];
    for (const item of list) {
      const artifact = String(item ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '')
        .slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
      if (!artifact) continue;
      out.push(artifact);
      if (out.length >= PLAYBOOK_MAX_ITEMS) break;
    }
    return out;
  }

  function normalizePlaybookActions(
    raw: unknown,
  ): Array<{ id: string; label: string; messages: string[] }> {
    const list = Array.isArray(raw) ? raw : [];
    const out: Array<{ id: string; label: string; messages: string[] }> = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const id = String((item as any).id ?? '').trim() || crypto.randomUUID();
      const label = normalizePlaybookActionLabel((item as any).label ?? '');
      const messages = normalizePlaybookActionMessages((item as any).messages);
      if (!label || messages.length === 0) continue;
      out.push({ id, label, messages });
      if (out.length >= PLAYBOOK_MAX_ACTIONS) break;
    }
    return out;
  }

  function normalizePlaybookAgent(raw: unknown): ChatAgentConfig {
    return parseSeedAgent(raw) ?? { kind: 'builtin', id: 'cursor' };
  }

  function normalizePlaybookModel(raw: unknown, agent: ChatAgentConfig): string | null {
    if (agent.kind !== 'builtin') return null;
    return normalizeChatModel(raw);
  }

  function normalizePlaybookDefinitions(regAny: any): PlaybookDefinition[] {
    const out: PlaybookDefinition[] = [];
    const seen = new Set<string>();
    for (const [key, raw] of Object.entries(regAny?.playbooks ?? {})) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String((raw as any).id ?? key).trim();
      if (!id || seen.has(id)) continue;
      const label = normalizePlaybookLabel((raw as any).label ?? '');
      const agent = normalizePlaybookAgent((raw as any).agent);
      const model = normalizePlaybookModel((raw as any).model, agent);
      const messages = normalizePlaybookMessages((raw as any).messages);
      const artifacts = normalizePlaybookArtifacts((raw as any).artifacts);
      const actions = normalizePlaybookActions((raw as any).actions);
      seen.add(id);
      out.push({
        id,
        label,
        agent,
        model,
        messages,
        artifacts,
        actions,
        createdAt:
          typeof (raw as any).createdAt === 'string' && String((raw as any).createdAt).trim()
            ? String((raw as any).createdAt)
            : nowIso(),
        updatedAt:
          typeof (raw as any).updatedAt === 'string' && String((raw as any).updatedAt).trim()
            ? String((raw as any).updatedAt)
            : undefined,
      });
      if (out.length >= PLAYBOOK_MAX_ITEMS) break;
    }
    return out.sort((a, b) => {
      const aMs = Date.parse(a.updatedAt ?? a.createdAt);
      const bMs = Date.parse(b.updatedAt ?? b.createdAt);
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return bMs - aMs;
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
  }

  function catalogPlaybookRecord(playbook: PlaybookDefinition): CatalogPlaybookRecord {
    return {
      ...playbook,
      model: playbook.model ?? undefined,
      updatedAt: playbook.updatedAt ?? playbook.createdAt,
    };
  }

  async function listCanonicalPlaybookDefinitions(): Promise<PlaybookDefinition[]> {
    try {
      const store = await getCatalogStore();
      if (!store.isBackfillComplete('playbooks')) {
        const legacy = normalizePlaybookDefinitions(await loadRegistry());
        await store.backfillPlaybooks(legacy.map(catalogPlaybookRecord));
      }
      const rows = store.listPlaybooks();
      return normalizePlaybookDefinitions({
        playbooks: Object.fromEntries(rows.map((playbook: any) => [playbook.id, playbook])),
      });
    } catch (error) {
      if ((globalThis as any).Bun) return normalizePlaybookDefinitions(await loadRegistry());
      throw error;
    }
  }

  function lastTranscriptTurnFromEntry(entry: any): any | null {
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    return turns.length > 0 ? (turns[turns.length - 1] ?? null) : null;
  }

  function parseIsoOrZero(raw: unknown): number {
    const ms = Date.parse(String(raw ?? '').trim());
    return Number.isFinite(ms) ? ms : 0;
  }

  function summarizeDroneActivity(entry: any): {
    lastActivityAt: string | null;
    lastMessageAt: string | null;
    lastActivityChat: string | null;
  } {
    let lastActivityMs = Math.max(
      parseIsoOrZero(entry?.createdAt),
      parseIsoOrZero(entry?.updatedAt),
      parseIsoOrZero(entry?.hub?.updatedAt),
    );
    let lastMessageMs = 0;
    let lastActivityChat: string | null = null;
    let lastMessageChat: string | null = null;

    const chats = entry?.chats && typeof entry.chats === 'object' ? entry.chats : {};
    for (const [chatName, chatEntry] of Object.entries(chats) as Array<[string, any]>) {
      const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
      for (const turn of turns) {
        const turnMs = Math.max(
          parseIsoOrZero((turn as any)?.completedAt),
          parseIsoOrZero((turn as any)?.promptAt),
          parseIsoOrZero((turn as any)?.at),
        );
        if (turnMs > lastMessageMs) {
          lastMessageMs = turnMs;
          lastMessageChat = chatName;
        }
        if (turnMs > lastActivityMs) {
          lastActivityMs = turnMs;
          lastActivityChat = chatName;
        }
      }

      const pendingPrompts = Array.isArray(chatEntry?.pendingPrompts)
        ? chatEntry.pendingPrompts
        : [];
      for (const prompt of pendingPrompts) {
        const promptMs = Math.max(
          parseIsoOrZero((prompt as any)?.updatedAt),
          parseIsoOrZero((prompt as any)?.at),
          parseIsoOrZero((prompt as any)?.createdAt),
        );
        if (promptMs > lastActivityMs) {
          lastActivityMs = promptMs;
          lastActivityChat = chatName;
        }
      }
    }

    return {
      lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
      lastMessageAt: lastMessageMs > 0 ? new Date(lastMessageMs).toISOString() : null,
      lastActivityChat:
        lastActivityChat ?? (lastActivityMs === lastMessageMs ? lastMessageChat : null),
    };
  }

  function isDraftDroneEntry(entry: any): boolean {
    return (
      entry?.draft === true ||
      String(entry?.phase ?? '')
        .trim()
        .toLowerCase() === 'draft'
    );
  }

  function isDraftChatEntry(entry: any): boolean {
    return entry?.draft === true;
  }

  function summarizePlaybookRunEntry(args: {
    droneId: string;
    name: string;
    createdAt: string;
    repoPath: string;
    runtime: DroneRuntime;
    playbook: {
      id: string;
      label: string;
      messageCount: number;
      chatName: string;
      artifacts: string[];
      actions: Array<{ id: string; label: string; messages: string[] }>;
    };
    pendingEntry?: any | null;
    droneEntry?: any | null;
  }): {
    id: string;
    droneId: string;
    droneName: string;
    playbookId: string;
    playbookLabel: string;
    chatName: string;
    repoPath: string;
    runtime: DroneRuntime;
    visibility: 'hidden' | 'visible';
    kind: 'playbook-run';
    status: PlaybookRunStatus;
    createdAt: string;
    updatedAt: string;
    lastMessage: string;
    artifacts: string[];
    actions: Array<{ id: string; label: string; messages: string[] }>;
    pendingCount: number;
    failedCount: number;
    runsCompleted: number;
    statusError: string | null;
  } {
    const pendingEntry = args.pendingEntry ?? null;
    const droneEntry = args.droneEntry ?? null;
    const playbook = args.playbook;
    const chatName = playbook.chatName || 'default';
    const chatEntry = droneEntry?.chats?.[chatName] ?? null;
    const pendingPrompts = pendingEntry
      ? normalizePendingStartupPrompts(pendingEntry.startupQueuedPrompts, chatName).map(
          startupPromptToPendingPrompt,
        )
      : pendingPromptsFromChatEntry(chatEntry, { keepRecentlyCompleted: true });
    const failedCount = pendingPrompts.filter((item: any) => item.state === 'failed').length;
    const activePendingCount = pendingPrompts.filter((item: any) => item.state !== 'failed').length;
    const lastTurn = lastTranscriptTurnFromEntry(chatEntry);
    const lastMessage = String(lastTurn?.output ?? '').trim();
    const statusError =
      typeof pendingEntry?.error === 'string' && pendingEntry.error.trim()
        ? pendingEntry.error.trim()
        : typeof droneEntry?.hub?.message === 'string' && String(droneEntry.hub.message).trim()
          ? String(droneEntry.hub.message).trim()
          : failedCount > 0
            ? String(
                pendingPrompts.find((item: any) => item.state === 'failed')?.error ?? '',
              ).trim() || 'One or more playbook prompts failed.'
            : null;
    let status: PlaybookRunStatus = 'starting';
    if (pendingEntry) {
      status = String(pendingEntry.phase ?? '').trim() === 'error' ? 'failed' : 'starting';
    } else if (String(droneEntry?.hub?.phase ?? '').trim() === 'error' || failedCount > 0) {
      status = 'failed';
    } else if (
      String(droneEntry?.hub?.phase ?? '').trim() === 'starting' ||
      String(droneEntry?.hub?.phase ?? '').trim() === 'seeding' ||
      String(droneEntry?.hub?.phase ?? '').trim() === 'creating'
    ) {
      status = 'starting';
    } else if (
      activePendingCount > 0 ||
      Boolean(busyChatNamesForDrone(droneEntry, args.droneId).length > 0)
    ) {
      status = 'running';
    } else if (lastTurn) {
      status = 'completed';
    }
    const updatedAtMs = Math.max(
      parseIsoOrZero(pendingEntry?.updatedAt),
      parseIsoOrZero(droneEntry?.hub?.updatedAt),
      parseIsoOrZero(lastTurn?.completedAt),
      parseIsoOrZero(lastTurn?.promptAt),
      parseIsoOrZero(lastTurn?.at),
      ...pendingPrompts.map((item: any) => parseIsoOrZero(item.updatedAt ?? item.at)),
    );
    return {
      id: args.droneId,
      droneId: args.droneId,
      droneName: args.name,
      playbookId: playbook.id,
      playbookLabel: playbook.label,
      chatName,
      repoPath: args.repoPath,
      runtime: args.runtime,
      visibility: 'hidden',
      kind: 'playbook-run',
      status,
      createdAt: args.createdAt,
      updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : args.createdAt,
      lastMessage: lastMessage || (statusError ?? ''),
      artifacts: playbook.artifacts,
      actions: playbook.actions,
      pendingCount: activePendingCount,
      failedCount,
      runsCompleted: Array.isArray(chatEntry?.turns) ? chatEntry.turns.length : 0,
      statusError: status === 'failed' ? statusError : null,
    };
  }

  const PLAYBOOK_RUN_QUEUE_BATCH_MIN = 1;
  const PLAYBOOK_RUN_QUEUE_BATCH_MAX = 50;

  function normalizePlaybookRunQueueItem(raw: unknown): PlaybookRunQueueItem | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? '').trim();
    const playbookId = String(item.playbookId ?? '').trim();
    const playbookLabel = String(item.playbookLabel ?? '').trim();
    const repoPath = String(item.repoPath ?? '').trim();
    const requestedCount = Math.max(
      PLAYBOOK_RUN_QUEUE_BATCH_MIN,
      Math.min(PLAYBOOK_RUN_QUEUE_BATCH_MAX, Math.floor(Number(item.requestedCount ?? 1) || 1)),
    );
    const launchedCount = Math.max(
      0,
      Math.min(requestedCount, Math.floor(Number(item.launchedCount ?? 0) || 0)),
    );
    const maxInflight = Math.max(0, requestedCount - launchedCount);
    const inFlightCount = Math.max(
      0,
      Math.min(maxInflight, Math.floor(Number(item.inFlightCount ?? 0) || 0)),
    );
    if (!id || !playbookId || !playbookLabel || !repoPath) return null;
    return {
      id,
      playbookId,
      playbookLabel,
      repoPath,
      requestedCount,
      launchedCount,
      inFlightCount,
      serializeFirstMessageGroup: item.serializeFirstMessageGroup === true,
      pullHostBranchBeforeCreate: item.pullHostBranchBeforeCreate === true,
      createdAt:
        typeof item.createdAt === 'string' && item.createdAt.trim()
          ? item.createdAt.trim()
          : nowIso(),
      updatedAt:
        typeof item.updatedAt === 'string' && item.updatedAt.trim()
          ? item.updatedAt.trim()
          : nowIso(),
      ...(typeof item.error === 'string' && item.error.trim() ? { error: item.error.trim() } : {}),
    };
  }

  function normalizePlaybookRunQueueItems(raw: unknown): PlaybookRunQueueItem[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: PlaybookRunQueueItem[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const normalized = normalizePlaybookRunQueueItem(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      out.push(normalized);
    }
    return out.sort(
      (a, b) =>
        parseIsoOrZero(a.createdAt) - parseIsoOrZero(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  function readPlaybookRunQueueItems(regAny: any): PlaybookRunQueueItem[] {
    return normalizePlaybookRunQueueItems(regAny?.playbookRunQueue?.items);
  }

  function writePlaybookRunQueueItems(regAny: any, itemsRaw: PlaybookRunQueueItem[]): void {
    const items = normalizePlaybookRunQueueItems(itemsRaw).filter(
      (item) => item.requestedCount - item.launchedCount > 0 || item.inFlightCount > 0,
    );
    if (items.length === 0) {
      if (regAny && typeof regAny === 'object') delete regAny.playbookRunQueue;
      return;
    }
    regAny.playbookRunQueue = { items };
  }

  async function canonicalPlaybookQueueItems(registry?: any): Promise<PlaybookRunQueueItem[]> {
    const store = await workflowStoreOrCompatibility();
    if (!store) return readPlaybookRunQueueItems(registry ?? (await loadRegistry()));
    if (!store.isQueueBackfilled()) {
      const legacyRegistry = registry?.playbookRunQueue
        ? registry
        : await loadRegistryCompatibilityBase();
      await store.backfillQueue(readPlaybookRunQueueItems(legacyRegistry));
    }
    return store
      .listQueue<PlaybookRunQueueItem>(true)
      .filter((item) => (item as any).state !== 'cancelled' && (item as any).state !== 'completed');
  }

  async function enqueueCanonicalPlaybookQueueItem(item: PlaybookRunQueueItem): Promise<void> {
    const store = await workflowStoreOrCompatibility();
    if (store) {
      if (!store.isQueueBackfilled()) {
        await store.backfillQueue(readPlaybookRunQueueItems(await loadRegistryCompatibilityBase()));
      }
      await store.enqueue(item);
      return;
    }
    await updateRegistry((regAny: any) => {
      const items = readPlaybookRunQueueItems(regAny);
      items.push(item);
      writePlaybookRunQueueItems(regAny, items);
    });
  }

  function normalizePlaybookRunQueueGate(raw: unknown): PlaybookRunQueueGate | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const gate = raw as Record<string, unknown>;
    const queueItemId = String(gate.queueItemId ?? '').trim();
    const playbookId = String(gate.playbookId ?? '').trim();
    const chatName = normalizeChatName(gate.chatName ?? 'default');
    const initialPromptIds = Array.isArray(gate.initialPromptIds)
      ? Array.from(
          new Set(gate.initialPromptIds.map((item) => String(item ?? '').trim()).filter(Boolean)),
        ).slice(0, 120)
      : [];
    if (!queueItemId || !playbookId) return null;
    return {
      queueItemId,
      playbookId,
      chatName,
      initialPromptIds,
      ...(typeof gate.releasedAt === 'string' && gate.releasedAt.trim()
        ? { releasedAt: gate.releasedAt.trim() }
        : {}),
    };
  }

  function isPlaybookRunQueueGateReleasedForDroneEntry(
    droneEntry: any,
    gate: PlaybookRunQueueGate,
  ): boolean {
    if (typeof gate.releasedAt === 'string' && gate.releasedAt.trim()) return true;
    if (
      String(droneEntry?.hub?.phase ?? '')
        .trim()
        .toLowerCase() === 'error'
    )
      return true;
    if (gate.initialPromptIds.length === 0) return true;
    const chatEntry = droneEntry?.chats?.[gate.chatName] ?? null;
    if (!chatEntry) return false;
    const turnIds = transcriptTurnIdsFromEntry(chatEntry);
    const failedIds = new Set(
      pendingPromptsFromChatEntry(chatEntry, { keepRecentlyCompleted: true })
        .filter((item: any) => item.state === 'failed')
        .map((item: any) => item.id),
    );
    const completedNativePromptIds = new Set(
      String(chatEntry?.agent?.kind ?? '') === 'native'
        ? pendingPromptsFromChatEntry(chatEntry, { keepRecentlyCompleted: true })
            .filter((item: any) => item.state === 'sent')
            .map((item: any) => item.id)
        : [],
    );
    return gate.initialPromptIds.every(
      (promptId) =>
        turnIds.has(promptId) ||
        failedIds.has(promptId) ||
        completedNativePromptIds.has(promptId),
    );
  }

  function reconcilePlaybookRunQueueGates(regAny: any): boolean {
    let changed = false;
    for (const pendingEntry of Object.values(regAny?.pending ?? {})) {
      if (normalizeDroneEntryKind((pendingEntry as any)?.kind) !== 'playbook-run') continue;
      const gate = normalizePlaybookRunQueueGate((pendingEntry as any)?.playbookQueueGate);
      if (!gate || gate.releasedAt) continue;
      if (
        String((pendingEntry as any)?.phase ?? '')
          .trim()
          .toLowerCase() === 'error'
      ) {
        (pendingEntry as any).playbookQueueGate = { ...gate, releasedAt: nowIso() };
        changed = true;
      }
    }
    for (const droneEntry of Object.values(regAny?.drones ?? {})) {
      if (normalizeDroneEntryKind((droneEntry as any)?.kind) !== 'playbook-run') continue;
      const gate = normalizePlaybookRunQueueGate((droneEntry as any)?.playbookQueueGate);
      if (!gate || gate.releasedAt) continue;
      if (isPlaybookRunQueueGateReleasedForDroneEntry(droneEntry, gate)) {
        (droneEntry as any).playbookQueueGate = { ...gate, releasedAt: nowIso() };
        changed = true;
      }
    }
    return changed;
  }

  function hasActivePlaybookRunQueueGate(regAny: any, playbookIdRaw: unknown): boolean {
    const playbookId = String(playbookIdRaw ?? '').trim();
    if (!playbookId) return false;
    for (const pendingEntry of Object.values(regAny?.pending ?? {})) {
      if (normalizeDroneEntryKind((pendingEntry as any)?.kind) !== 'playbook-run') continue;
      const gate = normalizePlaybookRunQueueGate((pendingEntry as any)?.playbookQueueGate);
      if (!gate || gate.playbookId !== playbookId || gate.releasedAt) continue;
      return true;
    }
    for (const droneEntry of Object.values(regAny?.drones ?? {})) {
      if (normalizeDroneEntryKind((droneEntry as any)?.kind) !== 'playbook-run') continue;
      const gate = normalizePlaybookRunQueueGate((droneEntry as any)?.playbookQueueGate);
      if (!gate || gate.playbookId !== playbookId || gate.releasedAt) continue;
      return true;
    }
    return false;
  }

  async function summarizePlaybookRunQueueItems(regAny: any): Promise<
    Array<
      PlaybookRunQueueItem & {
        remainingCount: number;
        state: PlaybookRunQueueState;
      }
    >
  > {
    return (await canonicalPlaybookQueueItems(regAny))
      .map((item) => {
        const remainingCount = Math.max(
          0,
          item.requestedCount - item.launchedCount - item.inFlightCount,
        );
        const state: PlaybookRunQueueState = item.error
          ? 'error'
          : item.inFlightCount > 0
            ? 'launching'
            : item.serializeFirstMessageGroup &&
                hasActivePlaybookRunQueueGate(regAny, item.playbookId)
              ? 'waiting'
              : 'queued';
        return {
          ...item,
          remainingCount,
          state,
        };
      })
      .filter((item) => item.remainingCount > 0 || Boolean(item.error));
  }
  function makeDroneIdentity(): string {
    return crypto.randomUUID();
  }

  async function startPlaybookRunLaunch(opts: {
    playbookId: string;
    repoPath: string;
    pullHostBranchBeforeCreate: boolean;
    queueItemId?: string | null;
    serializeFirstMessageGroup?: boolean;
    renderedMessages?: PlaybookMessageDefinition[] | null;
    renderedActions?: Array<{ id: string; label: string; messages: string[] }> | null;
  }): Promise<{
    ok: true;
    droneId: string;
    playbookId: string;
    playbookLabel: string;
    chatName: string;
    repoPath: string;
    phase: 'starting';
  }> {
    const playbookId = String(opts.playbookId ?? '').trim();
    if (!playbookId) throw new Error('missing playbook id');
    let repoPath = String(opts.repoPath ?? '').trim();
    if (!repoPath) throw new Error('missing repoPath');
    if (!path.isAbsolute(repoPath)) throw new Error('invalid repoPath (expected absolute path)');
    if (opts.pullHostBranchBeforeCreate) {
      const pulled = await gitPullHostBranchBeforeCreate(repoPath);
      repoPath = pulled.repoRoot;
    }
    const droneCli = resolveDroneCliPath();
    if (!(await fileExists(droneCli))) throw new Error(`drone CLI not found at ${droneCli}`);
    const regAny: any = await loadRegistry();
    const playbook =
      (await listCanonicalPlaybookDefinitions()).find((item) => item.id === playbookId) ?? null;
    if (!playbook) throw new Error(`unknown playbook: ${playbookId}`);
    const playbookMessages = Array.isArray(opts.renderedMessages)
      ? opts.renderedMessages
      : playbook.messages;
    const playbookActions = Array.isArray(opts.renderedActions)
      ? opts.renderedActions
      : playbook.actions;
    if (playbookMessages.length === 0) throw new Error('playbook has no messages');
    const playbookAgent = normalizePlaybookAgent(playbook.agent);
    const playbookModel = normalizePlaybookModel(playbook.model, playbookAgent);
    const droneId = makeDroneIdentity();
    const name = allocateUntitledDisplayName(regAny);
    const at = nowIso();
    const runtime: DroneRuntime = 'container';
    const containerPort = 7777;
    const createdEnvironment = await deriveCanonicalCreatedDroneEnvironmentConfig(regAny, {
      repoPath,
      runtime,
    });
    const startupQueuedPrompts = playbookMessages.map((message, index) => ({
      id: `${droneId.replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 24)}-${String(index + 1).padStart(2, '0')}`,
      chatName: 'default',
      at,
      prompt: message.prompt,
      ...(message.id ? { messageId: message.id } : {}),
      state: 'queued' as const,
      updatedAt: at,
    }));
    const queueGate =
      opts.serializeFirstMessageGroup && opts.queueItemId
        ? {
            queueItemId: String(opts.queueItemId).trim(),
            playbookId: playbook.id,
            chatName: 'default',
            initialPromptIds: startupQueuedPrompts.map((item) => item.id),
          }
        : null;
    await upsertCanonicalDroneLifecycle('pending', droneId, {
      id: droneId,
      name,
      kind: 'playbook-run',
      visibility: 'hidden',
      playbook: {
        id: playbook.id,
        label: playbook.label,
        messageCount: playbookMessages.length,
        chatName: 'default',
        artifacts: playbook.artifacts,
        actions: playbookActions,
      },
      repoPath,
      runtime,
      containerPort,
      build: false,
      createdAt: at,
      updatedAt: at,
      phase: 'starting',
      message: `Launching ${playbook.label}…`,
      environment: createdEnvironment,
      seed: {
        chatName: 'default',
        agent: playbookAgent,
        ...(playbookModel ? { model: playbookModel } : {}),
      },
      startupQueuedPrompts,
      ...(queueGate ? { playbookQueueGate: queueGate } : {}),
    });
    enqueueProvisioning(droneId);
    return {
      ok: true,
      droneId,
      playbookId: playbook.id,
      playbookLabel: playbook.label,
      chatName: 'default',
      repoPath,
      phase: 'starting',
    };
  }

  async function drainPlaybookRunLaunchQueue(): Promise<void> {
    const regLatest: any = (globalThis as any).Bun
      ? await loadRegistry()
      : (readCanonicalActiveDroneModel() ?? (await loadRegistry()));
    const previousGates = new Map<string, string>();
    for (const [state, bucket] of [
      ['pending', regLatest?.pending],
      ['real', regLatest?.drones],
    ] as const) {
      for (const [droneId, entry] of Object.entries(bucket ?? {}) as Array<[string, any]>) {
        previousGates.set(`${state}:${droneId}`, JSON.stringify(entry?.playbookQueueGate ?? null));
      }
    }
    if (reconcilePlaybookRunQueueGates(regLatest)) {
      for (const [state, bucket] of [
        ['pending', regLatest?.pending],
        ['real', regLatest?.drones],
      ] as const) {
        for (const [droneId, entry] of Object.entries(bucket ?? {}) as Array<[string, any]>) {
          if (
            previousGates.get(`${state}:${droneId}`) ===
            JSON.stringify(entry?.playbookQueueGate ?? null)
          )
            continue;
          await commitDroneMetadataPatch({
            droneId,
            state,
            eventType: 'drone.playbook-queue-gate.released',
            transform: (lifecycle: any) => ({
              ...lifecycle,
              playbookQueueGate: entry.playbookQueueGate,
            }),
          });
        }
      }
    }
    const items = await canonicalPlaybookQueueItems(regLatest);
    const store = await workflowStoreOrCompatibility();
    const claimedSerialPlaybookIds = new Set<string>();
    const plans: Array<{
      queueItemId: string;
      playbookId: string;
      repoPath: string;
      pullHostBranchBeforeCreate: boolean;
      serializeFirstMessageGroup: boolean;
    }> = [];
    for (const item of items) {
      const remainingCount = Math.max(
        0,
        item.requestedCount - item.launchedCount - item.inFlightCount,
      );
      if (remainingCount <= 0 || item.error) continue;
      const blockedBySerialGate =
        item.serializeFirstMessageGroup &&
        (claimedSerialPlaybookIds.has(item.playbookId) ||
          hasActivePlaybookRunQueueGate(regLatest, item.playbookId));
      if (blockedBySerialGate) continue;
      const claimCount = item.serializeFirstMessageGroup ? 1 : remainingCount;
      item.inFlightCount += claimCount;
      item.updatedAt = nowIso();
      if (store) await store.updateQueue<PlaybookRunQueueItem>(item.id, () => ({ ...item }));
      if (item.serializeFirstMessageGroup) claimedSerialPlaybookIds.add(item.playbookId);
      for (let index = 0; index < claimCount; index += 1) {
        plans.push({
          queueItemId: item.id,
          playbookId: item.playbookId,
          repoPath: item.repoPath,
          pullHostBranchBeforeCreate: item.pullHostBranchBeforeCreate,
          serializeFirstMessageGroup: item.serializeFirstMessageGroup,
        });
      }
    }
    if (!store)
      await updateRegistry((registry: any) => writePlaybookRunQueueItems(registry, items));
    for (const plan of plans) {
      try {
        await startPlaybookRunLaunch({
          playbookId: plan.playbookId,
          repoPath: plan.repoPath,
          pullHostBranchBeforeCreate: plan.pullHostBranchBeforeCreate,
          queueItemId: plan.queueItemId,
          serializeFirstMessageGroup: plan.serializeFirstMessageGroup,
        });
        if (store) {
          await store.updateQueue<PlaybookRunQueueItem>(plan.queueItemId, (item) => {
            const nextInflight = Math.max(0, item.inFlightCount - 1);
            const nextLaunched = Math.min(item.requestedCount, item.launchedCount + 1);
            return {
              ...item,
              inFlightCount: nextInflight,
              launchedCount: nextLaunched,
              updatedAt: nowIso(),
              error: undefined,
            };
          });
        } else
          await updateRegistry((registry: any) => {
            const rows = readPlaybookRunQueueItems(registry).map((item) =>
              item.id === plan.queueItemId
                ? {
                    ...item,
                    inFlightCount: Math.max(0, item.inFlightCount - 1),
                    launchedCount: Math.min(item.requestedCount, item.launchedCount + 1),
                    updatedAt: nowIso(),
                    error: undefined,
                  }
                : item,
            );
            writePlaybookRunQueueItems(registry, rows);
          });
      } catch (error: any) {
        const message = error?.message ?? String(error);
        if (store) {
          await store.updateQueue<PlaybookRunQueueItem>(plan.queueItemId, (item) => ({
            ...item,
            inFlightCount: Math.max(0, item.inFlightCount - 1),
            updatedAt: nowIso(),
            error: message,
          }));
        } else
          await updateRegistry((registry: any) => {
            const rows = readPlaybookRunQueueItems(registry).map((item) =>
              item.id === plan.queueItemId
                ? {
                    ...item,
                    inFlightCount: Math.max(0, item.inFlightCount - 1),
                    updatedAt: nowIso(),
                    error: message,
                  }
                : item,
            );
            writePlaybookRunQueueItems(registry, rows);
          });
        hubLog('warn', 'playbook run queue launch failed', {
          queueItemId: plan.queueItemId,
          playbookId: plan.playbookId,
          repoPath: plan.repoPath,
          error: message,
        });
      }
    }
  }

  return {
    workflowStoreOrCompatibility,
    runPlaybookRunQueueCycle,
    startPlaybookRunQueueScheduler,
    closePlaybookRuntime,
    normalizeDroneEntryKind,
    normalizeDroneEntryVisibility,
    playbookMetaFromEntry,
    normalizePlaybookLabel,
    normalizePlaybookMessages,
    normalizePlaybookArtifacts,
    normalizePlaybookActions,
    normalizePlaybookAgent,
    normalizePlaybookDefinitions,
    catalogPlaybookRecord,
    listCanonicalPlaybookDefinitions,
    summarizeDroneActivity,
    isDraftDroneEntry,
    isDraftChatEntry,
    summarizePlaybookRunEntry,
    PLAYBOOK_RUN_QUEUE_BATCH_MIN,
    PLAYBOOK_RUN_QUEUE_BATCH_MAX,
    readPlaybookRunQueueItems,
    writePlaybookRunQueueItems,
    enqueueCanonicalPlaybookQueueItem,
    normalizePlaybookRunQueueGate,
    summarizePlaybookRunQueueItems,
    makeDroneIdentity,
    startPlaybookRunLaunch,
  };
}
