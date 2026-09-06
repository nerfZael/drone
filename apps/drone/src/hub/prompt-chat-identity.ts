/** Resolve a dispatch target without allowing a reused name to select another chat. */
export function resolvePromptChatName(input: {
  droneId: string;
  chatName: string;
  chatEntryId: string;
  readMetadata: (input: { droneId: string; chatName: string }) => { chat: any | null };
  listChats: (input: { droneId: string }) => { chats: string[] };
}): string {
  const id = input.chatEntryId.trim();
  if (!id) throw new Error('prompt target has no stable chat identity');
  const matches = (chatName: string) =>
    input.readMetadata({ droneId: input.droneId, chatName }).chat?.id === id;
  if (matches(input.chatName)) return input.chatName;
  for (const name of input.listChats({ droneId: input.droneId }).chats) {
    if (name !== input.chatName && matches(name)) return name;
  }
  throw new Error(`unknown chat identity: ${id}`);
}
