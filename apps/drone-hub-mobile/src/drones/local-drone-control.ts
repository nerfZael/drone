import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import React from 'react';
import { fromByteArray } from 'base64-js';
import type { DroneControlOperation } from '@drone/device-protocol';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { loadLocalAssistantSettings } from '../local-assistant/local-assistant-settings';
import {
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
} from '../local-assistant/local-assistant-model';
import type { LocalAssistantPromptImage } from '../local-assistant/local-assistant-types';
import {
  cleanLocalDroneRecords,
  createLegacyPhoneDroneRecord,
  type LocalDroneRecord,
} from './local-drone-records';
import {
  inferMobilePreviewMime,
  MOBILE_MEDIA_PREVIEW_MAX_BYTES,
  MOBILE_TEXT_PREVIEW_MAX_BYTES,
} from './file-preview-model';

const LOCAL_DRONES_KEY = 'droneHub.nativeDrones.v1';
const LOCAL_PINNED_DRONES_KEY = 'droneHub.nativePinnedDrones.v1';
const LOCAL_PREVIEW_CHUNK_BYTES = 128 * 1024;

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

export function useLocalDroneControl() {
  const assistant = useLocalAssistant();
  const [drones, setDrones] = React.useState<LocalDroneRecord[]>([]);
  const [pinnedDroneIds, setPinnedDroneIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const dronesRef = React.useRef<LocalDroneRecord[]>([]);
  const pinnedDroneIdsRef = React.useRef<string[]>([]);
  const writeRef = React.useRef(Promise.resolve());
  const loadedRef = React.useRef(false);

  const replaceDrones = React.useCallback(async (next: LocalDroneRecord[]) => {
    dronesRef.current = next;
    setDrones(next);
    const write = writeRef.current.then(() =>
      AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(next)),
    );
    writeRef.current = write.catch(() => undefined);
    await write;
  }, []);

  React.useEffect(() => {
    if (assistant.loading || loadedRef.current) return;
    loadedRef.current = true;
    let active = true;
    void AsyncStorage.getItem(LOCAL_DRONES_KEY)
      .then(async (stored) => {
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
      .catch(() => [])
      .then((next) => {
        if (!active) return;
        dronesRef.current = next;
        setDrones(next);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [assistant.loading, assistant.threads]);

  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LOCAL_PINNED_DRONES_KEY)
      .then((stored) => {
        if (!stored) return [];
        const value: unknown = JSON.parse(stored);
        return Array.isArray(value)
          ? [...new Set(value.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))]
          : [];
      })
      .catch(() => [])
      .then((ids) => {
        if (!active) return;
        pinnedDroneIdsRef.current = ids;
        setPinnedDroneIds(ids);
      });
    return () => {
      active = false;
    };
  }, []);

  const request = React.useCallback(
    async (operation: DroneControlOperation, payload: any = {}): Promise<any> => {
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
        const threadById = new Map(assistant.threads.map((thread) => [thread.id, thread]));
        return {
          schemaVersion: 2,
          drones: dronesRef.current.map((drone) => ({
            id: drone.id,
            name: drone.name,
            runtime: 'host',
            phase: 'ready',
            status: 'ready',
            group: drone.group,
            repoPath: '',
            chats: Object.keys(drone.chats),
            busyChats: Object.entries(drone.chats).flatMap(([chatName, threadId]) =>
              assistant.runningThreadId === threadId ||
              threadById.get(threadId)?.status === 'running'
                ? [chatName]
                : [],
            ),
            approvalChats: Object.entries(drone.chats).flatMap(([chatName, threadId]) =>
              threadById.get(threadId)?.status === 'waiting_for_approval' ||
              assistant.pendingApprovals.some((approval) => approval.threadId === threadId)
                ? [chatName]
                : [],
            ),
            approvalRequired: Object.values(drone.chats).some(
              (threadId) =>
                threadById.get(threadId)?.status === 'waiting_for_approval' ||
                assistant.pendingApprovals.some((approval) => approval.threadId === threadId),
            ),
            createdAt: drone.createdAt,
            lastActivityAt: Object.values(drone.chats)
              .map((threadId) => threadById.get(threadId)?.updatedAt ?? '')
              .sort()
              .at(-1),
          })),
          sidebar: {
            registeredRepoPaths: [],
            groupCreatedAtByName: {},
            sidebarGroupOrder: [],
            sidebarDroneOrderByGroup: {},
            sidebarNodeOrderByParent: {},
            pinnedDroneIds: pinnedDroneIdsRef.current,
          },
          createOptions: { repos: [] },
        };
      }

      if (operation === 'drone.create.container') {
        throw new Error('Container drones are not available on this phone');
      }
      if (operation === 'drone.pin.update') {
        const droneId = String(payload.droneId ?? '').trim();
        if (!dronesRef.current.some((drone) => drone.id === droneId)) {
          throw new Error('Phone drone was not found');
        }
        const next = payload.pinned === true
          ? pinnedDroneIdsRef.current.includes(droneId)
            ? pinnedDroneIdsRef.current
            : [...pinnedDroneIdsRef.current, droneId]
          : pinnedDroneIdsRef.current.filter((id) => id !== droneId);
        await AsyncStorage.setItem(LOCAL_PINNED_DRONES_KEY, JSON.stringify(next));
        pinnedDroneIdsRef.current = next;
        setPinnedDroneIds(next);
        return { ok: true, uiPreferences: { pinnedDroneIds: next } };
      }
      if (operation === 'drone.create.host') {
        const name = uniqueDroneName(dronesRef.current, payload.name);
        const createInitialChat = payload.seedAgent?.kind === 'native';
        const thread = createInitialChat ? await assistant.createThread('default') : null;
        if (thread) {
          await assistant.updateThread(thread.id, {
            artifactWorkspace: true,
            ...(payload.seedModel ? { model: String(payload.seedModel) } : {}),
            ...(payload.seedReasoning
              ? { thinkingLevel: normalizeLocalAssistantThinkingLevel(payload.seedReasoning) }
              : {}),
          });
        }
        const drone: LocalDroneRecord = {
          id: `phone_drone_${Crypto.randomUUID()}`,
          name,
          group: String(payload.group ?? '').trim() || null,
          createdAt: new Date().toISOString(),
          chats: thread ? { default: thread.id } : {},
        };
        await replaceDrones([drone, ...dronesRef.current]);
        const prompt = String(payload.seedPrompt ?? '').trim();
        const images = promptImages(payload.seedAttachments);
        if (thread && (prompt || images.length > 0)) {
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
            (candidate) =>
              candidate.id !== drone.id && candidate.name.trim() === newName,
          )
        ) {
          throw new Error('A drone with that name already exists.');
        }
        const nextDrone = { ...drone, name: newName };
        await replaceDrones(
          dronesRef.current.map((candidate) =>
            candidate.id === drone.id ? nextDrone : candidate,
          ),
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
        const chatName = String(payload.name ?? '').trim();
        if (!chatName) throw new Error('Chat name is required');
        if (drone.chats[chatName]) throw new Error(`Chat already exists: ${chatName}`);
        const sourceId = drone.chats[String(payload.copyFrom ?? '')];
        const thread = sourceId
          ? await assistant.cloneThread(sourceId)
          : await assistant.createThread(chatName);
        await assistant.updateThread(thread.id, { title: chatName, artifactWorkspace: true });
        const nextDrone = { ...drone, chats: { ...drone.chats, [chatName]: thread.id } };
        await replaceDrones(
          dronesRef.current.map((candidate) => (candidate.id === drone.id ? nextDrone : candidate)),
        );
        return { ok: true, chatName, chats: Object.keys(nextDrone.chats) };
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
        const maxBytes = mediaKind ? MOBILE_MEDIA_PREVIEW_MAX_BYTES : MOBILE_TEXT_PREVIEW_MAX_BYTES;
        if (size > maxBytes) {
          throw new Error(
            `${mediaKind ? 'Media' : 'File'} is too large to preview on mobile (${size} bytes, max ${maxBytes})`,
          );
        }
        const bytes = await file.bytes();
        const kind = mediaKind ?? (bytes.includes(0) ? 'binary' : 'text');
        const preview = {
          path: parts.join('/'),
          kind,
          mime: kind === 'text' && mime === 'text/plain' ? 'text/plain' : mime,
          size,
          mtimeMs: Number.isFinite(Number(file.modificationTime))
            ? Number(file.modificationTime)
            : null,
          ...(kind === 'text' ? { content: new TextDecoder().decode(bytes) } : {}),
        };
        if (kind !== 'image' && kind !== 'video') {
          return { contentChunk: localJsonChunk(preview, payload.contentOffset) };
        }
        return {
          preview,
          mediaDataBase64: fromByteArray(bytes),
        };
      }
      if (operation === 'chat.read') {
        const { thread } = getThread();
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
          pending: thread.queuedPrompts.map((prompt) => ({
            ...prompt,
            state: prompt.status,
          })),
          thread,
          agent: { kind: 'native' },
          provider: settings.provider,
          model: thread.model,
          reasoning: thread.thinkingLevel,
          agentPermissionMode: 'full-access',
          readState: { unread: false },
        };
      }
      if (operation === 'chat.prompt') {
        const { thread } = getThread();
        const images = promptImages(payload.attachments);
        if (images.length > 0 && assistant.runningThreadId) {
          throw new Error('Wait for the current response before sending images.');
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
        });
        return { ok: true };
      }
      if (operation === 'chat.approval.resolve') {
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
    [assistant, replaceDrones],
  );

  const revision = [
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
