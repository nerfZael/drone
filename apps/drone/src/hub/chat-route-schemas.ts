import { z } from 'zod';

export const chatPromptBodySchema = z
  .object({
    prompt: z.unknown().optional(),
    attachments: z.unknown().optional(),
    promptId: z.unknown().optional(),
    prompt_id: z.unknown().optional(),
    id: z.unknown().optional(),
    submittedAt: z.unknown().optional(),
    clientSubmittedAt: z.unknown().optional(),
    at: z.unknown().optional(),
    cwd: z.string().optional(),
    autoRenameHandledByClient: z.boolean().optional(),
  })
  .passthrough();

export const chatCreateBodySchema = z
  .object({
    name: z.unknown().optional(),
    chatName: z.unknown().optional(),
    chat: z.unknown().optional(),
    copyFrom: z.unknown().optional(),
    copyFromChat: z.unknown().optional(),
    fromChat: z.unknown().optional(),
    draft: z.unknown().optional(),
    isDraft: z.unknown().optional(),
  })
  .passthrough();

export const chatRenameBodySchema = z
  .object({
    newName: z.unknown().optional(),
    name: z.unknown().optional(),
  })
  .passthrough();

export const chatReadBodySchema = z
  .object({
    unread: z.boolean().optional(),
    latestAgentTurnId: z.string().nullable().optional(),
    latestAgentRevision: z.number().int().nonnegative().optional(),
    updatedByDeviceId: z.unknown().optional(),
  })
  .passthrough();

export const chatConfigBodySchema = z
  .object({
    agent: z.unknown().optional(),
    model: z.unknown().optional(),
    chatModel: z.unknown().optional(),
    agentPermissionMode: z.unknown().optional(),
    agentMessageAutoContinueEnabled: z.boolean().optional(),
    agentSuggestionEnabled: z.boolean().optional(),
    dockerSnapshotAfterAgentMessageEnabled: z.boolean().optional(),
  })
  .passthrough();

export const agentSuggestionUsedBodySchema = z
  .object({
    suggestion: z.unknown().optional(),
    suggestionHash: z.unknown().optional(),
    policyFingerprint: z.unknown().optional(),
  })
  .passthrough();
