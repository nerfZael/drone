export type BuiltinAgentId = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';

export type ChatAgentConfig =
  | { kind: 'native' }
  | { kind: 'builtin'; id: BuiltinAgentId }
  | { kind: 'custom'; id: string; label: string; command: string };

export type AgentPermissionMode = 'full-access' | 'read-only';

export type PromptAutomationStopMode = 'all' | 'runs-only';
