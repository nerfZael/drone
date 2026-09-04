import { ManagedLoop } from '../background/managed-loop';
import type { ArchiveRetentionId, ArchiveRuntimePolicy } from './hub-settings';

type ArchiveRuntimeDependencyName =
  | 'CHAT_NAME_MAX_LEN'
  | 'DRONE_DISPLAY_NAME_MAX_LEN'
  | 'allocateUntitledDisplayName'
  | 'archiveChatInStore'
  | 'archiveRetentionMs'
  | 'buildNewChatEntry'
  | 'collectDockerSnapshotImageRefsFromChatEntry'
  | 'collectDockerSnapshotImageRefsFromDroneEntry'
  | 'deleteArchivedChatFromStore'
  | 'deleteNativeChatSessionsForDrone'
  | 'droneDisplayNameExists'
  | 'droneRuntime'
  | 'dvmContainerExists'
  | 'dvmStart'
  | 'hubLog'
  | 'importArchivedChatsFromRegistry'
  | 'importDroneChatsFromRegistry'
  | 'listExpiredArchivedChatsFromStore'
  | 'listCanonicalDroneLifecycleForRead'
  | 'listChatsFromStore'
  | 'loadRegistry'
  | 'looksLikeContainerAlreadyRunningError'
  | 'normalizeChatName'
  | 'normalizeDroneIdentity'
  | 'nowIso'
  | 'parseArchiveRetentionId'
  | 'parseArchiveRuntimePolicy'
  | 'pauseResourceSubscriptionsForDrone'
  | 'permanentlyDeleteCanonicalDrone'
  | 'readChatFromStore'
  | 'readDroneChatCleanupProjectionFromStore'
  | 'removeDockerSnapshotImagesBestEffort'
  | 'removeDroneRuntimeArtifacts'
  | 'restoreArchivedChatInStore'
  | 'resumeResourceSubscriptionsForChat'
  | 'resumeResourceSubscriptionsForDrone'
  | 'revokeMcpAccessTokensForDrone'
  | 'updateRegistry'
  | 'upsertCanonicalDroneLifecycle';

export type ArchiveRuntimeDependencies = {
  [Key in ArchiveRuntimeDependencyName]: any;
};

export function createArchiveRuntime(deps: ArchiveRuntimeDependencies) {
  const {
    CHAT_NAME_MAX_LEN,
    DRONE_DISPLAY_NAME_MAX_LEN,
    allocateUntitledDisplayName,
    archiveChatInStore,
    archiveRetentionMs,
    buildNewChatEntry,
    collectDockerSnapshotImageRefsFromChatEntry,
    collectDockerSnapshotImageRefsFromDroneEntry,
    deleteArchivedChatFromStore,
    deleteNativeChatSessionsForDrone,
    droneDisplayNameExists,
    droneRuntime,
    dvmContainerExists,
    dvmStart,
    hubLog,
    importArchivedChatsFromRegistry,
    importDroneChatsFromRegistry,
    listExpiredArchivedChatsFromStore,
    listCanonicalDroneLifecycleForRead,
    listChatsFromStore,
    loadRegistry,
    looksLikeContainerAlreadyRunningError,
    normalizeChatName,
    normalizeDroneIdentity,
    nowIso,
    parseArchiveRetentionId,
    parseArchiveRuntimePolicy,
    pauseResourceSubscriptionsForDrone,
    permanentlyDeleteCanonicalDrone,
    readChatFromStore,
    readDroneChatCleanupProjectionFromStore,
    removeDockerSnapshotImagesBestEffort,
    removeDroneRuntimeArtifacts,
    restoreArchivedChatInStore,
    resumeResourceSubscriptionsForChat,
    resumeResourceSubscriptionsForDrone,
    revokeMcpAccessTokensForDrone,
    updateRegistry,
    upsertCanonicalDroneLifecycle,
  } = deps;

  const DEFAULT_ARCHIVE_RETENTION: ArchiveRetentionId = '1d';
  const DEFAULT_ARCHIVE_RUNTIME_POLICY: ArchiveRuntimePolicy = 'keep-running';

  function normalizeArchiveRetention(raw: unknown): ArchiveRetentionId {
    return parseArchiveRetentionId(raw) ?? DEFAULT_ARCHIVE_RETENTION;
  }

  function normalizeArchiveRuntimePolicy(raw: unknown): ArchiveRuntimePolicy {
    return parseArchiveRuntimePolicy(raw) ?? DEFAULT_ARCHIVE_RUNTIME_POLICY;
  }

  function parseIsoToMs(raw: unknown): number | null {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return null;
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return null;
    return ms;
  }

  function resolveArchiveDeleteAtIso(archivedEntry: any): string {
    const explicit = String(archivedEntry?.deleteAt ?? '').trim();
    if (explicit && Number.isFinite(Date.parse(explicit))) return explicit;
    const archivedAtMs = parseIsoToMs(archivedEntry?.archivedAt) ?? Date.now();
    const retention = normalizeArchiveRetention(archivedEntry?.archiveRetention);
    return new Date(archivedAtMs + archiveRetentionMs(retention)).toISOString();
  }

  function allocateRestoredDroneName(regAny: any, preferredRaw: unknown): string {
    const preferred = String(preferredRaw ?? '').trim();
    const fallback = preferred || allocateUntitledDisplayName(regAny);
    if (!droneDisplayNameExists(regAny, fallback)) return fallback;

    const maxBaseLen = Math.max(8, DRONE_DISPLAY_NAME_MAX_LEN - 8);
    const base = fallback.length > maxBaseLen ? fallback.slice(0, maxBaseLen).trim() : fallback;
    for (let i = 2; i <= 999; i += 1) {
      const candidate = `${base} (${i})`;
      if (candidate.length > DRONE_DISPLAY_NAME_MAX_LEN) continue;
      if (!droneDisplayNameExists(regAny, candidate)) return candidate;
    }
    return allocateUntitledDisplayName(regAny);
  }

  function lifecycleEntryFromRecord(record: any): any {
    const entry = {
      ...(record?.lifecycle && typeof record.lifecycle === 'object' ? record.lifecycle : {}),
      id: record.id,
      name: record.name,
      runtime: record.runtimeKind,
    };
    if (record.containerName) entry.containerName = record.containerName;
    else delete entry.containerName;
    if (record.phase) entry.phase = record.phase;
    else delete entry.phase;
    if (record.state === 'archived') {
      entry.archivedAt = record.archivedAt;
      entry.deleteAt = record.deleteAt;
      entry.archiveRetention = record.archiveRetention;
      if (record.archiveRuntimePolicy) entry.archiveRuntimePolicy = record.archiveRuntimePolicy;
      else delete entry.archiveRuntimePolicy;
    }
    return entry;
  }

  function storedChatBuckets(droneId: string): { chats: Record<string, any>; archivedChats: Record<string, any> } | null {
    const projected = readDroneChatCleanupProjectionFromStore({ droneId });
    return projected.available
      ? { chats: projected.chats, archivedChats: projected.archivedChats }
      : null;
  }

  async function resolveLifecycleEntry(
    state: 'real' | 'pending' | 'archived',
    droneId: string,
    opts: { includeChats?: boolean } = {},
  ): Promise<any | null> {
    const records = await listCanonicalDroneLifecycleForRead(state);
    if (records) {
      const record = records.find((candidate: any) => candidate.id === droneId) ?? null;
      if (!record) return null;
      const entry = lifecycleEntryFromRecord(record);
      if (opts.includeChats !== false) {
        const buckets = storedChatBuckets(droneId);
        if (!buckets) {
          // A lifecycle database can exist before the transcript schema is
          // available during recovery. Preserve correctness with the legacy
          // projection in that exceptional state instead of silently dropping
          // chat/session references from archive cleanup.
          const registry: any = await loadRegistry();
          const bucket = state === 'real' ? registry?.drones : state === 'pending' ? registry?.pending : registry?.archived;
          return bucket?.[droneId] ?? entry;
        }
        if (Object.keys(buckets.chats).length > 0) entry.chats = buckets.chats;
        else delete entry.chats;
        if (Object.keys(buckets.archivedChats).length > 0) entry.archivedChats = buckets.archivedChats;
        else delete entry.archivedChats;
      }
      return entry;
    }
    const registry: any = await loadRegistry();
    const bucket = state === 'real' ? registry?.drones : state === 'pending' ? registry?.pending : registry?.archived;
    return bucket?.[droneId] ?? null;
  }

  async function archiveChatById(opts: {
    droneId: string;
    chatName: string;
    archiveRetention: ArchiveRetentionId;
  }): Promise<{
    hadDrone: boolean;
    hadChat: boolean;
    archived: boolean;
    droneId: string;
    chatName: string;
    archiveRetention: ArchiveRetentionId;
    archivedAt: string | null;
    deleteAt: string | null;
    chats: string[];
  }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const retention = normalizeArchiveRetention(opts.archiveRetention);
    if (!droneId || !chatName) {
      return {
        hadDrone: false,
        hadChat: false,
        archived: false,
        droneId: String(opts.droneId ?? ''),
        chatName,
        archiveRetention: retention,
        archivedAt: null,
        deleteAt: null,
        chats: [],
      };
    }

    const droneEntry = await resolveLifecycleEntry('real', droneId, { includeChats: false });
    if (!droneEntry) {
      return {
        hadDrone: false,
        hadChat: false,
        archived: false,
        droneId,
        chatName,
        archiveRetention: retention,
        archivedAt: null,
        deleteAt: null,
        chats: [] as string[],
      };
    }
    if ((globalThis as any).Bun) {
      await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
      await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
    }
    if (!readChatFromStore({ droneId, chatName }).chat) {
      return {
        hadDrone: true,
        hadChat: false,
        archived: false,
        droneId,
        chatName,
        archiveRetention: retention,
        archivedAt: null,
        deleteAt: null,
        chats: listChatsFromStore({ droneId }).chats,
      };
    }

    const archivedAt = nowIso();
    const deleteAt = new Date(Date.now() + archiveRetentionMs(retention)).toISOString();
    const fallbackChat = {
      chatName: 'default',
      chatEntry: buildNewChatEntry({
        droneEntry,
        createdAt: nowIso(),
      }),
    };
    const stored = await archiveChatInStore({
      droneId,
      chatName,
      archivedAt,
      deleteAt,
      archiveRetention: retention,
      fallbackChat,
    });
    if (stored.archived && (globalThis as any).Bun) {
      await updateRegistry((regAny: any) => {
        const entry = regAny?.drones?.[droneId];
        if (!entry) return;
        entry.chats = entry.chats ?? {};
        delete entry.chats[chatName];
        entry.archivedChats = entry.archivedChats ?? {};
        entry.archivedChats[chatName] = {
          ...(stored.archivedChat?.chat ?? {}),
          archivedAt,
          deleteAt,
          archiveRetention: retention,
        };
        if (Object.keys(entry.chats).length === 0) entry.chats.default = fallbackChat.chatEntry;
      });
    }
    return {
      hadDrone: true,
      hadChat: stored.archived,
      archived: stored.archived,
      droneId,
      chatName,
      archiveRetention: retention,
      archivedAt: stored.archived ? archivedAt : null,
      deleteAt: stored.archived ? deleteAt : null,
      chats: stored.chats,
    };
  }

  async function restoreArchivedChatById(opts: {
    droneId: string;
    archivedChatName: string;
  }): Promise<{
    hadDrone: boolean;
    hadChat: boolean;
    restored: boolean;
    droneId: string;
    chatName: string;
    renamed: boolean;
    chats: string[];
  }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const archivedChatName = normalizeChatName(opts.archivedChatName);
    if (!droneId || !archivedChatName) {
      return {
        hadDrone: false,
        hadChat: false,
        restored: false,
        droneId: String(opts.droneId ?? ''),
        chatName: archivedChatName,
        renamed: false,
        chats: [],
      };
    }

    const droneEntry = await resolveLifecycleEntry('real', droneId, { includeChats: false });
    if (!droneEntry) {
      return {
        hadDrone: false,
        hadChat: false,
        restored: false,
        droneId,
        chatName: archivedChatName,
        renamed: false,
        chats: [] as string[],
      };
    }
    if ((globalThis as any).Bun) {
      await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
      await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
    }
    const stored = await restoreArchivedChatInStore({
      droneId,
      archivedChatName,
      maxChatNameLength: CHAT_NAME_MAX_LEN,
    });
    if (stored.restored && (globalThis as any).Bun) {
      await updateRegistry((regAny: any) => {
        const entry = regAny?.drones?.[droneId];
        if (!entry) return;
        entry.chats = entry.chats ?? {};
        entry.chats[stored.chatName] = stored.chat ?? {};
        if (entry.archivedChats?.[archivedChatName]) delete entry.archivedChats[archivedChatName];
        if (entry.archivedChats && Object.keys(entry.archivedChats).length === 0)
          delete entry.archivedChats;
      });
    }
    const restoredChatId = String(stored.chat?.id ?? '').trim();
    if (stored.restored && restoredChatId) {
      await resumeResourceSubscriptionsForChat(restoredChatId);
    }
    return {
      hadDrone: true,
      hadChat: stored.restored,
      restored: stored.restored,
      droneId,
      chatName: stored.chatName,
      renamed: stored.renamed,
      chats: stored.chats,
    };
  }

  async function deleteArchivedChatById(opts: {
    droneId: string;
    archivedChatName: string;
  }): Promise<{
    hadDrone: boolean;
    hadChat: boolean;
    deleted: boolean;
    droneId: string;
    chatName: string;
  }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const archivedChatName = normalizeChatName(opts.archivedChatName);
    if (!droneId || !archivedChatName) {
      return {
        hadDrone: false,
        hadChat: false,
        deleted: false,
        droneId: String(opts.droneId ?? ''),
        chatName: archivedChatName,
      };
    }

    const canonicalReal = await listCanonicalDroneLifecycleForRead('real');
    let hadDrone: boolean;
    if (canonicalReal) {
      hadDrone = canonicalReal.some((record: any) => record.id === droneId);
    } else {
      const registry: any = await loadRegistry();
      const droneEntry = registry?.drones?.[droneId] ?? null;
      hadDrone = Boolean(droneEntry);
      if (droneEntry) {
        await importArchivedChatsFromRegistry({
          droneId,
          archivedChats: droneEntry.archivedChats,
        });
      }
    }
    if (!hadDrone) {
      return {
        hadDrone: false,
        hadChat: false,
        deleted: false,
        droneId,
        chatName: archivedChatName,
      };
    }
    const stored = await deleteArchivedChatFromStore({ droneId, archivedChatName });
    if (stored.deleted && (globalThis as any).Bun) {
      await updateRegistry((regAny: any) => {
        const entry = regAny?.drones?.[droneId];
        if (entry?.archivedChats?.[archivedChatName]) delete entry.archivedChats[archivedChatName];
        if (entry?.archivedChats && Object.keys(entry.archivedChats).length === 0)
          delete entry.archivedChats;
      });
    }
    if (stored.deleted) {
      const snapshotImageRefs = collectDockerSnapshotImageRefsFromChatEntry(
        stored.archivedChat?.chat,
      );
      await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
        droneId,
        chatName: archivedChatName,
        reason: 'delete-archived-chat',
      });
      if (stored.archivedChat?.chat) {
        await deleteNativeChatSessionsForDrone({
          chats: { [archivedChatName]: stored.archivedChat.chat },
        });
      }
    }
    return {
      hadDrone: true,
      hadChat: stored.deleted,
      deleted: stored.deleted,
      droneId,
      chatName: archivedChatName,
    };
  }

  async function cleanupExpiredArchivedChats(opts?: { reason?: string }): Promise<void> {
    const nowMs = Date.now();
    let expired: Array<{ droneId: string; chatName: string }> | null = null;
    const scanStartedAt = performance.now();
    const listed = listExpiredArchivedChatsFromStore({
      deleteAtOrBefore: new Date(nowMs).toISOString(),
    });
    if (listed.available) expired = listed.archivedChats;
    hubLog('info', 'archive TTL chat scan completed', {
      reason: opts?.reason ?? null,
      durationMs: Math.round((performance.now() - scanStartedAt) * 10) / 10,
      expiredCount: expired?.length ?? null,
      readModel: listed.available ? 'targeted-expiry-keys' : 'compatibility-projection',
    });
    if (!expired) {
      const regSnapshot: any = await loadRegistry();
      expired = (Object.entries(regSnapshot?.drones ?? {}) as Array<[string, any]>).flatMap(
        ([droneIdRaw, droneEntry]) => {
          const droneId = normalizeDroneIdentity(droneIdRaw);
          if (!droneId) return [];
          return (Object.entries(droneEntry?.archivedChats ?? {}) as Array<[string, any]>)
            .map(([chatNameRaw, entry]) => {
              const chatName = normalizeChatName(chatNameRaw);
              const deleteAtMs = parseIsoToMs(resolveArchiveDeleteAtIso(entry));
              if (!chatName || deleteAtMs == null || deleteAtMs > nowMs) return null;
              return { droneId, chatName };
            })
            .filter((item): item is { droneId: string; chatName: string } => Boolean(item));
        },
      );
    }

    for (const item of expired) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await deleteArchivedChatById({ droneId: item.droneId, archivedChatName: item.chatName });
        hubLog('info', 'archive TTL deleted chat', {
          droneId: item.droneId,
          chat: item.chatName,
          reason: opts?.reason ?? null,
        });
      } catch (e: any) {
        hubLog('warn', 'archive TTL delete chat failed', {
          droneId: item.droneId,
          chat: item.chatName,
          reason: opts?.reason ?? null,
          error: e?.message ?? String(e),
        });
      }
    }
  }

  async function archiveDroneById(opts: {
    id: string;
    archiveRetention: ArchiveRetentionId;
    archiveRuntimePolicy: ArchiveRuntimePolicy;
  }): Promise<{
    hadEntry: boolean;
    archived: boolean;
    id: string;
    name: string;
    archiveRetention: ArchiveRetentionId;
    archiveRuntimePolicy: ArchiveRuntimePolicy;
    archivedAt: string | null;
    deleteAt: string | null;
  }> {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId) {
      return {
        hadEntry: false,
        archived: false,
        id: String(opts.id ?? ''),
        name: String(opts.id ?? ''),
        archiveRetention: normalizeArchiveRetention(opts.archiveRetention),
        archiveRuntimePolicy: normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy),
        archivedAt: null,
        deleteAt: null,
      };
    }
    const retention = normalizeArchiveRetention(opts.archiveRetention);
    const runtimePolicy = normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy);
    const droneEntry = await resolveLifecycleEntry('real', droneId);
    if (!droneEntry) {
      return {
        hadEntry: false,
        archived: false,
        id: droneId,
        name: droneId,
        archiveRetention: retention,
        archiveRuntimePolicy: runtimePolicy,
        archivedAt: null,
        deleteAt: null,
      };
    }
    const archivedAt = nowIso();
    const deleteAt = new Date(Date.now() + archiveRetentionMs(retention)).toISOString();
    const name = String(droneEntry?.name ?? '').trim() || droneId;
    const containerName =
      String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() ||
      `drone-${droneId}`;
    await upsertCanonicalDroneLifecycle('archived', droneId, {
      ...droneEntry,
      id: droneId,
      name,
      containerName,
      archivedAt,
      deleteAt,
      archiveRetention: retention,
      archiveRuntimePolicy: runtimePolicy,
    });
    await pauseResourceSubscriptionsForDrone(droneId, droneEntry);
    return {
      hadEntry: true,
      archived: true,
      id: droneId,
      name,
      archiveRetention: retention,
      archiveRuntimePolicy: runtimePolicy,
      archivedAt,
      deleteAt,
    };
  }

  async function restoreArchivedDroneById(opts: { id: string }): Promise<{
    hadEntry: boolean;
    restored: boolean;
    id: string;
    name: string;
    renamed: boolean;
    error: string | null;
  }> {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId) {
      return {
        hadEntry: false,
        restored: false,
        id: String(opts.id ?? ''),
        name: String(opts.id ?? ''),
        renamed: false,
        error: `invalid drone id: ${String(opts.id ?? '')}`,
      };
    }

    const archivedEntry = await resolveLifecycleEntry('archived', droneId);
    if (!archivedEntry) {
      return {
        hadEntry: false,
        restored: false,
        id: droneId,
        name: droneId,
        renamed: false,
        error: `unknown archived drone: ${droneId}`,
      };
    }

    const containerName =
      String(archivedEntry?.containerName ?? archivedEntry?.name ?? `drone-${droneId}`).trim() ||
      `drone-${droneId}`;
    const runtime = droneRuntime(archivedEntry);
    const archiveRuntimePolicy = normalizeArchiveRuntimePolicy(archivedEntry?.archiveRuntimePolicy);
    if (runtime !== 'host') {
      const containerExists = await dvmContainerExists(containerName);
      if (!containerExists) {
        return {
          hadEntry: true,
          restored: false,
          id: droneId,
          name: String(archivedEntry?.name ?? '').trim() || droneId,
          renamed: false,
          error: `container "${containerName}" no longer exists`,
        };
      }

      if (archiveRuntimePolicy === 'stop') {
        try {
          await dvmStart(containerName);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (!looksLikeContainerAlreadyRunningError(msg)) {
            return {
              hadEntry: true,
              restored: false,
              id: droneId,
              name: String(archivedEntry?.name ?? '').trim() || droneId,
              renamed: false,
              error: `failed to start archived drone container "${containerName}": ${msg}`,
            };
          }
        }
      }
    }

    const previousName = String(archivedEntry?.name ?? '').trim() || droneId;
    const canonicalReal = await listCanonicalDroneLifecycleForRead('real');
    const canonicalPending = await listCanonicalDroneLifecycleForRead('pending');
    const namingRegistry = canonicalReal && canonicalPending
      ? {
          drones: Object.fromEntries(canonicalReal.map((record: any) => [record.id, lifecycleEntryFromRecord(record)])),
          pending: Object.fromEntries(canonicalPending.map((record: any) => [record.id, lifecycleEntryFromRecord(record)])),
        }
      : await loadRegistry();
    const restoredName = allocateRestoredDroneName(namingRegistry, previousName);
    const restoredEntry: any = {
      ...archivedEntry,
      id: droneId,
      name: restoredName,
      containerName,
    };
    delete restoredEntry.archivedAt;
    delete restoredEntry.deleteAt;
    delete restoredEntry.archiveRetention;
    delete restoredEntry.archiveRuntimePolicy;
    await upsertCanonicalDroneLifecycle('real', droneId, restoredEntry);
    await resumeResourceSubscriptionsForDrone(droneId, archivedEntry);
    return {
      hadEntry: true,
      restored: true,
      id: droneId,
      name: restoredName,
      renamed: restoredName !== previousName,
      error: null,
    };
  }

  async function removeArchivedDroneById(opts: { id: string; keepVolume: boolean }): Promise<{
    hadEntry: boolean;
    removedArchive: boolean;
    id: string;
    name: string;
    removeErr: string | null;
  }> {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId) {
      return {
        hadEntry: false,
        removedArchive: false,
        id: String(opts.id ?? ''),
        name: String(opts.id ?? ''),
        removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
      };
    }

    const archivedEntry = await resolveLifecycleEntry('archived', droneId);
    const hadEntry = Boolean(archivedEntry);
    const name = String(archivedEntry?.name ?? '').trim() || droneId;
    if (!archivedEntry) {
      return {
        hadEntry: false,
        removedArchive: false,
        id: droneId,
        name,
        removeErr: `unknown archived drone: ${droneId}`,
      };
    }

    const { containerGone, removeErr } = await removeDroneRuntimeArtifacts({
      droneId,
      droneEntry: archivedEntry,
      keepVolume: opts.keepVolume,
      updateLiveRegistry: false,
    });

    let removedArchive = false;
    if (containerGone) {
      const snapshotImageRefs = collectDockerSnapshotImageRefsFromDroneEntry(archivedEntry);
      removedArchive = (
        await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'archived' })
      ).removedLifecycle;
      if (removedArchive) {
        await revokeMcpAccessTokensForDrone(droneId);
        await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
          droneId,
          reason: 'delete-archived-drone',
        });
        await deleteNativeChatSessionsForDrone(archivedEntry);
      }
    }

    return { hadEntry, removedArchive, id: droneId, name, removeErr };
  }

  let ARCHIVE_CLEANUP_TASK: Promise<void> | null = null;
  const ARCHIVE_CLEANUP_INTERVAL_MS = 5 * 60_000;
  const ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN = 25;
  let archiveCleanupLoop: ManagedLoop | null = null;
  let archiveCleanupReason = 'interval';
  let archiveCleanupStopped = false;

  function triggerArchiveCleanup(reason: string) {
    if (archiveCleanupStopped) return;
    archiveCleanupReason = reason;
    if (archiveCleanupLoop) {
      archiveCleanupLoop.wake();
      return;
    }
    void cleanupExpiredArchivedDrones({ reason }).catch((e: any) => {
      hubLog('warn', 'archive cleanup failed', {
        reason,
        error: e?.message ?? String(e),
      });
    });
  }

  async function cleanupExpiredArchivedDrones(opts?: {
    maxDeletes?: number;
    reason?: string;
  }): Promise<void> {
    if (ARCHIVE_CLEANUP_TASK) {
      await ARCHIVE_CLEANUP_TASK;
      return;
    }
    const maxDeletes =
      typeof opts?.maxDeletes === 'number' && Number.isFinite(opts.maxDeletes)
        ? Math.max(1, Math.floor(opts.maxDeletes))
        : ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN;

    ARCHIVE_CLEANUP_TASK = (async () => {
      const canonicalArchived = await listCanonicalDroneLifecycleForRead('archived');
      const nowMs = Date.now();
      let archiveEntries: Array<[string, any]>;
      if (canonicalArchived) {
        archiveEntries = canonicalArchived.map((record: any) => [record.id, lifecycleEntryFromRecord(record)]);
      } else {
        const regAny: any = await loadRegistry();
        archiveEntries = Object.entries(regAny?.archived ?? {}) as Array<[string, any]>;
      }
      const expiredIds = archiveEntries
        .map(([id, entry]) => {
          const parsedId = normalizeDroneIdentity(id);
          if (!parsedId) return null;
          const deleteAtIso = resolveArchiveDeleteAtIso(entry);
          const deleteAtMs = parseIsoToMs(deleteAtIso);
          if (deleteAtMs == null || deleteAtMs > nowMs) return null;
          return parsedId;
        })
        .filter((id): id is string => Boolean(id))
        .slice(0, maxDeletes);

      for (const droneId of expiredIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await removeArchivedDroneById({ id: droneId, keepVolume: false });
          if (r.removeErr) {
            hubLog('warn', 'archive TTL delete failed', {
              id: droneId,
              error: r.removeErr,
              reason: opts?.reason ?? null,
            });
          } else {
            hubLog('info', 'archive TTL deleted drone', {
              id: droneId,
              reason: opts?.reason ?? null,
            });
          }
        } catch (e: any) {
          hubLog('warn', 'archive TTL delete failed (exception)', {
            id: droneId,
            error: e?.message ?? String(e),
            reason: opts?.reason ?? null,
          });
        }
      }
    })().finally(() => {
      ARCHIVE_CLEANUP_TASK = null;
    });

    await ARCHIVE_CLEANUP_TASK;
  }

  function startArchiveCleanupScheduler(): void {
    if (archiveCleanupLoop) return;
    archiveCleanupStopped = false;
    archiveCleanupReason = 'startup';
    archiveCleanupLoop = new ManagedLoop({
      intervalMs: ARCHIVE_CLEANUP_INTERVAL_MS,
      run: async () => {
        const reason = archiveCleanupReason;
        archiveCleanupReason = 'interval';
        await cleanupExpiredArchivedDrones({ reason }).catch((error) => {
          hubLog('warn', 'archive cleanup failed', {
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });
    archiveCleanupLoop.start();
  }

  async function stopArchiveCleanupScheduler(): Promise<void> {
    archiveCleanupStopped = true;
    const loop = archiveCleanupLoop;
    archiveCleanupLoop = null;
    await loop?.stop();
    await ARCHIVE_CLEANUP_TASK?.catch(() => {});
  }

  return {
    archiveChatById,
    archiveDroneById,
    cleanupExpiredArchivedChats,
    cleanupExpiredArchivedDrones,
    deleteArchivedChatById,
    normalizeArchiveRetention,
    normalizeArchiveRuntimePolicy,
    parseIsoToMs,
    removeArchivedDroneById,
    resolveArchiveDeleteAtIso,
    restoreArchivedChatById,
    restoreArchivedDroneById,
    startArchiveCleanupScheduler,
    stopArchiveCleanupScheduler,
    triggerArchiveCleanup,
  };
}
