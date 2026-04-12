import type { ChatSendPayload } from '../chat';
import type { PendingPrompt, TranscriptItem } from '../types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type SendDroneChatPromptResponse = {
  ok: true;
  accepted: true;
  promptId: string;
  pendingState?: PendingPrompt['state'];
  blockedByAutomation?: boolean;
};

export async function createDroneChatEntry(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    copyFromChat?: string | null;
  },
): Promise<void> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim();
  const copyFromChat = String(opts.copyFromChat ?? '').trim();
  await requestJson<{ ok: true }>(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: chatName,
      ...(copyFromChat ? { copyFromChat } : {}),
    }),
  });
}

export async function sendDroneChatPrompt(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatSendPayload['attachments'];
  },
): Promise<SendDroneChatPromptResponse> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const prompt = String(opts.prompt ?? '');
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  return await requestJson<SendDroneChatPromptResponse>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/prompt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, attachments }),
    },
  );
}

export async function fetchDroneChatTranscript(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    turn?: 'all' | 'last' | number;
  },
): Promise<TranscriptItem[]> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const turn = opts.turn ?? 'all';
  const data = await requestJson<{ ok: true; transcripts: TranscriptItem[] }>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/transcript?turn=${encodeURIComponent(
      String(turn),
    )}`,
  );
  return Array.isArray(data?.transcripts) ? data.transcripts : [];
}
