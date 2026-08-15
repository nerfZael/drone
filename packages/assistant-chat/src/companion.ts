export const COMPANION_MAX_PROMPT_CHARS = 20_000;
export const COMPANION_MAX_RUN_ID_CHARS = 128;

export const COMPANION_BROWSER_TOOL_NAMES = [
  'get_app_context',
  'read_active_composer',
  'apply_composer_patch',
  'read_open_file',
  'apply_editor_patch',
  'prepare_drone_draft',
  'highlight_drones',
] as const;

export type CompanionBrowserToolName = (typeof COMPANION_BROWSER_TOOL_NAMES)[number];

export type CompanionStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'transcribing'
  | 'working'
  | 'completed'
  | 'cancelled'
  | 'error';

export type CompanionTextMode =
  | 'edit'
  | 'preview'
  | 'read-only'
  | 'loading'
  | 'saving'
  | 'large-file';

export type CompanionTextSnapshot = {
  targetId: string;
  path: string;
  content: string;
  revision: string;
  mode: CompanionTextMode;
  dirty?: boolean;
};

export type CompanionToolActivity = {
  callId: string;
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  status: 'running' | 'completed' | 'failed';
};

export type CompanionToolActivityEvent = {
  type: string;
  callId?: unknown;
  tool?: unknown;
  args?: unknown;
  result?: unknown;
  error?: unknown;
};

export type CompanionBrowserToolRequest = {
  type: 'tool_call';
  generation: number;
  callId: string;
  tool: CompanionBrowserToolName;
  args: Record<string, unknown>;
};

export type CompanionRunEvent =
  | CompanionBrowserToolRequest
  | { type: 'activity'; event: CompanionToolActivityEvent }
  | { type: 'reply'; reply: string }
  | { type: 'status'; status: 'working' | 'completed' | 'cancelled' }
  | { type: 'error'; error: string };

export type CompanionClientMessage =
  | { type: 'start_run'; runId: string; prompt: string }
  | { type: 'cancel_run'; runId: string }
  | {
      type: 'tool_result';
      runId: string;
      generation: number;
      callId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type CompanionServerMessage = CompanionRunEvent & { runId?: string };

export type CompanionRunInputValidation =
  | { ok: true; runId: string; prompt: string }
  | { ok: false; runId: string; error: string };

export function validateCompanionRunInput(input: {
  runId?: unknown;
  prompt?: unknown;
}): CompanionRunInputValidation {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (
    !runId ||
    runId.length > COMPANION_MAX_RUN_ID_CHARS ||
    /[\u0000-\u001f\u007f]/.test(runId)
  ) {
    return {
      ok: false,
      runId: runId.slice(0, COMPANION_MAX_RUN_ID_CHARS),
      error: 'A valid runId is required.',
    };
  }
  if (!prompt) return { ok: false, runId, error: 'A non-empty prompt is required.' };
  if (prompt.length > COMPANION_MAX_PROMPT_CHARS) {
    return {
      ok: false,
      runId,
      error: `Companion prompts cannot exceed ${COMPANION_MAX_PROMPT_CHARS} characters.`,
    };
  }
  return { ok: true, runId, prompt };
}

export function reduceCompanionToolActivity(
  current: CompanionToolActivity[],
  event: CompanionToolActivityEvent,
): CompanionToolActivity[] {
  const type = String(event?.type ?? '');
  const callId = String(event?.callId ?? '');
  if (!callId) return current;
  if (type === 'tool_call_started') {
    if (current.some((item) => item.callId === callId)) return current;
    return [
      ...current,
      {
        callId,
        tool: String(event.tool ?? 'tool'),
        args: event.args,
        status: 'running',
      },
    ];
  }
  if (type !== 'tool_call_completed' && type !== 'tool_call_failed') return current;
  const status: CompanionToolActivity['status'] =
    type === 'tool_call_completed' ? 'completed' : 'failed';
  const error = event.error == null ? undefined : String(event.error);
  const existing = current.find((item) => item.callId === callId);
  if (!existing) {
    return [
      ...current,
      {
        callId,
        tool: String(event.tool ?? 'tool'),
        args: event.args,
        result: event.result,
        ...(error ? { error } : {}),
        status,
      },
    ];
  }
  return current.map((item) => {
    if (item.callId !== callId) return item;
    const next = { ...item, status, result: event.result };
    delete next.error;
    if (error) next.error = error;
    return next;
  });
}
