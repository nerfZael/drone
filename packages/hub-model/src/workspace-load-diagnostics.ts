export type WorkspaceLoadRecord = {
  version: 1;
  kind: 'file-open' | 'directory-load' | 'media-load';
  navigationId: string;
  parentNavigationId?: string;
  targetDeviceId: string;
  droneId: string;
  chatName: string;
  platform: string;
  startedAt: string;
  durationMs: number;
  status: 'completed' | 'error' | 'timeout' | 'superseded' | 'backgrounded';
  milestones: Record<string, number>;
  requests: Array<{
    requestId: string; operation: string; outcome: string;
    timings: Record<string, number>; serverRequestId?: string;
  }>;
};

type Target = { targetDeviceId: string; droneId: string; chatName: string; path: string; parentNavigationId?: string };
type Span = { record: WorkspaceLoadRecord; target: Target; started: number; timer: ReturnType<typeof setTimeout> };

/** Bounded, concurrent navigations. Paths are matching keys only and never leave memory. */
export class WorkspaceLoadDiagnostics {
  private readonly active = new Map<string, Span>();
  constructor(private readonly config: {
    uuid(): string; platform: string; save(record: WorkspaceLoadRecord): void | Promise<void>;
    now?: () => number; frame?: (callback: () => void) => unknown;
  }) {}
  private now() { return (this.config.now ?? (() => performance.now()))(); }
  private elapsed(span: Span) { return Math.max(0, Math.round((this.now() - span.started) * 10) / 10); }
  start(kind: WorkspaceLoadRecord['kind'], target: Target): string {
    for (const [id, span] of this.active) {
      if (span.record.kind === kind && (kind === 'file-open' || this.matches(span, target))) this.finish(id, 'superseded');
    }
    if (this.active.size >= 32) this.finish(this.active.keys().next().value!, 'superseded');
    const navigationId = this.config.uuid();
    const timer = setTimeout(() => this.finish(navigationId, 'timeout'), 45_000);
    (timer as any).unref?.();
    this.active.set(navigationId, {
      started: this.now(), target, timer,
      record: { version: 1, kind, navigationId,
        ...(target.parentNavigationId ? { parentNavigationId: target.parentNavigationId } : {}), targetDeviceId: target.targetDeviceId,
        droneId: target.droneId, chatName: target.chatName || 'default', platform: this.config.platform,
        startedAt: new Date().toISOString(), durationMs: 0, status: 'timeout', milestones: { intent: 0 }, requests: [] },
    });
    return navigationId;
  }
  private matches(span: Span, target: Partial<Target>) {
    return Object.entries(target).every(([key, value]) => span.target[key as keyof Target] === value);
  }
  find(kind: WorkspaceLoadRecord['kind'], target: Partial<Target>): string | undefined {
    for (const [id, span] of this.active) if (span.record.kind === kind && this.matches(span, target)) return id;
  }
  mark(id: string | undefined, name: string, value?: number) {
    const span = id && this.active.get(id);
    if ((value !== undefined && (!Number.isFinite(value) || value < 0)) || !span || !/^[a-zA-Z][a-zA-Z0-9_.]{0,47}$/.test(name) || Object.keys(span.record.milestones).length >= 32) return;
    if (span.record.milestones[name] === undefined) span.record.milestones[name] = value ?? this.elapsed(span);
  }
  accumulate(id: string | undefined, name: string, durationMs: number) {
    const span = id && this.active.get(id);
    if (!span || !/^[a-zA-Z][a-zA-Z0-9_.]{0,47}$/.test(name) || !Number.isFinite(durationMs) || durationMs < 0) return;
    if (!Object.prototype.hasOwnProperty.call(span.record.milestones, name)) { this.mark(id, name, durationMs); return; }
    span.record.milestones[name] = Math.min(3_600_000, span.record.milestones[name] + durationMs);
  }
  retarget(id: string | undefined, path: string) {
    const span = id && this.active.get(id);
    if (span) span.target = { ...span.target, path };
  }
  committed(id: string | undefined) {
    if (!id || !this.active.has(id) || this.active.get(id)!.record.milestones.committed !== undefined) return;
    this.mark(id, 'committed');
    const frame = this.config.frame ?? ((callback: () => void) => requestAnimationFrame(callback));
    frame(() => frame(() => { this.mark(id, 'frame'); this.finish(id, 'completed'); }));
  }
  finish(id: string | undefined, status: WorkspaceLoadRecord['status']) {
    const span = id && this.active.get(id);
    if (!span) return;
    this.active.delete(id!);
    clearTimeout(span.timer);
    span.record.status = status;
    span.record.durationMs = this.elapsed(span);
    try { void Promise.resolve(this.config.save(span.record)).catch(() => undefined); } catch { /* Diagnostics cannot block UI. */ }
  }
  finishAll(status: WorkspaceLoadRecord['status']) {
    for (const id of this.active.keys()) this.finish(id, status);
  }
  observe(target: Partial<Target>, operation: string, requestId: string, navigationId?: string) {
    const id = navigationId ?? this.find(operation === 'files.list' ? 'directory-load' : 'file-open', target);
    const span = id && this.active.get(id);
    if (!span || span.record.requests.length >= 16) return null;
    const started = this.now();
    let finished = false;
    const live = () => !finished && this.active.get(id!) === span;
    const validTiming = (name: string, value: number) => live() && /^[a-zA-Z][a-zA-Z0-9_.]{0,47}$/.test(name) && Number.isFinite(value) && value >= 0 && Object.keys(record.timings).length < 32;
    const record: WorkspaceLoadRecord['requests'][number] = {
      requestId, operation, outcome: 'aborted', timings: { startMs: this.elapsed(span) },
    };
    span.record.requests.push(record);
    return {
      mark: (name: string) => { const value = Math.max(0, this.now() - started); if (validTiming(name, value)) record.timings[name] = value; },
      timing: (name: string, value: number) => { if (validTiming(name, value)) record.timings[name] = value; },
      serverId: (value?: string) => { if (live() && value && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value)) record.serverRequestId = value; },
      finish: (outcome: 'completed' | 'error' | 'aborted') => {
        if (!live()) return;
        finished = true;
        record.outcome = outcome; record.timings.durationMs = Math.max(0, this.now() - started);
      },
    };
  }
}
