import { ConflictError, NotFoundError, TimeoutError, TransportError, ValidationError } from './errors';
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

type HubTransportOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

function mergeSignal(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function normalizeRunStatus(value: unknown): RunStatus {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'canceled';
  if (status === 'queued') return 'queued';
  return 'running';
}

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

function normalizePromptId(key?: string): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  const safe = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (safe.length >= 6 && safe.length <= 96) return safe;
  let hash = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(index)) >>> 0;
  }
  return `msg-${hash.toString(16).padStart(8, '0')}`;
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

async function requestJson<T extends JsonValue>(
  options: HubTransportOptions,
  pathname: string,
  init: RequestInit = {},
  requestOptions?: RequestOptions,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = requestOptions?.timeoutMs ?? 5000;
  const signal = mergeSignal(controller.signal, mergeSignal(init.signal as AbortSignal | undefined, requestOptions?.signal));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetch ?? fetch)(joinUrl(options.baseUrl, pathname), {
      ...init,
      signal,
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = String(data?.error ?? text ?? `${init.method ?? 'GET'} ${pathname} failed`).trim();
      if (response.status === 404) throw new NotFoundError(message);
      if (response.status === 409) throw new ConflictError(message);
      throw new TransportError(message, response.status);
    }
    return data as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new TimeoutError(`request timeout after ${timeoutMs}ms: ${init.method ?? 'GET'} ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toDroneRecord(drone: any): DroneRecord {
  return {
    id: String(drone?.id ?? ''),
    name: String(drone?.name ?? ''),
    group: typeof drone?.group === 'string' && drone.group.trim() ? String(drone.group).trim() : undefined,
    runtime: 'container',
    createdAt: typeof drone?.createdAt === 'string' ? drone.createdAt : undefined,
    repoPath: typeof drone?.repoPath === 'string' ? drone.repoPath : undefined,
    cwd: typeof drone?.cwd === 'string' ? drone.cwd : undefined,
  };
}

function transcriptToMessages(chatName: string, transcripts: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const transcript of transcripts) {
    const promptId = typeof transcript?.id === 'string' && transcript.id.trim() ? String(transcript.id).trim() : undefined;
    const promptAt = typeof transcript?.promptAt === 'string' ? transcript.promptAt : transcript?.at;
    const completedAt = typeof transcript?.completedAt === 'string' ? transcript.completedAt : transcript?.at;
    const prompt = String(transcript?.prompt ?? '').trim();
    const output = String(transcript?.output ?? '').trim();
    if (prompt) {
      messages.push({
        id: `${promptId ?? `${messages.length}`}:user`,
        chat: chatName,
        role: 'user',
        content: prompt,
        createdAt: String(promptAt ?? new Date().toISOString()),
        runId: promptId,
      });
    }
    if (output) {
      messages.push({
        id: `${promptId ?? `${messages.length}`}:assistant`,
        chat: chatName,
        role: 'assistant',
        content: output,
        createdAt: String(completedAt ?? promptAt ?? new Date().toISOString()),
        runId: promptId,
      });
    }
    if (!transcript?.ok && !output) {
      messages.push({
        id: `${promptId ?? `${messages.length}`}:assistant-error`,
        chat: chatName,
        role: 'assistant',
        content: String(transcript?.error ?? 'failed'),
        createdAt: String(completedAt ?? promptAt ?? new Date().toISOString()),
        runId: promptId,
      });
    }
  }
  return messages;
}

async function resolveDeleteMode(options: HubTransportOptions, requestOptions?: RequestOptions): Promise<'archive' | 'permanent'> {
  const response = await requestJson<any>(options, '/api/settings/delete-action', { method: 'GET' }, requestOptions);
  return response?.deleteAction?.mode === 'archive' ? 'archive' : 'permanent';
}

export function hubTransport(options: HubTransportOptions): DroneTransport {
  return {
    async createDrone(input: CreateDroneBatchItem, requestOptions?: RequestOptions): Promise<DroneRecord> {
      const body: JsonObject = {
        name: input.name,
        runtime: input.runtime ?? 'container',
      };
      if (input.group) body.group = input.group;
      if (input.cwd) body.cwd = input.cwd;
      if (input.repoPath) body.repoPath = input.repoPath;
      const response = await requestJson<any>(
        options,
        '/api/drones',
        { method: 'POST', body: JSON.stringify(body) },
        requestOptions,
      );
      return {
        id: String(response?.id ?? ''),
        name: String(response?.name ?? input.name),
        group: input.group,
        runtime: input.runtime ?? 'container',
      };
    },

    async createDrones(inputs: CreateDroneBatchItem[], requestOptions?: RequestOptions): Promise<CreateManyResult> {
      const response = await requestJson<any>(
        options,
        '/api/drones/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            drones: inputs.map((item) => ({
              name: item.name,
              runtime: item.runtime ?? 'container',
              ...(item.group ? { group: item.group } : {}),
              ...(item.cwd ? { cwd: item.cwd } : {}),
              ...(item.repoPath ? { repoPath: item.repoPath } : {}),
            })),
          }),
        },
        requestOptions,
      );
      return {
        accepted: Array.isArray(response?.accepted)
          ? response.accepted.map((item: any) => ({
              id: String(item?.id ?? ''),
              name: String(item?.name ?? ''),
              runtime: 'container',
            }))
          : [],
        rejected: Array.isArray(response?.rejected)
          ? response.rejected.map((item: any) => ({
              name: String(item?.name ?? ''),
              error: String(item?.error ?? 'rejected'),
            }))
          : [],
      };
    },

    async getDrone(idOrName: string, requestOptions?: RequestOptions): Promise<DroneRecord | null> {
      const drones = await this.listDrones(undefined, requestOptions);
      return drones.find((drone) => drone.id === idOrName || drone.name === idOrName) ?? null;
    },

    async listDrones(input?: ListDronesInput, requestOptions?: RequestOptions): Promise<DroneRecord[]> {
      const response = await requestJson<any>(options, '/api/drones', { method: 'GET' }, requestOptions);
      let drones = Array.isArray(response?.drones) ? response.drones.map(toDroneRecord) : [];
      if (input?.group) drones = drones.filter((drone: DroneRecord) => drone.group === input.group);
      if (input?.names?.length) {
        const wanted = new Set(input.names);
        drones = drones.filter((drone: DroneRecord) => wanted.has(drone.name) || wanted.has(drone.id));
      }
      return drones;
    },

    async listGroups(requestOptions?: RequestOptions): Promise<DroneGroupSummary[]> {
      const response = await requestJson<any>(options, '/api/groups', { method: 'GET' }, requestOptions);
      return Array.isArray(response?.groups)
        ? response.groups.map((group: any) => ({
            name: String(group?.name ?? ''),
            count: Number(group?.totalCount ?? 0),
          }))
        : [];
    },

    async renameDrone(idOrName: string, nextName: string, requestOptions?: RequestOptions): Promise<DroneRecord> {
      await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(idOrName)}/rename`,
        { method: 'POST', body: JSON.stringify({ newName: nextName }) },
        requestOptions,
      );
      const updated = await this.getDrone(idOrName, requestOptions);
      if (updated) return updated;
      return { id: idOrName, name: nextName, runtime: 'container' };
    },

    async archiveDrone(idOrName: string, requestOptions?: RequestOptions): Promise<void> {
      await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(idOrName)}/archive`,
        { method: 'POST', body: JSON.stringify({}) },
        requestOptions,
      );
    },

    async removeDrone(idOrName: string, input?: RemoveDroneInput, requestOptions?: RequestOptions): Promise<void> {
      const mode =
        input?.mode && input.mode !== 'auto' ? input.mode : await resolveDeleteMode(options, requestOptions);
      if (mode === 'archive') {
        await this.archiveDrone(idOrName, requestOptions);
        return;
      }
      const search = new URLSearchParams();
      if (input?.keepVolume) search.set('keepVolume', '1');
      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(idOrName)}${suffix}`,
        { method: 'DELETE' },
        requestOptions,
      );
    },

    async listChats(droneIdOrName: string, requestOptions?: RequestOptions): Promise<ChatSummary[]> {
      const response = await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(droneIdOrName)}/chats`,
        { method: 'GET' },
        requestOptions,
      );
      return Array.isArray(response?.chats)
        ? response.chats.map((name: any) => ({
            name: String(name ?? ''),
          }))
        : [];
    },

    async ensureChat(droneIdOrName: string, chatName: string, requestOptions?: RequestOptions): Promise<ChatSummary> {
      try {
        await requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats`,
          {
            method: 'POST',
            body: JSON.stringify({ name: chatName }),
          },
          requestOptions,
        );
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
      return { name: chatName };
    },

    async removeChat(droneIdOrName: string, chatName: string, requestOptions?: RequestOptions): Promise<void> {
      await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}`,
        { method: 'DELETE' },
        requestOptions,
      );
    },

    async sendMessage(
      droneIdOrName: string,
      chatName: string,
      message: MessageInput,
      requestOptions?: SendOptions,
    ): Promise<RunRecord> {
      const prompt = normalizePrompt(message);
      const promptId = normalizePromptId(requestOptions?.idempotencyKey);
      const response = await requestJson<any>(
        options,
        `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/prompt`,
        {
          method: 'POST',
          body: JSON.stringify({
            prompt,
            ...(promptId ? { promptId } : {}),
          }),
        },
        requestOptions,
      );
      return {
        id: String(response?.promptId ?? promptId ?? ''),
        droneId: String(response?.id ?? droneIdOrName),
        chatName: String(response?.chat ?? chatName),
        status: normalizeRunStatus(response?.pendingState),
      };
    },

    async getRun(
      droneIdOrName: string,
      chatName: string,
      runId: string,
      requestOptions?: RequestOptions,
    ): Promise<RunRecord> {
      const [pending, transcript] = await Promise.all([
        requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/pending`,
          { method: 'GET' },
          requestOptions,
        ),
        requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/transcript?turn=all`,
          { method: 'GET' },
          requestOptions,
        ).catch((error) => {
          if (error instanceof TransportError && error.status === 410) return { transcripts: [] };
          throw error;
        }),
      ]);

      const pendingMatch = Array.isArray(pending?.pending)
        ? pending.pending.find((item: any) => String(item?.id ?? '').trim() === runId)
        : null;
      const transcriptMatch = Array.isArray(transcript?.transcripts)
        ? transcript.transcripts.find((item: any) => String(item?.id ?? '').trim() === runId)
        : null;

      if (transcriptMatch) {
        return {
          id: runId,
          droneId: String(transcript?.id ?? droneIdOrName),
          chatName,
          status: transcriptMatch?.ok === false ? 'failed' : 'done',
          startedAt: typeof transcriptMatch?.promptAt === 'string' ? transcriptMatch.promptAt : transcriptMatch?.at,
          finishedAt:
            typeof transcriptMatch?.completedAt === 'string'
              ? transcriptMatch.completedAt
              : typeof transcriptMatch?.at === 'string'
                ? transcriptMatch.at
                : undefined,
          error: transcriptMatch?.ok === false ? String(transcriptMatch?.error ?? 'failed') : undefined,
        };
      }

      if (pendingMatch) {
        return {
          id: runId,
          droneId: String(pending?.id ?? droneIdOrName),
          chatName,
          status: normalizeRunStatus(pendingMatch?.state),
          startedAt: typeof pendingMatch?.at === 'string' ? pendingMatch.at : undefined,
          error: typeof pendingMatch?.error === 'string' ? pendingMatch.error : undefined,
        };
      }

      return {
        id: runId,
        droneId: String(pending?.id ?? droneIdOrName),
        chatName,
        status: 'running',
      };
    },

    async cancelRun(
      droneIdOrName: string,
      chatName: string,
      runId: string,
      requestOptions?: RequestOptions,
    ): Promise<void> {
      try {
        await requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(runId)}`,
          { method: 'DELETE' },
          requestOptions,
        );
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw error;
      }
    },

    async listMessages(
      droneIdOrName: string,
      chatName: string,
      input?: ListMessagesInput,
      requestOptions?: RequestOptions,
    ): Promise<ChatMessage[]> {
      try {
        const transcript = await requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/transcript?turn=all`,
          { method: 'GET' },
          requestOptions,
        );
        const messages = transcriptToMessages(chatName, Array.isArray(transcript?.transcripts) ? transcript.transcripts : []);
        return applyMessageFilters(messages, input);
      } catch (error) {
        if (!(error instanceof TransportError) || error.status !== 410) throw error;
        const output = await requestJson<any>(
          options,
          `/api/drones/${encodeURIComponent(droneIdOrName)}/chats/${encodeURIComponent(chatName)}/output`,
          { method: 'GET' },
          requestOptions,
        );
        const raw = String(output?.output ?? '').trim();
        const messages = raw
          ? [
              {
                id: `${chatName}:output`,
                chat: chatName,
                role: 'assistant' as const,
                content: raw,
                createdAt: new Date().toISOString(),
              },
            ]
          : [];
        return applyMessageFilters(messages, input);
      }
    },
  };
}
