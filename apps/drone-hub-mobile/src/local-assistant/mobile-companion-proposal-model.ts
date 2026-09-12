import {
  companionProposalOperationDetails,
  formatModelDisplayLabel,
  formatReasoningLabel,
  type CompanionProposal,
  type CompanionProposalExecution,
  type CompanionProposalExecutionItem,
  type CompanionProposalOperation,
  type CompanionProposalOperationDetail,
} from '@drone/assistant-chat';

export type MobileProposalActionKind = 'create' | 'delete' | 'clone' | 'rename' | 'message';
export type MobileProposalPillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** A headline fragment: plain connective text, or a name shown in the stronger foreground. */
export type MobileProposalHeadlinePart = { text: string; name?: boolean };

export type MobileProposalHeadline = {
  kind: MobileProposalActionKind;
  action: string;
  parts: MobileProposalHeadlinePart[];
};

type CreateDroneOperation = Extract<CompanionProposalOperation, { type: 'create_drone' }>;

const BUILTIN_AGENT_LABELS: Readonly<Record<string, string>> = {
  native: 'Built-in',
  'builtin:cursor': 'Cursor Agent',
  'builtin:codex': 'Codex',
  'builtin:claude': 'Claude Code',
  'builtin:opencode': 'OpenCode',
  'builtin:pi': 'Pi',
  'builtin:blip': 'Blip',
};

export function agentDisplayLabel(agent: string | undefined): string {
  if (!agent) return '';
  return BUILTIN_AGENT_LABELS[agent] ?? agent.replace(/^custom:/, '');
}

function runtimeLabel(value: string): string {
  if (value === 'container') return 'Container';
  if (value === 'host') return 'Host';
  return value;
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

const name = (text: string): MobileProposalHeadlinePart => ({ text, name: true });
const plain = (text: string): MobileProposalHeadlinePart => ({ text });

/** Operation headline: a fixed, colored action verb followed by what it applies to. Mirrors desktop. */
export function mobileProposalHeadline(
  operation: CompanionProposalOperation,
  droneLabel: (droneId: string) => string,
): MobileProposalHeadline {
  const drone = 'droneId' in operation ? droneLabel(operation.droneId) : '';
  switch (operation.type) {
    case 'create_group':
      return { kind: 'create', action: 'Create group', parts: [name(operation.name)] };
    case 'delete_group':
      return { kind: 'delete', action: 'Delete group', parts: [name(operation.name), plain(' and its contents')] };
    case 'rename_group':
      return { kind: 'rename', action: 'Rename group', parts: [name(operation.name), plain(' to '), name(operation.newName)] };
    case 'create_drone':
      return {
        kind: 'create',
        action: operation.draft ? 'Create draft drone' : 'Create drone',
        parts: operation.name ? [name(operation.name)] : [],
      };
    case 'clone_drone':
      return { kind: 'clone', action: 'Clone drone', parts: [name(droneLabel(operation.sourceDroneId)), plain(' as '), name(operation.name)] };
    case 'delete_drone':
      return { kind: 'delete', action: 'Delete drone', parts: [name(drone)] };
    case 'rename_drone':
      return { kind: 'rename', action: 'Rename drone', parts: [name(drone), plain(' to '), name(operation.newName)] };
    case 'create_chat':
      return {
        kind: 'create',
        action: operation.draft ? 'Create draft chat' : 'Create chat',
        parts: [name(operation.chatName), plain(' in '), name(drone)],
      };
    case 'clone_chat':
      return {
        kind: 'clone',
        action: operation.sideChat ? 'Fork as side chat' : 'Clone chat',
        parts: [name(operation.sourceChat), plain(' as '), name(operation.chatName), plain(' in '), name(drone)],
      };
    case 'delete_chat':
      return { kind: 'delete', action: 'Delete chat', parts: [name(operation.chatName), plain(' from '), name(drone)] };
    case 'rename_chat':
      return { kind: 'rename', action: 'Rename chat', parts: [name(operation.chatName), plain(' to '), name(operation.newName)] };
    case 'create_chat_group':
      return {
        kind: 'create',
        action: 'Create chat group',
        parts: [name([operation.parentGroup, operation.group].filter(Boolean).join('/')), plain(' in '), name(drone)],
      };
    case 'rename_chat_group':
      return {
        kind: 'rename',
        action: 'Rename chat group',
        parts: [name(operation.group), plain(' to '), name(operation.newName), plain(' in '), name(drone)],
      };
    case 'delete_chat_group':
      return { kind: 'delete', action: 'Delete chat group', parts: [name(operation.group), plain(' in '), name(drone), plain(', keeping its chats')] };
    case 'set_drone_group':
      return { kind: 'rename', action: 'Move drone', parts: [name(drone), plain(' to '), name(operation.group || 'Ungrouped')] };
    case 'move_chats':
      return { kind: 'rename', action: 'Move chats', parts: [plain(' in '), name(drone), plain(' to '), name(operation.targetGroup || 'Root')] };
    case 'send_message':
      return { kind: 'message', action: 'Send message', parts: [plain(' to '), name(drone)] };
  }
}

export function mobileProposalLocation(
  operation: CreateDroneOperation,
  defaultRepoPath: string,
): { repository: string; groupPath: string } {
  const repoPath = operation.repoPath ?? defaultRepoPath;
  const repository = repoPath.split(/[\\/]/).filter(Boolean).pop() || 'No repository';
  const group = operation.group || '';
  return {
    repository,
    groupPath: repository === 'No repository'
      ? group || repository
      : [repository, group].filter(Boolean).join(' / '),
  };
}

export type MobileProposalPill = { key: string; label: string; tone: MobileProposalPillTone };

/**
 * Creation settings the proposal sets explicitly. The phone has no synchronous view of the
 * Hub's saved defaults, so inherited values stay out of the pills and read "Saved default" in details.
 */
export function mobileProposalCreationPills(operation: CreateDroneOperation): MobileProposalPill[] {
  const pills: MobileProposalPill[] = [];
  if (operation.runtime) pills.push({ key: 'runtime', label: runtimeLabel(operation.runtime), tone: 'neutral' });
  if (operation.agent) pills.push({ key: 'agent', label: agentDisplayLabel(operation.agent), tone: 'accent' });
  if (operation.model) {
    const reasoning = operation.reasoning ? formatReasoningLabel(operation.reasoning) || operation.reasoning : '';
    pills.push({
      key: 'model',
      label: `${formatModelDisplayLabel(operation.model)}${reasoning ? ` · ${reasoning}` : ''}`,
      tone: 'info',
    });
  }
  return pills;
}

const SAVED_DEFAULT = 'Saved default';

/** Detail rows for a create_drone step: explicit values, or "Saved default" for inherited ones. */
export function mobileProposalCreationDetailRows(
  operation: CreateDroneOperation,
  defaultRepoPath: string,
): CompanionProposalOperationDetail[] {
  const location = mobileProposalLocation(operation, defaultRepoPath);
  const branchSource = operation.repoBranchSource || (operation.remoteBranch ? 'remote' : undefined);
  const explicit = (value: string | undefined, format: (value: string) => string = (v) => v) =>
    value ? format(value) : SAVED_DEFAULT;
  const rows: Array<[string, string | null]> = [
    ['Repository', location.repository],
    ['Group', operation.group || null],
    ['Runtime', explicit(operation.runtime, runtimeLabel)],
    ['Persist volume', operation.persistVolume === undefined ? SAVED_DEFAULT : operation.persistVolume ? 'On' : 'Off'],
    ['Branch source', explicit(branchSource, capitalize)],
    ['Remote branch', operation.remoteBranch ?? null],
    ['Agent', explicit(operation.agent, agentDisplayLabel)],
    ['Provider', operation.provider ?? null],
    ['Model', explicit(operation.model, formatModelDisplayLabel)],
    ['Reasoning', explicit(operation.reasoning, (v) => formatReasoningLabel(v) || v)],
    ['Agent permissions', explicit(operation.agentPermissionMode, capitalize)],
    ['Approval policy', explicit(operation.approvalPolicy, capitalize)],
  ];
  return rows.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}

/** Review rows for any operation; messages carry no rows because the body is shown inline. */
export function mobileProposalOperationDetailRows(
  operation: CompanionProposalOperation,
  defaultRepoPath: string,
): CompanionProposalOperationDetail[] {
  if (operation.type === 'create_drone') return mobileProposalCreationDetailRows(operation, defaultRepoPath);
  if (operation.type === 'send_message') return [];
  return companionProposalOperationDetails(operation, defaultRepoPath);
}

export function mobileProposalStatus(
  execution: CompanionProposalExecution | null,
): { tone: 'success' | 'warning' | 'danger'; label: string } | null {
  if (!execution) return null;
  if (execution.ok) return { tone: 'success', label: 'Applied' };
  const completed = execution.operations.filter((item) => item.status === 'completed').length;
  if (completed > 0) return { tone: 'warning', label: 'Partially applied' };
  return { tone: 'danger', label: 'Apply failed' };
}

export function mobileProposalApplyLabel(executing: boolean, execution: CompanionProposalExecution | null): string {
  if (executing) return 'Applying…';
  if (execution?.ok) return 'Applied';
  if (execution) return 'Discard to retry';
  return 'Apply proposal';
}

/** Resolves `$id` references to the step that creates the drone, then falls back to known names. */
export function mobileProposalDroneLabel(
  proposal: CompanionProposal,
  droneId: string,
  resolveDroneName: (droneId: string) => string | null,
): string {
  if (droneId.startsWith('$')) {
    const created = proposal.operations.find(
      (operation) =>
        (operation.type === 'create_drone' || operation.type === 'clone_drone') &&
        operation.id === droneId.slice(1),
    );
    if (created?.type === 'create_drone') return created.name || 'New drone';
    if (created?.type === 'clone_drone') return created.name;
  }
  return resolveDroneName(droneId) || droneId;
}

/** 1-based step number of the create/clone operation an `$id` drone reference points at. */
export function mobileProposalCreatedInStep(proposal: CompanionProposal, droneId: string): number | null {
  if (!droneId.startsWith('$')) return null;
  const index = proposal.operations.findIndex((operation) => operation.id === droneId.slice(1));
  return index === -1 ? null : index + 1;
}

export function mobileProposalOutcomeText(outcome: CompanionProposalExecutionItem): string {
  if (outcome.status === 'completed') return 'Applied';
  if (outcome.status === 'skipped') return 'Not run';
  return outcome.error || 'Failed';
}
