/** Fixed operation labels deliberately exclude file paths, URLs and request bodies. */
export type DiagnosticOperation = 'files.list' | 'companion.settings' | 'companion.workspace' | 'companion.editor-file';
export type RequestDiagnostic = {
  version: 1;
  requestId: string;
  serverRequestId?: string;
  operation: DiagnosticOperation;
  method: 'GET' | 'PUT' | 'POST';
  startedAt: string;
  durationMs: number;
  outcome: 'completed' | 'error' | 'aborted' | 'timeout';
  status?: number;
  headersMs?: number;
  bodyMs?: number;
  resource?: { queueMs?: number; responseMs?: number; protocol?: string };
};
export function diagnosticOperation(pathname: string): DiagnosticOperation | undefined {
  if (/^\/api\/drones\/[^/]+\/fs\/list$/.test(pathname)) return 'files.list';
  if (pathname === '/api/settings/companion/live-voice') return 'companion.settings';
  if (pathname === '/api/companion/workspaces/current') return 'companion.workspace';
  if (pathname === '/api/companion/editor-file') return 'companion.editor-file';
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const ms = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
export function normalizeRequestDiagnostic(raw: unknown): RequestDiagnostic | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, any>;
  if (v.version !== 1 || !id(v.requestId) || !['files.list', 'companion.settings', 'companion.workspace', 'companion.editor-file'].includes(v.operation) ||
      !['GET', 'PUT', 'POST'].includes(v.method) || !['completed', 'error', 'aborted', 'timeout'].includes(v.outcome) ||
      typeof v.startedAt !== 'string' || v.startedAt.length > 32 || !Number.isFinite(Date.parse(v.startedAt)) || !ms(v.durationMs)) return null;
  const result: RequestDiagnostic = { version: 1, requestId: v.requestId, operation: v.operation, method: v.method, startedAt: v.startedAt, durationMs: v.durationMs, outcome: v.outcome };
  if (id(v.serverRequestId)) result.serverRequestId = v.serverRequestId;
  if (Number.isInteger(v.status) && v.status >= 100 && v.status <= 599) result.status = v.status;
  for (const key of ['headersMs', 'bodyMs'] as const) if (ms(v[key])) result[key] = v[key];
  if (v.resource && typeof v.resource === 'object') {
    result.resource = {};
    for (const key of ['queueMs', 'responseMs'] as const) if (ms(v.resource[key])) result.resource[key] = v.resource[key];
    if (typeof v.resource.protocol === 'string' && /^(h2|h3|http\/1\.[01])$/.test(v.resource.protocol)) result.resource.protocol = v.resource.protocol;
  }
  return result;
}
