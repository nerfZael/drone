type MergeNativeBusyChatNamesInput = {
  busyChatNames: string[];
  chatNames: string[];
  droneEntry: any;
  isNativeChat: (chatEntry: any, droneEntry: any) => boolean;
  isThreadBusy: (threadId: string) => Promise<boolean>;
};

export async function mergeNativeBusyChatNames({
  busyChatNames,
  chatNames,
  droneEntry,
  isNativeChat,
  isThreadBusy,
}: MergeNativeBusyChatNamesInput): Promise<string[]> {
  const nativeBusy = await Promise.all(
    chatNames.map(async (chatName) => {
      const chatEntry = droneEntry?.chats?.[chatName];
      if (!isNativeChat(chatEntry, droneEntry)) return false;
      const threadId = String(chatEntry?.id ?? '').trim();
      return Boolean(threadId) && (await isThreadBusy(threadId));
    }),
  );
  const merged = new Set(busyChatNames);
  for (let index = 0; index < chatNames.length; index += 1) {
    if (nativeBusy[index]) merged.add(chatNames[index]);
  }
  return [...merged];
}
