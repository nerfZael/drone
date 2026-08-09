import { parseBoolParam } from './hub-format';
import { readJsonBody, sendJson as json } from './hub-http';
import type { DroneRuntime } from '../host/runtime';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './routes/legacy-route';

import type { DroneLifecycleRouteDependencies } from './routes/drone-lifecycle-routes';

export class DroneLifecycleService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: DroneLifecycleRouteDependencies) {
    this.handle = createDroneLifecycleServiceHandler(deps);
  }
}

function createDroneLifecycleServiceHandler(
  deps: DroneLifecycleRouteDependencies,
): LegacyRouteHandler {
  const {
    archiveDroneById,
    archiveRetentionMs,
    cleanupExpiredArchivedChats,
    commitDroneMetadataPatch,
    deleteArchivedChatById,
    deleteCanonicalDroneLifecycle,
    deleteNativeChatSessionsForDrone,
    dequeueProvisioning,
    droneEnvironmentPayload,
    droneRuntime,
    dvmBaseSet,
    dvmStop,
    enqueueProvisioning,
    resolveCanonicalGroupReference,
    fileExists,
    findDroneIdByRef,
    hubLog,
    isDraftDroneEntry,
    isUngroupedGroupName,
    listArchivedChatsFromStore,
    listCanonicalDroneLifecycleForRead,
    loadRegistry,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    normalizeArchiveRetention,
    normalizeArchiveRuntimePolicy,
    normalizeChatName,
    normalizeDisabledRepoKeys,
    normalizeDroneIdentity,
    normalizeDroneRuntime,
    normalizeEnvVarMap,
    nowIso,
    parseIsoToMs,
    readDroneChatCleanupProjectionFromStore,
    removeArchivedDroneById,
    removeDroneTreeById,
    renameDrone,
    resolveArchiveDeleteAtIso,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveDroneCliPath,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveDeleteActionSettings,
    restoreArchivedChatById,
    restoreArchivedDroneById,
    revokeMcpAccessTokensForDrone,
    runDroneLifecycleAction,
    setDroneEnvironmentMetadata,
    setDroneGroupMetadata,
    stopAllDroneChatActivity,
    triggerArchiveCleanup,
    validateGroupNameOrThrow,
    withLockedDroneContainer,
  } = deps;

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

  function activeEntryWithStoredChats(droneId: string, entry: any): any | null {
    const projected = readDroneChatCleanupProjectionFromStore({ droneId });
    if (!projected.available) return null;
    return {
      ...entry,
      chats: projected.chats,
      archivedChats: projected.archivedChats,
    };
  }

  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/group-set
      // Assign one or more drones to a group (or clear group when omitted/null/"ungrouped").
      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[2] === 'group-set'
      ) {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const rawList = Array.isArray(body?.droneIds)
          ? body.droneIds
          : Array.isArray(body?.drones)
            ? body.drones
            : [];
        if (rawList.length === 0) {
          json(res, 400, { ok: false, error: 'missing droneIds (expected non-empty array)' });
          return;
        }

        const seen = new Set<string>();
        const dronesToMove: string[] = [];
        for (const rawId of rawList) {
          const id = normalizeDroneIdentity(String(rawId ?? '').trim());
          if (!id) {
            json(res, 400, { ok: false, error: 'invalid drone id (empty)' });
            return;
          }
          if (seen.has(id)) continue;
          seen.add(id);
          dronesToMove.push(id);
        }

        const groupRaw = body?.groupId ?? body?.group;
        if (!(groupRaw == null || typeof groupRaw === 'string')) {
          json(res, 400, { ok: false, error: 'invalid group (expected string or null)' });
          return;
        }
        const groupValue = String(groupRaw ?? '').trim();
        const referencedGroup = body?.groupId ? await resolveCanonicalGroupReference(groupValue) : null;
        if (body?.groupId && !referencedGroup) {
          json(res, 404, { ok: false, error: `unknown group: ${groupValue}` });
          return;
        }
        const resolvedGroupValue = referencedGroup?.name ?? groupValue;
        const nextGroup = !resolvedGroupValue || isUngroupedGroupName(resolvedGroupValue) ? null : resolvedGroupValue;
        if (nextGroup) {
          try {
            validateGroupNameOrThrow(nextGroup);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }

        const moved: Array<{
          id: string;
          name: string;
          previousGroup: string | null;
          group: string | null;
          groupId: string | null;
          repoPath: string;
        }> = [];
        const rejected: Array<{ id: string; error: string }> = [];
        for (const id of dronesToMove) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const resolved = await resolveDroneOrPendingForReadRef(id);
            if (!resolved) throw new Error(`unknown drone: ${id}`);
            const source = resolved.kind === 'real' ? resolved.drone : resolved.pending;
            const repoPath = String(source?.repoPath ?? '').trim();
            if (referencedGroup && referencedGroup.repoPath !== repoPath) {
              throw new Error('group belongs to a different repository');
            }
            const prevRaw = String(source?.group ?? '').trim();
            const previousGroup = !prevRaw || isUngroupedGroupName(prevRaw) ? null : prevRaw;
            if (previousGroup === nextGroup) continue;
            // eslint-disable-next-line no-await-in-loop
            const record = await setDroneGroupMetadata({
              droneId: id,
              state: resolved.kind,
              group: nextGroup,
              repoPath,
            });
            moved.push({
              id,
              name: record.name,
              previousGroup,
              group: nextGroup,
              groupId: String(record.groupId ?? '').trim() || null,
              repoPath,
            });
          } catch (error: any) {
            rejected.push({ id, error: String(error?.message ?? error) });
          }
        }

        json(res, 200, { ok: true, group: nextGroup, moved, rejected, total: dronesToMove.length });
        return;
      }

      // POST /api/drones/:id/rename
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'rename'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          hubLog('warn', 'drone rename rejected: invalid request body', {
            droneRef,
            error: msg,
          });
          json(res, 400, { ok: false, error: msg });
          return;
        }
        try {
          const result = await renameDrone({
            droneRef,
            newName: body?.newName,
            ...(Object.prototype.hasOwnProperty.call(body ?? {}, 'expectedName')
              ? { expectedName: body.expectedName }
              : {}),
            source: body?.source,
            attempt: body?.attempt,
            suggestedBase: body?.suggestedBase,
          });
          json(res, 200, result);
          return;
        } catch (error: any) {
          const status = Number.isInteger(error?.status) ? Number(error.status) : 500;
          json(res, status, {
            ok: false,
            error: String(error?.message ?? error),
            ...(error?.code ? { code: String(error.code) } : {}),
          });
          return;
        }
      }

      // POST /api/drones/:id/publish
      // Starts a draft drone and releases its queued startup prompts.
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'publish'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const regAnySnapshot: any = await loadRegistry();
        const found = findDroneIdByRef(regAnySnapshot, droneRef);
        if (!found) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        if (found.kind !== 'pending' || regAnySnapshot?.drones?.[found.id]) {
          json(res, 409, { ok: false, error: `drone is already published: ${droneRef}` });
          return;
        }
        const droneId = normalizeDroneIdentity(found.id) || found.id;
        const pendingEntry = regAnySnapshot?.pending?.[droneId];
        if (!isDraftDroneEntry(pendingEntry)) {
          json(res, 409, { ok: false, error: `drone is not a draft: ${droneRef}` });
          return;
        }
        const droneCli = resolveDroneCliPath();
        if (!(await fileExists(droneCli))) {
          json(res, 500, { ok: false, error: `drone CLI not found at ${droneCli}` });
          return;
        }
        let published: { id: string; name: string; runtime: DroneRuntime } | null = null;
        try {
          const record = await commitDroneMetadataPatch({
            droneId,
            state: 'pending',
            eventType: 'drone.draft.published',
            transform: (draft: any) => {
              if (!isDraftDroneEntry(draft)) throw new Error('drone is not a draft');
              draft.draft = false;
              draft.phase = 'starting';
              draft.message = 'Starting…';
              draft.updatedAt = nowIso();
              return draft;
            },
          });
          published = {
            id: droneId,
            name: String(record.lifecycle?.name ?? droneId).trim() || droneId,
            runtime: normalizeDroneRuntime(record.lifecycle?.runtime),
          };
        } catch (error: any) {
          if (!/not a draft|unknown drone/i.test(String(error?.message ?? ''))) throw error;
        }
        if (!published) {
          json(res, 409, { ok: false, error: `drone is not a draft: ${droneRef}` });
          return;
        }
        enqueueProvisioning(droneId);
        json(res, 202, {
          ok: true,
          id: published.id,
          name: published.name,
          runtime: published.runtime,
          phase: 'starting',
          draft: false,
        });
        return;
      }

      // POST /api/drones/:id/base-image
      // Sets the given drone's container as the DVM base image (same as: `dvm base set <container>`).
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'base-image'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        try {
          const out = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: resolved.drone },
            async ({ containerName }: any) => {
              const r = await dvmBaseSet(containerName, { timeoutMs: 10 * 60 * 1000 });
              return { containerName, baseImage: r.baseImage };
            },
          );
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            containerName: out.containerName,
            baseImage: out.baseImage,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const status = /not found/i.test(msg) ? 404 : 500;
          json(res, status, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/lifecycle/:action
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'lifecycle' &&
        (parts[4] === 'start' || parts[4] === 'stop' || parts[4] === 'restart')
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const action = parts[4] as 'start' | 'stop' | 'restart';
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const result = await runDroneLifecycleAction({
            droneId: resolved.id,
            droneEntry: resolved.drone,
            action,
            source: {
              route: '/api/drones/:id/lifecycle/:action',
              remoteAddress: req.socket.remoteAddress ?? null,
              userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) || null,
            },
          });
          json(res, 200, result);
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const status = /still starting/i.test(msg)
            ? 409
            : /unknown drone/i.test(msg)
              ? 404
              : /host runtime/i.test(msg)
                ? 409
                : looksLikeMissingContainerError(msg)
                  ? 404
                  : 500;
          json(res, status, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/env
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'env'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrPendingForReadRef(droneRef);
        if (!resolved) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        const regAny: any = await loadRegistry();
        const entry = resolved.kind === 'real' ? resolved.drone : resolved.pending;
        json(
          res,
          200,
          droneEnvironmentPayload(regAny, { id: resolved.id, kind: resolved.kind, entry }),
        );
        return;
      }

      // POST /api/drones/:id/env
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'env'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrPendingForReadRef(droneRef);
        if (!resolved) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const vars = normalizeEnvVarMap(body?.vars);
        const useRepoVars = body?.useRepoVars === true;
        const disabledRepoKeys = useRepoVars
          ? normalizeDisabledRepoKeys(body?.disabledRepoKeys)
          : [];
        const updatedAt = nowIso();

        await setDroneEnvironmentMetadata({
          droneId: resolved.id,
          state: resolved.kind,
          environment: { vars, useRepoVars, disabledRepoKeys, updatedAt },
        });

        const regAny: any = await loadRegistry();
        const refreshed = await resolveDroneOrPendingForReadRef(resolved.id);
        if (!refreshed) {
          json(res, 404, { ok: false, error: `unknown drone: ${resolved.id}` });
          return;
        }
        const entry = refreshed.kind === 'real' ? refreshed.drone : refreshed.pending;
        json(
          res,
          200,
          droneEnvironmentPayload(regAny, { id: refreshed.id, kind: refreshed.kind, entry }),
        );
        return;
      }

      // DELETE /api/drones/:id?keepVolume=0|1&forget=0|1
      if (
        method === 'DELETE' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const regAnySnapshot: any = await loadRegistry();
        const found = findDroneIdByRef(regAnySnapshot, droneRef);
        if (!found) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        const droneId = normalizeDroneIdentity(found.id) || found.id;
        const snapshotDrone =
          found.kind === 'pending' && !regAnySnapshot?.drones?.[droneId]
            ? regAnySnapshot?.pending?.[droneId]
            : regAnySnapshot?.drones?.[droneId];
        const droneName = String(snapshotDrone?.name ?? droneRef).trim() || droneRef;
        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const forget = parseBoolParam(u.searchParams.get('forget'), true);

        const r = await removeDroneTreeById({ id: droneId, keepVolume, forget });
        if (r.kind === 'none' && !r.removeErr) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        if (r.removeErr) {
          json(res, 500, {
            ok: false,
            id: droneId,
            name: droneName,
            error: r.removeErr,
            removedRegistry: r.removedRegistry,
            removedPending: r.removedPending,
            removedDescendants: r.removedDescendants,
          });
          return;
        }
        if (forget) {
          for (const removedDroneId of [droneId, ...r.removedDescendants]) {
            const removedSnapshot = regAnySnapshot?.drones?.[removedDroneId] ??
              regAnySnapshot?.pending?.[removedDroneId];
            if (removedSnapshot) await deleteNativeChatSessionsForDrone(removedSnapshot);
          }
        }

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          removedRegistry: r.removedRegistry,
          removedPending: r.removedPending,
          removedDescendants: r.removedDescendants,
        });
        return;
      }

      // POST /api/drones/:id/archive
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'archive'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolvedTarget = await resolveCanonicalDroneOrPendingForReadRef(droneRef);
        if (!resolvedTarget) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        const droneId = normalizeDroneIdentity(resolvedTarget.id) || resolvedTarget.id;
        let snapshotDrone = resolvedTarget.kind === 'real' ? resolvedTarget.drone : resolvedTarget.pending;
        if (resolvedTarget.kind === 'real' && !(globalThis as any).Bun) {
          const storedEntry = activeEntryWithStoredChats(droneId, snapshotDrone);
          snapshotDrone = storedEntry ?? (await loadRegistry())?.drones?.[droneId] ?? snapshotDrone;
        }
        const droneName = String(snapshotDrone?.name ?? droneRef).trim() || droneRef;
        const deleteSettings = await resolveEffectiveDeleteActionSettings();
        const archiveRetention = deleteSettings.archiveRetention;
        const archiveRuntimePolicy = deleteSettings.archiveRuntimePolicy;

        const pendingResult = resolvedTarget.kind === 'real'
          ? { kind: 'real' as const }
          : {
              kind: (await deleteCanonicalDroneLifecycle(droneId, 'pending'))
                ? ('pending' as const)
                : ('none' as const),
            };
        if (pendingResult.kind === 'pending') {
          dequeueProvisioning(droneId);
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            archived: false,
            removedPending: true,
            archiveRetention,
            archiveRuntimePolicy,
            archivedAt: null,
            deleteAt: null,
          });
          return;
        }
        if (pendingResult.kind === 'none') {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }

        await stopAllDroneChatActivity({
          droneId,
          droneEntry: snapshotDrone,
          reason: 'archive',
          updateLiveRegistry: true,
        });

        if (archiveRuntimePolicy === 'stop' && droneRuntime(snapshotDrone) !== 'host') {
          const containerName =
            String(
              snapshotDrone?.containerName ?? snapshotDrone?.name ?? `drone-${droneId}`,
            ).trim() || `drone-${droneId}`;
          try {
            await dvmStop(containerName);
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            if (!looksLikeContainerNotRunningError(msg) && !looksLikeMissingContainerError(msg)) {
              json(res, 500, {
                ok: false,
                error: `failed to stop drone container "${containerName}" before archive: ${msg}`,
              });
              return;
            }
          }
        }

        const r = await archiveDroneById({ id: droneId, archiveRetention, archiveRuntimePolicy });
        if (!r.hadEntry || !r.archived) {
          json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
          return;
        }
        await revokeMcpAccessTokensForDrone(droneId);
        json(res, 200, {
          ok: true,
          id: r.id,
          name: r.name,
          archived: r.archived,
          archiveRetention: r.archiveRetention,
          archiveRuntimePolicy: r.archiveRuntimePolicy,
          archivedAt: r.archivedAt,
          deleteAt: r.deleteAt,
        });
        return;
      }

      // GET /api/archive/drones
      if (
        method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'drones'
      ) {
        triggerArchiveCleanup('api:archive-drones');
        const nowMs = Date.now();
        const canonicalArchived = await listCanonicalDroneLifecycleForRead('archived');
        const archiveEntries: Array<[string, any]> = canonicalArchived
          ? canonicalArchived.map((record: any) => [record.id, lifecycleEntryFromRecord(record)])
          : Object.entries((await loadRegistry())?.archived ?? {}) as Array<[string, any]>;
        const archived = archiveEntries
          .map(([id, entry]) => {
            const droneId = normalizeDroneIdentity(id);
            if (!droneId) return null;
            const archivedAt =
              String(entry?.archivedAt ?? '').trim() || String(entry?.createdAt ?? nowIso());
            const deleteAt = resolveArchiveDeleteAtIso(entry);
            const deleteAtMs = parseIsoToMs(deleteAt);
            if (deleteAtMs != null && deleteAtMs <= nowMs) return null;
            const retention = normalizeArchiveRetention(entry?.archiveRetention);
            const runtimePolicy = normalizeArchiveRuntimePolicy(entry?.archiveRuntimePolicy);
            return {
              id: droneId,
              name: String(entry?.name ?? '').trim() || droneId,
              group:
                typeof entry?.group === 'string' && entry.group.trim()
                  ? String(entry.group).trim()
                  : null,
              createdAt: String(entry?.createdAt ?? '').trim() || null,
              archivedAt,
              deleteAt,
              deleteInMs: deleteAtMs == null ? null : Math.max(0, deleteAtMs - nowMs),
              archiveRetention: retention,
              archiveRetentionMs: archiveRetentionMs(retention),
              archiveRuntimePolicy: runtimePolicy,
              containerName: String(entry?.containerName ?? '').trim() || `drone-${droneId}`,
              repoPath: String(entry?.repoPath ?? '').trim() || '',
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .sort((a, b) => {
            const ams = parseIsoToMs(a.archivedAt) ?? 0;
            const bms = parseIsoToMs(b.archivedAt) ?? 0;
            return bms - ams;
          });
        json(res, 200, {
          ok: true,
          archived,
          total: archived.length,
          now: new Date(nowMs).toISOString(),
        });
        return;
      }

      // GET /api/archive/chats
      if (
        method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'chats'
      ) {
        await cleanupExpiredArchivedChats({ reason: 'api:archive-chats' });
        const nowMs = Date.now();
        const canonicalReal = await listCanonicalDroneLifecycleForRead('real');
        let droneEntries: Array<[string, any]> | null = null;
        if (canonicalReal) {
          const targetedEntries: Array<[string, any]> = [];
          let storesAvailable = true;
          for (const record of canonicalReal) {
            const listed = listArchivedChatsFromStore({ droneId: record.id });
            if (!listed.available) {
              storesAvailable = false;
              break;
            }
            targetedEntries.push([
              record.id,
              {
                ...lifecycleEntryFromRecord(record),
                archivedChats: Object.fromEntries(listed.archivedChats.map((chat: any) => [
                  chat.chatName,
                  {
                    archivedAt: chat.archivedAt,
                    deleteAt: chat.deleteAt,
                    archiveRetention: chat.archiveRetention,
                  },
                ])),
              },
            ]);
          }
          if (storesAvailable) droneEntries = targetedEntries;
        }
        if (!droneEntries) {
          droneEntries = Object.entries((await loadRegistry())?.drones ?? {}) as Array<[string, any]>;
        }
        const archived = droneEntries
          .flatMap(([droneIdRaw, droneEntry]) => {
            const droneId = normalizeDroneIdentity(droneIdRaw);
            if (!droneId) return [];
            const droneName = String(droneEntry?.name ?? '').trim() || droneId;
            return (Object.entries(droneEntry?.archivedChats ?? {}) as Array<[string, any]>)
              .map(([chatNameRaw, entry]) => {
                const chatName = normalizeChatName(chatNameRaw);
                if (!chatName) return null;
                const archivedAt =
                  String(entry?.archivedAt ?? '').trim() || String(entry?.createdAt ?? nowIso());
                const deleteAt = resolveArchiveDeleteAtIso(entry);
                const deleteAtMs = parseIsoToMs(deleteAt);
                if (deleteAtMs != null && deleteAtMs <= nowMs) return null;
                const retention = normalizeArchiveRetention(entry?.archiveRetention);
                return {
                  droneId,
                  droneName,
                  chatName,
                  archivedAt,
                  deleteAt,
                  deleteInMs: deleteAtMs == null ? null : Math.max(0, deleteAtMs - nowMs),
                  archiveRetention: retention,
                  archiveRetentionMs: archiveRetentionMs(retention),
                };
              })
              .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
          })
          .sort((a, b) => {
            const ams = parseIsoToMs(a.archivedAt) ?? 0;
            const bms = parseIsoToMs(b.archivedAt) ?? 0;
            return bms - ams;
          });
        json(res, 200, {
          ok: true,
          archived,
          total: archived.length,
          now: new Date(nowMs).toISOString(),
        });
        return;
      }

      // POST /api/archive/drones/:id/restore
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'drones' &&
        parts[4] === 'restore'
      ) {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const r = await restoreArchivedDroneById({ id: droneId });
        if (!r.hadEntry) {
          json(res, 404, { ok: false, error: r.error ?? `unknown archived drone: ${droneId}` });
          return;
        }
        if (!r.restored) {
          json(res, 409, { ok: false, id: r.id, name: r.name, error: r.error ?? 'restore failed' });
          return;
        }
        json(res, 200, { ok: true, id: r.id, name: r.name, renamed: r.renamed });
        return;
      }

      // POST /api/archive/drones/:id/chats/:chat/restore
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'drones' &&
        parts[4] === 'chats' &&
        parts[6] === 'restore'
      ) {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        const chatName = normalizeChatName(decodeURIComponent(parts[5]));
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const r = await restoreArchivedChatById({ droneId, archivedChatName: chatName });
        if (!r.hadDrone || !r.hadChat) {
          json(res, 404, { ok: false, error: `unknown archived chat: ${chatName}` });
          return;
        }
        if (!r.restored) {
          json(res, 409, { ok: false, id: r.droneId, chat: r.chatName, error: 'restore failed' });
          return;
        }
        json(res, 200, {
          ok: true,
          id: r.droneId,
          chat: r.chatName,
          renamed: r.renamed,
          chats: r.chats,
        });
        return;
      }

      // DELETE /api/archive/drones/:id?keepVolume=0|1
      if (
        method === 'DELETE' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'drones'
      ) {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const keepVolume = parseBoolParam(u.searchParams.get('keepVolume'), false);
        const r = await removeArchivedDroneById({ id: droneId, keepVolume });
        if (!r.hadEntry) {
          json(res, 404, { ok: false, error: r.removeErr ?? `unknown archived drone: ${droneId}` });
          return;
        }
        if (r.removeErr) {
          json(res, 500, {
            ok: false,
            id: r.id,
            name: r.name,
            error: r.removeErr,
            removedArchive: r.removedArchive,
          });
          return;
        }
        json(res, 200, { ok: true, id: r.id, name: r.name, removedArchive: r.removedArchive });
        return;
      }

      // DELETE /api/archive/drones/:id/chats/:chat
      if (
        method === 'DELETE' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'archive' &&
        parts[2] === 'drones' &&
        parts[4] === 'chats'
      ) {
        const archivedDroneRef = decodeURIComponent(parts[3]);
        const droneId = normalizeDroneIdentity(archivedDroneRef);
        const chatName = normalizeChatName(decodeURIComponent(parts[5]));
        if (!droneId) {
          json(res, 400, { ok: false, error: `invalid drone id: ${archivedDroneRef}` });
          return;
        }
        const r = await deleteArchivedChatById({ droneId, archivedChatName: chatName });
        if (!r.hadDrone || !r.hadChat) {
          json(res, 404, { ok: false, error: `unknown archived chat: ${chatName}` });
          return;
        }
        json(res, 200, { ok: true, id: r.droneId, deletedChat: r.chatName });
        return;
      }

      return false;
    })();
    return handled !== false;
  };
}
