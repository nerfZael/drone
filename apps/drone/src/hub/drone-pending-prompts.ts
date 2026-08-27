import {
  completedTurnIds,
  isAgentTransportInterruption,
  isTerminalPendingPrompt,
  normalizeAgentPlan,
  normalizePendingPromptState as normalizeSharedPendingPromptState,
  normalizePromptQueueInterruption,
  type AgentPlan,
  type AgentRunActivity,
  type ChatQueueAction,
  type CodexApprovalDecision,
  type CodexPendingApproval,
  type PromptQueueInterruption,
} from '@drone/assistant-chat';
import { loadRegistry, updateRegistry } from '../host/registry';
import {
  getPromptQueueRepository,
  type PromptSubmissionSource,
} from '../host/prompt-queue-repository';
import { findDroneEntryByIdentity, normalizeDroneIdentity } from './drone-lifecycle-registry';
import { commitDroneMetadataPatch } from './drone-metadata-commands';
import type { PendingPromptState, PendingStartupPrompt } from './drone-pending-state';
import type { ChatImageAttachmentRef } from './chat-attachments';
import {
  cancelQueuedPendingPromptInStore,
  claimQueuedPendingPromptInStore,
  importChatFromRegistry,
  readChatFromStore,
  readChatRowsFromStore,
  updatePendingPromptInStore,
  upsertPendingPromptInStore,
} from './transcript-store';
import { resolveCanonicalDroneOrPendingForReadRef } from './drone-lifecycle-service';
import type { AgentRunFileChanges } from '@blip/protocol';
import type { AgentRunFileChangesBaseline } from './run-file-changes';
import { normalizeAgentRunActivity } from './builtin-agent-activity';

export type PendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  model?: string;
  messageId?: string;
  cwd?: string | null;
  attachments?: ChatImageAttachmentRef[];
  deliveryMode?: 'queue' | 'asap';
  queueInterruption?: PromptQueueInterruption;
  action?: ChatQueueAction;
  state: PendingPromptState;
  error?: string;
  observability?: {
    state: 'status-unavailable';
    message: string;
    lastCheckedAt: string;
    lastError?: string;
  };
  blipClones?: unknown;
  activity?: AgentRunActivity;
  agentPlan?: AgentPlan;
  approvals?: CodexPendingApproval[];
  fileChangesBaseline?: AgentRunFileChangesBaseline;
  fileChanges?: AgentRunFileChanges;
  startedAt?: string;
  updatedAt?: string;
};

export type CancelQueuedPendingPromptStatus = 'cancelled' | 'already-submitted' | 'not-found';

export type CancelQueuedPendingPromptResult = {
  status: CancelQueuedPendingPromptStatus;
  pendingState?: PendingPromptState | null;
};

export type RetryPendingPromptResult = {
  disposition: 'retry' | 'terminal' | 'not-claimed';
  nextAttemptAt?: string;
};

export function filterCompletedSentPromptBlockers(
  prompts: PendingPrompt[],
  turns: Array<{ id?: unknown }>,
): PendingPrompt[] {
  const completedIds = completedTurnIds(turns);
  if (completedIds.size === 0) return prompts;
  return prompts.filter(
    (prompt) =>
      !(prompt.state === 'sent' && completedIds.has(String(prompt.id ?? '').trim())),
  );
}

const RECENT_COMPLETED_PENDING_PROMPT_GRACE_MS = 2 * 60_000;

export function createDronePendingPromptStore(deps: {
  normalizeChatImageAttachmentRefs: (raw: unknown) => ChatImageAttachmentRef[];
  normalizeChatName: (raw: any) => string;
  normalizePendingPromptState: (raw: unknown) => PendingPromptState;
  normalizePendingPromptText: (raw: unknown) => string;
  normalizePendingStartupPrompts: (raw: unknown, chatNameFilter?: string) => PendingStartupPrompt[];
  nowIso: () => string;
  onPendingPromptChanged?: (change: { droneId: string; chatName: string }) => void;
  readTranscriptTurnsByIdsFromStore: (opts: {
    droneId: string;
    chatName: string;
    turnIds: string[];
  }) => Array<{ id?: unknown }>;
  startupPromptToPendingPrompt: (prompt: PendingStartupPrompt) => PendingPrompt;
}) {
  function notifyPendingPromptChanged(droneId: string, chatName: string): void {
    deps.onPendingPromptChanged?.({ droneId, chatName });
  }

  function promptQueueForActiveDrone() {
    const queue = getPromptQueueRepository();
    if (queue) return queue;
    // Bun cannot load the Node ABI build of better-sqlite3 in the legacy test
    // harness, so retain the old in-memory projection there only. A real Hub
    // must fail loudly rather than silently create a second source of truth.
    if ((globalThis as any).Bun) return null;
    throw new Error('canonical prompt queue is unavailable');
  }

  function parseRecentPendingPromptIsoMs(raw: unknown): number {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return 0;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : 0;
  }

  function pruneCompletedPendingPrompts(
    list: PendingPrompt[],
    turnsRaw: unknown,
    opts?: { keepRecentlyCompleted?: boolean; nowMs?: number },
  ): PendingPrompt[] {
    const visible = list.filter(
      (item) => !(item.state === 'sent' && item.action?.type === 'send-in-new-chat'),
    );
    const turns = Array.isArray(turnsRaw) ? turnsRaw : [];
    const turnById = new Map<string, any>();
    for (const turn of turns) {
      const id = String((turn as any)?.id ?? '').trim();
      if (!id) continue;
      turnById.set(id, turn);
    }
    if (turnById.size === 0) return visible;

    const keepRecentlyCompleted = opts?.keepRecentlyCompleted === true;
    const nowMs =
      typeof opts?.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();

    return visible.filter((item) => {
      if (isTerminalPendingPrompt(item)) return true;
      const turn = turnById.get(item.id);
      if (!turn) return true;
      if (!keepRecentlyCompleted) return false;

      const completedMs = Math.max(
        parseRecentPendingPromptIsoMs((turn as any)?.completedAt),
        parseRecentPendingPromptIsoMs((turn as any)?.promptAt),
        parseRecentPendingPromptIsoMs((turn as any)?.at),
        parseRecentPendingPromptIsoMs((item as any)?.updatedAt),
        parseRecentPendingPromptIsoMs((item as any)?.at),
      );
      if (!completedMs) return false;
      return nowMs - completedMs <= RECENT_COMPLETED_PENDING_PROMPT_GRACE_MS;
    });
  }

  function transcriptTurnIdsFromEntry(entry: any): Set<string> {
    return completedTurnIds(entry?.turns);
  }

  function pendingPromptsFromChatEntry(
    entry: any,
    opts?: { keepRecentlyCompleted?: boolean },
  ): PendingPrompt[] {
    const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    const pending = pruneCompletedPendingPrompts(
      list
        .map((p: any) => ({
          id: String(p?.id ?? '').trim(),
          at: String(p?.at ?? '').trim(),
          prompt: deps.normalizePendingPromptText(p?.prompt),
          ...(typeof p?.model === 'string' && String(p.model).trim()
            ? { model: String(p.model).trim() }
            : {}),
          ...(typeof p?.messageId === 'string' && String(p.messageId).trim()
            ? { messageId: String(p.messageId).trim() }
            : {}),
          cwd: typeof p?.cwd === 'string' ? String(p.cwd) : p?.cwd === null ? null : undefined,
          attachments: deps.normalizeChatImageAttachmentRefs(p?.attachments),
          deliveryMode: p?.deliveryMode === 'asap' ? 'asap' : 'queue',
          ...(normalizePromptQueueInterruption((p as any)?.queueInterruption)
            ? {
                queueInterruption: normalizePromptQueueInterruption((p as any).queueInterruption),
              }
            : {}),
          ...(p?.action && typeof p.action === 'object'
            ? { action: p.action as ChatQueueAction }
            : {}),
          state: normalizeSharedPendingPromptState(p?.state),
          error: typeof p?.error === 'string' ? p.error : undefined,
          observability: normalizeObservability((p as any)?.observability),
          activity: normalizeAgentRunActivity((p as any)?.activity),
          agentPlan: normalizePendingAgentPlan((p as any)?.agentPlan),
          approvals: normalizeCodexApprovals((p as any)?.approvals),
          ...((p as any)?.fileChangesBaseline && typeof (p as any).fileChangesBaseline === 'object'
            ? { fileChangesBaseline: (p as any).fileChangesBaseline as AgentRunFileChangesBaseline }
            : {}),
          ...((p as any)?.fileChanges && typeof (p as any).fileChanges === 'object'
            ? { fileChanges: (p as any).fileChanges as AgentRunFileChanges }
            : {}),
          startedAt:
            typeof p?.startedAt === 'string' && Number.isFinite(Date.parse(p.startedAt))
              ? p.startedAt
              : undefined,
          updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : undefined,
        }))
        .filter((p: PendingPrompt) => p.id && p.prompt.trim())
        .slice(-60),
      entry?.turns,
      { keepRecentlyCompleted: opts?.keepRecentlyCompleted === true },
    );
    return pending;
  }

  function normalizeObservability(raw: unknown): PendingPrompt['observability'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    if (String((raw as any).state ?? '').trim() !== 'status-unavailable') return undefined;
    const lastCheckedAt = String((raw as any).lastCheckedAt ?? '').trim();
    const message =
      String((raw as any).message ?? '').trim() || 'Prompt status is temporarily unavailable.';
    return {
      state: 'status-unavailable',
      message,
      lastCheckedAt: lastCheckedAt || deps.nowIso(),
      ...(typeof (raw as any).lastError === 'string' && String((raw as any).lastError).trim()
        ? { lastError: String((raw as any).lastError).trim() }
        : {}),
    };
  }

  function normalizePendingAgentPlan(raw: unknown): PendingPrompt['agentPlan'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const source = String((raw as any).source ?? '').trim();
    if (source !== 'cursor' && source !== 'codex' && source !== 'claude' && source !== 'opencode')
      return undefined;
    return normalizeAgentPlan(raw, source, String((raw as any).updatedAt ?? ''));
  }

  function normalizeCodexApprovals(raw: unknown): CodexPendingApproval[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const validMethods = new Set<CodexPendingApproval['method']>([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'execCommandApproval',
      'applyPatchApproval',
    ]);
    const validKinds = new Set<CodexPendingApproval['kind']>([
      'command_execution',
      'file_change',
      'permissions',
    ]);
    const validDecisions = new Set<CodexApprovalDecision>([
      'accept',
      'acceptForSession',
      'decline',
      'cancel',
    ]);
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const approvals = raw.flatMap((approval: any): CodexPendingApproval[] => {
      if (!approval || typeof approval !== 'object' || approval.status !== 'pending') return [];
      const id = text(approval.id);
      const promptId = text(approval.promptId);
      const threadId = text(approval.threadId);
      const turnId = text(approval.turnId);
      const itemId = text(approval.itemId);
      const method = text(approval.method) as CodexPendingApproval['method'];
      const kind = text(approval.kind) as CodexPendingApproval['kind'];
      if (
        !id ||
        !promptId ||
        !threadId ||
        !turnId ||
        !itemId ||
        !validMethods.has(method) ||
        !validKinds.has(kind)
      ) {
        return [];
      }
      const availableDecisions = Array.isArray(approval.availableDecisions)
        ? [...new Set(approval.availableDecisions)].filter(
            (decision): decision is CodexApprovalDecision => validDecisions.has(decision as any),
          )
        : [];
      const optional = (value: unknown) => {
        const normalized = text(value);
        return normalized || undefined;
      };
      return [
        {
          id,
          promptId,
          threadId,
          turnId,
          itemId,
          method,
          kind,
          ...(optional(approval.reason) ? { reason: optional(approval.reason) } : {}),
          ...(optional(approval.command) ? { command: optional(approval.command) } : {}),
          ...(optional(approval.cwd) ? { cwd: optional(approval.cwd) } : {}),
          ...(optional(approval.grantRoot) ? { grantRoot: optional(approval.grantRoot) } : {}),
          ...(approval.permissions !== undefined ? { permissions: approval.permissions } : {}),
          ...(approval.item !== undefined ? { item: approval.item } : {}),
          ...(approval.detailsTruncated === true ? { detailsTruncated: true } : {}),
          availableDecisions:
            availableDecisions.length > 0
              ? availableDecisions
              : ['accept', 'acceptForSession', 'decline', 'cancel'],
          createdAt: Number.isFinite(Date.parse(text(approval.createdAt)))
            ? text(approval.createdAt)
            : deps.nowIso(),
          status: 'pending',
        },
      ];
    });
    return approvals.length > 0 ? approvals : [];
  }

  function isSafePromptId(raw: string): boolean {
    const text = String(raw ?? '').trim();
    if (!text) return false;
    if (text.length > 96) return false;
    return /^[A-Za-z0-9._-]+$/.test(text);
  }

  async function readPendingPrompts(opts: {
    droneId: string;
    chatName: string;
  }): Promise<PendingPrompt[]> {
    if (!(globalThis as any).Bun) {
      const ref = normalizeDroneIdentity(opts.droneId);
      const resolved = ref ? await resolveCanonicalDroneOrPendingForReadRef(ref) : null;
      if (!resolved) throw new Error(`unknown drone: ${opts.droneId}`);
      if (resolved.kind === 'pending') throw new Error(`drone "${resolved.id}" is still starting`);
      // Fail loudly if canonical prompt persistence is unavailable. The row
      // query below then reads only this chat's prompt rows and matching turns;
      // it does not build or backfill the compatibility registry projection.
      promptQueueForActiveDrone();
      const rows = readChatRowsFromStore({
        droneId: resolved.id,
        chatName: opts.chatName || 'default',
        indexes: [],
        includePending: true,
      });
      return pruneCompletedPendingPrompts(rows.pending as PendingPrompt[], rows.pendingTurns, {
        keepRecentlyCompleted: true,
      }).slice(-50);
    }

    const regAny: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const drone = droneId ? regAny?.drones?.[droneId] : null;
    if (!drone) {
      if (droneId && regAny?.pending?.[droneId] && !regAny?.drones?.[droneId])
        throw new Error(`drone "${droneId}" is still starting`);
      throw new Error(`unknown drone: ${opts.droneId}`);
    }
    const chatName = opts.chatName || 'default';
    const entry = drone?.chats?.[chatName];
    const queue = promptQueueForActiveDrone();
    if (queue) {
      // Registry data is import-only compatibility state. INSERT OR IGNORE is
      // essential here: a stale snapshot must never move canonical state back.
      if (entry) {
        await queue.backfillLegacy({
          droneId,
          chatName,
          prompts: pendingPromptsFromChatEntry(entry, { keepRecentlyCompleted: true }),
        });
      }
      const stored = queue.list({ droneId, chatName, limit: 60 }) as PendingPrompt[];
      const projected = readChatFromStore({ droneId, chatName });
      const turns = projected.available && projected.chat ? projected.chat.turns : entry?.turns;
      return pruneCompletedPendingPrompts(stored, turns, { keepRecentlyCompleted: true }).slice(
        -50,
      );
    }
    if (entry) {
      await importChatFromRegistry({ droneId, chatName, chatEntry: entry });
      const read = readChatFromStore({ droneId, chatName });
      if (read.available && read.chat) {
        return pendingPromptsFromChatEntry(read.chat, { keepRecentlyCompleted: true }).slice(-50);
      }
    }
    return pendingPromptsFromChatEntry(entry, { keepRecentlyCompleted: true }).slice(-50);
  }

  function readPendingPrompt(opts: {
    droneId: string;
    chatName: string;
    id: string;
  }): PendingPrompt | null {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const queue = promptQueueForActiveDrone();
    if (!droneId) return null;
    if (!queue) {
      const stored = readChatFromStore({ droneId, chatName: opts.chatName || 'default' });
      const pending = Array.isArray(stored.chat?.pendingPrompts)
        ? stored.chat.pendingPrompts.find((item: any) => String(item?.id ?? '').trim() === opts.id)
        : null;
      return (pending as PendingPrompt | null) ?? null;
    }
    return queue.get({
      droneId,
      chatName: opts.chatName || 'default',
      promptId: opts.id,
    }) as PendingPrompt | null;
  }

  function readPendingPromptDispatchWindow(opts: {
    droneId: string;
    chatName: string;
  }): { candidateId: string; prompts: PendingPrompt[] } | null {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (!queue || !droneId) return null;
    const candidate = queue.nextQueued({ droneId, chatName });
    if (!candidate) return { candidateId: '', prompts: [] };
    const prompts = queue.listThrough({
      droneId,
      chatName,
      promptId: candidate.id,
      limit: 100,
    }) as PendingPrompt[];
    const turns = deps.readTranscriptTurnsByIdsFromStore({
      droneId,
      chatName,
      turnIds: prompts.map((prompt) => String(prompt.id ?? '').trim()).filter(Boolean),
    });
    return {
      candidateId: candidate.id,
      prompts: filterCompletedSentPromptBlockers(prompts, turns),
    };
  }

  async function readPendingStartupPrompts(opts: {
    droneId: string;
    chatName: string;
  }): Promise<PendingPrompt[]> {
    if (!(globalThis as any).Bun) {
      const ref = normalizeDroneIdentity(opts.droneId);
      const resolved = ref ? await resolveCanonicalDroneOrPendingForReadRef(ref) : null;
      if (!resolved || resolved.kind !== 'pending') return [];
      return deps
        .normalizePendingStartupPrompts(
          (resolved.pending as any)?.startupQueuedPrompts,
          opts.chatName,
        )
        .map(deps.startupPromptToPendingPrompt);
    }

    const regAny: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const pending = droneId ? regAny?.pending?.[droneId] : null;
    if (!pending) return [];
    return deps
      .normalizePendingStartupPrompts((pending as any)?.startupQueuedPrompts, opts.chatName)
      .map(deps.startupPromptToPendingPrompt);
  }

  async function pushPendingPrompt(opts: {
    droneId: string;
    chatName: string;
    pending: PendingPrompt;
    submissionSource?: PromptSubmissionSource;
  }) {
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (queue && droneIdForStore) {
      const registry: any = await loadRegistry();
      if (!registry?.drones?.[droneIdForStore]) throw new Error(`unknown drone: ${opts.droneId}`);
      const result = await queue.enqueue({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        prompt: opts.pending,
        submissionSource: opts.submissionSource,
      });
      if (result.inserted) notifyPendingPromptChanged(droneIdForStore, chatNameForStore);
      return result;
    }
    if (droneIdForStore) {
      upsertPendingPromptInStore({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        pending: opts.pending,
      });
    }
    await updateRegistry((regAny: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const drone = droneId ? regAny?.drones?.[droneId] : null;
      if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
      drone.chats = drone.chats ?? {};
      const chatName = opts.chatName || 'default';
      const entry = drone.chats[chatName] ?? { createdAt: deps.nowIso() };
      entry.pendingPrompts = Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts : [];
      const id = String(opts.pending?.id ?? '').trim();
      if (!id) return;
      const existingIdx = entry.pendingPrompts.findIndex(
        (item: any) => String(item?.id ?? '').trim() === id,
      );
      if (existingIdx === -1) {
        entry.pendingPrompts.push(opts.pending);
      } else {
        const current = entry.pendingPrompts[existingIdx] ?? {};
        entry.pendingPrompts[existingIdx] = {
          ...current,
          ...opts.pending,
          updatedAt: opts.pending.updatedAt ?? deps.nowIso(),
        };
      }
      entry.pendingPrompts = entry.pendingPrompts.slice(-60);
      drone.chats[chatName] = entry;
      regAny.drones = regAny.drones ?? {};
      regAny.drones[droneId] = drone;
    });
  }

  async function pushPendingStartupPrompt(opts: {
    droneId: string;
    chatName: string;
    pending: PendingPrompt;
  }): Promise<'queued' | 'active' | 'missing'> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const id = String(opts.pending?.id ?? '').trim();
    const prompt = String(opts.pending?.prompt ?? '');
    if (!droneId || !id || !prompt.trim()) return 'missing';

    const registry: any = await loadRegistry();
    if (findDroneEntryByIdentity({ drones: registry?.drones }, droneId)) return 'active';
    if (!findDroneEntryByIdentity({ drones: registry?.pending }, droneId)) return 'missing';

    const chatName = deps.normalizeChatName(opts.chatName);
    const next: PendingStartupPrompt = {
      id,
      chatName,
      at: String(opts.pending?.at ?? deps.nowIso()),
      prompt,
      ...(typeof opts.pending?.messageId === 'string' && opts.pending.messageId.trim()
        ? { messageId: opts.pending.messageId.trim() }
        : {}),
      ...(typeof opts.pending?.cwd === 'string' || opts.pending?.cwd === null
        ? { cwd: opts.pending.cwd }
        : {}),
      ...(opts.pending?.deliveryMode === 'asap' || opts.pending?.deliveryMode === 'queue'
        ? { deliveryMode: opts.pending.deliveryMode }
        : {}),
      state: deps.normalizePendingPromptState(opts.pending?.state),
      ...(typeof opts.pending?.error === 'string' ? { error: opts.pending.error } : {}),
      updatedAt: String(opts.pending?.updatedAt ?? deps.nowIso()),
    };

    try {
      await commitDroneMetadataPatch({
        droneId,
        state: 'pending',
        eventType: 'drone.startup-prompt.queued',
        payload: { promptId: id, chatName },
        transform: (pendingDrone) => {
          const list = deps.normalizePendingStartupPrompts(pendingDrone.startupQueuedPrompts);
          const existingIdx = list.findIndex((entry) => entry.id === id);
          if (existingIdx === -1) list.push(next);
          else list[existingIdx] = { ...(list[existingIdx] ?? next), ...next };
          return {
            ...pendingDrone,
            startupQueuedPrompts: list.slice(-80),
            updatedAt: deps.nowIso(),
          };
        },
      });
      const queue = promptQueueForActiveDrone();
      if (queue) {
        const inserted = await queue.enqueue({
          droneId,
          chatName,
          prompt: deps.startupPromptToPendingPrompt(next),
        });
        if (inserted.inserted) notifyPendingPromptChanged(droneId, chatName);
      }
      return 'queued';
    } catch (error) {
      const latest: any = await loadRegistry();
      if (findDroneEntryByIdentity({ drones: latest?.drones }, droneId)) return 'active';
      if (!findDroneEntryByIdentity({ drones: latest?.pending }, droneId)) return 'missing';
      throw error;
    }
  }

  async function updatePendingPrompt(opts: {
    droneId: string;
    chatName: string;
    id: string;
    patch: Partial<
      Pick<
        PendingPrompt,
        | 'state'
        | 'error'
        | 'observability'
        | 'blipClones'
        | 'activity'
        | 'agentPlan'
        | 'approvals'
        | 'fileChangesBaseline'
        | 'fileChanges'
        | 'action'
        | 'queueInterruption'
        | 'startedAt'
        | 'updatedAt'
      >
    >;
  }): Promise<void> {
    const patch = opts.patch;
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (queue && droneIdForStore) {
      const current = queue.get({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        promptId: opts.id,
      });
      const updated = await queue.update({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        promptId: opts.id,
        patch,
      });
      if (
        updated &&
        patch.state === 'failed' &&
        !current?.action &&
        isAgentTransportInterruption(patch.error)
      ) {
        await queue.pauseAfterInterruption({
          droneId: droneIdForStore,
          chatName: chatNameForStore,
          promptId: opts.id,
        });
      }
      if (updated) notifyPendingPromptChanged(droneIdForStore, chatNameForStore);
      return;
    }
    if (droneIdForStore) {
      updatePendingPromptInStore({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        id: opts.id,
        patch,
      });
    }
    await updateRegistry((regAny: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const drone = droneId ? regAny?.drones?.[droneId] : null;
      if (!drone) return;
      const chatName = opts.chatName || 'default';
      const entry = drone?.chats?.[chatName];
      const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
      const idx = list.findIndex((item: any) => String(item?.id ?? '').trim() === opts.id);
      if (idx === -1) return;
      const current = list[idx] ?? {};
      list[idx] = { ...current, ...patch, updatedAt: patch.updatedAt ?? deps.nowIso() };
      entry.pendingPrompts = list;
      drone.chats = drone.chats ?? {};
      drone.chats[chatName] = entry;
      regAny.drones = regAny.drones ?? {};
      regAny.drones[droneId] = drone;
    });
  }

  async function resolveInterruptedPendingPrompt(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<{
    status: 'skipped' | 'not-found' | 'not-blocked';
  }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = deps.normalizeChatName(opts.chatName);
    const promptId = String(opts.promptId ?? '').trim();
    if (!droneId || !chatName || !promptId) return { status: 'not-found' };
    const queue = promptQueueForActiveDrone();
    if (queue) {
      const result = await queue.resolveInterruption({
        droneId,
        chatName,
        promptId,
      });
      if (result.status === 'skipped') notifyPendingPromptChanged(droneId, chatName);
      return result;
    }
    // The registry store is import-only compatibility state and cannot provide
    // an atomic durable pause. Production hubs always use the SQLite queue.
    return readPendingPrompt({ droneId, chatName, id: promptId })
      ? { status: 'not-blocked' }
      : { status: 'not-found' };
  }

  async function reconcileCompletedInterruption(opts: {
    droneId: string;
    chatName: string;
    completedPromptIds: ReadonlySet<string>;
  }): Promise<boolean> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = deps.normalizeChatName(opts.chatName);
    const queue = promptQueueForActiveDrone();
    if (!queue || !droneId) return false;
    const pause = queue.getPause({ droneId, chatName });
    const recoveryPromptId = pause?.recoveryPromptId;
    if (!recoveryPromptId || !opts.completedPromptIds.has(recoveryPromptId)) return false;
    const completed = await queue.completeRecovery({ droneId, chatName, recoveryPromptId });
    if (completed) notifyPendingPromptChanged(droneId, chatName);
    return completed;
  }

  async function retryPendingPrompt(opts: {
    droneId: string;
    chatName: string;
    id: string;
    error: string;
  }): Promise<RetryPendingPromptResult> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (queue && droneId) {
      const current = queue.get({ droneId, chatName, promptId: opts.id });
      const result = await queue.scheduleRetry({
        droneId,
        chatName,
        promptId: opts.id,
        error: opts.error,
        ...(current?.leaseOwner ? { leaseOwner: current.leaseOwner } : {}),
      });
      if (
        result.disposition === 'terminal' &&
        !current?.action &&
        isAgentTransportInterruption(opts.error)
      ) {
        await queue.pauseAfterInterruption({ droneId, chatName, promptId: opts.id });
      }
      if (result.disposition !== 'not-claimed') notifyPendingPromptChanged(droneId, chatName);
      return result;
    }
    // Compatibility-only fallback retains the previous immediate retry state.
    await updatePendingPrompt({
      droneId: opts.droneId,
      chatName,
      id: opts.id,
      patch: { state: 'queued', error: opts.error },
    });
    return { disposition: 'retry', nextAttemptAt: deps.nowIso() };
  }

  async function releasePendingPromptClaim(opts: {
    droneId: string;
    chatName: string;
    id: string;
    error: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (queue && droneId) {
      const released = await queue.releaseClaim({
        droneId,
        chatName,
        promptId: opts.id,
        error: opts.error,
        leaseOwner: `hub:${process.pid}`,
      });
      if (released) notifyPendingPromptChanged(droneId, chatName);
      return;
    }
    await updatePendingPrompt({
      droneId: opts.droneId,
      chatName,
      id: opts.id,
      patch: { state: 'queued', error: opts.error },
    });
  }

  async function resumePendingPromptChats(): Promise<
    Array<{ droneId: string; chatName: string; nextAttemptAt: string }>
  > {
    const queue = promptQueueForActiveDrone();
    if (!queue) return [];
    await queue.recoverExpiredLeases();
    return queue.listQueuedChatWakeups();
  }

  async function claimQueuedPendingPromptForSending(opts: {
    droneId: string;
    chatName: string;
    id: string;
  }): Promise<boolean> {
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (queue && droneIdForStore) {
      const claimed = await queue.claim({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        promptId: opts.id,
        leaseOwner: `hub:${process.pid}`,
      });
      if (claimed) notifyPendingPromptChanged(droneIdForStore, chatNameForStore);
      return Boolean(claimed);
    }
    let storeClaimed = false;
    if (droneIdForStore) {
      const storeClaim = claimQueuedPendingPromptInStore({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        id: opts.id,
      });
      if (storeClaim.available && !storeClaim.claimed && storeClaim.state) return false;
      storeClaimed = storeClaim.available && storeClaim.claimed;
    }
    let claimedPending: PendingPrompt | null = null;
    const claimed = await updateRegistry((regAny: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const drone = droneId ? regAny?.drones?.[droneId] : null;
      if (!drone) return false;
      const chatName = opts.chatName || 'default';
      const entry = drone?.chats?.[chatName];
      const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
      const idx = list.findIndex((item: any) => String(item?.id ?? '').trim() === opts.id);
      if (idx < 0) return false;
      const current = list[idx] ?? {};
      if (String(current?.state ?? '') !== 'queued') return false;
      list[idx] = { ...current, state: 'sending', error: undefined, updatedAt: deps.nowIso() };
      claimedPending = list[idx] as PendingPrompt;
      entry.pendingPrompts = list;
      drone.chats = drone.chats ?? {};
      drone.chats[chatName] = entry;
      regAny.drones = regAny.drones ?? {};
      regAny.drones[droneId] = drone;
      return true;
    });
    if (!storeClaimed && claimed && droneIdForStore && claimedPending) {
      upsertPendingPromptInStore({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        pending: claimedPending,
      });
    }
    return storeClaimed || Boolean(claimed);
  }

  async function claimQueuedPendingPromptForPromotion(opts: {
    droneId: string;
    chatName: string;
    id: string;
  }): Promise<PendingPrompt | null> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = opts.chatName || 'default';
    const queue = promptQueueForActiveDrone();
    if (!queue || !droneId) return null;
    const claimed = await queue.claimForSteering({
      droneId,
      chatName,
      promptId: opts.id,
      leaseOwner: `hub-promote:${process.pid}`,
    });
    if (claimed) notifyPendingPromptChanged(droneId, chatName);
    return claimed as PendingPrompt | null;
  }

  async function cancelQueuedPendingPrompt(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<CancelQueuedPendingPromptResult> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = deps.normalizeChatName(opts.chatName);
    const promptId = String(opts.promptId ?? '').trim();
    if (!droneId || !chatName || !promptId) return { status: 'not-found', pendingState: null };

    const queue = promptQueueForActiveDrone();
    if (queue) {
      const cancelled = await queue.cancelQueued({ droneId, chatName, promptId });
      if (cancelled.cancelled) {
        notifyPendingPromptChanged(droneId, chatName);
        return { status: 'cancelled', pendingState: 'queued' };
      }
      if (cancelled.state === 'cancelled') return { status: 'not-found', pendingState: null };
      if (cancelled.state) {
        return { status: 'already-submitted', pendingState: cancelled.state as PendingPromptState };
      }
      const registry: any = await loadRegistry();
      const turns = Array.isArray(registry?.drones?.[droneId]?.chats?.[chatName]?.turns)
        ? registry.drones[droneId].chats[chatName].turns
        : [];
      return turns.some((turn: any) => String(turn?.id ?? '').trim() === promptId)
        ? { status: 'already-submitted', pendingState: 'sent' }
        : { status: 'not-found', pendingState: null };
    }

    const storeCancel = cancelQueuedPendingPromptInStore({ droneId, chatName, id: promptId });
    if (storeCancel.available) {
      if (storeCancel.cancelled) {
        await updateRegistry((regAny: any) => {
          const drone = regAny?.drones?.[droneId] ?? null;
          const entry = drone?.chats?.[chatName] ?? null;
          const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
          const idx = list.findIndex((item: any) => String(item?.id ?? '').trim() === promptId);
          if (idx >= 0) {
            list.splice(idx, 1);
            entry.pendingPrompts = list;
            drone.chats = drone.chats ?? {};
            drone.chats[chatName] = entry;
            regAny.drones = regAny.drones ?? {};
            regAny.drones[droneId] = drone;
          }
        });
        // Registry writes can refresh the SQLite chat projection. Delete once
        // more after updating the legacy mirror so that refresh cannot revive
        // the prompt we just cancelled.
        cancelQueuedPendingPromptInStore({ droneId, chatName, id: promptId });
        return { status: 'cancelled', pendingState: 'queued' };
      }
      if (storeCancel.state)
        return {
          status: 'already-submitted',
          pendingState: storeCancel.state as PendingPromptState,
        };
    }

    const result = await updateRegistry((regAny: any) => {
      const drone = regAny?.drones?.[droneId] ?? null;
      if (!drone)
        return { status: 'not-found' as const, pendingState: null as PendingPromptState | null };
      const entry = drone?.chats?.[chatName] ?? null;
      const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
      const idx = list.findIndex((item: any) => String(item?.id ?? '').trim() === promptId);
      if (idx < 0)
        return { status: 'not-found' as const, pendingState: null as PendingPromptState | null };
      const item = list[idx] ?? {};
      const state = String(item?.state ?? '').trim() as PendingPromptState;
      if (state === 'queued') {
        list.splice(idx, 1);
        entry.pendingPrompts = list;
        drone.chats = drone.chats ?? {};
        drone.chats[chatName] = entry;
        regAny.drones = regAny.drones ?? {};
        regAny.drones[droneId] = drone;
        return { status: 'cancelled' as const, pendingState: 'queued' as const };
      }
      return { status: 'already-submitted' as const, pendingState: state || null };
    });

    if (result?.status === 'cancelled' || result?.status === 'already-submitted') {
      return { status: result.status, pendingState: result.pendingState ?? null };
    }

    const regAny: any = await loadRegistry();
    const turns = Array.isArray(regAny?.drones?.[droneId]?.chats?.[chatName]?.turns)
      ? regAny.drones[droneId].chats[chatName].turns
      : [];
    if (turns.some((turn: any) => String(turn?.id ?? '').trim() === promptId)) {
      return { status: 'already-submitted', pendingState: 'sent' };
    }
    return { status: 'not-found', pendingState: null };
  }

  return {
    cancelQueuedPendingPrompt,
    claimQueuedPendingPromptForPromotion,
    claimQueuedPendingPromptForSending,
    isSafePromptId,
    pendingPromptsFromChatEntry,
    pruneCompletedPendingPrompts,
    readPendingPrompts,
    readPendingPrompt,
    readPendingPromptDispatchWindow,
    readPendingStartupPrompts,
    releasePendingPromptClaim,
    reconcileCompletedInterruption,
    resolveInterruptedPendingPrompt,
    resumePendingPromptChats,
    retryPendingPrompt,
    transcriptTurnIdsFromEntry,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    updatePendingPrompt,
  };
}
