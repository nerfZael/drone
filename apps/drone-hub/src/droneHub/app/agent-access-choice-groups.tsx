import React from 'react';
import type { ChatComposerRuntimeChoiceGroup } from '../chat';
import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from '../../domain';

/** Small line icons, the size of the picker's text, so access and approvals fit beside the model. */
function SettingIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ACCESS_ICONS = {
  // An eye: it only looks.
  read: <SettingIcon><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></SettingIcon>,
  // A pencil: it edits files.
  write: <SettingIcon><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></SettingIcon>,
  // A prompt: it runs commands.
  execute: <SettingIcon><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></SettingIcon>,
} satisfies Record<AgentPermissionMode, React.ReactNode>;

const APPROVAL_ICONS = {
  // A raised hand: it stops to ask.
  ask: <SettingIcon><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></SettingIcon>,
  // Sparkles: the agent decides.
  auto: <SettingIcon><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" /><path d="M19 17v4" /><path d="M17 19h4" /></SettingIcon>,
  // Fast-forward: it goes on without asking.
  none: <SettingIcon><path d="m13 19 9-7-9-7Z" /><path d="m2 19 9-7-9-7Z" /></SettingIcon>,
} satisfies Record<AgentApprovalPolicy, React.ReactNode>;

/** Which access and approval settings an agent honors. */
export function agentAccessSupport(agent: ChatAgentConfig): {
  readOnlySupported: boolean;
  approvalsSupported: boolean;
  agentIsCodex: boolean;
} {
  const agentIsCodex = agent.kind === 'builtin' && agent.id === 'codex';
  return {
    readOnlySupported: agent.kind === 'native' || agentIsCodex || (agent.kind === 'builtin' && agent.id === 'blip'),
    approvalsSupported: agent.kind === 'native' || agentIsCodex,
    agentIsCodex,
  };
}

/**
 * Access and approval settings for the composer's agent picker. An agent that
 * only runs with Execute access, or exposes no approvals, gets no group for it.
 */
export function agentAccessChoiceGroups(opts: {
  permissionMode: AgentPermissionMode;
  onPermissionModeChange: (value: AgentPermissionMode) => void;
  approvalPolicy: AgentApprovalPolicy;
  onApprovalPolicyChange: (value: AgentApprovalPolicy) => void;
  readOnlySupported: boolean;
  approvalsSupported: boolean;
  agentIsCodex: boolean;
  disabled?: boolean;
}): ChatComposerRuntimeChoiceGroup[] {
  const groups: ChatComposerRuntimeChoiceGroup[] = [];
  if (opts.readOnlySupported) {
    groups.push({
      id: 'access',
      title: 'Access',
      value: opts.permissionMode,
      disabled: opts.disabled,
      onValueChange: (value) => opts.onPermissionModeChange(value as AgentPermissionMode),
      options: [
        { value: 'read', label: 'Read', title: 'Inspect files in a read-only sandbox.', icon: ACCESS_ICONS.read },
        { value: 'write', label: 'Write', title: 'Write inside the workspace sandbox.', icon: ACCESS_ICONS.write },
        { value: 'execute', label: 'Execute', title: 'Run with full command access.', icon: ACCESS_ICONS.execute },
      ],
    });
  }
  if (opts.approvalsSupported) {
    groups.push({
      id: 'approvals',
      title: 'Approvals',
      value: opts.approvalPolicy,
      disabled: opts.disabled,
      onValueChange: (value) => opts.onApprovalPolicyChange(value as AgentApprovalPolicy),
      options: [
        { value: 'ask', label: 'Ask', title: 'Ask before approval-gated commands.', icon: APPROVAL_ICONS.ask },
        ...(opts.agentIsCodex
          ? [{ value: 'auto', label: 'Auto', title: 'Codex decides when confirmation is needed.', icon: APPROVAL_ICONS.auto }]
          : []),
        {
          value: 'none',
          label: 'Never ask',
          title: 'Run within the selected sandbox without waiting for confirmation.',
          icon: APPROVAL_ICONS.none,
        },
      ],
    });
  }
  return groups;
}
