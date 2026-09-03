export type GlobalDictationDestination =
  | 'current-chat'
  | 'root-drone'
  | 'group-drone'
  | 'new-chat'
  | 'clone-chat';

export type GlobalDictationTarget =
  | {
      destination: 'current-chat' | 'new-chat' | 'clone-chat';
      droneId: string;
      chatName: string;
      label: string;
    }
  | {
      destination: 'root-drone' | 'group-drone';
      repoPath: string;
      group: string;
      label: string;
    };

export type GlobalDictationTargetResult =
  | { ok: true; target: GlobalDictationTarget }
  | { ok: false; error: string };

export type GlobalDictationSendResult = { ok: true } | { ok: false; error: string };
