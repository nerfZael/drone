import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from '../../domain';
import { agentAccessSupport } from '../app/agent-access-choice-groups';

/**
 * The agent, model, reasoning, and access new drones and chats on the canvas start with. The canvas keeps its own:
 * selecting a chat elsewhere never changes them, only the canvas composer's picker does.
 */
export type CanvasNewCardSettings = {
  agentKey: string;
  model: string;
  reasoning: string;
  permissionMode: AgentPermissionMode;
  approvalPolicy: AgentApprovalPolicy;
};

function permissionMode(value: unknown): AgentPermissionMode {
  return value === 'read' || value === 'write' ? value : 'execute';
}

function approvalPolicy(value: unknown): AgentApprovalPolicy {
  return value === 'auto' || value === 'none' ? value : 'ask';
}

export function normalizeCanvasNewCardSettings(value: unknown): CanvasNewCardSettings | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const agentKey = String(raw.agentKey ?? '').trim();
  if (!agentKey) return null;
  return {
    agentKey,
    model: String(raw.model ?? '').trim(),
    reasoning: String(raw.reasoning ?? '').trim(),
    permissionMode: permissionMode(raw.permissionMode),
    approvalPolicy: approvalPolicy(raw.approvalPolicy),
  };
}

/**
 * Settings for another agent: its model and reasoning start over, and access or approvals it cannot use fall back to
 * what it can.
 */
export function canvasSettingsForAgent(
  settings: CanvasNewCardSettings,
  agentKey: string,
  agent: ChatAgentConfig,
): CanvasNewCardSettings {
  if (agentKey === settings.agentKey) return settings;
  const support = agentAccessSupport(agent);
  return {
    agentKey,
    model: '',
    reasoning: '',
    permissionMode: support.readOnlySupported ? settings.permissionMode : 'execute',
    approvalPolicy: settings.approvalPolicy === 'auto' && !support.agentIsCodex ? 'ask' : settings.approvalPolicy,
  };
}
