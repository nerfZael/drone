type DroneChatChange = { droneId: string; chatName: string };

type Listener<T> = (change: T) => void;

const registryListeners = new Set<Listener<void>>();
const summaryListeners = new Set<Listener<void>>();
const chatListeners = new Set<Listener<DroneChatChange>>();

export const hubChangeEvents = {
  emitRegistryWrite(): void {
    for (const listener of registryListeners) listener();
  },
  emitSummaryChange(): void {
    for (const listener of summaryListeners) listener();
  },
  emitChatWrite(droneId: string, chatName: string): void {
    for (const listener of chatListeners) listener({ droneId, chatName });
  },
  onRegistryWrite(listener: Listener<void>): () => void {
    registryListeners.add(listener);
    return () => registryListeners.delete(listener);
  },
  onSummaryChange(listener: Listener<void>): () => void {
    summaryListeners.add(listener);
    return () => summaryListeners.delete(listener);
  },
  onChatWrite(listener: Listener<DroneChatChange>): () => void {
    chatListeners.add(listener);
    return () => chatListeners.delete(listener);
  },
};
