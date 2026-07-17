import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import React from 'react';
import type { DroneControlOperation } from '@drone/device-protocol';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { loadLocalAssistantSettings } from '../local-assistant/local-assistant-settings';
import {
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
} from '../local-assistant/local-assistant-model';

const LOCAL_DRONES_KEY = 'droneHub.nativeDrones.v1';

type LocalDroneRecord = {
  id: string;
  name: string;
  group: string | null;
  createdAt: string;
  chats: Record<string, string>;
};

function cleanDrones(value: unknown): LocalDroneRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const name = String(item?.name ?? '').trim();
    if (!id || !name || !item?.chats || typeof item.chats !== 'object') return [];
    const chats = Object.fromEntries(
      Object.entries(item.chats)
        .map(([chatName, threadId]) => [String(chatName).trim(), String(threadId).trim()])
        .filter(([chatName, threadId]) => Boolean(chatName && threadId)),
    );
    return [{
      id,
      name,
      group: String(item.group ?? '').trim() || null,
      createdAt: String(item.createdAt ?? new Date().toISOString()),
      chats,
    }];
  });
}

function uniqueDroneName(drones: LocalDroneRecord[], requested: unknown): string {
  const base = String(requested ?? '').trim().slice(0, 80) || 'Phone drone';
  const names = new Set(drones.map((drone) => drone.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

export function useLocalDroneControl() {
  const assistant = useLocalAssistant();
  const [drones, setDrones] = React.useState<LocalDroneRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const dronesRef = React.useRef<LocalDroneRecord[]>([]);
  const writeRef = React.useRef(Promise.resolve());

  const replaceDrones = React.useCallback(async (next: LocalDroneRecord[]) => {
    dronesRef.current = next;
    setDrones(next);
    const write = writeRef.current.then(() => AsyncStorage.setItem(LOCAL_DRONES_KEY, JSON.stringify(next)));
    writeRef.current = write.catch(() => undefined);
    await write;
  }, []);

  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LOCAL_DRONES_KEY)
      .then((stored) => cleanDrones(stored ? JSON.parse(stored) : []))
      .catch(async () => {
        await AsyncStorage.removeItem(LOCAL_DRONES_KEY);
        return [];
      })
      .then((next) => {
        if (!active) return;
        dronesRef.current = next;
        setDrones(next);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const request = React.useCallback(async (operation: DroneControlOperation, payload: any = {}): Promise<any> => {
    const getDrone = () => {
      const drone = dronesRef.current.find((candidate) => candidate.id === String(payload.droneId ?? ''));
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
            assistant.runningThreadId === threadId || threadById.get(threadId)?.status === 'running' ? [chatName] : [],
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
        },
        createOptions: { repos: [] },
      };
    }

    if (operation === 'drone.create.container') {
      throw new Error('Container drones are not available on this phone');
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
      if (thread && prompt) void assistant.sendPrompt(thread.id, prompt);
      return { ok: true, droneId: drone.id, drone };
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
      await replaceDrones(dronesRef.current.map((candidate) => candidate.id === drone.id ? nextDrone : candidate));
      return { ok: true, chatName, chats: Object.keys(nextDrone.chats) };
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
        pendingApprovals: assistant.pendingApprovals.filter((approval) => approval.threadId === thread.id),
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
      void assistant.sendPrompt(thread.id, String(payload.prompt ?? ''));
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
      assistant.resolveApproval(thread.id, String(payload.approvalId ?? ''), payload.approved === true);
      return { ok: true };
    }
    if (operation === 'chat.message.delete') {
      const { thread } = getThread();
      await assistant.deleteMessage(thread.id, String(payload.messageId ?? ''), payload.deleteFollowing === true);
      return { ok: true };
    }
    throw new Error(`Unsupported phone drone operation: ${operation}`);
  }, [assistant, replaceDrones]);

  const revision = [
    assistant.runningThreadId ?? '',
    assistant.pendingApprovals.map((approval) => approval.id).join(','),
    ...assistant.threads.map((thread) => `${thread.id}:${thread.updatedAt}:${thread.status}:${thread.messages.length}:${thread.queuedPrompts.length}`),
  ].join('|');
  return { drones, loading: loading || assistant.loading, request, revision };
}
