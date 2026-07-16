import type http from 'node:http';
import type { z } from 'zod';

import { describeHubError, InvalidRequestError } from './domain-errors';
import type { HubJsonResponder } from './hub-http';
import { parseRequestSchema } from './request-schema';

export type HubHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export type { HubJsonResponder } from './hub-http';

export type HubJsonBodyReader = (req: http.IncomingMessage) => Promise<unknown>;

export class HubHttpError extends Error {
  readonly body: Record<string, unknown>;

  constructor(
    readonly status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HubHttpError';
    this.body = { ok: false, error: message, ...(details ?? {}) };
  }
}

export type HubRouteContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: HubHttpMethod;
  params: Readonly<Record<string, string>>;
  json: (status: number, body: unknown) => void;
  readJson: <T = any>() => Promise<T>;
  readJsonSchema: <Schema extends z.ZodType>(
    schema: Schema,
    label?: string,
  ) => Promise<z.output<Schema>>;
  fail: (status: number, message: string, details?: Record<string, unknown>) => never;
};

export type HubRouteHandler = (context: HubRouteContext) => void | Promise<void>;

type CompiledRoute = {
  order: number;
  method: HubHttpMethod;
  pattern: string;
  indexKey: string;
  keys: string[];
  matcher: RegExp;
  handler: HubRouteHandler;
};

const FALLBACK_INDEX_KEY = '*';

function routeIndexKey(pattern: string): string {
  const segments = pattern.split('/').filter(Boolean);
  const staticSegments: string[] = [];
  for (const segment of segments.slice(0, 2)) {
    if (segment === '*' || segment.startsWith(':')) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/') || FALLBACK_INDEX_KEY;
}

function requestIndexKeys(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean);
  const keys: string[] = [];
  if (segments.length >= 2) keys.push(segments.slice(0, 2).join('/'));
  if (segments.length >= 1) keys.push(segments[0]);
  keys.push(FALLBACK_INDEX_KEY);
  return Array.from(new Set(keys));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePattern(patternRaw: string): { keys: string[]; matcher: RegExp } {
  const pattern = String(patternRaw ?? '').trim();
  if (!pattern.startsWith('/')) throw new Error(`Hub route must start with /: ${pattern}`);
  if (pattern !== '/' && pattern.endsWith('/')) {
    throw new Error(`Hub route must not end with /: ${pattern}`);
  }

  const keys: string[] = [];
  const segments = pattern.split('/').slice(1);
  const source = segments
    .map((segment, index) => {
      if (segment === '*') {
        if (index !== segments.length - 1) {
          throw new Error(`Hub route wildcard must be the final segment: ${pattern}`);
        }
        keys.push('*');
        return '(.*)';
      }
      if (segment.startsWith(':')) {
        const key = segment.slice(1).trim();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
          throw new Error(`Invalid Hub route parameter in ${pattern}: ${segment}`);
        }
        if (keys.includes(key))
          throw new Error(`Duplicate Hub route parameter in ${pattern}: ${key}`);
        keys.push(key);
        return '([^/]+)';
      }
      return escapeRegex(segment);
    })
    .join('/');
  return { keys, matcher: new RegExp(`^/${source}$`) };
}

function decodeParams(route: CompiledRoute, match: RegExpExecArray): Record<string, string> {
  const params: Record<string, string> = {};
  for (let index = 0; index < route.keys.length; index += 1) {
    const key = route.keys[index];
    const raw = match[index + 1] ?? '';
    try {
      params[key] = decodeURIComponent(raw);
    } catch {
      throw new HubHttpError(400, `invalid URL parameter: ${key}`);
    }
  }
  return params;
}

export class HubRouter {
  private readonly routes: CompiledRoute[] = [];
  private readonly routeIndex = new Map<HubHttpMethod, Map<string, CompiledRoute[]>>();

  constructor(
    private readonly sendJson: HubJsonResponder,
    private readonly readJsonBody: HubJsonBodyReader,
  ) {}

  route(method: HubHttpMethod, pattern: string, handler: HubRouteHandler): this {
    const normalizedMethod = String(method ?? '').toUpperCase() as HubHttpMethod;
    if (!['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(normalizedMethod)) {
      throw new Error(`Unsupported Hub route method: ${method}`);
    }
    const normalizedPattern = String(pattern ?? '').trim();
    const duplicate = this.routes.some(
      (route) => route.method === normalizedMethod && route.pattern === normalizedPattern,
    );
    if (duplicate) throw new Error(`Duplicate Hub route: ${normalizedMethod} ${normalizedPattern}`);
    const compiled = compilePattern(normalizedPattern);
    const semanticDuplicate = this.routes.some(
      (route) =>
        route.method === normalizedMethod && route.matcher.source === compiled.matcher.source,
    );
    if (semanticDuplicate) {
      throw new Error(`Ambiguous Hub route: ${normalizedMethod} ${normalizedPattern}`);
    }
    const route: CompiledRoute = {
      order: this.routes.length,
      method: normalizedMethod,
      pattern: normalizedPattern,
      indexKey: routeIndexKey(normalizedPattern),
      ...compiled,
      handler,
    };
    this.routes.push(route);
    let methodIndex = this.routeIndex.get(normalizedMethod);
    if (!methodIndex) {
      methodIndex = new Map();
      this.routeIndex.set(normalizedMethod, methodIndex);
    }
    const bucket = methodIndex.get(route.indexKey) ?? [];
    bucket.push(route);
    methodIndex.set(route.indexKey, bucket);
    return this;
  }

  get(pattern: string, handler: HubRouteHandler): this {
    return this.route('GET', pattern, handler);
  }

  post(pattern: string, handler: HubRouteHandler): this {
    return this.route('POST', pattern, handler);
  }

  put(pattern: string, handler: HubRouteHandler): this {
    return this.route('PUT', pattern, handler);
  }

  patch(pattern: string, handler: HubRouteHandler): this {
    return this.route('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: HubRouteHandler): this {
    return this.route('DELETE', pattern, handler);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const method = String(req.method ?? 'GET').toUpperCase() as HubHttpMethod;
    const methodIndex = this.routeIndex.get(method);
    if (!methodIndex) return false;
    const candidates = requestIndexKeys(url.pathname)
      .flatMap((key) => methodIndex.get(key) ?? [])
      .sort((left, right) => left.order - right.order);
    for (const route of candidates) {
      const match = route.matcher.exec(url.pathname);
      if (!match) continue;

      const json = (status: number, body: unknown) => this.sendJson(res, status, body);
      try {
        const params = decodeParams(route, match);
        await route.handler({
          req,
          res,
          url,
          method,
          params,
          json,
          readJson: async <T = any>() => {
            try {
              return (await this.readJsonBody(req)) as T;
            } catch (error: any) {
              // Keep the legacy response body for plain JSON routes. Schema-aware
              // routes opt into the richer InvalidRequestError descriptor below.
              throw new HubHttpError(400, error?.message ?? String(error));
            }
          },
          readJsonSchema: async (schema, label) => {
            let body: unknown;
            try {
              body = await this.readJsonBody(req);
            } catch (error: any) {
              throw new InvalidRequestError(error?.message ?? String(error));
            }
            return parseRequestSchema(schema, body, label);
          },
          fail: (status, message, details) => {
            throw new HubHttpError(status, message, details);
          },
        });
      } catch (error) {
        if (error instanceof HubHttpError) json(error.status, error.body);
        else {
          const descriptor = describeHubError(error);
          if (descriptor.statusCode >= 500) throw error;
          json(descriptor.statusCode, descriptor.body);
        }
      }
      return true;
    }
    return false;
  }
}
