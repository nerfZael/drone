export const COMPANION_PROPOSAL_VERSION = 1 as const;
export const COMPANION_PROPOSAL_PATH = 'companion-proposal.json';
export const COMPANION_PROPOSAL_TARGET_ID = 'companion-proposal';
export const COMPANION_PROPOSAL_MAX_CHARS = 200_000;
export const COMPANION_PROPOSAL_MAX_OPERATIONS = 100;

type CompanionProposalOperationBase = {
  id: string;
};

export type CompanionProposalChatOverrides = {
  /** Existing Drone Hub agent key, for example native, builtin:codex, or custom:my-agent. */
  agent?: string;
  provider?: 'openai' | 'codex' | 'gemini' | 'openrouter';
  model?: string;
  reasoning?: string;
  agentPermissionMode?: 'read' | 'write' | 'execute';
  approvalPolicy?: 'ask' | 'auto' | 'none';
};

type CompanionProposalCreateOverrides = CompanionProposalChatOverrides & {
  runtime?: 'container' | 'host';
  persistVolume?: boolean;
  repoBranchSource?: 'host' | 'remote';
  remoteBranch?: string;
};

export type CompanionProposalOperation =
  | (CompanionProposalOperationBase & {
      type: 'create_group';
      name: string;
      repoPath?: string;
    })
  | (CompanionProposalOperationBase & {
      type: 'delete_group';
      name: string;
      repoPath?: string;
    })
  | (CompanionProposalOperationBase & {
      type: 'rename_group';
      name: string;
      newName: string;
      repoPath?: string;
    })
  | (CompanionProposalOperationBase & CompanionProposalCreateOverrides & {
      type: 'create_drone';
      name?: string;
      prompt: string;
      repoPath?: string;
      group?: string;
      draft?: boolean;
    })
  | (CompanionProposalOperationBase & {
      type: 'clone_drone';
      sourceDroneId: string;
      name: string;
      repoPath?: string;
      group?: string;
      cloneChats?: boolean;
    })
  | (CompanionProposalOperationBase & {
      type: 'delete_drone';
      droneId: string;
    })
  | (CompanionProposalOperationBase & {
      type: 'rename_drone';
      droneId: string;
      newName: string;
    })
  | (CompanionProposalOperationBase & CompanionProposalChatOverrides & {
      type: 'create_chat';
      droneId: string;
      chatName: string;
      copyFromChat?: string;
      draft?: boolean;
    })
  | (CompanionProposalOperationBase & {
      type: 'clone_chat';
      droneId: string;
      sourceChat: string;
      chatName: string;
      draft?: boolean;
    })
  | (CompanionProposalOperationBase & {
      type: 'delete_chat';
      droneId: string;
      chatName: string;
    })
  | (CompanionProposalOperationBase & {
      type: 'rename_chat';
      droneId: string;
      chatName: string;
      newName: string;
    })
  | (CompanionProposalOperationBase & {
      type: 'send_message';
      droneId: string;
      chatName?: string;
      message: string;
      delivery?: 'asap' | 'queue';
    });

export type CompanionProposal = {
  version: typeof COMPANION_PROPOSAL_VERSION;
  title: string;
  summary?: string;
  operations: CompanionProposalOperation[];
};

export type CompanionProposalExecutionItem = {
  id: string;
  type: CompanionProposalOperation['type'];
  status: 'completed' | 'failed' | 'skipped';
  result?: Record<string, unknown>;
  error?: string;
};

export type CompanionProposalExecution = {
  ok: boolean;
  operations: CompanionProposalExecutionItem[];
};

export type CompanionProposalExecutionProgress = {
  activeOperationId: string | null;
  operations: CompanionProposalExecutionItem[];
};

export type CompanionProposalExecutionOptions = {
  onProgress?(progress: CompanionProposalExecutionProgress): void;
};

export type CompanionProposalExecutionContext = {
  /** Repository captured when the proposal document was first created. */
  defaultRepoPath: string;
};

export type CompanionProposalOperationDetail = {
  label: string;
  value: string;
};

type CompanionProposalActionResult = Record<string, unknown> | void;

export type CompanionProposalExecutor = {
  createGroup(operation: Extract<CompanionProposalOperation, { type: 'create_group' }>): Promise<CompanionProposalActionResult>;
  deleteGroup(operation: Extract<CompanionProposalOperation, { type: 'delete_group' }>): Promise<CompanionProposalActionResult>;
  renameGroup(operation: Extract<CompanionProposalOperation, { type: 'rename_group' }>): Promise<CompanionProposalActionResult>;
  createDrone(operation: Extract<CompanionProposalOperation, { type: 'create_drone' }>): Promise<{ droneId: string; droneName?: string }>;
  cloneDrone(operation: Extract<CompanionProposalOperation, { type: 'clone_drone' }>): Promise<{ droneId: string; droneName?: string }>;
  deleteDrone(operation: Extract<CompanionProposalOperation, { type: 'delete_drone' }>): Promise<CompanionProposalActionResult>;
  renameDrone(operation: Extract<CompanionProposalOperation, { type: 'rename_drone' }>): Promise<CompanionProposalActionResult>;
  createChat(operation: Extract<CompanionProposalOperation, { type: 'create_chat' }>): Promise<CompanionProposalActionResult>;
  cloneChat(operation: Extract<CompanionProposalOperation, { type: 'clone_chat' }>): Promise<CompanionProposalActionResult>;
  deleteChat(operation: Extract<CompanionProposalOperation, { type: 'delete_chat' }>): Promise<CompanionProposalActionResult>;
  renameChat(operation: Extract<CompanionProposalOperation, { type: 'rename_chat' }>): Promise<CompanionProposalActionResult>;
  sendMessage(operation: Extract<CompanionProposalOperation, { type: 'send_message' }>): Promise<CompanionProposalActionResult>;
};

export const EMPTY_COMPANION_PROPOSAL: CompanionProposal = {
  version: COMPANION_PROPOSAL_VERSION,
  title: 'Drone Hub changes',
  summary: '',
  operations: [],
};

/**
 * Kept out of the tool schema so the provider only sees a small read/patch
 * interface. The full document is validated after every patch.
 */
export const COMPANION_PROPOSAL_FORMAT = [
  'Edit the returned JSON document. It has { version: 1, title, summary?, operations }. Operation ids must be unique.',
  'Supported operations:',
  '- create_group: { id, type, name, repoPath? }',
  '- delete_group: { id, type, name, repoPath? }',
  '- rename_group: { id, type, name, newName, repoPath? }',
  '- create_drone: { id, type, name?, prompt, repoPath?, group?, draft?, runtime?, persistVolume?, repoBranchSource?, remoteBranch?, agent?, provider?, model?, reasoning?, agentPermissionMode?, approvalPolicy? }',
  '- clone_drone: { id, type, sourceDroneId, name, repoPath?, group?, cloneChats? } (container drones only)',
  '- delete_drone: { id, type, droneId }',
  '- rename_drone: { id, type, droneId, newName }',
  '- create_chat: { id, type, droneId, chatName, copyFromChat?, draft? }',
  '  create_chat also accepts optional agent, provider, model, reasoning, agentPermissionMode, and approvalPolicy overrides. copyFromChat copies configuration only.',
  '- clone_chat: { id, type, droneId, sourceChat, chatName, draft? } (clones history and configuration)',
  'Agent overrides use "native", "builtin:cursor", "builtin:codex", "builtin:claude", "builtin:opencode", "builtin:pi", "builtin:blip", or an existing "custom:<id>" agent. Custom agents are unavailable on mobile and host runtime targets.',
  'Provider is openai, codex, gemini, or openrouter and only applies to the native agent. agentPermissionMode is read, write, or execute. approvalPolicy is ask, auto, or none. Unsupported agent combinations fail validation during Apply.',
  '- delete_chat: { id, type, droneId, chatName } (the default chat cannot be deleted)',
  '- rename_chat: { id, type, droneId, chatName, newName } (the default chat cannot be renamed)',
  '- send_message: { id, type, droneId, chatName?, message, delivery?: "asap" | "queue" }',
  'A later operation may target a drone created or cloned earlier in the document with droneId "$<operation id>".',
  'Operations run top-to-bottom and stop after the first failure. Omit repoPath to use the repository captured when this proposal was first created, except clone_drone, which keeps the source repository and group when they are omitted. Use an empty clone_drone group to make the clone ungrouped. Omit chatName to use "default" where it is optional.',
  'Any Apply attempt is terminal for this proposal. The user must discard it before creating a fresh proposal; completed operations are never replayed.',
].join('\n');

export function serializeCompanionProposal(proposal: CompanionProposal): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}

export function parseCompanionProposalText(text: string): CompanionProposal {
  if (typeof text !== 'string' || text.length > COMPANION_PROPOSAL_MAX_CHARS) {
    throw new Error('PROPOSAL_TOO_LARGE');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`INVALID_PROPOSAL_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateCompanionProposal(value);
}

export function validateCompanionProposal(value: unknown): CompanionProposal {
  const proposal = record(value, 'proposal');
  exactKeys(proposal, ['version', 'title', 'summary', 'operations'], 'proposal');
  if (proposal.version !== COMPANION_PROPOSAL_VERSION) {
    throw new Error(`proposal.version must be ${COMPANION_PROPOSAL_VERSION}`);
  }
  const title = requiredText(proposal.title, 'proposal.title', 120);
  const summary = optionalText(proposal.summary, 'proposal.summary', 2_000);
  if (!Array.isArray(proposal.operations)) throw new Error('proposal.operations must be an array');
  if (proposal.operations.length > COMPANION_PROPOSAL_MAX_OPERATIONS) {
    throw new Error(`proposal.operations cannot exceed ${COMPANION_PROPOSAL_MAX_OPERATIONS} items`);
  }

  const ids = new Set<string>();
  const createdDroneIds = new Set<string>();
  const operations = proposal.operations.map((raw, index) => {
    const path = `proposal.operations[${index}]`;
    const operation = validateOperation(raw, path);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(operation.id)) {
      throw new Error(`${path}.id must start with a letter and contain only letters, numbers, _ or -`);
    }
    if (ids.has(operation.id)) throw new Error(`${path}.id must be unique`);
    if ('droneId' in operation && operation.droneId.startsWith('$')) {
      const reference = operation.droneId.slice(1);
      if (!createdDroneIds.has(reference)) {
        throw new Error(
          `${path}.droneId references an earlier create_drone or clone_drone operation that does not exist`,
        );
      }
    }
    ids.add(operation.id);
    if (operation.type === 'create_drone' || operation.type === 'clone_drone') {
      createdDroneIds.add(operation.id);
    }
    return operation;
  });

  return {
    version: COMPANION_PROPOSAL_VERSION,
    title,
    ...(summary === undefined ? {} : { summary }),
    operations,
  };
}

export function companionProposalOperationLabel(
  operation: CompanionProposalOperation,
  resolvedDroneName = '',
): string {
  const drone = 'droneId' in operation
    ? resolvedDroneName.trim() || operation.droneId
    : '';
  switch (operation.type) {
    case 'create_group': return `Create group “${operation.name}”`;
    case 'delete_group': return `Delete group “${operation.name}” and its contents`;
    case 'rename_group': return `Rename group “${operation.name}” to “${operation.newName}”`;
    case 'create_drone': return `${operation.draft ? 'Create draft drone' : 'Create drone'}${operation.name ? ` “${operation.name}”` : ''}`;
    case 'clone_drone': return `Clone drone ${operation.sourceDroneId} as “${operation.name}”`;
    case 'delete_drone': return `Delete drone ${drone}`;
    case 'rename_drone': return `Rename drone ${drone} to “${operation.newName}”`;
    case 'create_chat': return `Create ${operation.draft ? 'draft ' : ''}chat “${operation.chatName}” in ${drone}`;
    case 'clone_chat': return `Clone chat “${operation.sourceChat}” as “${operation.chatName}” in ${drone}`;
    case 'delete_chat': return `Delete chat “${operation.chatName}” from ${drone}`;
    case 'rename_chat': return `Rename chat “${operation.chatName}” to “${operation.newName}”`;
    case 'send_message': return `${operation.delivery === 'asap' ? 'Send' : 'Queue'} message to ${drone} / ${operation.chatName ?? 'default'}`;
  }
}

export function companionProposalOperationDetails(
  operation: CompanionProposalOperation,
  defaultRepoPath = '',
): CompanionProposalOperationDetail[] {
  const repo = (repoPath: string | undefined): CompanionProposalOperationDetail => ({
    label: 'Repository',
    value: (repoPath ?? defaultRepoPath) || 'No repository',
  });
  const overrides = (
    operation: CompanionProposalChatOverrides,
    fallback: string,
  ): CompanionProposalOperationDetail[] => [
    { label: 'Agent', value: operation.agent || fallback },
    { label: 'Provider', value: operation.provider || fallback },
    { label: 'Model', value: operation.model || fallback },
    { label: 'Reasoning', value: operation.reasoning || fallback },
    { label: 'Agent permissions', value: operation.agentPermissionMode || fallback },
    { label: 'Approval policy', value: operation.approvalPolicy || fallback },
  ];
  switch (operation.type) {
    case 'create_group':
    case 'delete_group':
      return [repo(operation.repoPath)];
    case 'rename_group':
      return [repo(operation.repoPath)];
    case 'create_drone':
      return [
        repo(operation.repoPath),
        { label: 'Group', value: operation.group || 'Ungrouped' },
        { label: 'Runtime', value: operation.runtime || 'Saved default' },
        {
          label: 'Persist volume',
          value: operation.persistVolume === undefined
            ? 'Saved default'
            : operation.persistVolume ? 'On' : 'Off',
        },
        {
          label: 'Branch source',
          value:
            operation.repoBranchSource || (operation.remoteBranch ? 'remote' : 'Saved default'),
        },
        ...(operation.remoteBranch
          ? [{ label: 'Remote branch', value: operation.remoteBranch }]
          : []),
        ...overrides(operation, 'Saved default'),
        { label: 'Initial prompt', value: operation.prompt },
      ];
    case 'clone_drone':
      return [
        { label: 'Source drone', value: operation.sourceDroneId },
        {
          label: 'Repository',
          value: operation.repoPath === undefined
            ? 'Source drone repository'
            : operation.repoPath || 'No repository',
        },
        {
          label: 'Group',
          value: operation.group === undefined
            ? 'Source drone group'
            : operation.group || 'Ungrouped',
        },
        { label: 'Clone chats', value: operation.cloneChats === false ? 'No' : 'Yes' },
      ];
    case 'create_chat':
      return [
        ...(operation.copyFromChat
          ? [{ label: 'Copy settings from', value: operation.copyFromChat }]
          : []),
        ...overrides(
          operation,
          operation.copyFromChat ? 'Copied from source chat' : 'Drone default',
        ),
      ];
    case 'clone_chat':
      return [{ label: 'Clone history from', value: operation.sourceChat }];
    case 'send_message':
      return [{ label: 'Message', value: operation.message }];
    case 'delete_drone':
    case 'rename_drone':
    case 'delete_chat':
    case 'rename_chat':
      return [];
  }
}

/** Execute a validated proposal in order, resolving $create-op drone references. */
export async function executeCompanionProposal(
  rawProposal: CompanionProposal,
  executor: CompanionProposalExecutor,
  options: CompanionProposalExecutionOptions = {},
): Promise<CompanionProposalExecution> {
  const proposal = validateCompanionProposal(rawProposal);
  const createdDrones = new Map<string, string>();
  const results: CompanionProposalExecution['operations'] = [];
  let failed = false;
  const reportProgress = (activeOperationId: string | null) => {
    options.onProgress?.({ activeOperationId, operations: [...results] });
  };

  for (const rawOperation of proposal.operations) {
    if (failed) {
      results.push({ id: rawOperation.id, type: rawOperation.type, status: 'skipped' });
      reportProgress(null);
      continue;
    }
    reportProgress(rawOperation.id);
    const operation = resolveDroneReference(rawOperation, createdDrones);
    try {
      let result: CompanionProposalActionResult;
      switch (operation.type) {
        case 'create_group': result = await executor.createGroup(operation); break;
        case 'delete_group': result = await executor.deleteGroup(operation); break;
        case 'rename_group': result = await executor.renameGroup(operation); break;
        case 'create_drone': {
          result = await executor.createDrone(operation);
          const droneId = String(result?.droneId ?? '').trim();
          if (!droneId) throw new Error('create_drone did not return a drone id');
          createdDrones.set(operation.id, droneId);
          break;
        }
        case 'clone_drone': {
          result = await executor.cloneDrone(operation);
          const droneId = String(result?.droneId ?? '').trim();
          if (!droneId) throw new Error('clone_drone did not return a drone id');
          createdDrones.set(operation.id, droneId);
          break;
        }
        case 'delete_drone': result = await executor.deleteDrone(operation); break;
        case 'rename_drone': result = await executor.renameDrone(operation); break;
        case 'create_chat': result = await executor.createChat(operation); break;
        case 'clone_chat': result = await executor.cloneChat(operation); break;
        case 'delete_chat': result = await executor.deleteChat(operation); break;
        case 'rename_chat': result = await executor.renameChat(operation); break;
        case 'send_message': result = await executor.sendMessage(operation); break;
      }
      results.push({
        id: operation.id,
        type: operation.type,
        status: 'completed',
        ...(result ? { result } : {}),
      });
      reportProgress(null);
    } catch (error) {
      failed = true;
      results.push({
        id: operation.id,
        type: operation.type,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      reportProgress(null);
    }
  }

  return { ok: !failed, operations: results };
}

function resolveDroneReference(
  operation: CompanionProposalOperation,
  createdDrones: Map<string, string>,
): CompanionProposalOperation {
  if (!('droneId' in operation) || !operation.droneId.startsWith('$')) return operation;
  const reference = operation.droneId.slice(1);
  const droneId = createdDrones.get(reference);
  if (!droneId) throw new Error(`created drone reference is unavailable: ${operation.droneId}`);
  return { ...operation, droneId };
}

function validateOperation(value: unknown, path: string): CompanionProposalOperation {
  const operation = record(value, path);
  const type = requiredSingleLineText(operation.type, `${path}.type`, 64);
  const id = requiredSingleLineText(operation.id, `${path}.id`, 64);
  if (type === 'create_group' || type === 'delete_group') {
    exactKeys(operation, ['id', 'type', 'name', 'repoPath'], path);
    return {
      id,
      type,
      name: requiredSingleLineText(operation.name, `${path}.name`, 64),
      ...optionalField(operation, 'repoPath', path, 4_096),
    };
  }
  if (type === 'rename_group') {
    exactKeys(operation, ['id', 'type', 'name', 'newName', 'repoPath'], path);
    return {
      id,
      type,
      name: requiredSingleLineText(operation.name, `${path}.name`, 64),
      newName: requiredSingleLineText(operation.newName, `${path}.newName`, 64),
      ...optionalField(operation, 'repoPath', path, 4_096),
    };
  }
  if (type === 'create_drone') {
    exactKeys(operation, [
      'id', 'type', 'name', 'prompt', 'repoPath', 'group', 'draft', 'runtime',
      'persistVolume', 'repoBranchSource', 'remoteBranch', 'agent', 'provider', 'model',
      'reasoning', 'agentPermissionMode', 'approvalPolicy',
    ], path);
    const createOverrides = validateCreateOverrides(operation, path);
    return {
      id,
      type,
      ...optionalNonEmptyField(operation, 'name', path, 80),
      prompt: requiredText(operation.prompt, `${path}.prompt`, 100_000),
      ...optionalField(operation, 'repoPath', path, 4_096),
      ...optionalField(operation, 'group', path, 64),
      ...optionalBooleanField(operation, 'draft', path),
      ...createOverrides,
    };
  }
  if (type === 'clone_drone') {
    exactKeys(operation, [
      'id', 'type', 'sourceDroneId', 'name', 'repoPath', 'group', 'cloneChats',
    ], path);
    return {
      id,
      type,
      sourceDroneId: requiredSingleLineText(
        operation.sourceDroneId,
        `${path}.sourceDroneId`,
        256,
      ),
      name: requiredSingleLineText(operation.name, `${path}.name`, 80),
      ...optionalField(operation, 'repoPath', path, 4_096),
      ...optionalField(operation, 'group', path, 64),
      ...optionalBooleanField(operation, 'cloneChats', path),
    };
  }
  if (type === 'delete_drone') {
    exactKeys(operation, ['id', 'type', 'droneId'], path);
    return { id, type, droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256) };
  }
  if (type === 'rename_drone') {
    exactKeys(operation, ['id', 'type', 'droneId', 'newName'], path);
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      newName: requiredSingleLineText(operation.newName, `${path}.newName`, 80),
    };
  }
  if (type === 'create_chat') {
    exactKeys(operation, [
      'id', 'type', 'droneId', 'chatName', 'copyFromChat', 'draft', 'agent', 'provider',
      'model', 'reasoning', 'agentPermissionMode', 'approvalPolicy',
    ], path);
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      chatName: requiredSingleLineText(operation.chatName, `${path}.chatName`, 160),
      ...optionalNonEmptyField(operation, 'copyFromChat', path, 160),
      ...optionalBooleanField(operation, 'draft', path),
      ...validateChatOverrides(operation, path),
    };
  }
  if (type === 'clone_chat') {
    exactKeys(operation, ['id', 'type', 'droneId', 'sourceChat', 'chatName', 'draft'], path);
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      sourceChat: requiredSingleLineText(operation.sourceChat, `${path}.sourceChat`, 160),
      chatName: requiredSingleLineText(operation.chatName, `${path}.chatName`, 160),
      ...optionalBooleanField(operation, 'draft', path),
    };
  }
  if (type === 'delete_chat') {
    exactKeys(operation, ['id', 'type', 'droneId', 'chatName'], path);
    const chatName = requiredSingleLineText(operation.chatName, `${path}.chatName`, 160);
    if (chatName === 'default') throw new Error(`${path}.chatName cannot be the default chat`);
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      chatName,
    };
  }
  if (type === 'rename_chat') {
    exactKeys(operation, ['id', 'type', 'droneId', 'chatName', 'newName'], path);
    const chatName = requiredSingleLineText(operation.chatName, `${path}.chatName`, 160);
    if (chatName === 'default') throw new Error(`${path}.chatName cannot be the default chat`);
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      chatName,
      newName: requiredSingleLineText(operation.newName, `${path}.newName`, 160),
    };
  }
  if (type === 'send_message') {
    exactKeys(operation, ['id', 'type', 'droneId', 'chatName', 'message', 'delivery'], path);
    const delivery = optionalText(operation.delivery, `${path}.delivery`, 16);
    if (delivery !== undefined && delivery !== 'asap' && delivery !== 'queue') {
      throw new Error(`${path}.delivery must be "asap" or "queue"`);
    }
    return {
      id,
      type,
      droneId: requiredSingleLineText(operation.droneId, `${path}.droneId`, 256),
      ...optionalNonEmptyField(operation, 'chatName', path, 160),
      message: requiredText(operation.message, `${path}.message`, 100_000),
      ...(delivery === undefined ? {} : { delivery }),
    };
  }
  throw new Error(`${path}.type is not supported: ${type}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown field: ${unknown[0]}`);
}

function requiredText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  const text = value.trim();
  if (!text) throw new Error(`${path} cannot be empty`);
  if (value.length > maxLength) throw new Error(`${path} cannot exceed ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${path} contains invalid control characters`);
  }
  return text;
}

function requiredSingleLineText(value: unknown, path: string, maxLength: number): string {
  const text = requiredText(value, path, maxLength);
  if (/[\r\n\t]/.test(text)) throw new Error(`${path} must be a single line`);
  return text;
}

function optionalText(value: unknown, path: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  if (value.length > maxLength) throw new Error(`${path} cannot exceed ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${path} contains invalid control characters`);
  }
  return value.trim();
}

function optionalField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  maxLength: number,
): Record<string, string> {
  const text = optionalText(value[key], `${path}.${key}`, maxLength);
  if (text === undefined) return {};
  if (/[\r\n\t]/.test(text)) throw new Error(`${path}.${key} must be a single line`);
  return { [key]: text };
}

function optionalNonEmptyField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  maxLength: number,
): Record<string, string> {
  const text = optionalText(value[key], `${path}.${key}`, maxLength);
  if (!text) return {};
  if (/[\r\n\t]/.test(text)) throw new Error(`${path}.${key} must be a single line`);
  return { [key]: text };
}

function optionalBooleanField(
  value: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, boolean> {
  const candidate = value[key];
  if (candidate === undefined) return {};
  if (typeof candidate !== 'boolean') throw new Error(`${path}.${key} must be a boolean`);
  return { [key]: candidate };
}

function optionalEnumField<const T extends string>(
  value: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): Record<string, T> {
  const candidate = value[key];
  if (candidate === undefined) return {};
  if (typeof candidate !== 'string' || !allowed.includes(candidate as T)) {
    throw new Error(`${path}.${key} must be one of: ${allowed.join(', ')}`);
  }
  return { [key]: candidate as T };
}

function validateChatOverrides(
  operation: Record<string, unknown>,
  path: string,
): CompanionProposalChatOverrides {
  const overrides: CompanionProposalChatOverrides = {
    ...optionalNonEmptyField(operation, 'agent', path, 200),
    ...optionalEnumField(operation, 'provider', path, ['openai', 'codex', 'gemini', 'openrouter'] as const),
    ...optionalNonEmptyField(operation, 'model', path, 200),
    ...optionalNonEmptyField(operation, 'reasoning', path, 200),
    ...optionalEnumField(
      operation,
      'agentPermissionMode',
      path,
      ['read', 'write', 'execute'] as const,
    ),
    ...optionalEnumField(
      operation,
      'approvalPolicy',
      path,
      ['ask', 'auto', 'none'] as const,
    ),
  };
  if (overrides.provider && overrides.agent && overrides.agent !== 'native') {
    throw new Error(`${path}.provider is only supported with agent "native"`);
  }
  return overrides;
}

function validateCreateOverrides(
  operation: Record<string, unknown>,
  path: string,
): CompanionProposalCreateOverrides {
  const overrides: CompanionProposalCreateOverrides = {
    ...optionalEnumField(operation, 'runtime', path, ['container', 'host'] as const),
    ...optionalBooleanField(operation, 'persistVolume', path),
    ...optionalEnumField(operation, 'repoBranchSource', path, ['host', 'remote'] as const),
    ...optionalNonEmptyField(operation, 'remoteBranch', path, 400),
    ...validateChatOverrides(operation, path),
  };
  if (overrides.repoBranchSource === 'host' && overrides.remoteBranch) {
    throw new Error(`${path}.remoteBranch cannot be used with repoBranchSource "host"`);
  }
  if (
    overrides.runtime === 'host' &&
    (overrides.persistVolume !== undefined ||
      overrides.repoBranchSource === 'remote' ||
      overrides.remoteBranch)
  ) {
    throw new Error(
      `${path} container volume and remote branch overrides require runtime "container"`,
    );
  }
  return overrides;
}
