import type { LocalAssistantThread } from '../local-assistant/local-assistant-types';

export type LocalDroneDraftPrompt = {
  id: string;
  prompt: string;
  promptImages: Array<{ type: 'image'; data: string; mimeType: string }>;
  createdAt: string;
};

export type LocalDroneRecord = {
  id: string;
  name: string;
  group: string | null;
  createdAt: string;
  chats: Record<string, string>;
  draft?: boolean;
  draftPrompts?: LocalDroneDraftPrompt[];
};

export function cleanLocalDroneRecords(value: unknown): LocalDroneRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const name = String(item?.name ?? '').trim();
    if (!id || !name || !item?.chats || typeof item.chats !== 'object') return [];
    const chats = Object.fromEntries(
      Object.entries(item.chats)
        .map(([chatName, threadId]) => [
          String(chatName).trim().slice(0, 160),
          String(threadId).trim().slice(0, 100),
        ])
        .filter(([chatName, threadId]) => Boolean(chatName && threadId)),
    );
    const draftPrompts: LocalDroneDraftPrompt[] = Array.isArray(item.draftPrompts)
      ? item.draftPrompts.slice(0, 20).flatMap((prompt: any) => {
          const id = String(prompt?.id ?? '').trim().slice(0, 160);
          const text = String(prompt?.prompt ?? '');
          const createdAt = String(prompt?.createdAt ?? new Date().toISOString());
          const promptImages = Array.isArray(prompt?.promptImages)
            ? prompt.promptImages.slice(0, 8).flatMap((image: any) => {
                const data = String(image?.data ?? '').trim();
                const mimeType = String(image?.mimeType ?? '').trim().toLowerCase();
                return data && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)
                  ? [{ type: 'image' as const, data, mimeType }]
                  : [];
              })
            : [];
          return id && (text.trim() || promptImages.length > 0)
            ? [{ id, prompt: text, promptImages, createdAt }]
            : [];
        })
      : [];
    return [
      {
        id: id.slice(0, 160),
        name: name.slice(0, 80),
        group:
          String(item.group ?? '')
            .trim()
            .slice(0, 160) || null,
        createdAt: String(item.createdAt ?? new Date().toISOString()),
        chats,
        ...(item.draft === true ? { draft: true } : {}),
        ...(item.draft === true && draftPrompts.length > 0 ? { draftPrompts } : {}),
      },
    ];
  });
}

function uniqueChatName(taken: Set<string>, requested: unknown, fallbackIndex: number): string {
  const base =
    String(requested ?? '')
      .trim()
      .slice(0, 150) || `Chat ${fallbackIndex}`;
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 150)} ${suffix}`;
    suffix += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export function createLegacyPhoneDroneRecord(
  threads: readonly LocalAssistantThread[],
): LocalDroneRecord | null {
  if (threads.length === 0) return null;
  const takenNames = new Set<string>();
  const chats = Object.fromEntries(
    threads.map((thread, index) => [
      uniqueChatName(takenNames, thread.title, index + 1),
      thread.id,
    ]),
  );
  const createdAt =
    threads
      .map((thread) => thread.createdAt)
      .filter(Boolean)
      .sort()[0] ?? new Date().toISOString();
  return {
    id: 'phone_drone_legacy_assistant',
    name: 'Phone assistant',
    group: null,
    createdAt,
    chats,
  };
}
