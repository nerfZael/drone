import { chatAgentSupportsReasoning, formatModelDisplayLabel, formatReasoningLabel } from '@drone/assistant-chat';
import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from '../../domain';
import { BUILTIN_AGENT_OPTIONS } from '../app/app-config';
import { newDroneAccessLabel, newDroneApprovalLabel } from '../app/agent-access-choice-groups';
import { repoPathLabel } from '../app/repo-path-label';

/** What a double-click on the canvas creates next: a drone on the global board, a chat on a drone's. */
export type NewCardDefaults = {
  kind: 'drone' | 'chat';
  agent: ChatAgentConfig;
  model?: string | null;
  reasoning?: string | null;
  permissionMode: AgentPermissionMode;
  approvalPolicy?: AgentApprovalPolicy | null;
  /** A new drone's runtime; a new chat runs where its drone does. */
  runtime?: 'container' | 'host' | null;
  repoPath?: string | null;
};

export function newCardAgentLabel(agent: ChatAgentConfig): string {
  if (agent.kind === 'custom') return agent.label || agent.id;
  return BUILTIN_AGENT_OPTIONS.find((option) => JSON.stringify(option.agent) === JSON.stringify(agent))?.label
    ?? (agent.kind === 'builtin' ? agent.id : 'Built-in');
}

function approvalsSupported(agent: ChatAgentConfig): boolean {
  return agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex');
}

/** The settings as short parts, in the order the composer shows them. */
export function describeNewCardDefaults(defaults: NewCardDefaults): string[] {
  const parts = [newCardAgentLabel(defaults.agent)];
  if (defaults.agent.kind !== 'custom') parts.push(formatModelDisplayLabel(defaults.model) || 'Default model');
  const reasoning = chatAgentSupportsReasoning(defaults.agent) ? formatReasoningLabel(defaults.reasoning) : '';
  if (reasoning) parts.push(reasoning);
  const access = newDroneAccessLabel(defaults.permissionMode);
  parts.push(approvalsSupported(defaults.agent) && defaults.approvalPolicy
    ? `${access} · ${newDroneApprovalLabel(defaults.approvalPolicy)}`
    : access);
  if (defaults.runtime) parts.push(defaults.runtime === 'host' ? 'Host' : 'Container');
  const repoPath = String(defaults.repoPath ?? '').trim();
  if (defaults.kind === 'drone') parts.push(repoPath ? repoPathLabel(repoPath) : 'No repo');
  return parts;
}
