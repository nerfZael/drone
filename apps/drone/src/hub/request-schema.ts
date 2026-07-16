import type { z } from 'zod';

import { InvalidRequestError } from './domain-errors';

export function parseRequestSchema<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  label = 'request',
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
  const first = issues[0];
  const location = first?.path ? ` at ${first.path}` : '';
  throw new InvalidRequestError(
    `invalid ${label}${location}: ${first?.message ?? 'invalid value'}`,
    {
      issues,
    },
  );
}
