export type HubWebTerminalMode = 'shell' | 'agent';

export function shouldAwaitTerminalSkillSync(mode: HubWebTerminalMode): boolean {
  return mode === 'agent';
}
