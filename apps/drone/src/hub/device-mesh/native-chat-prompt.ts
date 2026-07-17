import type { LocalHubAccess } from './local-hub-request';

export async function submitNativeChatPrompt(
  access: LocalHubAccess,
  nativeChatId: string,
  prompt: string,
): Promise<any> {
  const response = await fetch(
    new URL(
      `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/prompt`,
      access.baseUrl(),
    ),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body?.error ?? `Built-in prompt failed (${response.status})`));
  }

  const reader = response.body?.getReader();
  if (!reader) return { type: 'accepted', threadId: nativeChatId };
  const decoder = new TextDecoder();
  let buffer = '';
  const continueDraining = async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
      }
    } catch {
      // The prompt is already accepted; later drone chat events carry the updated state.
    }
  };

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      buffer += decoder.decode();
      const trailing = buffer.trim();
      if (!trailing) return { type: 'accepted', threadId: nativeChatId };
      const event = JSON.parse(trailing);
      if (event?.type === 'error') throw new Error(String(event.error ?? 'Built-in prompt failed'));
      return event;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event?.type === 'heartbeat') continue;
      if (event?.type === 'error') {
        void continueDraining();
        throw new Error(String(event.error ?? 'Built-in prompt failed'));
      }
      if (
        event?.type === 'accepted' ||
        event?.type === 'queued' ||
        event?.type === 'blip_event'
      ) {
        void continueDraining();
        return event;
      }
      if (event?.type === 'done') return { type: 'accepted', threadId: nativeChatId };
    }
  }
}
