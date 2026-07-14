import type { BlipSessionState } from '@blip/core';
import type { LocalAssistantThread, LocalBlipSessionSnapshot } from './local-assistant-types';

export function createMobileBlipSessionState(
  thread: LocalAssistantThread,
  provider = 'openai',
): BlipSessionState {
  return {
    id: `mobile_${thread.id}`,
    workspaceRoot: 'mobile-mesh',
    modelProvider: provider,
    modelId: thread.model,
    permissionMode: 'workspace-write',
    toolProfile: 'no-shell-workspace-write',
    loadedSkills: [],
    transcriptPath: `mobile:${thread.id}`,
    changedFiles: [],
    readFiles: [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validContentPart(value: any, assistant: boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'text') return typeof value.text === 'string';
  if (value.type === 'image') {
    return !assistant && typeof value.data === 'string' && typeof value.mimeType === 'string';
  }
  if (value.type === 'thinking') return assistant && typeof value.thinking === 'string';
  if (value.type === 'toolCall') {
    return (
      assistant &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      value.arguments !== null &&
      typeof value.arguments === 'object' &&
      !Array.isArray(value.arguments)
    );
  }
  return false;
}

function validAgentMessage(value: any): boolean {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.timestamp)) return false;
  if (value.role === 'user') {
    return (
      typeof value.content === 'string' ||
      (Array.isArray(value.content) &&
        value.content.every((part: unknown) => validContentPart(part, false)))
    );
  }
  if (value.role === 'toolResult') {
    return (
      typeof value.toolCallId === 'string' &&
      typeof value.toolName === 'string' &&
      typeof value.isError === 'boolean' &&
      Array.isArray(value.content) &&
      value.content.every((part: unknown) => validContentPart(part, false))
    );
  }
  if (value.role === 'assistant') {
    return (
      typeof value.api === 'string' &&
      typeof value.provider === 'string' &&
      typeof value.model === 'string' &&
      ['stop', 'length', 'toolUse', 'error', 'aborted'].includes(value.stopReason) &&
      Array.isArray(value.content) &&
      value.content.every((part: unknown) => validContentPart(part, true)) &&
      value.usage &&
      Number.isFinite(value.usage.totalTokens)
    );
  }
  return false;
}

function validTranscriptEntry(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'message') {
    return (
      typeof value.id === 'string' &&
      typeof value.timestamp === 'string' &&
      validAgentMessage(value.message)
    );
  }
  if (value.type === 'runtime_event') {
    return (
      typeof value.id === 'string' &&
      typeof value.timestamp === 'string' &&
      value.event &&
      value.event.version === 1 &&
      typeof value.event.eventId === 'string' &&
      typeof value.event.sessionId === 'string' &&
      typeof value.event.timestamp === 'string' &&
      typeof value.event.type === 'string'
    );
  }
  if (value.type === 'compaction') {
    return (
      typeof value.id === 'string' &&
      typeof value.createdAt === 'string' &&
      (value.trigger === 'manual' || value.trigger === 'auto') &&
      Number.isFinite(value.tokensBefore) &&
      (value.tokensAfterEstimate === undefined || Number.isFinite(value.tokensAfterEstimate)) &&
      typeof value.firstKeptEntryId === 'string' &&
      typeof value.summary === 'string' &&
      value.details &&
      stringArray(value.details.readFiles) &&
      stringArray(value.details.modifiedFiles)
    );
  }
  return false;
}

/** Validate a persisted snapshot without truncating its transcript. */
export function cleanLocalBlipSessionSnapshot(
  threadId: string,
  value: unknown,
): LocalBlipSessionSnapshot | null {
  const snapshot = value as any;
  const state = snapshot?.state;
  if (
    snapshot?.version !== 1 ||
    !state ||
    state.id !== `mobile_${threadId}` ||
    typeof state.workspaceRoot !== 'string' ||
    typeof state.modelProvider !== 'string' ||
    typeof state.modelId !== 'string' ||
    !['read-only', 'workspace-write', 'full-access'].includes(state.permissionMode) ||
    !['local-trusted-write', 'read-only', 'no-shell-workspace-write'].includes(state.toolProfile) ||
    !stringArray(state.loadedSkills) ||
    typeof state.transcriptPath !== 'string' ||
    !stringArray(state.changedFiles) ||
    !stringArray(state.readFiles) ||
    (state.compactedSummary !== undefined && typeof state.compactedSummary !== 'string') ||
    typeof state.createdAt !== 'string' ||
    typeof state.updatedAt !== 'string' ||
    !Array.isArray(snapshot.transcript) ||
    !snapshot.transcript.every(validTranscriptEntry) ||
    snapshot.transcript.some(
      (entry: any) => entry.type === 'runtime_event' && entry.event.sessionId !== state.id,
    )
  ) {
    return null;
  }
  return snapshot as LocalBlipSessionSnapshot;
}
