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
  draftChats?: Record<string, true>;
  draftChatPrompts?: Record<string, LocalDroneDraftPrompt[]>;
};

export function localDroneDraftChatMap(drone: LocalDroneRecord): Record<string, true> {
  if (drone.draft !== true) return drone.draftChats ?? {};
  return Object.fromEntries(Object.keys(drone.chats).map((chatName) => [chatName, true]));
}

export function localDroneDraftPromptsForChat(
  drone: LocalDroneRecord,
  chatName: string,
): LocalDroneDraftPrompt[] {
  return drone.draft === true && chatName === 'default'
    ? (drone.draftPrompts ?? [])
    : (drone.draftChatPrompts?.[chatName] ?? []);
}

function cleanDraftPrompts(value: unknown): LocalDroneDraftPrompt[] {
  return Array.isArray(value)
    ? value.slice(0, 20).flatMap((prompt: any) => {
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
}

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
    const draftPrompts = cleanDraftPrompts(item.draftPrompts);
    const draftChats = Object.fromEntries(
      Object.entries(
        item.draftChats && typeof item.draftChats === 'object' && !Array.isArray(item.draftChats)
          ? item.draftChats
          : {},
      ).flatMap(([chatName, draft]) =>
        draft === true && chats[chatName] ? [[chatName, true] as const] : [],
      ),
    );
    const rawDraftChatPrompts =
      item.draftChatPrompts &&
      typeof item.draftChatPrompts === 'object' &&
      !Array.isArray(item.draftChatPrompts)
        ? item.draftChatPrompts
        : {};
    const draftPromptChatNames = item.draft === true ? Object.keys(chats) : Object.keys(draftChats);
    const draftChatPrompts = Object.fromEntries(
      draftPromptChatNames.filter((chatName) => chatName !== 'default').flatMap((chatName) => {
        const prompts = cleanDraftPrompts(rawDraftChatPrompts[chatName]);
        return prompts.length > 0 ? [[chatName, prompts] as const] : [];
      }),
    );
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
        ...(Object.keys(draftChats).length > 0 ? { draftChats } : {}),
        ...(Object.keys(draftChatPrompts).length > 0 ? { draftChatPrompts } : {}),
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
