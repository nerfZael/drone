import { ValidationError } from './errors';
import type {
  ChatMessage,
  ChatSummary,
  CreateDroneBatchItem,
  CreateManyResult,
  DroneGroupSummary,
  DroneRecord,
  DroneTransport,
  ListDronesInput,
  ListMessagesInput,
  MessageInput,
  RequestOptions,
  RunRecord,
  RunStatus,
  SendOptions,
  RemoveDroneInput,
} from './types';

type MockTransportOptions = {
  responder?: (input: {
    drone: DroneRecord;
    chatName: string;
    prompt: string;
  }) => string | Promise<string>;
  deleteMode?: 'archive' | 'permanent';
};

type StoredChat = {
  name: string;
  messages: ChatMessage[];
};

type StoredDrone = DroneRecord & {
  chats: Map<string, StoredChat>;
};

type StoredRun = RunRecord;

function applyMessageFilters(messages: ChatMessage[], input?: ListMessagesInput): ChatMessage[] {
  let list = [...messages];
  if (input?.cursor) {
    const cursorIndex = list.findIndex((message) => message.id === input.cursor);
    if (cursorIndex >= 0) list = list.slice(cursorIndex + 1);
  }
  if (input?.order === 'desc') list.reverse();
  if (typeof input?.limit === 'number' && input.limit >= 0) list = list.slice(0, input.limit);
  return list;
}

function normalizePrompt(message: MessageInput): string {
  if (typeof message === 'string') {
    const value = message.trim();
    if (!value) throw new ValidationError('message content cannot be empty');
    return value;
  }
  const value = String(message.content ?? '').trim();
  if (!value) throw new ValidationError('message content cannot be empty');
  return value;
}

export function createMockTransport(options: MockTransportOptions = {}): DroneTransport {
  const drones = new Map<string, StoredDrone>();
  const runs = new Map<string, StoredRun>();
  const archived = new Map<string, StoredDrone>();

  function getDroneOrThrow(idOrName: string): StoredDrone {
    const match = Array.from(drones.values()).find((drone) => drone.id === idOrName || drone.name === idOrName);
    if (!match) throw new Error(`unknown drone: ${idOrName}`);
    return match;
  }

  function ensureChat(drone: StoredDrone, chatName: string): StoredChat {
    const existing = drone.chats.get(chatName);
    if (existing) return existing;
    const chat: StoredChat = { name: chatName, messages: [] };
    drone.chats.set(chatName, chat);
    return chat;
  }

  return {
    async createDrone(input: CreateDroneBatchItem): Promise<DroneRecord> {
      const id = `drone-${drones.size + 1}`;
      const drone: StoredDrone = {
        id,
        name: input.name,
        group: input.group,
        runtime: input.runtime ?? 'container',
        createdAt: new Date().toISOString(),
        repoPath: input.repoPath,
        cwd: input.cwd,
        chats: new Map<string, StoredChat>(),
      };
      ensureChat(drone, 'default');
      drones.set(id, drone);
      return { ...drone };
    },

    async createDrones(inputs: CreateDroneBatchItem[]): Promise<CreateManyResult> {
      const accepted: DroneRecord[] = [];
      for (const input of inputs) accepted.push(await this.createDrone(input));
      return { accepted, rejected: [] };
    },

    async getDrone(idOrName: string): Promise<DroneRecord | null> {
      return Array.from(drones.values()).find((drone) => drone.id === idOrName || drone.name === idOrName) ?? null;
    },

    async listDrones(input?: ListDronesInput): Promise<DroneRecord[]> {
      let list = Array.from(drones.values()).map((drone) => ({ ...drone }));
      if (input?.group) list = list.filter((drone) => drone.group === input.group);
      if (input?.names?.length) {
        const wanted = new Set(input.names);
        list = list.filter((drone) => wanted.has(drone.id) || wanted.has(drone.name));
      }
      return list;
    },

    async listGroups(): Promise<DroneGroupSummary[]> {
      const counts = new Map<string, number>();
      for (const drone of drones.values()) {
        if (!drone.group) continue;
        counts.set(drone.group, (counts.get(drone.group) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
    },

    async renameDrone(idOrName: string, nextName: string): Promise<DroneRecord> {
      const drone = getDroneOrThrow(idOrName);
      drone.name = nextName;
      return { ...drone };
    },

    async archiveDrone(idOrName: string): Promise<void> {
      const drone = getDroneOrThrow(idOrName);
      drones.delete(drone.id);
      archived.set(drone.id, drone);
    },

    async removeDrone(idOrName: string, _input?: RemoveDroneInput, _options?: RequestOptions): Promise<void> {
      if ((_input?.mode ?? 'auto') === 'archive' || ((_input?.mode ?? 'auto') === 'auto' && options.deleteMode === 'archive')) {
        await this.archiveDrone(idOrName);
        return;
      }
      const drone = getDroneOrThrow(idOrName);
      drones.delete(drone.id);
    },

    async listChats(idOrName: string): Promise<ChatSummary[]> {
      const drone = getDroneOrThrow(idOrName);
      return Array.from(drone.chats.values()).map((chat) => ({
        name: chat.name,
        messageCount: chat.messages.length,
        lastMessageAt: chat.messages[chat.messages.length - 1]?.createdAt,
      }));
    },

    async ensureChat(idOrName: string, chatName: string): Promise<ChatSummary> {
      const drone = getDroneOrThrow(idOrName);
      const chat = ensureChat(drone, chatName);
      return { name: chat.name, messageCount: chat.messages.length };
    },

    async removeChat(idOrName: string, chatName: string): Promise<void> {
      const drone = getDroneOrThrow(idOrName);
      if (chatName === 'default') throw new Error('cannot delete default chat');
      if (!drone.chats.has(chatName)) throw new Error(`unknown chat: ${chatName}`);
      drone.chats.delete(chatName);
    },

    async sendMessage(idOrName: string, chatName: string, message: MessageInput, _options?: SendOptions): Promise<RunRecord> {
      const drone = getDroneOrThrow(idOrName);
      const chat = ensureChat(drone, chatName);
      const prompt = normalizePrompt(message);
      const runId = `run-${runs.size + 1}`;
      const now = new Date().toISOString();
      chat.messages.push({
        id: `${runId}:user`,
        chat: chatName,
        role: 'user',
        content: prompt,
        createdAt: now,
        runId,
      });
      const response = await Promise.resolve(
        options.responder?.({ drone, chatName, prompt }) ?? `ack:${prompt}`,
      );
      chat.messages.push({
        id: `${runId}:assistant`,
        chat: chatName,
        role: 'assistant',
        content: response,
        createdAt: new Date().toISOString(),
        runId,
      });
      const run: StoredRun = {
        id: runId,
        droneId: drone.id,
        chatName,
        status: 'done',
        startedAt: now,
        finishedAt: new Date().toISOString(),
      };
      runs.set(runId, run);
      return run;
    },

    async getRun(_idOrName: string, _chatName: string, runId: string): Promise<RunRecord> {
      const run = runs.get(runId);
      if (!run) throw new Error(`unknown run: ${runId}`);
      return { ...run };
    },

    async cancelRun(_idOrName: string, _chatName: string, runId: string): Promise<void> {
      const run = runs.get(runId);
      if (!run) return;
      run.status = 'canceled';
      run.finishedAt = new Date().toISOString();
    },

    async listMessages(idOrName: string, chatName: string, input?: ListMessagesInput): Promise<ChatMessage[]> {
      const drone = getDroneOrThrow(idOrName);
      const chat = ensureChat(drone, chatName);
      return applyMessageFilters(chat.messages, input);
    },
  };
}
