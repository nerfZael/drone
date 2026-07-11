import { loadRegistry, updateRegistry } from '../host/registry';
import { normalizeDroneIdentity } from './drone-lifecycle-registry';
import type { PendingPromptState, PendingStartupPrompt } from './drone-pending-state';
import type { ChatImageAttachmentRef } from './chat-attachments';
import {
  cancelQueuedPendingPromptInStore,
  claimQueuedPendingPromptInStore,
  importChatFromRegistry,
  readChatFromStore,
  updatePendingPromptInStore,
  upsertPendingPromptInStore,
} from './transcript-store';

export type PendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  messageId?: string;
  cwd?: string | null;
  attachments?: ChatImageAttachmentRef[];
  automation?: any;
  blockedByAutomation?: boolean;
  state: PendingPromptState;
  error?: string;
  observability?: {
    state: 'status-unavailable';
    message: string;
    lastCheckedAt: string;
    lastError?: string;
  };
  updatedAt?: string;
};

export type CancelQueuedPendingPromptStatus = 'cancelled' | 'already-submitted' | 'not-found';

export type CancelQueuedPendingPromptResult = {
  status: CancelQueuedPendingPromptStatus;
  pendingState?: PendingPromptState | null;
};

const RECENT_COMPLETED_PENDING_PROMPT_GRACE_MS = 2 * 60_000;

export function createDronePendingPromptStore(deps: {
  normalizeChatImageAttachmentRefs: (raw: unknown) => ChatImageAttachmentRef[];
  normalizeChatName: (raw: any) => string;
  normalizePendingPromptState: (raw: unknown) => PendingPromptState;
  normalizePendingPromptText: (raw: unknown) => string;
  normalizePendingStartupPrompts: (raw: unknown, chatNameFilter?: string) => PendingStartupPrompt[];
  normalizePromptAutomationMeta: (raw: unknown) => any;
  nowIso: () => string;
  startupPromptToPendingPrompt: (prompt: PendingStartupPrompt) => PendingPrompt;
}) {
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
    const turns = Array.isArray(turnsRaw) ? turnsRaw : [];
    const turnById = new Map<string, any>();
    for (const turn of turns) {
      const id = String((turn as any)?.id ?? '').trim();
      if (!id) continue;
      turnById.set(id, turn);
    }
    if (turnById.size === 0) return list;

    const keepRecentlyCompleted = opts?.keepRecentlyCompleted === true;
    const nowMs = typeof opts?.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();

    return list.filter((item) => {
      if (item.state === 'failed') return true;
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
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    return new Set(turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean));
  }

  function pendingPromptsFromChatEntry(entry: any, opts?: { keepRecentlyCompleted?: boolean }): PendingPrompt[] {
    const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    const pending = pruneCompletedPendingPrompts(
      list
        .map((p: any) => ({
          id: String(p?.id ?? '').trim(),
          at: String(p?.at ?? '').trim(),
          prompt: deps.normalizePendingPromptText(p?.prompt),
          ...(typeof p?.messageId === 'string' && String(p.messageId).trim() ? { messageId: String(p.messageId).trim() } : {}),
          cwd: typeof p?.cwd === 'string' ? String(p.cwd) : p?.cwd === null ? null : undefined,
          attachments: deps.normalizeChatImageAttachmentRefs(p?.attachments),
          automation: deps.normalizePromptAutomationMeta((p as any)?.automation),
          blockedByAutomation: Boolean((p as any)?.blockedByAutomation),
          state:
            p?.state === 'sent' || p?.state === 'failed' || p?.state === 'sending' || p?.state === 'queued'
              ? (p.state as PendingPromptState)
              : 'sending',
          error: typeof p?.error === 'string' ? p.error : undefined,
          observability: normalizeObservability((p as any)?.observability),
          updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : undefined,
        }))
        .filter((p: PendingPrompt) => p.id && p.prompt.trim())
        .slice(-60),
      entry?.turns,
      { keepRecentlyCompleted: opts?.keepRecentlyCompleted === true },
    );
    if (opts?.keepRecentlyCompleted !== true) return pending;

    const seen = new Set(pending.map((item) => item.id));
    const nowMs = Date.now();
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    for (const turn of turns) {
      const id = String((turn as any)?.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      const automation = deps.normalizePromptAutomationMeta((turn as any)?.automation);
      if (!automation) continue;
      const completedMs = Math.max(
        parseRecentPendingPromptIsoMs((turn as any)?.completedAt),
        parseRecentPendingPromptIsoMs((turn as any)?.promptAt),
        parseRecentPendingPromptIsoMs((turn as any)?.at),
      );
      if (!completedMs || nowMs - completedMs > RECENT_COMPLETED_PENDING_PROMPT_GRACE_MS) continue;
      const prompt = deps.normalizePendingPromptText((turn as any)?.prompt);
      if (!prompt.trim()) continue;
      pending.push({
        id,
        at: String((turn as any)?.promptAt ?? (turn as any)?.at ?? deps.nowIso()),
        prompt,
        automation,
        state: 'sent',
        updatedAt: String((turn as any)?.completedAt ?? (turn as any)?.at ?? deps.nowIso()),
      });
      seen.add(id);
    }
    return pending.slice(-60);
  }

  function normalizeObservability(raw: unknown): PendingPrompt['observability'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    if (String((raw as any).state ?? '').trim() !== 'status-unavailable') return undefined;
    const lastCheckedAt = String((raw as any).lastCheckedAt ?? '').trim();
    const message = String((raw as any).message ?? '').trim() || 'Prompt status is temporarily unavailable.';
    return {
      state: 'status-unavailable',
      message,
      lastCheckedAt: lastCheckedAt || deps.nowIso(),
      ...(typeof (raw as any).lastError === 'string' && String((raw as any).lastError).trim()
        ? { lastError: String((raw as any).lastError).trim() }
        : {}),
    };
  }

  function isSafePromptId(raw: string): boolean {
    const text = String(raw ?? '').trim();
    if (!text) return false;
    if (text.length > 96) return false;
    return /^[A-Za-z0-9._-]+$/.test(text);
  }

  async function readPendingPrompts(opts: { droneId: string; chatName: string }): Promise<PendingPrompt[]> {
    const regAny: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const drone = droneId ? regAny?.drones?.[droneId] : null;
    if (!drone) {
      if (droneId && regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) throw new Error(`drone "${droneId}" is still starting`);
      throw new Error(`unknown drone: ${opts.droneId}`);
    }
    const chatName = opts.chatName || 'default';
    const entry = drone?.chats?.[chatName];
    if (entry) {
      importChatFromRegistry({ droneId, chatName, chatEntry: entry });
      const read = readChatFromStore({ droneId, chatName });
      if (read.available && read.chat) {
        return pendingPromptsFromChatEntry(read.chat, { keepRecentlyCompleted: true }).slice(-50);
      }
    }
    return pendingPromptsFromChatEntry(entry, { keepRecentlyCompleted: true }).slice(-50);
  }

  async function readPendingStartupPrompts(opts: { droneId: string; chatName: string }): Promise<PendingPrompt[]> {
    const regAny: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const pending = droneId ? regAny?.pending?.[droneId] : null;
    if (!pending) return [];
    return deps.normalizePendingStartupPrompts((pending as any)?.startupQueuedPrompts, opts.chatName).map(deps.startupPromptToPendingPrompt);
  }

  async function pushPendingPrompt(opts: { droneId: string; chatName: string; pending: PendingPrompt }): Promise<void> {
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    if (droneIdForStore) {
      upsertPendingPromptInStore({ droneId: droneIdForStore, chatName: chatNameForStore, pending: opts.pending });
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
      const existingIdx = entry.pendingPrompts.findIndex((item: any) => String(item?.id ?? '').trim() === id);
      if (existingIdx === -1) {
        entry.pendingPrompts.push(opts.pending);
      } else {
        const current = entry.pendingPrompts[existingIdx] ?? {};
        entry.pendingPrompts[existingIdx] = { ...current, ...opts.pending, updatedAt: opts.pending.updatedAt ?? deps.nowIso() };
      }
      entry.pendingPrompts = entry.pendingPrompts.slice(-60);
      drone.chats[chatName] = entry;
      regAny.drones = regAny.drones ?? {};
      regAny.drones[droneId] = drone;
    });
  }

  async function pushPendingStartupPrompt(
    opts: { droneId: string; chatName: string; pending: PendingPrompt },
  ): Promise<'queued' | 'active' | 'missing'> {
    return await updateRegistry((regAny: any) => {
      const droneId = normalizeDroneIdentity(opts.droneId);
      const pendingDrone = droneId ? regAny?.pending?.[droneId] : null;
      if (!pendingDrone) return regAny?.drones?.[droneId] ? 'active' : 'missing';
      if (regAny?.drones?.[droneId]) return 'active';

      const chatName = deps.normalizeChatName(opts.chatName);
      const list = deps.normalizePendingStartupPrompts((pendingDrone as any)?.startupQueuedPrompts);
      const id = String(opts.pending?.id ?? '').trim();
      if (!id) return 'missing';

      const next: PendingStartupPrompt = {
        id,
        chatName,
        at: String(opts.pending?.at ?? deps.nowIso()),
        prompt: String(opts.pending?.prompt ?? ''),
        ...(typeof opts.pending?.messageId === 'string' && opts.pending.messageId.trim() ? { messageId: opts.pending.messageId.trim() } : {}),
        ...(typeof opts.pending?.cwd === 'string' || opts.pending?.cwd === null ? { cwd: opts.pending.cwd } : {}),
        state: deps.normalizePendingPromptState(opts.pending?.state),
        ...(typeof opts.pending?.error === 'string' ? { error: opts.pending.error } : {}),
        updatedAt: String(opts.pending?.updatedAt ?? deps.nowIso()),
      };
      if (!next.prompt.trim()) return 'missing';

      const existingIdx = list.findIndex((entry) => entry.id === id);
      if (existingIdx === -1) {
        list.push(next);
      } else {
        const current = list[existingIdx] ?? next;
        list[existingIdx] = { ...current, ...next, updatedAt: next.updatedAt ?? deps.nowIso() };
      }

      (pendingDrone as any).startupQueuedPrompts = list.slice(-80);
      pendingDrone.updatedAt = deps.nowIso();
      regAny.pending = regAny.pending ?? {};
      regAny.pending[droneId] = pendingDrone;
      return 'queued';
    });
  }

  async function updatePendingPrompt(opts: {
    droneId: string;
    chatName: string;
    id: string;
    patch: Partial<Pick<PendingPrompt, 'state' | 'error' | 'observability' | 'updatedAt'>>;
  }): Promise<void> {
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    if (droneIdForStore) {
      updatePendingPromptInStore({
        droneId: droneIdForStore,
        chatName: chatNameForStore,
        id: opts.id,
        patch: opts.patch,
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
      list[idx] = { ...current, ...opts.patch, updatedAt: opts.patch.updatedAt ?? deps.nowIso() };
      entry.pendingPrompts = list;
      drone.chats = drone.chats ?? {};
      drone.chats[chatName] = entry;
      regAny.drones = regAny.drones ?? {};
      regAny.drones[droneId] = drone;
    });
  }

  async function claimQueuedPendingPromptForSending(opts: { droneId: string; chatName: string; id: string }): Promise<boolean> {
    const droneIdForStore = normalizeDroneIdentity(opts.droneId);
    const chatNameForStore = opts.chatName || 'default';
    let storeClaimed = false;
    if (droneIdForStore) {
      const storeClaim = claimQueuedPendingPromptInStore({ droneId: droneIdForStore, chatName: chatNameForStore, id: opts.id });
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
      upsertPendingPromptInStore({ droneId: droneIdForStore, chatName: chatNameForStore, pending: claimedPending });
    }
    return storeClaimed || Boolean(claimed);
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
      if (storeCancel.state) return { status: 'already-submitted', pendingState: storeCancel.state as PendingPromptState };
    }

    const result = await updateRegistry((regAny: any) => {
      const drone = regAny?.drones?.[droneId] ?? null;
      if (!drone) return { status: 'not-found' as const, pendingState: null as PendingPromptState | null };
      const entry = drone?.chats?.[chatName] ?? null;
      const list = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
      const idx = list.findIndex((item: any) => String(item?.id ?? '').trim() === promptId);
      if (idx < 0) return { status: 'not-found' as const, pendingState: null as PendingPromptState | null };
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
    claimQueuedPendingPromptForSending,
    isSafePromptId,
    pendingPromptsFromChatEntry,
    pruneCompletedPendingPrompts,
    readPendingPrompts,
    readPendingStartupPrompts,
    transcriptTurnIdsFromEntry,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    updatePendingPrompt,
  };
}
