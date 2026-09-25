import type { Schema } from './types.js';

/** Validates a value against our schema subset. Returns an error message, or null when valid. */
export function validate(schema: Schema, value: unknown, path = 'args'): string | null {
  if ('anyOf' in schema) {
    const errors = schema.anyOf.map(option => validate(option, value, path));
    return errors.some(error => error === null) ? null : `${path} matches none of the allowed shapes (${errors.join(' | ')})`;
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return `${path} must be a string, got ${describe(value)}`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(value)}`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must be at most ${schema.maxLength} characters`;
      return null;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number, got ${describe(value)}`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be >= ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be <= ${schema.maximum}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be a boolean, got ${describe(value)}`;
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array, got ${describe(value)}`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} must have at most ${schema.maxItems} items`;
      for (let i = 0; i < value.length; i++) {
        const error = validate(schema.items, value[i], `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object, got ${describe(value)}`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (record[key] === undefined) return `${path}.${key} is required`;
      for (const [key, item] of Object.entries(record)) {
        const property = schema.properties[key];
        if (!property) {
          if (schema.additionalProperties === false) return `${path}.${key} is not allowed (allowed: ${Object.keys(schema.properties).join(', ') || 'none'})`;
          continue;
        }
        if (item === undefined) continue;
        const error = validate(property, item, `${path}.${key}`);
        if (error) return error;
      }
      return null;
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'string' ? JSON.stringify(value) : typeof value;
}

/** Converts our schema subset to plain JSON schema for model tool definitions. */
export function toJsonSchema(schema: Schema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema));
}
