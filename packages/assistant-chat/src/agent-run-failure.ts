import type {
  AssistantMessage,
  AssistantMessageDiagnosticError,
} from './assistant-message-types.js';

export type AgentRunFailurePresentation = {
  recoverable: boolean;
  kind: 'connection' | 'timeout' | 'error';
  title: string;
  summary: string;
  technicalMessage: string;
  code?: string;
  attempts?: number;
};

function diagnosticErrorValues(
  error: AssistantMessageDiagnosticError | undefined,
): Array<{ message: string; code?: string }> {
  const values: Array<{ message: string; code?: string }> = [];
  let current = error;
  let depth = 0;
  while (current && depth < 4) {
    values.push({
      message: String(current.message ?? ''),
      ...(current.code != null ? { code: String(current.code) } : {}),
    });
    current = current.cause;
    depth += 1;
  }
  return values;
}

function reconnectAttempts(value: string): number | undefined {
  const denominators = Array.from(value.matchAll(/reconnect(?:ing)?[^\n]*?\b\d+\s*\/\s*(\d+)\b/gi))
    .map((match) => Number(match[1]))
    .filter((attempts) => Number.isFinite(attempts) && attempts > 0);
  return denominators.length > 0 ? Math.max(...denominators) : undefined;
}

/**
 * Conservative execution-policy check for failures known to come from the
 * agent transport. Presentation may be more forgiving, but queue ordering
 * must not change for an arbitrary tool or model timeout.
 */
export function isAgentTransportInterruption(error: unknown): boolean {
  const evidence = String((error as any)?.message ?? error ?? '');
  return (
    /\b(econnreset|etimedout|und_err_(?:connect_timeout|headers_timeout|body_timeout|socket)|enotfound|eai_again)\b/i.test(
      evidence,
    ) ||
    /\b(fetch failed|socket hang up|connection reset)\b/i.test(evidence) ||
    /\bstream disconnected before completion\b/i.test(evidence) ||
    /\bprompt delivery was interrupted\b/i.test(evidence) ||
    /\berror sending request for (?:url|uri)\b/i.test(evidence) ||
    /\b(?:network|internet)(?: connection)? (?:was )?(?:lost|unavailable|offline|interrupted)\b/i.test(
      evidence,
    ) ||
    /\bconnection (?:was )?(?:closed|lost|interrupted)\b/i.test(evidence) ||
    /\bprovider_transport_failure\b/i.test(evidence)
  );
}

export function agentRunFailurePresentation(
  error: unknown,
  options: {
    evidence?: unknown[];
    code?: string;
    attempts?: number;
    aborted?: boolean;
    hasPartialToolCall?: boolean;
  } = {},
): AgentRunFailurePresentation {
  const technicalMessage = String(error ?? '').trim() || 'Unknown agent failure';
  const evidence = [
    technicalMessage,
    ...(options.evidence ?? []).map((value) => String(value ?? '')),
  ]
    .filter(Boolean)
    .join(' ');
  const timedOut =
    /\b(etimedout|und_err_(?:connect_timeout|headers_timeout|body_timeout))\b/i.test(evidence) ||
    /\btimed? out|timeout\b/i.test(evidence);
  const connectionFailure =
    /\b(econnreset|und_err_socket|enotfound|eai_again)\b/i.test(evidence) ||
    /\b(fetch failed|socket hang up|connection reset)\b/i.test(evidence) ||
    /\bstream disconnected before completion\b/i.test(evidence) ||
    /\berror sending request for (?:url|uri)\b/i.test(evidence) ||
    /\b(?:network|internet)(?: connection)? (?:was )?(?:lost|unavailable|offline|interrupted)\b/i.test(
      evidence,
    ) ||
    /\bconnection (?:was )?(?:closed|lost|interrupted)\b/i.test(evidence) ||
    /\bprovider_transport_failure\b/i.test(evidence);
  const recoverable =
    !options.aborted && !options.hasPartialToolCall && (timedOut || connectionFailure);
  const kind = timedOut ? 'timeout' : connectionFailure ? 'connection' : 'error';
  const parsedAttempts = reconnectAttempts(technicalMessage);
  const attempts =
    Number.isFinite(options.attempts) && Number(options.attempts) > 0
      ? Number(options.attempts)
      : parsedAttempts;

  return {
    recoverable,
    kind,
    title: recoverable
      ? timedOut
        ? 'Connection timed out'
        : 'Connection interrupted'
      : 'Agent couldn’t finish the response',
    summary: recoverable
      ? attempts
        ? `The run stopped after ${attempts} automatic reconnect attempts.`
        : 'The run stopped after the connection was lost.'
      : technicalMessage,
    technicalMessage,
    ...(options.code ? { code: options.code } : {}),
    ...(attempts ? { attempts } : {}),
  };
}

export function nativeAgentFailurePresentation(
  message: AssistantMessage,
): AgentRunFailurePresentation {
  const diagnostics = message.diagnostics ?? [];
  const diagnosticErrors = diagnostics.flatMap((diagnostic) =>
    diagnosticErrorValues(diagnostic.error),
  );
  const technicalMessage =
    String(message.errorMessage ?? '').trim() ||
    diagnosticErrors.map((error) => error.message).find(Boolean) ||
    'Unknown native agent failure';
  const code = [...diagnosticErrors].reverse().find((error) => error.code)?.code;
  const attempts = diagnostics
    .map((diagnostic) => Number(diagnostic.details?.attempts))
    .find((value) => Number.isFinite(value) && value > 0);

  return agentRunFailurePresentation(technicalMessage, {
    evidence: [
      ...diagnostics.map((diagnostic) => diagnostic.type),
      ...diagnosticErrors.flatMap((error) => [error.code ?? '', error.message]),
    ],
    ...(code ? { code } : {}),
    ...(attempts ? { attempts } : {}),
    aborted: message.stopReason === 'aborted',
    hasPartialToolCall:
      Array.isArray(message.content) && message.content.some((part) => part.type === 'toolCall'),
  });
}
