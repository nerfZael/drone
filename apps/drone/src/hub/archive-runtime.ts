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
  | 'listCanonicalDroneLifecycle'
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
    listCanonicalDroneLifecycle,
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

    const registry: any = await loadRegistry();
    const droneEntry = registry?.drones?.[droneId] ?? null;
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
    await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
    await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
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

    const registry: any = await loadRegistry();
    const droneEntry = registry?.drones?.[droneId] ?? null;
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
    await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
    await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
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

    const registry: any = await loadRegistry();
    const droneEntry = registry?.drones?.[droneId] ?? null;
    if (!droneEntry) {
      return {
        hadDrone: false,
        hadChat: false,
        deleted: false,
        droneId,
        chatName: archivedChatName,
      };
    }
    await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
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
    const regSnapshot: any = await loadRegistry();
    const nowMs = Date.now();
    const expired = (Object.entries(regSnapshot?.drones ?? {}) as Array<[string, any]>).flatMap(
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
    const registry: any = await loadRegistry();
    const droneEntry = registry?.drones?.[droneId];
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

    const regSnapshot: any = await loadRegistry();
    const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
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
    const restoredName = allocateRestoredDroneName(regSnapshot, previousName);
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

    const regSnapshot: any = await loadRegistry();
    const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
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
  let ARCHIVE_CLEANUP_INTERVAL: ReturnType<typeof setInterval> | null = null;

  function triggerArchiveCleanup(reason: string) {
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
      const regAny: any = await loadRegistry();
      const canonicalArchived = await listCanonicalDroneLifecycle('archived');
      const nowMs = Date.now();
      const archiveEntries: Array<[string, any]> = canonicalArchived
        ? canonicalArchived.map((record: any) => [record.id, record.lifecycle])
        : (Object.entries(regAny?.archived ?? {}) as Array<[string, any]>);
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
    if (!ARCHIVE_CLEANUP_INTERVAL) {
      ARCHIVE_CLEANUP_INTERVAL = setInterval(() => {
        triggerArchiveCleanup('interval');
      }, ARCHIVE_CLEANUP_INTERVAL_MS);
      try {
        (ARCHIVE_CLEANUP_INTERVAL as any).unref?.();
      } catch {
        // ignore
      }
    }
    triggerArchiveCleanup('startup');
  }

  function stopArchiveCleanupScheduler(): void {
    if (!ARCHIVE_CLEANUP_INTERVAL) return;
    try {
      clearInterval(ARCHIVE_CLEANUP_INTERVAL);
    } catch {
      // ignore
    }
    ARCHIVE_CLEANUP_INTERVAL = null;
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
