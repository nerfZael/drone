import type { ChatComposerRuntimeChoiceGroup } from '../chat';
import type { AgentApprovalPolicy, AgentPermissionMode } from '../../domain';

export function newDroneAccessLabel(value: AgentPermissionMode): string {
  if (value === 'read') return 'Read';
  if (value === 'write') return 'Write';
  return 'Execute';
}

export function newDroneApprovalLabel(value: AgentApprovalPolicy): string {
  if (value === 'ask') return 'Ask';
  if (value === 'auto') return 'Auto';
  return 'Never ask';
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
        { value: 'read', label: 'Read', title: 'Inspect files in a read-only sandbox.' },
        { value: 'write', label: 'Write', title: 'Write inside the workspace sandbox.' },
        { value: 'execute', label: 'Execute', title: 'Run with full command access.' },
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
        { value: 'ask', label: 'Ask', title: 'Ask before approval-gated commands.' },
        ...(opts.agentIsCodex
          ? [{ value: 'auto', label: 'Auto', title: 'Codex decides when confirmation is needed.' }]
          : []),
        {
          value: 'none',
          label: 'Never ask',
          title: 'Run within the selected sandbox without waiting for confirmation.',
        },
      ],
    });
  }
  return groups;
}
