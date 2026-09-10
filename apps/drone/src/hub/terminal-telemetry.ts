import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const label = z
  .string()
  .max(80)
  .regex(/^[a-zA-Z0-9_-]*$/);
const ms = z
  .number()
  .finite()
  .min(0)
  .max(365 * 24 * 60 * 60 * 1000);
const dimension = z.number().int().min(0).max(100_000);
const phases = z.array(z.object({ phase: label, ms })).max(32);
const stage = z.object({ totalMs: ms.optional(), phases });
const geometry = z.object({
  cols: dimension,
  rows: dimension,
  cursorX: dimension,
  cursorY: dimension,
  alternate: z.boolean(),
});

// Explicit fields at every nesting level keep terminal text, environment values
// and credentials out of logs, even if a client sends additional properties.
const reportSchema = z.object({
  version: z.literal(1),
  traceId: id,
  droneId: id,
  sessionName: z.union([id, z.literal('')]),
  requestId: id.optional(),
  transport: label,
  connecting: z.boolean(),
  failed: z.boolean(),
  elapsedMs: ms,
  reason: z.enum(['checkpoint', 'pagehide', 'closed']),
  reportedAt: z.string().datetime(),
  dimensions: z.object({ cols: dimension, rows: dimension }),
  startup: stage
    .extend({
      runtime: z.enum(['host', 'container']),
      path: label,
      fallback: label.optional(),
      daemon: stage.optional(),
    })
    .optional(),
  stream: stage
    .extend({
      scope: label,
      transport: label.optional(),
      exactSnapshot: z.boolean().optional(),
      captureFallback: label.optional(),
      cols: dimension.optional(),
      rows: dimension.optional(),
      resumed: z.boolean().optional(),
      geometry: geometry.optional(),
    })
    .optional(),
  events: z
    .array(
      z.object({
        phase: label,
        ms,
        at: z.string().datetime(),
        detail: z
          .object({
            preloaded: z.boolean().optional(),
            reused: z.boolean().optional(),
            cols: dimension.optional(),
            rows: dimension.optional(),
            requestMs: ms.optional(),
            transport: label.optional(),
            reason: label.optional(),
            attempt: dimension.optional(),
            attempts: dimension.optional(),
          })
          .optional(),
      }),
    )
    .max(96),
});

export function normalizeTerminalTelemetry(raw: unknown) {
  const parsed = reportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
