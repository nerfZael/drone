import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';
import type { AssistantMessage } from '@drone/assistant-chat';
import { normalizeAgentRunActivity, trimJsonArrayToBytes } from '../builtin-agent-activity';

const MAX_TURNS_PER_PAGE = 100;
const MAX_TURN_TEXT_BYTES = 24 * 1024;
const MAX_ACTIVITY_BYTES = 24 * 1024;
const MAX_ACTIVITY_MESSAGES = 30;
const MAX_AGENT_PLAN_BYTES = 24 * 1024;
const MAX_FILE_CHANGES_BYTES = 48 * 1024;

function truncateUtf8(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return { value: source, truncated: false };
  return {
    value: `${bytes
      .subarray(0, Math.max(0, maxBytes - 3))
      .toString('utf8')
      .replace(/\uFFFD+$/u, '')}…`,
    truncated: true,
  };
}

function compactAttachments(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((attachment: any) => ({
    name: String(attachment?.name ?? attachment?.fileName ?? '').slice(0, 240),
    mime: String(attachment?.mime ?? attachment?.mimeType ?? 'file').slice(0, 120),
    size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : null,
  }));
}

export function compactAgentPlanForMesh(value: unknown): any | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as any;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  let truncated = rawItems.length > 100;
  const items = rawItems.slice(0, 100).map((item: any, index: number) => {
    const text = truncateUtf8(item?.text, 1_000);
    const id = truncateUtf8(item?.id, 200);
    if (text.truncated || id.truncated) truncated = true;
    return {
      id: id.value || `step-${index + 1}`,
      text: text.value,
      status: String(item?.status ?? 'pending').slice(0, 40),
      ...(Number.isFinite(Number(item?.order)) ? { order: Number(item.order) } : {}),
    };
  });
  const boundedItems = trimJsonArrayToBytes(items, MAX_AGENT_PLAN_BYTES, 'start');
  if (boundedItems.truncated) truncated = true;
  return {
    source: String(raw.source ?? '').slice(0, 40),
    updatedAt: String(raw.updatedAt ?? '').slice(0, 128),
    items: boundedItems.items,
    ...(truncated ? { truncated: true } : {}),
  };
}

function compactFileChangeEntry(value: any, state: { truncated: boolean }): any {
  const filePath = truncateUtf8(value?.path, 320);
  const originalPath = value?.originalPath == null ? null : truncateUtf8(value.originalPath, 320);
  if (filePath.truncated || originalPath?.truncated) state.truncated = true;
  return {
    path: filePath.value,
    ...(originalPath ? { originalPath: originalPath.value } : {}),
    status: String(value?.status ?? 'unknown').slice(0, 40),
    additions: Math.max(0, Number(value?.additions) || 0),
    deletions: Math.max(0, Number(value?.deletions) || 0),
    ...(Number.isFinite(Number(value?.modified))
      ? { modified: Math.max(0, Number(value.modified)) }
      : {}),
    ...(value?.binary === true ? { binary: true } : {}),
  };
}

function compactFileChangeCounts(value: any): Record<string, number> {
  return {
    changed: Math.max(0, Number(value?.changed) || 0),
    additions: Math.max(0, Number(value?.additions) || 0),
    deletions: Math.max(0, Number(value?.deletions) || 0),
    ...(Number.isFinite(Number(value?.modified))
      ? { modified: Math.max(0, Number(value.modified)) }
      : {}),
  };
}

export function compactAgentRunFileChangesForMesh(value: unknown): any | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as any;
  if (raw.version !== 1 && raw.version !== 2) return undefined;
  const state = { truncated: false };
  const rawWorkspaces = Array.isArray(raw.workspaces) ? raw.workspaces : [];
  if (rawWorkspaces.length > 16) state.truncated = true;
  const workspaceCount = Math.min(rawWorkspaces.length, 16);
  const entriesPerWorkspace = Math.max(1, Math.floor(48 / Math.max(1, workspaceCount)));
  const workspaces = rawWorkspaces.slice(0, 16).map((workspace: any) => {
    const entriesKey = raw.version === 1 ? 'entries' : 'previewEntries';
    const rawEntries = Array.isArray(workspace?.[entriesKey]) ? workspace[entriesKey] : [];
    if (rawEntries.length > entriesPerWorkspace) state.truncated = true;
    const targetId = truncateUtf8(workspace?.targetId, 200);
    const droneId = truncateUtf8(workspace?.droneId, 200);
    const label = truncateUtf8(workspace?.label, 320);
    const repoRoot = truncateUtf8(workspace?.repoRoot, 500);
    const diffArtifactId = truncateUtf8(workspace?.diffArtifactId, 200);
    if (
      targetId.truncated ||
      droneId.truncated ||
      label.truncated ||
      repoRoot.truncated ||
      diffArtifactId.truncated
    ) {
      state.truncated = true;
    }
    return {
      targetId: targetId.value,
      ...(droneId.value ? { droneId: droneId.value } : {}),
      label: label.value,
      ...(raw.version === 1 ? { repoRoot: repoRoot.value } : {}),
      ...(diffArtifactId.value ? { diffArtifactId: diffArtifactId.value } : {}),
      counts: compactFileChangeCounts(workspace?.counts),
      [entriesKey]: rawEntries
        .slice(0, entriesPerWorkspace)
        .map((entry: any) => compactFileChangeEntry(entry, state)),
      ...((raw.version === 1 && workspace?.truncated === true) ||
      (raw.version === 2 && workspace?.metadataTruncated === true)
        ? { [raw.version === 1 ? 'truncated' : 'metadataTruncated']: true }
        : {}),
    };
  });
  const compacted: any = {
    version: raw.version,
    capturedAt: String(raw.capturedAt ?? '').slice(0, 128),
    counts: compactFileChangeCounts(raw.counts),
    workspaces,
  };
  while (Buffer.byteLength(JSON.stringify(compacted)) > MAX_FILE_CHANGES_BYTES) {
    const workspace = workspaces
      .filter((item: any) => (raw.version === 1 ? item.entries : item.previewEntries).length > 0)
      .sort(
        (left: any, right: any) =>
          (raw.version === 1 ? right.entries : right.previewEntries).length -
          (raw.version === 1 ? left.entries : left.previewEntries).length,
      )[0];
    if (!workspace) break;
    (raw.version === 1 ? workspace.entries : workspace.previewEntries).pop();
    state.truncated = true;
  }
  if (state.truncated) {
    compacted[raw.version === 1 ? 'truncated' : 'metadataTruncated'] = true;
  }
  return compacted;
}

function compactActivityMessage(message: AssistantMessage): {
  message: AssistantMessage;
  truncated: boolean;
} {
  let truncated = false;
  const content = Array.isArray(message.content)
    ? message.content.slice(-16).map((part) => {
        const text = part?.text ? truncateUtf8(part.text, 2_000) : null;
        const thinking = part?.thinking ? truncateUtf8(part.thinking, 2_000) : null;
        const argsText =
          part?.arguments !== undefined
            ? truncateUtf8(
                typeof part.arguments === 'string'
                  ? part.arguments
                  : JSON.stringify(part.arguments),
                4_000,
              )
            : null;
        if (text?.truncated || thinking?.truncated || argsText?.truncated) truncated = true;
        return {
          type: String(part?.type ?? ''),
          ...(text ? { text: text.value } : {}),
          ...(thinking ? { thinking: thinking.value } : {}),
          ...(part?.name ? { name: String(part.name).slice(0, 160) } : {}),
          ...(part?.id ? { id: String(part.id).slice(0, 200) } : {}),
          ...(argsText
            ? {
                arguments: argsText.truncated ? argsText.value : part.arguments,
              }
            : {}),
        };
      })
    : (() => {
        const result = truncateUtf8(message.content, 4_000);
        if (result.truncated) truncated = true;
        return result.value;
      })();
  if (Array.isArray(message.content) && message.content.length > 16) truncated = true;
  const errorMessage = message.errorMessage ? truncateUtf8(message.errorMessage, 2_000) : null;
  if (errorMessage?.truncated || message.details !== undefined) truncated = true;
  let compacted: AssistantMessage = {
    id: String(message.id ?? '').slice(0, 200) || undefined,
    role: message.role,
    content,
    ...(message.toolName ? { toolName: String(message.toolName).slice(0, 160) } : {}),
    ...(message.toolCallId ? { toolCallId: String(message.toolCallId).slice(0, 200) } : {}),
    ...(message.isError === true ? { isError: true } : {}),
    ...(errorMessage ? { errorMessage: errorMessage.value } : {}),
    ...(message.createdAt ? { createdAt: String(message.createdAt) } : {}),
  };
  while (
    Array.isArray(compacted.content) &&
    compacted.content.length > 1 &&
    Buffer.byteLength(JSON.stringify(compacted)) > MAX_ACTIVITY_BYTES
  ) {
    compacted = { ...compacted, content: compacted.content.slice(1) };
    truncated = true;
  }
  return {
    message: compacted,
    truncated,
  };
}

export function compactAgentRunActivityForMesh(value: unknown): {
  activity?: ReturnType<typeof normalizeAgentRunActivity>;
  truncated: boolean;
} {
  const activity = normalizeAgentRunActivity(value);
  if (!activity) return { truncated: false };
  const compactedMessages = activity.messages
    .slice(-MAX_ACTIVITY_MESSAGES)
    .map(compactActivityMessage);
  const boundedMessages = trimJsonArrayToBytes(
    compactedMessages.map((entry) => entry.message),
    MAX_ACTIVITY_BYTES,
  );
  const messages = boundedMessages.items;
  let truncated =
    activity.messages.length > messages.length ||
    compactedMessages.some((entry) => entry.truncated) ||
    boundedMessages.truncated;
  return {
    activity: {
      ...activity,
      messages,
      ...(activity.truncated || truncated ? { truncated: true } : {}),
    },
    truncated,
  };
}

function compactTurn(turn: any, sourceIndex: number): Record<string, unknown> {
  const prompt = truncateUtf8(turn?.prompt, MAX_TURN_TEXT_BYTES);
  const output = truncateUtf8(turn?.output, MAX_TURN_TEXT_BYTES);
  const error = truncateUtf8(turn?.error, 4 * 1024);
  const responseTruncated = output.truncated || error.truncated;
  const compactedActivity = compactAgentRunActivityForMesh(turn?.activity);
  const agentPlan = compactAgentPlanForMesh(turn?.agentPlan);
  const fileChanges = compactAgentRunFileChangesForMesh(turn?.fileChanges);
  const meshTruncated = prompt.truncated || responseTruncated || compactedActivity.truncated;
  const turnNumber = Number.isFinite(Number(turn?.turn)) ? Number(turn.turn) : null;
  return {
    id:
      String(turn?.id ?? '').trim() ||
      (turnNumber !== null ? `turn-${turnNumber}` : `turn-${sourceIndex}`),
    turn: turnNumber,
    at: String(turn?.at ?? ''),
    promptAt: String(turn?.promptAt ?? ''),
    startedAt: String(turn?.startedAt ?? ''),
    completedAt: String(turn?.completedAt ?? ''),
    prompt: prompt.value,
    output: output.value,
    error: error.value,
    ok: turn?.ok !== false,
    ...(turn?.userOnly === true ? { userOnly: true } : {}),
    model: String(turn?.model ?? ''),
    reasoning: String(turn?.reasoning ?? ''),
    ...(agentPlan ? { agentPlan } : {}),
    ...(fileChanges ? { fileChanges } : {}),
    ...(compactedActivity.activity ? { activity: compactedActivity.activity } : {}),
    attachments: compactAttachments(turn?.attachments),
    ...(prompt.truncated ? { promptTruncated: true } : {}),
    ...(responseTruncated ? { responseTruncated: true } : {}),
    ...(compactedActivity.truncated ? { activityMeshTruncated: true } : {}),
    ...(meshTruncated ? { meshTruncated: true } : {}),
  };
}

function beforeIndex(value: unknown, length: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, length) : length;
}

export function boundedDroneChatPage(
  rawTurns: unknown,
  before?: unknown,
  maxBytes = MESH_CHAT_PAYLOAD_BYTES,
) {
  const source = Array.isArray(rawTurns) ? rawTurns : [];
  const end = beforeIndex(before, source.length);
  const candidateStart = Math.max(0, end - MAX_TURNS_PER_PAGE);
  const candidates = source
    .slice(candidateStart, end)
    .map((turn, index) => compactTurn(turn, candidateStart + index));
  const turns: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index]!;
    const turnBytes = Buffer.byteLength(JSON.stringify(turn));
    if (bytes + turnBytes > maxBytes) break;
    turns.unshift(turn);
    bytes += turnBytes;
  }
  const firstTurnNumber = Number(turns[0]?.turn);
  const start =
    turns.length > 0 && Number.isSafeInteger(firstTurnNumber) && firstTurnNumber > 0
      ? firstTurnNumber - 1
      : Math.max(0, end - turns.length);
  return {
    turns,
    page: {
      beforeCursor: start > 0 ? start : null,
      hasOlder: start > 0,
      responseTruncated: turns.length < end,
      contentTruncated: turns.some((turn) => turn.meshTruncated === true),
    },
  };
}
