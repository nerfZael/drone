import { diagnosticOperation, normalizeRequestDiagnostic, type RequestDiagnostic } from '@drone/hub-model';

/** Independent of navigation spans: cached views and polling failures still get a record. */
export function observeRequest(url: string, init: RequestInit | undefined, save = enqueueRequestDiagnostic) {
  const operation = diagnosticOperation(url.split('?')[0]);
  if (!operation) return null;
  const started = performance.now();
  const record: RequestDiagnostic = {
    version: 1, requestId: crypto.randomUUID(), operation,
    method: (init?.method ?? 'GET') as RequestDiagnostic['method'],
    startedAt: new Date().toISOString(), durationMs: 0, outcome: 'error',
  };
  let done = false;
  const finish = (outcome: RequestDiagnostic['outcome']) => {
    if (done) return;
    done = true;
    record.durationMs = performance.now() - started;
    record.outcome = outcome;
    try {
      // Aborted requests may have no Resource Timing entry; never invent zero queue time.
      const absolute = new URL(url, location.href).href;
      const entries = performance.getEntriesByName(absolute, 'resource').filter(
        (item) => item.startTime >= started && item.startTime <= started + record.durationMs,
      );
      // Concurrent identical URLs cannot be safely attributed to an individual fetch.
      const entry = entries.length === 1 ? entries[0] as PerformanceResourceTiming : undefined;
      if (entry) {
        record.resource = { protocol: entry.nextHopProtocol };
        if (entry.requestStart > 0) record.resource.queueMs = Math.max(0, entry.requestStart - entry.fetchStart);
        if (entry.responseStart > 0 && entry.responseEnd >= entry.responseStart) record.resource.responseMs = entry.responseEnd - entry.responseStart;
      }
    } catch { /* Resource Timing is optional. */ }
    try { save(record); } catch { /* Diagnostics must not break requests. */ }
  };
  return {
    requestId: record.requestId,
    response(response: Response) {
      record.headersMs = performance.now() - started;
      record.status = response.status;
      record.serverRequestId = response.headers.get('x-drone-request-id') ?? undefined;
    },
    finish() { record.bodyMs = performance.now() - started; finish(record.status && record.status < 400 ? 'completed' : 'error'); },
    fail(error: unknown) {
      const name = (error as { name?: string })?.name;
      const reason = (init?.signal?.reason as { name?: string })?.name;
      finish(name === 'TimeoutError' || reason === 'TimeoutError' ? 'timeout' : init?.signal?.aborted || name === 'AbortError' ? 'aborted' : 'error');
    },
  };
}

// Keep failed uploads through temporary disconnections. Bounded to 50 records and 10 minutes.
export class RequestDiagnosticQueue {
  private pending: Array<{ record: RequestDiagnostic; expires: number }> = [];
  private sending = false;
  constructor(private readonly send: (record: RequestDiagnostic) => Promise<boolean>, private readonly now = Date.now) {}
  get size() { return this.pending.length; }
  add(raw: RequestDiagnostic) {
    const record = normalizeRequestDiagnostic(raw);
    if (!record) return;
    this.pending.push({ record, expires: this.now() + 600_000 });
    if (this.pending.length > 50) this.pending.shift();
  }
  async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length) {
        const item = this.pending[0];
        if (item.expires <= this.now()) { this.pending.shift(); continue; }
        if (!await this.send(item.record)) break;
        const index = this.pending.indexOf(item);
        if (index >= 0) this.pending.splice(index, 1);
      }
    } catch { /* Retry after the connection recovers. */ }
    finally { this.sending = false; }
  }
}
const queue = new RequestDiagnosticQueue(async (record) => {
  const response = await fetch('/api/telemetry/request', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record), signal: AbortSignal.timeout(5000), keepalive: true,
  });
  return response.ok;
});
let timer: ReturnType<typeof setTimeout> | undefined;
export function enqueueRequestDiagnostic(raw: RequestDiagnostic) {
  queue.add(raw);
  schedule();
}
function schedule() {
  if (timer || !queue.size) return;
  timer = setTimeout(async () => {
    try { await queue.flush(); }
    finally { timer = undefined; schedule(); }
  }, 5000);
  (timer as any).unref?.();
}
