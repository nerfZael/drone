import {
  buildSuggestedChatNameCandidate,
  isGeneratedChatName,
  isSuggestedChatRenameConflict,
} from '../droneHub/app/chat-name-suggestions';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type RemoteChatAutoRenameResult =
  | { ok: true; chatName: string }
  | { ok: false; error: string };

export async function suggestAndRenameRemoteChatFromPrompt(opts: {
  droneId: string;
  chatName: string;
  prompt: string;
  requestJson: RequestJson;
}): Promise<RemoteChatAutoRenameResult> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim();
  const prompt = String(opts.prompt ?? '').trim();
  if (!droneId || !isGeneratedChatName(chatName) || !prompt) {
    return { ok: false, error: 'chat is not eligible for auto-rename' };
  }

  const suggestion = await opts.requestJson<{ ok: true; name: string }>(
    '/api/drones/name-from-message',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        source: 'remote-chat-auto-rename',
        droneId,
      }),
    },
  );
  const base = String(suggestion?.name ?? '').trim();
  if (!base) return { ok: false, error: 'chat name suggestion returned an empty value' };

  let candidateIndex = 1;
  let lastError = '';
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = buildSuggestedChatNameCandidate(base, candidateIndex);
    if (!candidate) return { ok: false, error: 'chat name suggestion produced an empty candidate' };
    try {
      await opts.requestJson<{ ok: true; chat: string }>(
        `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/rename`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newName: candidate }),
        },
      );
      return { ok: true, chatName: candidate };
    } catch (error: any) {
      lastError = String(error?.message ?? error ?? '').trim() || 'rename failed';
      if (!isSuggestedChatRenameConflict(lastError)) return { ok: false, error: lastError };
      candidateIndex += 1;
    }
  }
  return { ok: false, error: lastError || 'rename failed after too many conflicts' };
}
