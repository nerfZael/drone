import type { WorkflowPermission } from './workflow-types';

export const WORKFLOW_CHAT_VISIBILITY = 'workflow';

export function isWorkflowChatEntry(entry: unknown): boolean {
  return (entry as any)?.visibility === WORKFLOW_CHAT_VISIBILITY;
}

export function partitionWorkflowChatEntries(chats: unknown): {
  chats: string[];
  workflowChats: string[];
} {
  const entries =
    chats && typeof chats === 'object' ? Object.entries(chats as Record<string, unknown>) : [];
  const ordinaryChats: string[] = [];
  const workflowChats: string[] = [];
  for (const [chatName, entry] of entries) {
    (isWorkflowChatEntry(entry) ? workflowChats : ordinaryChats).push(chatName);
  }
  return { chats: ordinaryChats, workflowChats };
}

export function buildWorkflowChatMetadata(input: {
  origin: unknown;
  permissions: readonly WorkflowPermission[];
  toolProfile: string;
}): Record<string, unknown> {
  return {
    visibility: WORKFLOW_CHAT_VISIBILITY,
    workflowOrigin: input.origin,
    workflowPermissions: input.permissions,
    workflowToolProfile: input.toolProfile,
  };
}
