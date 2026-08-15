import crypto from 'node:crypto';

import type { CompanionBrowserToolName } from './companion-config';

const ACTIVITY_RESULT_MAX_CHARS = 20_000;
const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 20_000;

type BrowserToolDispatch = {
  callId: string;
  generation: number;
  tool: CompanionBrowserToolName;
  args: Record<string, unknown>;
};

type PendingBrowserTool = {
  generation: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort(): void;
};

export class CompanionBrowserToolBroker {
  private readonly pending = new Map<string, PendingBrowserTool>();

  constructor(
    private readonly options: {
      available(): boolean;
      dispatch(call: BrowserToolDispatch): void | Promise<void>;
      unavailableMessage: string;
      timeoutMs?: number;
    },
  ) {}

  request(
    tool: CompanionBrowserToolName,
    args: Record<string, unknown>,
    generation: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.options.available())
      return Promise.reject(new Error(this.options.unavailableMessage));
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => this.reject(callId, new Error('browser tool cancelled'));
      const timer = setTimeout(
        () => this.reject(callId, new Error(`browser tool timed out: ${tool}`)),
        this.options.timeoutMs ?? DEFAULT_BROWSER_TOOL_TIMEOUT_MS,
      );
      timer.unref?.();
      this.pending.set(callId, { generation, resolve, reject, timer, signal, onAbort });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        void Promise.resolve(this.options.dispatch({ callId, generation, tool, args })).catch(
          (error) => this.reject(callId, error instanceof Error ? error : new Error(String(error))),
        );
      } catch (error) {
        this.reject(callId, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  resolve(input: {
    callId: string;
    generation: number;
    ok: boolean;
    result?: unknown;
    error?: unknown;
  }): boolean {
    const pending = this.pending.get(input.callId);
    if (!pending || pending.generation !== input.generation) return false;
    this.remove(input.callId, pending);
    if (!input.ok) pending.reject(new Error(String(input.error ?? 'browser tool failed')));
    else pending.resolve(input.result);
    return true;
  }

  rejectAll(message: string): void {
    for (const callId of [...this.pending.keys()]) this.reject(callId, new Error(message));
  }

  private reject(callId: string, error: Error): void {
    const pending = this.pending.get(callId);
    if (!pending) return;
    this.remove(callId, pending);
    pending.reject(error);
  }

  private remove(callId: string, pending: PendingBrowserTool): void {
    this.pending.delete(callId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort);
  }
}

export function boundedCompanionActivityEvent(event: any): any | null {
  const type = String(event?.type ?? '');
  if (!type.startsWith('tool_call_')) return null;
  if (type === 'tool_call_started') return { ...event, args: boundedActivityValue(event.args) };
  if (type === 'tool_call_completed') {
    return { ...event, result: boundedActivityValue(event.result) };
  }
  if (type === 'tool_call_failed') return { ...event, error: boundedActivityValue(event.error) };
  return event;
}

function boundedActivityValue(value: unknown): unknown {
  let serialized = '';
  try {
    serialized = JSON.stringify(value) ?? String(value ?? '');
  } catch {
    serialized = String(value ?? '');
  }
  return serialized.length <= ACTIVITY_RESULT_MAX_CHARS
    ? value
    : `${serialized.slice(0, ACTIVITY_RESULT_MAX_CHARS)}\n… value truncated`;
}
