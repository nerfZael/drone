type NativeChatRuntime = {
  cloneSession: (input: any) => Promise<void>;
  copyConfiguration: (input: any) => Promise<void>;
  deleteSessions: (droneEntry: any) => Promise<void>;
  error: (chatId: string) => Promise<string>;
  isBusy: (chatId: string) => Promise<boolean>;
  latestAssistantText: (chatId: string) => Promise<string>;
  prompt: (input: any) => Promise<void>;
  stop: (chatId: string) => Promise<void>;
};

type ResourceSubscriptionRuntime = {
  pauseForDrone: (droneId: string, chatIds: string[]) => Promise<void>;
  resumeForChat: (chatId: string) => Promise<void>;
  resumeForDrone: (droneId: string, chatIds: string[]) => Promise<void>;
};

export function createNativeChatRuntimePort() {
  let runtime: NativeChatRuntime | null = null;

  return {
    bind(next: NativeChatRuntime): () => void {
      if (runtime) throw new Error('native chat runtime is already bound');
      runtime = next;
      return () => {
        if (runtime === next) runtime = null;
      };
    },
    cloneSession: async (input: any) => await requireRuntime().cloneSession(input),
    copyConfiguration: async (input: any) => await requireRuntime().copyConfiguration(input),
    deleteSessions: async (droneEntry: any) => await requireRuntime().deleteSessions(droneEntry),
    error: (chatId: string) => runtime?.error(chatId) ?? Promise.resolve(''),
    isBusy: (chatId: string) => runtime?.isBusy(chatId) ?? Promise.resolve(false),
    latestAssistantText: (chatId: string) =>
      runtime?.latestAssistantText(chatId) ?? Promise.resolve(''),
    prompt: async (input: any) => await requireRuntime().prompt(input),
    stop: async (chatId: string) => await requireRuntime().stop(chatId),
  };

  function requireRuntime(): NativeChatRuntime {
    if (!runtime) throw new Error('native chat runtime is not ready');
    return runtime;
  }
}

export function createResourceSubscriptionRuntimePort() {
  let runtime: ResourceSubscriptionRuntime | null = null;

  return {
    bind(next: ResourceSubscriptionRuntime): () => void {
      if (runtime) throw new Error('resource subscription runtime is already bound');
      runtime = next;
      return () => {
        if (runtime === next) runtime = null;
      };
    },
    pauseForDrone: (droneId: string, chatIds: string[]) =>
      runtime?.pauseForDrone(droneId, chatIds) ?? Promise.resolve(),
    resumeForChat: (chatId: string) => runtime?.resumeForChat(chatId) ?? Promise.resolve(),
    resumeForDrone: (droneId: string, chatIds: string[]) =>
      runtime?.resumeForDrone(droneId, chatIds) ?? Promise.resolve(),
  };
}
