export function normalizeSilentCompletion(
  ok: boolean,
  outputRaw: unknown,
  options?: { explicitlySilent?: boolean; prompt?: unknown; promptId?: unknown },
): { output: string; silentCompletion: boolean } {
  const output = ok ? String(outputRaw ?? '') : '';
  const silentCompletion =
    ok &&
    (options?.explicitlySilent === true ||
      (isResourceSubscriptionPrompt(options?.prompt, options?.promptId) &&
        output.trim() === '[[NO_REPLY]]'));
  return { output: silentCompletion ? '' : output, silentCompletion };
}

export function isResourceSubscriptionPrompt(promptRaw: unknown, promptIdRaw: unknown): boolean {
  return (
    String(promptIdRaw ?? '').startsWith('subscription-') &&
    String(promptRaw ?? '')
      .trimStart()
      .startsWith('[event notification]')
  );
}
