export type SendInNewChatQueueAction = {
  type: 'send-in-new-chat';
  sourceChatName: string;
  sourceChatId?: string;
  targetChatName?: string;
};

export type ChatQueueAction = SendInNewChatQueueAction;

export type ChatQueueActionPresentationState = 'queued' | 'running' | 'completed' | 'failed';

export type ChatQueueActionPresentation = {
  kind: ChatQueueAction['type'];
  state: ChatQueueActionPresentationState;
  label: string;
  queuedDescription: string;
  canCancel: boolean;
  canExecuteNow: boolean;
  countsAsAgentRun: boolean;
};

export function isSendInNewChatQueueAction(raw: unknown): raw is SendInNewChatQueueAction {
  if (!raw || typeof raw !== 'object') return false;
  const action = raw as Record<string, unknown>;
  if (action.type !== 'send-in-new-chat') return false;
  if (typeof action.sourceChatName !== 'string' || !action.sourceChatName.trim()) return false;
  if (action.sourceChatId != null && typeof action.sourceChatId !== 'string') return false;
  if (action.targetChatName != null && typeof action.targetChatName !== 'string') return false;
  return true;
}

function presentationState(raw: string): ChatQueueActionPresentationState {
  if (raw === 'queued') return 'queued';
  if (raw === 'failed' || raw === 'stopped') return 'failed';
  if (raw === 'sent' || raw === 'completed') return 'completed';
  return 'running';
}

export function resolveChatQueueActionPresentation(
  action: unknown,
  rawState: string,
): ChatQueueActionPresentation | null {
  if (!isSendInNewChatQueueAction(action)) return null;
  const state = presentationState(
    String(rawState ?? '')
      .trim()
      .toLowerCase(),
  );
  return {
    kind: action.type,
    state,
    label:
      state === 'failed'
        ? 'New chat failed'
        : state === 'running'
          ? 'Creating new chat'
          : state === 'completed'
            ? 'New chat created'
            : 'New chat queued',
    queuedDescription: 'Runs after earlier work finishes',
    canCancel: state === 'queued',
    canExecuteNow: state === 'queued',
    countsAsAgentRun: false,
  };
}

export function allocateUntitledChatName(names: Iterable<string>): string {
  const usedNumbers = new Set<number>();
  for (const raw of names) {
    const match = String(raw ?? '')
      .trim()
      .match(/^untitled\s+(\d+)$/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value >= 1) usedNumbers.add(value);
  }
  for (let value = 1; value <= 9999; value += 1) {
    if (!usedNumbers.has(value)) return `Untitled ${value}`;
  }
  return `Untitled ${Date.now().toString(36)}`;
}
