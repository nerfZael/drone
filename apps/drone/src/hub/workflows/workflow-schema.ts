import { z } from 'zod';

const localIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]{0,63}$/,
    'must start with a lowercase letter and contain only lowercase letters, digits, _ or -',
  );
const positiveIntegerSchema = z.number().int().positive();
const jsonPointerSchema = z
  .string()
  .refine((value) => value === '' || value.startsWith('/'), 'must be an RFC 6901 JSON Pointer');

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const workflowJsonValueSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(workflowJsonValueSchema),
    z.record(z.string(), workflowJsonValueSchema),
  ]),
);

export const workflowJsonSchemaSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('object'),
        description: z.string().optional(),
        properties: z.record(z.string(), workflowJsonSchemaSchema),
        required: z.array(z.string()).optional(),
        additionalProperties: z.literal(false),
      })
      .strict(),
    z
      .object({
        type: z.literal('array'),
        description: z.string().optional(),
        items: workflowJsonSchemaSchema,
        maxItems: positiveIntegerSchema.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('string'),
        description: z.string().optional(),
        enum: z.array(z.string()).min(1).optional(),
      })
      .strict(),
    z
      .object({
        type: z.enum(['number', 'integer']),
        description: z.string().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
      })
      .strict(),
    z
      .object({
        type: z.enum(['boolean', 'null']),
        description: z.string().optional(),
      })
      .strict(),
  ]),
);

const workflowValueRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('input'), path: jsonPointerSchema.optional() }).strict(),
  z
    .object({
      source: z.literal('result'),
      result: z.string().min(1),
      path: jsonPointerSchema.optional(),
    })
    .strict(),
  z.object({ source: z.literal('item'), path: jsonPointerSchema.optional() }).strict(),
]);

const contextRefFields = {
  path: jsonPointerSchema.optional(),
  as: localIdSchema.optional(),
  optional: z.boolean().optional(),
};
const workflowContextRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('input'), ...contextRefFields }).strict(),
  z
    .object({
      source: z.literal('result'),
      result: z.string().min(1),
      ...contextRefFields,
    })
    .strict(),
  z.object({ source: z.literal('item'), ...contextRefFields }).strict(),
]);

const workflowConditionSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.enum(['equals', 'notEquals']),
      value: workflowValueRefSchema,
      expected: workflowJsonValueSchema,
    })
    .strict(),
  z
    .object({
      op: z.enum(['exists', 'truthy']),
      value: workflowValueRefSchema,
    })
    .strict(),
]);

const nodeMetadata = {
  id: localIdSchema,
  label: z.string().max(200).optional(),
};

export const workflowNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        ...nodeMetadata,
        type: z.literal('call'),
        agent: localIdSchema,
        prompt: z.string().min(1).max(32_000),
        contextFrom: z.array(workflowContextRefSchema).max(64).optional(),
        outputSchema: workflowJsonSchemaSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...nodeMetadata,
        type: z.literal('sequence'),
        children: z.array(workflowNodeSchema).min(1),
      })
      .strict(),
    z
      .object({
        ...nodeMetadata,
        type: z.literal('parallel'),
        children: z.array(workflowNodeSchema).min(1),
      })
      .strict(),
    z
      .object({
        ...nodeMetadata,
        type: z.literal('forEach'),
        itemsFrom: workflowValueRefSchema,
        maxItems: positiveIntegerSchema.optional(),
        parallelism: positiveIntegerSchema.optional(),
        body: workflowNodeSchema,
      })
      .strict(),
    z
      .object({
        ...nodeMetadata,
        type: z.literal('if'),
        condition: workflowConditionSchema,
        then: workflowNodeSchema,
        else: workflowNodeSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...nodeMetadata,
        type: z.literal('repeat'),
        maxIterations: positiveIntegerSchema.optional(),
        until: workflowConditionSchema,
        body: workflowNodeSchema,
      })
      .strict(),
  ]),
);

export const workflowPermissionSchema = z.enum([
  'workspace:read',
  'workspace:write',
  'process:execute',
]);

export const workflowAgentSchema = z
  .object({
    runner: z
      .object({
        kind: z.enum(['drone-chat', 'drone']),
        agent: z.object({ kind: z.literal('builtin'), id: z.enum(['blip', 'codex']) }).strict(),
      })
      .strict(),
    model: z.string().min(1).max(200).optional(),
    permissions: z.array(workflowPermissionSchema).min(1).max(3),
    instructions: z.string().min(1).max(16_000),
  })
  .strict();

export const workflowDefinitionSchema = z
  .object({
    version: z.literal(1),
    inputSchema: workflowJsonSchemaSchema.optional(),
    limits: z
      .object({
        maxInvocations: positiveIntegerSchema.optional(),
        maxConcurrency: positiveIntegerSchema.optional(),
        timeoutMinutes: positiveIntegerSchema.optional(),
      })
      .strict()
      .optional(),
    agents: z.record(localIdSchema, workflowAgentSchema),
    phases: z
      .array(
        z
          .object({
            id: localIdSchema,
            label: z.string().max(200).optional(),
            run: workflowNodeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(32),
    outputFrom: z.string().min(1).optional(),
  })
  .strict();

export const workflowCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).optional(),
    definition: workflowDefinitionSchema,
  })
  .strict();

export const workflowUpdateInputSchema = z
  .object({
    baseVersion: positiveIntegerSchema,
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).optional(),
    definition: workflowDefinitionSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.definition !== undefined,
    'at least one workflow field must be updated',
  );
