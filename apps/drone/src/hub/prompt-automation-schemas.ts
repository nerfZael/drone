import { z } from 'zod';

export const promptAutomationStartBodySchema = z
  .object({
    automationId: z.string().trim().min(1, 'missing automationId'),
    automationLabel: z.string().trim().optional(),
    prompt: z.string().trim().min(1, 'missing prompt'),
    onFailurePrompt: z.unknown().optional(),
    runs: z.unknown().optional(),
    sleepBetweenRunsSeconds: z.unknown().optional(),
    sleepBetweenRuns: z.unknown().optional(),
    sleepBetweenRunsUnit: z.unknown().optional(),
    stopPhrase: z.unknown().optional(),
    stopPhraseCaseSensitive: z.unknown().optional(),
  })
  .passthrough();

export const promptAutomationStopBodySchema = z
  .object({
    mode: z.enum(['all', 'runs-only']).optional(),
    stopMode: z.enum(['all', 'runs-only']).optional(),
    clearQueued: z.boolean().optional(),
  })
  .passthrough();

export const promptAutomationQueueParamsSchema = z.object({
  droneId: z.string().trim().min(1),
  chatName: z.string().trim().min(1),
  queueId: z.string().trim().min(1, 'missing queueId'),
});
