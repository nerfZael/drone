import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import React from 'react';
import { fromByteArray } from 'base64-js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  DRONE_CONTROL_CAPABILITY,
  parseSidebarMoveCommandRequest,
  type DroneControlOperation,
} from '@drone/device-protocol';
import {
  applySidebarMove,
  normalizeSidebarLayout,
  sidebarMoveDestination,
} from '@drone/hub-model/sidebar';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { useMesh } from '../mesh/MeshContext';
import { loadLocalAssistantSettings } from '../local-assistant/local-assistant-settings';
import {
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
} from '../local-assistant/local-assistant-model';
import type { LocalAssistantPromptImage } from '../local-assistant/local-assistant-types';
import { applyOptimisticMobileSidebarMove } from './mobile-sidebar-reorder';
import {
  cleanLocalDroneRecords,
  createLegacyPhoneDroneRecord,
  localDroneDraftChatMap,
  localDroneDraftPromptsForChat,
  type LocalDroneRecord,
} from './local-drone-records';
import {
  inferMobilePreviewMime,
  MOBILE_FILE_EDIT_MAX_BYTES,
  MOBILE_MEDIA_PREVIEW_MAX_BYTES,
  MOBILE_TEXT_PREVIEW_MAX_BYTES,
} from './file-preview-model';
import { createLocalDroneSummaryIndex } from './local-drone-summary-index';

const LOCAL_DRONES_KEY = 'droneHub.nativeDrones.v1';
const LOCAL_GROUPS_KEY = 'droneHub.nativeGroups.v1';
const LOCAL_PINNED_DRONES_KEY = 'droneHub.nativePinnedDrones.v1';
const LOCAL_SIDEBAR_ORDER_KEY = 'droneHub.nativeSidebarOrder.v1';
const LOCAL_PREVIEW_CHUNK_BYTES = 128 * 1024;

type LocalGroupRecord = { id: string; name: string; createdAt: string };

function cleanLocalGroups(value: unknown): LocalGroupRecord[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  return value.flatMap((item): LocalGroupRecord[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const id = String(source.id ?? '').trim();
    const name = String(source.name ?? '').trim();
    const createdAt = String(source.createdAt ?? '').trim();
    if (!id || !name || names.has(name)) return [];
    names.add(name);
    return [{ id, name, createdAt: createdAt || new Date().toISOString() }];
  });
}

function parseLocalGroupName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('Group name is required.');
  if (/[\r\n\t]/.test(name)) throw new Error('Group names cannot contain invalid whitespace.');
  if (name.length > 64) throw new Error('Group names must be 64 characters or fewer.');
  if (name.toLowerCase() === 'ungrouped') throw new Error('“Ungrouped” is reserved.');
  return name;
}

function localStringListMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, items]) => {
      const key = keyRaw.trim();
      if (!key || !Array.isArray(items)) return [];
      const list = [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))];
      return list.length > 0 ? [[key, list] as const] : [];
    }),
  );
}

function localStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, itemRaw]) => {
      const key = String(keyRaw ?? '').trim();
      const item = String(itemRaw ?? '').trim();
      return key && item ? [[key, item] as const] : [];
    }),
  );
}

function fileRevision(bytes: Uint8Array): string {
  return `sha256:${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function localArtifactPathParts(raw: unknown): string[] {
  const path = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..')) {
    throw new Error('Phone artifact previews require a relative file path');
  }
  return path.split('/').filter((part) => part && part !== '.');
}

function localArtifactDirectoryParts(raw: unknown): string[] {
  const path = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/g, '');
  if (path.startsWith('/') || path.split('/').some((part) => part === '..')) {
    throw new Error('Phone artifact directories require a relative path');
  }
  return path.split('/').filter((part) => part && part !== '.');
}

function localArtifactChildName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name) throw new Error('Name is required.');
  if (name === '.' || name === '..' || /[\\/\0\r\n\t]/.test(name)) {
    throw new Error('Name cannot contain a path separator or invalid whitespace.');
  }
  if (name.length > 255) throw new Error('Name must be 255 characters or fewer.');
  return name;
}

function localJsonChunk(value: unknown, offsetRaw: unknown) {
  const content = new TextEncoder().encode(JSON.stringify(value));
  const requested = Number(offsetRaw);
  const offset = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  const chunk = content.slice(offset, offset + LOCAL_PREVIEW_CHUNK_BYTES);
  return {
    encoding: 'base64-json-utf8',
    offset,
    bytes: chunk.length,
    totalBytes: content.length,
    done: offset + chunk.length >= content.length,
    dataBase64: fromByteArray(chunk),
  };
}

function promptImages(raw: unknown): LocalAssistantPromptImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap((attachment): LocalAssistantPromptImage[] => {
    const data = String(attachment?.dataBase64 ?? attachment?.data ?? '').trim();
    const mimeType = String(attachment?.mime ?? attachment?.mimeType ?? '')
      .trim()
      .toLowerCase();
    if (!data || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
      return [];
    }
    return [{ type: 'image', data, mimeType }];
  });
}

function uniqueDroneName(drones: LocalDroneRecord[], requested: unknown): string {
  const base =
    String(requested ?? '')
      .trim()
      .slice(0, 80) || 'Phone drone';
  const names = new Set(drones.map((drone) => drone.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

function parseLocalChatName(raw: unknown, label = 'Chat name'): string {
  const chatName = String(raw ?? '').trim();
  if (!chatName) throw new Error(`${label} is required.`);
  if (/[\r\n\t]/.test(chatName)) throw new Error(`${label} cannot contain invalid whitespace.`);
  if (/[\\/]/.test(chatName)) throw new Error(`${label} cannot include / or \\.`);
  if (chatName.length > 64) throw new Error(`${label} must be 64 characters or fewer.`);
  return chatName;
}

function useLocalDroneControlValue() {
  const assistant = useLocalAssistant();
  const [drones, setDrones] = React.useState<LocalDroneRecord[]>([]);
  const [groups, setGroups] = React.useState<LocalGroupRecord[]>([]);
  const [pinnedDroneIds, setPinnedDroneIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const dronesRef = React.useRef<LocalDroneRecord[]>([]);
  const groupsRef = React.useRef<LocalGroupRecord[]>([]);
  const pinnedDroneIdsRef = React.useRef<string[]>([]);
  const sidebarOrderRef = React.useRef({
    sidebarNodeOrderByParent: {} as Record<string, string[]>,
    sidebarChatOrderByDrone: {} as Record<string, string[]>,
    sidebarChatGroupPathsByDrone: {} as Record<string, string[]>,
    sidebarChatGroupByChat: {} as Record<string, string>,
    sidebarChatNodeOrderByParent: {} as Record<string, string[]>,
    mutedSidebarGroupIds: [] as string[],
    mutedDroneIds: [] as string[],
    mutedChatIds: [] as string[],
  });
  const writeRef = React.useRef(Promise.resolve());
  const loadedRef = React.useRef(false);
  const readyRef = React.useRef<{
    promise: Promise<void>;
    resolve(): void;
  } | null>(null);
  if (!readyRef.current) {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((ready) => {
      resolve = ready;
    });
    readyRef.current = { promise, resolve };
  }

  const replaceDrones = React.useCallback(async (next: LocalDroneRecord[]) => {
    dronesRef.current = next;
    setDrones(next);
    const write = writeRef.current.then(() =>
      AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(next)),
    );
    writeRef.current = write.catch(() => undefined);
    await write;
  }, []);

  const replaceGroups = React.useCallback(async (next: LocalGroupRecord[]) => {
    groupsRef.current = next;
    setGroups(next);
    const write = writeRef.current.then(() =>
      AsyncStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(next)),
    );
    writeRef.current = write.catch(() => undefined);
    await write;
  }, []);

  const replaceDronesAndGroups = React.useCallback(async (
    nextDrones: LocalDroneRecord[],
    nextGroups: LocalGroupRecord[],
  ) => {
    dronesRef.current = nextDrones;
    groupsRef.current = nextGroups;
    setDrones(nextDrones);
    setGroups(nextGroups);
    const write = writeRef.current.then(async () => {
      await Promise.all([
        AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(nextDrones)),
        AsyncStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(nextGroups)),
      ]);
    });
    writeRef.current = write.catch(() => undefined);
    await write;
  }, []);

  React.useEffect(() => {
    if (assistant.loading || loadedRef.current) return;
    loadedRef.current = true;
    let active = true;
    const loadDrones = AsyncStorage.getItem(LOCAL_DRONES_KEY)
      .then(async (stored): Promise<LocalDroneRecord[]> => {
        if (stored !== null) {
          try {
            return cleanLocalDroneRecords(JSON.parse(stored));
          } catch {
            await AsyncStorage.removeItem(LOCAL_DRONES_KEY);
          }
        }
        const migrated = createLegacyPhoneDroneRecord(assistant.threads);
        if (!migrated) return [];
        const next = [migrated];
        await AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(next));
        return next;
      })
      .catch((): LocalDroneRecord[] => []);
    const loadPinnedDroneIds = AsyncStorage.getItem(LOCAL_PINNED_DRONES_KEY)
      .then((stored): string[] => {
        if (!stored) return [];
        const value: unknown = JSON.parse(stored);
        return Array.isArray(value)
          ? [...new Set(value.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))]
          : [];
      })
      .catch((): string[] => []);
    const loadGroups = AsyncStorage.getItem(LOCAL_GROUPS_KEY)
      .then((stored): LocalGroupRecord[] => cleanLocalGroups(stored ? JSON.parse(stored) : []))
      .catch((): LocalGroupRecord[] => []);
    const loadSidebarOrder = AsyncStorage.getItem(LOCAL_SIDEBAR_ORDER_KEY)
      .then((stored) => {
        const value: unknown = stored ? JSON.parse(stored) : {};
        const source =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        return {
          sidebarNodeOrderByParent: localStringListMap(source.sidebarNodeOrderByParent),
          sidebarChatOrderByDrone: localStringListMap(source.sidebarChatOrderByDrone),
          sidebarChatGroupPathsByDrone: localStringListMap(source.sidebarChatGroupPathsByDrone),
          sidebarChatGroupByChat: localStringMap(source.sidebarChatGroupByChat),
          sidebarChatNodeOrderByParent: localStringListMap(source.sidebarChatNodeOrderByParent),
          mutedSidebarGroupIds: Array.isArray(source.mutedSidebarGroupIds)
            ? [...new Set(source.mutedSidebarGroupIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
            : [],
          mutedDroneIds: Array.isArray(source.mutedDroneIds)
            ? [...new Set(source.mutedDroneIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
            : [],
          mutedChatIds: Array.isArray(source.mutedChatIds)
            ? [...new Set(source.mutedChatIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
            : [],
        };
      })
      .catch(() => ({
        sidebarNodeOrderByParent: {},
        sidebarChatOrderByDrone: {},
        sidebarChatGroupPathsByDrone: {},
        sidebarChatGroupByChat: {},
        sidebarChatNodeOrderByParent: {},
        mutedSidebarGroupIds: [],
        mutedDroneIds: [],
        mutedChatIds: [],
      }));
    void Promise.all([loadDrones, loadGroups, loadPinnedDroneIds, loadSidebarOrder])
      .then(async ([nextDrones, storedGroups, nextPinnedDroneIds, nextSidebarOrder]) => {
        if (!active) return;
        const groupByName = new Map(storedGroups.map((group) => [group.name, group]));
        for (const drone of nextDrones) {
          if (!drone.group || groupByName.has(drone.group)) continue;
          groupByName.set(drone.group, {
            id: `phone_group_${Crypto.randomUUID()}`,
            name: drone.group,
            createdAt: drone.createdAt,
          });
        }
        const nextGroups = [...groupByName.values()];
        dronesRef.current = nextDrones;
        setDrones(nextDrones);
        groupsRef.current = nextGroups;
        setGroups(nextGroups);
        if (nextGroups.length !== storedGroups.length) {
          await AsyncStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(nextGroups));
        }
        pinnedDroneIdsRef.current = nextPinnedDroneIds;
        setPinnedDroneIds(nextPinnedDroneIds);
        sidebarOrderRef.current = nextSidebarOrder;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        setLoading(false);
        readyRef.current?.resolve();
      });
    return () => {
      active = false;
    };
  }, [assistant.loading]);

  const request = React.useCallback(
    async (operation: DroneControlOperation, payload: any = {}): Promise<any> => {
      await readyRef.current!.promise;
      const getDrone = () => {
        const drone = dronesRef.current.find(
          (candidate) => candidate.id === String(payload.droneId ?? ''),
        );
        if (!drone) throw new Error('Phone drone was not found');
        return drone;
      };
      const getThread = () => {
        const drone = getDrone();
        const chatName = String(payload.chatName ?? 'default').trim() || 'default';
        const threadId = drone.chats[chatName];
        const thread = assistant.threads.find((candidate) => candidate.id === threadId);
        if (!thread) throw new Error('Phone drone chat was not found');
        return { drone, chatName, thread };
      };
      if (operation === 'drones.list') {
        if (payload.createModelAgent === 'native') {
          const settings = await loadLocalAssistantSettings();
          return {
            schemaVersion: 2,
            drones: [],
            createModelCatalog: {
              models: localAssistantModelOptions(settings.provider).map((model) => ({
                provider: settings.provider,
                id: model.id,
                label: model.name,
                reasoningLevels: ['off', 'low', 'medium', 'high'],
                defaultReasoningLevel: settings.thinkingLevel,
              })),
            },
          };
        }
        const summaryIndex = createLocalDroneSummaryIndex(
          assistant.threads,
          assistant.pendingApprovals,
        );
        return {
          schemaVersion: 2,
          drones: dronesRef.current.map((drone) => {
            const summary = summaryIndex.summarizeChats(
              drone.chats,
              assistant.runningThreadId,
            );
            return {
              id: drone.id,
              name: drone.name,
              runtime: 'host',
              phase: drone.draft === true ? 'draft' : 'ready',
              status: drone.draft === true ? 'Draft' : 'ready',
              ...(drone.draft === true ? { draft: true } : {}),
              group: drone.group,
              repoPath: '',
              chats: Object.keys(drone.chats),
              ...(drone.draft === true || Object.keys(drone.draftChats ?? {}).length > 0
                ? {
                    draftChats: localDroneDraftChatMap(drone),
                  }
                : {}),
              ...summary,
              createdAt: drone.createdAt,
            };
          }),
          sidebar: {
            registeredRepoPaths: [],
            groupCreatedAtByName: Object.fromEntries(
              groupsRef.current.map((group) => [group.name, group.createdAt]),
            ),
            groups: groupsRef.current.map((group) => ({
              ...group,
              repoPath: '',
              parentId: null,
            })),
            sidebarGroupOrder: [],
            sidebarDroneOrderByGroup: {},
            sidebarNodeOrderByParent: sidebarOrderRef.current.sidebarNodeOrderByParent,
            sidebarChatOrderByDrone: sidebarOrderRef.current.sidebarChatOrderByDrone,
            sidebarChatGroupPathsByDrone: sidebarOrderRef.current.sidebarChatGroupPathsByDrone,
            sidebarChatGroupByChat: sidebarOrderRef.current.sidebarChatGroupByChat,
            sidebarChatNodeOrderByParent: sidebarOrderRef.current.sidebarChatNodeOrderByParent,
            pinnedDroneIds: pinnedDroneIdsRef.current,
            mutedSidebarGroupIds: sidebarOrderRef.current.mutedSidebarGroupIds,
            mutedDroneIds: sidebarOrderRef.current.mutedDroneIds,
            mutedChatIds: sidebarOrderRef.current.mutedChatIds,
          },
          createOptions: { repos: [] },
        };
      }

      if (operation === 'groups.list') {
        if (String(payload.repoPath ?? '').trim()) return { ok: true, groups: [] };
        return {
          ok: true,
          groups: groupsRef.current.map((group) => ({ ...group, repoPath: '' })),
        };
      }
      if (operation === 'group.create') {
        if (String(payload.repoPath ?? '').trim()) {
          throw new Error('Phone-native groups do not support repositories.');
        }
        const name = parseLocalGroupName(payload.name);
        if (groupsRef.current.some((group) => group.name === name)) {
          throw new Error(`Group already exists: ${name}`);
        }
        const group = {
          id: `phone_group_${Crypto.randomUUID()}`,
          name,
          createdAt: new Date().toISOString(),
        };
        await replaceGroups([...groupsRef.current, group]);
        return { ok: true, ...group, repoPath: '' };
      }
      if (operation === 'group.rename') {
        if (String(payload.repoPath ?? '').trim()) {
          throw new Error('Phone-native groups do not support repositories.');
        }
        const groupRef = String(payload.groupRef ?? payload.name ?? '').trim();
        const group = groupsRef.current.find(
          (candidate) => candidate.id === groupRef || candidate.name === groupRef,
        );
        if (!group) throw new Error(`Unknown group: ${groupRef}`);
        const newName = parseLocalGroupName(payload.newName);
        if (newName.startsWith(`${group.name}/`)) {
          throw new Error('A group cannot be moved inside itself.');
        }
        const inRenamedTree = (name: string) => name === group.name || name.startsWith(`${group.name}/`);
        const renamedName = (name: string) =>
          name === group.name ? newName : `${newName}${name.slice(group.name.length)}`;
        const renamedNames = new Set(
          groupsRef.current.filter((candidate) => inRenamedTree(candidate.name)).map((candidate) => renamedName(candidate.name)),
        );
        if (
          groupsRef.current.some(
            (candidate) => !inRenamedTree(candidate.name) && renamedNames.has(candidate.name),
          )
        ) {
          throw new Error(`A group in the renamed tree already exists under: ${newName}`);
        }
        const nextGroups = groupsRef.current.map((candidate) =>
          inRenamedTree(candidate.name)
            ? { ...candidate, name: renamedName(candidate.name) }
            : candidate,
        );
        const nextDrones = dronesRef.current.map((drone) =>
          drone.group && inRenamedTree(drone.group)
            ? { ...drone, group: renamedName(drone.group) }
            : drone,
        );
        await replaceDronesAndGroups(nextDrones, nextGroups);
        return { ok: true, id: group.id, oldName: group.name, newName };
      }
      if (operation === 'group.delete') {
        if (String(payload.repoPath ?? '').trim()) {
          throw new Error('Phone-native groups do not support repositories.');
        }
        const groupRef = String(payload.groupRef ?? payload.name ?? '').trim();
        const group = groupsRef.current.find(
          (candidate) => candidate.id === groupRef || candidate.name === groupRef,
        );
        if (!group) throw new Error(`Unknown group: ${groupRef}`);
        const inDeletedTree = (name: string | null) =>
          Boolean(name && (name === group.name || name.startsWith(`${group.name}/`)));
        const removed = dronesRef.current.filter((drone) => inDeletedTree(drone.group));
        for (const drone of removed) {
          for (const threadId of Object.values(drone.chats)) await assistant.deleteThread(threadId);
        }
        await replaceDronesAndGroups(
          dronesRef.current.filter((drone) => !inDeletedTree(drone.group)),
          groupsRef.current.filter((candidate) => !inDeletedTree(candidate.name)),
        );
        return {
          ok: true,
          deletedGroup: true,
          group: group.name,
          removed: removed.map((drone) => ({ id: drone.id, name: drone.name })),
          total: removed.length,
        };
      }

      if (operation === 'drone.create.container') {
        throw new Error('Container drones are not available on this phone');
      }
      if (operation === 'sidebar.move') {
        const command = parseSidebarMoveCommandRequest(payload);
        if (
          command.intent.kind === 'set-pinned' &&
          command.intent.droneIds.some(
            (droneId: string) => !dronesRef.current.some((drone) => drone.id === droneId),
          )
        ) {
          throw new Error('Phone drone was not found');
        }
        const write = writeRef.current.then(async () => {
          const currentLayout = normalizeSidebarLayout({
            ...sidebarOrderRef.current,
            pinnedDroneIds: pinnedDroneIdsRef.current,
          });
          const nextLayout = applySidebarMove(currentLayout, command.intent);
          const nextDrones =
            command.intent.kind === 'move-into-folder'
              ? applyOptimisticMobileSidebarMove(dronesRef.current, command.intent)
              : dronesRef.current;
          let nextGroups = groupsRef.current;
          let canonicalGroup: { id: string; repoPath: string; name: string } | null = null;
          if (
            command.intent.kind === 'move-into-folder' &&
            command.intent.itemKind === 'folder'
          ) {
            const folderIntent = command.intent;
            const destination = sidebarMoveDestination(folderIntent);
            const source = groupsRef.current.find(
              (group) =>
                group.id === folderIntent.sourceGroupId ||
                group.name === folderIntent.sourceGroup,
            );
            if (!destination?.nextGroup || !source) {
              throw new Error(`Unknown group: ${folderIntent.sourceGroup}`);
            }
            const inMovedTree = (name: string) =>
              name === source.name || name.startsWith(`${source.name}/`);
            const movedName = (name: string) =>
              name === source.name
                ? destination.nextGroup!
                : `${destination.nextGroup}${name.slice(source.name.length)}`;
            const movedNames = new Set(
              groupsRef.current
                .filter((group) => inMovedTree(group.name))
                .map((group) => movedName(group.name)),
            );
            if (
              groupsRef.current.some(
                (group) => !inMovedTree(group.name) && movedNames.has(group.name),
              )
            ) {
              throw new Error(`A group already exists under: ${destination.nextGroup}`);
            }
            nextGroups = groupsRef.current.map((group) =>
              inMovedTree(group.name) ? { ...group, name: movedName(group.name) } : group,
            );
            canonicalGroup = {
              id: source.id,
              repoPath: '',
              name: destination.nextGroup,
            };
          }
          const groupsChanged = nextGroups !== groupsRef.current;
          const nextOrder = {
            sidebarNodeOrderByParent: nextLayout.sidebarNodeOrderByParent,
            sidebarChatOrderByDrone: nextLayout.sidebarChatOrderByDrone,
            sidebarChatGroupPathsByDrone: nextLayout.sidebarChatGroupPathsByDrone,
            sidebarChatGroupByChat: nextLayout.sidebarChatGroupByChat,
            sidebarChatNodeOrderByParent: nextLayout.sidebarChatNodeOrderByParent,
            mutedSidebarGroupIds: nextLayout.mutedSidebarGroupIds,
            mutedDroneIds: nextLayout.mutedDroneIds,
            mutedChatIds: nextLayout.mutedChatIds,
          };
          await Promise.all([
            AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(nextDrones)),
            AsyncStorage.setItem(LOCAL_SIDEBAR_ORDER_KEY, JSON.stringify(nextOrder)),
            AsyncStorage.setItem(
              LOCAL_PINNED_DRONES_KEY,
              JSON.stringify(nextLayout.pinnedDroneIds),
            ),
            ...(!groupsChanged
              ? []
              : [AsyncStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(nextGroups))]),
          ]);
          dronesRef.current = nextDrones;
          groupsRef.current = nextGroups;
          sidebarOrderRef.current = nextOrder;
          pinnedDroneIdsRef.current = nextLayout.pinnedDroneIds;
          setDrones(nextDrones);
          if (groupsChanged) setGroups(nextGroups);
          setPinnedDroneIds(nextLayout.pinnedDroneIds);
          return {
            ok: true,
            mutationId: command.mutationId,
            version: null,
            uiPreferences: nextLayout,
            stages: {
              membership: {
                status:
                  command.intent.kind === 'move-into-folder'
                    ? ('applied' as const)
                    : ('not-required' as const),
              },
              layout: { status: 'applied' as const },
            },
            canonical: {
              group: canonicalGroup,
              sidebar: { version: null, uiPreferences: nextLayout },
            },
          };
        });
        writeRef.current = write.then(
          () => undefined,
          () => undefined,
        );
        return await write;
      }
      if (operation === 'drone.create.host') {
        if (String(payload.repoPath ?? '').trim()) {
          throw new Error('Phone-native drones do not support repositories.');
        }
        const name = uniqueDroneName(dronesRef.current, payload.name);
        const rawGroupName = String(payload.group ?? '').trim();
        const groupName = rawGroupName ? parseLocalGroupName(rawGroupName) : '';
        const createInitialChat = payload.seedAgent?.kind === 'native';
        const thread = createInitialChat ? await assistant.createThread('default') : null;
        if (thread) {
          await assistant.updateThread(thread.id, {
            artifactWorkspace: true,
            ...(payload.seedModel ? { model: String(payload.seedModel) } : {}),
            ...(payload.seedReasoning
              ? { thinkingLevel: normalizeLocalAssistantThinkingLevel(payload.seedReasoning) }
              : {}),
            ...(payload.seedAgentPermissionMode
              ? { agentPermissionMode: payload.seedAgentPermissionMode }
              : {}),
            ...(payload.seedApprovalPolicy === 'none' ? { approvalPolicy: 'none' as const } : {}),
          });
        }
        const drone: LocalDroneRecord = {
          id: `phone_drone_${Crypto.randomUUID()}`,
          name,
          group: groupName || null,
          createdAt: new Date().toISOString(),
          chats: thread ? { default: thread.id } : {},
          ...(payload.draft === true ? { draft: true } : {}),
        };
        const prompt = String(payload.seedPrompt ?? '').trim();
        const images = promptImages(payload.seedAttachments);
        if (payload.draft === true && (prompt || images.length > 0)) {
          drone.draftPrompts = [
            {
              id: `phone_draft_${Crypto.randomUUID()}`,
              prompt,
              promptImages: images,
              createdAt: String(payload.seedSubmittedAt ?? '').trim() || new Date().toISOString(),
            },
          ];
        }
        if (groupName && !groupsRef.current.some((group) => group.name === groupName)) {
          await replaceGroups([
            ...groupsRef.current,
            {
              id: `phone_group_${Crypto.randomUUID()}`,
              name: groupName,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        await replaceDrones([drone, ...dronesRef.current]);
        if (payload.draft !== true && thread && (prompt || images.length > 0)) {
          void assistant.sendPrompt(thread.id, prompt, images).catch(() => undefined);
        }
        return { ok: true, droneId: drone.id, drone };
      }
      if (operation === 'drone.rename') {
        const drone = getDrone();
        const newName = String(payload.newName ?? '').trim();
        if (!newName) throw new Error('Enter a drone name.');
        if (/[\r\n]/.test(newName)) throw new Error('Drone names cannot contain newlines.');
        if (newName.length > 80) throw new Error('Drone names must be 80 characters or fewer.');
        if (
          dronesRef.current.some(
            (candidate) => candidate.id !== drone.id && candidate.name.trim() === newName,
          )
        ) {
          throw new Error('A drone with that name already exists.');
        }
        const nextDrone = { ...drone, name: newName };
        await replaceDrones(
          dronesRef.current.map((candidate) => (candidate.id === drone.id ? nextDrone : candidate)),
        );
        return {
          ok: true,
          id: drone.id,
          oldName: drone.name,
          newName,
          renamed: newName !== drone.name,
        };
      }
      if (operation === 'drone.delete') {
        const drone = getDrone();
        for (const threadId of Object.values(drone.chats)) await assistant.deleteThread(threadId);
        await replaceDrones(dronesRef.current.filter((candidate) => candidate.id !== drone.id));
        return { ok: true, deleted: true };
      }
      if (operation === 'chats.list') {
        const drone = getDrone();
        return { ok: true, chats: Object.keys(drone.chats) };
      }
      if (operation === 'chat.create') {
        const drone = getDrone();
        const chatName = parseLocalChatName(payload.name);
        if (drone.chats[chatName]) throw new Error(`Chat already exists: ${chatName}`);
        const sourceId = drone.chats[String(payload.copyFrom ?? '')];
        const copyConfig = sourceId && payload.mode === 'copy-config';
        const sourceThread = copyConfig
          ? assistant.threads.find((candidate) => candidate.id === sourceId)
          : null;
        if (copyConfig && !sourceThread) throw new Error('Source chat was not found.');
        const thread = sourceId && !copyConfig
          ? await assistant.cloneThread(sourceId)
          : await assistant.createThread(chatName);
        await assistant.updateThread(thread.id, {
          title: chatName,
          artifactWorkspace: sourceThread?.artifactWorkspace ?? true,
          ...(sourceThread
            ? {
                model: sourceThread.model,
                thinkingLevel: sourceThread.thinkingLevel,
                workspaceTargets: sourceThread.workspaceTargets.map((target) => ({ ...target })),
                ...(sourceThread.autoApprove !== undefined
                  ? { autoApprove: sourceThread.autoApprove }
                  : {}),
                ...(sourceThread.agentPermissionMode
                  ? { agentPermissionMode: sourceThread.agentPermissionMode }
                  : {}),
                ...(sourceThread.approvalPolicy
                  ? { approvalPolicy: sourceThread.approvalPolicy }
                  : {}),
              }
            : {}),
        });
        const nextDrone: LocalDroneRecord = {
          ...drone,
          chats: { ...drone.chats, [chatName]: thread.id },
          ...(payload.draft === true
            ? { draftChats: { ...(drone.draftChats ?? {}), [chatName]: true } }
            : {}),
        };
        await replaceDrones(
          dronesRef.current.map((candidate) => (candidate.id === drone.id ? nextDrone : candidate)),
        );
        return { ok: true, chatName, chats: Object.keys(nextDrone.chats) };
      }
      if (operation === 'chat.rename') {
        const drone = getDrone();
        const chatName = String(payload.chatName ?? '').trim();
        if (!chatName || chatName === 'default')
          throw new Error('The default chat cannot be renamed.');
        const newName = parseLocalChatName(payload.newName, 'New chat name');
        if (!drone.chats[chatName]) throw new Error(`Unknown chat: ${chatName}`);
        if (newName !== chatName && drone.chats[newName]) {
          throw new Error(`Chat already exists: ${newName}`);
        }
        const threadId = drone.chats[chatName]!;
        await assistant.updateThread(threadId, { title: newName, artifactWorkspace: true });
        const nextChats = Object.fromEntries(
          Object.entries(drone.chats).map(([name, id]) => [name === chatName ? newName : name, id]),
        );
        const nextDraftChats = Object.fromEntries(
          Object.entries(drone.draftChats ?? {}).map(([name, draft]) => [
            name === chatName ? newName : name,
            draft,
          ]),
        );
        const nextDraftChatPrompts = Object.fromEntries(
          Object.entries(drone.draftChatPrompts ?? {}).map(([name, prompts]) => [
            name === chatName ? newName : name,
            prompts,
          ]),
        );
        const nextDrone = {
          ...drone,
          chats: nextChats,
          draftChats: nextDraftChats,
          draftChatPrompts: nextDraftChatPrompts,
        };
        await replaceDrones(
          dronesRef.current.map((candidate) => (candidate.id === drone.id ? nextDrone : candidate)),
        );
        return { ok: true, oldChat: chatName, chat: newName, chats: Object.keys(nextChats) };
      }
      if (operation === 'chat.delete') {
        const drone = getDrone();
        const chatName = String(payload.chatName ?? '').trim();
        if (!chatName || chatName === 'default')
          throw new Error('The default chat cannot be deleted.');
        const threadId = drone.chats[chatName];
        if (!threadId) throw new Error(`Unknown chat: ${chatName}`);
        await assistant.deleteThread(threadId);
        const nextChats = Object.fromEntries(
          Object.entries(drone.chats).filter(([name]) => name !== chatName),
        );
        const nextDraftChats = Object.fromEntries(
          Object.entries(drone.draftChats ?? {}).filter(([name]) => name !== chatName),
        );
        const nextDraftChatPrompts = Object.fromEntries(
          Object.entries(drone.draftChatPrompts ?? {}).filter(([name]) => name !== chatName),
        );
        const nextDrone = {
          ...drone,
          chats: nextChats,
          draftChats: nextDraftChats,
          draftChatPrompts: nextDraftChatPrompts,
        };
        await replaceDrones(
          dronesRef.current.map((candidate) => (candidate.id === drone.id ? nextDrone : candidate)),
        );
        return { ok: true, deletedChat: chatName, chats: Object.keys(nextChats) };
      }
      if (operation === 'files.list') {
        const { thread } = getThread();
        const parts = localArtifactDirectoryParts(payload.path);
        const root = new Directory(
          Paths.document,
          'drone-hub-native-artifacts-v1',
          encodeURIComponent(thread.id),
        );
        const directory = parts.length > 0 ? new Directory(root, ...parts) : root;
        if (!directory.exists)
          throw new Error(`Artifact directory not found: ${parts.join('/') || '.'}`);
        const entries = directory.list().map((entry) => {
          const entryPath = [...parts, entry.name].join('/');
          const isDirectory = entry instanceof Directory;
          const size = Number((entry as File).size);
          const mtimeMs = Number((entry as File).modificationTime);
          const mime = isDirectory ? '' : inferMobilePreviewMime(entry.name);
          return {
            name: entry.name,
            path: entryPath,
            kind: isDirectory ? 'directory' : 'file',
            size: !isDirectory && Number.isFinite(size) ? Math.max(0, Math.floor(size)) : null,
            mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null,
            ext: isDirectory ? null : (entry.name.split('.').at(-1)?.toLowerCase() ?? null),
            isImage: mime.startsWith('image/'),
            isVideo: mime.startsWith('video/'),
          };
        });
        entries.sort((left, right) =>
          left.kind === right.kind
            ? left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
            : left.kind === 'directory'
              ? -1
              : 1,
        );
        return {
          contentChunk: localJsonChunk(
            { ok: true, path: parts.join('/'), entries },
            payload.contentOffset,
          ),
        };
      }
      if (operation === 'file.action') {
        const { thread } = getThread();
        const action = String(payload.action ?? '').trim();
        if (action !== 'create-file' && action !== 'create-directory' && action !== 'rename') {
          throw new Error('Unsupported file action.');
        }
        const name = localArtifactChildName(payload.name);
        const root = new Directory(
          Paths.document,
          'drone-hub-native-artifacts-v1',
          encodeURIComponent(thread.id),
        );
        if (action === 'create-file' || action === 'create-directory') {
          const parentParts = localArtifactDirectoryParts(payload.targetDir);
          const parent = parentParts.length > 0 ? new Directory(root, ...parentParts) : root;
          if (!parent.exists) {
            throw new Error(`Artifact directory not found: ${parentParts.join('/') || '.'}`);
          }
          const created =
            action === 'create-file' ? parent.createFile(name, null) : parent.createDirectory(name);
          return {
            ok: true,
            action,
            path: [...parentParts, created.name].join('/'),
            targetDir: parentParts.join('/'),
          };
        }
        const sourceParts = localArtifactPathParts(payload.path);
        const sourceName = sourceParts.at(-1)!;
        const parentParts = sourceParts.slice(0, -1);
        const parent = parentParts.length > 0 ? new Directory(root, ...parentParts) : root;
        const sourceFile = new File(parent, sourceName);
        const sourceDirectory = new Directory(parent, sourceName);
        if (sourceFile.exists) sourceFile.rename(name);
        else if (sourceDirectory.exists) sourceDirectory.rename(name);
        else throw new Error(`Artifact path not found: ${sourceParts.join('/')}`);
        return {
          ok: true,
          action,
          path: sourceParts.join('/'),
          targetPath: [...parentParts, name].join('/'),
        };
      }
      if (operation === 'file.write') {
        const { thread } = getThread();
        const parts = localArtifactPathParts(payload.path);
        if (typeof payload.content !== 'string') throw new Error('content must be a string');
        const bytes = new TextEncoder().encode(payload.content);
        if (bytes.length > MOBILE_FILE_EDIT_MAX_BYTES) {
          throw new Error(
            `File is too large to edit on mobile (${bytes.length} bytes, max ${MOBILE_FILE_EDIT_MAX_BYTES})`,
          );
        }
        const root = new Directory(
          Paths.document,
          'drone-hub-native-artifacts-v1',
          encodeURIComponent(thread.id),
        );
        const file = new File(root, ...parts);
        if (!file.exists) throw new Error(`Artifact file not found: ${parts.join('/')}`);
        const expectedRevision = String(payload.expectedRevision ?? '').trim();
        if (expectedRevision) {
          const currentRevision = fileRevision(await file.bytes());
          if (currentRevision !== expectedRevision) throw new Error('File changed on disk');
        }
        file.write(payload.content);
        return {
          ok: true,
          path: parts.join('/'),
          size: bytes.length,
          mtimeMs: Number.isFinite(Number(file.modificationTime))
            ? Number(file.modificationTime)
            : null,
          revision: fileRevision(bytes),
        };
      }
      if (operation === 'file.preview') {
        const { thread } = getThread();
        const parts = localArtifactPathParts(payload.path);
        const root = new Directory(
          Paths.document,
          'drone-hub-native-artifacts-v1',
          encodeURIComponent(thread.id),
        );
        const file = new File(root, ...parts);
        if (!file.exists) throw new Error(`Artifact file not found: ${parts.join('/')}`);
        const mime = inferMobilePreviewMime(parts.join('/'));
        const mediaKind = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : null;
        const fileSize = Number(file.size);
        const size = Number.isFinite(fileSize) ? Math.max(0, Math.floor(fileSize)) : 0;
        const mtimeMs = Number.isFinite(Number(file.modificationTime))
          ? Number(file.modificationTime)
          : null;
        const maxBytes = mediaKind ? MOBILE_MEDIA_PREVIEW_MAX_BYTES : MOBILE_TEXT_PREVIEW_MAX_BYTES;
        if (size > maxBytes) {
          throw new Error(
            `${mediaKind ? 'Media' : 'File'} is too large to preview on mobile (${size} bytes, max ${maxBytes})`,
          );
        }
        if (payload.metadataOnly === true && payload.includeRevision !== true) {
          return {
            preview: {
              path: parts.join('/'),
              kind: mediaKind ?? 'text',
              mime,
              size,
              mtimeMs,
              revision: null,
            },
          };
        }
        const bytes = await file.bytes();
        const kind = mediaKind ?? (bytes.includes(0) ? 'binary' : 'text');
        const preview = {
          path: parts.join('/'),
          kind,
          mime: kind === 'text' && mime === 'text/plain' ? 'text/plain' : mime,
          size,
          mtimeMs,
          revision: fileRevision(bytes),
          ...(kind === 'text' ? { content: new TextDecoder().decode(bytes) } : {}),
        };
        if (payload.metadataOnly === true) {
          const { content: _content, ...metadata } = preview;
          return { preview: metadata };
        }
        if (kind !== 'image' && kind !== 'video') {
          return { contentChunk: localJsonChunk(preview, payload.contentOffset) };
        }
        return {
          preview,
          mediaDataBase64: fromByteArray(bytes),
        };
      }
      if (operation === 'chat.read') {
        const { drone, chatName, thread } = getThread();
        const settings = await loadLocalAssistantSettings();
        return {
          ok: true,
          historyKind: 'messages',
          nativeChatId: thread.id,
          history: thread.messages,
          streamingMessages: [],
          pendingApprovals: assistant.pendingApprovals.filter(
            (approval) => approval.threadId === thread.id,
          ),
          pendingQuestionRequests: [],
          questionRequests: [],
          pending:
            drone.draft === true || drone.draftChats?.[chatName] === true
              ? localDroneDraftPromptsForChat(drone, chatName).map((prompt) => ({
                  id: prompt.id,
                  prompt: prompt.prompt,
                  at: prompt.createdAt,
                  state: 'queued',
                  attachmentCount: prompt.promptImages.length,
                  imageCount: prompt.promptImages.length,
                }))
              : thread.queuedPrompts.map((prompt) => ({
                  ...prompt,
                  state: prompt.status,
                })),
          thread,
          agent: { kind: 'native' },
          provider: settings.provider,
          model: thread.model,
          reasoning: thread.thinkingLevel,
          agentPermissionMode: thread.agentPermissionMode ?? 'execute',
          approvalPolicy: thread.approvalPolicy ?? (thread.autoApprove ? 'none' : 'ask'),
          subscriptions: [],
          readState: { unread: false },
        };
      }
      if (operation === 'chat.prompt') {
        const { drone, chatName, thread } = getThread();
        const images = promptImages(payload.attachments);
        const prompt = String(payload.prompt ?? '').trim();
        if (payload.deliveryMode === 'asap' && assistant.runningThreadId) {
          throw new Error('ASAP delivery is unavailable while a phone-native chat is running.');
        }
        if (drone.draft === true || drone.draftChats?.[chatName] === true) {
          const currentDraftPrompts = localDroneDraftPromptsForChat(drone, chatName);
          const nextPrompt = {
            id: String(payload.promptId ?? '').trim() || `phone_draft_${Crypto.randomUUID()}`,
            prompt,
            promptImages: images,
            createdAt: String(payload.submittedAt ?? '').trim() || new Date().toISOString(),
          };
          if (!prompt && images.length === 0) throw new Error('Add a message or image.');
          if (currentDraftPrompts.length >= 20) {
            throw new Error('Phone draft prompt queue is full (max 20)');
          }
          await replaceDrones(
            dronesRef.current.map((candidate) =>
              candidate.id === drone.id
                ? candidate.draft === true && chatName === 'default'
                  ? {
                      ...candidate,
                      draftPrompts: [...currentDraftPrompts, nextPrompt],
                    }
                  : {
                      ...candidate,
                      draftChatPrompts: {
                        ...(candidate.draftChatPrompts ?? {}),
                        [chatName]: [...currentDraftPrompts, nextPrompt],
                      },
                    }
                : candidate,
            ),
          );
          return { ok: true, accepted: true, promptId: nextPrompt.id, pendingState: 'queued' };
        }
        if (images.length > 0 && assistant.runningThreadId) {
          throw new Error('Wait for the current response before sending images.');
        }
        if (payload.deliveryMode === 'queue') {
          const queued = await assistant.queuePrompt(thread.id, prompt, images);
          return {
            ok: true,
            accepted: true,
            promptId: queued.promptId,
            pendingState: 'queued',
          };
        }
        // The request is acknowledged immediately so the shared chat UI remains responsive.
        // sendPrompt persists failures onto the thread; consume the rejection to avoid an
        // unhandled promise while the revision refresh publishes that error to the screen.
        void assistant
          .sendPrompt(thread.id, String(payload.prompt ?? ''), images)
          .catch(() => undefined);
        return { ok: true, accepted: true };
      }
      if (operation === 'chat.stop') {
        const { thread } = getThread();
        const promptId = String(payload.promptId ?? '').trim();
        if (promptId) await assistant.cancelQueuedPrompt(thread.id, promptId);
        else assistant.stop(thread.id);
        return { ok: true };
      }
      if (operation === 'chat.interruption.resolve') {
        const { thread } = getThread();
        if (payload.resolution !== 'skip') throw new Error('Unsupported interruption resolution');
        const promptId = String(payload.promptId ?? '').trim();
        if (!promptId || promptId !== String(thread.interruptedPromptId ?? '').trim()) {
          throw new Error('Interrupted prompt was not found');
        }
        await assistant.skipInterruption(thread.id);
        return { ok: true };
      }
      if (operation === 'chat.models') {
        const { thread } = getThread();
        const settings = await loadLocalAssistantSettings();
        return {
          ok: true,
          agent: { kind: 'native' },
          model: thread.model,
          provider: settings.provider,
          reasoning: thread.thinkingLevel,
          models: localAssistantModelOptions(settings.provider).map((model) => ({
            provider: settings.provider,
            id: model.id,
            label: model.name,
            reasoningLevels: ['off', 'low', 'medium', 'high'],
          })),
        };
      }
      if (operation === 'chat.update') {
        const { thread } = getThread();
        await assistant.updateThread(thread.id, {
          ...(payload.model !== undefined ? { model: String(payload.model) } : {}),
          ...(payload.thinkingLevel !== undefined || payload.reasoning !== undefined
            ? {
                thinkingLevel: normalizeLocalAssistantThinkingLevel(
                  payload.thinkingLevel ?? payload.reasoning,
                ),
              }
            : {}),
          ...(typeof payload.autoApprove === 'boolean' ? { autoApprove: payload.autoApprove } : {}),
          ...(payload.agentPermissionMode
            ? { agentPermissionMode: payload.agentPermissionMode }
            : {}),
          ...(payload.approvalPolicy === 'none' || payload.approvalPolicy === 'ask'
            ? { approvalPolicy: payload.approvalPolicy }
            : {}),
        });
        return { ok: true };
      }
      if (operation === 'chat.approval.resolve') {
        if (payload.promptId) {
          throw new Error('Codex approvals are unavailable for phone-local drones');
        }
        const { thread } = getThread();
        assistant.resolveApproval(
          thread.id,
          String(payload.approvalId ?? ''),
          payload.approved === true,
        );
        return { ok: true };
      }
      if (operation === 'chat.message.delete') {
        const { thread } = getThread();
        await assistant.deleteMessage(
          thread.id,
          String(payload.messageId ?? ''),
          payload.deleteFollowing === true,
        );
        return { ok: true };
      }
      throw new Error(`Unsupported phone drone operation: ${operation}`);
    },
    [assistant, replaceDrones, replaceDronesAndGroups, replaceGroups],
  );

  const revision = [
    ...groups.map((group) => `${group.id}:${group.name}:${group.createdAt}`),
    pinnedDroneIds.join(','),
    assistant.runningThreadId ?? '',
    assistant.pendingApprovals.map((approval) => approval.id).join(','),
    ...assistant.threads.map(
      (thread) =>
        `${thread.id}:${thread.updatedAt}:${thread.status}:${thread.messages.length}:${thread.queuedPrompts.length}`,
    ),
  ].join('|');
  return { drones, loading: loading || assistant.loading, request, revision };
}

type LocalDroneControlValue = ReturnType<typeof useLocalDroneControlValue>;

const LocalDroneControlContext = React.createContext<LocalDroneControlValue | null>(null);

export function LocalDroneControlProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const value = useLocalDroneControlValue();
  const requestRef = React.useRef(value.request);
  requestRef.current = value.request;

  React.useEffect(
    () =>
      mesh.registerCapabilityHandler(DRONE_CONTROL_CAPABILITY, (operation, payload) =>
        requestRef.current(operation as DroneControlOperation, payload as Record<string, unknown>),
      ),
    [mesh.registerCapabilityHandler],
  );

  return React.createElement(LocalDroneControlContext.Provider, { value }, children);
}

export function useLocalDroneControl(): LocalDroneControlValue {
  const value = React.useContext(LocalDroneControlContext);
  if (!value) throw new Error('useLocalDroneControl must be used inside LocalDroneControlProvider');
  return value;
}
